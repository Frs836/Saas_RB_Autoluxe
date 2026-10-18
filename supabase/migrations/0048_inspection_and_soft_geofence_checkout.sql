-- Foto hasil akhir hanya boleh diambil setelah lolos QC, dan geofence tidak
-- lagi menolak absen keluar dari luar radius.
--
-- Foto inspeksi
-- -------------
-- create_inspection_photo hanya menerima status queued, in_progress, dan
-- qc_review. Akibatnya foto 'after' justru terkunci pada saat satu-satunya
-- waktu yang benar untuk mengambilnya, yaitu setelah QC melolos. Teknisi
-- harus sudah slapping foto sebelum QC, atau servernya menolak dengan
-- "Foto inspeksi hanya bisa diunggah pada order yang sedang dikerjakan".
--
-- Aturan yang benar:
--   before dan process  -> queued, in_progress, qc_review (saat dikerjakan)
--   after               -> completed, menunggu_diambil, diserahkan (setelah QC)
--
-- Foto 'after' tetap wajib preceded foto 'before' supaya bukti kondisi awal
-- tidak bisa dilewati.
--
-- Geofence absen keluar
-- --------------------
-- attendance_check_in diubah jadi catatan lembut pada migrasi 0034, tetapi
-- attendance_check_out tidak pernah ikut diubah dan masih menolak orang yang
-- sedangSHOP home service dari luar radius. Akibatnya staf bisa masuk dari
-- luar tetapi tidak bisa keluar dari luar. Keduanya sekarang konsisten: jarak
-- hanya dicatat di distance_from_branch_meters dan outside_radius.

create or replace function public.create_inspection_photo(
  p_order_id   uuid,
  p_phase      public.inspection_phase,
  p_photo_path text,
  p_notes      text
)
returns public.order_inspections
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_status  public.order_status;
  v_phase   text := lower(coalesce(p_phase::text, ''));
  v_row     public.order_inspections%rowtype;
begin
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Foto inspeksi hanya bisa diunggah oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  IF NOT (SELECT public.can_view_order(p_order_id)) THEN
    RAISE EXCEPTION 'Order ini bukan tugas Anda.';
  END IF;

  IF v_phase NOT IN ('before', 'process', 'after') THEN
    RAISE EXCEPTION 'Tahap inspeksi harus before, process, atau after.';
  END IF;

  SELECT o.status INTO v_status FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order tidak ditemukan.';
  END IF;

  -- Foto kondisi awal dan proses diambil saat unit dikerjakan. Foto hasil
  -- akhir diambil setelah QC melolos, ketika unit sudah selesai atau siap
  -- diambil. Memisahkan keduanya membuat bukti berurutan dan tidak ada lagi
-- alasan untuk mengambil foto 'after' di tengah pengerjaan.
  IF v_phase = 'after' THEN
    IF v_status NOT IN (
      'completed'::public.order_status,
      'menunggu_diambil'::public.order_status,
      'diserahkan'::public.order_status
    ) THEN
      RAISE EXCEPTION
        'Foto hasil akhir baru bisa diambil setelah order lolos QC. Status sekarang: %.',
        v_status;
    END IF;
  ELSE
    IF v_status NOT IN (
      'queued'::public.order_status,
      'in_progress'::public.order_status,
      'qc_review'::public.order_status
    ) THEN
      RAISE EXCEPTION
        'Foto kondisi awal dan proses hanya bisa diambil saat order dikerjakan. Status sekarang: %.',
        v_status;
    END IF;
  END IF;

  IF NULLIF(btrim(COALESCE(p_photo_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Foto kondisi kendaraan wajib dilampirkan.';
  END IF;

  IF length(btrim(COALESCE(p_notes, ''))) < 5 THEN
    RAISE EXCEPTION 'Catatan kondisi kendaraan minimal 5 karakter.';
  END IF;

  -- Tahap 'after' hanya sah bila foto 'before' sudah ada. Ini yang menjaga
  -- bukti kondisi kendaraan sebelum pengerjaan tidak bisa dilewati.
  IF v_phase = 'after' AND NOT EXISTS (
    SELECT 1 FROM public.order_inspections i
     WHERE i.order_id = p_order_id
       AND i.phase = 'before'::public.inspection_phase
  ) THEN
    RAISE EXCEPTION 'Foto kondisi awal (before) wajib diunggah lebih dulu.';
  END IF;

  IF (SELECT count(*) FROM public.order_inspections i
       WHERE i.order_id = p_order_id
         AND i.phase = p_phase) >= 5 THEN
    RAISE EXCEPTION 'Maksimal 5 foto per tahap inspeksi.';
  END IF;

  INSERT INTO public.order_inspections (
    order_id, phase, photo_url, notes, inspector_id
  ) VALUES (
    p_order_id, p_phase, btrim(p_photo_path), btrim(p_notes), v_profile
  ) RETURNING * INTO v_row;

  RETURN v_row;
end;
$function$;

-- attendance_check_out dengan geofence lembut.
--
-- Versi lama menolak absen keluar bila jarak dari titik cabang melebihi
-- radius. Stam home service yang masuk dari luar karena check-in sudah
-- tidak menolak, tetapi tidak bisa menutup shift karena check-out masih
-- menolak. Jarak kini hanya dicatat.
create or replace function public.attendance_check_out(
  p_notes text default null
)
returns public.attendance_logs
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile     uuid;
  v_today       date := (now() at time zone 'Asia/Jakarta')::date;
  v_log         public.attendance_logs%rowtype;
  v_branch_id   uuid;
  v_branch_lat  double precision;
  v_branch_lng  double precision;
  v_radius      double precision;
  v_distance    double precision;
  v_di_luar     boolean := false;
  v_row         public.attendance_logs%rowtype;
begin
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Absen hanya bisa dicatat oleh pengguna yang sudah masuk.';
  END IF;

  v_profile := (SELECT public.current_profile_id());
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'Sesi tidak valid.';
  END IF;

  SELECT * INTO v_log
    FROM public.attendance_logs l
   WHERE l.profile_id = v_profile
     AND l.date = v_today;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Belum ada absen masuk hari ini.';
  END IF;

  IF v_log.clock_out IS NOT NULL THEN
    RAISE EXCEPTION 'Absen keluar hari ini sudah tercatat.';
  END IF;

  -- Titik acuan diambil dari cabang tempat staf ditempatkan. Kalau tidak ada,
  -- jarak tidak dihitung dan absen tetap diterima.
  SELECT p.branch_id, b.latitude, b.longitude, b.geofence_radius_meters
    INTO v_branch_id, v_branch_lat, v_branch_lng, v_radius
    FROM public.profiles p
    LEFT JOIN public.branches b ON b.id = p.branch_id
   WHERE p.id = v_profile;

  IF v_branch_lat IS NOT NULL AND v_log.gps_lat IS NOT NULL THEN
    v_distance := public.haversine_meters(
      v_branch_lat, v_branch_lng, v_log.gps_lat, v_log.gps_lng
    );
    v_radius := coalesce(v_radius, 30.0);
    v_di_luar := (v_distance > v_radius);
  END IF;

  UPDATE public.attendance_logs
     SET clock_out = now(),
         clock_out_photo_url = v_log.face_photo_url,
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         -- Jarak jauh tidak lagi memblokir. Nilainya tetap tersimpan supaya
         -- managerial bisa melihat dari mana absen itu diambil.
         outside_radius = v_di_luar,
         distance_from_branch_meters = round(coalesce(v_distance, 0))::int,
         geofence_radius_meters = round(coalesce(v_radius, 0))::int
   WHERE id = v_log.id
  RETURNING * INTO v_row;

  return v_row;
end;
$function$;

revoke all on function public.create_inspection_photo(
  uuid, public.inspection_phase, text, text
) from public;

grant execute on function public.create_inspection_photo(
  uuid, public.inspection_phase, text, text
) to authenticated;

revoke all on function public.attendance_check_out(text) from public;
grant execute on function public.attendance_check_out(text) to authenticated;
