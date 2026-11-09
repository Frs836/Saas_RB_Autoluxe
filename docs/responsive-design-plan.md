# Rencana Desain Responsive — RB AUTOLUXE
**Laporan Investigasi & Perencanaan Responsive Desktop**
*Dibuat: Januari 2025 | Status: READ-ONLY Investigation*

---

## Executive Summary

RB AUTOLUXE adalah PWA operasional workshop multi-cabang yang dibangun **mobile-first secara eksklusif**. Seluruh layout mengasumsikan viewport 360–430px. Tidak ada satu pun breakpoint desktop yang aktif — `tailwind.config.ts` tidak mendefinisikan breakpoint custom, artinya hanya breakpoint bawaan Tailwind (`sm`, `md`, `lg`, `xl`, `2xl`) yang tersedia namun **tidak dipakai** di komponen manapun.

Dua komponen kunci yang paling hardcode mobile-only:
1. **`BottomNav`** (`components/dashboard/bottom-nav.tsx`) — fixed bottom bar dengan tinggi 68px, tidak ada counterpart desktop.
2. **`SubPageHeader`** (`components/pos/sub-page-header.tsx`) — sticky header dengan tombol back, identik di semua 20+ halaman sub-page.

Terdapat **8 role** (owner, admin_kasir, maintainer, karyawan, manager, finance, kepala_karyawan) dengan bottom nav yang berbeda per role. Desktop harus mempertahankan diferensiasi ini melalui sidebar.

**Rekomendasi utama:** Gunakan pola **Collapsible Sidebar** (72px icon-only → 240px expanded) untuk desktop ≥1024px, tetap pertahankan bottom nav untuk mobile <1024px. Design system sudah mendokumentasikan spesifikasi sidebar ini di `design-system.md` bagian 6.1 — tinggal diimplementasikan.

---

## 1. Audit Mobile Layout Sekarang

### 1.1 Struktur Layout Universal

Setiap halaman menggunakan pola yang sama persis:

```
<div className="flex flex-col w-full min-h-screen pb-nav-plain">
  <SubPageHeader ... />       ← sticky top, pt-safe
  <main>                      ← konten scroll
    <KomponenConsole ... />
  </main>
  <BottomNav role={...} />    ← fixed bottom
</div>
```

Atau untuk halaman utama (Dashboard):
```
<div className="flex flex-col w-full pb-nav-plain min-h-screen">
  <DashboardHeader ... />     ← sticky top, pt-safe
  <div className="px-gutter pt-space-md grid grid-cols-2 gap-space-md">
    ...kartu mosaic 2-kolom
  </div>
  <BottomNav role={...} />    ← fixed bottom
</div>
```

### 1.2 CSS Custom Properties yang Menjadi Pondasi Mobile

Dari `app/globals.css`:

| Token | Nilai | Deskripsi |
|---|---|---|
| `--nav-h` | 68px | Tinggi bottom navigation bar |
| `--nav-h-fab` | 88px | Tinggi efektif termasuk FAB yang menonjol |
| `--action-bar-h` | 104px | Tinggi action bar melayang (56px tombol + 24px padding) |
| `.pb-nav` | `calc(88px + safe-area + 24px + 104px)` | Padding bawah halaman dengan action bar |
| `.pb-nav-plain` | `calc(88px + safe-area + 24px)` | Padding bawah halaman tanpa action bar |
| `.bottom-nav-offset` | `calc(88px + safe-area)` | Posisi action bar melayang |
| `.pt-safe` | `max(env(safe-area-inset-top), 8px)` | Padding atas untuk notch/dynamic island |
| `.pb-safe` | `env(safe-area-inset-bottom, 0px)` | Padding bawah untuk home indicator |

### 1.3 Komponen yang Hardcode Mobile-Only

| Komponen | File | Alasan Mobile-Only |
|---|---|---|
| `BottomNav` | `components/dashboard/bottom-nav.tsx` | `fixed bottom-0`, tinggi `var(--nav-h)`, FAB link ke `/pos` |
| `DashboardHeader` | `components/dashboard/dashboard-header.tsx` | `sticky top-0`, `pt-safe` untuk notch iOS/Android |
| `SubPageHeader` | `components/pos/sub-page-header.tsx` | `sticky top-0`, `pt-safe`, tombol back, `h-16` |
| `NotificationBell` | `components/dashboard/notification-bell.tsx` | Berada di dalam DashboardHeader |
| `.pb-nav`, `.pb-nav-plain` | `app/globals.css` | Offset untuk bottom nav |
| `.bottom-nav-offset` | `app/globals.css` | Posisi elemen melayang di atas bottom nav |

### 1.4 Safe Area (Notch / Dynamic Island)

`app/layout.tsx` menetapkan:
- `viewportFit: "cover"` — konten bisa masuk ke notch area
- `appleWebApp.statusBarStyle: "black-translucent"` — status bar transparan
- `themeColor: "#0f172a"` — warna dark untuk status bar

Efek: header harus pakai `.pt-safe` agar tidak tertutup status bar. Pada desktop, ini tidak diperlukan.

---

## 2. Design System Inventory

### 2.1 Warna (dari `tailwind.config.ts` + `design-system.md`)

**Brand Blue:**
| Token Tailwind | Nilai Hex | Penggunaan |
|---|---|---|
| `brand-50` | `#EFF6FF` | Background icon, active tint |
| `brand-100` | `#DBEAFE` | Border subtle, tint ringan |
| `brand-200` | `#BFDBFE` | Highlight accent |
| `brand-400` | `#60A5FA` | Hover state, gradient end |
| `brand-500` | `#2563EB` | Primary button, active state |
| `brand-600` | `#1D4ED8` | Teks link, icon aktif |
| `brand-700` | `#1E40AF` | Dark accent |

**Canvas & Surface:**
| Token | Nilai | Penggunaan |
|---|---|---|
| `canvas` | `#F0F4FA` | Background halaman (global) |
| `surface` | `#FFFFFF` | Kartu, header, nav |
| `clay-overlay` / `surface-overlay` | `#EBF2FA` | Sub-kartu |
| `surface-container-low` | `#F3F3FE` | Input field background |
| `surface-container` | `#EDEDF9` | Divider, section bg |
| `surface-container-high` | `#E7E7F3` | Tag, chip unselected |

**Semantik:**
| Token | Base | Surface | Text |
|---|---|---|---|
| Success | `#10B981` | `#ECFDF5` | `#065F46` |
| Warning | `#F59E0B` | `#FEF3C7` | `#78350F` |
| Danger | `#EF4444` | `#FEE2E2` | `#991B1B` |

**Teks:**
| Token | Nilai |
|---|---|
| `text-primary` | `#0F172A` |
| `text-secondary` | `#475569` |
| `text-muted` | `#94A3B8` |

### 2.2 Tipografi (Plus Jakarta Sans)

| Level | Size | Weight | Token Tailwind | Penggunaan |
|---|---|---|---|---|
| `metric-display` | 28px/34px | 700 | `text-metric-display` | Angka kas, omzet |
| `headline-1` | 20px/26px | 600 | `text-headline-1` | Judul halaman dashboard |
| `headline-2` | 16px/22px | 600 | `text-headline-2` | Judul kartu, header sub-page |
| `body-bold` | 14px/20px | 600 | `text-body-bold` | Label tombol, table header |
| `body-regular` | 14px/20px | 400 | `text-body-regular` | Konten, deskripsi |
| `caption` | 12px/16px | 500 | `text-caption` | Timestamp, label kecil |
| `micro-badge` | 10px/12px | 700 | `text-micro-badge` | Badge, label singkat |

### 2.3 Spacing (Custom Tokens)

| Token | Nilai | Ekuivalen Tailwind |
|---|---|---|
| `space-xs` | 0.25rem (4px) | `p-1` |
| `space-sm` | 0.5rem (8px) | `p-2` |
| `space-md` / `gutter` | 1rem (16px) | `p-4` |
| `space-lg` / `margin` | 1.5rem (24px) | `p-6` |
| `space-xl` | 2rem (32px) | `p-8` |

Catatan: `px-gutter` adalah padding horizontal standar semua halaman = 16px.

### 2.4 Shadow & Efek Clay

| Kelas CSS | Box Shadow | Penggunaan |
|---|---|---|
| `.clay-card` | `0px 12px 28px -6px rgba(37,99,235,0.12) + inner highlight` | Kartu utama |
| `.clay-nav` | `0px 12px 28px -6px rgba(37,99,235,0.12)` | Bottom nav bar |
| `.clay-fab` | `0px 10px 22px rgba(37,99,235,0.32) + inner` | FAB button |
| `.clay-glow` | `0px 10px 22px rgba(37,99,235,0.32)` | Gradient card glow |
| `.primary-gradient` | `linear-gradient(135deg, #1D4ED8 → #60A5FA)` | Hero card, FAB |

### 2.5 Border Radius

| Token | Nilai | Penggunaan |
|---|---|---|
| `rounded-lg` | 12px | Input field, item list |
| `rounded-xl` | 16px | Kartu standar |
| `rounded-2xl` | 20px | Kartu metric utama, sidebar |
| `rounded-3xl` | 24px | Bottom nav, modal besar |
| `rounded-full` | 9999px | Avatar, FAB, pill badge |

---

## 3. Navigasi dan Struktur Halaman Saat Ini

### 3.1 Bottom Navigation per Role

`BottomNav` mengambil konfigurasi dari `BOTTOM_NAV_BY_ROLE` di `lib/rbac.ts`. Setiap role mendapat 4 item (kiri-kiri | FAB tengah | kanan-kanan):

| Role | Item 1 | Item 2 | FAB (jika ada) | Item 3 | Item 4 |
|---|---|---|---|---|---|
| `karyawan` | Beranda | Absensi | ✅ `/pos` | Antrean | Izin |
| `kepala_karyawan` | Beranda | Antrean | ✅ `/pos` | Stok | Absensi |
| `admin_kasir` | Beranda | Antrean | ✅ `/pos` | Kas | Omset |
| `finance` | Beranda | Laporan | ✗ | Rekap | Profil |
| `manager` | Beranda | Antrean | ✅ `/pos` | Stok | Rekap |
| `maintainer` | Beranda | Antrean | ✅ `/pos` | Stok | Rekap |
| `owner` | Beranda | Antrean | ✅ `/pos` | Laporan | Profil |

FAB hanya muncul untuk role yang punya izin `pos.create`: karyawan, kepala_karyawan, admin_kasir, manager, maintainer, owner. Finance tidak mendapat FAB.

### 3.2 Inventaris Halaman Lengkap

**Halaman Utama (diakses dari Bottom Nav):**

| # | Route | Komponen Utama | Role yang Akses | Kompleksitas |
|---|---|---|---|---|
| 1 | `/dashboard` | `DashboardHeader` + mosaic grid | Semua | Sedang |
| 2 | `/absensi` | `AttendanceConsole` | Semua | **Tinggi** (kamera, GPS, face-ID) |
| 3 | `/pos/orders` | `OrderQueue` | Semua | **Tinggi** (tabs, real-time, aksi) |
| 4 | `/pos` | `PosConsole` | Semua (pos.create) | **Sangat Tinggi** (katalog, checkout, multi-step) |
| 5 | `/kas` | `KasConsole` | admin_kasir, manager, maintainer, owner | **Tinggi** (tabs, form, daftar) |
| 6 | `/stok` | `StockManager` | Semua (stock.claim) | Sedang |
| 7 | `/laporan` | `LaporanView` | admin_kasir, finance, manager, maintainer, owner | **Tinggi** (grafik, multi-tab) |
| 8 | `/omset` | `OmsetView` | admin_kasir, manager, maintainer, owner | Sedang |
| 9 | `/rekap` | `RekapConsole` | Semua kecuali karyawan | **Tinggi** (tabel staf, kalender) |
| 10 | `/izin` | `TimeOffConsole` | Semua | Sedang |
| 11 | `/profil` | `ProfilView` + `AccountSettings` | Semua | Sedang |

**Sub-Halaman (diakses dari menu Profil / navigasi internal):**

| # | Route | Komponen Utama | Izin | Kompleksitas |
|---|---|---|---|---|
| 12 | `/shift` | `ShiftConsole` | cash.shift_manage | Sedang |
| 13 | `/rekap` | `RekapConsole` | attendance.audit | Tinggi |
| 14 | `/komisi` | `KomisiView` | reports.komisi | Sedang |
| 15 | `/garansi` | `GaransiConsole` | warranty.manage | Sedang |
| 16 | `/pengaturan/cabang` | `BranchSettingsView` | branch.manage | Sedang |
| 17 | `/pengaturan/karyawan` | `StaffManagementPage` | branch.manage | **Tinggi** |
| 18 | `/pengaturan/jasa` | `ServiceManager` | services.manage | Sedang |
| 19 | `/pengaturan/resep` | `RecipeManager` | services.manage | Sedang |
| 20 | `/pengaturan/wajah` | `FaceVerificationList` | branch.manage | Sedang |
| 21 | `/stok/opname` | `StockOpnameView` | stock.approve | Sedang |
| 22 | `/laporan/aktivitas` | Audit trail | reports.audit | Sedang |
| 23 | `/laporan/cashflow` | `CashflowView` | reports.cashflow | Sedang |
| 24 | `/notifikasi` | Notification list | Semua | Ringan |
| 25 | `/whatsapp` | `WhatsappConsole` | whatsapp.draft | Ringan |
| 26 | `/invoice` | `InvoiceHistory` | reports.branch | Sedang |
| 27 | `/import` | `BulkImportConsole` | data.import | Ringan |
| 28 | `/komisi/saya` | `StatistikSayaView` | reports.self | Ringan |
| 29 | `/pos/orders/[id]` | `OrderDetailView` | Semua | **Tinggi** (timeline, foto, aksi) |
| 30 | `/track/[token]` | Public tracking | Publik | Ringan |

**Total: ~30 route** (11 halaman utama + 19 sub-halaman/halaman pendukung).

### 3.3 Quick Actions Dashboard per Role

`quickActionsFor(role)` dari `lib/rbac.ts` mengembalikan maksimal 4 aksi cepat berbasis izin. Ini ditampilkan sebagai grid 4-kolom di dashboard.

---

## 4. Design System untuk Desktop — Keputusan Arsitektur

### 4.1 Keputusan: Collapsible Sidebar (bukan Top Navigation)

**Alasan:**
- Aplikasi ini adalah **operational tool** (bukan website publik), sehingga navigasi persisten di sisi kiri lebih efisien untuk workflow cepat.
- Role memiliki 4–5 item navigasi + FAB; sidebar menampung semua ini plus akses ke sub-menu tanpa klik tambahan.
- Design system di `design-system.md` (bagian 6.1) sudah mendefinisikan spesifikasi collapsible sidebar 72px/240px secara detail — ini adalah intent asli dari desainer.
- Tablet landscape di `frontendspec.md` dan `system_architecture_rb_autoluxe.md` sudah memposisikan layout sebagai "Admin Terminal" dengan sidebar.
- Top navigation bar akan memindahkan logo, notifikasi, branch switcher, dan avatar ke satu baris yang sempit dan tidak optimal untuk role dengan banyak menu.

**Pattern yang dipilih: Collapsible Sidebar Left**
- Mobile (<1024px): Bottom Nav tetap dipertahankan. Tidak ada sidebar.
- Tablet/Desktop (≥1024px): Sidebar muncul. Bottom Nav disembunyikan.
- Sidebar **tidak overlay** (pushes content) — konten bergeser mengikuti lebar sidebar.

### 4.2 Keputusan: Main Content Area

Desktop menggunakan 2-panel layout di halaman tertentu:
- **Panel Kiri (Sidebar):** 72px collapsed / 240px expanded
- **Panel Kanan (Content):** Flex-1, max-width tidak dibatasi
- **Dashboard:** Upgrade grid dari 2-kolom ke 3-kolom (bento grid)
- **POS:** Split view — katalog di kiri, checkout summary di kanan (pola Moka POS)
- **Laporan/Rekap:** Lebar penuh dengan tabel yang lebih lebar

---

## 5. Breakpoint Strategy

### 5.1 Breakpoint yang Digunakan

Menggunakan breakpoint bawaan Tailwind yang sudah tersedia (tidak perlu menambah custom breakpoint):

| Breakpoint | Ukuran | Nama | Penggunaan |
|---|---|---|---|
| Default | 0 – 767px | Mobile | Bottom nav, single column, full-width |
| `md` | 768px – 1023px | Tablet portrait | Hybrid — bottom nav masih ada, content lebih lebar |
| `lg` | ≥1024px | Tablet landscape + Desktop | Sidebar muncul, bottom nav hilang |
| `xl` | ≥1280px | Desktop wide | Grid lebih lebar, max-width content |
| `2xl` | ≥1536px | Desktop ultra-wide | Max-width container, centered layout |

### 5.2 Strategi Per-Breakpoint

**Mobile (default, <768px):**
- Bottom nav tetap, `pb-nav-plain` / `pb-nav` 
- `pt-safe` pada header
- `px-gutter` (16px) outer padding
- Grid 2 kolom untuk mosaic cards

**Tablet Portrait (md, 768px–1023px):**
- Bottom nav tetap ada (masih lebih nyaman untuk touch)
- Header tidak perlu `pt-safe` jika viewport tidak cover
- `px-6` outer padding (24px)
- Grid 3 kolom tersedia untuk dashboard

**Tablet Landscape + Desktop (lg, ≥1024px):**
- Sidebar muncul: `hidden lg:flex` untuk sidebar, `flex lg:hidden` untuk bottom nav
- Content area: `lg:ml-[72px]` (collapsed) atau `lg:ml-[240px]` (expanded)
- `lg:pt-0` — tidak perlu safe area padding pada header sub-page
- `lg:pb-0` — tidak ada bottom nav offset
- Dashboard: Grid 3–4 kolom (bento)

**Desktop Wide (xl, ≥1280px):**
- Content max-width: `max-w-screen-xl mx-auto` pada layout wrapper
- POS console: Split 60/40 layout

---

## 6. Navigation Strategy untuk Desktop

### 6.1 Spesifikasi Sidebar Desktop

Berdasarkan `design-system.md` bagian 6.1:

```
Sidebar Collapsed (default):
  Width: 72px
  Background: #FFFFFF
  Border-right: 1px solid #E2E8F0
  Border-radius: 0 (atau 20px jika floating)
  Shadow: clay-card
  
  Content:
  - Logo rb-logo-new.png (32×32px, centered)
  - Nav items: hanya icon (44×44px, radius 12px)
  - Logout icon di bawah
  
Sidebar Expanded (toggle):
  Width: 240px
  Transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)
  
  Content:
  - Logo + "RB AUTOLUXE" teks
  - Profile header: avatar initials, fullName, roleLabel
  - Branch switcher (jika canSwitchBranch)
  - Nav items: icon + label teks
  - Badge notifikasi unread
  - Logout button
```

**Nav Item States:**
- Normal: icon `text-text-muted`, background `transparent`
- Active: pill background `primary-gradient`, icon `text-on-primary`, shadow `clay-glow`
- Hover: background `brand-50`

### 6.2 Navigasi Item per Role di Sidebar

Sidebar desktop menggunakan set navigasi yang **lebih lengkap** dari bottom nav. Sementara bottom nav hanya menampilkan 4 item utama, sidebar bisa menampilkan lebih banyak:

| Kategori | Item | Izin |
|---|---|---|
| **Utama** | Dashboard | — |
| **Operasional** | Buat Order (POS) | pos.create |
| **Operasional** | Antrean Order | — |
| **Operasional** | Klaim Stok | stock.claim |
| **Operasional** | Garansi | warranty.manage |
| **Kehadiran** | Absensi | attendance.self |
| **Kehadiran** | Rekap Staf | attendance.audit |
| **Kehadiran** | Izin/Cuti | time_off.request |
| **Keuangan** | Shift & Kas | cash.shift_manage |
| **Keuangan** | Kas Keluar | cash.petty_manage |
| **Keuangan** | Laporan | reports.branch |
| **Keuangan** | Omset | reports.omset |
| **Keuangan** | Komisi | reports.komisi |
| **Pengaturan** | Pengaturan Cabang | branch.manage |
| **Pengaturan** | Kelola Staf | branch.manage |
| **Pengaturan** | Kelola Jasa | services.manage |
| **Profil** | Profil Saya | — |

Di mode collapsed, hanya icon yang ditampilkan dengan tooltip on hover.

### 6.3 Header Desktop

Pada desktop, `DashboardHeader` perlu dimodifikasi:
- `pt-safe` → `pt-0` atau `pt-3` (tidak ada notch)
- Branch switcher tetap ada di header (atau dipindah ke sidebar expanded)
- NotificationBell tetap
- Avatar link ke `/profil` tetap

Sub-page header (`SubPageHeader`) di desktop:
- Tombol back (`arrow_back`) tetap ada (fungsi navigasi dipertahankan)
- `pt-safe` → `pt-0` atau `pt-3`
- Tidak perlu sticky `top-0` jika sidebar yang jadi navigasi utama (bisa dibuat non-sticky)

---

## 7. Per-Page Responsive Specification

### 7.1 Dashboard (`/dashboard`)

**Mobile (sekarang):**
- Header sticky + BottomNav
- Grid 2 kolom: hero card (col-span-2) + 2 kartu metric + quick actions (4-col) + live order card

**Desktop (target):**
- Sidebar + header tanpa safe area padding
- Grid 3 atau 4 kolom bento:
  - **Kolom 1 (col-span-2):** Hero card jam WIB + status absensi (lebih kecil, tidak perlu full-width)
  - **Kolom 2 (col-span-1):** Kas titipan / handoff
  - **Kolom 3 (col-span-1):** Order aktif counter
  - **Baris 2:** Quick actions grid (8 item, bukan 4)
  - **Baris 2/3:** Live order card (lebih lebar)
  - **Kolom kanan (col-span-1, sticky):** Notifikasi terakhir + ringkasan shift
- Tidak ada `pb-nav-plain`

**Perubahan komponen:** `DashboardHeader` harus menerima prop `isDesktop` atau deteksi lewat CSS class.

### 7.2 POS Console (`/pos`)

**Mobile (sekarang):**
- Multi-step: catalog → checkout → done (full-page each step)
- Sticky header per step dengan tombol back
- Cart summary floating bar di atas bottom nav

**Desktop (target):**
- **Split layout (lg:grid lg:grid-cols-5)**:
  - **Kiri (col-span-3):** Katalog layanan (filter + grid)
  - **Kanan (col-span-2):** Panel checkout sticky — vehicle form, team picker, payment, total
- Cart tidak perlu floating bar — langsung visible di panel kanan
- Step "done" tetap full-page atau slide-over panel
- Filter kategori di desktop bisa berupa horizontal tabs atau vertical list

**Ini adalah halaman paling kompleks.** Pola "Moka-style POS" sudah disebut di `frontendspec.md` dan `system_architecture_rb_autoluxe.md`.

### 7.3 Antrean Order (`/pos/orders`)

**Mobile (sekarang):**
- Tabs status (scrollable horizontal)
- Kartu order vertikal full-width
- Action buttons di dalam kartu

**Desktop (target):**
- Tabs status tetap (horizontal, lebih besar)
- **Optional: 2-panel** — daftar order di kiri, detail order di kanan (saat kartu diklik)
  - Ini menghilangkan navigasi ke `/pos/orders/[id]` sebagai halaman terpisah
  - Alternatif lebih sederhana: list tetap full-width, detail buka di modal
- Tabel/kartu lebih lebar: tampilkan lebih banyak info (customer name, payment state) tanpa truncate

### 7.4 Absensi (`/absensi`)

**Mobile (sekarang):**
- Kamera full-width (`AttendanceConsole`)
- Form GPS, timer, riwayat 6 hari

**Desktop (target):**
- Kamera dipertahankan (MediaPipe berjalan di browser, tidak berubah)
- Layout 2-kolom: kamera di kiri, data GPS + riwayat di kanan
- Tidak ada perubahan fungsional — hanya layout adjustment

**Catatan penting:** `pt-safe` di `SubPageHeader` harus dihilangkan di desktop untuk halaman ini.

### 7.5 Kas (`/kas`)

**Mobile (sekarang):**
- `pb-nav` (ada floating action bar di atas bottom nav)
- Tabs: Petty Cash | Bayar Nanti
- Kartu kas vertikal

**Desktop (target):**
- Tabs tetap horizontal
- Layout 2-kolom: daftar kas di kiri, form tambah di kanan (panel tetap visible)
- Action bar tidak melayang — tombol "Tambah Kas Keluar" di dalam panel form atau di header

### 7.6 Laporan (`/laporan`)

**Mobile (sekarang):**
- Kartu-kartu finansial vertikal scroll
- Chart sederhana

**Desktop (target):**
- Grid bento 3-4 kolom:
  - **Baris 1:** Metric besar (total income, expense, net) 3 kartu berdampingan
  - **Baris 2:** Chart tren bulanan (lebar penuh atau col-span-2) + Tagihan (col-span-1)
  - **Baris 3:** Unit terjual (tabel) + Stok low (tabel)
- Branch switcher badge lebih prominent

### 7.7 Rekap Kehadiran (`/rekap`)

**Mobile (sekarang):**
- Daftar staf dengan status hari ini
- Filter tanggal

**Desktop (target):**
- **Kiri (col-span-1):** Filter (cabang, bulan, staf)
- **Kanan (col-span-3):** Tabel rekap — lebih banyak kolom visible (tanggal, jam masuk, jam keluar, status, terlambat, GPS score)
- Kalender bulanan bisa ditampilkan full (bukan scroll)

### 7.8 Pengaturan Cabang (`/pengaturan/cabang`)

**Mobile (sekarang):**
- Daftar cabang → form edit inline / modal
- `pb-nav` (ada action bar)

**Desktop (target):**
- Daftar cabang di kiri (sidebar list)
- Form edit cabang di kanan (panel tetap visible, bukan modal)
- Peta geofence bisa lebih besar (sebelumnya kecil di mobile)

### 7.9 Pengaturan Karyawan (`/pengaturan/karyawan`)

**Mobile (sekarang):**
- Daftar staf → panel slide-up untuk edit

**Desktop (target):**
- Tabel staf di kiri, form detail di kanan
- Foto wajah, jadwal, dan status lebih mudah dibaca di tabel

### 7.10 Profil (`/profil`)

**Mobile (sekarang):**
- `ProfilView` (info + menu kategori) + `AccountSettings` (form edit) di halaman yang sama, vertikal scroll

**Desktop (target):**
- Sidebar profil di kiri: avatar, nama, role, branch, menu navigasi
- Konten aktif di kanan: Account Settings, atau sub-menu yang dipilih
- Menu profil bisa menjadi secondary nav di desktop

### 7.11 Halaman-Halaman Sederhana

Halaman berikut hanya perlu adjustment minimum:

| Halaman | Perubahan Desktop |
|---|---|
| `/shift` | Layout 2-kolom: ringkasan kas di kiri, form buka/tutup di kanan |
| `/stok` | Tabel items lebih lebar, panel klaim di kanan |
| `/omset` | Chart lebih besar, metric cards dalam satu baris |
| `/komisi` | Tabel lebih lebar, filter di atas |
| `/izin` | Tabel pengajuan + form tambah side-by-side |
| `/garansi` | Search bar lebih prominent, list + detail 2-panel |
| `/notifikasi` | List vertikal, lebih lebar |
| `/pengaturan/jasa` | Tabel harga per ukuran lebih readable |
| `/pengaturan/resep` | Grid bahan per layanan |
| `/stok/opname` | Tabel opname lebih lebar |

---

## 8. Komponen yang Perlu Dibuat atau Diubah

### 8.1 Komponen Baru yang Harus Dibuat

| Komponen | File | Deskripsi |
|---|---|---|
| `DesktopSidebar` | `components/dashboard/desktop-sidebar.tsx` | Collapsible sidebar 72px/240px, per-role nav items, logo, profile header |
| `AppShell` | `components/app-shell.tsx` | Layout wrapper yang memilih antara mobile (bottom nav) dan desktop (sidebar) |
| `SidebarNavItem` | `components/dashboard/sidebar-nav-item.tsx` | Item nav sidebar dengan icon + label + active state + tooltip di collapsed mode |
| `SidebarHeader` | `components/dashboard/sidebar-header.tsx` | Bagian atas sidebar: logo, nama, branch switcher |

### 8.2 Komponen yang Harus Dimodifikasi

| Komponen | File | Perubahan Yang Diperlukan |
|---|---|---|
| `BottomNav` | `components/dashboard/bottom-nav.tsx` | Tambah `hidden lg:hidden` (sembunyikan di desktop) atau render conditional |
| `DashboardHeader` | `components/dashboard/dashboard-header.tsx` | Hapus `pt-safe` di desktop (`lg:pt-3`), integrasikan dengan sidebar toggle |
| `SubPageHeader` | `components/pos/sub-page-header.tsx` | Hapus `pt-safe` di desktop (`lg:pt-3`), styling tombol back di desktop |
| `PosConsole` | `components/pos/pos-console.tsx` | Tambah split-panel layout di `lg:` breakpoint |
| `KasConsole` | `components/kas/kas-console.tsx` | Hapus floating action bar pattern, gunakan inline form di desktop |
| Semua page files | `app/*/page.tsx` | Ganti `pb-nav` / `pb-nav-plain` dengan `lg:pb-0` |
| `app/globals.css` | — | Tambah CSS variables untuk sidebar width: `--sidebar-w: 72px`, `--sidebar-w-expanded: 240px` |

### 8.3 CSS Variables Baru yang Diperlukan

Tambahkan ke `:root` di `app/globals.css`:

```css
:root {
  /* ... existing vars ... */
  --sidebar-w: 72px;
  --sidebar-w-expanded: 240px;
}

/* Content offset saat sidebar expanded */
.sidebar-expanded .main-content {
  margin-left: var(--sidebar-w-expanded);
}
```

Atau lebih modern menggunakan Tailwind `lg:ml-[72px]` / `lg:ml-[240px]`.

### 8.4 Pola Transisi Mobile ↔ Desktop

```tsx
// Pattern yang direkomendasikan untuk setiap page:
<div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-0 lg:ml-[72px]">
  <SubPageHeader ... className="lg:pt-3" />
  {/* konten */}
  <BottomNav role={role} /> {/* akan hidden via CSS di lg: */}
</div>
```

---

## 9. Implementation Priority

### Priority 1 — Fondasi (Harus diselesaikan dulu)

1. **`AppShell` + `DesktopSidebar`** — ini adalah blok fondasi yang semua halaman bergantung padanya
2. **CSS Variables sidebar** di `app/globals.css`
3. **Modifikasi `BottomNav`** — `hidden lg:hidden` atau conditional render
4. **Modifikasi `DashboardHeader`** + `SubPageHeader` — hilangkan `pt-safe` di desktop (`lg:pt-3`)
5. **Layout wrapper di setiap `app/*/page.tsx`** — tambah `lg:pb-0 lg:ml-[72px]`

### Priority 2 — Halaman Paling Sering Dipakai

6. **Dashboard** — upgrade ke bento grid di desktop
7. **Antrean Order** (`/pos/orders`) — optimasi tabel lebih lebar
8. **Absensi** — 2-panel layout
9. **Laporan** — bento grid

### Priority 3 — Halaman Kasir (Nilai Bisnis Tinggi)

10. **POS Console** (`/pos`) — split-panel Moka style, ini yang paling kompleks
11. **Kas** — inline form, hilangkan floating action bar
12. **Shift** — 2-panel

### Priority 4 — Halaman Pengaturan & Laporan

13. **Pengaturan Cabang** — list + form 2-panel
14. **Pengaturan Karyawan** — tabel + detail
15. **Rekap Kehadiran** — tabel lebih lebar
16. **Profil** — sidebar profile layout

### Priority 5 — Halaman Sederhana

17. Semua halaman lain (Stok, Komisi, Garansi, Izin, Omset, Notifikasi, WhatsApp, Invoice, Import)

---

## 10. Pertanyaan yang Dijawab

### Q1: Berapa banyak halaman utama dan sub-halaman?
**~30 route total:** 11 halaman yang dapat diakses langsung dari bottom nav / navigasi utama, dan 19 sub-halaman/halaman fitur yang diakses dari menu profil atau navigasi internal. Tidak termasuk halaman auth (`/login`, `/register`), tracking publik (`/track/[token]`), dan halaman error/loading.

### Q2: Role apa saja dan apakah layout berbeda per role?
**7 role aktif:** `owner`, `admin_kasir`, `maintainer`, `karyawan`, `manager`, `finance`, `kepala_karyawan`.

Layout **struktur sama** (header + content + nav), tapi **item navigasi berbeda** per role (dikontrol `BOTTOM_NAV_BY_ROLE` di `lib/rbac.ts`). `finance` tidak mendapat FAB. Kartu dashboard berbeda: role dengan `cash.view_branch` melihat Kas Titipan Shift, role dengan `cash.view_own_hold` melihat Kas Titipan Saya. Di desktop, sidebar harus menerapkan filter navigasi yang sama dari `profileMenuFor(role)`.

### Q3: Apa pattern navigasi yang dipakai sekarang?
- **Bottom Nav** (`BottomNav`) — 4 item + FAB tengah, fixed bottom, per-role
- **Sub-Page Header** (`SubPageHeader`) — sticky top dengan back button di semua halaman non-dashboard
- **Dashboard Header** (`DashboardHeader`) — sticky top dengan logo, branch switcher, notification bell, avatar
- Tidak ada sidebar, tidak ada top nav, tidak ada breadcrumb

### Q4: Token Tailwind custom apa yang dipakai?
- **Warna:** `brand-{50,100,200,400,500,600,700}`, `canvas`, `surface`, `clay-overlay`, `surface-overlay`, `text-primary`, `text-secondary`, `text-muted`, `border-subtle`, `border-strong`, `success-*`, `warning-*`, `danger-*`, `whatsapp`
- **Tipografi:** `metric-display`, `headline-1`, `headline-2`, `body-bold`, `body-regular`, `caption`, `micro-badge`
- **Spacing:** `space-xs`, `space-sm`, `space-md`, `space-lg`, `space-xl`, `gutter`, `margin`
- **Shadow:** `clay_card`, `clay_glow`, `subtle`, `inner_highlight`, `modal`, `whatsapp_glow`
- **CSS classes custom:** `.clay-card`, `.clay-nav`, `.clay-fab`, `.clay-glow`, `.primary-gradient`, `.pb-nav`, `.pb-nav-plain`, `.bottom-nav-offset`, `.pt-safe`, `.pb-safe`, `.z-nav`, `.z-action-bar`, `.z-modal`, `.z-toast`

### Q5: Komponen mana yang hardcode mobile-only?
1. `BottomNav` — fixed bottom, tinggi var(--nav-h), hanya muncul di mobile
2. `DashboardHeader` — `pt-safe` untuk notch
3. `SubPageHeader` — `pt-safe` untuk notch
4. CSS classes `.pb-nav`, `.pb-nav-plain` — kalkulasi berdasarkan bottom nav height
5. CSS class `.bottom-nav-offset` — positioning relatif terhadap bottom nav
6. FAB button dalam `BottomNav` — floating above bottom nav, circular

### Q6: Halaman mana yang paling kompleks dan butuh perhatian khusus?
1. **`/pos` (POS Console)** — multi-step wizard (catalog → checkout → done), cart management, team picker, payment states (paid/unpaid/dp), thermal print, WhatsApp nota. Desktop butuh redesign penuh ke split-panel.
2. **`/absensi` (Attendance Console)** — MediaPipe face detection, GPS geofencing, kamera live. Komponen kamera tidak perlu diubah, tapi layout di sekitarnya perlu 2-panel.
3. **`/pos/orders` (Order Queue)** — real-time updates via Supabase subscriptions, multi-tab, aksi status order, team assignment, cancel flow.
4. **`/laporan` (Laporan Eksekutif)** — agregasi data besar, multiple charts, multi-branch scope.
5. **`/rekap` (Rekap Kehadiran)** — tabel staf dengan data GPS, face similarity score, cross-branch view.

---

## 11. Catatan Implementasi Penting

### 11.1 Jangan Ubah Ini di Desktop
- Ukuran touch target minimum 44×44px — tetap pertahankan untuk user yang pakai trackpad/mouse di tablet
- MediaPipe face detection logic — tidak ada perubahan, hanya layout di sekitarnya
- Real-time Supabase subscriptions di `OrderQueue`
- Token warna dan tipografi — konsisten di semua breakpoint
- Font Plus Jakarta Sans — tetap dipakai

### 11.2 Progressive Enhancement Approach
Karena seluruh codebase sudah mobile-first, tambahkan responsive hanya dengan class `lg:` tanpa mengubah class mobile yang ada. Contoh:

```tsx
// Sebelum (mobile-only):
<div className="flex flex-col w-full min-h-screen pb-nav-plain">

// Sesudah (responsive):
<div className="flex flex-col w-full min-h-screen pb-nav-plain lg:pb-0 lg:ml-[72px]">
```

Ini **tidak merusak** tampilan mobile sama sekali.

### 11.3 Brand Logo di Sidebar
Dari `design-system.md`:
> `<Image alt="RB AUTOLUXE" height={32} priority src="/rb-logo-new.png" width={32} />`

Filename lowercase `rb-logo-new.png` — sudah benar di codebase (`DashboardHeader` sudah menggunakan ini dengan benar).

### 11.4 Tidak Ada Breakpoint Custom yang Diperlukan
Tailwind default `lg` (1024px) sudah sesuai dengan target "Tablet Landscape & Desktop ≥1024px" yang disebutkan di `design-system.md` dan `system_architecture_rb_autoluxe.md`. Tidak perlu menambahkan breakpoint custom ke `tailwind.config.ts`.

### 11.5 Z-Index Stack di Desktop
Stack yang ada sudah cukup:
- `.z-nav` (50) → sidebar desktop menggunakan z-index yang sama
- `.z-action-bar` (45) → tidak relevan di desktop (tidak ada floating bar)
- `.z-modal` (70) → tetap
- `.z-toast` (60) → tetap

Sidebar desktop perlu `z-index: 50` agar di atas konten tapi di bawah modal.

---

*Laporan ini dihasilkan dari investigasi read-only pada codebase RB AUTOLUXE. Tidak ada perubahan kode dilakukan dalam proses pembuatan dokumen ini.*
