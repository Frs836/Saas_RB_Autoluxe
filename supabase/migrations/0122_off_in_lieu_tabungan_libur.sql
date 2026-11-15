-- Migration 0122: Tabungan Libur Pengganti (Off-in-Lieu / Day-Off Banking)
-- Allows operational staff & team leaders who work on their day off (due to deadlines)
-- to earn +1 off-in-lieu day credit, and redeem it via time off requests.

-- 1. Tambah tipe libur_pengganti ke enum time_off_type
ALTER TYPE public.time_off_type ADD VALUE IF NOT EXISTS 'libur_pengganti';

-- 2. Tambah kolom saldo tabungan libur ke tabel profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS off_in_lieu_balance integer NOT NULL DEFAULT 0;

-- 3. Tabel log riwayat mutasi tabungan libur
CREATE TABLE IF NOT EXISTS public.off_in_lieu_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  change_amount INT NOT NULL,
  previous_balance INT NOT NULL,
  new_balance INT NOT NULL,
  reason TEXT NOT NULL,
  reference_date DATE NULL,
  time_off_id UUID NULL REFERENCES public.time_off_requests(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.off_in_lieu_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS off_in_lieu_logs_select ON public.off_in_lieu_logs;
CREATE POLICY off_in_lieu_logs_select ON public.off_in_lieu_logs
  FOR SELECT TO authenticated
  USING (
    profile_id = public.current_profile_id()
    OR public.has_role(ARRAY['owner', 'maintainer', 'manager', 'admin_kasir', 'kepala_karyawan']::public.user_role[])
  );

-- 4. Trigger otomatis saat absensi masuk di hari libur rutin (default_off_day)
CREATE OR REPLACE FUNCTION public.trg_credit_off_in_lieu()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_staff record;
  v_dow int;
  v_already_credited boolean;
BEGIN
  -- Hanya periksa jika status kehadiran adalah hadir atau ada jam masuk
  IF NEW.status <> 'hadir'::public.attendance_status AND NEW.clock_in IS NULL THEN
    RETURN NEW;
  END IF;

  -- Ambil profil staf
  SELECT id, default_off_day, off_in_lieu_balance, role, full_name
    INTO v_staff
    FROM public.profiles
   WHERE id = NEW.profile_id;

  -- Jika staf tidak punya default_off_day (jadwal fleksibel murni), tidak diberi kredit otomatis
  IF v_staff.default_off_day IS NULL THEN
    RETURN NEW;
  END IF;

  -- Hari dalam seminggu (0=Minggu, 1=Senin, ..., 6=Sabtu)
  v_dow := EXTRACT(DOW FROM NEW.date)::int;

  -- Jika hari absensi sama dengan hari libur rutin staf
  IF v_dow = v_staff.default_off_day THEN
    -- Pastikan belum pernah diberi kredit untuk tanggal yang sama
    SELECT EXISTS (
      SELECT 1 FROM public.off_in_lieu_logs
       WHERE profile_id = NEW.profile_id
         AND reference_date = NEW.date
         AND change_amount > 0
    ) INTO v_already_credited;

    IF NOT v_already_credited THEN
      -- Tambah saldo tabungan libur
      UPDATE public.profiles
         SET off_in_lieu_balance = off_in_lieu_balance + 1
       WHERE id = NEW.profile_id;

      -- Catat ke log mutasi
      INSERT INTO public.off_in_lieu_logs (
        profile_id,
        change_amount,
        previous_balance,
        new_balance,
        reason,
        reference_date,
        created_by
      ) VALUES (
        NEW.profile_id,
        1,
        v_staff.off_in_lieu_balance,
        v_staff.off_in_lieu_balance + 1,
        'Kehadiran kerja di hari libur rutin (kejar deadline workshop)',
        NEW.date,
        NEW.profile_id
      );

      -- Kirim notifikasi apresiasi ke staf
      INSERT INTO public.notifications (
        recipient_id, title, body, category, payload
      ) VALUES (
        NEW.profile_id,
        'Tabungan Libur Bertambah (+1)',
        'Terima kasih atas dedikasi Anda masuk bekerja di hari libur. Anda mendapatkan +1 hari Tabungan Libur Pengganti.',
        'attendance',
        jsonb_build_object('reference_date', NEW.date, 'new_balance', v_staff.off_in_lieu_balance + 1)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_credit_off_in_lieu ON public.attendance_logs;
CREATE TRIGGER trg_attendance_credit_off_in_lieu
  AFTER INSERT OR UPDATE OF clock_in, status
  ON public.attendance_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_credit_off_in_lieu();

-- 5. Perbarui submit_time_off_request untuk memotong tabungan libur jika memilih libur_pengganti
CREATE OR REPLACE FUNCTION public.submit_time_off_request(
  p_type        public.time_off_type,
  p_start_date  date,
  p_end_date    date,
  p_reason      text,
  p_proof_path  text DEFAULT NULL
)
RETURNS public.time_off_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_today   date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_row     public.time_off_requests%rowtype;
  v_days    int;
  v_cur_bal int;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Pengajuan hanya bisa dibuat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'Tanggal mulai dan selesai wajib diisi.';
  END IF;

  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.';
  END IF;

  IF p_start_date < v_today THEN
    RAISE EXCEPTION 'Tanggal mulai tidak boleh di masa lalu.';
  END IF;

  IF (p_end_date - p_start_date) > 90 THEN
    RAISE EXCEPTION 'Durasi pengajuan maksimal 90 hari.';
  END IF;

  IF length(btrim(COALESCE(p_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Alasan minimal 5 karakter.';
  END IF;

  -- Surat dokter adalah bukti wajib untuk sakit
  IF p_type = 'sakit'::public.time_off_type
     AND NULLIF(btrim(COALESCE(p_proof_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pengajuan sakit wajib melampirkan foto surat dokter.';
  END IF;

  -- Khusus libur_pengganti: hitung hari dan periksa saldo
  v_days := (p_end_date - p_start_date) + 1;
  IF p_type = 'libur_pengganti'::public.time_off_type THEN
    SELECT off_in_lieu_balance INTO v_cur_bal FROM public.profiles WHERE id = v_profile FOR UPDATE;
    IF v_cur_bal < v_days THEN
      RAISE EXCEPTION 'Saldo Tabungan Libur tidak mencukupi (Tersedia: % hari, Dibutuhkan: % hari).', v_cur_bal, v_days;
    END IF;

    -- Potong saldo saat pengajuan (reservasi saldo)
    UPDATE public.profiles
       SET off_in_lieu_balance = off_in_lieu_balance - v_days
     WHERE id = v_profile;
  END IF;

  -- Cegah pengajuan tumpang tindih
  IF EXISTS (
    SELECT 1 FROM public.time_off_requests t
     WHERE t.profile_id = v_profile
       AND t.status IN ('pending', 'approved')
       AND t.start_date <= p_end_date
       AND t.end_date   >= p_start_date
  ) THEN
    -- Kembalikan saldo jika tumpang tindih
    IF p_type = 'libur_pengganti'::public.time_off_type THEN
      UPDATE public.profiles
         SET off_in_lieu_balance = off_in_lieu_balance + v_days
       WHERE id = v_profile;
    END IF;
    RAISE EXCEPTION 'Rentang tanggal ini sudah ada pengajuan lain yang masih aktif.';
  END IF;

  INSERT INTO public.time_off_requests (
    profile_id, type, start_date, end_date, reason, proof_photo_url, status
  ) VALUES (
    v_profile, p_type, p_start_date, p_end_date,
    btrim(p_reason),
    nullif(btrim(COALESCE(p_proof_path, '')), ''),
    'pending'::public.time_off_status
  ) RETURNING * INTO v_row;

  -- Catat log reservasi saldo jika libur_pengganti
  IF p_type = 'libur_pengganti'::public.time_off_type THEN
    INSERT INTO public.off_in_lieu_logs (
      profile_id, change_amount, previous_balance, new_balance, reason, time_off_id, created_by
    ) VALUES (
      v_profile, -v_days, v_cur_bal, v_cur_bal - v_days,
      'Pengajuan libur pengganti ' || to_char(p_start_date, 'DD/MM/YYYY') || ' s/d ' || to_char(p_end_date, 'DD/MM/YYYY') || ' (Menunggu persetujuan)',
      v_row.id, v_profile
    );
  END IF;

  -- Notifikasi ke manajemen
  INSERT INTO public.notifications (recipient_id, title, body, category, payload)
  SELECT p.id,
         'Pengajuan ' || p_type::text || ' perlu ditinjau',
         'Ada pengajuan baru bertanggal ' || to_char(p_start_date, 'DD/MM/YYYY') ||
           ' sampai ' || to_char(p_end_date, 'DD/MM/YYYY') || '.',
         'attendance',
         jsonb_build_object('time_off_id', v_row.id)
    FROM public.profiles p
   WHERE p.branch_id = (SELECT pr.branch_id FROM public.profiles pr WHERE pr.id = v_profile)
     AND p.role IN ('owner'::public.user_role, 'maintainer'::public.user_role, 'manager'::public.user_role)
     AND p.is_active;

  RETURN v_row;
END;
$function$;

-- 6. Perbarui decide_time_off_request untuk mengembalikan saldo jika ditolak, dan sinkronkan ke log kehadiran jika disetujui
CREATE OR REPLACE FUNCTION public.decide_time_off_request(
  p_id       uuid,
  p_decision public.time_off_status
)
RETURNS public.time_off_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_row     public.time_off_requests%rowtype;
  v_requester uuid;
  v_days    int;
  v_cur_bal int;
  v_date    date;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Keputusan hanya bisa diambil pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT COALESCE((
    SELECT public.has_role(ARRAY['owner', 'maintainer', 'manager']::public.user_role[])
  ), false) THEN
    RAISE EXCEPTION 'Persetujuan izin hanya bisa dilakukan oleh owner, maintainer, atau manager.';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Keputusan harus approved atau rejected.';
  END IF;

  SELECT * INTO v_row FROM public.time_off_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan.';
  END IF;

  IF v_row.status <> 'pending'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan ini sudah diputuskan.';
  END IF;

  IF v_row.profile_id = v_profile THEN
    RAISE EXCEPTION 'Anda tidak boleh memutuskan pengajuan milik sendiri.';
  END IF;

  v_days := (v_row.end_date - v_row.start_date) + 1;
  v_requester := v_row.profile_id;

  -- Jika ditolak dan tipenya libur_pengganti, kembalikan saldo yang tadi direservasi
  IF v_row.type = 'libur_pengganti'::public.time_off_type AND p_decision = 'rejected' THEN
    SELECT off_in_lieu_balance INTO v_cur_bal FROM public.profiles WHERE id = v_requester FOR UPDATE;
    UPDATE public.profiles
       SET off_in_lieu_balance = off_in_lieu_balance + v_days
     WHERE id = v_requester;

    INSERT INTO public.off_in_lieu_logs (
      profile_id, change_amount, previous_balance, new_balance, reason, time_off_id, created_by
    ) VALUES (
      v_requester, v_days, v_cur_bal, v_cur_bal + v_days,
      'Pengajuan libur pengganti ditolak (Saldo ' || v_days || ' hari dikembalikan)',
      v_row.id, v_profile
    );
  END IF;

  UPDATE public.time_off_requests
     SET status      = p_decision,
         approver_id = v_profile,
         decided_at  = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  -- Jika disetujui, buat baris kehadiran libur_shift / izin di tanggal tersebut agar tidak ditandai alpa
  IF p_decision = 'approved' THEN
    v_date := v_row.start_date;
    WHILE v_date <= v_row.end_date LOOP
      INSERT INTO public.attendance_logs (
        profile_id, date, status, notes
      ) VALUES (
        v_requester,
        v_date,
        CASE
          WHEN v_row.type = 'libur_pengganti' THEN 'libur_shift'::public.attendance_status
          WHEN v_row.type = 'sakit' THEN 'sakit'::public.attendance_status
          ELSE 'izin'::public.attendance_status
        END,
        CASE
          WHEN v_row.type = 'libur_pengganti' THEN 'Libur Pengganti (Tabungan Libur)'
          ELSE 'Izin disetujui: ' || v_row.reason
        END
      )
      ON CONFLICT (profile_id, date) DO UPDATE
         SET status = EXCLUDED.status,
             notes = EXCLUDED.notes;

      v_date := v_date + 1;
    END LOOP;
  END IF;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'time_off.' || p_decision::text, 'time_off_request', p_id,
    jsonb_build_object('type', v_row.type::text, 'profile_id', v_requester)
  );

  INSERT INTO public.notifications (recipient_id, title, body, category, payload)
  VALUES (
    v_requester,
    'Pengajuan ' || v_row.type::text || ' ' ||
      CASE WHEN p_decision = 'approved'::public.time_off_status
           THEN 'disetujui' ELSE 'ditolak' END,
    CASE WHEN p_decision = 'approved'::public.time_off_status
      THEN 'Pengajuan Anda tanggal ' || to_char(v_row.start_date, 'DD/MM/YYYY') ||
           ' sampai ' || to_char(v_row.end_date, 'DD/MM/YYYY') || ' telah disetujui.'
      ELSE 'Pengajuan Anda tanggal ' || to_char(v_row.start_date, 'DD/MM/YYYY') ||
           ' sampai ' || to_char(v_row.end_date, 'DD/MM/YYYY') ||
           ' ditolak. Saldo libur (jika ada) telah dikembalikan.'
    END,
    'attendance',
    jsonb_build_object('time_off_id', p_id, 'status', p_decision::text)
  );

  RETURN v_row;
END;
$function$;

-- 7. Perbarui cancel_time_off_request untuk mengembalikan saldo jika dibatalkan oleh staf
CREATE OR REPLACE FUNCTION public.cancel_time_off_request(p_id uuid)
RETURNS public.time_off_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_profile uuid;
  v_row     public.time_off_requests%rowtype;
  v_days    int;
  v_cur_bal int;
BEGIN
  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_row FROM public.time_off_requests r WHERE r.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pengajuan tidak ditemukan.';
  END IF;

  IF v_row.profile_id <> v_profile THEN
    RAISE EXCEPTION 'Pengajuan hanya dapat dibatalkan oleh pemohonnya.';
  END IF;

  IF v_row.status <> 'pending'::public.time_off_status THEN
    RAISE EXCEPTION 'Pengajuan ini sudah diputuskan dan tidak dapat ditarik lagi.';
  END IF;

  -- Jika tipe libur_pengganti, kembalikan saldo
  IF v_row.type = 'libur_pengganti'::public.time_off_type THEN
    v_days := (v_row.end_date - v_row.start_date) + 1;
    SELECT off_in_lieu_balance INTO v_cur_bal FROM public.profiles WHERE id = v_profile FOR UPDATE;
    UPDATE public.profiles
       SET off_in_lieu_balance = off_in_lieu_balance + v_days
     WHERE id = v_profile;

    INSERT INTO public.off_in_lieu_logs (
      profile_id, change_amount, previous_balance, new_balance, reason, time_off_id, created_by
    ) VALUES (
      v_profile, v_days, v_cur_bal, v_cur_bal + v_days,
      'Pengajuan libur pengganti dibatalkan oleh staf (Saldo ' || v_days || ' hari dikembalikan)',
      v_row.id, v_profile
    );
  END IF;

  UPDATE public.time_off_requests
     SET status = 'cancelled'::public.time_off_status,
         cancelled_at = now(),
         cancelled_by = v_profile,
         approver_id = NULL,
         decided_at = NULL
   WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.activity_logs (actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_profile, 'time_off.cancel', 'time_off_requests', p_id,
    jsonb_build_object('type', v_row.type, 'start_date', v_row.start_date)
  );

  RETURN v_row;
END;
$function$;

-- 8. Fungsi RPC penyesuaian saldo manual oleh Owner / Maintainer / Manager
CREATE OR REPLACE FUNCTION public.adjust_off_in_lieu_balance(
  p_profile_id uuid,
  p_change_amount int,
  p_reason text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_actor_role public.user_role;
  v_actor_profile uuid;
  v_cur_bal int;
  v_new_bal int;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Aksi hanya bisa dilakukan oleh pengguna yang masuk.';
  END IF;

  v_actor_profile := (SELECT public.current_profile_id());
  v_actor_role := (SELECT public.current_user_role());

  IF v_actor_role NOT IN ('owner', 'maintainer', 'manager') THEN
    RAISE EXCEPTION 'Hanya owner, maintainer, atau manager yang boleh menyesuaikan saldo tabungan libur.';
  END IF;

  IF p_change_amount = 0 THEN
    RAISE EXCEPTION 'Jumlah penyesuaian tidak boleh nol.';
  END IF;

  SELECT off_in_lieu_balance INTO v_cur_bal FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profil staf tidak ditemukan.';
  END IF;

  v_new_bal := v_cur_bal + p_change_amount;
  IF v_new_bal < 0 THEN
    RAISE EXCEPTION 'Saldo tidak boleh menjadi negatif (Saldo saat ini: %).', v_cur_bal;
  END IF;

  UPDATE public.profiles SET off_in_lieu_balance = v_new_bal WHERE id = p_profile_id;

  INSERT INTO public.off_in_lieu_logs (
    profile_id, change_amount, previous_balance, new_balance, reason, created_by
  ) VALUES (
    p_profile_id, p_change_amount, v_cur_bal, v_new_bal,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Penyesuaian manual oleh manajemen'),
    v_actor_profile
  );

  RETURN v_new_bal;
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_off_in_lieu_balance(uuid, int, text) TO authenticated;
