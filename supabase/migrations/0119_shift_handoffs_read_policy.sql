-- 0119_shift_handoffs_read_policy.sql
-- ============================================================
-- Semua staf aktif di cabang yang sama bisa membaca status
-- shift_handoffs untuk badge kasir di dashboard.
--
-- Sebelumnya tidak ada policy SELECT eksplisit, sehingga
-- karyawan tidak bisa membaca baris shift_handoffs cabangnya
-- dan badge kasir di dashboard selalu kosong/null.
--
-- Aturan:
--   SELECT : staf aktif di cabang yang sama (semua role)
--   INSERT/UPDATE : tetap hanya lewat RPC (SECURITY DEFINER)
-- ============================================================

-- Aktifkan RLS jika belum aktif
ALTER TABLE public.shift_handoffs ENABLE ROW LEVEL SECURITY;

-- Hapus policy lama jika ada (idempoten)
DROP POLICY IF EXISTS shift_handoffs_read_own_branch ON public.shift_handoffs;

-- Policy SELECT: semua staf aktif di cabang yang sama
CREATE POLICY shift_handoffs_read_own_branch
  ON public.shift_handoffs
  FOR SELECT
  TO authenticated
  USING (
    branch_id = (
      SELECT p.branch_id
        FROM public.profiles p
       WHERE p.auth_id = (SELECT auth.uid())
         AND p.is_active = true
       LIMIT 1
    )
  );

-- Service role tetap bisa baca semua (untuk RPC internal)
DROP POLICY IF EXISTS shift_handoffs_service_role ON public.shift_handoffs;
CREATE POLICY shift_handoffs_service_role
  ON public.shift_handoffs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY shift_handoffs_read_own_branch ON public.shift_handoffs IS
  '0119: Semua staf aktif di cabang yang sama bisa baca status shift — untuk badge kasir di dashboard.';
