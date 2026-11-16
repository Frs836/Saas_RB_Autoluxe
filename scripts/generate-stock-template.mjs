import * as XLSX from "xlsx";
import { writeFileSync } from "fs";

function createStockTemplate() {
  const wb = XLSX.utils.book_new();

  // 1. Data Sheet
  const headers = [
    "item_name",
    "purchase_unit",
    "purchase_price",
    "purchase_content_qty",
    "unit",
    "current_stock",
    "min_stock_alert",
    "unit_cost",
  ];

  const rows = [
    headers,
    [
      "Shampoo Car Wash High Gloss",
      "Jerigen",
      250000,
      5000,
      "ml",
      15000,
      2000,
      50,
    ],
    [
      "Ceramic Coating 9H Diamond",
      "Botol",
      750000,
      50,
      "ml",
      150,
      20,
      15000,
    ],
    [
      "Graphene Fast Coat",
      "Botol",
      600000,
      50,
      "ml",
      200,
      30,
      12000,
    ],
    [
      "Compound Step 1 Cutting",
      "Botol",
      350000,
      1000,
      "ml",
      2000,
      500,
      350,
    ],
    [
      "Polish Step 2 Finishing",
      "Botol",
      350000,
      1000,
      "ml",
      2000,
      500,
      350,
    ],
    [
      "Interior Leather Cleaner & Conditioner",
      "Botol",
      180000,
      1000,
      "ml",
      3000,
      500,
      180,
    ],
    [
      "Kain Microfiber 40x40 Edges",
      "Pack",
      150000,
      10,
      "pcs",
      50,
      10,
      15000,
    ],
    [
      "Masking Tape 18mm",
      "Pack",
      90000,
      5,
      "roll",
      25,
      5,
      18000,
    ],
    [
      "Aplikator Busa Coating",
      "Box",
      50000,
      10,
      "pcs",
      30,
      10,
      5000,
    ],
  ];

  const wsData = XLSX.utils.aoa_to_sheet(rows);

  // Set column widths
  wsData["!cols"] = [
    { wch: 38 }, // item_name
    { wch: 16 }, // purchase_unit
    { wch: 20 }, // purchase_price
    { wch: 24 }, // purchase_content_qty
    { wch: 14 }, // unit
    { wch: 16 }, // current_stock
    { wch: 18 }, // min_stock_alert
    { wch: 18 }, // unit_cost
  ];

  XLSX.utils.book_append_sheet(wb, wsData, "Template_Stok");

  // 2. Guide Sheet (Panduan & Rumus Matematika Belanja)
  const guideRows = [
    ["PANDUAN LENGKAP TEMPLATE IMPORT STOK & BIAYA PRODUKSI — RB AUTOLUXE"],
    ["Gunakan file Excel ini untuk mengimpor atau memperbarui data stok inventaris bengkel."],
    [],
    ["PENJELASAN KOLOM & RUMUS MATEMATIKA PRAKTIS BELANJA:"],
    ["1. item_name", "Wajib", "Nama bahan / obat / barang inventaris (cth: Shampoo Car Wash, Graphene Coating)."],
    ["2. purchase_unit", "Wajib", "Satuan saat belanja dari supplier/toko (cth: Botol, Jerigen, Pack, Box, Galon, Pcs)."],
    ["3. purchase_price", "Wajib", "Harga beli per sekali belanja kemasan tersebut dalam Rupiah (angka tanpa titik/koma, cth: 100000)."],
    ["4. purchase_content_qty", "Wajib", "Isi bersih kemasan dalam satuan pemakaian workshop (cth: beli 1 botol isinya 800 ml, isi 800)."],
    ["5. unit", "Wajib", "Satuan dasar pemakaian di workshop (cth: ml, gram, pcs, lembar, roll)."],
    ["6. current_stock", "Wajib", "Jumlah stok fisik saat ini dalam satuan dasar workshop (cth: jika ada 3 botol @ 800ml, isi 2400)."],
    ["7. min_stock_alert", "Wajib", "Batas minimum stok untuk memicu alert restock di dashboard."],
    ["8. unit_cost", "Otomatis", "Biaya per satuan pakai = purchase_price / purchase_content_qty. (Boleh dikosongkan, sistem hitung otomatis)."],
    [],
    ["CONTOH KASUS MATEMATIKA BELANJA VS PEMAKAIAN:"],
    ["- Kasus:", "Beli Chemical A 1 Botol harga Rp 100.000, isi bersihnya 800 ml."],
    ["- Pengisian:", "purchase_unit = Botol, purchase_price = 100000, purchase_content_qty = 800, unit = ml."],
    ["- Hasil Sistem:", "unit_cost = 100.000 / 800 = Rp 125 per ml."],
    ["- Di Resep Jasa:", "Jika jasa Coating butuh 100 ml Chemical A, stok berkurang 100 ml, dan tercatat Biaya Modal Bahan Rp 12.500."],
    [],
    ["CATATAN PENTING:"],
    ["1. Jangan mengubah nama-nama kolom pada baris pertama (header)."],
    ["2. Kolom angka (harga, isi, stok) diisi angka murni tanpa format Rupiah atau pemisah ribuan."],
    ["3. Jika nama item sudah ada di cabang tersebut, sistem akan memperbarui harga dan stoknya."],
  ];

  const wsGuide = XLSX.utils.aoa_to_sheet(guideRows);
  wsGuide["!cols"] = [{ wch: 25 }, { wch: 15 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, "Petunjuk_dan_Rumus");

  const desktopPath = "C:\\Users\\User\\Desktop\\Template_Bulk_Import_Stok_RB_Autoluxe.xlsx";
  XLSX.writeFile(wb, desktopPath);
  console.log("Template stok berhasil dibuat di:", desktopPath);
}

createStockTemplate();
