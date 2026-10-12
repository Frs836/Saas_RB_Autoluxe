-- ============================================================================
-- RB AUTOLUXE - Migrasi 0010: Lingkup Cabang pada Serah Terima Kas
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-12
-- Sifat: NON-DESTRUKTIF.
--
-- Latar: open_shift_handoff (didefinisikan hanya di DB, predates migrasi)
--   memasukkan catatan shift_handoffs TANPA mengisi branch_id. Akibatnya,
--   kueri dashboard ("Kas Titipan Shift") dan audit shift yang menyaring
--   branch_id + shift_date tidak pernah menemukan catatan yang dibuka via RPC.
--
-- Isi:
--   1. open_shift_handoff di-OR REPLACE agar mengisi branch_id dari profil
--      pembuka (pola sama dengan guard_order_identity / guard_cash_flow_identity)
--      dengan fallback ke cabang aktif pertama bila profil belum punya cabang.
--      Signature dan seluruh pesan error DIJAGA identik.
--   2. Backfill branch_id NULL (aman, tabel masih kosong).
-- ============================================================================

set search_path = public;

-- 1. open_shift_handoff tetap dengan signature sama; hanya menambah branch_id
--    pada INSERT. Pesan error dan perhitungan expected/unknown tetap apa adanya.
CREATE OR REPLACE FUNCTION public.open_shift_handoff(p_date date, p_shift_id uuid, p_opening_cash numeric, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_profile   uuid;
  v_branch_id uuid;
  v_expected  numeric;
  v_unknown   numeric;
  v_id        uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Serah terima kas hanya bisa dibuka oleh pengguna yang sudah masuk.';
  end if;

  if not (select public.has_role(
    array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan serah terima kas.';
  end if;

  v_profile := (select public.current_profile_id());
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if p_opening_cash is null or p_opening_cash < 0 then
    raise exception 'Kas awal tidak boleh negatif.';
  end if;

  if p_shift_id is not null
     and not exists (select 1 from public.shifts s where s.id = p_shift_id) then
    raise exception 'Shift tidak ditemukan.';
  end if;

  v_branch_id := coalesce(
    (select p.branch_id from public.profiles p where p.id = v_profile),
    (select b.id from public.branches b where b.is_active order by b.created_at limit 1)
  );

  select p_opening_cash + coalesce(f.cash_in, 0) - coalesce(f.cash_out, 0),
         coalesce(f.unknown_method, 0)
    into v_expected, v_unknown
  from public.expected_cash_for_date(p_date, p_opening_cash) f;

  insert into public.shift_handoffs (
    shift_date, shift_id, opening_cash, expected_cash, unknown_method_cash,
    status, notes, opened_by, branch_id
  )
  values (
    p_date, p_shift_id, p_opening_cash, v_expected, v_unknown,
    'open'::public.shift_handoff_status,
    nullif(btrim(coalesce(p_notes, '')), ''), v_profile, v_branch_id
  )
  returning id into v_id;

  return v_id;
end;
$function$;

-- 2. Backfill catatan lama yang belum terikat cabang (idempoten, tabel kosong).
update public.shift_handoffs
   set branch_id = (
     select b.id from public.branches b where b.is_active order by b.created_at limit 1
   )
 where branch_id is null;