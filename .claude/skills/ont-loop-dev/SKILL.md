---
name: ont-loop-dev
description: Alur kerja mengembangkan ONT Loop Detector - menambah pengaturan, collector atau parser, aturan deteksi, aksi kelola perangkat (GenieACS/Switch/MikroTik), dan bagian UI, lengkap dengan berkas yang harus diubah bersamaan dan cara memverifikasinya. Pakai saat diminta menambah fitur, memperbaiki bug, atau mengubah perilaku aplikasi ini (add setting, add collector, add action, change detector, UI change).
---

# Mengembangkan ONT Loop Detector

Baca `CLAUDE.md` dulu; skill ini adalah daftar periksa per jenis perubahan, bukan penggantinya.
Semua teks untuk pengguna, komentar kode, dan pesan commit ditulis dalam bahasa Indonesia.

## Batas yang tidak boleh dilanggar

- `app/collectors/` hanya membaca. Kode yang mengubah perangkat hanya boleh ada di `app/manage/`.
- Tidak ada perintah bebas dari browser. Setiap perintah ke perangkat disusun server dari masukan yang
  lolos regex **dan** cocok dengan daftar yang baru dibaca dari perangkat (port, interface, path parameter).
- Rahasia tidak pernah dikirim ke browser dan tidak pernah masuk log.
- Frontend tanpa build dan tanpa CDN; string dari perangkat/pelanggan lewat `esc()` sebelum masuk HTML.
- Repo ini publik: tidak ada IP publik, nama pelanggan, atau kredensial di kode, fixture, maupun tes.

## Daftar periksa per jenis perubahan

**Menambah pengaturan**
`Config` (`app/config.py`) → `settings.SAVED_KEYS` → `settings.merged()` (validasi) →
`settings.public_view()` → form HTML (`settings.html`, atau tab Koneksi di `genieacs.html` /
`switch.html` / `mikrotik.html`) → `.env.example` → tes di `tests/test_settings.py`.
Bila nilainya masuk ke perintah perangkat, validatornya adalah batas injeksi: tulis tes penolakannya.

**Menambah yang dibaca dari perangkat (pemantauan)**
Parser murni + dataclass di `app/collectors/<perangkat>.py` → panggil di `fetch()` → `app/replay.py`
→ fixture di `tests/fixtures/` → tes di `tests/test_parsers.py`. Perintah harus lolos penjaga
(`show …` di Cisco, mengandung ` print` di MikroTik, `GET` di GenieACS).

**Mengubah aturan deteksi atau kunci hasil `analyze()`**
`app/detector.py` lalu, bila ada kunci berubah: `app/static/app.js`, `app/notifier.py`,
`app/store.py` (`add_sample`, `_top`), `app/main.py::_print_report`. `tests/fixtures/expected.json`
menentukan ONT yang harus peringkat satu dan yang harus `berisiko`; jangan ubah berkas itu untuk
meloloskan tes kecuali pengguna memang meminta perilaku baru.

**Menambah aksi kelola perangkat**
1. Fungsi murni penyusun perintah di `app/manage/<perangkat>.py` (`build_task`, `build_config`,
   `build_command`): validasi, cocokkan dengan daftar dari perangkat, lempar `ManageError` berisi pesan
   berbahasa Indonesia yang layak ditampilkan.
2. Jalankan lewat sesi di modul yang sama; periksa keluaran perangkat untuk tanda penolakan.
3. Rute di `app/web_manage.py`: bungkus dengan `guard(...)`, pakai `dependencies=mutate` untuk POST,
   tolak di mode replay (`no_replay()`).
4. Tombol di `app/static/<perangkat>.js`; aksi yang memutus layanan wajib lewat `UI.ask()` dengan
   `danger: true`, dan `confirmWord` bila dampaknya luas.
5. Tes di `tests/test_manage.py`: kasus sah, masukan berbahaya (baris baru, kutip, `;`, nama tak dikenal),
   dan penolakan di mode replay.

**Mengubah menu GenieACS**
Menu ini meniru UI GenieACS lewat API UI-nya (`app/manage/genieacs_ui.py`), bukan NBI. Rute baru ke
GenieACS harus masuk daftar putih (`RESOURCES`, `DELETABLE`, `PUTTABLE`, atau metode khusus di
`UiClient`), dan task baru harus dikenali `clean_tasks()`. Tata letak tidak ditulis tangan: komponen
dirender dari config `ui.*` GenieACS di `static/genieacs.js`, jadi tipe komponen baru ditambahkan di
`comp()`. Uji di mode replay (tata letak contoh `tests/fixtures/genieacs_ui_contoh.json`), lalu minta
pengguna mencoba terhadap GenieACS sungguhan. Uji hanya-baca ke GenieACS sungguhan boleh dilakukan
dengan instance terpisah (`--env /dev/null`, `SETTINGS_PATH` dan `DB_PATH` sementara); jangan menekan
tombol aksi.

**Menambah bagian UI**
Dashboard (`app.js`): gambar ulang hanya bila `changed(key, value)`, pakai `api()`. Halaman kelola:
pakai `UI.loader`, `UI.call`, `UI.tabs` dari `common.js`. Warna hanya lewat variabel CSS yang sudah ada;
token baru harus didefinisikan tiga kali (terang, `prefers-color-scheme: dark`, `[data-theme="dark"]`).
Animasi baru harus tunduk pada `prefers-reduced-motion`.

**Skema database**
Tidak ada migrasi. Perubahan tabel di `app/store.py` perlu `ALTER` manual atau database baru; tulis
langkahnya di `docs/PRODUKSI.md`.

## Verifikasi sebelum bilang selesai

```bash
.venv/bin/python -m pytest -q
for f in app/static/*.js; do node --check "$f"; done
WEB_PASSWORD=rahasia .venv/bin/python -m app.main --replay tests/fixtures --host 127.0.0.1 --port 8088
```

Tidak ada auto-reload: mulai ulang proses setelah mengubah Python (berkas statis cukup muat ulang
browser). Untuk perubahan UI, buka halamannya di mode replay dan lihat hasilnya, termasuk tema gelap dan
lebar ponsel. Hentikan proses replay setelah selesai.

Yang tidak tercakup tes otomatis dan harus disebut terus terang di laporan: jalur `fetch()` ke perangkat
sungguhan, transport SSH Cisco, pengiriman Telegram, dan semua aksi `app/manage/` terhadap perangkat
sungguhan. Jangan mencoba aksi kelola ke perangkat produksi untuk "mengetes"; minta pengguna yang mencobanya.
