# USER FLOWS SPECIFICATION RB AUTOLUXE — Versi 2.0

## 1. FLOW 1: PENDAFTARAN AKUN & PENGIKATAN CABANG (MULTI-BRANCH OPSI 2)

**Kondisi Awal:**
Karyawan baru mendaftarkan akun di sistem, namun belum terikat pada cabang operasional manapun hingga dikonfirmasi oleh manajemen.

**Langkah Alur:**

1. Staf melakukan pendaftaran akun mandiri (email dan kata sandi). Status akun awal bersifat *unassigned*.
2. Owner atau Maintainer membuka menu Kelola Staf pada dashboard global.
3. Owner atau Maintainer memilih akun staf tersebut dan menautkannya ke cabang spesifik (`branch_id`, misal Cabang Depok atau Cabang Jogja).
4. Sistem memperbarui relasi `branch_id` pada tabel `profiles`.
5. Saat staf melakukan login berikutnya, sistem otomatis mengarahkan dan mengunci sesi kerja mereka ke sistem operasional cabang tersebut tanpa akses ke data cabang lain.

---

## 2. FLOW 2: ABSENSI BIOMETRIK, GEOFENCING GPS, & AUDIT KETERLAMBATAN (07:30 WIB)

**Kondisi Awal:**
Karyawan terikat cabang membuka menu absensi di perangkat seluler.

**Langkah Alur:**

1. Karyawan menekan tombol Buka Kamera Absensi.
2. Aplikasi meminta izin akses lokasi GPS dan kamera dari peramban.
3. Cabang Keputusan 1: Apakah izin GPS atau kamera ditolak?
* Ya: Tampilkan pesan kesalahan "Akses kamera dan lokasi wajib diizinkan" dan kunci tombol kirim.
* Tidak: Lanjutkan ke langkah 4.


4. MediaPipe Face Landmarker memindai wajah secara langsung dengan *liveness detection*.
5. Karyawan menekan tombol Ambil Absen.
6. Aplikasi mengambil koordinat Latitude dan Longitude melalui Geolocation API dan mencocokkannya dengan radius $\le 30$ meter dari titik GPS cabang terkait.


7. Cabang Keputusan 2: Validasi Jam Operasional (07:30 WIB).
* Apakah waktu check-in melebihi pukul `07:30:00 WIB`?
* Ya: Sistem otomatis mencatat `is_late = true`, menghitung durasi keterlambatan secara presisi dalam satuan menit (`late_minutes`), dan menampilkan **Form Wajib Alasan Keterlambatan**.
* Tidak: Status tercatat `is_late = false`, `late_minutes = 0`.




8. Aplikasi mengompres foto selfie ke format WebP di bawah 100 KB, mengunggahnya ke Cloudinary, dan menyimpannya ke tabel `attendances`.


9. Data keterlambatan, durasi menit, dan alasan tercatat secara otomatis ke dalam rekapitulasi audit laporan Excel manajemen.

---

## 3. FLOW 3: PEMBUATAN ORDER POS (MOKA-STYLE) & PEMOTONGAN STOK OTOMATIS

**Kondisi Awal:**
Kasir atau staf operasional membuka antarmuka POS grid katalog visual di tablet *landscape*.

**Langkah Alur:**

1. Pengguna memilih kategori cepat di sisi kiri dan menambahkan layanan ke keranjang belanja interaktif.
2. Pengguna memasukkan nomor plat kendaraan, kategori ukuran kendaraan (Size S, M, L, XL, Motor), model kendaraan, serta nama dan nomor WhatsApp pelanggan.


3. Pengguna memilih anggota tim pengerjaan melalui Multi-Select Karyawan (1–5 orang, tersimpan ke relasi `order_assignments`).


4. Pengguna memilih metode pembayaran (Cash, QRIS, Bank Transfer) atau mengaktifkan opsi Kas Shift Pagi (`hold_shift_pagi`).


5. Sistem memvalidasi Zod schema, membuat nomor order unik dan *tracking token* ringkas `RBA-[YYYYMMDD]-[PLAT]`.


6. Saat order berhasil dibuat, sistem mencatat data ke tabel `orders` dan `order_items` yang terisolasi berdasarkan `branch_id` cabang aktif.
7. Sistem otomatis memicu pemotongan stok bahan baku di gudang cabang terkait (`inventory_items`) apabila layanan membutuhkan bahan habis pakai.
8. Aplikasi memicu tombol interaktif `wa.me` untuk mengirimkan nota digital dan tautan lacak publik langsung ke WhatsApp pelanggan.



---

## 4. FLOW 4: INSPEKSI KENDARAAN, SOP FOTO BERTAHAP, & QC BERSYARAT

**Kondisi Awal:**
Kendaraan berada dalam antrean pengerjaan di cabang terkait.

**Langkah Alur:**

1. Karyawan memilih kendaraan dan menekan tombol Mulai Pengerjaan (`in_progress`).


2. Karyawan mengunggah foto inspeksi bertahap (Before, Process, After) disertai kolom catatan kondisi fisik wajib minimal 5 karakter.


3. Setelah tahap foto *After* diunggah, Karyawan menekan tombol Selesai/Ajukan QC.
4. Cabang Keputusan: Kategori paket layanan?
* Paket `wash` (cuci): Status order langsung berubah menjadi `completed` (SKIP QC).


* Paket `coating`: Status order berpindah ke `qc_review` untuk diperiksa oleh Admin atau Owner. Setelah disetujui, status menjadi `completed` dan sistem otomatis menerbitkan garansi 180 hari (`orders.warranty_until`).




5. Seluruh alur divalidasi oleh RPC `apply_order_status` di database.



---

## 5. FLOW 5: VERIFIKASI SERAH TERIMA KAS SHIFT PAGI (ADMIN)

**Kondisi Awal:**
Admin atau Kasir membuka menu Audit Shift untuk menerima setoran uang tunai dari Karyawan operasional yang bertugas sebelum kasir hadir.

**Langkah Alur:**

1. Admin memilih nama Karyawan penyerah kas.
2. Sistem menghitung akumulasi total nominal dari tabel orders dengan status `hold_shift_pagi`.


3. Admin menghitung uang fisik secara langsung dan memasukkan nominalnya ke sistem.
4. Admin menekan tombol Verifikasi Serah Terima.
5. Sistem memanggil fungsi RPC untuk mencatat data ke tabel `shift_handoffs`, memperbarui status order menjadi `paid`, dan menghitung selisih kas fisik.


6. UI menampilkan status verifikasi dan membersihkan lencana kas pending pada profil Karyawan.



---

## 6. FLOW 6: PELACAKAN KENDARAAN REAL-TIME (PELANGGAN PUBLIK)

**Kondisi Awal:**
Pelanggan membuka tautan `/track/[token]` dari pesan WhatsApp tanpa perlu melakukan login.

**Langkah Alur:**

1. Pelanggan mengakses halaman web pelacakan.


2. Middleware memeriksa pembatasan akses (*rate limiting*) maksimal 30 permintaan per menit.


3. Aplikasi memuat data pengerjaan dan galeri foto inspeksi menggunakan kebijakan Supabase RLS publik.


4. Supabase Realtime Subscription aktif pada tabel orders.


5. Ketika karyawan di workshop memperbarui status atau mengunggah foto baru, peramban pelanggan memperbarui tampilan *progress bar* dan galeri secara seketika tanpa *refresh* halaman.



---

## 7. FLOW 7: AUDIT KETERLAMBATAN, KEAMANAN, & REKAPITULASI EXCEL (OWNER & MAINTAINER)

**Kondisi Awal:**
Owner atau Maintainer masuk ke dashboard eksekutif multi-cabang.

**Langkah Alur:**

1. Manajemen membuka menu Laporan Audit & Kehadiran.
2. Sistem menyajikan data analitik keuangan dan operasional terisolasi per cabang atau gabungan seluruh cabang.
3. Owner mengunduh laporan Excel (`SheetJS`) yang mencakup sheet rekapitulasi kehadiran dan keterlambatan staf (memuat kolom jam masuk, status terlambat, jumlah menit terlambat, dan alasan).


4. Owner meninjau riwayat persetujuan izin/cuti/sakit (`time_off_requests`) serta log aktivitas sistem.



---

## 8. FLOW 8: PENGAJUAN IZIN / CUTI / SAKIT (SEMUA ROLE OPERASIONAL)

**Kondisi Awal:**
Staf operasional membuka modul Izin & Absensi.

**Langkah Alur:**

1. Staf mengisi form pengajuan (jenis izin/cuti/sakit, rentang tanggal, alasan, dan upload foto bukti surat dokter).


2. Data dikirim ke tabel `time_off_requests` dengan status `pending`.


3. Owner atau Maintainer meninjau pengajuan di dashboard manajemen dan menekan Setujui atau Tolak.


4. Jika disetujui, sistem otomatis membebaskan penalti absensi pada tanggal tersebut.