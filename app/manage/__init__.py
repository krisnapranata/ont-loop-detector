"""Pengelolaan perangkat dari halaman web (tab GenieACS, Switch, MikroTik).

Hanya paket ini yang boleh MENGUBAH perangkat. `app/collectors/` tetap hanya membaca dan
dipakai pemantauan berkala; paket ini dipanggil saat pengguna menekan tombol di halaman web.
Setiap perintah yang dikirim ke perangkat disusun dari masukan yang sudah divalidasi dan
dicocokkan dengan daftar yang baru dibaca dari perangkat (nama port, nama interface, path parameter).
"""
from __future__ import annotations


class ManageError(Exception):
    """Kesalahan yang pesannya aman dan layak ditampilkan langsung ke pengguna."""
