"""Penjadwal: mengambil data berkala, menjalankan deteksi, mencatat kejadian, mengirim notifikasi."""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from . import notifier as N
from .collectors import cisco, genieacs, mikrotik
from .config import Config
from .detector import analyze
from .store import Store

log = logging.getLogger("monitor")
CLEAR_TICKS = 4  # loop dianggap selesai setelah sekian pemeriksaan berturut-turut bersih


class Source:
    """Satu sumber data beserta status kesehatannya (ditampilkan di dashboard)."""

    def __init__(self, name: str, label: str, enabled: bool, fetch: Callable[[], object]):
        self.name, self.label, self.enabled, self._fetch = name, label, enabled, fetch
        self.data = None
        self.ok: bool | None = None
        self.error = ""
        self.last_ok = 0.0
        self.last_try = 0.0

    def refresh(self) -> None:
        if not self.enabled:
            return
        self.last_try = time.time()
        try:
            self.data = self._fetch()
            self.ok, self.error, self.last_ok = True, "", self.last_try
        except Exception as e:
            self.ok = False
            self.error = f"{type(e).__name__}: {e}"[:200]
            log.warning("sumber %s gagal: %s", self.name, self.error)

    def status(self) -> dict:
        return {"name": self.name, "label": self.label, "enabled": self.enabled, "ok": self.ok,
                "error": self.error, "last_ok": int(self.last_ok) or None}


class Monitor:
    def __init__(self, cfg: Config, store: Store, notifier: N.Notifier | None = None, replay: bool = False):
        self.cfg, self.store, self.replay = cfg, store, replay
        self.replay_dir = ""  # folder fixture; dipakai tab kelola perangkat di mode replay
        self.notifier = notifier or N.Notifier(cfg)
        self.acs = Source("genieacs", "GenieACS", bool(cfg.genieacs_url), lambda: genieacs.fetch(cfg))
        self.switch = Source("cisco", "Switch Cisco", bool(cfg.cisco_host), lambda: cisco.fetch(cfg))
        self.router = Source("mikrotik", "Router MikroTik", bool(cfg.mikrotik_host), lambda: mikrotik.fetch(cfg))
        self.state: dict = {}
        self._lock = threading.Lock()
        self._run_lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._force_acs = False
        self._incident: int | None = store.open_incident_id()
        self._incident_start = 0.0
        self._clear_streak = 0
        self._known_strong: set[str] = set()
        self._last_prune = 0.0

    # ------------------------------------------------------------ satu putaran
    def tick(self, force_acs: bool = False) -> dict:
        with self._run_lock:
            now = time.time()
            if not self.replay:
                self.switch.refresh()
                self.router.refresh()
                acs_due = force_acs or self.acs.data is None or now - self.acs.last_try >= self.cfg.acs_interval_sec
                if acs_due:
                    self.acs.refresh()
            a = analyze(self.cfg, self.acs.data, self.switch.data, self.router.data, now)
            # saat loop baru muncul, data host ACS mungkin sudah basi: ambil ulang sekali
            if a["loop"]["active"] and self._incident is None and not self.replay and now - self.acs.last_try > 60:
                self.acs.refresh()
                a = analyze(self.cfg, self.acs.data, self.switch.data, self.router.data, now)
            self._track(a, now)
            # tanpa switch maupun router, ada-tidaknya loop tidak bisa dipastikan: jangan dilaporkan "normal"
            a["loop"]["known"] = self.replay or any(s.enabled and s.ok for s in (self.switch, self.router))
            a["sources"] = [s.status() for s in (self.acs, self.switch, self.router)]
            a["replay"] = self.replay
            a["telegram"] = self.notifier.enabled
            a["incident_start"] = int(self._incident_start) or None
            self.store.add_sample(a)
            if now - self._last_prune > 3600:
                self.store.prune(self.cfg.retention_days)
                self._last_prune = now
            with self._lock:
                self.state = a
            return a

    def _track(self, a: dict, now: float) -> None:
        active = a["loop"]["active"]
        strong = {s["id"]: s for s in a["suspects"] if s["level"] == "kuat"}
        if active:
            self._clear_streak = 0
            if self._incident is None:
                self._incident = self.store.open_incident(a)
                self._incident_start = now
                self.notifier.send(N.msg_loop_start(a), key="loop_start")
                self._known_strong = set(strong)
            else:
                if not self._incident_start:
                    self._incident_start = now
                self.store.update_incident(self._incident, a)
                for i, s in strong.items():
                    if i not in self._known_strong:
                        self.notifier.send(N.msg_new_suspect(s), key="suspect:" + i)
                self._known_strong |= set(strong)
        elif self._incident is not None:
            self._clear_streak += 1
            if self._clear_streak >= CLEAR_TICKS:
                self.store.close_incident(self._incident, int(now))
                mins = (now - self._incident_start) / 60 if self._incident_start else 0
                self.notifier.send(N.msg_loop_end(mins))
                self._incident, self._incident_start, self._known_strong = None, 0.0, set()

    def reconfigure(self) -> None:
        """Dipanggil setelah pengaturan diubah: aktifkan/nonaktifkan sumber lalu periksa ulang segera."""
        if self.replay:
            return
        for src, on in (
            (self.acs, bool(self.cfg.genieacs_url)),
            (self.switch, bool(self.cfg.cisco_host)),
            (self.router, bool(self.cfg.mikrotik_host)),
        ):
            src.enabled = on
            src.ok, src.error = None, ""
            if not on:
                src.data = None
        self.request_refresh()

    # ------------------------------------------------------------ thread
    def start(self) -> None:
        threading.Thread(target=self._loop, name="monitor", daemon=True).start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()

    def request_refresh(self) -> None:
        self._force_acs = True
        self._wake.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            force, self._force_acs = self._force_acs, False
            try:
                self.tick(force_acs=force)
            except Exception:
                log.exception("putaran pemantauan gagal")
            self._wake.wait(self.cfg.fast_interval_sec)
            self._wake.clear()

    def snapshot(self) -> dict:
        with self._lock:
            return dict(self.state)
