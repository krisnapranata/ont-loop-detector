"""Konfigurasi aplikasi: dibaca dari file .env lalu ditimpa oleh environment variable."""
from __future__ import annotations

import ipaddress
import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def _csv(v: str) -> list[str]:
    return [x.strip() for x in v.split(",") if x.strip()]


@dataclass
class Config:
    # GenieACS
    genieacs_url: str = "http://127.0.0.1:7557"
    genieacs_user: str = ""
    genieacs_password: str = ""
    # Switch Cisco
    cisco_host: str = ""
    cisco_port: int = 23
    cisco_transport: str = "telnet"  # telnet | ssh
    cisco_user: str = ""
    cisco_password: str = ""
    cisco_enable_password: str = ""
    # Router MikroTik
    mikrotik_host: str = ""
    mikrotik_port: int = 22
    mikrotik_user: str = ""
    mikrotik_password: str = ""
    # Topologi
    hotspot_subnets: list[str] = field(default_factory=lambda: ["10.8.0.0/20"])
    hotspot_vlan: int = 200
    tr069_vlan: int = 100
    tr069_interface: str = "vlan100-MNG-TR069"
    olt_trunks: list[str] = field(default_factory=lambda: ["Gi1/0/47", "Gi1/0/48"])
    # Ambang deteksi
    flap_window_sec: int = 180
    flap_min_events: int = 3
    loop_min_flapping_macs: int = 3
    recent_reboot_hours: float = 6.0
    score_strong: int = 60
    score_risk: int = 30
    # Jadwal
    fast_interval_sec: int = 30
    acs_interval_sec: int = 300
    retention_days: int = 14
    # Telegram
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    telegram_cooldown_min: int = 15
    # Web
    web_host: str = "0.0.0.0"
    web_port: int = 8088
    web_user: str = "admin"
    web_password: str = ""
    db_path: str = str(ROOT / "data" / "loopdetector.db")

    @property
    def hotspot_networks(self) -> list[ipaddress.IPv4Network]:
        return [ipaddress.ip_network(s, strict=False) for s in self.hotspot_subnets]

    def is_hotspot_ip(self, ip: str) -> bool:
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            return False
        return any(a in n for n in self.hotspot_networks)


def load(env_file: str | os.PathLike | None = None) -> Config:
    values = _load_env_file(Path(env_file) if env_file else ROOT / ".env")
    values.update({k: v for k, v in os.environ.items() if k.isupper()})
    cfg = Config()
    for name, default in list(cfg.__dict__.items()):
        raw = values.get(name.upper())
        if raw is None or raw == "":
            continue
        if isinstance(default, bool):
            val = raw.lower() in ("1", "true", "yes", "on")
        elif isinstance(default, int):
            val = int(raw)
        elif isinstance(default, float):
            val = float(raw)
        elif isinstance(default, list):
            val = _csv(raw)
        else:
            val = raw
        setattr(cfg, name, val)
    return cfg
