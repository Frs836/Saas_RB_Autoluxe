# Rencana Perombakan: Skema Database dan Tampilan Layar Besar

Dokumen ini adalah usulan, belum ada yang dieksekusi. Semuanya perlu
disetujui dulu sebelum ada perubahan skema atau navigasi.

Bagian 1 membahas skema database, bagian 2 discusses tampilan untuk tablet dan
desktop. Keduanya berdiri sendiri supaya bisa diputuskan terpisah.

---

## 1. Skema Database

### 1.1 Kekurangan skema sekarang

**Satu tabel untuk dua hal yang berbeda.** `orders` dipakai untuk order POS
maupun order home service. Keduanya berbagi kolom yang hanya relevan untuk
salah satu sisi: `cash_hold_*` hanya berarti bagi order yang dibuat karyawan,
`service_package` berisi teks hasil rakitan dari server, dan `assigned_to`
berisi satu orang padahal timnya bisa banyak orang di `order_team_members`.
Akibatnya banyak kolom berisi nol yang tidak pernah berarti apa pun.

**Tidak ada tabel harga.** Harga layanan disimpan di `services.price_s`,
`price_m`, `price_l`, `price_xl`, lalu ditambah `price_motor`, lalu
`price_motor_s`, `price_motor_m`, `price_motor_l`, `price_motor_xl`.
Sembilan kolom untuk satu informasi: jenis kendaraan dan ukurannya. Setiap
kendaraan baru butuh tambah kolom, tambah enum, dan tambah percabahan di
`service_price_for_size`. Vaidasi harga tersebar di beberapa tempat.

**Riwayat harga hilang.** `order_items` menyimpan `price` saat transaksi, jadi
bukti pembelian aman. Tapi katalog tidak pernah menyimpan harga lama. Kalau
pemilik/workshop ditanya "berapa dulu harga jasa ini", tidak ada sumber
jawaban selain menebak dari nota lama.

**Tanggal di dalam nama kolom.** `orders` menyimpan `completed_at` dan
`completed_by` tidak ada sama sekali. Siapa yang menutup pekerjaan terakhir
tidak tercatat. Pola yang sama berulang di `attendance_logs` yang menyimpan
`clock_in` dan `clock_out` sebagai dua kolom terpisah, padahal maknanya satu:
satu sesi kehadiran.

**Nomor dokumen.** Nomor order, nomor invoice, nomor garansi, dan token lacak
dibuat di empat tempat berbeda dengan pola berbeda. `invoices.invoice_number`
hanya `INV-` ditambah nomor order. Tidak ada jaminan unik per cabang kalau
nomor order bisa berulang.

**Jejak audit tidak lengkap.** `activity_logs` mencatat siapa melakukan apa,
tapi tidak menyimpan nilai sebelum dan sesudah untuk hampir semua aksi.
Kalau harga jasa berubah, tidak ada yang bisa menunjukkan harga lamanya.

**Tidak ada tabel pengaturan.** Jam kerja, radius geofence, ambang kemiripan
wajah, dan aturan keterlambatan tersebar sebagai konstanta di kode dan kolom di
tabel cabang. Mengubah ambang kemiripan wajah berarti mengubah kode dan
deploy ulang, bukan sekadar menyetel angka di halaman pengaturan.

### 1.2 Usulan: harga sebagai baris, bukan kolom

Tabel baru `service_prices`:

| kolom | tipe | makna |
|---|---|---|
| service_id | uuid | layanan |
| vehicle_type | enum | mobil, motor |
| size_code | text | S, M, L, XL |
| price | numeric | harga |
| valid_from | timestamptz | berlaku sejak |
| valid_to | timestamptz | kosong berarti masih berlaku |

Baris, bukan kolom. Tambah ukuran baru cukup tambah baris, tanpa mengubah
skema, tanpa mengubah kode, tanpa enum baru.

Tabel baru `service_prices_history` menyimpan setiap perubahan harga dengan
penyebab dan pelaku. Ini menjawab langsung pertanyaan workshop "berapa dulu
harga jasa ini".

### 1.3 Usulan: vehicle_type dan size_code dipisah

`VehicleType` sudah ada di `lib/pos.ts` sebagai `mobil` atau `motor`, tetapi
di database keduanya ditabung dalam satu enum `vehicle_size`. Memecahnya
membuat kueri lebih sederhana dan menghilangkan nilai gabungan seperti
"Motor S" yang sekarang harus ditangani khusus di banyak tempat.

### 1.4 Usulan: kehadiran sebagai sesi, bukan kolom

Tabel baru `attendance_sessions` dengan satu baris per kehadiran:

```
id, profile_id, branch_id, date,
clock_in timestamptz, clock_out timestamptz,
clock_in_photo_url, clock_out_photo_url,
clock_in_gps_lat, clock_in_gps_lng, clock_in_gps_accuracy,
clock_out_gps_lat, clock_out_gps_lng,
gps_indoor boolean, distance_from_branch_meters numeric,
scheduled_open time, scheduled_close time,
late_minutes int, late_reason text, status enum
```

Semua koordinat tercatat, bukan hanya yang masuk. Keluar dipisahkan dari
masuk, jadi nama kolomnya jujur. Menghitung selisih jarak tidak perlu
membandingkan baris lain.

### 1.5 Usulan: settings

Tabel `workshop_settings` dengan baris per cabang: `radius_meters`,
`face_match_threshold`, `lateness_grace_minutes`, `attendance_tolerance`.
Semua aturan bisnis pindah dari kode ke data. Nilai lama tetap berlaku
sebagai nilai bawaan.

### 1.6 Kelebihan yang didapat

**Menambah ukuran kendaraan** jadi menambah baris, bukan menambah kolom.
Tidak ada lagi `price_motor_xl` dan migrasi baru tiap ukuran.

**Harga historis selalu ada** karena setiap perubahan harga meninggalkan
baris. Klaim, sengketa, dan pertanyaan pelanggan bisa dijawab dari data.

**Jejak audit otomatis** karena harga menyimpan `valid_from` dan
`valid_to`, jadi tidak perlu `activity_logs` menyimpan nilai sebelum dan
sesudah.

**Aturan bisa diubah administrator** tanpa menyentuh kode.

**Rekap kehadiran lebih mudah diaudit** karena satu baris menyimpan seluruh
sesi, bukan tersebar di beberapa kolom.

### 1.7 Risiko dan urutan

Tidak ada yang bisa dikerjakan tanpa menyalin data lama. Urutannya:

1. Tambah tabel baru, kosongkan.
2. Salin data lama ke tabel baru dengan format yang sama.
3. Ganti pembacaan ke tabel baru.
4. Hentikan penulisan ke tabel lama.
5. Hapus kolom lama.

Lima langkah, setiap langkah bisa dibatalkan, jadi tidak perlu downtime
yang lama.

### 1.8 Yang sengaja tidak diusulkan dan perlu keputusan

Saya sengaja tidak mengusulkan pemisahan order POS dan home service.
Pemisahan itu menambah tabel dan membuat banyak kueri jadi dua jalur,
manfaatnya belum sebanding dengan bobotnya. Kalau Anda memang akan
menjalankan dua lini bisnis berbeda, barulah perlu dipisah.

---

## 2. Tampilan Tablet dan Desktop

### 2.1 Masalah sekarang

Navigasi memakai `BottomNav` dengan lima posisi tetap. Di tablet dan desktop
lima posisi itu:
- Terlalu sedikit. Modul ada belasan dan tidak semuanya masuk.
- Terlalu besar. Di layar 1024px, lima tombol selebar 56px cuma mengisi
  sebagian kecil.
- Mengambil ruang bawah yang justru paling tidak bisa dipakai di desktop.

Semua modul juga ditumpuk satu kolom tanpa pengelompokan. Absensi,
izin, rekap, jadwal kerja adalah satu kelompok. Stok, opname, kas, laporan,
garansi adalah kelompok lain. Sekarang semuanya tercampur menjadi satu
daftar panjang tanpa pemisah.

### 2.2 Usulan: navigasi dua tingkat

Tingkat pertama **kategori**, tingkat kedua **modul**:

| Kategori | Modul |
|---|---|
| Kehadiran | Absensi, Izin & Cuti, Rekap Staf, Jadwal Kerja, Verifikasi Wajah |
| Transaksi | POS, Antrean, Invoice, WhatsApp |
| Keuangan | Kas Titipan, Kas Keluar, Laporan |
| Inventaris | Stok, Opname, Kelola Jasa |
| Layanan | Klaim Garansi, Order Detail |
| Pengaturan | Cabang, Kelola Staf, Profil |

Desktop: sidebar tetap di kiri, lebar 260px, kategori expandable dengan
modul di bawahnya. Mengambang di atas layar di atas `md`.
Tablet: sidebar bisa dibuka-tutup dengan tombol di header, lebar 280px,
overlay dengan bayangan. Mobile: navigasi bawah sekarang, lima posisi
terbaik, memuat daftar modul lengkap lewat tombol "Semua Modul".

### 2.3 Konsekuensi teknis

`lib/rbac.ts` sekarang menyimpan menu profil datar. Katalog baru menambah
satu lapis: `category -> items -> permission`. Semua permission tetap sama,
hanya tempat menyimpannya yang berubah, jadi hak akses tidak ikut berubah.

Layout `px-gutter` dan `pb-nav` perlu disesuaikan. Padding bawah `pb-nav`
hanya berlaku di mobile. Di tablet dan desktop sidebar mengambil ruang kiri,
jadi konten mendapat padding kiri, dan ruang bawah hanya perlu untuk
bilah aksi yang masih menempel.

### 2.4 Urutan pengerjaan

1. Katalog modul di `lib/rbac.ts` dengan pengelompokan.
2. Sidebar desktop, di balik breakpoint baru.
3. Halaman daftar modul di mobile sebagai pengganti navigasi bawah yang
   terlalu sempit.
4. Penyesuaian ruang bawah dan padding per ukuran.

### 2.5 Yang perlu diputuskan

- Berapa lebar sidebar yang nyaman di layar 1280px ke atas?
- Kategori mana yang paling sering dibuka tiap peran, supaya bisa dijadikan
  kategori paling atas?
- Apakah perlu mode gelap? sekarang belum ada sama sekali.
