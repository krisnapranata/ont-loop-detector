"""Mode replay: memakai data rekaman (fixture) sebagai pengganti perangkat sungguhan."""
from __future__ import annotations

import json
from pathlib import Path

from .collectors import cisco, genieacs, mikrotik


def load(folder: str | Path):
    """Kembalikan (onts, switch, router) dari folder fixture."""
    d = Path(folder)
    rd = lambda n: (d / n).read_text(encoding="utf-8") if (d / n).is_file() else ""
    onts = genieacs.parse_devices(json.loads(rd("genieacs_devices.json") or "[]"))
    switch = cisco.SwitchData(
        flaps=cisco.parse_flaps(rd("cisco_logging.txt"), cisco.parse_clock(rd("cisco_clock.txt"))),
        mac_ports=cisco.parse_mac_table(rd("cisco_mac_vlan200.txt") + "\n" + rd("cisco_mac_vlan100.txt")),
    )
    router = mikrotik.RouterData(
        vlans=mikrotik.parse_vlans(rd("mikrotik_vlan.txt")),
        loop_logs=mikrotik.parse_loop_logs(rd("mikrotik_log.txt")),
        arp=mikrotik.parse_arp(rd("mikrotik_arp.txt")),
        hotspot_active=mikrotik.parse_count(rd("mikrotik_hotspot_active.txt")),
    )
    return onts, switch, router
