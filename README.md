# ONT Loop Detector

Mencari ONT yang menjadi penyebab (atau berpotensi menjadi penyebab) loop di jaringan
FTTH + hotspot, dengan menggabungkan tiga sumber data:

| Sumber | Yang dibaca |
|---|---|
| **GenieACS** | tabel host tiap ONT (MAC, IP, lewat Ethernet atau Wi-Fi), uptime ONT |
| **Switch Cisco** | log `MACFLAP_NOTIF` dan tabel MAC |
| **Router MikroTik** | status loop-protect tiap VLAN, log loop-protect, ARP TR069, jumlah user hotspot |

Aplikasi ini **hanya membaca dan melapor**. Ia tidak mengubah ONT, switch, maupun router.
Di switch hanya perintah `show` yang dijalankan, di router hanya `print`, di GenieACS hanya `GET`.

## Cara kerja

Loop yang dicari: pelanggan mencolok AP/repeater/switch ke port LAN ONT, dan perangkat itu
juga tersambung ke jaringan hotspot lewat jalur lain (misalnya menangkap Wi-Fi hotspot dari ONT
lain). Frame lalu berputar antar-trunk OLT, MAC berpindah-pindah port di switch, dan
loop-protect router memblokir VLAN hotspot.

Setiap ONT diberi skor:

| Sinyal | Skor |
|---|---|
| Perangkat di port LAN ONT sedang berpindah-pindah port di switch | +40, +10 tiap perangkat tambahan (maks +60) |
| Klien Wi-Fi ONT ikut berpindah-pindah (kemungkinan ujung lain sambungan) | +15 |
| Klien ber-IP hotspot terlihat lewat port LAN | +30 |
| Host di port LAN tercatat di switch pada trunk OLT lain | +20 |
| Perangkat di port LAN juga muncul di ONT lain | +15 |
| ONT baru menyala (di bawah `RECENT_REBOOT_HOURS`) dan punya sinyal lain | +10 |

- **Tersangka kuat**: skor ≥ 60 **dan** ada perangkat di port LAN-nya yang sedang berpindah port.
- **Berisiko**: skor 30–59. Belum menimbulkan loop, tetapi punya perangkat di port LAN yang bisa memicunya.
- Satu kali pindah port dianggap roaming biasa; MAC baru dihitung bila pindah ≥ `FLAP_MIN_EVENTS` kali dalam `FLAP_WINDOW_SEC`.

Loop dianggap aktif bila ada VLAN yang diblokir loop-protect, atau MAC router sendiri kembali
lewat trunk OLT, atau ada ≥ `LOOP_MIN_FLAPPING_MACS` MAC yang terus berpindah.

### Batasan yang perlu diketahui

- ONT yang tidak melaporkan tabel host ke GenieACS **tidak bisa dinilai**. Jumlahnya ditampilkan di dashboard.
- Nama VLAN di dalam kurung pada log loop-protect MikroTik diabaikan, karena semua VLAN di satu
  port memakai MAC yang sama sehingga nama itu tidak menunjukkan sumber loop. Yang dipakai adalah
  interface yang *menerima* frame.
- Umur log switch dihitung terhadap jam switch sendiri (`show clock`), jadi jam switch yang salah tidak masalah.
- Buffer log bawaan Cisco kecil (4096 byte). Agar tidak ada kejadian terlewat, perbesar di switch,
  misalnya `logging buffered 65536`.
- Koneksi switch lewat telnet sudah diuji pada IOS 15.2; mode `ssh` ada tetapi belum diuji di perangkat nyata.

## Menjalankan di komputer pengembangan

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest                       # tes

# mode replay: memakai data rekaman, tidak menghubungi perangkat apa pun
WEB_PASSWORD=rahasia .venv/bin/python -m app.main --replay tests/fixtures --host 127.0.0.1
# buka http://127.0.0.1:8088  (user: admin)

# pemeriksaan sekali jalan di terminal
.venv/bin/python -m app.main --replay tests/fixtures --check
```

Data di `tests/fixtures/` adalah rekaman kejadian nyata yang sudah dianonimkan (serial, MAC, nama perangkat,
nama pelanggan diganti; password dibuang).

## Memasang di server GenieACS

```bash
sudo useradd --system --home /opt/ont-loop-detector --shell /usr/sbin/nologin ontloop
sudo git clone https://github.com/krisnapranata/ont-loop-detector.git /opt/ont-loop-detector
cd /opt/ont-loop-detector
sudo python3 -m venv .venv && sudo .venv/bin/pip install -r requirements.txt
sudo cp .env.example .env && sudo nano .env        # isi alamat & kredensial
sudo chown -R ontloop: /opt/ont-loop-detector && sudo chmod 600 .env
sudo -u ontloop .venv/bin/python -m app.main --check   # uji koneksi ke ketiga sumber
sudo cp deploy/ont-loop-detector.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now ont-loop-detector
```

Dashboard ada di `http://<ip-server>:8088/`. Bila `WEB_PASSWORD` kosong, password sementara
dibuat saat start dan ditulis di log (`journalctl -u ont-loop-detector`).

### Halaman Pengaturan

Alamat dan login GenieACS, switch, MikroTik, dan OLT, serta data jaringan (subnet/VLAN hotspot,
trunk OLT) dan Telegram bisa diisi dari menu **Pengaturan** di dashboard (`/pengaturan`), tanpa
mengedit `.env`. Tiap perangkat punya tombol "Tes koneksi".

- Isian disimpan di `data/settings.json` (hak akses 600) dan **menimpa** nilai di `.env`.
  Perubahan langsung dipakai tanpa restart.
- Password disimpan apa adanya di file itu, karena aplikasi memerlukannya untuk login ke
  perangkat. Password tidak pernah dikirim balik ke browser; mengosongkan kolom password berarti
  tidak mengubahnya.
- Data OLT saat ini hanya disimpan dan dites jangkauannya (port terbuka). OLT belum dipakai untuk
  deteksi.
- Ambang skor, jadwal, dan login dashboard tetap diatur lewat `.env`.

Saran keamanan:

- Buat akun khusus untuk aplikasi ini: user grup `read` di MikroTik dan user tersendiri di switch. Jangan pakai akun admin utama.
- Dashboard memakai HTTP + basic auth. Jangan dibuka ke internet; akses lewat jaringan manajemen atau VPN.

## Struktur

```
app/collectors/   pengambil data + parser (genieacs, cisco, mikrotik)
app/detector.py   mesin skor (fungsi murni)
app/monitor.py    penjadwal, pencatat kejadian, pemicu notifikasi
app/store.py      SQLite (deret waktu chart, riwayat kejadian, riwayat skor)
app/notifier.py   Telegram
app/web.py        API + dashboard
app/static/       dashboard (HTML/CSS/JS murni + uPlot, tanpa CDN)
tests/            tes parser dan tes replay kejadian
```

## Lisensi pihak ketiga

Dashboard menyertakan [uPlot](https://github.com/leeoniya/uPlot) (lisensi MIT) di `app/static/vendor/`.
