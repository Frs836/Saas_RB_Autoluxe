-- ============================================================
-- 0132_bundle_stock_complete_workflow.sql
-- Alur Lengkap Racikan Stok (Paritas UX dengan Stok Utama):
-- 1. claim_type di stock_claims ('produce' vs 'use')
-- 2. create_bundle_claim untuk semua role (klaim pakai & produksi)
-- 3. confirm_bundle_claim (approval oleh manager, owner, maintainer, finance)
-- 4. reject_stock_claim (bisa oleh manager, owner, maintainer, finance)
-- 5. opname_bundle (penyesuaian stok fisik racikan langsung)
-- 6. set_bundle_definition (mendukung edit by id & unit ml/gr/pcs)
-- ============================================================

-- 1. Tambah kolom claim_type di stock_claims jika belum ada
ALTER TABLE public.stock_claims
  ADD COLUMN IF NOT EXISTS claim_type VARCHAR(20) NOT NULL DEFAULT 'use';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'stock_claims_claim_type_check'
  ) THEN
    ALTER TABLE public.stock_claims
      ADD CONSTRAINT stock_claims_claim_type_check
      CHECK (claim_type IN ('use', 'produce'));
  END IF;
END $$;

-- Update klaim racikan lama agar bertipe 'produce' jika unitnya 'batch'
UPDATE public.stock_claims
SET claim_type = 'produce'
WHERE bundle_id IS NOT NULL AND unit = 'batch';

-- 2. Update reject_stock_claim agar role manager, finance, maintener bisa menolak
CREATE OR REPLACE FUNCTION public.reject_stock_claim(
  p_claim_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role        text;
  v_profile_id  uuid;
BEGIN
  v_profile_id := public.current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'admin_kasir', 'kepala_karyawan', 'kepala_mekanik') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, finance, atau kasir yang dapat menolak pengajuan stok.';
  END IF;

  UPDATE public.stock_claims
  SET
    status = 'rejected',
    confirmed_by = v_profile_id,
    confirmed_at = now(),
    note = CASE
      WHEN note IS NOT NULL AND note != '' THEN note || ' | Ditolak: ' || COALESCE(p_reason, 'Tidak disetujui')
      ELSE 'Ditolak: ' || COALESCE(p_reason, 'Tidak disetujui')
    END
  WHERE id = p_claim_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan atau sudah diproses.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_stock_claim TO authenticated;

-- 3. Update create_bundle_claim: bisa untuk 'produce' (produksi) atau 'use' (klaim pemakaian)
DROP FUNCTION IF EXISTS public.create_bundle_claim(uuid, numeric, text);
DROP FUNCTION IF EXISTS public.create_bundle_claim(uuid, numeric, text, uuid);
DROP FUNCTION IF EXISTS public.create_bundle_claim(uuid, numeric, text, uuid, text);
CREATE OR REPLACE FUNCTION public.create_bundle_claim(
  p_bundle_id   uuid,
  p_quantity    numeric,
  p_note        text DEFAULT NULL,
  p_order_id    uuid DEFAULT NULL,
  p_claim_type  text DEFAULT 'produce'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile_id  uuid;
  v_branch_id   uuid;
  v_bundle      record;
  v_claim_id    uuid;
  v_user_branch uuid;
  v_role        text;
  v_unit        text;
  v_type        text;
BEGIN
  v_profile_id := public.current_profile_id();
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Jumlah harus lebih dari 0.';
  END IF;

  v_type := LOWER(COALESCE(p_claim_type, 'produce'));
  IF v_type NOT IN ('produce', 'use') THEN
    v_type := 'produce';
  END IF;

  -- Ambil data bundle
  SELECT branch_id, bundle_name, unit, output_qty, is_active
  INTO v_bundle
  FROM public.bundle_items
  WHERE id = p_bundle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Racikan tidak ditemukan.';
  END IF;

  IF NOT v_bundle.is_active THEN
    RAISE EXCEPTION 'Racikan tidak aktif.';
  END IF;

  v_branch_id := v_bundle.branch_id;

  SELECT branch_id, role INTO v_user_branch, v_role
  FROM public.profiles WHERE id = v_profile_id;

  IF v_role NOT IN ('owner', 'maintainer', 'maintener') AND v_user_branch IS NOT NULL AND v_user_branch != v_branch_id THEN
    RAISE EXCEPTION 'Anda hanya dapat mengajukan untuk cabang Anda sendiri.';
  END IF;

  -- Satuan untuk klaim
  IF v_type = 'produce' THEN
    v_unit := 'batch';
  ELSE
    v_unit := COALESCE(v_bundle.unit, 'ml');
  END IF;

  INSERT INTO public.stock_claims (
    item_id, bundle_id, branch_id, quantity, unit, note, order_id, status, claimed_by, claim_type
  ) VALUES (
    NULL, p_bundle_id, v_branch_id, p_quantity, v_unit, p_note, p_order_id, 'pending', v_profile_id, v_type
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_bundle_claim TO authenticated;

-- 4. Update confirm_bundle_claim: handle 'produce' (potong bahan baku, tambah racikan) vs 'use' (potong racikan saja)
CREATE OR REPLACE FUNCTION public.confirm_bundle_claim(p_claim_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role        text;
  v_profile_id  uuid;
  v_claim       record;
  v_bundle      record;
  v_comp        record;
  v_needed      numeric;
  v_current     numeric;
  v_added_stock numeric;
  v_total_cost  numeric := 0;
  v_balance     numeric;
BEGIN
  v_profile_id := public.current_profile_id();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'kepala_mekanik', 'kepala_karyawan') THEN
    RAISE EXCEPTION 'Hanya manager, finance, maintainer, atau owner yang dapat menyetujui pengajuan racikan.';
  END IF;

  -- Ambil klaim
  SELECT * INTO v_claim
  FROM public.stock_claims
  WHERE id = p_claim_id AND bundle_id IS NOT NULL AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan racikan tidak ditemukan atau sudah diproses.';
  END IF;

  -- Ambil data bundle
  SELECT * INTO v_bundle
  FROM public.bundle_items
  WHERE id = v_claim.bundle_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Data master racikan tidak ditemukan.';
  END IF;

  -- ========================================================
  -- KASUS A: PRODUKSI RACIKAN (claim_type = 'produce')
  -- Ini SATU-SATUNYA trigger yang memotong stok utama dan menambah stok racikan!
  -- ========================================================
  IF v_claim.claim_type = 'produce' THEN
    -- Loop komponen: validasi kecukupan stok bahan baku & potong
    FOR v_comp IN
      SELECT bc.item_id, bc.quantity, ii.current_stock, ii.item_name, ii.unit, ii.unit_cost
      FROM public.bundle_components bc
      JOIN public.inventory_items ii ON ii.id = bc.item_id
      WHERE bc.bundle_id = v_claim.bundle_id
    LOOP
      v_needed := v_comp.quantity * v_claim.quantity;
      v_current := COALESCE(v_comp.current_stock, 0);

      IF v_current < v_needed THEN
        RAISE EXCEPTION 'Stok bahan baku % tidak cukup. Tersedia: % %, dibutuhkan: % %.',
          v_comp.item_name,
          v_current, v_comp.unit,
          v_needed, v_comp.unit;
      END IF;

      -- Kurangi stok bahan baku gudang
      UPDATE public.inventory_items
      SET current_stock = current_stock - v_needed
      WHERE id = v_comp.item_id
      RETURNING current_stock INTO v_balance;

      -- Hitung total cost
      IF v_comp.unit_cost IS NOT NULL THEN
        v_total_cost := v_total_cost + (v_needed * v_comp.unit_cost);
      END IF;

      -- Log pemotongan bahan baku di stock_logs
      INSERT INTO public.stock_logs (
        branch_id, item_id, bundle_id, log_type, quantity, balance_after,
        reference_id, created_by, note, unit_cost, cost_amount
      ) VALUES (
        v_claim.branch_id,
        v_comp.item_id,
        v_bundle.id,
        'out'::public.stock_log_type,
        v_needed,
        v_balance,
        v_claim.id,
        v_profile_id,
        'Bahan baku untuk produksi racikan ' || v_bundle.bundle_name || ' (' || v_claim.quantity || ' batch)',
        v_comp.unit_cost,
        CASE WHEN v_comp.unit_cost IS NOT NULL THEN v_needed * v_comp.unit_cost ELSE NULL END
      );
    END LOOP;

    -- Tambah stok fisik racikan jadi: (output_qty * quantity)
    v_added_stock := COALESCE(v_bundle.output_qty, 1) * v_claim.quantity;
    UPDATE public.bundle_items
    SET current_stock = current_stock + v_added_stock
    WHERE id = v_claim.bundle_id
    RETURNING current_stock INTO v_balance;

    -- Log penambahan stok fisik racikan
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note, unit_cost, cost_amount
    ) VALUES (
      v_claim.branch_id,
      NULL,
      v_claim.bundle_id,
      'in'::public.stock_log_type,
      v_added_stock,
      v_balance,
      v_claim.id,
      v_profile_id,
      'Hasil produksi racikan jadi: +' || v_added_stock || ' ' || v_bundle.unit || ' (' || v_claim.quantity || ' batch)',
      CASE WHEN v_added_stock > 0 AND v_total_cost > 0 THEN v_total_cost / v_added_stock ELSE NULL END,
      v_total_cost
    );

  -- ========================================================
  -- KASUS B: KLAIM PEMAKAIAN RACIKAN (claim_type = 'use')
  -- Mengambil racikan jadi yang sudah tersedia di rak.
  -- TIDAK memotong bahan baku! Hanya memotong current_stock racikan.
  -- ========================================================
  ELSE
    v_current := COALESCE(v_bundle.current_stock, 0);
    IF v_current < v_claim.quantity THEN
      RAISE EXCEPTION 'Stok racikan % tidak cukup. Tersedia: % %, diminta: % %.',
        v_bundle.bundle_name,
        v_current, v_bundle.unit,
        v_claim.quantity, v_bundle.unit;
    END IF;

    -- Kurangi stok racikan
    UPDATE public.bundle_items
    SET current_stock = current_stock - v_claim.quantity
    WHERE id = v_claim.bundle_id
    RETURNING current_stock INTO v_balance;

    -- Log pemakaian racikan
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note, unit_cost, cost_amount
    ) VALUES (
      v_claim.branch_id,
      NULL,
      v_claim.bundle_id,
      'out'::public.stock_log_type,
      v_claim.quantity,
      v_balance,
      COALESCE(v_claim.order_id, v_claim.id),
      v_profile_id,
      'Klaim pemakaian racikan ' || v_bundle.bundle_name || 
        CASE WHEN v_claim.order_id IS NOT NULL THEN ' (Order #' || SUBSTRING(v_claim.order_id::text, 1, 8) || ')' ELSE '' END ||
        CASE WHEN v_claim.note IS NOT NULL AND v_claim.note != '' THEN ' - ' || v_claim.note ELSE '' END,
      NULL,
      NULL
    );
  END IF;

  -- Update status klaim menjadi disetujui (confirmed)
  UPDATE public.stock_claims
  SET status = 'confirmed', confirmed_by = v_profile_id, confirmed_at = now()
  WHERE id = p_claim_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_bundle_claim TO authenticated;

-- 5. RPC Baru: opname_bundle (Penyesuaian stok fisik racikan secara langsung)
CREATE OR REPLACE FUNCTION public.opname_bundle(
  p_bundle_id     uuid,
  p_physical_qty  numeric,
  p_note          text DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role        text;
  v_profile_id  uuid;
  v_bundle      record;
  v_diff        numeric;
  v_new_stock   numeric;
BEGIN
  v_profile_id := public.current_profile_id();
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance', 'kepala_mekanik', 'kepala_karyawan') THEN
    RAISE EXCEPTION 'Hanya manager, finance, maintainer, atau owner yang dapat melakukan opname racikan.';
  END IF;

  IF p_physical_qty IS NULL OR p_physical_qty < 0 THEN
    RAISE EXCEPTION 'Stok fisik tidak boleh bernilai negatif.';
  END IF;

  SELECT * INTO v_bundle
  FROM public.bundle_items
  WHERE id = p_bundle_id AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Racikan tidak ditemukan.';
  END IF;

  v_diff := p_physical_qty - COALESCE(v_bundle.current_stock, 0);

  -- Update stok fisik racikan
  UPDATE public.bundle_items
  SET current_stock = p_physical_qty
  WHERE id = p_bundle_id
  RETURNING current_stock INTO v_new_stock;

  -- Catat log opname jika ada selisih
  IF v_diff != 0 THEN
    INSERT INTO public.stock_logs (
      branch_id, item_id, bundle_id, log_type, quantity, balance_after,
      reference_id, created_by, note, unit_cost, cost_amount
    ) VALUES (
      v_bundle.branch_id,
      NULL,
      v_bundle.id,
      CASE WHEN v_diff > 0 THEN 'in'::public.stock_log_type ELSE 'out'::public.stock_log_type END,
      ABS(v_diff),
      v_new_stock,
      v_bundle.id,
      v_profile_id,
      'Opname fisik racikan ' || v_bundle.bundle_name || ': fisik ' || p_physical_qty || ' ' || v_bundle.unit ||
        ' (selisih ' || CASE WHEN v_diff > 0 THEN '+' ELSE '' END || v_diff || ' ' || v_bundle.unit || ')' ||
        CASE WHEN p_note IS NOT NULL AND p_note != '' THEN ' - ' || p_note ELSE '' END,
      NULL,
      NULL
    );
  END IF;

  RETURN v_new_stock;
END;
$$;

GRANT EXECUTE ON FUNCTION public.opname_bundle TO authenticated;

-- 6. Update set_bundle_definition: mendukung p_bundle_id opsional (untuk edit langsung) & unit ml/gr/pcs
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb, numeric);
DROP FUNCTION IF EXISTS public.set_bundle_definition(uuid, text, text, text, jsonb, numeric, uuid);
CREATE OR REPLACE FUNCTION public.set_bundle_definition(
  p_branch_id   uuid,
  p_bundle_name text,
  p_unit        text,
  p_description text DEFAULT NULL,
  p_components  jsonb DEFAULT '[]'::jsonb,
  p_output_qty  numeric DEFAULT 1,
  p_bundle_id   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_role        text;
  v_branch_id   uuid;
  v_bundle_id   uuid;
  v_comp        record;
  v_clean_unit  text;
BEGIN
  SELECT role, branch_id INTO v_role, v_branch_id 
  FROM public.profiles 
  WHERE id = public.current_profile_id();

  IF v_role NOT IN ('owner', 'maintainer', 'maintener', 'manager', 'finance') THEN
    RAISE EXCEPTION 'Hanya owner, manager, maintainer, dan finance yang dapat mengelola racikan.';
  END IF;

  -- Normalisasi unit: ml, gr, pcs
  v_clean_unit := LOWER(TRIM(COALESCE(p_unit, 'ml')));
  IF v_clean_unit NOT IN ('ml', 'gr', 'pcs') THEN
    v_clean_unit := 'ml';
  END IF;

  -- Fallback branch_id jika kosong
  v_branch_id := COALESCE(p_branch_id, v_branch_id);
  IF v_branch_id IS NULL THEN
    SELECT id INTO v_branch_id FROM public.branches WHERE is_active = true LIMIT 1;
  END IF;

  IF p_bundle_id IS NOT NULL THEN
    -- Update racikan yang sudah ada
    UPDATE public.bundle_items
    SET
      bundle_name = TRIM(p_bundle_name),
      unit        = v_clean_unit,
      output_qty  = GREATEST(COALESCE(p_output_qty, 1), 0.01),
      description = TRIM(p_description),
      is_active   = true
    WHERE id = p_bundle_id
    RETURNING id INTO v_bundle_id;
  ELSE
    -- Upsert by (bundle_name, branch_id)
    INSERT INTO public.bundle_items (branch_id, bundle_name, unit, output_qty, description, is_active)
    VALUES (v_branch_id, TRIM(p_bundle_name), v_clean_unit, GREATEST(COALESCE(p_output_qty, 1), 0.01), TRIM(p_description), true)
    ON CONFLICT (bundle_name, branch_id)
    DO UPDATE SET
      unit        = EXCLUDED.unit,
      output_qty  = EXCLUDED.output_qty,
      description = EXCLUDED.description,
      is_active   = true
    RETURNING id INTO v_bundle_id;
  END IF;

  -- Replace komponen
  DELETE FROM public.bundle_components WHERE bundle_id = v_bundle_id;

  FOR v_comp IN SELECT * FROM jsonb_array_elements(p_components)
  LOOP
    INSERT INTO public.bundle_components (bundle_id, item_id, quantity)
    VALUES (
      v_bundle_id,
      (v_comp->>'item_id')::uuid,
      (v_comp->>'quantity')::numeric
    );
  END LOOP;

  RETURN v_bundle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_bundle_definition TO authenticated;
