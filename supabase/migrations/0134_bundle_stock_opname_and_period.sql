-- ============================================================
-- 0134_bundle_stock_opname_and_period.sql
-- Mendukung Opname Bulanan 2-Tahap untuk Racikan (Persis Stok Utama):
-- 1. Tambah opname_type ('inventory' vs 'bundle') di stock_opnames
-- 2. Tambah bundle_id di stock_opname_lines
-- 3. RPC open_bundle_stock_opname, save_bundle_opname_lines, submit_bundle_stock_opname
-- 4. Buka akses role lengkap (owner, manager, maintainer, finance, kepala_karyawan)
-- ============================================================

-- 1. Tambah opname_type di stock_opnames
ALTER TABLE public.stock_opnames
  ADD COLUMN IF NOT EXISTS opname_type VARCHAR(20) NOT NULL DEFAULT 'inventory';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_opnames_opname_type_check'
  ) THEN
    ALTER TABLE public.stock_opnames
      ADD CONSTRAINT stock_opnames_opname_type_check
      CHECK (opname_type IN ('inventory', 'bundle'));
  END IF;
END $$;

-- Perbarui unique constraint stock_opnames agar mendukung periode per cabang per tipe opname
DROP INDEX IF EXISTS public.stock_opnames_branch_period_key;
CREATE UNIQUE INDEX IF NOT EXISTS stock_opnames_branch_period_type_key
  ON public.stock_opnames (branch_id, period_month, opname_type);

-- 2. Dukung bundle_id di stock_opname_lines
ALTER TABLE public.stock_opname_lines
  ALTER COLUMN item_id DROP NOT NULL;

ALTER TABLE public.stock_opname_lines
  ADD COLUMN IF NOT EXISTS bundle_id uuid REFERENCES public.bundle_items(id) ON DELETE CASCADE;

-- Constraint: harus salah satu terisi (item_id ATAU bundle_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_opname_lines_item_or_bundle'
  ) THEN
    ALTER TABLE public.stock_opname_lines
      ADD CONSTRAINT stock_opname_lines_item_or_bundle
      CHECK (
        (item_id IS NOT NULL AND bundle_id IS NULL) OR
        (item_id IS NULL AND bundle_id IS NOT NULL)
      );
  END IF;
END $$;

-- Ganti constraint unique (opname_id, item_id) dengan indeks unik parsial
ALTER TABLE public.stock_opname_lines
  DROP CONSTRAINT IF EXISTS stock_opname_lines_unique;

CREATE UNIQUE INDEX IF NOT EXISTS stock_opname_lines_item_unique
  ON public.stock_opname_lines (opname_id, item_id)
  WHERE item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS stock_opname_lines_bundle_unique
  ON public.stock_opname_lines (opname_id, bundle_id)
  WHERE bundle_id IS NOT NULL;

-- 3. Perbarui open_stock_opname (untuk stok utama/inventory) agar mendukung peran lengkap
CREATE OR REPLACE FUNCTION public.open_stock_opname(
  p_branch_id uuid,
  p_period_month date,
  p_notes text default null::text
)
RETURNS public.stock_opnames
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_role      text;
  v_month     date;
  v_existing  public.stock_opnames%rowtype;
  v_row       public.stock_opnames%rowtype;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'admin_kasir', 'kepala_karyawan', 'kepala_mekanik') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, finance, atau kasir yang bisa melakukan opname.';
  END IF;

  IF NOT public.can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'Cabang tersebut tidak dapat diakses.';
  END IF;

  v_month := date_trunc('month', p_period_month)::date;

  SELECT * INTO v_existing
  FROM public.stock_opnames
  WHERE branch_id = p_branch_id
    AND period_month = v_month
    AND opname_type = 'inventory';

  IF FOUND THEN
    IF v_existing.status = 'submitted'::public.stock_opname_status THEN
      RAISE EXCEPTION 'Opname bulan % pada cabang ini sudah dikirim.', to_char(v_month, 'MM/YYYY');
    END IF;

    IF v_existing.status = 'cancelled'::public.stock_opname_status THEN
      RAISE EXCEPTION 'Opname bulan % pada cabang ini sudah dibatalkan.', to_char(v_month, 'MM/YYYY');
    END IF;

    RETURN v_existing;
  END IF;

  INSERT INTO public.stock_opnames (branch_id, period_month, opname_type, notes, created_by)
  VALUES (
    p_branch_id, v_month, 'inventory', nullif(btrim(coalesce(p_notes, '')), ''), v_profile
  )
  RETURNING * INTO v_row;

  INSERT INTO public.stock_opname_lines (opname_id, item_id, system_qty)
  SELECT v_row.id, i.id, i.current_stock
  FROM public.inventory_items i
  WHERE i.branch_id = p_branch_id;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.open_stock_opname(uuid, date, text) TO authenticated;

-- 4. RPC Baru: open_bundle_stock_opname (Membuka periode opname racikan)
CREATE OR REPLACE FUNCTION public.open_bundle_stock_opname(
  p_branch_id uuid,
  p_period_month date,
  p_notes text default null::text
)
RETURNS public.stock_opnames
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_role      text;
  v_month     date;
  v_existing  public.stock_opnames%rowtype;
  v_row       public.stock_opnames%rowtype;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'admin_kasir', 'kepala_karyawan', 'kepala_mekanik') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, finance, atau kasir yang bisa melakukan opname racikan.';
  END IF;

  IF NOT public.can_access_branch(p_branch_id) THEN
    RAISE EXCEPTION 'Cabang tersebut tidak dapat diakses.';
  END IF;

  v_month := date_trunc('month', p_period_month)::date;

  SELECT * INTO v_existing
  FROM public.stock_opnames
  WHERE branch_id = p_branch_id
    AND period_month = v_month
    AND opname_type = 'bundle';

  IF FOUND THEN
    IF v_existing.status = 'submitted'::public.stock_opname_status THEN
      RAISE EXCEPTION 'Opname racikan bulan % pada cabang ini sudah dikirim.', to_char(v_month, 'MM/YYYY');
    END IF;

    IF v_existing.status = 'cancelled'::public.stock_opname_status THEN
      RAISE EXCEPTION 'Opname racikan bulan % pada cabang ini sudah dibatalkan.', to_char(v_month, 'MM/YYYY');
    END IF;

    RETURN v_existing;
  END IF;

  INSERT INTO public.stock_opnames (branch_id, period_month, opname_type, notes, created_by)
  VALUES (
    p_branch_id, v_month, 'bundle', nullif(btrim(coalesce(p_notes, '')), ''), v_profile
  )
  RETURNING * INTO v_row;

  -- Salin saldo sistem saat ini untuk seluruh racikan aktif di cabang ini
  INSERT INTO public.stock_opname_lines (opname_id, bundle_id, system_qty)
  SELECT v_row.id, b.id, COALESCE(b.current_stock, 0)
  FROM public.bundle_items b
  WHERE b.branch_id = p_branch_id
    AND b.is_active = true;

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.open_bundle_stock_opname(uuid, date, text) TO authenticated;

-- 5. RPC Baru: save_bundle_opname_lines (Menyimpan hitungan fisik racikan sebagai draf)
CREATE OR REPLACE FUNCTION public.save_bundle_opname_lines(
  p_opname_id uuid,
  p_lines jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_role      text;
  v_opname    public.stock_opnames%rowtype;
  v_count     integer := 0;
  l           record;
  v_physical  numeric;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'admin_kasir', 'kepala_karyawan', 'kepala_mekanik') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, finance, atau kasir yang bisa menyimpan opname racikan.';
  END IF;

  SELECT * INTO v_opname FROM public.stock_opnames WHERE id = p_opname_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname tidak ditemukan.';
  END IF;

  IF NOT public.can_access_branch(v_opname.branch_id) THEN
    RAISE EXCEPTION 'Opname ini milik cabang lain.';
  END IF;

  IF v_opname.status <> 'draft'::public.stock_opname_status THEN
    RAISE EXCEPTION 'Opname ini sudah dikirim dan tidak bisa diubah lagi.';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Daftar hitungan fisik tidak valid.';
  END IF;

  FOR l IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    bundle_id uuid,
    physical_qty numeric,
    note text
  )
  LOOP
    v_physical := l.physical_qty;

    IF v_physical IS NOT NULL AND v_physical < 0 THEN
      RAISE EXCEPTION 'Jumlah fisik tidak boleh negatif.';
    END IF;

    UPDATE public.stock_opname_lines
    SET physical_qty = v_physical,
        note         = nullif(btrim(coalesce(l.note, '')), '')
    WHERE opname_id = p_opname_id
      AND bundle_id = l.bundle_id;

    IF FOUND THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;

  UPDATE public.stock_opnames SET updated_at = now() WHERE id = p_opname_id;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_bundle_opname_lines(uuid, jsonb) TO authenticated;

-- 6. RPC Baru: submit_bundle_stock_opname (Finalisasi opname racikan & terapkan penyesuaian saldo)
CREATE OR REPLACE FUNCTION public.submit_bundle_stock_opname(
  p_opname_id uuid,
  p_apply_adjustment boolean default true
)
RETURNS public.stock_opnames
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile   uuid;
  v_role      text;
  v_opname    public.stock_opnames%rowtype;
  v_row       public.stock_opnames%rowtype;
  v_missing   integer;
BEGIN
  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'admin_kasir', 'kepala_karyawan', 'kepala_mekanik') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, finance, atau kasir yang bisa mengirim opname racikan.';
  END IF;

  SELECT * INTO v_opname FROM public.stock_opnames WHERE id = p_opname_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opname tidak ditemukan.';
  END IF;

  IF NOT public.can_access_branch(v_opname.branch_id) THEN
    RAISE EXCEPTION 'Opname ini milik cabang lain.';
  END IF;

  IF v_opname.status <> 'draft'::public.stock_opname_status THEN
    RAISE EXCEPTION 'Opname ini sudah diproses.';
  END IF;

  SELECT count(*) INTO v_missing
  FROM public.stock_opname_lines
  WHERE opname_id = p_opname_id
    AND physical_qty IS NULL;

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Masih ada % racikan yang belum dihitung fisiknya.', v_missing;
  END IF;

  -- Segarkan saldo sistem terbaru lalu hitung selisih
  UPDATE public.stock_opname_lines l
  SET system_qty = b.current_stock
  FROM public.bundle_items b
  WHERE l.opname_id = p_opname_id
    AND b.id = l.bundle_id;

  UPDATE public.stock_opname_lines
  SET difference = round(physical_qty - system_qty, 2)
  WHERE opname_id = p_opname_id;

  IF coalesce(p_apply_adjustment, true) THEN
    -- Update saldo racikan langsung
    UPDATE public.bundle_items b
    SET current_stock = l.physical_qty
    FROM public.stock_opname_lines l
    WHERE l.opname_id = p_opname_id
      AND l.bundle_id = b.id
      AND l.physical_qty <> l.system_qty;

    -- Catat penyesuaian ke stock_logs
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note
    )
    SELECT
      b.branch_id,
      NULL,
      l.bundle_id,
      CASE WHEN l.difference > 0 THEN 'in'::public.stock_log_type ELSE 'out'::public.stock_log_type END,
      abs(l.difference),
      l.physical_qty,
      p_opname_id,
      v_profile,
      'Opname fisik racikan ' || to_char(v_opname.period_month, 'MM/YYYY') || coalesce(' - ' || l.note, '')
    FROM public.stock_opname_lines l
    JOIN public.bundle_items b ON b.id = l.bundle_id
    WHERE l.opname_id = p_opname_id
      AND l.difference IS DISTINCT FROM 0;
  END IF;

  UPDATE public.stock_opnames
  SET status       = 'submitted'::public.stock_opname_status,
      submitted_by = v_profile,
      submitted_at = now(),
      updated_at   = now()
  WHERE id = p_opname_id
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'stock.opname.bundle.submitted', 'stock_opname', p_opname_id,
    jsonb_build_object(
      'period', to_char(v_opname.period_month, 'YYYY-MM'),
      'opname_type', 'bundle',
      'apply_adjustment', coalesce(p_apply_adjustment, true)
    )
  );

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_bundle_stock_opname(uuid, boolean) TO authenticated;
