---
name: genieacs-menu
description: Kumpulan keputusan dan permintaan pemilik untuk menu GenieACS di ONT Loop Detector - meniru UI GenieACS lewat API UI-nya, Summon dan CRUD, tab lokasi per subnet, edit banyak kolom sekaligus, LAN BIND/WANInterface yang mudah dibaca, form WAN baru, serta gaya visual "pelat ONT" berwarna dengan embos, ikon, LED, dan animasi. Pakai setiap kali mengubah, memperbaiki, atau menambah fitur di halaman GenieACS (Overview, Devices, detail perangkat, Faults, Admin, Koneksi) atau tampilannya (genieacs.js, genieacs.html, acs-expr.js, app.css bagian GenieACS, app/manage/genieacs_ui.py).
---

# Menu GenieACS: permintaan pemilik yang harus dipertahankan

Semua teks untuk pengguna dalam bahasa Indonesia. Untuk alur kerja umum (berkas yang diubah bersamaan,
tes) lihat skill `ont-loop-dev`; skill ini berisi **apa** yang diminta pemilik untuk menu GenieACS dan
**mengapa**, supaya perubahan berikutnya tidak menghapusnya.

## 1. Meniru UI GenieACS, bukan membuat versi sendiri

- Semua menu dan tombol GenieACS harus ada: Overview, Devices, detail perangkat, Faults, Admin
  (Presets, Provisions, Virtual Parameters, Files, Config, Users, Permissions), plus tab Koneksi.
- Backend memakai **API UI GenieACS** (port UI, mis. 3000/30000) lewat `app/manage/genieacs_ui.py`, login
  dengan akun di tab Koneksi; izin akun GenieACS tetap berlaku. NBI (7557) hanya untuk pemantauan loop.
- Tata letak daftar dan detail **dirender dari config `ui.*` GenieACS milik server** (diambil dari
  `window.clientConfig`). Jangan menulis tata letak per vendor secara manual; tipe komponen baru
  ditambahkan di `comp()` pada `genieacs.js`.
- **Summon** ada di tiap baris daftar, di kartu ringkasan detail, di bilah aksi massal, dan di setiap
  blok config. Summon mengirim `getParameterValues` dengan path apa adanya, sama seperti GenieACS.
- **CRUD**: ✎ per sel, tambah/hapus instance tabel, Ambil ulang, tag, hapus perangkat, reset, reboot,
  push file, serta CRUD seluruh halaman Admin.

## 2. Hal yang pernah dikeluhkan dan sudah diperbaiki (jangan sampai kembali)

| Keluhan | Perilaku yang benar |
|---|---|
| ONT menolak Summon/Ambil ulang (cwmp.9002) | `readSafe()` membaca per bagian: path `*` diuraikan, bagian yang ditolak diturunkan ke sub-objek, fault percobaan dihapus, hasil dilaporkan |
| Pesan "ONT menolak" tidak jelas | tampilkan kode + pesan fault + parameter yang ditolak + arti kode umum |
| ONT tertentu "tidak ada" di daftar | ikuti `ui.pageSize` GenieACS (maks 1000), jangan batasi 100 |
| LAN BIND berupa path panjang | tampil `LAN 1, LAN 2, WLAN 1`; edit pakai kotak centang; LAN 1–N selalu muncul walau ONT tidak melaporkan port (supaya pilihan aktif tidak terhapus diam-diam) |
| WANInterface membingungkan orang awam | tampil `HOTSPOT · WAN IP 1.3 · VLAN 200`; edit pakai pilihan koneksi WAN yang ada |
| Password WiFi kosong | sebagian firmware (mis. FiberHome RP2884/RP2908/RP3246/RP3478) tidak mengirim password; tampil "tidak dikirim ONT", ✎ tetap bisa mengganti (8–63 karakter) |
| Edit satu per satu lama | ✎ biru di ujung baris = ubah semua kolom satu baris dalam satu tugas; tombol "Tambah ke antrean" + bilah "Kirim ke ONT" untuk perubahan lintas baris |
| Ubin "Ping 172.16.16.49" terpotong jadi dua baris | `.tile.ping` selebar dua kolom dan `nowrap`; kembali satu kolom lewat container query bila `.tiles` < 340px |
| Bilah melayang tidak terlihat | bilah `position: fixed` harus ditaruh langsung di `<body>` (animasi `.reveal` memberi transform pada `<main>`), dipusatkan tanpa `transform` |

## 3. Form WAN baru (Tambah instance pada WANPPPConnection/WANIPConnection)

- Kolom diambil dari koneksi sejenis yang sudah ada di ONT itu (nama parameter vendor ikut benar).
- Pilihan, bukan ketik: Conn Mode (PPPoE_Routed, PPPoE_Bridged, IP_Routed / IP_Routed, IP_Bridged),
  Service List (INTERNET, TR069, VOIP, OTHER, IPTV, kombinasi), IP type (DHCP/Static), plus nilai yang
  sudah dipakai di ONT itu dan opsi "Lainnya". TR-069 tidak memberi daftar nilai yang diterima ONT.
- LAN BIND berupa kotak centang. ZTE memakai objek terpisah `X_ZTE-COM_PortBinding` (LANInterface +
  WANInterface): buat PortBinding baru, tandai interface yang sudah terikat koneksi lain.

## 4. Tab lokasi di Devices

- Tab per lokasi berdasarkan subnet IP WAN/TR069 (`VirtualParameters.IPTR069`, bisa diganti), mis.
  Kampung Wifi `172.16.0.0/20`, Trigara.Net `172.16.16.0/20`, Kadindi.Hotspot `172.16.32.0/20`.
- Diatur pemilik lewat tombol ⚙ (nama tab + satu/lebih jaringan), disimpan di `data/settings.json`
  (`acs_locations`), **bukan** di config GenieACS. Ada tab "Semua" dan "Lainnya", masing-masing dengan jumlah.
- Subnet diubah jadi pola `LIKE` awalan IP (`cidrExprs()`), karena ekspresi GenieACS tidak punya CIDR.
- Permintaan daftar harus diberi nomor urut (`LIST.seq`) agar klik tab saat memuat tidak mencampur hasil.

## 5. Gaya visual: "pelat perangkat", berwarna, embos, ikon, animasi

Pemilik menolak tampilan monoton yang "terlihat buatan AI". Pertahankan identitas ini:

- **Warna serat optik TIA-598** (`--f-blue`, `--f-orange`, `--f-green`, `--f-brown`, `--f-slate`, `--f-red`,
  `--f-yellow`, `--f-violet`, `--f-rose`, `--f-aqua`), didefinisikan tiga kali (terang, gelap sistem,
  gelap manual). Tiap lokasi mendapat satu warna serat: titik di tab, garis kiri di baris, ubin Lokasi.
- **Embos**: panel dan tombol bergradien dengan kilau atas (`--emb-hi`), bayangan bawah (`--emb-lo`),
  tekan = bayangan ke dalam. Tombol utama biru serat; Summon oranye serat.
- **Detail perangkat** dibuka dengan **pelat depan ONT**: garis 10 warna serat di atas, panel LED gelap
  tetap (Power, PON, LOS, Internet, 2.4G, 5G, LAN1–4) yang menyala/berkedip dari data ONT,
  **meteran RX** (−30 s/d −8 dBm, zona merah/kuning/hijau, jarum beranimasi), dan ubin berikon
  (Lokasi, IP TR069, PPPoE, Ping dengan sonar, Inform, Menyala, Suhu, Tag).
- Kartu bagian punya ikon berwarna sesuai isinya (WiFi aqua, WAN biru, host hijau, admin ungu,
  fault merah, parameter abu, konfigurasi oranye).
- **Kartu detail harus sederhana** (`simplifyCards()`): satu bagian config = satu kartu dengan kepala
  (ikon, judul, Summon/Tambah/Ambil ulang di kanan); kartu yang hanya berisi judul + tombol digabung ke
  kartu isi berikutnya (judul dan tombolnya ikut); tabel kosong jadi satu baris; kartu kecil dua kolom
  (grid dense), tabel lebar dan "Informasi perangkat" selebar penuh. Tanpa garis warna di kiri kartu.
- **Daftar**: LED status berdenyut untuk ONT online, LED sinyal/suhu dari chart config.
- **Overview**: ubin ringkasan (total, online, fault, lokasi) dengan angka naik, grafik batang
  "Perangkat per lokasi" (online vs offline) yang tumbuh, donut yang terisi. Hitungan dibatasi 6
  permintaan sekaligus dengan satu kali coba ulang.
- **Gaya yang sama di semua menu** (Dashboard, GenieACS, Switch, MikroTik, Pengaturan): panel/tombol
  embos global di `app.css`, judul bagian `<h2>` dengan ikon berwarna (`.ico` + `--tc`), status
  `.pill` sebagai LED (hijau berpendar, merah berkedip).
- **Grafik dashboard** (`app.js` + uPlot vendored): panel per grafik dengan ikon, nilai terbaru besar
  dan nilai tertinggi; garis spline dengan lapisan pendar (`_glow`), isian gradien warna serat,
  cincin di titik terakhir, pita waktu loop berarsir merah. Tinggi grafik `CH_H`.
- Label kecil memakai huruf biasa (bukan HURUF BESAR). Semua animasi harus mati di
  `prefers-reduced-motion` (aturan global CSS + `calm` di JS).

## 6. Keamanan dan cara menguji

- Jangan pernah mengirim tugas ke ONT pelanggan untuk "mencoba". Uji ke GenieACS sungguhan hanya
  membaca: jalankan instance terpisah dengan `--env /dev/null`, `SETTINGS_PATH`/`DB_PATH` sementara,
  dan di skrip browser blokir `**/api/acs/tasks`. Tutup dialog dengan Batal.
- Koneksi WAN TR069 tidak boleh bisa dihapus (`holds_mgmt` di server, `holdsMgmt` di browser).
- Hapus instance cukup satu konfirmasi (tanpa mengetik "hapus"), atas permintaan pemilik. Kata
  konfirmasi hanya untuk reset pabrik dan menghapus perangkat dari GenieACS.
- Repo publik: jangan commit alamat server, akun, config `ui.*` asli, atau data pelanggan. Data replay
  memakai berkas `_contoh` buatan.
- Perubahan berkas statis cukup muat ulang browser; perubahan Python perlu restart aplikasi (port 8989).
- Laporkan dengan jujur bagian yang belum diuji ke perangkat sungguhan.
