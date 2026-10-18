-- Perbaikan dua pada update_staff_profile.
--
-- 1. v_profile_id tidak pernah dideklarasikan sebagai variabel. Kolom
--    entity_id pada activity_logs diisi dengan v_profile_id, yang tidak ada di
--    blok declare; parameternya bernama p_profile_id. Postgres membaca
--    v_profile_id sebagai nama kolom dan menolak dengan
--    'column "v_profile_id" does not exist'. Audit jejaknya jadi kosong.
--
-- 2. guard_profile_privileges hanya mengizinkan peran maintainer mengubah
--    role, auth_id, is_active, default_off_day, dan branch_id. Owner Tertaut
--    secara sah lewat update_staff_profile, tetapi trigger menolak lebih dulu,
--    sehingga hari libur, jabatan, cabang, dan status aktif mustahil diubah
--    oleh owner. Maintainer boleh lewat trigger tapi tidak boleh mengubah
--    jabatan, jadi aksesnya tidak bisa dipisah hanya lewat trigger; pembagian
--    itu tetap ditegakkan di update_staff_profile.

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
set search_path to ''
as $function$
declare
  v_actor       uuid;
  v_actor_role  public.user_role;
  v_target      public.profiles%rowtype;
  v_active_owners integer;
  v_row         public.profiles%rowtype;
begin
  v_actor := (select public.current_profile_id());
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

  if not public.can_access_branch(v_target.branch_id) then
    raise exception 'Staf ini berada di luar cabang yang bisa Anda kelola.';
  end if;

  if p_profile_id = v_actor and coalesce(p_is_active, v_target.is_active) = false then
    raise exception 'Anda tidak bisa menonaktifkan akun Anda sendiri.';
  end if;

  -- Jabatan hanya boleh diubah oleh owner. Maintainer boleh mengelola cabang,
  -- tapi tidak boleh mengubah siapa yang memegang wewenang.
  if p_role is not null
     and p_role <> v_target.role
     and v_actor_role <> 'owner'::public.user_role then
    raise exception 'Hanya owner yang bisa mengubah jabatan staf.';
  end if;

  if p_branch_id is not null and p_branch_id <> v_target.branch_id then
    if not public.can_access_branch(p_branch_id) then
      raise exception 'Cabang tujuan tidak dapat diakses.';
    end if;
  end if;

  if p_default_off_day is not null
     and (p_default_off_day < 0 or p_default_off_day > 6) then
    raise exception 'Hari libur harus angka 0 (Minggu) sampai 6 (Sabtu).';
  end if;

  -- Owner terakhir tidak boleh kehilangan akses.
  if v_target.role = 'owner'::public.user_role
     and coalesce(p_is_active, v_target.is_active) = false then
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

  -- entity_id memakai p_profile_id. Versi sebelumnya menulis v_profile_id,
  -- nama yang tidak pernah dideklarasikan, sehingga insert ini selalu gagal
  -- dan seluruh transaksi rollback.
  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_actor,
    'staff.update',
    'profile',
    p_profile_id,
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

-- Trigger sebelumnya menutup owner dari lima kolom tersebut. Owner sekarang
-- ikut diizinkan; update_staff_profile yang membatasi jabatan tetap berlaku.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_is_privileged boolean;
  v_is_own         boolean;
  v_face_touched    boolean;
begin
  if coalesce(public.current_jwt_role(), '') in ('service_role', 'postgres') then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p
     where p.auth_id = (select auth.uid())
       and p.is_active
       and p.role in ('owner'::public.user_role, 'maintainer'::public.user_role)
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

  v_is_own := new.id = public.current_profile_id();

  v_face_touched :=
       new.face_verification is distinct from old.face_verification
    or new.face_reviewed_by  is distinct from old.face_reviewed_by
    or new.face_reviewed_at  is distinct from old.face_reviewed_at
    or new.face_review_note  is distinct from old.face_review_note;

  -- Pemilik profil boleh mendaftarkan ulang sampel wajahnya sendiri, dan itu
  -- harus mengembalikan status ke pending serta mengosongkan kolom peninjau.
  -- Bentuk lain dari perubahan kolom verifikasi tetap ditolak, sehingga staf
  -- tidak dapat menyetujui wajahnya sendiri.
  if v_face_touched and not v_is_own then
    raise exception
      'Kolom verifikasi wajah hanya dapat diubah oleh pemilik profil atau peninjau berwenang.';
  end if;

  if new.role is distinct from old.role
     or new.auth_id is distinct from old.auth_id
     or new.is_active is distinct from old.is_active
     or new.default_off_day is distinct from old.default_off_day
     or new.branch_id is distinct from old.branch_id then
    raise exception
      'Kolom role, auth_id, is_active, default_off_day, dan branch_id hanya dapat diubah oleh owner atau maintainer. Sampel Face ID hanya dapat didaftarkan untuk profil sendiri.';
  end if;

  return new;
end;
$function$;

revoke all on function public.update_staff_profile(
  uuid, boolean, public.user_role, public.work_schedule, uuid, smallint
) from public;

grant execute on function public.update_staff_profile(
  uuid, boolean, public.user_role, public.work_schedule, uuid, smallint
) to authenticated;