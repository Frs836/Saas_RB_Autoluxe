-- ============================================================================
-- RB AUTOLUXE - Migrasi 0003: Onboarding Auth + Ikatan Cabang
-- Proyek: qidtfssldidzvehssevk  |  Tanggal: 2026-10-11
--
-- Isi:
--   1. Perluas handle_new_auth_user() agar profil baru otomatis terikat ke
--      cabang default (orders.branch_id kini NOT NULL, sehingga profil tanpa
--      branch akan menggagalkan create_pos_order).
--   2. Pasang trigger on_auth_user_created pada auth.users (sebelumnya fungsi
--      ada tetapi belum terpasang, sehingga profil tak pernah dibuat saat signup).
--
-- Catatan: signup publik (anon) TIDAK boleh memilih role; role default 'karyawan'.
-- Peran lain hanya via promote_profile_role (maintainer / service_role).
-- ============================================================================

set search_path = public;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (auth_id, full_name, role, branch_id)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'karyawan'::public.user_role,
    (select id from public.branches order by created_at asc limit 1)
  )
  on conflict (auth_id) do nothing;
  return new;
end;
$function$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and not tgisinternal
  ) then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row
      execute function public.handle_new_auth_user();
  end if;
end
$$;
