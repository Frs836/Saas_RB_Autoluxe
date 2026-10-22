-- 0060: satuan stok diseragamkan.
--
-- Bahan cair dihitung dalam mililiter (ml) supaya resep bisa memakai takaran
-- kecil seperti 15 ml tanpa pecahan botol. Benda padat dihitung dalam pcs.
--
-- Konversi yang dipakai:
--   liter -> ml  : dikali 1.000
--   botol -> ml  : diasumsikan 1 botol = 1.000 ml
--   roll  -> pcs : jumlah gulungan tetap dihitung per unit
--
-- Harga satuan dan batas minimum ikut dikonversi agar nilai rupiah per ml
-- tetap sama dengan sebelumnya. Migrasi ini idempoten: baris yang satuannya
-- sudah ml/pcs tidak disentuh lagi.

UPDATE public.inventory_items
   SET current_stock   = round(current_stock * 1000, 2),
       min_stock_alert = round(min_stock_alert * 1000, 2),
       unit_cost       = round(unit_cost / 1000, 2),
       unit            = 'ml',
       updated_at      = now()
 WHERE unit IN ('liter', 'botol');

UPDATE public.inventory_items
   SET unit       = 'pcs',
       updated_at = now()
 WHERE unit = 'roll';
