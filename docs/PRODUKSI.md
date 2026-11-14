# Panduan pemasangan di server production

Panduan ini menjelaskan cara memasang ONT Loop Detector di server, dengan dua pilihan:

- **Cara A: dengan Docker**
- **Cara B: tanpa Docker** (Python venv + systemd)

Keduanya memakai kode dan file `.env` yang sama, dan hasil akhirnya sama. Pilih salah satu saja.

## 1. Sebelum mulai

### Server yang dipakai

Pasang di **server GenieACS** (atau server lain di jaringan manajemen yang sama). Alasannya:

- API GenieACS (port 7557) langsung terjangkau, tanpa membuka port ke luar.
- Server itu sudah dekat dengan switch dan router, jadi tidak perlu forward tambahan.

Server perlu akses internet saat pemasangan, untuk mengambil kode dan dependensi.

### Docker atau tanpa Docker?

| | Cara A: Docker | Cara B: tanpa Docker |
|---|---|---|
| Yang perlu ada di server | Docker + plugin Compose | Python 3.10 atau lebih baru, `python3-venv`, `git` |
| Versi Python server | tidak berpengaruh (ada di dalam image) | harus cocok |
| Menyala otomatis saat reboot | ya (`restart: unless-stopped`) | ya (systemd) |
| Melihat log | `docker compose logs -f` | `journalctl -u ont-loop-detector -f` |
| Lokasi data | volume Docker `ontloop-data` | folder `data/` di dalam folder aplikasi |
| Cocok bila | server sudah memakai Docker, atau Python-nya lama | ingin paling sederhana dan mudah diperiksa |

Kalau ragu: bila Docker sudah terpasang di server, pakai Cara A; bila belum, Cara B lebih cepat.

### Masuk ke server

```bash
ssh <user>@<alamat-server>
```

## 2. Cara A: dengan Docker

### A1. Pasang Docker (lewati bila sudah ada)

```bash
docker --version && docker compose version     # kalau dua-duanya muncul, lewati langkah ini
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER                  # lalu keluar dan masuk lagi ke server
```

### A2. Ambil kode

```bash
sudo mkdir -p /opt/ont-loop-detector && sudo chown $USER: /opt/ont-loop-detector
git clone https://github.com/krisnapranata/ont-loop-detector.git /opt/ont-loop-detector
cd /opt/ont-loop-detector
```

### A3. Buat file `.env`

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Yang perlu diisi di sini cukup login dashboard. Alamat perangkat lebih mudah diisi nanti lewat
dashboard.

```
WEB_PASSWORD=<password dashboard yang kuat>
WEB_PORT=8088
GENIEACS_URL=http://127.0.0.1:7557
```

Opsional, supaya jam di log sesuai waktu setempat (tanpa ini log memakai UTC):

```
TZ=Asia/Makassar
```

### A4. Jalankan

```bash
docker compose up -d --build
docker compose ps                 # kolom STATUS harus "Up ... (healthy)" setelah ±30 detik
docker compose logs -f            # Ctrl+C untuk berhenti melihat log
```

Container berjalan sebagai user biasa (bukan root) dan memakai jaringan server apa adanya
(`network_mode: host`), sehingga `127.0.0.1:7557` di dalam container adalah GenieACS di server.

Pemeriksaan sekali jalan di terminal:

```bash
docker compose exec ont-loop-detector python -m app.main --check
```

### A5. Memperbarui

```bash
cd /opt/ont-loop-detector
git pull
docker compose up -d --build
```

Pengaturan dan riwayat tidak hilang, karena tersimpan di volume `ontloop-data`, bukan di dalam container.

### A6. Cadangan dan pemulihan

Semua pengaturan (termasuk password perangkat) ada di `/app/data` di dalam container, ditambah file `.env`.

```bash
# cadangan
docker cp ont-loop-detector:/app/data ./cadangan-data
cp .env ./cadangan-env

# pemulihan (setelah container baru berjalan)
docker cp ./cadangan-data/. ont-loop-detector:/app/data/
docker compose exec -u root ont-loop-detector chown -R ontloop: /app/data
docker compose restart
```

Perintah `chown` itu wajib: tanpa itu file hasil salinan dimiliki root dan aplikasi tidak bisa membacanya.

### A7. Menghentikan dan menghapus

```bash
docker compose down            # berhenti; data tetap ada
docker compose down -v         # berhenti DAN menghapus semua pengaturan serta riwayat
```

### Catatan mode jaringan

Kalau Anda tidak ingin memakai `network_mode: host`, buka `docker-compose.yml`, beri tanda `#` pada baris
`network_mode: host`, dan aktifkan bagian `ports`. Di mode itu `127.0.0.1` berarti container itu
sendiri, jadi host GenieACS harus diisi dengan IP server (misalnya `192.168.100.253`), dan API
GenieACS harus mendengarkan di alamat itu, bukan hanya di `127.0.0.1`.

## 3. Cara B: tanpa Docker

### B1. Prasyarat

```bash
python3 --version                              # harus 3.10 atau lebih baru (diuji di 3.12)
sudo apt update && sudo apt install -y python3-venv git
```

### B2. Ambil kode dan pasang dependensi

```bash
sudo useradd --system --home /opt/ont-loop-detector --shell /usr/sbin/nologin ontloop
sudo git clone https://github.com/krisnapranata/ont-loop-detector.git /opt/ont-loop-detector
cd /opt/ont-loop-detector
sudo python3 -m venv .venv
sudo .venv/bin/pip install -r requirements.txt
```

### B3. Buat file `.env`

```bash
sudo cp .env.example .env
sudo nano .env
```

Isi minimal:

```
WEB_PASSWORD=<password dashboard yang kuat>
WEB_PORT=8088
GENIEACS_URL=http://127.0.0.1:7557
```

Lalu serahkan folder ke user `ontloop` dan kunci file `.env`:

```bash
sudo chown -R ontloop: /opt/ont-loop-detector
sudo chmod 600 /opt/ont-loop-detector/.env
```

### B4. Uji sekali sebelum dijadikan service

```bash
sudo -u ontloop .venv/bin/python -m app.main --check
```

Yang diharapkan: jumlah ONT terbaca dan daftar ONT berisiko. Status akan tertulis "TIDAK DIKETAHUI"
karena switch dan router belum diisi; itu wajar di tahap ini. Kalau muncul "sumber GenieACS gagal
dibaca", periksa `GENIEACS_URL`.

### B5. Pasang sebagai service

```bash
sudo cp deploy/ont-loop-detector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ont-loop-detector
systemctl status ont-loop-detector          # harus "active (running)"
journalctl -u ont-loop-detector -f          # log berjalan; Ctrl+C untuk keluar
```

Service menyala lagi sendiri bila mati, dan ikut menyala saat server reboot.

### B6. Memperbarui

```bash
cd /opt/ont-loop-detector
sudo -u ontloop git pull
sudo .venv/bin/pip install -r requirements.txt
sudo systemctl restart ont-loop-detector
```

### B7. Cadangan dan pemulihan

Cukup dua file ini; keduanya berisi password, jadi simpan di tempat aman:

```
/opt/ont-loop-detector/.env
/opt/ont-loop-detector/data/settings.json
```

Untuk memulihkan, salin kembali ke tempat yang sama, lalu:

```bash
sudo chown ontloop: /opt/ont-loop-detector/.env /opt/ont-loop-detector/data/settings.json
sudo chmod 600 /opt/ont-loop-detector/.env /opt/ont-loop-detector/data/settings.json
sudo systemctl restart ont-loop-detector
```

### B8. Menghapus

```bash
sudo systemctl disable --now ont-loop-detector
sudo rm /etc/systemd/system/ont-loop-detector.service && sudo systemctl daemon-reload
sudo rm -rf /opt/ont-loop-detector
sudo userdel ontloop
```

## 4. Setelah terpasang (berlaku untuk kedua cara)

### Membuka dashboard

Dashboard ada di `http://<ip-server>:8088/`, user `admin`, password dari `WEB_PASSWORD`.

Dari luar jaringan manajemen, pakai terowongan SSH dari komputer Anda:

```bash
ssh -L 8088:127.0.0.1:8088 <user>@<alamat-server>
```

lalu buka `http://127.0.0.1:8088/`. Cara ini tidak mengubah apa pun di router.

**Jangan membuka dashboard ke internet.** Dashboard memakai HTTP dengan login biasa, bukan HTTPS,
sehingga password bisa disadap bila lewat jaringan publik.

### Mengisi koneksi perangkat dan Pengaturan

Buka menu **GenieACS**, **Switch**, dan **MikroTik** satu per satu, pilih tab **Koneksi**, isi, tekan
**Tes koneksi**, lalu **Simpan koneksi**. Sisanya diisi di menu **Pengaturan**. Perubahan langsung
berlaku tanpa restart.

| Tempat | Yang diisi |
|---|---|
| GenieACS → Koneksi → UI GenieACS | alamat UI, mis. `http://127.0.0.1:3000`, beserta username dan password login UI GenieACS. Dipakai semua menu GenieACS |
| GenieACS → Koneksi → NBI GenieACS | host `127.0.0.1`, port `7557`; username/password hanya bila NBI diberi login. Dipakai pemantauan loop |
| Switch → Koneksi | IP manajemen switch, port `23` (Telnet) atau `22` (SSH), username, password, password enable |
| MikroTik → Koneksi | IP router, port SSH router, username, password |
| OLT | boleh lebih dari satu; saat ini hanya disimpan dan dites jangkauannya |
| Jaringan | subnet hotspot, VLAN hotspot, VLAN TR069, nama interface TR069 di router, port switch ke OLT |
| Telegram | token bot dan chat ID (opsional) |

Pengaturan ini menimpa nilai di `.env`.

### Akun khusus untuk aplikasi

Sebaiknya jangan memakai akun admin utama perangkat.

```
# MikroTik: user yang hanya bisa membaca
/user add name=ontloop group=read password=<password>
```

User grup `read` cukup untuk deteksi dan untuk melihat isi menu MikroTik. Tombol aksi di menu itu
(aktifkan/nonaktifkan interface, atur loop-protect) baru berfungsi bila user-nya punya hak `write`.
Begitu pula di switch: tombol aksi port memerlukan password enable.

Di switch, buat username tersendiri untuk aplikasi. Aplikasi menjalankan `show clock`, `show logging`,
dan `show mac address-table`, dan masuk ke mode enable bila password enable diisi.

## 5. Kalau ada masalah

| Gejala | Kemungkinan penyebab dan jalan keluar |
|---|---|
| Tes koneksi switch: "Tidak ada jawaban (timeout)" | Switch tidak punya `ip default-gateway`, sehingga tidak bisa membalas server di subnet lain. Tambahkan gateway di switch, atau aturan masquerade di router untuk trafik dari server ke switch. |
| Tes koneksi MikroTik: "Koneksi ditolak" atau timeout | Layanan SSH router mati, port-nya berbeda, atau alamat server tidak diizinkan. Periksa `/ip service print` di router. |
| Tes koneksi GenieACS: "Koneksi ditolak" | Port salah, atau (di Docker mode bridge) host masih `127.0.0.1`. Lihat "Catatan mode jaringan". |
| Service/container tidak mau start, log menyebut "address already in use" | Port 8088 dipakai program lain. Ganti `WEB_PORT` di `.env`, lalu restart. |
| Tanpa Docker: "Permission denied" pada folder `data/` | Folder belum dimiliki `ontloop`. Jalankan `sudo chown -R ontloop: /opt/ont-loop-detector`. |
| Docker: pengaturan hilang setelah pemulihan cadangan | Langkah `chown` di A6 terlewat. |
| Dashboard menulis "Status loop belum bisa dipastikan" | Switch dan router belum diisi atau gagal dibaca. Arahkan kursor ke titik sumber data di kanan atas untuk melihat pesan kesalahannya. |
| Lupa password dashboard | Ganti `WEB_PASSWORD` di `.env`, lalu restart. |
| Ada kejadian loop yang terlewat | Buffer log bawaan switch Cisco kecil (4096 byte). Perbesar di switch: `logging buffered 65536`. |

## 6. Daftar periksa setelah pasang

- [ ] Service/container berjalan: `systemctl status ont-loop-detector` atau `docker compose ps`.
- [ ] Di server, `curl -u admin:<password> http://127.0.0.1:8088/api/state` mengembalikan `"ready":true`.
- [ ] Tiga titik sumber data di kanan atas dashboard (GenieACS, Switch Cisco, Router MikroTik) hijau.
- [ ] Status tertulis "Jaringan normal" atau "Loop sedang terjadi", bukan "belum bisa dipastikan".
- [ ] Angka "ONT dengan data host" masuk akal dibanding jumlah ONT di GenieACS.
- [ ] Bagian bawah dashboard menulis "Notifikasi Telegram aktif" (bila Telegram dipakai).
- [ ] Setelah server di-reboot, aplikasi menyala sendiri.
- [ ] File `.env` dan data sudah dicadangkan.

## Yang sudah dan belum diuji

Sudah diuji di komputer pengembangan: image Docker dibangun dan dijalankan (login, deteksi dengan data
rekaman, jalan sebagai user non-root, pengaturan bertahan setelah restart, cadangan dan pemulihan,
status healthy); pemasangan tanpa Docker dari clone bersih sampai `--check`.

Belum diuji, dan baru akan terbukti di server Anda: koneksi langsung ke GenieACS, switch, dan router
dari server production; koneksi switch lewat SSH (yang diuji hanya Telnet); pengiriman pesan Telegram;
dan pemasangan unit systemd di server sungguhan.
