"""Fungsi bantu kecil yang dipakai bersama."""
from __future__ import annotations

import re

_HEX = re.compile(r"[^0-9a-f]")


def norm_mac(mac: str | None) -> str:
    """Ubah bentuk MAC apa pun (aa:bb.., aabb.ccdd.eeff, AA-BB-..) menjadi aa:bb:cc:dd:ee:ff."""
    h = _HEX.sub("", (mac or "").lower())
    if len(h) != 12 or h == "0" * 12:
        return ""
    return ":".join(h[i : i + 2] for i in range(0, 12, 2))


def mac_add(mac: str, delta: int) -> str:
    m = norm_mac(mac)
    if not m:
        return ""
    return norm_mac("%012x" % ((int(m.replace(":", ""), 16) + delta) % (1 << 48)))


def is_random_mac(mac: str) -> bool:
    """MAC 'locally administered' (bit kedua oktet pertama) = MAC acak HP/laptop."""
    m = norm_mac(mac)
    return bool(m) and bool(int(m[:2], 16) & 0x02)


def oui(mac: str) -> str:
    return norm_mac(mac)[:8]


_UPTIME = re.compile(r"(?:(\d+)\s*d\s*)?(\d+):(\d+):(\d+)")


def parse_uptime_hours(text: str | None) -> float | None:
    """'2d 20:57:32' atau '0d 01:30:31' -> jam (float)."""
    m = _UPTIME.search(text or "")
    if not m:
        return None
    d, h, mi, s = (int(x or 0) for x in m.groups())
    return d * 24 + h + mi / 60 + s / 3600
