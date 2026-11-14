"""Baca daftar ONT beserta tabel host-nya dari GenieACS (NBI, hanya GET)."""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from ..config import Config
from ..util import norm_mac, parse_uptime_hours

PROJECTION = ",".join(
    [
        "_id",
        "_lastInform",
        "_tags",
        "_deviceId",
        "VirtualParameters.IPTR069",
        "VirtualParameters.PonMac",
        "VirtualParameters.pppoeUsername",
        "VirtualParameters.getdeviceuptime",
        "VirtualParameters.RXPower",
        "InternetGatewayDevice.LANDevice.1.Hosts.Host",
    ]
)


@dataclass
class Host:
    mac: str
    ip: str = ""
    name: str = ""
    iface: str = ""  # "Ethernet" | "802.11" | ""
    seen: str = ""  # timestamp ACS terakhir membaca entri ini


@dataclass
class Ont:
    id: str
    serial: str = ""
    model: str = ""
    vendor: str = ""
    tr069_ip: str = ""
    pon_mac: str = ""
    pppoe: str = ""
    tags: list[str] = field(default_factory=list)
    uptime_hours: float | None = None
    rx_power: str = ""
    last_inform: str = ""
    hosts: list[Host] = field(default_factory=list)
    has_host_data: bool = False

    @property
    def label(self) -> str:
        return self.pppoe or (", ".join(self.tags) if self.tags else "") or self.serial


def _val(obj: dict, key: str):
    x = obj.get(key) if isinstance(obj, dict) else None
    if isinstance(x, dict):
        return x.get("_value")
    return None


def parse_devices(devices: list[dict]) -> list[Ont]:
    out: list[Ont] = []
    for d in devices:
        did = d.get("_id", "")
        parts = did.split("-", 2)
        ident = d.get("_deviceId") or {}
        vp = d.get("VirtualParameters") or {}
        ont = Ont(
            id=did,
            serial=ident.get("_SerialNumber") or (parts[2] if len(parts) == 3 else did),
            model=ident.get("_ProductClass") or (parts[1] if len(parts) == 3 else ""),
            vendor=ident.get("_Manufacturer") or "",
            tr069_ip=str(_val(vp, "IPTR069") or ""),
            pon_mac=norm_mac(_val(vp, "PonMac")),
            pppoe=str(_val(vp, "pppoeUsername") or ""),
            tags=list(d.get("_tags") or []),
            uptime_hours=parse_uptime_hours(_val(vp, "getdeviceuptime")),
            rx_power=str(_val(vp, "RXPower") or ""),
            last_inform=d.get("_lastInform") or "",
        )
        hosts = (
            (d.get("InternetGatewayDevice") or {})
            .get("LANDevice", {})
            .get("1", {})
            .get("Hosts", {})
            .get("Host", {})
        )
        for idx, h in (hosts or {}).items():
            if idx.startswith("_") or not isinstance(h, dict):
                continue
            mac = norm_mac(_val(h, "MACAddress"))
            if not mac:
                continue
            ont.hosts.append(
                Host(
                    mac=mac,
                    ip=str(_val(h, "IPAddress") or ""),
                    name=str(_val(h, "HostName") or ""),
                    iface=str(_val(h, "InterfaceType") or ""),
                    seen=(h.get("MACAddress") or {}).get("_timestamp") or "",
                )
            )
        ont.has_host_data = bool(ont.hosts)
        out.append(ont)
    return out


def fetch(cfg: Config, timeout: float = 90.0) -> list[Ont]:
    auth = (cfg.genieacs_user, cfg.genieacs_password) if cfg.genieacs_user else None
    url = cfg.genieacs_url.rstrip("/") + "/devices/"
    with httpx.Client(timeout=timeout, auth=auth) as c:
        r = c.get(url, params={"projection": PROJECTION})
        r.raise_for_status()
        return parse_devices(r.json())
