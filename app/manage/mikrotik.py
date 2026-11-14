"""Kelola router MikroTik lewat SSH: interface, VLAN + loop-protect, hotspot aktif, log, export.

Aksi yang mengubah router hanya: aktifkan / nonaktifkan interface dan atur loop-protect VLAN.
Tidak ada perintah bebas dari browser.
"""
from __future__ import annotations

import logging
import re

from ..collectors.mikrotik import parse_detail
from ..config import Config
from . import ManageError

log = logging.getLogger("manage.mikrotik")

_NAME = re.compile(r"^[A-Za-z0-9._\-]{1,64}$")  # masuk ke dalam perintah RouterOS: tanpa kutip, spasi, kurung
_ROS_ERR = re.compile(
    r"^\s*(failure:.*|no such item.*|bad command name.*|expected end of command.*|syntax error.*|"
    r"input does not match.*|not enough permissions.*|invalid value.*|ambiguous value.*)$", re.M | re.I)
LOOP_PROTECT = ("on", "off", "default")


# ---------------------------------------------------------------- fungsi murni


def parse_interfaces(text: str) -> list[dict]:
    out = []
    for r in parse_detail(text):
        if "name" not in r:
            continue
        f = r.get("_flags", "")
        out.append({"name": r["name"], "type": r.get("type", ""), "mtu": r.get("mtu", ""),
                    "running": "R" in f, "disabled": "X" in f, "dynamic": "D" in f,
                    "last_up": r.get("last-link-up-time", "")})
    return out


def parse_vlans(text: str) -> list[dict]:
    out = []
    for r in parse_detail(text):
        if "name" not in r:
            continue
        f = r.get("_flags", "")
        out.append({"name": r["name"], "vlan_id": r.get("vlan-id", ""), "interface": r.get("interface", ""),
                    "running": "R" in f, "disabled": "X" in f, "loop_protect": r.get("loop-protect", ""),
                    "lp_status": r.get("loop-protect-status", "")})
    return out


def parse_hotspot(text: str) -> list[dict]:
    return [{"user": r.get("user", ""), "address": r.get("address", ""), "mac": r.get("mac-address", ""),
             "uptime": r.get("uptime", ""), "server": r.get("server", "")}
            for r in parse_detail(text) if r.get("address") or r.get("user")]


def build_command(action: str, name: str, value: str, interfaces: set[str], vlans: set[str]) -> str:
    """Perintah RouterOS untuk satu aksi. `name` harus ada di daftar yang baru dibaca dari router."""
    if not _NAME.match(name or ""):
        raise ManageError("Nama interface ini memuat karakter yang tidak bisa dikirim dengan aman. Ubah lewat WinBox.")
    if action in ("enable", "disable"):
        if name not in interfaces:
            raise ManageError("Interface tidak ada di router. Muat ulang daftar lalu coba lagi.")
        return f'/interface set [find name="{name}"] disabled={"yes" if action == "disable" else "no"}'
    if action == "loop_protect":
        if name not in vlans:
            raise ManageError("VLAN tidak ada di router. Muat ulang daftar lalu coba lagi.")
        if value not in LOOP_PROTECT:
            raise ManageError("Pilih on, off, atau default.")
        return f'/interface vlan set [find name="{name}"] loop-protect={value}'
    raise ManageError("Aksi tidak dikenal.")


# ---------------------------------------------------------------- sesi


class _Session:
    def __init__(self, cfg: Config, timeout: float = 15.0):
        if not cfg.mikrotik_host:
            raise ManageError("Host MikroTik belum diisi. Isi di tab Koneksi.")
        import paramiko

        self.c = paramiko.SSHClient()
        self.c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.c.connect(cfg.mikrotik_host, cfg.mikrotik_port, cfg.mikrotik_user + "+cte", cfg.mikrotik_password,
                       timeout=timeout, banner_timeout=timeout, auth_timeout=timeout,
                       look_for_keys=False, allow_agent=False)

    def run(self, cmd: str, timeout: float = 40) -> str:
        _, out, _ = self.c.exec_command(cmd, timeout=timeout)
        return out.read().decode(errors="replace").replace("\r", "")

    def close(self) -> None:
        try:
            self.c.close()
        except Exception:
            pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def interfaces(cfg: Config) -> dict:
    with _Session(cfg) as s:
        return {"interfaces": parse_interfaces(s.run("/interface print detail without-paging")),
                "vlans": parse_vlans(s.run("/interface vlan print detail without-paging"))}


def hotspot(cfg: Config) -> list[dict]:
    with _Session(cfg) as s:
        return parse_hotspot(s.run("/ip hotspot active print detail without-paging"))


def logs(cfg: Config, limit: int = 200) -> list[str]:
    with _Session(cfg) as s:
        return [x for x in s.run("/log print without-paging").splitlines() if x.strip()][-limit:]


def export(cfg: Config) -> str:
    """Konfigurasi router tanpa rahasia. RouterOS 6 perlu `hide-sensitive`; RouterOS 7 sudah
    menyembunyikannya secara bawaan dan bisa menolak kata kunci itu."""
    with _Session(cfg) as s:
        out = s.run("/export hide-sensitive", timeout=120)
        if _ROS_ERR.search(out[:400]):
            ver = re.search(r"version:\s*(\d+)", s.run("/system resource print"))
            if not ver or int(ver.group(1)) < 7:
                raise ManageError("Router menolak perintah export: " + out.strip().splitlines()[0][:160])
            out = s.run("/export", timeout=120)
        return out.strip("\n")


def apply(cfg: Config, action: str, name: str, value: str = "") -> str:
    with _Session(cfg) as s:
        ifaces = {i["name"] for i in parse_interfaces(s.run("/interface print detail without-paging"))}
        vlans = {v["name"] for v in parse_vlans(s.run("/interface vlan print detail without-paging"))}
        cmd = build_command(action, name, value, ifaces, vlans)
        out = s.run(cmd)
        m = _ROS_ERR.search(out)
        if m:
            raise ManageError(f"Router menolak perintah: {m.group(1).strip()[:160]}")
        log.info("perintah ke %s: %s", cfg.mikrotik_host, cmd)
    if action == "loop_protect":
        return f"Loop-protect {name} diatur ke {value}."
    return f"Interface {name} {'dinonaktifkan' if action == 'disable' else 'diaktifkan'}."
