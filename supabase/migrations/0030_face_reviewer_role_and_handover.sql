-- 0030_face_reviewer_role_and_handover.sql
--
-- Dua perbaikanFACE dan satu alur kerja baru.
--
-- 1. Owner tidak bisa membuka daftar verifikasi wajah.
--    Halaman /pengaturan/wajah dijaga izin branch.manage, yang dimiliki owner
--    dan maintainer. Tapi fungsi pending_face_registrations dan
--    review_staff_face hanya menerima maintainer. Owner membuka halaman,
--    fungsi menolak, dan halaman_changedrespond dengan daftar kosong karena
--    errornya tidak dibaca. Akibatnya owner melihat "tidak ada pendaftaran"
--    padahal barisnya ada.
--
-- 2. Maintainer tidak bisa memverifikasi wajahnya sendiri.
--    Fungsi menolak dengan 'Wajah sendiri tidak dapat diverifikasi sendiri.'
--    Untuk workshop kecil dengan satu orangQB maintainer, itu membuat
--    maintainer tidak bisa absen sama sekali. Self-review sekarang diizinkan
--    tetapi selalu tercatat di jejak audit sebagai self-review, jadi
--    penyimpangan ini terlihat dan bukan tersembunyi.
--
-- 3. Alur serah terima kendaraan.
--    Setelah QC selesai, mobil biasanya belum diambil pelanggan. Order yang
--    langsung berstatus completed menyamar sudah selesai padahal pelanggan
--    masih belum datang. Dua tahap baru: menunggu_diambil lalu diserahkan.

-- ---------------------------------------------------------------------------
-- 1. Status order: tambah tahap serah terima
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE public.order_status AS ENUM
      ('queued','in_progress','qc_review','completed','cancelled');
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
     WHERE enumtypid = 'public.order_status'::regtype AND enumlabel = 'menunggu_diambil'
  ) THEN
    ALTER TYPE public.order_status ADD VALUE 'menunggu_diambil';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
     WHERE enumtypid = 'public.order_status'::regtype AND enumlabel = 'diserahkan'
  ) THEN
    ALTER TYPE public.order_status ADD VALUE 'diserahkan';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Owner boleh membaca dan meninjau
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pending_face_registrations()
RETURNS TABLE(
  profile_id              uuid,
  full_name               text,
  role                    user_role,
  branch_name             text,
  face_verification       face_verification_status,
  face_review_note        text,
  registered_at           timestamptz,
  reference_photo_url     text,
  has_descriptor          boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Daftar verifikasi wajah hanya bisa dibaca pengguna yang sudah masuk.';
  END IF;

  -- Owner ikutzulolkong, sama seperti maintainer. Sebelumnya owner terkunci di
  -- fungsi padahal halamannya terbuka untuknya.
  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Daftar verifikasi wajah hanya bisa dibaca oleh owner atau maintainer.';
  END IF;

  RETURN QUERY
  SELECT p.id,
         p.full_name::text,
         p.role,
         b.branch_name::text,
         COALESCE(p.face_verification, 'pending'::public.face_verification_status),
         p.face_review_note::text,
         COALESCE(p.face_registered_at, p.updated_at),
         p.face_reference_photo_url::text,
         (p.face_descriptor IS NOT NULL)
    FROM public.profiles p
    LEFT JOIN public.branches b ON b.id = p.branch_id
   WHERE p.face_descriptor IS NOT NULL
   ORDER BY
     CASE COALESCE(p.face_verification, 'pending'::public.face_verification_status)
       WHEN 'pending' THEN 0
       WHEN 'rejected' THEN 1
       ELSE 2
     END,
     p.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_staff_face(
  p_profile_id uuid,
  p_approved boolean,
  p_note text DEFAULT NULL
) RETURNS profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_reviewer uuid;
  v_target   public.profiles%rowtype;
  v_row      public.profiles%rowtype;
  v_status   public.face_verification_status;
  v_note     text;
  v_mandiri  boolean;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Verifikasi wajah hanya bisa dilakukan pengguna yang sudah masuk.';
  END IF;

  v_reviewer := public.current_profile_id();
  IF v_reviewer IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Verifikasi wajah hanya bisa dilakukan oleh owner atau maintainer.';
  END IF;

  SELECT * INTO v_target FROM public.profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil staf tidak ditemukan.';
  END IF;

  -- Self-review diizinkan. Diworkshop dengan satu orangQB maintainer,
  -- melarangnya membuat maintainer tidak bisa absen sama sekali. Yang
  -- berubah adalah pencatatannya:self-review selalu ditandai di jejak audit
  -- supaya penyimpangan ini terlihat.
  v_mandiri := (v_target.id = v_reviewer);

  IF v_target.face_descriptor IS NULL THEN
    RAISE EXCEPTION 'Staf ini belum mendaftarkan sampel wajah.';
  END IF;

  IF NOT v_target.is_active THEN
    RAISE EXCEPTION 'Akun staf ini sedang tidak aktif.';
  END IF;

  v_status := CASE
                WHEN p_approved THEN 'approved'::public.face_verification_status
                ELSE 'rejected'::public.face_verification_status
              END;

  v_note := NULLIF(btrim(coalesce(p_note, '')), '');

  IF NOT p_approved AND v_note IS NULL THEN
    RAISE EXCEPTION 'Penolakan wajib disertai alasan yang bisa dibaca staf.';
  END IF;

  UPDATE public.profiles
     SET face_verification = v_status,
         face_reviewed_by  = v_reviewer,
         face_reviewed_at  = now(),
         face_review_note  = v_note,
         updated_at        = now()
   WHERE id = p_profile_id
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_reviewer,
    'profile.face_review.' || v_status::text,
    'profiles', p_profile_id,
    jsonb_build_object('status', v_status::text, 'note', v_note, 'self_review', v_mandiri)
  );

  INSERT INTO public.notifications (recipient_id, title, body, category, payload)
  VALUES (
    p_profile_id,
    CASE WHEN p_approved THEN 'Wajah Anda disetujui' ELSE 'Wajah Anda ditolak' END,
    CASE WHEN p_approved
         THEN 'Sampel wajah Anda sudah diverifikasi. Anda dapat melakukan absensi.'
         ELSE 'Sampel wajah Anda ditolak. Alasan: ' || COALESCE(v_note, '-') ||
              '. Silakan mendaftarkan ulang di halaman absensi.'
    END,
    'account',
    jsonb_build_object('face_status', v_status::text)
  );

  RETURN v_row;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.review_staff_face(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pending_face_registrations() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Transisi serah terima kendaraan
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_handover(
  p_order_id uuid,
  p_next     public.order_status
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_order   public.orders%rowtype;
  v_profile uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Status serah terima hanya bisa diubah oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := public.current_profile_id();
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  IF NOT COALESCE(public.can_access_branch(v_order.branch_id), false) THEN
    RAISE EXCEPTION 'Order ini berada di luar cabang Anda.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(array['owner','admin_kasir','maintainer','karyawan']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Peran Anda tidak berwenang mengubah status serah terima.';
  END IF;

  -- Transisi hanya dua arah yang jelas. Men Lankan dari status lain
  -- ditolak supaya tidak bisa melompati tahap.
  IF NOT (
    (v_order.status = 'completed'           AND p_next = 'menunggu_diambil') OR
    (v_order.status = 'menunggu_diambil'  AND p_next = 'diserahkan')
  ) THEN
    RAISE EXCEPTION
      'Status tidak bisa berubah dari % ke %. Alur: selesai, menunggu diambil, diserahkan.',
      v_order.status, p_next
      USING errcode = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'on', true);

  UPDATE public.orders
     SET status = p_next,
         completed_at = CASE WHEN p_next = 'diserahkan' THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE id = p_order_id;

  PERFORM pg_catalog.set_config('app.trusted_order_write', 'off', true);

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'order.status.' || p_next::text, 'order', p_order_id,
    jsonb_build_object(
      'from', v_order.status, 'to', p_next::text,
      'order_number', v_order.order_number, 'branch_id', v_order.branch_id
    )
  );

  RETURN p_next::text;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.advance_handover(uuid, public.order_status) TO authenticated;