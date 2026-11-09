-- ============================================================
-- 0113_app_settings_cron.sql
-- Set app-level settings untuk pg_cron callback
-- Ganti nilai di bawah sesuai environment production
-- ============================================================

-- Set URL aplikasi produksi dan CRON_SECRET
-- Nilai ini dibaca oleh fungsi cron_attendance_check()
alter database postgres
  set app.app_url    = 'https://rb-autoluxe-git-main-frs836s-projects.vercel.app';

alter database postgres
  set app.cron_secret = '93678cf1dd0b898151035ac15321d03e5de70f6a60c37667b2e51d86e79d1b8e';

-- Reload config agar langsung aktif tanpa restart
select pg_reload_conf();
