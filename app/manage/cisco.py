"""Kelola switch Cisco IOS: status port, log, running-config, dan aksi port terbatas.

Aksi yang mengubah switch hanya: shutdown / no shutdown port, ubah deskripsi port, dan
`write memory`. Tidak ada perintah bebas dari browser.
"""
from __future__ import annotations

import logging
import re

from ..collectors.cisco import PROMPT, CiscoSession
from ..config import Config
from . import ManageError

log = logging.getLogger("manage.cisco")

_PORT = re.compile(r"^[A-Za-z]{2,}[A-Za-z0-9/.\-]{1,30}$")
_DESC = re.compile(r"^[A-Za-z0-9 _.\-/:+()@,]{0,64}$")  # tanpa '?' (bantuan interaktif IOS) dan '#' (mirip prompt)
_IOS_ERR = re.compile(r"^\s*%\s*(.+)$", re.M)
_SECRET = re.compile(r"^(.*\b(?:password|secret|key-string|key|community)\b(?:\s+\d)?\s+)(\S.*)$", re.I)
HIDDEN = "<disembunyikan>"


# ---------------------------------------------------------------- fungsi murni


def parse_interfaces_status(text: str) -> list[dict]:
    """Keluaran `show interfaces status`. Kolom Port/Name/Status rata kiri mengikuti judul;
    Duplex dan Speed rata kanan, jadi sisanya dipecah berdasarkan spasi."""
    lines = (text or "").replace("\r", "").splitlines()
    out: list[dict] = []
    head = None
    for line in lines:
        if head is None:
            if line.startswith("Port") and "Status" in line and "Vlan" in line:
                head = (line.index("Name"), line.index("Status"), line.index("Vlan"))
            continue
        port = line[: head[0]].strip()
        if not port or not _PORT.match(port) or len(line) <= head[1]:
            continue
        rest = line[head[2]:].split(None, 3) + ["", "", "", ""]
        out.append({"port": port, "name": line[head[0]: head[1]].strip(), "status": line[head[1]: head[2]].strip(),
                    "vlan": rest[0], "duplex": rest[1], "speed": rest[2], "type": rest[3].strip()})
    return out


def mask_config(text: str) -> str:
    """Sembunyikan password, secret, key, dan community di running-config."""
    out = []
    for line in (text or "").replace("\r", "").splitlines():
        m = _SECRET.match(line)
        out.append(m.group(1) + HIDDEN if m else line)
    return "\n".join(out)


def clean(out: str) -> str:
    """Buang gema perintah di baris pertama dan prompt di baris terakhir."""
    lines = (out or "").replace("\r", "").split("\n")
    if lines and re.search(PROMPT, lines[-1]):
        lines = lines[:-1]
    return "\n".join(lines[1:]).strip("\n")


def build_config(action: str, port: str, text: str, known_ports: set[str]) -> list[str]:
    """Baris konfigurasi untuk satu aksi port. `port` harus ada di daftar yang baru dibaca dari switch."""
    if not _PORT.match(port or "") or port not in known_ports:
        raise ManageError("Port tidak ada di switch. Muat ulang daftar port lalu coba lagi.")
    if action == "shutdown":
        return [f"interface {port}", "shutdown"]
    if action == "no_shutdown":
        return [f"interface {port}", "no shutdown"]
    if action == "description":
        text = str(text or "").strip()
        if not _DESC.match(text):
            raise ManageError("Deskripsi maksimal 64 karakter: huruf, angka, spasi, dan tanda . _ - / : + ( ) @ ,")
        return [f"interface {port}", f"description {text}" if text else "no description"]
    raise ManageError("Aksi tidak dikenal.")


# ---------------------------------------------------------------- sesi


class _Session(CiscoSession):
    """Sesi yang boleh masuk mode konfigurasi. `run` milik collector tetap hanya menerima `show`."""

    def _exec(self, cmd: str, timeout: float = 20) -> str:
        self._send(cmd)
        out = self._read(timeout, PROMPT)
        m = _IOS_ERR.search(clean(out))
        if m:
            raise ManageError(f"Switch menolak perintah: {m.group(1).strip()[:160]}")
        return out

    def configure(self, lines: list[str]) -> None:
        self._exec("configure terminal")
        try:
            for line in lines:
                self._exec(line)
        finally:
            self._send("end")
            self._read(10, PROMPT)


def _open(cfg: Config) -> _Session:
    if not cfg.cisco_host:
        raise ManageError("Host switch belum diisi. Isi di tab Koneksi.")
    return _Session(cfg)


def ports(cfg: Config) -> list[dict]:
    s = _open(cfg)
    try:
        return parse_interfaces_status(s.run("show interfaces status"))
    finally:
        s.close()


def logs(cfg: Config, limit: int = 200) -> list[str]:
    s = _open(cfg)
    try:
        return clean(s.run("show logging")).splitlines()[-limit:]
    finally:
        s.close()


def running_config(cfg: Config) -> str:
    s = _open(cfg)
    try:
        return mask_config(clean(s.run("show running-config")))
    finally:
        s.close()


def apply(cfg: Config, action: str, port: str = "", text: str = "") -> str:
    s = _open(cfg)
    try:
        if action == "save":
            s._exec("write memory", timeout=60)
            log.info("write memory di %s", cfg.cisco_host)
            return "Konfigurasi berjalan disimpan ke startup-config."
        known = {p["port"] for p in parse_interfaces_status(s.run("show interfaces status"))}
        lines = build_config(action, port, text, known)
        s.configure(lines)
        log.info("konfigurasi %s: %s", cfg.cisco_host, " ; ".join(lines))
    finally:
        s.close()
    what = {"shutdown": "dimatikan", "no_shutdown": "dinyalakan", "description": "diberi deskripsi baru"}[action]
    return f"Port {port} {what}. Perubahan belum disimpan ke startup-config."
