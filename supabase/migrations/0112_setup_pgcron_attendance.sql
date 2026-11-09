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
  -- Ambil konfigurasi dari tabel app_config (di-seed oleh migration 0113)
  select value into app_url  from public.app_config where key = 'app_url';
  select value into secret   from public.app_config where key = 'cron_secret';

  -- Fallback jika tabel belum ada nilainya
  app_url := coalesce(app_url, 'https://rb-autoluxe-git-main-frs836s-projects.vercel.app');
  secret  := coalesce(secret, '');

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
