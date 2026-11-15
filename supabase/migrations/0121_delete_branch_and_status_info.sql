-- Migration 0121: Function to delete empty branch safely & validate historical transactions
-- Description: Allows owner/maintainer to delete branches only if they have NO transaction/order/cash history.

CREATE OR REPLACE FUNCTION public.delete_branch(
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_branch_count integer;
  v_staff_count integer;
  v_order_count integer;
  v_cash_count integer;
  v_invoice_count integer;
  v_stock_count integer;
  v_branch_name text;
BEGIN
  -- 1. Verifikasi autentikasi
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Aksi hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  END IF;

  -- 2. Verifikasi role (Hanya owner & maintainer)
  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Hanya owner dan maintainer yang memiliki wewenang untuk menghapus cabang.';
  END IF;

  -- 3. Cek apakah cabang ada
  SELECT branch_name INTO v_branch_name FROM public.branches WHERE id = p_branch_id;
  IF v_branch_name IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan.';
  END IF;

  -- 4. Minimal harus ada 1 cabang di sistem
  SELECT count(*) INTO v_branch_count FROM public.branches;
  IF v_branch_count <= 1 THEN
    RAISE EXCEPTION 'Tidak dapat menghapus cabang terakhir. Sistem memerlukan minimal satu cabang.';
  END IF;

  -- 5. Cek apakah masih ada staf terikat (aktif maupun nonaktif)
  SELECT count(*) INTO v_staff_count FROM public.profiles WHERE branch_id = p_branch_id;
  IF v_staff_count > 0 THEN
    RAISE EXCEPTION 'Cabang masih memiliki % staf terikat. Pindahkan atau ubah penempatan cabang staf tersebut terlebih dahulu.', v_staff_count;
  END IF;

  -- 6. Cek riwayat order (orders)
  SELECT count(*) INTO v_order_count FROM public.orders WHERE branch_id = p_branch_id;
  IF v_order_count > 0 THEN
    RAISE EXCEPTION 'Cabang "%" sudah memiliki % riwayat transaksi order. Untuk menjaga integritas data keuangan dan garansi pelanggan, cabang ini tidak dapat dihapus permanen. Silakan gunakan opsi Tutup Permanen (Nonaktifkan).', v_branch_name, v_order_count;
  END IF;

  -- 7. Cek riwayat arus kas (cash_flow)
  SELECT count(*) INTO v_cash_count FROM public.cash_flow WHERE branch_id = p_branch_id;
  IF v_cash_count > 0 THEN
    RAISE EXCEPTION 'Cabang "%" memiliki riwayat pembukuan arus kas. Gunakan opsi Tutup Permanen (Nonaktifkan) agar audit keuangan tetap utuh.', v_branch_name;
  END IF;

  -- 8. Cek riwayat invoice
  SELECT count(*) INTO v_invoice_count FROM public.invoices WHERE branch_id = p_branch_id;
  IF v_invoice_count > 0 THEN
    RAISE EXCEPTION 'Cabang "%" memiliki riwayat invoice/faktur. Gunakan opsi Tutup Permanen (Nonaktifkan).', v_branch_name;
  END IF;

  -- 9. Cek riwayat klaim stok
  SELECT count(*) INTO v_stock_count FROM public.stock_claims WHERE branch_id = p_branch_id;
  IF v_stock_count > 0 THEN
    RAISE EXCEPTION 'Cabang "%" memiliki riwayat klaim stok inventaris. Gunakan opsi Tutup Permanen (Nonaktifkan).', v_branch_name;
  END IF;

  -- 10. Hapus cabang (tabel berelasi seperti attendance, stock_opnames, shift_handoffs memiliki ON DELETE CASCADE)
  DELETE FROM public.branches WHERE id = p_branch_id;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.delete_branch(uuid) TO authenticated;
