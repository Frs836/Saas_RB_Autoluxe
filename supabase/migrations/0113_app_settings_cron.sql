-- ============================================================
-- 0113_app_settings_cron.sql
-- Simpan konfigurasi cron di tabel app_config (ganti ALTER DATABASE
-- yang butuh superuser dan tidak bisa dijalankan di Supabase)
-- ============================================================

-- Tabel konfigurasi key-value sederhana
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- Hanya service_role yang bisa baca/tulis
alter table public.app_config enable row level security;

create policy "service_role only"
  on public.app_config
  for all
  to service_role
  using (true)
  with check (true);

-- Insert konfigurasi cron
insert into public.app_config (key, value) values
  ('app_url',     'https://rb-autoluxe-git-main-frs836s-projects.vercel.app'),
  ('cron_secret', '93678cf1dd0b898151035ac15321d03e5de70f6a60c37667b2e51d86e79d1b8e')
on conflict (key) do update set value = excluded.value;
