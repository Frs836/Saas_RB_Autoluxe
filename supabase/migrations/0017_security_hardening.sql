-- 0017: pengetatan keamanan cabang dan penambalan jalur tulis langsung.
--
-- Audit menemukan beberapa celah yang tidak tertangkap pengujian integrasi,
-- karena suite hanya menguji RPC dan tidak pernah menulis langsung ke tabel.
--
--   1. orders_update_authenticated memakai USING (can_view_order(id)), dan
--      can_view_order true untuk pembuat order. Karyawan bisa PATCH langsung
--      status, payment_state, dan completed_at, sehingga melewati gerbang QC
--      dan tidak menghasilkan baris cash_flow maupun activity_logs.
--      Semua penulisan di aplikasi ini memang lewat RPC, jadi policy UPDATE
--      dihapus seluruhnya.
--   2. create_stock_claim tidak mengecek cabang pemohon terhadap
--      inventory_items.branch_id, dan policy stok memakai USING (true),
--      sehingga karyawan bisa mengambil barang milik cabang lain.
--   3. expected_cash_for_date memakai
--      (p_branch_id IS NULL OR c.branch_id IS NULL OR c.branch_id = p_branch_id).
--      Klausa c.branch_id IS NULL menarik semua kas tanpa cabang ke setiap
--      cabang, sehingga ekspektasi kas pada audit shift tercampur.
--   4. close_shift_handoff hanya memeriksa role, tidak mengikat catatan pada
--      cabang pemanggil, sehingga admin kasir bisa menutup audit cabang lain.
--   5. update_branch_settings memakai CASE WHEN p_set_coordinates THEN ...
--      ELSE v_branch.latitude END, sehingga mematikan geofence tidak menghapus
--      koordinat lama dan check-in tetap ditolak.

-- ---------------------------------------------------------------------------
-- 1. Helper cakupan cabang
-- ---------------------------------------------------------------------------

-- true bila pemanggil boleh menyentuh baris pada cabang tertentu.
-- Owner dan Maintainer global, role lain terikat pada cabangnya.
create or replace function public.can_access_branch(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select p_branch_id is not null
     and (
       public.has_role(array['owner', 'maintainer']::public.user_role[])
       or exists (
         select 1
           from public.profiles p
          where p.id = public.current_profile_id()
            and p.branch_id = p_branch_id
       )
     );
$function$;

revoke all on function public.can_access_branch(uuid) from public, anon;
grant execute on function public.can_access_branch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. orders: hapus jalur UPDATE langsung dari client
-- ---------------------------------------------------------------------------

-- Seluruh perubahan status order wajib lewat apply_order_status, yang memvalidasi
-- transisi dan menulis jejak audit. karyawan, admin kasir, owner, maupun
-- maintainer tidak boleh mengubah baris order secara langsung.
drop policy if exists orders_update_authenticated on public.orders;

-- Guard trigger tetap dipertahankan sebagai lapis kedua. Daftar bebas hanya
-- berlaku bila pemanggil benar-benar berwenang.
create or replace function public.guard_order_identity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role public.user_role := (select public.current_user_role());
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.order_number, '')), '') is null then
      new.order_number := public.next_order_number();
    end if;

    if nullif(btrim(coalesce(new.tracking_token, '')), '') is null then
      new.tracking_token := public.new_tracking_token();
    end if;

    if (select auth.uid()) is not null then
      new.created_by := (select public.current_profile_id());
      new.branch_id := coalesce(
        new.branch_id,
        (select p.branch_id from public.profiles p where p.id = new.created_by)
      );
    end if;

    return new;
  end if;

  if (select auth.uid()) is null then
    return new;
  end if;

  if new.created_by is distinct from old.created_by
     or new.order_number is distinct from old.order_number
     or new.tracking_token is distinct from old.tracking_token
     or new.branch_id is distinct from old.branch_id then
    raise exception
      'Kolom created_by, order_number, tracking_token, dan branch_id pada order tidak dapat diubah.';
  end if;

  -- Hanya maintainer boleh menyentuh kolom di luar allow-list ini. Semua role
  -- lain wajib lewat RPC, sehingga status tidak bisa dilompati dari klien.
  if v_role is distinct from 'maintainer'::public.user_role then
    if new.status is distinct from old.status then
      raise exception
        'Status order hanya dapat diubah melalui alur kerja yang telah tervalidasi, bukan langsung dari klien.';
    end if;

    if new.payment_state is distinct from old.payment_state then
      raise exception
        'Status pembayaran order hanya dapat diubah melalui alur kerja yang telah tervalidasi.';
    end if;

    if (to_jsonb(new) - array['updated_at', 'started_by', 'started_at']) is distinct from
       (to_jsonb(old) - array['updated_at', 'started_by', 'started_at']) then
      raise exception
        'Kolom order di luar daftar itu hanya dapat diubah oleh maintainer.';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Penanda tulis tepercaya
-- ---------------------------------------------------------------------------
--
-- Row-level security sudah menutup jalur tulis langsung dari klien karena policy
-- UPDATE pada tabel orders dihapus. Namun trigger tidak bisa membedakan update
-- dari klien dengan update dari RPC SECURITY DEFINER, karena keduanya berjalan
-- sebagai role pemanggil yang sama.
--
-- Setiap RPC yang sah mengubah status atau payment_state menyalakan flag ini
-- lebih dulu, dan trigger menghormatinya. Klien tidak bisa menyalakan flag,
-- karena set_config untuk sesi miliknya sendiri hanya bisa dipanggil dari
-- kode server, bukan dari PostgREST langsung.

create or replace function public.start_order_work(p_order_id uuid)
returns public.order_status
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile_id uuid;
  v_is_staff  boolean;
  v_order     public.orders%rowtype;
  v_next      public.order_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Order hanya bisa diubah oleh pengguna yang sudah masuk.';
  end if;

  v_profile_id := (select public.current_profile_id());
  if v_profile_id is null then
    raise exception 'Sesi tidak valid.';
  end if;

  v_is_staff := coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order tidak ditemukan.';
  end if;

  if not v_is_staff then
    if v_order.created_by is distinct from v_profile_id
       and not exists (
         select 1 from public.order_team_members t
          where t.order_id = v_order.id and t.profile_id = v_profile_id
       ) then
      raise exception 'Anda hanya bisa memulai order yang Anda buat atau menjadi anggota timnya.';
    end if;
  end if;

  if v_order.status <> 'queued'::public.order_status then
    raise exception 'Order hanya bisa dimulai dari status Dalam Antrean.';
  end if;

  perform set_config('app.trusted_order_write', 'on', true);

  update public.orders
     set status     = 'in_progress'::public.order_status,
         started_by = v_profile_id,
         started_at = now()
   where id = v_order.id
  returning status into v_next;

  perform set_config('app.trusted_order_write', 'off', true);

  return v_next;
end;
$function$;

create or replace function public.apply_order_status(
  p_order_id uuid,
  p_status public.order_status
)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order       public.orders%rowtype;
  v_started     date := (now() at time zone 'Asia/Jakarta')::date;
  v_warranty    text;
  v_officer     boolean;
  v_reviewer    uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Status order hanya bisa diubah oleh pengguna yang sudah masuk.';
  end if;

  v_officer := coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false);

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'Order tidak ditemukan.';
  end if;

  -- Role non-manajerial boleh menjalankan transisi miliknya sendiri dari
  -- queued ke in_progress lalu ke qc_review. Namun keluar dari qc_review
  -- adalah keputusan mutu dan hanya boleh diambil tim manajerial.
  if p_status <> v_order.status
     and v_order.status in ('qc_review', 'completed')
     and not v_officer then
    raise exception
      'Persetujuan dan penolakan QC hanya bisa dilakukan oleh owner, admin kasir, atau maintainer.';
  end if;

  if p_status <> v_order.status then
    if not (
      (v_order.status = 'queued'      and p_status = 'in_progress') or
      (v_order.status = 'in_progress' and p_status = 'qc_review')   or
      (v_order.status = 'qc_review'   and p_status = 'in_progress') or
      (v_order.status = 'qc_review'   and p_status = 'completed')
    ) then
      raise exception 'Status tidak bisa berubah dari % ke %.',
        v_order.status, p_status;
    end if;
  end if;

  perform set_config('app.trusted_order_write', 'on', true);

  update public.orders
     set status = p_status,
         completed_at = case
           when p_status = 'completed' then now()
           when v_order.status = 'completed' then null
           else v_order.completed_at
         end
   where id = p_order_id;

  perform set_config('app.trusted_order_write', 'off', true);

  -- Jejak audit untuk setiap perpindahan status, terutama keputusan QC.
  if p_status <> v_order.status then
    insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
    values (
      public.current_profile_id(),
      'order.status.' || p_status::text,
      'order',
      p_order_id,
      jsonb_build_object('from', v_order.status, 'to', p_status)
    );
  end if;

  if p_status <> 'completed' then
    return null;
  end if;

  if not (
    strpos(lower(v_order.service_package), 'coating') > 0
    or strpos(lower(v_order.service_package), 'ceramic') > 0
    or strpos(lower(v_order.service_package), 'liquid glass') > 0
    or strpos(lower(v_order.service_package), 'nano') > 0
  ) then
    return null;
  end if;

  insert into public.warranties (order_id, warranty_code, start_date, end_date)
  values (
    p_order_id,
    'WRT-' || v_order.order_number,
    v_started,
    v_started + 180
  )
  on conflict (order_id) do nothing
  returning warranty_code into v_warranty;

  if v_warranty is null then
    select w.warranty_code into v_warranty
      from public.warranties w
     where w.order_id = p_order_id;
  end if;

  select o.assigned_to into v_reviewer from public.orders o where o.id = p_order_id;
  if v_reviewer is not null then
    insert into public.notifications (recipient_id, title, body, category, payload)
    values (
      v_reviewer,
      'QC selesai untuk ' || v_order.order_number,
      'Unit ' || v_order.license_plate || ' telah disetujui QC. Sertifikat garansi: ' || coalesce(v_warranty, 'tidak berlaku untuk layanan ini') || '.',
      'order',
      jsonb_build_object('order_id', p_order_id, 'warranty_code', v_warranty)
    );
  end if;

  return v_warranty;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. cash_flow dan order_items: ikat admin kasir ke cabangnya sendiri
-- ---------------------------------------------------------------------------

-- Sebelumnya admin kasir bisa mengubah atau menambahkan baris kas pada cabang
-- mana pun selama policy hanya memeriksa role.
drop policy if exists cash_flow_insert_privileged on public.cash_flow;
drop policy if exists cash_flow_update_privileged on public.cash_flow;

create policy cash_flow_insert_privileged on public.cash_flow
  for insert to authenticated
  with check (public.can_access_branch(branch_id));

create policy cash_flow_update_privileged on public.cash_flow
  for update to authenticated
  using (public.can_access_branch(branch_id))
  with check (public.can_access_branch(branch_id));

-- order_items mengikuti order induknya.
drop policy if exists order_items_update_privileged on public.order_items;

create policy order_items_update_privileged on public.order_items
  for update to authenticated
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_id
         and public.can_access_branch(o.branch_id)
    )
  )
  with check (
    exists (
      select 1 from public.orders o
       where o.id = order_id
         and public.can_access_branch(o.branch_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Isolasi stok per cabang
-- ---------------------------------------------------------------------------

drop policy if exists inventory_items_select_authenticated on public.inventory_items;
drop policy if exists stock_claims_select_authenticated on public.stock_claims;
drop policy if exists stock_claims_insert_own on public.stock_claims;

-- karyawan hanya melihat stok cabangnya sendiri.
create policy inventory_items_select_authenticated on public.inventory_items
  for select to authenticated
  using (public.can_access_branch(branch_id));

create policy stock_claims_select_authenticated on public.stock_claims
  for select to authenticated
  using (public.can_access_branch(branch_id));

-- WITH CHECK menutup jalur insert langsung ke tabel, bukan hanya lewat RPC.
create policy stock_claims_insert_own on public.stock_claims
  for insert to authenticated
  with check (
    claimed_by = public.current_profile_id()
    and public.can_access_branch(branch_id)
  );

-- ---------------------------------------------------------------------------
-- 5. create_stock_claim: tolak klaim lintas cabang
-- ---------------------------------------------------------------------------

create or replace function public.create_stock_claim(
  p_item_id uuid,
  p_quantity numeric,
  p_note text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile_id uuid := (select public.current_profile_id());
  v_item       public.inventory_items%rowtype;
  v_claim_id   uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Klaim stok hanya bisa dilakukan oleh pengguna yang sudah masuk.';
  end if;

  if v_profile_id is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah klaim harus lebih dari nol.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'Item stok tidak ditemukan.';
  end if;

  -- Klaim hanya boleh untuk stok cabang sendiri. Row-level security sudah
  -- dicek, tetapi fungsi ini SECURITY DEFINER sehingga harus memeriksa ulang.
  if not public.can_access_branch(v_item.branch_id) then
    raise exception 'Item stok ini milik cabang lain.';
  end if;

  insert into public.stock_claims (branch_id, item_id, quantity, unit, note, claimed_by)
  values (v_item.branch_id, v_item.id, p_quantity, v_item.unit,
          nullif(btrim(coalesce(p_note, '')), ''), v_profile_id)
  returning id into v_claim_id;

  return v_claim_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. expected_cash_for_date: tanpa baris lintas cabang
-- ---------------------------------------------------------------------------

-- c.branch_id IS NULL dihapus dari kondisi. Baris kas tanpa cabang tidak lagi
-- ikut dihitung untuk cabang tertentu, karena ekspektasi kas harus bisa
-- diaudit per lokasi.
create or replace function public.expected_cash_for_date(
  p_date date,
  p_opening_cash numeric,
  p_branch_id uuid default null::uuid
)
returns table(cash_in numeric, cash_out numeric, unknown_method numeric)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_day_start timestamptz := (p_date::timestamp at time zone 'Asia/Jakarta');
  v_day_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Asia/Jakarta');
begin
  return query
  select
    coalesce(sum(c.amount) filter (
      where c.type = 'in'::public.cash_flow_type
        and c.payment_method = 'cash'::public.payment_method
    ), 0),
    coalesce(sum(c.amount) filter (
      where c.type = 'out'::public.cash_flow_type
    ), 0),
    coalesce(sum(c.amount) filter (
      where c.type = 'in'::public.cash_flow_type
        and c.payment_method is null
    ), 0)
  from public.cash_flow c
  where c.created_at >= v_day_start
    and c.created_at <  v_day_end
    and (p_branch_id is null or c.branch_id = p_branch_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. close_shift_handoff: wajib cabang yang sama
-- ---------------------------------------------------------------------------

create or replace function public.close_shift_handoff(
  p_handoff_id uuid,
  p_actual_cash numeric,
  p_notes text
)
returns numeric
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile  uuid;
  v_row      public.shift_handoffs%rowtype;
  v_expected numeric;
  v_unknown  numeric;
  v_diff     numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Serah terima kas hanya bisa ditutup oleh pengguna yang sudah masuk.';
  end if;

  if not (select public.has_role(
    array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
  )) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan serah terima kas.';
  end if;

  v_profile := (select public.current_profile_id());
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception 'Jumlah uang fisik tidak boleh kosong atau negatif.';
  end if;

  select * into v_row
    from public.shift_handoffs
   where id = p_handoff_id
     for update;

  if not found then
    raise exception 'Catatan serah terima kas tidak ditemukan.';
  end if;

  if v_row.status = 'closed'::public.shift_handoff_status then
    raise exception 'Serah terima kas ini sudah ditutup pada %.',
      to_char(v_row.closed_at at time zone 'Asia/Jakarta', 'DD/MM/YYYY HH24:MI');
  end if;

  -- Admin kasir hanya boleh menutup catatan cabangnya sendiri. Owner dan
  -- maintainer boleh lintas cabang.
  if not public.can_access_branch(v_row.branch_id) then
    raise exception 'Catatan serah terima kas ini milik cabang lain.';
  end if;

  select v_row.opening_cash + coalesce(f.cash_in, 0) - coalesce(f.cash_out, 0),
         coalesce(f.unknown_method, 0)
    into v_expected, v_unknown
  from public.expected_cash_for_date(v_row.shift_date, v_row.opening_cash, v_row.branch_id) f;

  v_diff := p_actual_cash - v_expected;

  update public.shift_handoffs
     set actual_cash         = p_actual_cash,
         expected_cash       = v_expected,
         unknown_method_cash = v_unknown,
         difference          = v_diff,
         status              = 'closed'::public.shift_handoff_status,
         closed_by           = v_profile,
         closed_at           = now(),
         notes                = v_row.notes,
         updated_at          = now()
   where id = p_handoff_id;

  -- Ditulis terpisah agar nilai lama tetap dipakai bila p_notes kosong.
  if nullif(btrim(coalesce(p_notes, '')), '') is not null then
    update public.shift_handoffs
       set notes = btrim(p_notes)
     where id = p_handoff_id;
  end if;

  return v_diff;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. update_branch_settings: mematikan geofence harus menetralkan koordinat
-- ---------------------------------------------------------------------------

-- Disebut/dipertahankan agar perubahan ini idempoten terhadap 0016.
create or replace function public.update_branch_settings(
  p_branch_id          uuid,
  p_branch_name        text,
  p_address            text,
  p_latitude           numeric default null,
  p_longitude          numeric default null,
  p_radius_meters      numeric default null,
  p_open_time          time    default null,
  p_close_time         time    default null,
  p_set_coordinates    boolean  default false,
  p_is_active          boolean  default null
)
returns public.branches
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile   uuid;
  v_branch    public.branches%rowtype;
  v_name      text;
  v_staff     integer;
  v_latitude  numeric;
  v_longitude numeric;
  v_row       public.branches%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Konfigurasi cabang hanya bisa diubah pengguna yang sudah masuk.';
  end if;

  v_profile := (select public.current_profile_id());
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((
    select public.has_role(array['owner', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner dan maintainer yang bisa mengubah konfigurasi cabang.';
  end if;

  select * into v_branch from public.branches where id = p_branch_id;
  if not found then
    raise exception 'Cabang tidak ditemukan.';
  end if;

  v_name := nullif(btrim(coalesce(p_branch_name, '')), '');
  if v_name is null then
    raise exception 'Nama cabang wajib diisi.';
  end if;

  if exists (
    select 1 from public.branches b
     where lower(b.branch_name) = lower(v_name)
       and b.id <> p_branch_id
  ) then
    raise exception 'Sudah ada cabang bernama "%".', v_name;
  end if;

  if p_open_time is not null and p_close_time is not null then
    if p_close_time <= p_open_time then
      raise exception 'Jam tutup harus lebih besar dari jam buka.';
    end if;
  end if;

  -- Geofence mati berarti koordinat benar-benar dikosongkan. Bila koordinat
  -- lama dipertahankan, check-in tetap membandingkan jarak terhadap titik itu
  -- dan penolakan lokasi tetap terjadi walau operator sudah menonaktifkannya.
  if coalesce(p_set_coordinates, false) then
    if p_latitude is null or p_longitude is null then
      raise exception 'Latitude dan longitude wajib diisi saat geofence diaktifkan.';
    end if;

    if p_latitude < -90 or p_latitude > 90 then
      raise exception 'Latitude harus antara -90 sampai 90.';
    end if;

    if p_longitude < -180 or p_longitude > 180 then
      raise exception 'Longitude harus antara -180 sampai 180.';
    end if;

    if p_latitude = 0 and p_longitude = 0 then
      raise exception 'Koordinat 0,0 bukan lokasi workshop.';
    end if;

    v_latitude := p_latitude;
    v_longitude := p_longitude;
  else
    v_latitude := null;
    v_longitude := null;
  end if;

  if v_latitude is not null then
    if p_radius_meters is null or p_radius_meters < 5 or p_radius_meters > 5000 then
      raise exception 'Radius geofence harus antara 5 sampai 5000 meter.';
    end if;
  end if;

  if coalesce(p_is_active, v_branch.is_active) = false then
    select count(*) into v_staff
      from public.profiles
     where branch_id = p_branch_id
       and is_active;

    if v_staff > 0 then
      raise exception 'Cabang masih memiliki % staf aktif dan belum bisa dinonaktifkan.', v_staff;
    end if;
  end if;

  update public.branches
     set branch_name            = v_name,
         -- branches.address bertipe NOT NULL, jadi kosong disimpan sebagai string
         -- kosong, bukan null.
         address                = coalesce(nullif(btrim(coalesce(p_address, '')), ''), ''),
         latitude               = v_latitude,
         longitude              = v_longitude,
         geofence_radius_meters = case
                                   when v_latitude is null then 30
                                   else round(p_radius_meters, 2)
                                 end,
         operating_open_time    = coalesce(p_open_time, v_branch.operating_open_time),
         operating_close_time   = coalesce(p_close_time, v_branch.operating_close_time),
         is_active              = coalesce(p_is_active, v_branch.is_active),
         updated_at             = now()
   where id = p_branch_id
  returning * into v_row;

  return v_row;
end;
$function$;