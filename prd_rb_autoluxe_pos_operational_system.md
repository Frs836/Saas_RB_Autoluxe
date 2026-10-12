# Product Requirement Document (PRD) — Versi 2.0

## Sistem POS, Multi-Cabang & Operasional Workshop — RB AUTOLUXE

---

| Parameter | Detail |
| --- | --- |
| **Nama Sistem** | RB AUTOLUXE POS & Operational Management System |
| **Klien / Workshop** | RB AUTOLUXE (Car Wash, Motorcycle Wash, Detailing & Coating) — *Multi-Branch Edition* |
| **Status Dokumen** | Rebuilt & Updated for Multi-Branch, Inventory & Strict Attendance Audit |
| **Prinsip Biaya** | 100% Free Tier (Nol Rupiah Operational Cost) |
| **Platform Standard** | Progressive Web App (PWA) — Responsive Mobile Portrait & Tablet Landscape |

---

## 1. Pendahuluan & Latar Belakang

**RB AUTOLUXE** adalah workshop yang bergerak di bidang *car wash*, *motorcycle wash*, *detailing*, dan *coating* yang kini berkembang menjadi sistem operasional **Multi-Cabang**. Dalam menjalankan operasional sehari-hari di setiap cabang, terdapat beberapa pembaruan kebutuhan krusial:

1. **Jam Operasional & Kepatuhan Kehadiran:** Workshop beroperasi resmi pukul **07:30 hingga 21:00 WIB**. Keterlambatan sekecil apapun (1 menit pun) harus tercatat secara otomatis oleh sistem, dihitung durasi menitnya, mewajibkan alasan, dan dimasukkan ke dalam laporan audit ekspor Excel bagi manajemen.
2. **Keamanan & Isolasi Multi-Cabang (Opsi 2):** Pendaftaran akun staf dilakukan di awal, namun hak akses operasional dikunci secara ketat berdasarkan penugasan cabang (`branch_id`) oleh Owner atau Maintainer. Karyawan hanya dapat masuk ke sistem operasional cabang tempat mereka bekerja dan tidak dapat mengakses data cabang lain.
3. **Kendala Kas & Transaksi:** Mencegah kebocoran kas sebelum kasir hadir melalui *Kas Titipan Operasional*, yang didukung dengan antarmuka POS bergaya **Moka POS** (katalog grid visual, kategori cepat, varian kendaraan, diskon kilat, dan struk WhatsApp).
4. **Audit Stok & Inventaris:** Kebutuhan pencatatan stok masuk (*Stock In*) dari supplier, pemotongan stok otomatis (*Stock Out*) berdasarkan pemakaian layanan per SPK, serta opname audit fisik bulanan yang terisolasi per cabang.

---

## 2. Tujuan & Sasaran Sistem

* **Otomasi Audit Keterlambatan:** Menegakkan kedisiplinan operasional dengan batasan jam masuk 07:30 WIB, pencatatan otomatis status terlambat, kalkulasi menit terlambat, input alasan wajib, dan rekapitulasi audit laporan Excel karyawan.


* **Keamanan Akses Multi-Cabang:** Menjamin isolasi data antar cabang secara ketat melalui relasi `branch_id` di database dan verifikasi akun oleh Maintainer/Owner.


* **Manajemen Stok Real-Time:** Menghindari kehabisan bahan baku cuci/coating melalui pemotongan inventaris otomatis setiap SPK selesai dan pencatatan log stok masuk.
* **Antarmuka POS Cepat (Moka-Style):** Mempercepat proses transaksi kasir melalui katalog visual berbasis kategori, pilihan varian mobil/motor, dan cetak struk digital langsung ke WhatsApp.

---

## 3. Tech Stack Final (100% Free Tier)

| Layer | Teknologi | Alasan & Batasan Free Tier |
| --- | --- | --- |
| **Frontend Framework** | Next.js (App Router) + PWA | Mendukung PWA untuk install langsung di HP/Tablet Android & iOS.

 |
| **Styling & UI** | Tailwind CSS | Desain modern, ringan, dan kompatibel penuh untuk integrasi Google Stitch.

 |
| **Database & Auth** | Supabase (PostgreSQL) | Gratis 500 MB database, Auth terintegrasi, & Row Level Security (RLS) untuk isolasi multi-cabang.

 |
| **Image Storage** | Cloudinary | Gratis 25 GB/bulan storage + Direct Unsigned Upload dari client side.

 |
| **Biometrik Absensi** | MediaPipe Face Detection | Mendeteksi & mencocokkan *vector* wajah + *liveness check* di browser HP.

 |
| **Koneksi Thermal Print** | Web Bluetooth API | Komunikasi langsung browser HP/Tablet ke Printer Thermal Bluetooth.

 |
| **Export Data** | SheetJS (`xlsx`) | Pemrosesan laporan keuangan, inventaris, dan absensi audit langsung ke `.xlsx`.

 |
---

## 4. Pengguna & Matriks Hak Akses (User Roles & Multi-Branch Binding)

### 4.1 Mekanisme Pengikatan Cabang (Multi-Branch Opsi 2)

* Karyawan mendaftarkan akun baru secara mandiri melalui aplikasi.


* Akun tersebut bersifat *unassigned* hingga **Owner** atau **Maintainer** memverifikasi dan mendaftarkan ID karyawan tersebut ke cabang spesifik (Contoh: Cabang Depok atau Cabang Jogja).


* Saat karyawan melakukan login, sistem secara otomatis mengarahkan dan mengunci sesi kerja mereka ke sistem operasional cabang tersebut.


* **Owner & Maintainer** memiliki hak akses global (*multi-branch switch*), memungkinkan mereka memantau laporan keuangan, inventaris, dan absensi gabungan seluruh cabang atau per cabang secara spesifik.



| Role / Sub-Role | Cakupan Akses Cabang | Tanggung Jawab Utama |
| --- | --- | --- |
| **Karyawan (Washer / Coating)** | Terikat pada 1 Cabang Spesifik | Absensi biometrik & GPS, eksekusi cuci/coating, upload foto SOP inspeksi, input kas titipan (jika kasir off). |
| **Admin Kasir** | Terikat pada 1 Cabang Spesifik | POS Moka-Style, arus kas, serah terima kas titipan pagi, kelola stok operasional cabang. |
| **Owner** | Global (Seluruh Cabang / Multi-Branch) | Executive financial analytics, rekapitulasi audit, persetujuan cuti/izin, monitoring lintas cabang. |
| **Maintainer** | Global (Seluruh Cabang / Multi-Branch) | Konfigurasi sistem, jam operasional, titik GPS geofence per cabang, verifikasi wajah master & penugasan cabang staf. |

---

## 5. Spesifikasi Fitur Detail & Pembaruan Sistem

### 5.1 Jam Operasional (07:30 - 21:00) & Audit Keterlambatan Presisi

* **Jam Operasional Resmi:** Jam buka workshop dikunci pada pukul **07:30 WIB** hingga **21:00 WIB**.


* **Validasi Check-In & Kalkulasi Keterlambatan:**
* Jika karyawan melakukan absensi *Check-In* pada pukul `07:31:00 WIB` atau lebih, sistem otomatis:
1. Menandai status absensi sebagai **`Terlambat`** (`is_late = true`).
2. Menghitung **jumlah menit keterlambatan** secara presisi (Contoh: Check-in jam 07:45 = `15 menit terlambat`).
3. Memunculkan **Form Wajib Alasan Keterlambatan** sebelum data absensi tersimpan ke database.


* Jika check-in dilakukan pukul `07:30:00 WIB` atau sebelumnya, status otomatis **`Tepat Waktu`** (`is_late = false`, `late_minutes = 0`).


* **Rekap Audit Keterlambatan di Ekspor Excel:** Laporan kehadiran karyawan memuat kolom rinci: `Nama Staf`, `Cabang`, `Tanggal`, `Jam Check-In`, `Status Kehadiran`, `Menit Terlambat`, dan `Alasan Terlambat`.

### 5.2 Modul Inventaris & Audit Stok (Stock In / Out)

* **Isolasi Stok Per Cabang:** Setiap cabang memiliki data inventaris mandiri (`branch_id`) untuk bahan baku seperti obat coating 9H, shampoo mobil, semir ban, dan lap microfiber.


* **Stok Masuk (Stock In):** Admin atau Maintainer mencatat penambahan stok dari supplier (tanggal, nama barang, jumlah, dan harga beli).
* **Pemotongan Stok Otomatis (Stock Out):** Ketika sebuah SPK dengan layanan tertentu berstatus `completed`, sistem secara otomatis mengurangi stok inventaris bahan baku terkait sesuai resep/formula layanan tersebut.
* **Audit Opname Fisik:** Fitur pencatatan opname fisik bulanan untuk mendeteksi selisih antara stok sistem dan stok fisik di gudang cabang.

### 5.3 Antarmuka POS ala Moka POS (Screen 05 & 06)

* **Layout Grid Katalog Visual:** Layar kasir didesain khusus untuk tablet *landscape* dengan kategori produk cepat di sisi kiri (Cuci, Detailing, Coating, Add-ons) dan grid kartu produk visual di tengah.


* **Pilihan Varian & Diskon Kilat:** Kasir dapat memilih ukuran kendaraan (Size S/M/L/XL untuk mobil atau jenis motor), menambahkan catatan khusus, menerapkan diskon kilat, serta memilih metode pembayaran (Cash, QRIS, Transfer Bank).
* **Struk Digital WhatsApp:** Tombol instan untuk langsung mengirimkan ringkasan nota dan link *tracking* publik ke nomor WhatsApp pelanggan via skema `wa.me`.



### 5.4 Autentikasi Biometrik Wajah & Geofencing GPS Cabang

* **Verifikasi Wajah Master:** Pendaftaran foto awal oleh staf diverifikasi oleh Maintainer (`is_face_verified = true`) sebelum diizinkan melakukan absensi harian.


* **Geofencing Cabang:** Validasi GPS mencocokkan posisi perangkat karyawan dengan koordinat spesifik cabang tempat ia bertugas (radius toleransi $\le 30 \text{ meter}$).



### 5.5 Link Tracking Klien Publik (`RBA-[YYYYMMDD]-[PLAT]`)

* Pelanggan menerima token unik yang bersih untuk memantau progres pengerjaan kendaraan secara *real-time* lewat HP tanpa login, mencakup status tahap pengerjaan, estimasi selesai, galeri foto *Before-Process-After*, serta catatan fisik kendaraan.



### 5.6 Modul Pendukung Lainnya (Inherited from v1.1)

* **Kas Titipan Operasional & Serah Terima Shift:** Pencatatan uang tunai masuk sebelum kasir hadir, yang kemudian diaudit dan diserahterimakan saat kasir/admin mulai bertugas.


* **Petty Cash (Kas Keluar):** Pencatatan pengeluaran operasional cabang wajib melampirkan foto nota.


* **Klaim Garansi & Komplain:** Berbasis pencarian plat nomor untuk mengecek masa aktif garansi coating.


* **Pengajuan Izin / Cuti / Sakit (`time_off_requests`):** Form pengajuan ketidakhadiran denganlampiran surat dokter/alasan untuk disetujui Owner/Maintainer.



---

## 6. Rencana Tahapan Eksekusi Development

```
[Phase 1] Finalisasi Markdown PRD Multi-Branch & Inventory (Selesai)
    └── [Phase 2] Pembaruan UI Design Stitch (Layout Moka POS & Multi-Branch Switcher)
            └── [Phase 3] Pembaruan Skema Supabase & RLS Multi-Branch (Branch Isolation)
                    └── [Phase 4] Coding & Slicing Frontend Next.js (PWA)
                            └── [Phase 5] Testing Integrasi Absensi, Jam 07:30, & Thermal Bluetooth
                                    └── [Phase 6] Deployment Final di Vercel

```