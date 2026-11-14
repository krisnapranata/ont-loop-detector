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
app/static/       dashboard (HTML/CSS/JS murni + uPlot, tanpa CDN; animasi mati otomatis bila
                  sistem diatur "kurangi gerakan")
tests/            tes parser dan tes replay kejadian
```

## Panduan FastAPI untuk proyek ini

Bagian web aplikasi ini memakai [FastAPI](https://fastapi.tiangolo.com/), bukan Django. Panduan
ini ditulis untuk yang terbiasa dengan Django dan ingin mengubah atau menambah sesuatu di sini.

### FastAPI dibanding Django

FastAPI adalah kerangka kecil untuk membuat API: Anda menulis fungsi Python, memberi alamat
lewat dekorator, dan nilai yang dikembalikan otomatis menjadi JSON. Tidak ada `manage.py`,
ORM, migrasi, atau halaman admin bawaan.

| Di Django | Di proyek ini |
|---|---|
| `python manage.py runserver 0.0.0.0:8989` | `.venv/bin/python -m app.main --host 0.0.0.0 --port 8989` |
| `settings.py` | `.env` dan halaman Pengaturan (`app/config.py`, `app/settings.py`) |
| `urls.py` + `views.py` | dekorator `@app.get(...)` di atas fungsi, semuanya di `app/web.py` |
| `models.py` + `migrate` | tidak ada ORM; tabel SQLite dibuat otomatis oleh `app/store.py` |
| template HTML | file statis di `app/static/` yang mengambil data dari API lewat JavaScript |
| `python manage.py test` | `.venv/bin/python -m pytest` |
| `python manage.py createsuperuser` | `WEB_USER` dan `WEB_PASSWORD` di `.env` |
| auto-reload saat file diubah | tidak ada; hentikan dengan Ctrl+C lalu jalankan lagi |

### Menjalankan

```bash
cd /home/krisna/PROYEK/ont-loop-detector

# dengan perangkat sungguhan (isi .env atau halaman Pengaturan dulu)
WEB_PASSWORD=rahasia .venv/bin/python -m app.main --host 0.0.0.0 --port 8989

# dengan data contoh, tanpa menghubungi perangkat
WEB_PASSWORD=rahasia .venv/bin/python -m app.main --replay tests/fixtures --host 0.0.0.0 --port 8989

# sekali periksa di terminal, tanpa web
.venv/bin/python -m app.main --check
```

`--host 0.0.0.0` berarti bisa dibuka dari komputer lain di jaringan; `127.0.0.1` hanya dari
komputer itu sendiri. Tanpa `--host`/`--port`, nilainya diambil dari `WEB_HOST` dan `WEB_PORT`.

### Alur saat aplikasi dijalankan

1. `app/main.py` membaca konfigurasi (`config.load()`), lalu membuat `Store` (SQLite) dan `Monitor`.
2. `Monitor.start()` menjalankan satu thread latar belakang. Tiap `FAST_INTERVAL_SEC` detik ia
   mengambil data dari perangkat, memanggil `detector.analyze()`, dan menyimpan hasilnya.
3. `web.create_app(cfg, monitor, password)` membuat objek FastAPI dan mendaftarkan semua alamat.
4. `uvicorn.run(...)` menjalankan server web. Uvicorn adalah server-nya; FastAPI hanya kerangkanya.

Endpoint tidak pernah menghubungi perangkat sendiri. Ia hanya membaca hasil terakhir dari
`monitor.snapshot()` atau dari `monitor.store`, sehingga halaman tetap cepat.

### Membaca `app/web.py`

```python
@app.get("/api/series")
def series(hours: float = 6):
    hours = min(max(hours, 0.25), 24 * 14)
    return monitor.store.series(int(time.time() - hours * 3600))
```

- `@app.get("/api/series")` mendaftarkan alamat, seperti satu baris di `urls.py`.
- Parameter fungsi (`hours`) otomatis diambil dari query string, misalnya `/api/series?hours=3`.
  Karena tipenya `float`, FastAPI menolak `?hours=abc` dengan kode 422 tanpa kode tambahan.
- Nilai yang dikembalikan (dict atau list) otomatis dikirim sebagai JSON.
- Fungsi ditulis dengan `def` biasa, bukan `async def`, sehingga FastAPI menjalankannya di
  thread terpisah. Ini penting karena tes koneksi bisa memakan waktu beberapa detik.

Login berlaku untuk semua alamat sekaligus lewat `dependencies=[Depends(auth)]` saat `FastAPI(...)`
dibuat, mirip middleware atau `@login_required` yang dipasang global. Endpoint baru otomatis ikut
terlindungi.

### Menambah endpoint

Tambahkan fungsi di dalam `create_app()` di `app/web.py`, sebelum `return app`:

```python
    @app.get("/api/ringkas")
    def ringkas(minimal: int = 30):
        """Daftar singkat ONT dengan skor minimal tertentu."""
        s = monitor.snapshot()
        return [
            {"serial": x["serial"], "skor": x["score"], "tingkat": x["level"]}
            for x in s.get("suspects", [])
            if x["score"] >= minimal
        ]
```

Jalankan ulang aplikasinya, lalu coba:

```bash
curl -u admin:rahasia 'http://127.0.0.1:8989/api/ringkas?minimal=50'
# [{"serial":"FHTT0D10A37E","skor":100,"tingkat":"kuat"}]   (mode replay)
```

Untuk endpoint yang menerima data (POST/PUT), lihat `settings_put` di file yang sama: isi JSON
diterima lewat `payload: dict = Body(...)`, dan `dependencies=[Depends(_json_only)]` menolak
kiriman yang bukan JSON.

### Menambah halaman

1. Buat `app/static/nama.html`. Tautkan `static/app.css` supaya tampilannya seragam.
2. Daftarkan alamatnya di `create_app()`:

   ```python
       @app.get("/nama")
       def nama_page():
           return FileResponse(STATIC / "nama.html", headers={"Cache-Control": "no-cache"})
   ```

3. Di JavaScript halaman itu, ambil data dengan `fetch("api/...")`. Contoh lengkapnya ada di
   `app/static/settings.js`.
4. Tambahkan tautannya di `<nav class="nav">` pada `index.html` dan `settings.html`.

Data dari perangkat pelanggan (nama host, serial) harus selalu lewat fungsi `esc()` sebelum
dimasukkan ke HTML, seperti di `app/static/app.js`.

### Mengetes endpoint

FastAPI menyediakan `TestClient` yang memanggil aplikasi tanpa menjalankan server:

```python
from fastapi.testclient import TestClient
from app.config import Config
from app.monitor import Monitor
from app.store import Store
from app.web import create_app

def test_harus_login():
    cfg = Config()
    client = TestClient(create_app(cfg, Monitor(cfg, Store(":memory:")), "pw"))
    assert client.get("/api/state").status_code == 401
    assert client.get("/api/state", auth=("admin", "pw")).status_code == 200
```

Contoh yang lebih lengkap ada di `tests/test_settings.py`. Jalankan semua tes dengan
`.venv/bin/python -m pytest`.

### Yang sering membingungkan

- **Perubahan kode tidak langsung terlihat.** Tidak ada auto-reload; hentikan dan jalankan lagi.
  Perubahan pada file di `app/static/` cukup dengan memuat ulang halaman di browser.
- **Dokumentasi otomatis (`/docs`) dimatikan** di `FastAPI(docs_url=None, ...)` supaya daftar
  endpoint tidak terbuka. Hapus argumen itu bila ingin melihatnya saat pengembangan.
- **Tidak ada migrasi.** Kalau menambah kolom di `app/store.py`, database lama di `data/` tidak
  ikut berubah; hapus file `data/loopdetector.db` atau tambahkan `ALTER TABLE` sendiri.
- **Satu proses saja.** Penjadwal berjalan di dalam proses web. Jangan menjalankan dengan
  beberapa worker (`uvicorn --workers 4`), karena tiap worker akan memantau sendiri-sendiri.

Dokumentasi resmi FastAPI: <https://fastapi.tiangolo.com/> (tutorialnya pendek dan bisa diikuti berurutan).

## Lisensi pihak ketiga

Disertakan di `app/static/vendor/` supaya dashboard jalan tanpa internet:

- [uPlot](https://github.com/leeoniya/uPlot) untuk chart, lisensi MIT.
- Font [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans), lisensi SIL Open Font License 1.1
  (teks lisensi di `plus-jakarta-sans-OFL.txt`).
