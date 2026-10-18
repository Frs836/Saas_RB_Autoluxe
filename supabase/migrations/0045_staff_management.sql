-- Manajemen staf: aktif/nonaktif, jabatan, jadwal kerja, dan pindah cabang.
--
-- Modul jadwal kerja sebelumnya hanya bisa mengubah jam kerja, sedangkan satu-
-- satunya jalan untuk menata staf lain sudah dihapus. Akibatnya akun yang
-- sudah tidak dipakai ikut tetap punya akses. Semua perubahan status, jabatan,
-- jadwal, dan cabang kini lewat satu RPC dengan pengaman di bawah.
--
--   1. Hanya owner dan maintainer yang boleh mengubah staf.
--   2. Seseorang tidak boleh menonaktifkan dirinya sendiri.
--   3. Owner terakhir tidak boleh dinonaktifkan, karena tidak ada lagi yang
--      bisa mengelola sistem.
--   4. Cabang tujuan harus bisa diakses pelaku, jadi staf tidak bisa
--      dipindahkan ke cabang yang tidak terlihat olehnya.
--   5. Jabatan hanya bisa diubah oleh owner; maintainer boleh mengelola
--      cabang, tapi tidak boleh mengubah siapa yang memegang wewenang.

create or replace function public.update_staff_profile(
  p_profile_id      uuid,
  p_is_active       boolean default null,
  p_role            public.user_role default null,
  p_work_schedule   public.work_schedule default null,
  p_branch_id       uuid default null,
  p_default_off_day smallint default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor    uuid := (select public.current_profile_id());
  v_actor_role public.user_role;
  v_target   public.profiles%rowtype;
  v_active_owners integer;
  v_row      public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Sesi tidak valid.';
  end if;

  v_actor_role := (select p.role from public.profiles p where p.id = v_actor);
  if v_actor_role not in ('owner'::public.user_role, 'maintainer'::public.user_role) then
    raise exception 'Hanya owner dan maintainer yang bisa mengubah data staf.';
  end if;

  select * into v_target from public.profiles p where p.id = p_profile_id for update;
  if not found then
    raise exception 'Staf tidak ditemukan.';
  end if;

  -- Menjaga agar tidak ada akun yang masih punya akses tapi tidak bisa managing.
  if not public.can_access_branch(v_target.branch_id) then
    raise exception 'Staf ini berada di luar cabang yang bisa Anda kelola.';
  end if;

  if p_profile_id = v_actor and coalesce(p_is_active, v_target.is_active) = false then
    raise exception 'Anda tidak bisa menonaktifkan akun Anda sendiri.';
  end if;

  -- Jabatan hanya boleh diubah oleh owner. Maintainer boleh mengelola cabang,
  -- tapi tidak boleh mengubah siapa yang memegang wewenang.
  if p_role is not null and p_role <> v_target.role and v_actor_role <> 'owner'::public.user_role then
    raise exception 'Hanya owner yang bisa mengubah jabatan staf.';
  end if;

  if p_branch_id is not null and p_branch_id <> v_target.branch_id then
    if not public.can_access_branch(p_branch_id) then
      raise exception 'Cabang tujuan tidak dapat diakses.';
    end if;
  end if;

  if p_default_off_day is not null and (p_default_off_day < 0 or p_default_off_day > 6) then
    raise exception 'Hari libur harus angka 0 (Minggu) sampai 6 (Sabtu).';
  end if;

  -- Owner terakhir tidak boleh kehilangan akses. Bila cuma satu owner aktif dan
  -- satu-satunya owner itu yang akan dinonaktifkan, tolak.
  if v_target.role = 'owner'::public.user_role and coalesce(p_is_active, v_target.is_active) = false then
    select count(*) into v_active_owners
      from public.profiles p
     where p.role = 'owner'::public.user_role
       and coalesce(p.is_active, true) = true;

    if v_active_owners <= 1 then
      raise exception 'Tidak bisa menonaktifkan owner terakhir. Angkat owner baru terlebih dahulu.';
    end if;
  end if;

  update public.profiles
     set is_active = coalesce(p_is_active, is_active),
         role = coalesce(p_role, role),
         work_schedule = coalesce(p_work_schedule, work_schedule),
         branch_id = coalesce(p_branch_id, branch_id),
         default_off_day = coalesce(p_default_off_day, default_off_day),
         updated_at = now()
   where id = p_profile_id
  returning * into v_row;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_actor,
    'staff.update',
    'profile',
    v_profile_id,
    jsonb_build_object(
      'is_active', v_row.is_active,
      'role', v_row.role,
      'work_schedule', v_row.work_schedule,
      'branch_id', v_row.branch_id,
      'default_off_day', v_row.default_off_day
    )
  );

  return v_row;
end;
$function$;

revoke all on function public.update_staff_profile(
  uuid, boolean, public.user_role, public.work_schedule, uuid, smallint
) from public;

grant execute on function public.update_staff_profile(
  uuid, boolean, public.user_role, public.work_schedule, uuid, smallint
) to authenticated;