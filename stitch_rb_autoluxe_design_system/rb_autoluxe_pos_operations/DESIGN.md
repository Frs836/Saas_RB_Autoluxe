---
name: RB Autoluxe POS & Operations
colors:
  surface: '#FFFFFF'
  surface-dim: '#d9d9e5'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3fe'
  surface-container: '#ededf9'
  surface-container-high: '#e7e7f3'
  surface-container-highest: '#e1e2ed'
  on-surface: '#191b23'
  on-surface-variant: '#434655'
  inverse-surface: '#2e3039'
  inverse-on-surface: '#f0f0fb'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#1d4ed8'
  on-secondary: '#ffffff'
  secondary-container: '#4069f2'
  on-secondary-container: '#fffbff'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dce1ff'
  secondary-fixed-dim: '#b7c4ff'
  on-secondary-fixed: '#001551'
  on-secondary-fixed-variant: '#0039b5'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#faf8ff'
  on-background: '#191b23'
  surface-variant: '#e1e2ed'
  brand-50: '#EFF6FF'
  brand-100: '#DBEAFE'
  brand-200: '#BFDBFE'
  brand-400: '#60A5FA'
  brand-500: '#2563EB'
  brand-600: '#1D4ED8'
  brand-700: '#1E40AF'
  canvas: '#F0F4FA'
  surface-overlay: '#EBF2FA'
  border-subtle: '#E2E8F0'
  border-strong: '#CBD5E1'
  text-primary: '#0F172A'
  text-secondary: '#475569'
  text-muted: '#94A3B8'
  success-base: '#10B981'
  success-surface: '#ECFDF5'
  success-text: '#065F46'
  warning-base: '#F59E0B'
  warning-surface: '#FEF3C7'
  warning-text: '#78350F'
  danger-base: '#EF4444'
  danger-surface: '#FEE2E2'
  danger-text: '#991B1B'
  whatsapp: '#25D366'
typography:
  metric-display:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-1:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-2:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: 0em
  body-bold:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0em
  body-regular:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  caption:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: +0.01em
  micro-badge:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: +0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  margin: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

# Design System RB AUTOLUXE

Dokumen ini berisi spesifikasi teknis komponen visual, token warna, tipografi, tata letak, dan aturan UI/UX untuk aplikasi POS dan Operasional Workshop RB AUTOLUXE.

---

## 1. Konsep Visual dan Prinsip Dasar

Desain mengadaptasi gaya **Semi-Minimalist Claymorphism** dengan karakteristik utama:

* **Canvas Background**: Warna *White Smooth Blue* (`#F0F4FA`) — putih dengan sentuhan biru es super lembut untuk kontras tinggi, visual bersih, dan nyaman di mata.


* **Surface Card**: Kartu putih murni (`#FFFFFF`) dengan efek elevasi 3D lembut, pantulan cahaya dalam (*inner highlight*), dan bayangan ambient *clay*.


* **Primary Accent**: *Smooth Blue Gradient* berpusat pada warna *Brand Blue* (`#2563EB`).


* **Brand Identity**: Logo resmi **RB AUTOLUXE** wajib hadir pada header mobile dan bagian atas sidebar desktop/tablet.


* **Aturan Ikonografi Ketat**: **HARAM menggunakan emoji**. SELURUH indikator visual, status, dan menu wajib menggunakan ikon vektor (*Lucide React* atau SVG kustom).


* **Sistem Radius Clay**: Kontainer dan kartu menggunakan radius tumpul membulat (*smooth radius* 12px, 16px, 20px, hingga 24px). Radius `9999px` digunakan khusus untuk elemen lingkaran utuh (avatar, floating action button, segmented pill control).



---

## 2. Palette Warna dan Token CSS

### Warna Utama (Brand Blue)

* Brand 50 (Soft Surface Tint): `#EFF6FF`

* Brand 100 (Border Subtle / Light Active): `#DBEAFE`

* Brand 200 (Highlight Accent): `#BFDBFE`

* Brand 400 (Hover / Light Base): `#60A5FA`

* Brand 500 (Primary Base Blue): `#2563EB`

* Brand 600 (Active Deep State): `#1D4ED8`

* Brand 700 (Dark Accent Blue): `#1E40AF`


### Warna Netral

* Canvas Background (White Smooth Blue): `#F0F4FA`

* Surface Card (Clay White): `#FFFFFF`

* Surface Overlay / Sub-card: `#EBF2FA`

* Border Subtle: `#E2E8F0`

* Border Clay Strong: `#CBD5E1`

* Text Primary: `#0F172A`

* Text Secondary: `#475569`

* Text Muted: `#94A3B8`


### Warna Status Semantic

* Success / Verified / Approved: Base `#10B981`, Surface `#ECFDF5`, Text `#065F46`

* In Progress / Warning / Hold: Base `#F59E0B`, Surface `#FEF3C7`, Text `#78350F`

* Defect / Danger / Rejected: Base `#EF4444`, Surface `#FEE2E2`, Text `#991B1B`

* Neutral / Pending Verification: Base `#64748B`, Surface `#F1F5F9`, Text `#334155`


### Spesifikasi Gradien Halus & Clay Shadow

* Primary Smooth Gradient (Hero & Active): `linear-gradient(135deg, #1D4ED8 0%, #3B82F6 50%, #60A5FA 100%)`

* Soft Card Tint Gradient: `linear-gradient(180deg, rgba(37, 99, 235, 0.06) 0%, rgba(255, 255, 255, 0) 100%)`

* Progress Bar Gradient: `linear-gradient(90deg, #1D4ED8 0%, #3B82F6 100%)`

* Dark Surface Gradient: `linear-gradient(135deg, #1E40AF 0%, #2563EB 100%)`


---

## 3. Tipografi

Sistem menggunakan font **Plus Jakarta Sans**.

| Tingkat | Ukuran Font | Line Height | Weight | Letter Spacing | Penggunaan Utama |
| --- | --- | --- | --- | --- | --- |
| Metric Display | 28px | 34px | Bold (700) | -0.02em | Total omzet, nominal kas, angka utama

 |
| Heading 1 (H1) | 20px | 26px | SemiBold (600) | -0.01em | Judul halaman dashboard

 |
| Heading 2 (H2) | 16px | 22px | SemiBold (600) | 0em | Judul kartu, nomor plat, nama section

 |
| Body Bold | 14px | 20px | SemiBold (600) | 0em | Label tombol, header tabel, nama layanan

 |
| Body Regular | 14px | 20px | Regular (400) | 0em | Deskripsi foto, teks catatan, input field

 |
| Caption | 12px | 16px | Medium (500) | +0.01em | Timestamp, koordinat GPS, status badge

 |
| Micro Badge | 10px | 12px | Bold (700) | +0.02em | Label singkat pada foto inspeksi

 |

---

## 4. Elevasi, Shadow, dan Radius (Claymorphism System)

### Sistem Radius

* `radius-sm`: **4px** (Indikator kecil, checkbox)


* `radius-md`: **8px** (Badge status, tag, input field kecil)


* `radius-lg`: **12px** (Input field standar, item list, chip)


* `radius-xl`: **16px** (Kartu standar, modal sedang)


* `radius-2xl`: **20px** (Kartu metric utama, container dashboard, sidebar)


* `radius-3xl`: **24px** (Floating Bottom Notch bar, modal besar)


* `radius-full`: **9999px** (Avatar, floating action button, segmented control)



### Sistem Bayangan & Efek Clay (Shadow Tokens)

* `shadow-subtle`: `0px 2px 4px rgba(15, 23, 42, 0.03)`

* `shadow-clay-card`: `0px 12px 28px -6px rgba(37, 99, 235, 0.12), 0px 8px 12px -4px rgba(15, 23, 42, 0.03)`

* `shadow-clay-glow`: `0px 10px 22px rgba(37, 99, 235, 0.32)`

* `shadow-modal`: `0px 16px 36px -4px rgba(15, 23, 42, 0.16)`

* `inner-highlight`: `inset 0px 2px 4px rgba(255, 255, 255, 0.95), inset 0px -2px 4px rgba(37, 99, 235, 0.05)`


---

## 5. Layout dan Grid

### Mosaic Grid (Mobile Portrait <1024px)

* Lebar viewport target: **360px - 430px**.


* Structure: Grid 2 kolom asimetris.


* **Highlight Principle**: Informasi atau kartu paling penting (Primary Tile seperti Status Absensi Hari Ini atau Kas Titipan Pagi) **wajib mengambil span 2 kolom** (*col-span-2*) di posisi teratas sebagai pusat perhatian visual utama. Kartu pendukung mengikuti di bawahnya dengan format 1 atau 2 kolom.


* Outer Padding: **16px** (`p-4`).


* Gap antar kartu: **12px** hingga **16px**.


* **Container Bottom Padding**: Wajib minimal **80px** (`pb-20` atau `pb-24`) pada kontainer utama halaman agar konten terbawah tidak tertutup oleh Floating Bottom Navigation Bar.



### Bento Grid (Tablet Landscape & Desktop >=1024px)

* Lebar viewport target: **1024px ke atas**.


* Structure: Modul Bento Grid 12 kolom asimetris serbaguna.


* **Asymmetric Rule**: Kartu analitik utama (seperti Analitik Keuangan Eksekutif / Live Monitor) menggunakan ukuran *col-span-8* atau *col-span-6*, sedangkan kartu aksi cepat, status, dan ringkasan samping menggunakan *col-span-4* atau *col-span-3*.


* Outer Padding: **24px** (`p-6`).


* Gap antar kartu: **20px**.



---

## 6. Spesifikasi Detail Komponen UI

### 6.1 Collapsible Sidebar Navigasi (Tablet Landscape & Desktop >=1024px)

* Kontainer: Melayang di sisi kiri, background `#FFFFFF`, border `1px solid #E2E8F0`, `border-radius: 20px`, shadow `shadow-clay-card`.


* DUA MODE INTERAKSI:
* **Mode Icon-Only (Default / Collapsed)**: Width **72px**. Menampilkan Logo RB AUTOLUXE ringkas di atas dan ikon vektor navigasi vertikal.


* **Mode Full Expanded (On Click Toggle)**: Width **240px**. Menampilkan header profil pengguna, label teks menu lengkap, badge status, dan tombol Logout.




* Transisi: Smooth CSS transition `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`.


* Item Navigasi:
* Ukuran frame ikon: 44px x 44px, radius `12px`.


* State Normal: Icon color `#64748B`, background transparent.


* State Active: Shaped pill background dengan *Primary Smooth Gradient*, icon color `#FFFFFF`, shadow `shadow-clay-glow`.





### 6.2 Floating Curved Bottom Navigation Bar (Mobile Portrait <1024px)

* Kontainer: Floating Curved Clay Notch melayang di bagian bawah layar. Background `#FFFFFF`, `border-radius-top: 24px`, shadow `shadow-clay-card` + `inner-highlight`.


* Tinggi Bar: **68px**.


* **Tombol Aksi Utama (Central Floating Button)**:
* Bentuk: Circle utuh (`9999px`), diameter 56px, melayang menonjol di lekukan ceruk tengah bar.


* Visual: Background *Primary Smooth Gradient*, icon vektor putih, shadow `shadow-clay-glow`.




* Touch Target: Minimal **48px x 48px** untuk seluruh item navigasi.



### 6.3 Clay Metric Card (Mosaic & Bento Style)

* Variasi A (Primary Gradient Card - Kas Titipan / Omzet Utama):
* Background: `Primary Smooth Gradient` (`linear-gradient(135deg, #1D4ED8 0%, #3B82F6 50%, #60A5FA 100%)`).


* Radius: `20px`, padding `20px`, shadow `shadow-clay-glow`.


* Text Color: Pure White (`#FFFFFF`).


* Top: Subtitle opacity 0.85. Middle: Metric Display (28px Bold). Bottom: Badge status/persentase.




* Variasi B (Clay White Surface Card):
* Background: `#FFFFFF`, border `1px solid rgba(255, 255, 255, 0.8)`, shadow `shadow-clay-card` + `inner-highlight`, radius `20px`.


* Accent Icon Box: 40px x 40px, background `#EFF6FF`, icon color `#2563EB`, radius `12px`.





### 6.4 Vehicle Size & Category Selector Pill

* Kontainer: Background `#F0F4FA`, padding `4px`, radius `14px`, border `1px solid #E2E8F0`.


* Item Opsi: Size S, Size M, Size L, Size XL, Motor.


* State Unselected: Text `#64748B`, font-size 13px, font-weight 500.


* State Selected: Background `#FFFFFF`, text `#2563EB`, font-weight 600, shadow `shadow-subtle` + `inner-highlight`, radius `10px`.





### 6.5 Inspection Photo Card dengan Mandatory Note Field

* Frame Foto: Aspect ratio 4:3, radius `14px`, overflow hidden, border `1px solid #CBD5E1`.


* Stage Badge: Absolute top-left, background `rgba(15, 23, 42, 0.75)`, text white, caption 10px bold, radius `6px`, text "BEFORE" / "PROCESS" / "AFTER".


* Input Deskripsi (Wajib Minimal 5 Karakter):
* Textarea di bawah foto.


* Border: `1px solid #CBD5E1` (Normal), `#2563EB` dengan efek *blue tint glow* (Focus).


* Radius: `10px`.


* Placeholder: "Catat cacat fisik, baret, noda, atau jamur pada bagian foto ini...".





### 6.6 Live Camera Frame (Absensi Biometrik & Face ID)

* Outer Container: Width 100%, max-width 360px, aspect-ratio 1:1, radius `20px`, background `#0F172A`, shadow `shadow-clay-card`.


* Overlaid Face Oval Guide: Border dash `2px solid #2563EB`, opacity 0.85.


* GPS & Verification Overlay: Absolute bottom, background `rgba(15, 23, 42, 0.82)`, backdrop-blur `6px`, text color `#FFFFFF`, caption 12px, memuat koordinat GPS, jarak workshop, dan status verifikasi Maintainer (`verified` / `pending_verification`).



### 6.7 Data Table (Tabel Transaksi & Audit)

* Card Container: Background `#FFFFFF`, border `1px solid #E2E8F0`, radius `20px`, shadow `shadow-clay-card` + `inner-highlight`.


* Table Header (`<thead>`): Background `#F0F4FA`, height 44px, text `#475569`, font 12px uppercase bold.


* Table Row (`<tr>`): Height 56px, border-bottom `1px solid #F1F5F9`, hover background `#EFF6FF` opacity 0.6.


* Status Pill Badge:
* Height 24px, padding `0 10px`, radius `9999px`, font 12px bold.


* Hold Shift Pagi: Background `#FEF3C7`, text `#78350F`.


* Paid / Verified: Background `#ECFDF5`, text `#065F46`.





### 6.8 Multi Select Karyawan (Washer & Coating Operator Team)

* Kontainer: Background `#FFFFFF`, border `1px solid #E2E8F0`, radius `16px`, padding `16px`, shadow `shadow-clay-card`.


* Header Counter: Caption 12px `#64748B` (misal: "3/5 Karyawan Dipilih"), posisi kanan atas judul section.


* Chip Karyawan (Chip Group): Height `36px`, padding `0 14px`, radius `9999px`, font 12px semibold, transition `all 0.2s`.


* State Unselected: Background `#F1F5F9`, text `#475569`, border `1px solid #E2E8F0`.


* State Selected: Background `#EFF6FF`, text `#1D4ED8`, border `1px solid #BFDBFE`, ikon check SVG kecil.


* State Disabled (Batas Maksimal Tercapai): Chip unselected opacity 0.45 dan cursor not-allowed.





### 6.9 Modal Pengajuan & Approval Izin/Cuti/Sakit

* Modal Overlay: Backdrop blur `8px`, background `rgba(15, 23, 42, 0.4)`.


* Container Modal: Background `#FFFFFF`, radius `24px`, shadow `shadow-modal` + `inner-highlight`, padding `24px`, max-width `480px`.


* Header: Judul H2 16px semibold, subtitle body regular 14px, tombol close ikon 32px.


* Form Fields:
* Select jenis (Sakit / Cuti / Izin): styled segmented control, radius `12px`.


* Date range input: height `44px`, radius `12px`, border `1px solid #CBD5E1`.


* Textarea alasan: radius `10px`, border `1px solid #CBD5E1`, min-height `80px`.


* Upload foto bukti (Surat Dokter/Lampiran): dropzone border dash `#CBD5E1`, radius `12px`, preview 4:3.




* Badge Status Approval:
* `pending`: Surface `#FEF3C7`, text `#78350F`.


* `approved`: Surface `#ECFDF5`, text `#065F46`.


* `rejected`: Surface `#FEE2E2`, text `#991B1B`.




* Tombol Approval (Owner/Maintainer): Setujui (Brand Solid Blue) & Tolak (Danger Outline).



### 6.10 Panel Pengaturan Titik GPS Workshop (Maintainer)

* Card: Surface `#FFFFFF`, border `1px solid #E2E8F0`, radius `20px`, shadow `shadow-clay-card` + `inner-highlight`.


* Dua input koordinat (Latitude / Longitude) + input radius meter (Default 30m), masing-masing height `44px`, radius `12px`.


* Pratinjau Geofence: Area peta 1:1 radius `14px` dengan lingkaran radius visual warna brand (`#2563EB`, opacity 0.2 fill).


* State "Dikunci": Notice banner `#EFF6FF`/`#1D4ED8` bertuliskan "Koordinat dikunci oleh Maintainer" dan tombol simpan disabled untuk role lain.



### 6.11 Tombol Kirim WhatsApp Nota & Link Tracking (`wa.me`)

* Button Frame: Background `#25D366` (WhatsApp Green), text white bold, `border-radius: 12px`, height `48px`, shadow `0px 8px 16px rgba(37, 211, 102, 0.28)`.


* Ikon: Vektor SVG WhatsApp resmi (No Emoji).


* Target Action: Membuka skema URL `[https://wa.me/628xxx?text=](https://wa.me/628xxx?text=)...` berisi rincian nota dan token pelacakan ringkas `RBA-[YYYYMMDD]-[PLAT]`.



---

## 7. Configuration Code Tailwind CSS

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#EFF6FF',
          100: '#DBEAFE',
          200: '#BFDBFE',
          400: '#60A5FA',
          500: '#2563EB',
          600: '#1D4ED8',
          700: '#1E40AF',
        },
        canvas: '#F0F4FA',
        surface: '#FFFFFF',
        'clay-overlay': '#EBF2FA',
      },
      backgroundImage: {
        'primary-gradient': 'linear-gradient(135deg, #1D4ED8 0%, #3B82F6 50%, #60A5FA 100%)',
        'soft-tint-gradient': 'linear-gradient(180deg, rgba(37, 99, 235, 0.06) 0%, rgba(255, 255, 255, 0) 100%)',
        'progress-gradient': 'linear-gradient(90deg, #1D4ED8 0%, #3B82F6 100%)',
        'dark-gradient': 'linear-gradient(135deg, #1E40AF 0%, #2563EB 100%)',
      },
      borderRadius: {
        'none': '0px',
        'sm': '4px',
        'DEFAULT': '8px',
        'md': '8px',
        'lg': '12px',
        'xl': '16px',
        '2xl': '20px',
        '3xl': '24px',
        'full': '9999px',
      },
      boxShadow: {
        'subtle': '0px 2px 4px rgba(15, 23, 42, 0.03)',
        'clay-card': '0px 12px 28px -6px rgba(37, 99, 235, 0.12), 0px 8px 12px -4px rgba(15, 23, 42, 0.03)',
        'clay-glow': '0px 10px 22px rgba(37, 99, 235, 0.32)',
        'modal': '0px 16px 36px -4px rgba(15, 23, 42, 0.16)',
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
