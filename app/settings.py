"""Pengaturan yang bisa diubah dari halaman web: validasi, penyimpanan, dan tes koneksi.

Kata sandi tidak pernah dikirim balik ke browser. Kolom kata sandi yang dikosongkan saat
menyimpan berarti "jangan diubah".
"""
from __future__ import annotations

import copy
import ipaddress
import json
import os
import re
import secrets
import socket
from pathlib import Path
from urllib.parse import urlsplit

from .config import Config

SAVED_KEYS = [
    "genieacs_url", "genieacs_user", "genieacs_password",
    "cisco_host", "cisco_port", "cisco_transport", "cisco_user", "cisco_password", "cisco_enable_password",
    "mikrotik_host", "mikrotik_port", "mikrotik_user", "mikrotik_password",
    "olts",
    "hotspot_subnets", "hotspot_vlan", "tr069_vlan", "tr069_interface", "olt_trunks",
    "telegram_bot_token", "telegram_chat_id",
]
_HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.\-:]{0,253})$")
_NAME = re.compile(r"^[A-Za-z0-9._\-]{1,64}$")  # dipakai di dalam perintah RouterOS: tidak boleh ada kutip/spasi
_PORTNAME = re.compile(r"^[A-Za-z]{2,}[A-Za-z0-9/.\-]{1,30}$")
_TEXT = re.compile(r"^[^\x00-\x1f\x7f]{0,128}$")


class SettingsError(ValueError):
    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors


# ------------------------------------------------------------------ file


def overlay(cfg: Config) -> None:
    """Timpa nilai cfg dengan isi file pengaturan (bila ada)."""
    p = Path(cfg.settings_path)
    if not p.is_file():
        return
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    for k in SAVED_KEYS:
        if k in data:
            setattr(cfg, k, data[k])


def _write(cfg: Config) -> None:
    p = Path(cfg.settings_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump({k: getattr(cfg, k) for k in SAVED_KEYS}, f, indent=1)
    os.replace(tmp, p)
    os.chmod(p, 0o600)


# ------------------------------------------------------------------ tampilan untuk browser


def _split_url(url: str) -> tuple[str, str, int]:
    u = urlsplit(url if "//" in url else "//" + url)
    scheme = u.scheme or "http"
    return scheme, u.hostname or "", u.port or (443 if scheme == "https" else 7557 if not u.netloc else 80)


def public_view(cfg: Config) -> dict:
    """Pengaturan untuk ditampilkan di form. Kata sandi diganti penanda *_set."""
    _, ah, ap = _split_url(cfg.genieacs_url) if cfg.genieacs_url else ("http", "", 7557)
    return {
        "genieacs": {"host": ah, "port": ap, "user": cfg.genieacs_user,
                     "password": "", "password_set": bool(cfg.genieacs_password)},
        "cisco": {"host": cfg.cisco_host, "port": cfg.cisco_port, "transport": cfg.cisco_transport,
                  "user": cfg.cisco_user, "password": "", "password_set": bool(cfg.cisco_password),
                  "enable_password": "", "enable_password_set": bool(cfg.cisco_enable_password)},
        "mikrotik": {"host": cfg.mikrotik_host, "port": cfg.mikrotik_port, "user": cfg.mikrotik_user,
                     "password": "", "password_set": bool(cfg.mikrotik_password)},
        "olts": [
            {"id": o.get("id", ""), "name": o.get("name", ""), "host": o.get("host", ""), "port": o.get("port", 23),
             "transport": o.get("transport", "telnet"), "user": o.get("user", ""),
             "password": "", "password_set": bool(o.get("password")),
             "enable_password": "", "enable_password_set": bool(o.get("enable_password"))}
            for o in cfg.olts
        ],
        "network": {"hotspot_subnets": ", ".join(cfg.hotspot_subnets), "hotspot_vlan": cfg.hotspot_vlan,
                    "tr069_vlan": cfg.tr069_vlan, "tr069_interface": cfg.tr069_interface,
                    "olt_trunks": ", ".join(cfg.olt_trunks)},
        "telegram": {"bot_token": "", "bot_token_set": bool(cfg.telegram_bot_token), "chat_id": cfg.telegram_chat_id},
    }


# ------------------------------------------------------------------ validasi


class _V:
    def __init__(self):
        self.errors: dict[str, str] = {}

    def host(self, key, v):
        v = str(v or "").strip()
        if v and not _HOST.match(v):
            self.errors[key] = "Host hanya boleh berisi huruf, angka, titik, dan tanda hubung"
        return v

    def port(self, key, v, default):
        try:
            n = int(v if v not in (None, "") else default)
        except (TypeError, ValueError):
            n = 0
        if not 1 <= n <= 65535:
            self.errors[key] = "Port harus angka 1 sampai 65535"
            return default
        return n

    def vlan(self, key, v):
        try:
            n = int(v)
        except (TypeError, ValueError):
            n = 0
        if not 1 <= n <= 4094:
            self.errors[key] = "VLAN harus angka 1 sampai 4094"
        return n

    def text(self, key, v):
        v = str(v or "").strip()
        if not _TEXT.match(v):
            self.errors[key] = "Maksimal 128 karakter, tanpa karakter kontrol"
        return v

    def secret(self, key, v, old):
        v = str(v or "")
        if not v:
            return old  # dikosongkan = tidak diubah
        if not _TEXT.match(v):
            self.errors[key] = "Maksimal 128 karakter, tanpa karakter kontrol"
        return v

    def transport(self, key, v):
        v = str(v or "telnet").lower()
        if v not in ("telnet", "ssh"):
            self.errors[key] = "Pilih telnet atau ssh"
        return v


def merged(cfg: Config, payload: dict) -> Config:
    """Kembalikan salinan cfg dengan nilai dari form. Tidak menyimpan apa pun."""
    new, v = copy.copy(cfg), _V()
    payload = payload if isinstance(payload, dict) else {}

    g = payload.get("genieacs")
    if isinstance(g, dict):
        host = v.host("genieacs.host", g.get("host"))
        port = v.port("genieacs.port", g.get("port"), 7557)
        scheme = _split_url(cfg.genieacs_url)[0] if cfg.genieacs_url else "http"
        new.genieacs_url = f"{scheme}://{'[' + host + ']' if ':' in host else host}:{port}" if host else ""
        new.genieacs_user = v.text("genieacs.user", g.get("user"))
        new.genieacs_password = v.secret("genieacs.password", g.get("password"), cfg.genieacs_password)

    c = payload.get("cisco")
    if isinstance(c, dict):
        new.cisco_host = v.host("cisco.host", c.get("host"))
        new.cisco_transport = v.transport("cisco.transport", c.get("transport"))
        new.cisco_port = v.port("cisco.port", c.get("port"), 22 if new.cisco_transport == "ssh" else 23)
        new.cisco_user = v.text("cisco.user", c.get("user"))
        new.cisco_password = v.secret("cisco.password", c.get("password"), cfg.cisco_password)
        new.cisco_enable_password = v.secret("cisco.enable_password", c.get("enable_password"), cfg.cisco_enable_password)

    m = payload.get("mikrotik")
    if isinstance(m, dict):
        new.mikrotik_host = v.host("mikrotik.host", m.get("host"))
        new.mikrotik_port = v.port("mikrotik.port", m.get("port"), 22)
        new.mikrotik_user = v.text("mikrotik.user", m.get("user"))
        new.mikrotik_password = v.secret("mikrotik.password", m.get("password"), cfg.mikrotik_password)

    olts = payload.get("olts")
    if isinstance(olts, list):
        old = {o.get("id"): o for o in cfg.olts}
        out = []
        if len(olts) > 32:
            v.errors["olts"] = "Maksimal 32 OLT"
        for i, o in enumerate(olts[:32]):
            if not isinstance(o, dict):
                continue
            prev = old.get(o.get("id"), {})
            k = f"olts.{i}."
            tr = v.transport(k + "transport", o.get("transport"))
            item = {
                "id": prev.get("id") or secrets.token_hex(4),
                "name": v.text(k + "name", o.get("name")) or f"OLT {i + 1}",
                "host": v.host(k + "host", o.get("host")),
                "port": v.port(k + "port", o.get("port"), 22 if tr == "ssh" else 23),
                "transport": tr,
                "user": v.text(k + "user", o.get("user")),
                "password": v.secret(k + "password", o.get("password"), prev.get("password", "")),
                "enable_password": v.secret(k + "enable_password", o.get("enable_password"), prev.get("enable_password", "")),
            }
            if not item["host"]:
                v.errors.setdefault(k + "host", "Host OLT wajib diisi")
            out.append(item)
        new.olts = out

    n = payload.get("network")
    if isinstance(n, dict):
        subnets = [x.strip() for x in str(n.get("hotspot_subnets") or "").split(",") if x.strip()]
        try:
            subnets = [str(ipaddress.ip_network(x, strict=False)) for x in subnets]
        except ValueError:
            v.errors["network.hotspot_subnets"] = "Tulis dalam bentuk seperti 10.8.0.0/20, pisahkan dengan koma"
        if not subnets:
            v.errors.setdefault("network.hotspot_subnets", "Isi minimal satu subnet hotspot")
        new.hotspot_subnets = subnets
        new.hotspot_vlan = v.vlan("network.hotspot_vlan", n.get("hotspot_vlan"))
        new.tr069_vlan = v.vlan("network.tr069_vlan", n.get("tr069_vlan"))
        iface = str(n.get("tr069_interface") or "").strip()
        if not _NAME.match(iface):
            v.errors["network.tr069_interface"] = "Nama interface hanya boleh huruf, angka, titik, garis bawah, tanda hubung"
        new.tr069_interface = iface
        trunks = [x.strip() for x in str(n.get("olt_trunks") or "").split(",") if x.strip()]
        if not trunks or not all(_PORTNAME.match(t) for t in trunks):
            v.errors["network.olt_trunks"] = "Tulis nama port seperti Gi1/0/47, pisahkan dengan koma"
        new.olt_trunks = trunks

    t = payload.get("telegram")
    if isinstance(t, dict):
        new.telegram_bot_token = v.secret("telegram.bot_token", t.get("bot_token"), cfg.telegram_bot_token)
        chat = str(t.get("chat_id") or "").strip()
        if chat and not re.match(r"^-?\d{1,20}$|^@[A-Za-z0-9_]{3,64}$", chat):
            v.errors["telegram.chat_id"] = "Chat ID berupa angka (boleh diawali minus) atau @namakanal"
        new.telegram_chat_id = chat

    if v.errors:
        raise SettingsError(v.errors)
    return new


def save(cfg: Config, payload: dict) -> None:
    """Validasi, terapkan ke cfg yang sedang dipakai, lalu simpan ke file."""
    new = merged(cfg, payload)
    for k in SAVED_KEYS:
        setattr(cfg, k, getattr(new, k))
    _write(cfg)


# ------------------------------------------------------------------ tes koneksi


def _err(e: Exception) -> str:
    name = type(e).__name__
    if isinstance(e, (socket.timeout, TimeoutError)):
        return "Tidak ada jawaban (timeout). Periksa host, port, dan jalur jaringannya."
    if name in ("ConnectTimeout", "ReadTimeout", "PoolTimeout"):
        return "Tidak ada jawaban (timeout). Periksa host, port, dan jalur jaringannya."
    if isinstance(e, ConnectionRefusedError) or (name == "ConnectError" and "refused" in str(e).lower()):
        return "Koneksi ditolak. Periksa port dan apakah layanannya aktif."
    if name in ("ConnectError", "gaierror", "NoValidConnectionsError") or isinstance(e, OSError) and e.errno in (101, 113):
        return "Host tidak bisa dijangkau. Periksa alamat dan jalur jaringannya."
    if name == "HTTPStatusError":
        return f"Server menjawab dengan kode {e.response.status_code}. Periksa username/password dan port NBI."
    if name == "AuthenticationException":
        return "Login ditolak. Periksa username dan password."
    return f"{name}: {e}"[:200]


def test(cfg: Config, kind: str, olt_id: str = "") -> dict:
    """Coba sambung memakai cfg yang diberikan. Hanya membaca."""
    try:
        if kind == "genieacs":
            if not cfg.genieacs_url:
                return {"ok": False, "message": "Host ACS belum diisi."}
            from .collectors import genieacs

            n = len(genieacs.fetch(cfg, timeout=30))
            return {"ok": True, "message": f"Tersambung. {n} ONT terbaca."}
        if kind == "cisco":
            if not cfg.cisco_host:
                return {"ok": False, "message": "Host switch belum diisi."}
            from .collectors import cisco

            d = cisco.fetch(cfg)
            n = len(d.mac_ports.get(cfg.hotspot_vlan, {}))
            return {"ok": True, "message": f"Login berhasil. {n} MAC di VLAN {cfg.hotspot_vlan}, {len(d.flaps)} catatan MAC berpindah di log."}
        if kind == "mikrotik":
            if not cfg.mikrotik_host:
                return {"ok": False, "message": "Host MikroTik belum diisi."}
            from .collectors import mikrotik

            d = mikrotik.fetch(cfg)
            hs = "tidak terbaca" if d.hotspot_active is None else str(d.hotspot_active)
            return {"ok": True, "message": f"Login berhasil. {len(d.vlans)} VLAN terbaca, user hotspot aktif: {hs}."}
        if kind == "olt":
            o = next((x for x in cfg.olts if x.get("id") == olt_id), None)
            if not o:
                return {"ok": False, "message": "OLT tidak ditemukan. Simpan pengaturan dulu, lalu tes lagi."}
            with socket.create_connection((o["host"], int(o["port"])), timeout=8) as s:
                s.settimeout(3)
                try:
                    banner = s.recv(64)
                except (socket.timeout, TimeoutError):
                    banner = b""
            what = "layanan SSH menjawab" if banner.startswith(b"SSH-") else "port terbuka"
            return {"ok": True, "message": f"{o['host']}:{o['port']} bisa dijangkau ({what}). Login belum dites."}
        return {"ok": False, "message": "Jenis perangkat tidak dikenal."}
    except Exception as e:
        return {"ok": False, "message": _err(e)}
