"""Mesin skor: menggabungkan data GenieACS, switch dan router menjadi daftar ONT tersangka.

Fungsi di sini murni (tanpa I/O) supaya mudah dites dengan data rekaman.
"""
from __future__ import annotations

import time
from collections import defaultdict

from .collectors.cisco import SwitchData
from .collectors.genieacs import Ont
from .collectors.mikrotik import RouterData
from .config import Config
from .util import is_random_mac, mac_add, oui

LEVEL_STRONG, LEVEL_RISK, LEVEL_NORMAL = "kuat", "berisiko", "normal"


def _trunk_of(ont: Ont, cfg: Config, switch: SwitchData | None, router: RouterData | None) -> str:
    """Trunk OLT tempat ONT berada: IP TR069 -> MAC (ARP router) -> port (tabel MAC switch)."""
    if not switch:
        return ""
    table = switch.mac_ports.get(cfg.tr069_vlan, {})
    cands = []
    if router and ont.tr069_ip:
        cands.append(router.arp.get(ont.tr069_ip, ""))
    if ont.pon_mac:
        cands += [mac_add(ont.pon_mac, 1), ont.pon_mac, mac_add(ont.pon_mac, 2)]
    for m in cands:
        if m and m in table:
            return table[m]
    return ""


def analyze(
    cfg: Config,
    onts: list[Ont] | None,
    switch: SwitchData | None,
    router: RouterData | None,
    now: float | None = None,
) -> dict:
    onts = onts or []
    now = now or time.time()
    trunks = set(cfg.olt_trunks)

    # ---------------------------------------------------------- MAC flapping
    events: dict[str, int] = defaultdict(int)
    ports: dict[str, set[str]] = defaultdict(set)
    flap_events_total = 0
    for ev in switch.flaps if switch else []:
        if ev.age_sec > cfg.flap_window_sec:
            continue
        flap_events_total += 1
        events[ev.mac] += 1
        ports[ev.mac].update((ev.port_a, ev.port_b))
    router_macs = {v.mac for v in (router.vlans if router else []) if v.mac}
    router_mac_flapping = sorted(m for m in events if m in router_macs)
    flapping = {m: n for m, n in events.items() if n >= cfg.flap_min_events and m not in router_macs}

    # ---------------------------------------------------------- status loop
    blocked = [v.name for v in (router.vlans if router else []) if v.blocked]
    loop_reasons = []
    if blocked:
        loop_reasons.append("Loop-protect router memblokir: " + ", ".join(blocked))
    if router_mac_flapping:
        loop_reasons.append("MAC router sendiri kembali lewat trunk OLT (frame berputar)")
    if len(flapping) >= cfg.loop_min_flapping_macs:
        loop_reasons.append(f"{len(flapping)} MAC terus berpindah antar-port di switch")
    loop_active = bool(loop_reasons)

    # ---------------------------------------------------------- per ONT
    hotspot_table = switch.mac_ports.get(cfg.hotspot_vlan, {}) if switch else {}
    seen_on: dict[str, set[str]] = defaultdict(set)
    vendor_by_oui: dict[str, str] = {}
    for o in onts:
        for h in o.hosts:
            seen_on[h.mac].add(o.id)
        if o.vendor:
            for m in (o.pon_mac, router.arp.get(o.tr069_ip, "") if router else ""):
                if m:
                    vendor_by_oui.setdefault(oui(m), o.vendor)

    suspects = []
    for o in onts:
        trunk = _trunk_of(o, cfg, switch, router)
        reasons, score, flagged = [], 0, {}

        def flag(mac: str, f: str) -> None:
            flagged.setdefault(mac, set()).add(f)

        eth_hot = [h for h in o.hosts if cfg.is_hotspot_ip(h.ip) and h.iface.lower().startswith("eth")]
        flap_eth = [h for h in o.hosts if h.mac in flapping and h.iface.lower().startswith("eth")]
        flap_wifi = [h for h in o.hosts if h.mac in flapping and not h.iface.lower().startswith("eth")]

        if flap_eth:
            pts = min(60, 40 + 10 * (len(flap_eth) - 1))
            score += pts
            reasons.append(
                {
                    "code": "flap_lan",
                    "points": pts,
                    "text": f"{len(flap_eth)} perangkat di port LAN ONT ini sedang berpindah-pindah port di switch",
                }
            )
            for h in flap_eth:
                flag(h.mac, "flap")
        if flap_wifi:
            score += 15
            reasons.append(
                {
                    "code": "flap_wifi",
                    "points": 15,
                    "text": f"{len(flap_wifi)} klien Wi-Fi ONT ini ikut berpindah-pindah (kemungkinan ujung lain dari sambungan)",
                }
            )
            for h in flap_wifi:
                flag(h.mac, "flap")
        if eth_hot:
            score += 30
            reasons.append(
                {
                    "code": "hotspot_lan",
                    "points": 30,
                    "text": f"{len(eth_hot)} klien hotspot terlihat lewat port LAN (ada AP/repeater/switch tercolok dan ter-bridge ke hotspot)",
                }
            )
            for h in eth_hot:
                flag(h.mac, "hotspot_lan")
        cross = [
            h
            for h in o.hosts
            if trunk
            # hanya host di port LAN atau yang sedang flapping; klien Wi-Fi yang roaming wajar muncul di trunk lain
            and (h.mac in flapping or (cfg.is_hotspot_ip(h.ip) and h.iface.lower().startswith("eth")))
            and hotspot_table.get(h.mac) in trunks
            and hotspot_table.get(h.mac) != trunk
        ]
        if cross:
            score += 20
            reasons.append(
                {
                    "code": "cross_trunk",
                    "points": 20,
                    "text": f"{len(cross)} host ONT ini tercatat di switch pada trunk OLT lain ({', '.join(sorted({hotspot_table[h.mac] for h in cross}))})",
                }
            )
            for h in cross:
                flag(h.mac, "cross")
        multi = [h for h in o.hosts if h.iface.lower().startswith("eth") and len(seen_on[h.mac]) > 1]
        if multi:
            score += 15
            reasons.append(
                {
                    "code": "multi_ont",
                    "points": 15,
                    "text": f"{len(multi)} perangkat di port LAN juga muncul di ONT lain",
                }
            )
            for h in multi:
                flag(h.mac, "multi")
        if score and o.uptime_hours is not None and o.uptime_hours < cfg.recent_reboot_hours:
            score += 10
            reasons.append(
                {
                    "code": "reboot",
                    "points": 10,
                    "text": f"ONT baru menyala {o.uptime_hours:.1f} jam yang lalu",
                }
            )
        if not score:
            continue
        score = min(100, score)
        # "kuat" hanya bila ada bukti loop sedang terjadi lewat ONT ini (perangkat di port LAN-nya flapping);
        # tanpa itu paling tinggi "berisiko", berapa pun skornya.
        has_proof = any(r["code"] == "flap_lan" for r in reasons)
        if score >= cfg.score_strong and has_proof:
            level = LEVEL_STRONG
        elif score >= cfg.score_risk:
            level = LEVEL_RISK
        else:
            level = LEVEL_NORMAL
        suspects.append(
            {
                "id": o.id,
                "serial": o.serial,
                "model": o.model,
                "vendor": o.vendor,
                "label": o.label,
                "pppoe": o.pppoe,
                "tags": o.tags,
                "tr069_ip": o.tr069_ip,
                "trunk": trunk,
                "uptime_hours": o.uptime_hours,
                "last_inform": o.last_inform,
                "score": score,
                "level": level,
                "reasons": reasons,
                "hosts": [
                    {
                        "mac": h.mac,
                        "ip": h.ip,
                        "name": h.name,
                        "iface": h.iface,
                        "port": hotspot_table.get(h.mac, ""),
                        "flags": sorted(flagged.get(h.mac, ())),
                    }
                    for h in o.hosts
                ],
            }
        )
    suspects.sort(key=lambda s: (-s["score"], s["serial"]))

    # ---------------------------------------------------------- daftar MAC flapping
    by_id = {o.id: o for o in onts}
    flap_list = []
    for m, n in sorted(flapping.items(), key=lambda kv: -kv[1]):
        owners = sorted(by_id[i].serial for i in seen_on.get(m, ()) if i in by_id)
        if owners:
            kind = "host ONT"
        elif oui(m) in vendor_by_oui:
            kind = f"perangkat {vendor_by_oui[oui(m)]} (bukan ONT terdaftar)"
        elif is_random_mac(m):
            kind = "MAC acak (HP/laptop)"
        else:
            kind = "tidak dikenal"
        flap_list.append({"mac": m, "events": n, "ports": sorted(ports[m]), "kind": kind, "onts": owners})

    strong = sum(1 for s in suspects if s["level"] == LEVEL_STRONG)
    risk = sum(1 for s in suspects if s["level"] == LEVEL_RISK)
    return {
        "ts": int(now),
        "loop": {
            "active": loop_active,
            "reasons": loop_reasons,
            "blocked_vlans": blocked,
            "router_mac_flapping": bool(router_mac_flapping),
        },
        "counts": {
            "strong": strong,
            "risk": risk,
            "flapping_macs": len(flapping),
            "flap_events": flap_events_total,
            "hotspot_active": router.hotspot_active if router else None,
            "total_onts": len(onts),
            "no_host_data": sum(1 for o in onts if not o.has_host_data),
        },
        "suspects": suspects,
        "flapping": flap_list,
        "vlans": [
            {"name": v.name, "vlan_id": v.vlan_id, "lp_status": v.lp_status, "running": v.running, "blocked": v.blocked}
            for v in (router.vlans if router else [])
            if v.loop_protect == "on" or v.blocked
        ],
        "loop_logs": [
            {"time": l.time, "iface": l.iface, "src_mac": l.src_mac} for l in (router.loop_logs if router else [])[-10:]
        ],
    }
