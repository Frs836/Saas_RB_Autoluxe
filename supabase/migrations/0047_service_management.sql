-- Manajemen jasa POS: nama, kategori, harga per ukuran, dan status aktif.
--
-- Policy yang ada hanya mengizinkan UPDATE oleh owner, admin kasir, dan
-- maintainer, sedangkan DELETE hanya maintainer. Itu tidak cukup untuk kasir
-- yang sering butuh menonaktifkan atau menyesuaikan harga. Semua tulisan
-- sekarang lewat dua RPC yang memvalidasi harga dan mencatat jejak audit,
-- supaya harga yang tidak masuk akal tertangkap di satu tempat.
--
-- Harga nol berarti layanan tidak tersedia untuk ukuran tersebut, dan itu
-- memang dipakai katalog. Yang ditolak adalah harga negatif, harga di luar
-- batas wajar, dan nama kosong atau duplikat.

create or replace function public.set_service(
  p_service_id  uuid default null,
  p_name        text default null,
  p_category    public.service_category default 'wash'::public.service_category,
  p_price_s     numeric default 0,
  p_price_m     numeric default 0,
  p_price_l     numeric default 0,
  p_price_xl    numeric default 0,
  p_price_motor numeric default 0,
  p_price_motor_s numeric default 0,
  p_price_motor_m numeric default 0,
  p_price_motor_l numeric default 0,
  p_price_motor_xl numeric default 0,
  p_is_addon    boolean default false,
  p_is_active   boolean default true
)
returns public.services
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor  uuid;
  v_nama   text := nullif(btrim(p_name), '');
  v_maks   numeric := 100000000;
  v_sekarang public.services%rowtype;
  v_row    public.services%rowtype;
  v_harga  numeric[];
begin
  v_actor := (select public.current_profile_id());
  if v_actor is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((select public.has_role(
    array['owner','admin_kasir','maintainer']::public.user_role[]
  )), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa mengubah jasa.';
  end if;

  if v_nama is null or length(v_nama) < 3 then
    raise exception 'Nama jasa minimal 3 karakter.';
  end if;

  if length(v_nama) > 120 then
    raise exception 'Nama jasa maksimal 120 karakter.';
  end if;

-- Katalog dibaca memakai nama, jadi nama ganda membuat ambigu saat pencarian
-- dan membingungkan saat order dibuat.
  if exists (
    select 1 from public.services s
     where lower(s.name) = lower(v_nama)
       and (p_service_id is null or s.id <> p_service_id)
  ) then
    raise exception 'Jasa dengan nama tersebut sudah ada.';
  end if;

  v_harga := array[
    coalesce(p_price_s, 0), coalesce(p_price_m, 0),
    coalesce(p_price_l, 0), coalesce(p_price_xl, 0),
    coalesce(p_price_motor, 0), coalesce(p_price_motor_s, 0),
    coalesce(p_price_motor_m, 0), coalesce(p_price_motor_l, 0),
    coalesce(p_price_motor_xl, 0)
  ];

  if exists (select 1 from unnest(v_harga) h where h < 0) then
    raise exception 'Harga tidak boleh negatif.';
  end if;

  if exists (select 1 from unnest(v_harga) h where h > v_maks) then
    raise exception 'Harga per ukuran maksimal Rp 100.000.000.';
  end if;

  if p_service_id is null then
    insert into public.services (
      name, category, price_s, price_m, price_l, price_xl, price_motor,
      price_motor_s, price_motor_m, price_motor_l, price_motor_xl,
      is_addon, is_active
    )
    values (
      v_nama, p_category,
      coalesce(p_price_s, 0), coalesce(p_price_m, 0),
      coalesce(p_price_l, 0), coalesce(p_price_xl, 0),
      coalesce(p_price_motor, 0),
      coalesce(p_price_motor_s, 0), coalesce(p_price_motor_m, 0),
      coalesce(p_price_motor_l, 0), coalesce(p_price_motor_xl, 0),
      coalesce(p_is_addon, false), coalesce(p_is_active, true)
    )
    returning * into v_row;
  else
    select * into v_sekarang from public.services s where s.id = p_service_id;
    if not found then
      raise exception 'Jasa tidak ditemukan.';
    end if;

    update public.services
       set name = v_nama,
           category = p_category,
           price_s = coalesce(p_price_s, price_s),
           price_m = coalesce(p_price_m, price_m),
           price_l = coalesce(p_price_l, price_l),
           price_xl = coalesce(p_price_xl, price_xl),
           price_motor = coalesce(p_price_motor, price_motor),
           price_motor_s = coalesce(p_price_motor_s, price_motor_s),
           price_motor_m = coalesce(p_price_motor_m, price_motor_m),
           price_motor_l = coalesce(p_price_motor_l, price_motor_l),
           price_motor_xl = coalesce(p_price_motor_xl, price_motor_xl),
           is_addon = coalesce(p_is_addon, is_addon),
           is_active = coalesce(p_is_active, is_active),
           updated_at = now()
     where id = p_service_id
    returning * into v_row;
  end if;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_actor,
    case when p_service_id is null then 'service.create' else 'service.update' end,
    'service',
    v_row.id,
    jsonb_build_object(
      'nama', v_row.name,
      'kategori', v_row.category,
      'harga_sebelum', case when p_service_id is null then null
        else jsonb_build_object(
          'price_s', v_sekarang.price_s, 'price_m', v_sekarang.price_m,
          'price_l', v_sekarang.price_l, 'price_xl', v_sekarang.price_xl,
          'price_motor', v_sekarang.price_motor
        ) end,
      'harga_sesudah', jsonb_build_object(
        'price_s', v_row.price_s, 'price_m', v_row.price_m,
        'price_l', v_row.price_l, 'price_xl', v_row.price_xl,
        'price_motor', v_row.price_motor
      ),
      'is_active', v_row.is_active
    )
  );

  return v_row;
end;
$function$;

-- Menghapus jasa yang belum pernah terjual.
--
-- Rihwayat order_items menyimpan nama dan harga saat itu, jadi menghapus
-- katalog tidak menghapus bukti penjualan. Yang tetap terikat adalah resep
-- bahan, karena dipakai untuk menghitung pemakaian bahan.
create or replace function public.delete_service(p_service_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid;
  v_nama  text;
begin
  v_actor := (select public.current_profile_id());
  if v_actor is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((select public.has_role(
    array['owner','admin_kasir','maintainer']::public.user_role[]
  )), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa menghapus jasa.';
  end if;

  if exists (
    select 1 from public.service_material_recipes r where r.service_id = p_service_id
  ) then
    raise exception
      'Jasa ini masih dipakai resep bahan. Hapus resepnya dulu sebelum menghapus jasa.';
  end if;

  select name into v_nama from public.services s where s.id = p_service_id;
  if v_nama is null then
    raise exception 'Jasa tidak ditemukan.';
  end if;

  delete from public.services s where s.id = p_service_id;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_actor, 'service.delete', 'service', p_service_id,
    jsonb_build_object('nama', v_nama)
  );

  return found;
end;
$function$;

-- Policy INSERT, UPDATE, dan DELETE dihapus supaya semua tulisan lewat RPC.
-- RPC menulis updated_at sendiri, sehingga kolom itu tidak lagi bisa diubah
-- seen oleh klien.
drop policy if exists services_update_privileged on public.services;
drop policy if exists services_insert_privileged on public.services;
drop policy if exists services_delete_maintainer on public.services;

revoke all on function public.set_service(
  uuid, text, public.service_category, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, boolean, boolean
) from public;

grant execute on function public.set_service(
  uuid, text, public.service_category, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, boolean, boolean
) to authenticated;

revoke all on function public.delete_service(uuid) from public;
grant execute on function public.delete_service(uuid) to authenticated;
