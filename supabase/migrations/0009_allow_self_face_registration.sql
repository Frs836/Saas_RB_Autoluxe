-- 0009: izinkan pengguna mendaftarkan sampel Face ID untuk profilnya sendiri.
-- Sebelumnya guard_profile_privileges memblokir semua perubahan face_descriptor
-- oleh non-maintainer, sehingga registrasi Face ID mandiri selalu gagal.
-- Kolom role, auth_id, is_active, dan default_off_day TETAP hanya untuk maintainer.

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_is_privileged boolean;
begin
  if coalesce(public.current_jwt_role(), '') in ('service_role', 'postgres') then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.auth_id = (select auth.uid())
       and p.is_active
       and p.role = 'maintainer'::public.user_role
  ) into v_is_privileged;

  if v_is_privileged then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role <> 'karyawan'::public.user_role then
      raise exception
        'Pendaftaran mandiri hanya dapat membuat akun dengan role karyawan. Hubungi Maintainer untuk role lain.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role
     or new.auth_id is distinct from old.auth_id
     or new.is_active is distinct from old.is_active
     or new.default_off_day is distinct from old.default_off_day
     or (
       new.face_descriptor is distinct from old.face_descriptor
       and new.id is distinct from public.current_profile_id()
     ) then
    raise exception
      'Kolom role, auth_id, is_active, dan default_off_day hanya dapat diubah oleh maintainer. Sampel Face ID hanya dapat didaftarkan untuk profil sendiri.';
  end if;

  return new;
end;
$function$;
