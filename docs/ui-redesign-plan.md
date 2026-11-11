# Rencana Redesign UI/UX — RB AUTOLUXE
**Dokumen Perencanaan Komprehensif**
*Dibuat berdasarkan audit kode lengkap | Status: Rencana Implementasi*

---

## Ringkasan Eksekutif

Audit ini membaca **30 route halaman** dan seluruh komponen kunci. Temuan utama:

1. **Profil page** memanjang ke bawah secara tidak perlu — `ProfilView` + `AccountSettings` + `PushSubscribeButton` semua tumpuk vertikal dalam satu halaman. Harus dipecah.
2. **PushSubscribeButton** berada di halaman profil, padahal logikanya adalah pengaturan notifikasi — harus pindah ke halaman `/notifikasi` sebagai toggle switch.
3. **Desktop layout** sudah ada sidebar (`DesktopSidebar`) tapi konten halaman-halamannya **tidak memanfaatkan lebar layar sama sekali** — semua masih single-column yang di-stretch ke tengah.
4. **Form inline** masih ada di beberapa halaman (`/pengaturan/karyawan`, `/pengaturan/cabang`, `/pengaturan/jasa`) yang membuat halaman memanjang.
5. **Navigasi balik** beberapa halaman salah `backHref` (misalnya `/laporan/cashflow` dan `/laporan/aktivitas` mengarah ke `/profil`, bukan `/laporan`).
6. **SubPageHeader** menggunakan `window.history.back()` yang menyebabkan masalah navigasi — ini sudah ada di kode tapi ada edge case pada fresh load.

---

## 1. Audit Per Halaman

### 1.1 `/dashboard`

**Masalah yang ditemukan:**
- Grid `grid-cols-2 lg:grid-cols-4` sudah ada tapi konten di dalamnya tidak dioptimalkan untuk lebar penuh desktop
- Quick actions hanya 4 item — di desktop bisa lebih banyak tanpa memenuhi layar
- Kartu live order hanya menampilkan 1 order — tidak ada shortcut ke full queue
- `DashboardHeader` tidak menggunakan `lg:` modifier untuk menghilangkan `pt-safe`

**Solusi:**
- Di desktop: hero card (jam + absensi) di kiri `col-span-2`, kas + counter order di kanan berdampingan
- Quick actions di desktop: tampilkan 8 item (2 baris × 4), bukan 4
- Kartu live order di desktop: lebih detail (team member list, link ke full queue)
- `DashboardHeader` sudah ada `lg:pt-3`, pertahankan

---

### 1.2 `/profil`

**Masalah kritis:**
- Halaman menggabungkan 3 komponen besar secara vertikal: `ProfilView` (identitas + menu modul) + `AccountSettings` (foto, data diri, email, sandi) + `PushSubscribeButton` (notifikasi)
- `AccountSettings` sendiri sudah menggunakan modal untuk form edit — ini **sudah benar** untuk data diri/email/sandi
- `PushSubscribeButton` terpasang di profil tanpa konteks, sedangkan fungsinya adalah pengaturan notifikasi
- Menu "Modul Saya" di `ProfilView` adalah tab accordion — di desktop terasa seperti accordion yang tidak perlu

**Solusi (sesuai keputusan user):**
- Halaman `/profil` hanya menampilkan: **Kartu biru identitas (foto, nama, role)** + tombol "Edit Profil" + menu modul + tombol logout
- Semua form edit (`AccountSettings`) dipindah ke `/profil/edit` sebagai halaman terpisah
- `PushSubscribeButton` dipindah ke `/notifikasi`
- Kartu biru di atas wajib berisi: foto profil, nama, role label, dan **tombol "Edit Profil"** yang navigasi ke `/profil/edit`

---

### 1.3 `/notifikasi`

**Masalah:**
- Tidak ada toggle push notification — hanya daftar notifikasi
- `PushSubscribeButton` yang seharusnya ada di sini justru ada di `/profil`
- Tidak ada kontrol filter (semua notifikasi vs belum dibaca)

**Solusi:**
- Tambahkan section "Pengaturan Notifikasi" di bagian atas halaman, berisi toggle switch untuk push notification
- Toggle switch menggantikan button biasa — gunakan pola `<button role="switch" aria-checked={...}>`
- `PushSubscribeButton` dipindah ke sini dan di-refactor menjadi toggle switch component baru

---

### 1.4 `/pos`

**Masalah:**
- Di desktop, `PosConsole` masih single-column — katalog layanan mengambil seluruh lebar dan checkout summary tidak visible sebelum user scroll jauh ke bawah
- Form vehicle detail (plat, model, ukuran, nama customer) ada di awal, tapi di mobile harus scroll untuk mencapai checkout button

**Solusi:**
- Di desktop (`lg:`): split layout `grid lg:grid-cols-5` — kiri `col-span-3` katalog, kanan `col-span-2` panel checkout sticky
- Panel kanan: vehicle form + team picker + payment state + total + tombol checkout — semua visible sekaligus
- Mobile tetap seperti sekarang (single-column, multi-step)

---

### 1.5 `/pos/orders`

**Masalah:**
- Daftar order hanya kartu vertikal — di desktop tidak memanfaatkan lebar
- Filter tab `scrollable` horizontal di mobile, di desktop bisa horizontal tabs biasa

**Solusi:**
- Di desktop: layout dua panel opsional — daftar di kiri, detail order di kanan (atau gunakan modal)
- Tabs filter lebih besar, tidak perlu scroll horizontal
- Tampilkan kolom tambahan di desktop: customer name, payment state, assigned to — semua visible tanpa truncate

---

### 1.6 `/pos/orders/[id]`

**Masalah:**
- Halaman detail order memanjang sangat panjang: info order + foto inspeksi + timeline + team + warranty + action buttons semua vertikal
- Di desktop tidak ada layout yang membagi info dan action

**Solusi:**
- Di desktop: 2-kolom — kiri info order + items, kanan timeline status + action buttons
- Foto inspeksi tetap di bawah (full width) atau di panel bawah
- Action bar (ubah status, assign team, QC approve) sticky di kanan desktop

---

### 1.7 `/absensi`

**Masalah:**
- Kamera full-width mengambil seluruh layar
- Di desktop tidak ada alasan kamera harus full-width viewport

**Solusi:**
- Di desktop: 2-kolom — kamera di kiri (max `420px`), data GPS + riwayat + status di kanan
- Kamera tetap memiliki max-width constraint agar tidak terasa aneh di monitor besar
- **JANGAN ubah logika MediaPipe/face detection** — hanya layout pembungkusnya

---

### 1.8 `/kas`

**Masalah:**
- Ada floating action bar (`pb-nav` bukan `pb-nav-plain`) — ini adalah bar "Tambah Kas Keluar" yang melayang di atas bottom nav
- Di desktop, action bar melayang ini tidak perlu — form bisa inline atau di panel kanan
- Tab "Bayar Nanti" berisi order cancelled yang tidak bisa dihapus (bug terpisah dari UX)

**Solusi:**
- Di desktop: layout 2-kolom — daftar kas di kiri, form tambah kas keluar di kanan (panel sticky, bukan modal)
- Action bar melayang hanya tampil di mobile, di desktop tombol "Tambah" ada di header panel kanan
- Tab "Bayar Nanti": tambahkan tombol hapus/cancel untuk order yang statusnya `cancelled` (ini bug fix terpisah, tapi perlu direncanakan)

---

### 1.9 `/shift`

**Masalah:**
- Konten shift audit vertikal scroll di mobile dan desktop sama saja
- Form buka/tutup shift tidak ada shortcut yang jelas

**Solusi:**
- Di desktop: ringkasan kas di kiri (`col-span-1`), form + riwayat handoff di kanan (`col-span-2`)
- Tombol "Buka Shift" / "Tutup Shift" lebih prominent

---

### 1.10 `/laporan`

**Masalah:**
- Chart dan kartu finansial vertikal — di desktop `LaporanView` masih single-column
- Tidak memanfaatkan lebar layar sama sekali

**Solusi:**
- Di desktop: bento grid 3-kolom:
  - Baris 1: Metric besar (income, expense, net) — 3 kartu berdampingan
  - Baris 2: Chart tren bulanan (`col-span-2`) + piutang (`col-span-1`)
  - Baris 3: Unit terjual (`col-span-1`) + stok low (`col-span-1`) + revenue per cabang (`col-span-1`)

---

### 1.11 `/rekap`

**Masalah:**
- Tabel staf dan rekap kehadiran di desktop masih sama dengan mobile — tidak ada perbedaan layout
- Filter tanggal dan cabang tersembunyi di dropdown

**Solusi:**
- Di desktop: filter panel di kiri (`col-span-1`, sticky), tabel rekap di kanan (`col-span-3`)
- Tabel di desktop: lebih banyak kolom visible — nama, jam masuk, jam keluar, status, terlambat, face score, GPS score
- Export Excel button lebih prominent di desktop

---

### 1.12 `/izin`

**Masalah:**
- Form pengajuan izin membuka dalam komponen inline yang membuat halaman memanjang
- Tidak ada pemisahan visual antara "Ajukan" dan "Riwayat"

**Solusi:**
- Tombol "Ajukan Izin Baru" membuka **modal floating** (`Modal` component sudah ada)
- Daftar pengajuan tetap di bawah, dikelompokkan: Menunggu → Disetujui → Ditolak
- Di desktop: 2-kolom — form/filter di kiri, daftar pengajuan di kanan

---

### 1.13 `/stok`

**Masalah:**
- Form klaim stok dan daftar stok vertikal scroll
- Di desktop tidak ada layout yang efisien

**Solusi:**
- Di desktop: daftar stok di kiri (tabel, lebih banyak kolom), form klaim di kanan atau modal
- Tombol "Klaim Stok" membuka modal — ini lebih efisien dari form inline

---

### 1.14 `/stok/opname`

**Masalah:**
- `backHref="/stok"` sudah benar
- Form opname bulanan inline dan memanjang

**Solusi:**
- Riwayat opname di kiri, detail / form entry di kanan (desktop)
- Form entry per item tetap dalam halaman yang sama (bukan modal — terlalu panjang untuk modal)

---

### 1.15 `/komisi`

**Masalah:**
- Tabel komisi karyawan tidak memanfaatkan lebar desktop
- Filter bulan/tanggal inline di atas tabel

**Solusi:**
- Di desktop: tabel full-width dengan kolom lebih detail
- Filter dalam header tabel, bukan di atas konten

---

### 1.16 `/komisi/saya`

**Masalah:**
- `backHref="/profil"` — sudah benar (dari profil menu)
- Layout sudah cukup baik untuk mobile, hanya perlu desktop optimization

**Solusi:**
- Di desktop: hero card di kiri, daftar order di kanan

---

### 1.17 `/garansi`

**Masalah:**
- Search bar + daftar order + daftar garansi vertikal
- Tidak ada shortcut untuk melihat garansi aktif

**Solusi:**
- Di desktop: search + filter di panel atas, hasil di bawah
- Tab "Garansi Aktif" vs "Semua" lebih prominent

---

### 1.18 `/omset`

**Masalah:**
- Chart dan metric vertikal

**Solusi:**
- Di desktop: metric cards berdampingan (1 baris 3–4 kartu), chart di bawahnya full-width

---

### 1.19 `/pengaturan/cabang`

**Masalah:**
- Daftar cabang + form edit per cabang vertikal
- Form edit cabang muncul inline (panjang ke bawah) atau bisa dalam modal

**Solusi:**
- Di desktop: list cabang di kiri (`col-span-1`), form detail cabang di kanan (`col-span-3`)
- Peta geofence di panel kanan, lebih besar dari versi mobile
- Di mobile: form edit dalam modal floating

---

### 1.20 `/pengaturan/karyawan`

**Masalah:**
- Daftar staf + panel edit staf inline — halaman sangat panjang di mobile
- Di desktop tidak ada layout yang lebih efisien

**Solusi:**
- Di desktop: tabel staf di kiri, panel detail/edit di kanan (slide-over panel yang sticky)
- Di mobile: panel edit menggunakan slide-up sheet atau modal
- Ini adalah halaman paling kompleks untuk pengaturan

---

### 1.21 `/pengaturan/jasa`

**Masalah:**
- Tabel harga per ukuran (S/M/L/XL/Motor) sempit di mobile, perlu scroll horizontal
- Form tambah/edit jasa inline

**Solusi:**
- Di desktop: tabel harga full-width — semua kolom visible tanpa scroll
- Form tambah/edit dalam modal floating
- Di mobile: horizontal scroll tabel tetap ada tapi dengan sticky kolom nama

---

### 1.22 `/pengaturan/resep`

**Masalah:**
- Grid bahan per layanan vertikal — banyak scroll
- Branch picker sudah ada (horizontal pills di atas)

**Solusi:**
- Di desktop: list layanan di kiri, matrix bahan di kanan
- Di mobile: accordion per layanan

---

### 1.23 `/pengaturan/wajah`

**Masalah:**
- Daftar verifikasi wajah sederhana, tidak ada masalah besar

**Solusi:**
- Di desktop: tabel dengan lebih banyak kolom (foto referensi visible, status, tanggal)

---

### 1.24 `/invoice`

**Masalah:**
- `backHref="/dashboard"` — tapi invoice diakses dari menu profil, bukan dashboard
- Daftar invoice vertikal

**Solusi:**
- Perbaiki `backHref` ke `/profil`
- Di desktop: tabel invoice full-width, preview struk di panel kanan saat baris diklik

---

### 1.25 `/whatsapp`

**Masalah:**
- `backHref="/dashboard"` — padahal diakses dari profil menu
- Daftar order dan composer pesan vertikal

**Solusi:**
- Di desktop: daftar order di kiri, composer pesan di kanan
- `backHref` ke `/profil` atau tambahkan breadcrumb

---

### 1.26 `/laporan/cashflow`

**Masalah:**
- `backHref="/profil"` — ini sudah benar (diakses dari menu keuangan di profil)
- Chart arus kas vertikal

**Solusi:**
- Di desktop: periode + filter di atas, chart di bawah full-width
- Tabel detail per kategori di bawah chart

---

### 1.27 `/laporan/aktivitas`

**Masalah:**
- `backHref="/profil"` — sudah benar
- Tabel audit trail vertikal scroll

**Solusi:**
- Di desktop: filter di panel kiri (sticky), tabel di kanan full-height

---

### 1.28 `/import`

**Masalah:**
- `backHref="/profil"` — sudah benar
- Upload form sederhana

**Solusi:**
- Tidak ada perubahan besar diperlukan

---

## 2. Perubahan Navigasi

### 2.1 Route Baru yang Perlu Dibuat

| Route | Deskripsi |
|---|---|
| `/profil/edit` | Halaman edit profil — berisi `AccountSettings` yang dipindah dari `/profil` |

### 2.2 Navigasi yang Perlu Diperbaiki

| Halaman | `backHref` Saat Ini | `backHref` Benar | Alasan |
|---|---|---|---|
| `/invoice` | `/dashboard` | `/profil` | Invoice diakses dari menu profil, bukan dashboard langsung |
| `/whatsapp` | `/dashboard` | `/profil` | Sama seperti invoice |
| `/laporan/cashflow` | `/profil` | Sudah benar | ✓ |
| `/laporan/aktivitas` | `/profil` | Sudah benar | ✓ |
| `/import` | `/profil` | Sudah benar | ✓ |
| `/komisi/saya` | `/profil` | Sudah benar | ✓ |

### 2.3 Navigasi Internal yang Hilang

| Halaman | Navigasi yang Hilang |
|---|---|
| `/profil` | Tidak ada tombol langsung ke `/profil/edit` (harus dibuat) |
| `/notifikasi` | Tidak ada toggle push notification |
| `/pos/orders` | Daftar order tidak ada link ke `/pos/orders/[id]` yang obvious dari kartu (sudah ada tapi perlu diperjelas) |
| `/laporan` | Tidak ada link ke sub-laporan (`/laporan/cashflow`, `/laporan/aktivitas`) |
| `/stok` | Tidak ada link langsung ke `/stok/opname` dari halaman stok |

### 2.4 Navigasi yang Perlu Ditambahkan

**Dashboard → semua halaman utama**: Quick actions sudah ada, tapi perlu ditambahkan link ke:
- Laporan arus kas (`/laporan/cashflow`) — untuk finance/owner/manager
- Log aktivitas (`/laporan/aktivitas`) — untuk owner/maintainer

**Halaman Laporan (`/laporan`) → sub-laporan:**
- Tambahkan kartu/tombol navigasi ke `/laporan/cashflow` dan `/laporan/aktivitas`

**Halaman Stok (`/stok`) → opname:**
- Tambahkan tombol atau link ke `/stok/opname`

---

## 3. Rencana Profil Page Baru

### 3.1 Wireframe Tekstual `/profil` (Baru)

```
┌─────────────────────────────────────────────┐
│  SubPageHeader: "Profil Saya" ← back        │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  🔵 KARTU BIRU (primary-gradient)   │   │
│  │                                     │   │
│  │  [FOTO] Budi Santoso                │   │
│  │  AVATAR  Admin Kasir                │   │
│  │  64×64px                            │   │
│  │                                     │   │
│  │  [✏️ Edit Profil] ← tombol putih   │   │
│  │   navigasi ke /profil/edit          │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  🏠 Cabang Penempatan               │   │
│  │  RB AUTOLUXE Cabang Utama           │   │
│  │  07:30 – 21:00 WIB    [Lokasi OK ✓] │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  MODUL SAYA                                 │
│  [Staf&Cabang] [Keuangan] [Operasional]     │
│  [Kehadiran] [Layanan]                      │
│                                             │
│  ┌── Tab Aktif Content ───────────────┐    │
│  │  [ikon] Pengaturan Cabang  >        │   │
│  │  [ikon] Kelola Staf        >        │   │
│  │  ...                                │   │
│  └────────────────────────────────────┘   │
│                                             │
│  [Keluar dari Aplikasi] ← danger button     │
│                                             │
│  RB Autoluxe Workshop OS · v0.1             │
└─────────────────────────────────────────────┘
  BottomNav
```

**Catatan implementasi `/profil`:**
- `AccountSettings` dipindahkan sepenuhnya ke `/profil/edit`
- `PushSubscribeButton` dipindahkan ke `/notifikasi`
- Kartu biru harus `primary-gradient`, berisi: foto profil (atau inisial), nama, role label, **tombol "Edit Profil"**
- Tombol "Edit Profil" adalah `<Link href="/profil/edit">` dengan styling `bg-white/20 text-white`
- Halaman tidak memanjang ke bawah dalam — cukup 1 scroll untuk melihat semua

---

### 3.2 Wireframe Tekstual `/profil/edit` (Halaman Baru)

```
┌─────────────────────────────────────────────┐
│  SubPageHeader: "Edit Profil" ← /profil     │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  📷 Foto Profil                     │   │
│  │  [AVATAR 80×80]  [Ganti Foto]       │   │
│  │                  [Hapus Foto]       │   │
│  │  JPG/PNG/WebP max 2MB               │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  👤 Data Diri          [Ubah →]     │   │
│  │  Budi Santoso                       │   │
│  └─────────────────────────────────────┘   │
│  ↓ (modal saat "Ubah" diklik)              │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  📧 Email              [Ganti →]    │   │
│  │  budi@gmail.com                     │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  🔒 Kata Sandi         [Ganti →]    │   │
│  │  ••••••••                           │   │
│  └─────────────────────────────────────┘   │
│                                             │
│  [pesan sukses/error jika ada]              │
│                                             │
└─────────────────────────────────────────────┘
  BottomNav
```

**Catatan implementasi `/profil/edit`:**
- Ini adalah komponen `AccountSettings` yang sudah ada, dipindah ke halaman baru
- `SubPageHeader` dengan `backHref="/profil"`
- Semua modal form (data diri, email, sandi) tetap menggunakan `Modal` component yang sudah ada — ini **sudah benar pola UX-nya**
- Foto profil — upload langsung tanpa modal terpisah (seperti sekarang)
- File baru: `app/profil/edit/page.tsx` — server component yang fetch data dan render `AccountSettings`

---

## 4. Rencana Notifikasi Page

### 4.1 Wireframe Tekstual `/notifikasi` (Dengan Toggle Push)

```
┌─────────────────────────────────────────────┐
│  SubPageHeader: "Notifikasi" ← /dashboard   │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─────────────────────────────────────┐   │
│  │  🔔 Notifikasi Perangkat            │   │
│  │  Aktifkan push notification          │   │
│  │  untuk menerima peringatan           │   │
│  │  meskipun aplikasi ditutup           │   │
│  │                                     │   │
│  │  [Toggle Switch]  ON / OFF          │   │
│  │  ●────────────── (aktif, biru)      │   │
│  │  atau                               │   │
│  │  ──────────────● (nonaktif, abu)    │   │
│  │                                     │   │
│  │  Status: Notifikasi Aktif ✓         │   │
│  │  (atau: Diblok di pengaturan browser)│  │
│  └─────────────────────────────────────┘   │
│                                             │
│  ── Semua Notifikasi ──────── [Tandai Semua]│
│                                             │
│  [🔵] Order #RBA-001 masuk                  │
│        Plat ABC123 · 2 menit lalu          │
│                                             │
│  [🟡] QC order #RBA-002 ditolak             │
│        Review ulang diperlukan · 10 mnt    │
│                                             │
│  [⚫] Absensi tercatat                       │
│        Jam 07:35 WIB · Kemarin             │
│                                             │
│  ... (lebih banyak notifikasi)             │
│                                             │
└─────────────────────────────────────────────┘
  BottomNav
```

**Catatan implementasi toggle push:**
- Buat komponen baru: `components/notification/push-toggle-switch.tsx`
- Ini adalah refactor dari `PushSubscribeButton` — logika sama, tampilan berubah dari button menjadi toggle switch
- Toggle switch menggunakan `<button role="switch" aria-checked={isSubscribed} aria-label="Notifikasi push">` untuk aksesibilitas
- Visual: pill berukuran 44×24px, dengan lingkaran yang bergerak (CSS transition), warna: aktif = `brand-500`, nonaktif = `surface-container-high`
- 4 state sama dengan `PushSubscribeButton`: `loading`, `denied`, `subscribed`, `unsubscribed`
- State `denied`: toggle disabled + teks "Diblok di pengaturan peramban"
- State `unsupported`: section tidak ditampilkan sama sekali
- Hapus `PushSubscribeButton` dari `app/profil/page.tsx` setelah dipindah

---

## 5. Desktop Layout Per Halaman

### Prinsip Umum Desktop (≥1024px)

Setiap halaman di desktop harus:
1. Menggunakan `lg:ml-[72px]` (atau `lg:ml-[240px]` saat expanded) untuk offset sidebar
2. Tidak ada `pt-safe` di desktop (`lg:pt-3`)
3. Tidak ada `pb-nav` / `pb-nav-plain` di desktop (`lg:pb-8`)
4. `BottomNav` sudah `hidden lg:hidden` — tidak perlu ubah per halaman
5. `DesktopSidebar` sudah dirender via `AppShell` atau layout wrapper

**Catatan kritis:** Saat ini `DesktopSidebar` sudah ada di `components/dashboard/desktop-sidebar.tsx` dan sudah diimplementasikan. Masalah utamanya adalah **konten halaman tidak dioptimalkan untuk lebar penuh** — hanya sidebar-nya saja yang ada.

---

### 5.1 Dashboard — Desktop

```
Sidebar 72px | Header (logo, branch, notif, avatar)
─────────────────────────────────────────────────────
         GRID 4-kolom (gap-5, px-6)
┌──────────────────┬─────────┬─────────┬─────────┐
│  Hero Card       │  Kas    │ Order   │  Shift  │
│  Jam + Absensi   │ Titipan │ Aktif   │  Status │
│  col-span-2      │ col-1   │ col-1   │ col-1   │
└──────────────────┴─────────┴─────────┴─────────┘
┌────────────────────────────┬────────────────────┐
│  Quick Actions (8 items)   │  Live Order Card   │
│  col-span-2                │  col-span-2        │
└────────────────────────────┴────────────────────┘
┌────────────────────────────────────────────────┐
│  Notifikasi terbaru (jika ada)  col-span-4     │
└────────────────────────────────────────────────┘
```

---

### 5.2 POS (`/pos`) — Desktop

```
Sidebar 72px
─────────────────────────────────────────────────────
         GRID 5-kolom
┌───────────────────────────────┬────────────────┐
│  Katalog Layanan (col-span-3) │ Panel Checkout  │
│  Filter kategori (tab/pill)   │ (col-span-2)   │
│  Grid jasa                    │ sticky          │
│  Search jasa                  │                │
│                               │ [Plat Nomor]   │
│  [Jasa 1]  [Jasa 2]           │ [Model/Ukuran] │
│  [Jasa 3]  [Jasa 4]           │ [Nama Customer]│
│  [Addon 1] [Addon 2]          │ [Team Picker]  │
│                               │ ─────────────  │
│                               │ [Item dipilih] │
│                               │ Total: Rp xxx  │
│                               │                │
│                               │ [Bayar Tunai]  │
│                               │ [Bayar Nanti]  │
└───────────────────────────────┴────────────────┘
```

---

### 5.3 Order Queue (`/pos/orders`) — Desktop

```
Sidebar 72px | SubPageHeader
─────────────────────────────────────────────────────
  Tabs: [Semua] [Antrean] [Dikerjakan] [QC] [Selesai]
─────────────────────────────────────────────────────
  Tabel order (full-width):
  Order # | Plat | Model | Layanan | Status | Teknisi | Harga | Aksi
  ─────────────────────────────────────────────────
  RBA-001 | B1234 | Avanza M | Full Coating | In Progress | Budi | 850rb | [Detail]
  RBA-002 | D5678 | Vario   | Wash Basic   | Antrean     | -    | 85rb  | [Mulai]
```

---

### 5.4 Kas (`/kas`) — Desktop

```
Sidebar 72px | SubPageHeader
─────────────────────────────────────────────────────
         GRID 2-kolom
┌─────────────────────────┬──────────────────────┐
│  Tabs: [Petty Cash]     │  Form Tambah Kas      │
│       [Bayar Nanti]     │  Keluar (sticky)      │
│                         │                      │
│  Daftar petty cash      │  [Kategori]          │
│  ─────────────────      │  [Jumlah]            │
│  Kamis 10:00 - Bensin   │  [Metode Bayar]      │
│  Rp 150.000             │  [Keterangan]        │
│  ─────────────────      │  [Foto Nota]         │
│  Rabu 14:30 - Service   │                      │
│  Rp 80.000              │  [Simpan Kas Keluar] │
│                         │                      │
│  Total: Rp 230.000      │  ─────────────────── │
│                         │  Handoff Shift:      │
│                         │  Status: Open        │
└─────────────────────────┴──────────────────────┘
```

---

### 5.5 Laporan (`/laporan`) — Desktop

```
Sidebar 72px | SubPageHeader + BranchScopeBadges
─────────────────────────────────────────────────────
  BARIS 1: 3 kartu berdampingan (col-span-1 masing-masing)
  ┌──────────────┬──────────────┬──────────────┐
  │ Total Income  │ Total Expense│ Net Profit   │
  │ Rp 12.500.000│ Rp 3.200.000 │ Rp 9.300.000 │
  └──────────────┴──────────────┴──────────────┘
  
  BARIS 2:
  ┌────────────────────────┬──────────────────┐
  │ Chart Tren 6 Bulan     │ Tagihan          │
  │ (col-span-2)           │ (col-span-1)     │
  │ Bar chart income/exp   │ 3 order unpaid   │
  └────────────────────────┴──────────────────┘
  
  BARIS 3:
  ┌─────────────┬──────────────┬──────────────┐
  │ Revenue     │ Unit Terjual  │ Stok Rendah  │
  │ Per Cabang  │ Top 10       │ Alert        │
  └─────────────┴──────────────┴──────────────┘
  
  Link navigasi ke sub-laporan:
  [→ Laporan Arus Kas] [→ Log Aktivitas]
```

---

### 5.6 Profil (`/profil`) — Desktop

```
Sidebar 72px
─────────────────────────────────────────────────────
         GRID 3-kolom
┌────────────────┬──────────────────────────────────┐
│ Panel Kiri     │  Panel Kanan (konten utama)       │
│ (col-span-1)   │  (col-span-2)                     │
│                │                                  │
│ [🔵 Kartu biru]│  MODUL SAYA                      │
│ Foto           │  Tab: Staf | Keuangan | ...       │
│ Nama           │  ┌─────────────────────────────┐  │
│ Role           │  │ [ikon] Pengaturan Cabang  > │  │
│ [Edit Profil]  │  │ [ikon] Kelola Staf        > │  │
│                │  └─────────────────────────────┘  │
│ [Cabang info]  │                                  │
│                │  INFORMASI AKUN                  │
│ [Keluar]       │  Email: budi@gmail.com           │
│                │  Telepon: 081234xxx              │
│                │  Tgl Lahir: 15 Jan 1990          │
└────────────────┴──────────────────────────────────┘
```

---

### 5.7 Pengaturan Karyawan (`/pengaturan/karyawan`) — Desktop

```
Sidebar 72px | SubPageHeader
─────────────────────────────────────────────────────
         GRID 3-kolom
┌─────────────────────┬──────────────────────────────┐
│ Daftar Staf          │  Panel Detail Staf            │
│ (col-span-1)         │  (col-span-2, sticky)         │
│                      │                              │
│ [Filter: cabang]     │  [Foto] Nama Staf            │
│ ─────────────────    │  Role: Karyawan              │
│ Budi Santoso        │  Cabang: RB Utama            │
│ Admin Kasir         │                              │
│ ─────────────────    │  Form Edit:                  │
│ Ani Rahayu          │  [Nama] [Role] [Cabang]      │
│ Karyawan            │  [Jadwal Kerja]              │
│ ─────────────────    │  [Status Aktif toggle]       │
│ + Tambah Staf       │                              │
│                      │  [Simpan Perubahan]          │
└─────────────────────┴──────────────────────────────┘
```

---

## 6. Component Changes

### 6.1 Komponen Baru yang Perlu Dibuat

| Komponen | File | Deskripsi |
|---|---|---|
| `PushToggleSwitch` | `components/notification/push-toggle-switch.tsx` | Refactor dari `PushSubscribeButton` — toggle switch UI, logika sama |
| Halaman `ProfilEdit` | `app/profil/edit/page.tsx` | Server component, fetch data profil, render `AccountSettings` |
| `ProfilEditPage` (client) | Sudah ada: `AccountSettings` | Tidak perlu komponen baru — cukup pindahkan ke halaman baru |
| Kartu Profil Baru | Modifikasi `ProfilView` | Tambahkan tombol "Edit Profil" di kartu biru |

### 6.2 Komponen yang Perlu Dimodifikasi

| Komponen | File | Perubahan |
|---|---|---|
| `ProfilView` | `components/profil/profil-view.tsx` | Hapus section `PushSubscribeButton` reference; tambahkan `<Link href="/profil/edit">` di dalam kartu biru |
| `app/profil/page.tsx` | — | Hapus `<AccountSettings>` dan `<PushSubscribeButton>`; pastikan halaman tidak memanjang |
| `app/notifikasi/page.tsx` | — | Tambahkan `PushToggleSwitch` di atas daftar notifikasi |
| `SubPageHeader` | `components/pos/sub-page-header.tsx` | Tambahkan `lg:pt-0` untuk menghilangkan safe-area padding di desktop |
| `DashboardHeader` | `components/dashboard/dashboard-header.tsx` | Sudah ada `lg:pt-3` — tidak perlu ubah |
| `BottomNav` | `components/dashboard/bottom-nav.tsx` | Sudah ada `lg:hidden` — tidak perlu ubah |
| `app/invoice/page.tsx` | — | Perbaiki `backHref` dari `/dashboard` ke `/profil` |
| `app/whatsapp/page.tsx` | — | Perbaiki `backHref` dari `/dashboard` ke `/profil` |

### 6.3 Komponen yang Sudah Benar (Jangan Diubah)

| Komponen | Alasan |
|---|---|
| `Modal` (`components/ui/modal.tsx`) | Sudah benar — Escape + backdrop click + max-height scroll |
| `AccountSettings` logika | Form modal sudah benar — data diri, email, sandi semua pakai modal |
| `DesktopSidebar` | Sudah ada dan fungsional — hanya konten halaman yang perlu dioptimasi |
| `BottomNav` RBAC logic | Navigasi per role sudah benar |
| Semua logika autentikasi | Jangan diubah |
| MediaPipe / face detection | Jangan diubah |
| Supabase real-time subscriptions | Jangan diubah |

---

## 7. Prioritas Implementasi

### Priority 1 — Perubahan Profil & Notifikasi (Paling Visible, Paling Diminta)

```
[ ] 1. Buat app/profil/edit/page.tsx
       - Server component yang fetch data profil (sama seperti /profil/page.tsx sekarang)
       - Render AccountSettings + SubPageHeader (backHref="/profil")
       Verify: Navigasi /profil/edit berfungsi, form edit tampil

[ ] 2. Modifikasi app/profil/page.tsx
       - Hapus <AccountSettings ...> dari halaman ini
       - Hapus <PushSubscribeButton />
       - Pastikan ProfilView masih menerima prop yang sama
       Verify: /profil tidak memanjang, hanya kartu biru + cabang + modul + logout

[ ] 3. Modifikasi components/profil/profil-view.tsx
       - Tambahkan <Link href="/profil/edit"> di dalam kartu biru (primary-gradient)
       - Styling tombol: bg-white/20, text-white, rounded-xl, h-9, px-4
       - Label: "Edit Profil" dengan ikon "edit"
       Verify: Kartu biru menampilkan foto/inisial + nama + role + tombol "Edit Profil"

[ ] 4. Buat components/notification/push-toggle-switch.tsx
       - Refactor PushSubscribeButton menjadi toggle switch
       - Gunakan <button role="switch" aria-checked={...}>
       - Visual: pill 48×26px, circle bergerak, warna brand-500 saat aktif
       Verify: Toggle berfungsi, state berubah, API /api/push/subscribe dipanggil

[ ] 5. Modifikasi app/notifikasi/page.tsx
       - Tambahkan section "Pengaturan Notifikasi" di atas daftar
       - Render <PushToggleSwitch /> di dalam section tersebut
       Verify: Toggle push muncul di halaman notifikasi, berfungsi
```

### Priority 2 — Perbaikan Navigasi (Bug Fix)

```
[ ] 6. Perbaiki backHref di app/invoice/page.tsx
       - Ubah backHref dari "/dashboard" ke "/profil"
       Verify: Tombol back dari /invoice kembali ke /profil

[ ] 7. Perbaiki backHref di app/whatsapp/page.tsx
       - Ubah backHref dari "/dashboard" ke "/profil"
       Verify: Tombol back dari /whatsapp kembali ke /profil

[ ] 8. Tambahkan navigasi dari /laporan ke sub-laporan
       - Di LaporanView atau laporan/page.tsx, tambahkan link cards ke
         /laporan/cashflow dan /laporan/aktivitas
       Verify: Dari /laporan ada shortcut visible ke kedua sub-laporan

[ ] 9. Tambahkan navigasi dari /stok ke /stok/opname
       - Tambahkan tombol/link di StockManager atau stok/page.tsx
       Verify: Dari /stok ada shortcut ke opname
```

### Priority 3 — Desktop Layout Halaman Utama

```
[ ] 10. Dashboard — upgrade grid desktop
        - Di dashboard/page.tsx: hero card col-span-2, tambah kas+order bersebelahan
        - Quick actions: lg:grid-cols-4 → tampilkan 8 items (lg:max-items-8)
        Verify: Di desktop ≥1024px, kartu tersusun bento, tidak ada ruang putih kosong

[ ] 11. Kas (`/kas`) — desktop 2-panel
        - Di KasConsole: lg:grid lg:grid-cols-2
        - Form tambah kas keluar sticky di kanan
        - Floating action bar hanya mobile
        Verify: Di desktop form kas selalu visible tanpa scroll

[ ] 12. Laporan (`/laporan`) — bento grid desktop
        - Di LaporanView: baris 1 = 3 metric cards, baris 2 = chart+tagihan, baris 3 = tabel
        Verify: Di desktop laporan tidak single-column

[ ] 13. Antrean Order (`/pos/orders`) — desktop tabel
        - Di OrderQueue: lg:tabel view dengan kolom tambahan
        Verify: Di desktop order tampil sebagai tabel dengan lebih banyak info
```

### Priority 4 — POS Desktop Split Layout

```
[ ] 14. POS (`/pos`) — split panel desktop
        - Di PosConsole: lg:grid lg:grid-cols-5
        - Kiri col-span-3: katalog + filter
        - Kanan col-span-2: checkout panel sticky
        Verify: Di desktop katalog dan checkout visible sekaligus
```

### Priority 5 — Pengaturan & Halaman Kompleks

```
[ ] 15. Pengaturan Karyawan — desktop list+detail
        - Di StaffManagementPage: lg:grid lg:grid-cols-3
        Verify: Di desktop list staf dan form edit side-by-side

[ ] 16. Pengaturan Cabang — desktop list+form
        - Di BranchSettingsView: lg:grid lg:grid-cols-4
        Verify: Di desktop list cabang dan form edit side-by-side

[ ] 17. Rekap Kehadiran — desktop filter+tabel
        - Di RekapConsole: lg:grid lg:grid-cols-4
        - Filter di kiri sticky, tabel di kanan
        Verify: Di desktop filter dan tabel side-by-side

[ ] 18. Profil page — desktop 2-kolom
        - Di ProfilView: lg:grid lg:grid-cols-3
        - Kartu identitas + cabang di kiri, menu modul di kanan
        Verify: Di desktop profil tidak single-column memanjang
```

### Priority 6 — Halaman Sederhana (Optimasi Ringan)

```
[ ] 19. Semua halaman: pastikan lg:pb-8 sudah ada (bukan hanya pb-nav-plain)
[ ] 20. Order Detail — desktop 2-kolom info + action
[ ] 21. Stok — desktop tabel + panel klaim
[ ] 22. Shift — desktop 2-kolom ringkasan + form
[ ] 23. Izin — form dalam modal (bukan inline)
[ ] 24. Garansi — desktop search + 2-panel
[ ] 25. Omset — desktop metric berdampingan + chart besar
[ ] 26. Komisi — tabel full-width desktop
[ ] 27. Invoice — preview struk di panel kanan desktop
[ ] 28. Pengaturan Jasa — tabel harga full-width
```

---

## 8. Spesifikasi Teknis Toggle Push Notification

Ini adalah komponen baru yang paling kritis untuk dibuat. Spesifikasi lengkap:

```tsx
// components/notification/push-toggle-switch.tsx
// State: "unsupported" | "loading" | "denied" | "subscribed" | "unsubscribed"
// Logika: identik dengan PushSubscribeButton yang sudah ada

// HTML Structure:
<div className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
  <div className="flex items-center justify-between gap-4">
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
        <Icon name="notifications" />
      </div>
      <div>
        <p className="font-body-bold text-body-bold text-text-primary">
          Notifikasi Perangkat
        </p>
        <p className="font-caption text-caption text-text-muted">
          {state === "subscribed" ? "Push notification aktif" : 
           state === "denied" ? "Diblok di pengaturan peramban" :
           "Aktifkan untuk terima peringatan"}
        </p>
      </div>
    </div>
    
    {/* Toggle pill */}
    <button
      role="switch"
      aria-checked={state === "subscribed"}
      aria-label="Toggle notifikasi push"
      disabled={state === "loading" || state === "denied" || state === "unsupported"}
      onClick={...}
      className={`relative w-12 h-6 rounded-full transition-colors 
        ${state === "subscribed" ? "bg-brand-500" : "bg-surface-container-high"}
        disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform
        ${state === "subscribed" ? "translate-x-7" : "translate-x-1"}`} />
    </button>
  </div>
</div>
```

---

## 9. Catatan Penting untuk Developer

### Yang TIDAK Boleh Diubah

1. Semua logika RBAC di `lib/rbac.ts` — jangan ubah permission matrix
2. Semua server action di `app/actions/` — terutama autentikasi dan upload
3. MediaPipe / face detection logic di `AttendanceConsole`
4. Supabase real-time subscription di `OrderQueue`
5. Service Worker (`/sw.js`) dan logika push notification di `PushSubscribeButton` — hanya pindah lokasinya, logika sama
6. CSS tokens di `globals.css` — `--nav-h`, `--nav-h-fab`, dll

### Yang Sudah Benar dan Tidak Perlu Diubah

1. `Modal` component — sudah benar pola UX-nya
2. `AccountSettings` — form modal sudah benar, hanya perlu dipindah ke halaman baru
3. `DesktopSidebar` — sudah ada dan fungsional
4. `BottomNav` sudah `lg:hidden` — sudah benar

### Progressive Enhancement Rule

Semua perubahan desktop harus menggunakan prefix `lg:` tanpa mengubah class mobile yang sudah ada:

```tsx
// BENAR:
<div className="flex flex-col min-h-screen pb-nav-plain lg:pb-8 lg:grid lg:grid-cols-2">

// SALAH:
<div className="flex flex-col min-h-screen">  // menghilangkan pb-nav-plain
```

### AppShell dan Sidebar Context

`DesktopSidebar` sudah ada. Pastikan setiap halaman yang dioptimasi menggunakan `lg:ml-[72px]` (collapsed) sebagai base margin, dengan JavaScript event listener untuk expand (sudah ada di `DesktopSidebar` via `rba-sidebar-toggle` CustomEvent).

---

## Digest (Referensi Cepat)

| File | Blok yang Diubah | Test Verifikasi |
|---|---|---|
| `app/profil/page.tsx` | Hapus `AccountSettings`, `PushSubscribeButton`; pertahankan `ProfilView` | Buka /profil — tidak ada form edit, tidak ada button notif |
| `app/profil/edit/page.tsx` | File baru — server component + render `AccountSettings` | Buka /profil/edit — semua form edit muncul |
| `components/profil/profil-view.tsx` | Tambahkan `<Link href="/profil/edit">` di kartu biru | Kartu biru punya tombol "Edit Profil" yang navigable |
| `app/notifikasi/page.tsx` | Tambahkan `PushToggleSwitch` di atas `NotificationList` | Toggle push muncul di /notifikasi |
| `components/notification/push-toggle-switch.tsx` | File baru | Toggle berfungsi on/off, API dipanggil |
| `app/invoice/page.tsx` | `backHref="/profil"` | Back dari /invoice → /profil |
| `app/whatsapp/page.tsx` | `backHref="/profil"` | Back dari /whatsapp → /profil |

---

*Dokumen ini dibuat berdasarkan pembacaan lengkap semua file yang disebutkan. Tidak ada kode yang diubah dalam proses audit ini.*
