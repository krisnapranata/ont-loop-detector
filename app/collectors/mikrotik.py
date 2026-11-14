"""Baca status loop-protect, log, ARP dan jumlah user hotspot dari RouterOS lewat SSH (hanya `print`)."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..config import Config
from ..util import norm_mac


@dataclass
class Vlan:
    name: str
    vlan_id: int = 0
    mac: str = ""
    loop_protect: str = ""
    lp_status: str = ""  # on | off | disabled  ("disabled" = sedang DIBLOKIR loop-protect)
    running: bool = False
    disabled: bool = False

    @property
    def blocked(self) -> bool:
        return self.lp_status == "disabled"


@dataclass
class LoopLog:
    time: str
    iface: str  # interface yang MENERIMA frame loop (ini yang bisa dipercaya)
    src_mac: str


@dataclass
class RouterData:
    vlans: list[Vlan] = field(default_factory=list)
    loop_logs: list[LoopLog] = field(default_factory=list)
    arp: dict[str, str] = field(default_factory=dict)  # ip -> mac
    hotspot_active: int | None = None


# ---------------------------------------------------------------- parser

_REC_START = re.compile(r"^\s*(\d+)\s+([A-Za-z]{0,6})(?=\s|$)(.*)$")
_KV = re.compile(r'([A-Za-z][\w-]*)=("(?:[^"\\]|\\.)*"|\S*)')


def parse_detail(text: str) -> list[dict[str, str]]:
    """Parser umum keluaran `print detail` RouterOS: daftar record berisi key=value.
    Flag (X, R, D, ...) disimpan di key '_flags'."""
    recs: list[dict[str, str]] = []
    cur: dict[str, str] | None = None
    for line in (text or "").splitlines():
        if line.startswith("Flags:") or not line.strip():
            continue
        m = _REC_START.match(line)
        body = line
        if m and ("=" in m.group(3) or ";;;" in m.group(3) or not m.group(3).strip()):
            cur = {"_flags": m.group(2)}
            recs.append(cur)
            body = m.group(3)
        if cur is None or ";;;" in body:
            continue
        for k, v in _KV.findall(body):
            if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
                v = v[1:-1]
            cur[k] = v
    return recs


def parse_vlans(text: str) -> list[Vlan]:
    out = []
    for r in parse_detail(text):
        if "name" not in r:
            continue
        flags = r.get("_flags", "")
        out.append(
            Vlan(
                name=r["name"],
                vlan_id=int(r.get("vlan-id") or 0),
                mac=norm_mac(r.get("mac-address")),
                loop_protect=r.get("loop-protect", ""),
                lp_status=r.get("loop-protect-status", ""),
                running="R" in flags,
                disabled="X" in flags,
            )
        )
    return out


_LOOP = re.compile(
    r"^\s*(.*?)\s+interface,warning\s+(\S+)\s+received loop protect packet originated from\s+([0-9A-Fa-f:]{17})"
)


def parse_loop_logs(text: str) -> list[LoopLog]:
    out = []
    for line in (text or "").splitlines():
        m = _LOOP.match(line)
        if m:
            out.append(LoopLog(time=m.group(1).strip(), iface=m.group(2), src_mac=norm_mac(m.group(3))))
    return out


def parse_arp(text: str) -> dict[str, str]:
    out = {}
    for r in parse_detail(text):
        mac = norm_mac(r.get("mac-address"))
        if r.get("address") and mac:
            out[r["address"]] = mac
    return out


def parse_count(text: str) -> int | None:
    m = re.search(r"^\s*(\d+)\s*$", text or "", re.M)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------- transport


def fetch(cfg: Config, timeout: float = 15.0) -> RouterData:
    import paramiko

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    # sufiks "+cte" mematikan warna & deteksi terminal RouterOS agar keluaran bersih
    c.connect(
        cfg.mikrotik_host,
        cfg.mikrotik_port,
        cfg.mikrotik_user + "+cte",
        cfg.mikrotik_password,
        timeout=timeout,
        banner_timeout=timeout,
        auth_timeout=timeout,
        look_for_keys=False,
        allow_agent=False,
    )

    def run(cmd: str) -> str:
        if " print" not in cmd:
            raise ValueError("hanya perintah print yang diizinkan")
        _, out, _ = c.exec_command(cmd, timeout=40)
        return out.read().decode(errors="replace")

    try:
        data = RouterData(
            vlans=parse_vlans(run("/interface vlan print detail without-paging")),
            loop_logs=parse_loop_logs(run('/log print without-paging where message~"loop protect"')),
            arp=parse_arp(
                run(f'/ip arp print detail without-paging where interface="{cfg.tr069_interface}"')
            ),
            hotspot_active=parse_count(run("/ip hotspot active print count-only")),
        )
    finally:
        c.close()
    return data
