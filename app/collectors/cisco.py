"""Baca log MAC flapping dan tabel MAC dari switch Cisco IOS (hanya perintah `show`)."""
from __future__ import annotations

import re
import socket
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from ..config import Config
from ..util import norm_mac

IAC, DONT, DO, WONT, WILL, SB, SE = 255, 254, 253, 252, 251, 250, 240
PROMPT = r"[>#]\s*$"
_MONTHS = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


@dataclass
class FlapEvent:
    mac: str
    vlan: int
    port_a: str
    port_b: str
    age_sec: float  # umur kejadian dibanding jam switch saat dibaca


@dataclass
class SwitchData:
    flaps: list[FlapEvent] = field(default_factory=list)
    mac_ports: dict[int, dict[str, str]] = field(default_factory=dict)  # vlan -> {mac: port}


# ---------------------------------------------------------------- parser

_CLOCK = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?\s+\S+\s+\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{4})")
_FLAP = re.compile(
    r"(\w{3})\s+(\d{1,2})\s+(?:(\d{4})\s+)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?.*?MACFLAP_NOTIF: Host\s+(\S+)\s+in vlan\s+(\d+)"
    r"\s+is flapping between port\s+(\S+)\s+and port\s+(\S+)"
)
_MACROW = re.compile(r"^\s*(\d+)\s+([0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4})\s+\w+\s+(\S+)", re.M)


def parse_clock(text: str) -> datetime | None:
    """'22:44:18.837 UTC Tue Feb 19 2002' -> datetime (jam switch, apa adanya)."""
    m = _CLOCK.search(text or "")
    if not m or m.group(4) not in _MONTHS:
        return None
    h, mi, s, mon, day, year = m.groups()
    return datetime(int(year), _MONTHS[mon], int(day), int(h), int(mi), int(s))


def parse_flaps(log_text: str, now: datetime | None) -> list[FlapEvent]:
    """Ambil kejadian MACFLAP. Umur dihitung terhadap jam switch (`now`), bukan jam server,
    karena jam switch sering tidak disetel."""
    out: list[FlapEvent] = []
    for line in (log_text or "").splitlines():
        m = _FLAP.search(line)
        if not m:
            continue
        mon, day, year, h, mi, s, mac, vlan, pa, pb = m.groups()
        mac = norm_mac(mac)
        if not mac or mon not in _MONTHS:
            continue
        age = 0.0
        if now is not None:
            ts = datetime(int(year) if year else now.year, _MONTHS[mon], int(day), int(h), int(mi), int(s))
            if ts - now > timedelta(days=1):  # log lintas tahun baru
                ts = ts.replace(year=ts.year - 1)
            age = max(0.0, (now - ts).total_seconds())
        out.append(FlapEvent(mac=mac, vlan=int(vlan), port_a=pa, port_b=pb, age_sec=age))
    return out


def parse_mac_table(text: str) -> dict[int, dict[str, str]]:
    out: dict[int, dict[str, str]] = {}
    for vlan, mac, port in _MACROW.findall(text or ""):
        m = norm_mac(mac)
        if m and port.upper() != "CPU":
            out.setdefault(int(vlan), {})[m] = port
    return out


# ---------------------------------------------------------------- transport


class _Telnet:
    def __init__(self, host: str, port: int, timeout: float):
        self.s = socket.create_connection((host, port), timeout=timeout)

    def send(self, data: bytes) -> None:
        self.s.sendall(data)

    def recv(self, timeout: float) -> bytes:
        self.s.settimeout(timeout)
        d = self.s.recv(65536)
        clean, i = bytearray(), 0
        while i < len(d):
            b = d[i]
            if b == IAC and i + 1 < len(d):
                c = d[i + 1]
                if c in (DO, DONT) and i + 2 < len(d):
                    self.s.sendall(bytes([IAC, WONT, d[i + 2]]))
                    i += 3
                    continue
                if c in (WILL, WONT) and i + 2 < len(d):
                    self.s.sendall(bytes([IAC, DONT, d[i + 2]]))
                    i += 3
                    continue
                if c == SB:
                    j = d.find(bytes([IAC, SE]), i)
                    i = j + 2 if j != -1 else len(d)
                    continue
                i += 2
                continue
            clean.append(b)
            i += 1
        if not d:
            raise EOFError("koneksi ditutup switch")
        return bytes(clean)

    def close(self) -> None:
        self.s.close()


class _Ssh:
    def __init__(self, host: str, port: int, user: str, password: str, timeout: float):
        import paramiko

        self.c = paramiko.SSHClient()
        self.c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.c.connect(host, port, user, password, timeout=timeout, look_for_keys=False, allow_agent=False)
        self.ch = self.c.invoke_shell(width=250, height=1000)

    def send(self, data: bytes) -> None:
        self.ch.sendall(data)

    def recv(self, timeout: float) -> bytes:
        self.ch.settimeout(timeout)
        d = self.ch.recv(65536)
        if not d:
            raise EOFError("koneksi ditutup switch")
        return d

    def close(self) -> None:
        self.c.close()


class CiscoSession:
    """Sesi CLI sederhana: login, enable, lalu jalankan perintah `show`."""

    def __init__(self, cfg: Config, timeout: float = 15.0):
        self.cfg = cfg
        if cfg.cisco_transport.lower() == "ssh":
            self.t = _Ssh(cfg.cisco_host, cfg.cisco_port, cfg.cisco_user, cfg.cisco_password, timeout)
            buf = self._read(8, PROMPT)
        else:
            self.t = _Telnet(cfg.cisco_host, cfg.cisco_port, timeout)
            buf = self._read(8, r"(user ?name|login|password)\s*:\s*$")
            if re.search(r"(user ?name|login)\s*:\s*$", buf, re.I):
                self._send(cfg.cisco_user)
                buf = self._read(8, r"password\s*:\s*$")
            self._send(cfg.cisco_password)
            buf = self._read(8, PROMPT)
        if not re.search(PROMPT, buf):
            raise RuntimeError("login ke switch gagal (prompt tidak muncul)")
        if not buf.rstrip().endswith("#") and cfg.cisco_enable_password:
            self._send("enable")
            buf = self._read(6, r"password\s*:\s*$|" + PROMPT)
            if re.search(r"password\s*:\s*$", buf, re.I):
                self._send(cfg.cisco_enable_password)
                buf = self._read(6, PROMPT)
            if not buf.rstrip().endswith("#"):
                raise RuntimeError("enable di switch gagal")
        self.run("terminal length 0")

    def _send(self, line: str) -> None:
        self.t.send(line.encode() + b"\r\n")

    def _read(self, timeout: float, until: str) -> str:
        out = ""
        while True:
            try:
                out += self.t.recv(timeout).decode(errors="replace")
            except (socket.timeout, TimeoutError):
                break
            if re.search(until, out[-200:], re.I):
                break
        return out

    def run(self, cmd: str) -> str:
        if not cmd.startswith(("show ", "terminal length")):
            raise ValueError("hanya perintah show yang diizinkan")
        self._send(cmd)
        return self._read(20, PROMPT)

    def close(self) -> None:
        try:
            self.t.close()
        except Exception:
            pass


def fetch(cfg: Config) -> SwitchData:
    s = CiscoSession(cfg)
    try:
        now = parse_clock(s.run("show clock"))
        log = s.run("show logging | include MACFLAP")
        tables = s.run(f"show mac address-table vlan {cfg.hotspot_vlan}")
        tables += "\n" + s.run(f"show mac address-table vlan {cfg.tr069_vlan}")
    finally:
        s.close()
    return SwitchData(flaps=parse_flaps(log, now), mac_ports=parse_mac_table(tables))
