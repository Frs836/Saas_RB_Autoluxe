import XLSX from "xlsx";
import path from "path";
import fs from "fs";

const headers = [
  "full_name",
  "email",
  "password",
  "phone_number",
  "date_of_birth",
  "role",
  "work_schedule"
];

const staffRows = [
  [
    "Budi Santoso",
    "budi.owner@rbautoluxe.com",
    "RBAutoluxe123!",
    "081211112222",
    "1988-06-20",
    "owner",
    "office"
  ],
  [
    "Agus Prasetyo",
    "agus.manager@rbautoluxe.com",
    "RBAutoluxe123!",
    "081233334444",
    "1990-08-15",
    "manager",
    "office"
  ],
  [
    "Siti Rahma",
    "siti.kasir@rbautoluxe.com",
    "RBAutoluxe123!",
    "081255556666",
    "1996-03-25",
    "admin_kasir",
    "office"
  ],
  [
    "Rina Anggraini",
    "rina.finance@rbautoluxe.com",
    "RBAutoluxe123!",
    "081277778888",
    "1994-11-10",
    "finance",
    "office"
  ],
  [
    "Joko Susilo",
    "joko.kepala@rbautoluxe.com",
    "RBAutoluxe123!",
    "081399990000",
    "1991-01-18",
    "kepala_karyawan",
    "field"
  ],
  [
    "Doni Saputra",
    "doni.teknisi@rbautoluxe.com",
    "RBAutoluxe123!",
    "081312345678",
    "1999-07-04",
    "karyawan",
    "field"
  ]
];

const wb = XLSX.utils.book_new();

// 1. Sheet Data (Editable & Ready to Import)
const dataSheetContent = [headers, ...staffRows];
const wsData = XLSX.utils.aoa_to_sheet(dataSheetContent);

// Set column widths
wsData["!cols"] = [
  { wch: 22 }, // full_name
  { wch: 32 }, // email
  { wch: 18 }, // password
  { wch: 16 }, // phone_number
  { wch: 15 }, // date_of_birth
  { wch: 18 }, // role
  { wch: 15 }  // work_schedule
];

XLSX.utils.book_append_sheet(wb, wsData, "Data");

// 2. Sheet Petunjuk & Penjelasan Role
const guideRows = [
  ["PANDUAN & PETUNJUK BULK IMPORT DATA KARYAWAN RB AUTOLUXE"],
  ["File ini berformat Excel (.xlsx) yang dapat diedit langsung dan siap diunggah ke menu 'Import Data › Karyawan'."],
  [],
  ["1. DAFTAR 6 ROLE RESMI SISTEM (SELAIN MAINTAINER):"],
  ["Role", "Deskripsi Akses & Wewenang", "Default Jadwal"],
  ["owner", "Pemilik / Owner (Hak akses eksekutif penuh, melihat omset seluruh cabang, laporan keuangan & performa)", "office"],
  ["manager", "Manager Cabang (Supervisi operasional bengkel, verifikasi absensi staf, kelola stok, setting cabang)", "office"],
  ["admin_kasir", "Admin Kasir (Membuat order POS, menerima pembayaran kas/QRIS/transfer, serah terima kas/shift)", "office"],
  ["finance", "Bagian Keuangan / Finance (Audit arus kas in/out, approval kas kecil/petty cash, rekap komisi & slip gaji)", "office"],
  ["kepala_karyawan", "Kepala Karyawan / Kepala Teknisi (Membagi regu teknisi di workshop, kontrol antrean kanban, inspeksi QC coating)", "field"],
  ["karyawan", "Teknisi Detailing & Cuci (Mengerjakan unit mobil, absensi wajah mandiri, pantau komisi per mobil di HP)", "field"],
  [],
  ["2. ATURAN PENGISIAN KOLOM:"],
  ["Nama Kolom", "Kewajiban", "Aturan & Format", "Contoh"],
  ["full_name", "Wajib", "Nama lengkap karyawan tanpa gelar aneh", "Budi Santoso"],
  ["email", "Wajib", "Email unik yang belum terdaftar di sistem", "budi@rbautoluxe.com"],
  ["password", "Opsional", "Minimal 8 karakter (Jika kosong, otomatis diset: RBAutoluxe123!)", "RBAutoluxe123!"],
  ["phone_number", "Opsional", "Nomor HP / WhatsApp aktif", "081234567890"],
  ["date_of_birth", "Opsional", "Format tahun-bulan-tanggal (YYYY-MM-DD)", "1995-10-20"],
  ["role", "Wajib", "Pilih salah satu dari 6 role di atas (huruf kecil semua)", "admin_kasir"],
  ["work_schedule", "Wajib", "'office' (kantor/kasir) atau 'field' (lapangan/teknisi)", "field"],
  [],
  ["CATATAN PENTING:"],
  ["- Jangan mengubah atau menghapus nama header pada baris ke-1 di sheet 'Data'."],
  ["- Anda dapat menambah, mengubah, atau menghapus baris data karyawan sesuai kebutuhan."],
  ["- File ini HANYA dibuat sebagai file lokal dan TIDAK dimasukkan ke database sampai Anda mengunggahnya sendiri."]
];

const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
wsGuide["!cols"] = [
  { wch: 18 },
  { wch: 80 },
  { wch: 20 },
  { wch: 25 }
];

XLSX.utils.book_append_sheet(wb, wsGuide, "Petunjuk");

// Write files
const dest1 = path.join(process.cwd(), "Template_Bulk_Import_Karyawan_RB_Autoluxe.xlsx");
const dest2 = "c:\\Users\\User\\Desktop\\Template_Bulk_Import_Karyawan_RB_Autoluxe.xlsx";

XLSX.writeFile(wb, dest1);
XLSX.writeFile(wb, dest2);

console.log("File Excel berhasil dibuat di:");
console.log("1. " + dest1);
console.log("2. " + dest2);
