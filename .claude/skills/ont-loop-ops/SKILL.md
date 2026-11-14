---
name: ont-loop-ops
description: Menjalankan ONT Loop Detector dan membaca hasilnya - cek loop sekali jalan, mode replay, menafsirkan skor dan tingkat ONT, memakai tab GenieACS/Switch/MikroTik, serta mencari sebab sumber data gagal dibaca. Pakai saat pengguna bertanya "ada loop tidak", "ONT mana penyebabnya", "kenapa switch/router/ACS merah", "jalankan aplikasinya", atau menyebut loop, MAC flapping, loop-protect, hotspot putus (check loop, run app, troubleshoot).
---

# Operasional ONT Loop Detector

Semua perintah dijalankan dari akar repo dengan interpreter venv (`.venv/bin/python`). Jawab pengguna
dalam bahasa Indonesia.

## Pilih cara menjalankan

| Kebutuhan | Perintah |
|---|---|
| Jawaban cepat "ada loop atau tidak" dari perangkat sungguhan | `.venv/bin/python -m app.main --check` |
| Melihat aplikasi tanpa menyentuh perangkat | `WEB_PASSWORD=rahasia .venv/bin/python -m app.main --replay tests/fixtures --host 127.0.0.1 --port 8088` |
| Cek sekali dari data rekaman | `.venv/bin/python -m app.main --replay tests/fixtures --check` |
| Dashboard dengan perangkat sungguhan | `WEB_PASSWORD=... .venv/bin/python -m app.main --host 0.0.0.0 --port 8989` |

Aturan:

- Jalankan **satu proses saja**. Penjadwal hidup di dalam proses web; dua proses berarti dua kali login
  ke switch dan notifikasi Telegram ganda. Sebelum menjalankan, periksa apakah sudah ada yang berjalan
  (`systemctl status ont-loop-detector`, `docker compose ps`, atau `pgrep -af app.main`).
- `--check` terhadap perangkat sungguhan membuka sesi Telnet/SSH ke switch dan router. Itu hanya
  membaca, tetapi tetap beri tahu pengguna sebelum melakukannya di jaringan produksi.
- Jangan pernah menampilkan isi `.env` atau `data/settings.json`; keduanya berisi password perangkat.
- Di produksi, baca log dengan `journalctl -u ont-loop-detector -n 100` atau `docker compose logs --tail 100`.
  Rincian pemasangan ada di `docs/PRODUKSI.md`. Server Windows: jalankan di Ubuntu WSL2 (bagian
  "Cara C"); GenieACS sebaiknya tetap di Linux, jangan native Windows.

## Membaca keluaran `--check`

```
STATUS : LOOP AKTIF | normal | TIDAK DIKETAHUI (switch dan router tidak terbaca)
SKOR  TINGKAT   SERIAL   TRUNK   TR069   PELANGGAN / ALASAN
```

- **TIDAK DIKETAHUI** bukan "normal". Artinya switch dan router dua-duanya gagal dibaca; perbaiki
  sumber data dulu (lihat tabel di bawah) sebelum menyimpulkan apa pun.
- **kuat**: skor melewati ambang *dan* ada perangkat di port LAN ONT itu yang benar-benar berpindah-pindah
  port di switch. Ini ONT yang diperiksa pertama: cabut perangkat yang tercolok di port LAN-nya.
- **berisiko**: ada pola yang bisa menimbulkan loop (misalnya klien hotspot masuk lewat port LAN), tetapi
  belum ada bukti flapping. Tanpa bukti itu sebuah ONT tidak akan pernah naik ke `kuat`, berapa pun skornya.
- Satu MAC yang pindah port sekali adalah roaming WiFi biasa, bukan flapping.
- Router MikroTik menyalakan lagi VLAN yang diblokir tiap beberapa menit, jadi user hotspot bisa muncul
  sebentar lalu hilang lagi selama loop. Loop baru dianggap selesai setelah beberapa pemeriksaan bersih.
- Nama VLAN dalam kurung di log "received loop protect packet" sengaja diabaikan; yang dipercaya hanya
  interface penerimanya.

Saat melapor ke pengguna: sebut status, lalu ONT `kuat` (serial, trunk, pelanggan) beserta alasannya, lalu
jumlah ONT berisiko. Jangan menyebut ONT sebagai penyebab bila tingkatnya bukan `kuat`.

## Sumber data gagal dibaca

Baris `PERINGATAN: sumber ... gagal dibaca` atau titik merah di dashboard. Cara tercepat memastikan:
buka tab perangkat itu di web, bagian **Koneksi**, lalu **Tes koneksi**.

| Gejala | Kemungkinan sebab | Yang diperiksa |
|---|---|---|
| timeout / host tidak terjangkau | jalur jaringan, firewall, alamat salah | `ping` dan port dari server aplikasi |
| koneksi ditolak | layanan mati atau port salah (Telnet 23, SSH 22, NBI GenieACS 7557) | port di tab Koneksi |
| login ditolak | username/password salah | isi ulang password di tab Koneksi |
| `enable di switch gagal` | password enable salah atau kosong | kolom Password enable |
| switch terbaca tetapi tidak ada flapping saat loop jelas terjadi | switch tidak mencatat `MACFLAP_NOTIF` | `show logging | include MACFLAP` di switch |
| user hotspot "tidak terbaca" | user router tidak punya hak baca hotspot | grup user di MikroTik |
| GenieACS (pemantauan) kode 401/404 | di bagian NBI terisi port UI (3000), bukan NBI (7557) | GenieACS › Koneksi › NBI |
| Menu GenieACS: "Konfigurasi tampilan GenieACS tidak terbaca" | di bagian UI terisi alamat NBI (7557) | GenieACS › Koneksi › UI GenieACS |
| Menu GenieACS: "Login ke UI GenieACS ditolak" / "tidak punya izin" | akun UI salah, atau role-nya tidak punya permission | GenieACS › Admin › Permissions |

Nilai yang disimpan dari web (`data/settings.json`) **menimpa** `.env`. Bila mengubah `.env` tidak
berpengaruh, itulah sebabnya.

## Tab kelola perangkat

Tab GenieACS, Switch, dan MikroTik bisa **mengubah perangkat**. Skill ini tidak boleh memanggil API
aksinya (`POST /api/acs/tasks`, `/api/acs/put`, `/api/acs/delete`, `/api/acs/tags`, `/api/acs/password`,
`/api/acs/files/upload`, `/api/switch/action`, `/api/mikrotik/action`) atas inisiatif sendiri.
Lakukan hanya bila pengguna meminta aksi itu secara spesifik untuk perangkat yang ia sebut, dan
konfirmasi dulu untuk reboot, reset pabrik, mematikan port, dan menonaktifkan interface. Di mode replay
semua aksi ditolak, jadi aman untuk mencoba tampilannya.
