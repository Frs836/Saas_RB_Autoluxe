-- ============================================================
-- 0112_setup_pgcron_attendance.sql
-- Setup pg_cron + pg_net untuk scheduled attendance notification
-- Memanggil /api/cron/attendance-check setiap menit via HTTP
-- ============================================================

-- Enable extensions (sudah tersedia di Supabase, tidak perlu CREATE EXTENSION)
-- pg_cron dan pg_net sudah pre-installed di Supabase

-- Buat fungsi helper yang dipanggil pg_cron
create or replace function public.cron_attendance_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  app_url  text;
  secret   text;
begin
  -- Ambil konfigurasi dari app_settings (atau hardcode URL produksi)
  app_url := coalesce(
    current_setting('app.app_url', true),
    'https://rb-autoluxe.vercel.app'
  );
  secret := coalesce(
    current_setting('app.cron_secret', true),
    ''
  );

  perform net.http_post(
    url     := app_url || '/api/cron/attendance-check',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    body    := '{}'::jsonb
  );
end;
$$;

-- Hapus jadwal lama jika ada
select cron.unschedule('attendance-check')
where exists (
  select 1 from cron.job where jobname = 'attendance-check'
);

-- Jadwalkan setiap menit (* * * * *)
select cron.schedule(
  'attendance-check',
  '* * * * *',
  $cron$select public.cron_attendance_check()$cron$
);

comment on function public.cron_attendance_check() is
  'Dipanggil pg_cron setiap menit. Memanggil Next.js API untuk cek absensi dan push notifikasi terjadwal.';
