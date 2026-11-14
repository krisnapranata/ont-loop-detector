"""Titik masuk:  python -m app.main [--replay FOLDER] [--check] [--env FILE]"""
from __future__ import annotations

import argparse
import logging
import math
import random
import secrets
import sys
import time

from . import replay as replay_mod
from .config import load
from .detector import analyze
from .monitor import Monitor
from .store import Store

log = logging.getLogger("main")


def _seed_demo_history(store: Store, a: dict) -> None:
    """Isi riwayat contoh (3 jam: normal, lalu loop sejak 45 menit lalu) supaya chart bisa dilihat di mode replay."""
    rnd = random.Random(7)
    now = int(time.time())
    start_loop = now - 45 * 60
    quiet = {**a, "loop": {**a["loop"], "active": False, "blocked_vlans": []}, "suspects": []}
    for ts in range(now - 3 * 3600, now, 60):
        if ts < start_loop:
            users = int(215 + 25 * math.sin(ts / 1500) + rnd.randint(-6, 6))
            c = {**a["counts"], "strong": 0, "risk": 4, "flapping_macs": 0,
                 "flap_events": 1 if rnd.random() < 0.12 else 0, "hotspot_active": users}
            store.add_sample({**quiet, "counts": c}, ts)
        else:
            since = ts - start_loop
            blip = since % 300 < 60 and since > 60  # loop-protect mencoba menyalakan lagi tiap 5 menit
            c = {**a["counts"], "strong": 1 if since > 240 else 0, "risk": 3 if since > 240 else 4,
                 "flapping_macs": rnd.randint(4, 6), "flap_events": rnd.randint(24, 36),
                 "hotspot_active": rnd.randint(3, 14) if blip else 0}
            store.add_sample({**a, "counts": c}, ts)
    old = store.open_incident({**a, "suspects": a["suspects"][:1]}, now - 26 * 3600)
    store.close_incident(old, now - 26 * 3600 + 38 * 60)
    store.open_incident(a, start_loop)


def _print_report(a: dict) -> None:
    lp = a["loop"]
    print("STATUS :", "LOOP AKTIF" if lp["active"] else "normal" if lp.get("known", True)
          else "TIDAK DIKETAHUI (switch dan router tidak terbaca)")
    for r in lp["reasons"]:
        print("  -", r)
    c = a["counts"]
    print(f"ONT    : {c['total_onts']} total, {c['no_host_data']} tanpa data host")
    print(f"Hasil  : {c['strong']} tersangka kuat, {c['risk']} berisiko, {c['flapping_macs']} MAC berpindah-pindah\n")
    print(f"{'SKOR':>4}  {'TINGKAT':<9} {'SERIAL':<14} {'TRUNK':<9} {'TR069':<15} PELANGGAN / ALASAN")
    for s in a["suspects"]:
        if s["level"] == "normal":
            continue
        print(f"{s['score']:>4}  {s['level']:<9} {s['serial']:<14} {s['trunk']:<9} {s['tr069_ip']:<15} {s['label']}")
        for r in s["reasons"]:
            print(f"{'':>31}+{r['points']:<3} {r['text']}")
    for s in a.get("sources", []):
        if s["enabled"] and s["ok"] is False:
            print(f"\nPERINGATAN: sumber {s['label']} gagal dibaca: {s['error']}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="ont-loop-detector", description="Pendeteksi ONT penyebab loop")
    p.add_argument("--env", help="file konfigurasi (default: .env di folder proyek)")
    p.add_argument("--replay", metavar="FOLDER", help="pakai data rekaman, tidak menghubungi perangkat")
    p.add_argument("--check", action="store_true", help="periksa sekali, cetak hasil di terminal, lalu keluar")
    p.add_argument("--host")
    p.add_argument("--port", type=int)
    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("paramiko").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)

    cfg = load(args.env)
    if args.host:
        cfg.web_host = args.host
    if args.port:
        cfg.web_port = args.port

    if args.replay:
        store = Store(":memory:")
        mon = Monitor(cfg, store, replay=True)
        mon.acs.data, mon.switch.data, mon.router.data = replay_mod.load(args.replay)
        for s in (mon.acs, mon.switch, mon.router):
            s.enabled, s.ok, s.last_ok = True, True, time.time()
        if not args.check:
            _seed_demo_history(store, analyze(cfg, mon.acs.data, mon.switch.data, mon.router.data))
            mon._incident, mon._incident_start = store.open_incident_id(), time.time() - 45 * 60
    else:
        store = Store(":memory:" if args.check else cfg.db_path)
        mon = Monitor(cfg, store)
        if not any(s.enabled for s in (mon.switch, mon.router)):
            log.warning("CISCO_HOST dan MIKROTIK_HOST belum diisi di .env; hanya data GenieACS yang dipakai")

    if args.check:
        _print_report(mon.tick(force_acs=True))
        return 0

    import uvicorn

    from .web import create_app

    password = cfg.web_password
    if not password:
        password = secrets.token_urlsafe(9)
        log.warning("WEB_PASSWORD belum diisi. Password sementara untuk sesi ini: %s (user: %s)", password, cfg.web_user)
    mon.start()
    log.info("dashboard: http://%s:%d/  (user: %s)%s", cfg.web_host, cfg.web_port, cfg.web_user,
             "  [MODE REPLAY]" if args.replay else "")
    uvicorn.run(create_app(cfg, mon, password), host=cfg.web_host, port=cfg.web_port, log_level="warning")
    mon.stop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
