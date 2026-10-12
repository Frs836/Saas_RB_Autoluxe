# Technical Architecture Specification — Versi 2.0

## RB AUTOLUXE POS, Multi-Branch & Operational Management System

| Parameter | Detail |
| --- | --- |
| **System Name** | RB AUTOLUXE Architecture & Data Flow |
| **Document Version** | 2.0.0 (Multi-Branch & Strict Audit Edition) |
| **Target Platform** | Progressive Web App (PWA) |
| **Infrastructure Cost** | 0 IDR / Month (100% Free Tier Architecture) |

---

## 1. High-Level System Architecture Diagram

Sistem menggunakan pendekatan **Serverless Client-Centric Architecture**. Pemrosesan berat seperti konversi gambar, ekstraksi biometrik wajah, dan pembuatan file Excel dilakukan langsung di browser *client-side* untuk menekan biaya infrastruktur hingga nol rupiah.

```
+-----------------------------------------------------------------------------------+
|                                CLIENT LAYER (PWA)                                 |
|                                                                                   |
|  +---------------------------+  +---------------------------+  +----------------+  |
|  | Mobile Portrait (Ops/Kry) |  | Tablet Landscape (Kasir)  |  | Tracking Klien |  |
|  +---------------------------+  +---------------------------+  +----------------+  |
|               |                               |                        |          |
|  +-----------------------------------------------------------------------------+  |
|  | Client-Side Logic Engines                                                   |  |
|  | - Canvas Image Compressor (.webp <= 150KB)[cite: 2]                        |  |
|  | - MediaPipe Face Vectorizer (128-d Landmark Array)[cite: 2]                 |  |
|  | - Geofencing GPS Calculator (Haversine Formula <= 30m)[cite: 2]             |  |
|  | - Web Bluetooth API Engine (Printer Thermal POS)[cite: 2]                  |  |
|  | - SheetJS Client (.xlsx Exporter)[cite: 2]                                 |  |
|  +-----------------------------------------------------------------------------+  |
+---------------------+-------------------------+-----------------------------------+
                      |                         |
        (Direct Unsigned API Upload)  (REST / Realtime WebSockets)
                      |                         |
                      v                         v
+-----------------------------------+ +---------------------------------------------+
|    IMAGE STORAGE (CLOUDINARY)     | |            SUPABASE BACKEND PLATFORM          |
|                                   | |                                             |
|  - Storage: 25 GB / month (Free)  | |  +---------------------------------------+  |
|  - Features: Direct Upload Preset | |  | PostgreSQL Database (Multi-Branch)    |  |
|  - Output: Public Image CDN URLs  | |  +---------------------------------------+  |
|                                   | |  | Supabase Auth (JWT & Role Metadata)   |  |
|                                   | |  +---------------------------------------+  |
|                                   | |  | Row Level Security (RLS Engine)       |  |
|                                   | |  +---------------------------------------+  |
+-----------------------------------+ +---------------------------------------------+

```

---

## 2. Frontend Architecture (Next.js App Router)

### 2.1 Technology Stack & Core Modules

* **Framework:** Next.js (App Router)


* **Styling:** Tailwind CSS + Headless UI / Lucide React Icons


* **PWA Engine:** `@ducanh2912/next-pwa` (Caching static assets & Offline Shell)


* **Biometric Engine:** `@mediapipe/face_detection` + `@tensorflow/tfjs-core`

* **Printing Engine:** Native Browser `navigator.bluetooth` (Web Bluetooth API)


* **Excel Engine:** `xlsx` (SheetJS)



### 2.2 Breakpoint & Layout Strategy

Sistem dirancang dengan dua orientasi layout utama:

```
[Window Width / Screen Mode]
  ├── Mobile Portrait (360px - 430px)  --> Layout "Operational & Field View"
  │     ├── Module Absensi Selfie (Validasi Jam 07:30 & Keterlambatan)
  │     ├── Check-in Kendaraan & Form Inspeksi SOP
  │     └── Upload Foto SOP (Before/Process/After)
  │
  └── Tablet Landscape (1024px - 1280px) --> Layout "Cashier & Admin Terminal"
        ├── Quick Moka-Style POS Grid System
        ├── Shift Audit & Serah Terima Kas Titipan
        └── Live Monitoring, Inventaris Cabang & Management Dashboard

```

---

## 3. Backend & Storage Architecture

### 3.1 Supabase Architecture (Database & Auth)

Supabase bertindak sebagai database terpusat, pengelola otentikasi, dan pengendali keamanan data.

* **Database Engine:** PostgreSQL (mendukung relasi multi-cabang)


* **Authentication:** Supabase Auth (Email/Username + Password + Metadata Role)


* **Security Layer:** Row Level Security (RLS) diaktifkan pada seluruh tabel untuk isolasi data antar cabang.



### 3.1a Skema Relasi Tabel & Pembaruan Multi-Branch

* `branches`: Menyimpan data cabang workshop (`id`, `branch_name`, `address`, `latitude`, `longitude`, `operating_open_time = '07:30:00'`, `operating_close_time = '21:00:00'`).
* `profiles`: Diperluas dengan relasi `branch_id` (UUID, Foreign Key ke `branches`) untuk implementasi pengikatan akun staf ke cabang spesifik (Opsi 2), `is_face_verified BOOLEAN`, dan `role_specialization` (Washer / Coating Operator).


* `attendances`: Tabel absensi harian yang diperbarui dengan kolom audit keterlambatan: `is_late BOOLEAN`, `late_minutes INTEGER`, dan `late_reason TEXT`.
* `inventory_items` & `stock_logs`: Tabel inventaris bahan baku dan log keluar-masuk stok yang terisolasi per cabang (`branch_id`).
* `order_assignments`: Relasi many-to-many antara `orders` dan `profiles` (tim 1–5 karyawan per order).


* `time_off_requests`: Pengajuan izin/cuti/sakit oleh staf, disetujui oleh Owner/Maintainer.


* `workshop_settings`: Pengaturan titik GPS geofence per cabang yang dikunci oleh Maintainer.



### 3.2 Cloudinary Unsigned Upload Flow

Untuk menghindari konsumsi memori database Supabase dan biaya API server, gambar diunggah secara langsung dari HP ke Cloudinary (*Direct Client Upload*).

```
[HP Karyawan / Camera] 
       │
       ▼ (Ambil Foto via Live Canvas)[cite: 2]
[Compressor Canvas JavaScript][cite: 2]
       │ (Ubah resolusi ke max 1080p, Format WebP, Quality 0.75 -> Size <= 150KB)[cite: 2]
       ▼
[Cloudinary Unsigned API Endpoint][cite: 2]
       │ (POST https://api.cloudinary.com/v1_1/{cloud_name}/image/upload)[cite: 2]
       ▼
[Cloudinary Server] ─── (Return Secure URL) ───► [Client Web PWA][cite: 2]
                                                       │
                                                       ▼ (Simpan URL Teks saja)[cite: 2]
                                             [Supabase PostgreSQL Table][cite: 2]

```

---

## 4. Biometric Face Verification, GPS Geofencing & Late Attendance Engine

### 4.1 Geofencing Radius & Jam Operasional (07:30 - 21:00)

Saat karyawan menekan tombol Absen, browser mengeksekusi `navigator.geolocation.getCurrentPosition()`. Sistem menghitung jarak antara koordinat HP dengan koordinat resmi cabang tempat ia bertugas menggunakan Haversine Formula:

$$\Delta d = 2R \cdot \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$

* **Batas Toleransi Maksimum:** $\le 30 \text{ Meter}$ dari titik GPS cabang.


* **Validasi Waktu Masuk (07:30 WIB):**
* Jika waktu absensi $> 07:30:00 \text{ WIB}$, sistem otomatis mencatat `is_late = true`, menghitung selisih menit (`late_minutes`), dan mewajibkan pengisian `late_reason`.



### 4.2 Client-Side Face Matching Flow

1. **Saat Registrasi Master Wajah (Admin Panel):** MediaPipe mengekstrak *facial landmarks* dan menghasilkan *Face Vector Descriptor* (Array 128 angka float) yang disimpan di tabel `profiles`.


2. **Saat Absensi Harian (Karyawan HP):** MediaPipe melakukan *Liveness Detection* (respon kedipan mata), mencocokkan *vector* selfie dengan *vector* master (tingkat kemiripan $\ge 85\%$).



---

## 5. Security & Row Level Security (RLS) Architecture

Semua akses data dibatasi langsung di tingkat database menggunakan kebijakan Supabase RLS berdasarkan *JWT Role Claims* dan isolasi cabang (`branch_id`).

```sql
-- Contoh Policy Multi-Branch: Staf hanya dapat mengakses data sesuai cabang mereka (branch_id)
CREATE POLICY "Branch Isolation Policy for Orders"
ON orders
FOR ALL
USING (
  branch_id = (SELECT branch_id FROM profiles WHERE id = auth.uid())
  OR auth.jwt() ->> 'role' IN ('owner', 'maintainer')
);

-- Contoh Policy Keterlambatan & Absensi
CREATE POLICY "Attendance Insert Policy"
ON attendances
FOR INSERT
WITH CHECK (
  user_id = auth.uid()
);

-- Contoh Policy Maintainer untuk Workshop Settings
CREATE POLICY "WorkshopSettings Maintainer Policy"
ON workshop_settings
FOR ALL
USING (
  auth.jwt() ->> 'role' IN ('maintainer')
);

```

---

## 6. Integration Drivers & Hardware Protocols

### 6.1 Web Bluetooth API Protocol (Thermal Printer POS)

Browser berkomunikasi langsung dengan Printer Thermal Bluetooth tanpa perantara aplikasi Android native.

```
[Next.js PWA App] 
       │
       ▼ (navigator.bluetooth.requestDevice)[cite: 2]
[Service UUID: 000018f0-0000-1000-8000-00805f9b34fb][cite: 2]
       │
       ▼ (Characteristic Write ESC/POS Commands)[cite: 2]
[Printer Thermal Bluetooth 58mm / 80mm][cite: 2]

```

### 6.2 WhatsApp Scheme Redirection Protocol

Untuk mengirim nota dan link tracking gratis tanpa API Gateway:

```
[Tombol Kirim WA] ──► Format URL Text ──► window.open('https://wa.me/628123456789?text=...')[cite: 2]

```

---

## 7. Data Lifecycle & Maintenance (Free Tier Retention)

1. **Storage Cleanup Strategy:** Foto pengerjaan berumur $> 30$ hari yang sudah selesai dibersihkan dari Cloudinary untuk menjaga batas free tier 25 GB. Data teks audit absensi dan keterlambatan tetap aman di PostgreSQL Supabase.


2. **Client-Side Exporting:** Rekapitulasi absensi audit keterlambatan dan laporan keuangan cabang diexport ke format `.xlsx` menggunakan `SheetJS`.



---
