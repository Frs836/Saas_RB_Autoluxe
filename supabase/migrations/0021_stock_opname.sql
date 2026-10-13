-- 0021: opname stok fisik bulanan.
--
-- PRD 5.2 meminta pencatatan opname fisik untuk mendeteksi selisih antara
-- stok sistem dan stok fisik di gudang. Modul ini membandingkan hasil hitung
-- fisik dengan saldo sistem, lalu menyimpan selisihnya sebagai keputusan
-- tersendiri.
--
-- Alur sengaja dua tahap. Satu tahap akan langsung mengubah saldo sistem dari
-- angka yang diketik manusia, dan salah hitung satu angka akan menghapus
-- riwayat movements tanpa jejak. Karena itu baris opname disimpan sebagai
-- draf, dan saldo sistem hanya ikut berubah ketika opname dikirim lewat
-- submit_stock_opname, yang menulis setiap penyesuaian ke stock_logs.
--
-- Semua pernyataan idempoten.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'stock_opname_status') then
    create type public.stock_opname_status as enum ('draft', 'submitted', 'cancelled');
  end if;
end
$$;

create table if not exists public.stock_opnames (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  period_month date not null,
  status public.stock_opname_status not null default 'draft',
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_opnames_period_normalized
    check (date_trunc('month', period_month)::date = period_month)
);

comment on table public.stock_opnames is
  'Opname fisik bulanan per cabang, satu baris per bulan pada satu cabang.';

create unique index if not exists stock_opnames_branch_period_key
  on public.stock_opnames (branch_id, period_month);

create table if not exists public.stock_opname_lines (
  id uuid primary key default gen_random_uuid(),
  opname_id uuid not null references public.stock_opnames(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  system_qty numeric(10,2) not null,
  physical_qty numeric(10,2),
  difference numeric(10,2),
  note text,
  created_at timestamptz not null default now(),
  constraint stock_opname_lines_unique unique (opname_id, item_id)
);

comment on column public.stock_opname_lines.physical_qty is
  'Hasil hitung fisik di gudang, null bila item belum dihitung.';

alter table public.stock_opnames enable row level security;
alter table public.stock_opname_lines enable row level security;

drop policy if exists stock_opnames_select_privileged on public.stock_opnames;
create policy stock_opnames_select_privileged
  on public.stock_opnames for select to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists stock_opnames_write_privileged on public.stock_opnames;
create policy stock_opnames_write_privileged
  on public.stock_opnames for all to authenticated
  using (public.can_access_branch(branch_id))
  with check (public.can_access_branch(branch_id));

drop policy if exists stock_opname_lines_select on public.stock_opname_lines;
create policy stock_opname_lines_select
  on public.stock_opname_lines for select to authenticated
  using (
    exists (
      select 1 from public.stock_opnames o
       where o.id = opname_id and public.can_access_branch(o.branch_id)
    )
  );

drop policy if exists stock_opname_lines_write on public.stock_opname_lines;
create policy stock_opname_lines_write
  on public.stock_opname_lines for all to authenticated
  using (
    exists (
      select 1 from public.stock_opnames o
       where o.id = opname_id
         and public.can_access_branch(o.branch_id)
         and o.status = 'draft'::public.stock_opname_status
    )
  )
  with check (
    exists (
      select 1 from public.stock_opnames o
       where o.id = opname_id
         and public.can_access_branch(o.branch_id)
         and o.status = 'draft'::public.stock_opname_status
    )
  );

-- ---------------------------------------------------------------------------
-- 1. Membuka periode opname
-- ---------------------------------------------------------------------------

create or replace function public.open_stock_opname(
  p_branch_id uuid,
  p_period_month date,
  p_notes text default null::text
)
returns public.stock_opnames
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_month   date;
  v_existing public.stock_opnames%rowtype;
  v_row      public.stock_opnames%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Opname hanya bisa dibuka pengguna yang sudah masuk.';
  end if;

  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan opname.';
  end if;

  if not public.can_access_branch(p_branch_id) then
    raise exception 'Cabang tersebut tidak dapat diakses.';
  end if;

  v_month := date_trunc('month', p_period_month)::date;

  -- Satu opname per cabang per bulan. Bila sudah ada dan masih draf, baris
  -- dikembalikan lagi supaya operator bisa melanjutkan hitungan yang terputus.
  select * into v_existing
    from public.stock_opnames
   where branch_id = p_branch_id
     and period_month = v_month;

  if found then
    if v_existing.status = 'submitted'::public.stock_opname_status then
      raise exception 'Opname bulan % pada cabang ini sudah dikirim.', to_char(v_month, 'MM/YYYY');
    end if;

    if v_existing.status = 'cancelled'::public.stock_opname_status then
      raise exception 'Opname bulan % pada cabang ini sudah dibatalkan.', to_char(v_month, 'MM/YYYY');
    end if;

    return v_existing;
  end if;

  insert into public.stock_opnames (branch_id, period_month, notes, created_by)
  values (
    p_branch_id, v_month, nullif(btrim(coalesce(p_notes, '')), ''), v_profile
  )
  returning * into v_row;

  -- Saldo sistem disalin sebagai pembanding pada saat membuka opname.
  -- Koreksi yang terjadi setelah tanggal ini tetap terlihat lewat system_qty
  -- yang ditulis ulang saat baris dikirim.
  insert into public.stock_opname_lines (opname_id, item_id, system_qty)
  select v_row.id, i.id, i.current_stock
    from public.inventory_items i
   where i.branch_id = p_branch_id;

  return v_row;
end;
$function$;

revoke all on function public.open_stock_opname(uuid, date, text) from public, anon;
grant execute on function public.open_stock_opname(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Menyimpan hasil hitung fisik
-- ---------------------------------------------------------------------------

create or replace function public.save_stock_opname_lines(
  p_opname_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_opname  public.stock_opnames%rowtype;
  v_count   integer := 0;
  l         record;
  v_physical numeric;
begin
  if (select auth.uid()) is null then
    raise exception 'Opname hanya bisa diubah pengguna yang sudah masuk.';
  end if;

  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa melakukan opname.';
  end if;

  select * into v_opname from public.stock_opnames where id = p_opname_id;
  if not found then
    raise exception 'Opname tidak ditemukan.';
  end if;

  if not public.can_access_branch(v_opname.branch_id) then
    raise exception 'Opname ini milik cabang lain.';
  end if;

  if v_opname.status <> 'draft'::public.stock_opname_status then
    raise exception 'Opname ini sudah dikirim dan tidak bisa diubah lagi.';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Daftar hitungan fisik tidak valid.';
  end if;

  for l in select * from jsonb_to_recordset(p_lines) as x(
    item_id uuid,
    physical_qty numeric,
    note text
  )
  loop
    v_physical := l.physical_qty;

    if v_physical is not null and v_physical < 0 then
      raise exception 'Jumlah fisik tidak boleh negatif.';
    end if;

    update public.stock_opname_lines
       set physical_qty = v_physical,
           note          = nullif(btrim(coalesce(l.note, '')), '')
     where opname_id = p_opname_id
       and item_id = l.item_id;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  update public.stock_opnames set updated_at = now() where id = p_opname_id;

  return v_count;
end;
$function$;

revoke all on function public.save_stock_opname_lines(uuid, jsonb) from public, anon;
grant execute on function public.save_stock_opname_lines(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Mengirim opname dan menerapkan koreksi
-- ---------------------------------------------------------------------------

create or replace function public.submit_stock_opname(
  p_opname_id uuid,
  p_apply_adjustment boolean default true
)
returns public.stock_opnames
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_opname  public.stock_opnames%rowtype;
  v_row     public.stock_opnames%rowtype;
  v_missing integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Opname hanya bisa dikirim pengguna yang sudah masuk.';
  end if;

  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa mengirim opname.';
  end if;

  select * into v_opname from public.stock_opnames where id = p_opname_id;
  if not found then
    raise exception 'Opname tidak ditemukan.';
  end if;

  if not public.can_access_branch(v_opname.branch_id) then
    raise exception 'Opname ini milik cabang lain.';
  end if;

  if v_opname.status <> 'draft'::public.stock_opname_status then
    raise exception 'Opname ini sudah diproses.';
  end if;

  select count(*) into v_missing
    from public.stock_opname_lines
   where opname_id = p_opname_id
     and physical_qty is null;

  if v_missing > 0 then
    raise exception 'Masih ada % item yang belum dihitung fisiknya.', v_missing;
  end if;

  -- Saldo sistem disegarkan pada saat kirim, lalu selisihnya dihitung
  -- terhadap hitung fisik.
  update public.stock_opname_lines l
     set system_qty = i.current_stock
    from public.inventory_items i
   where l.opname_id = p_opname_id
     and i.id = l.item_id;

  update public.stock_opname_lines
     set difference = round(physical_qty - system_qty, 2)
   where opname_id = p_opname_id;

  if coalesce(p_apply_adjustment, true) then
    -- Selisih diambil dari kolom difference yang baru dihitung, bukan dari nilai
    -- inventory_items. Bila kolom itu dibaca setelah baris diperbarui,
    -- selisihnya akan selalu nol.
    update public.inventory_items i
       set current_stock = l.physical_qty,
           updated_at = now()
      from public.stock_opname_lines l
     where l.opname_id = p_opname_id
       and l.item_id = i.id
       and l.physical_qty <> l.system_qty;

    -- Koreksi opname dicatat sebagai penyesuaian isi gudang sehingga jejaknya
    -- masih bisa dibedakan dari pembelian dan pemakaian.
    insert into public.stock_logs (
      branch_id, item_id, log_type, quantity, balance_after,
      reference_id, created_by, note
    )
    select i.branch_id,
           l.item_id,
           case when l.difference > 0
                then 'in'::public.stock_log_type
                else 'out'::public.stock_log_type end,
           abs(l.difference),
           l.physical_qty,
           p_opname_id,
           v_profile,
           'opname ' || to_char(v_opname.period_month, 'MM/YYYY')
      from public.stock_opname_lines l
      join public.inventory_items i on i.id = l.item_id
     where l.opname_id = p_opname_id
       and l.difference is distinct from 0;
  end if;

  update public.stock_opnames
     set status       = 'submitted'::public.stock_opname_status,
         submitted_by = v_profile,
         submitted_at = now(),
         updated_at   = now()
   where id = p_opname_id
  returning * into v_row;

  insert into public.activity_logs (actor_id, action, entity, entity_id, metadata)
  values (
    v_profile, 'stock.opname.submitted', 'stock_opname', p_opname_id,
    jsonb_build_object(
      'period', to_char(v_opname.period_month, 'YYYY-MM'),
      'apply_adjustment', coalesce(p_apply_adjustment, true)
    )
  );

  return v_row;
end;
$function$;

revoke all on function public.submit_stock_opname(uuid, boolean) from public, anon;
grant execute on function public.submit_stock_opname(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Membatalkan draf
-- ---------------------------------------------------------------------------

create or replace function public.cancel_stock_opname(p_opname_id uuid)
returns public.stock_opnames
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_opname  public.stock_opnames%rowtype;
  v_row     public.stock_opnames%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Opname hanya bisa dibatalkan pengguna yang sudah masuk.';
  end if;

  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa membatalkan opname.';
  end if;

  select * into v_opname from public.stock_opnames where id = p_opname_id;
  if not found then
    raise exception 'Opname tidak ditemukan.';
  end if;

  if not public.can_access_branch(v_opname.branch_id) then
    raise exception 'Opname ini milik cabang lain.';
  end if;

  if v_opname.status <> 'draft'::public.stock_opname_status then
    raise exception 'Opname yang sudah dikirim tidak bisa dibatalkan.';
  end if;

  update public.stock_opnames
     set status     = 'cancelled'::public.stock_opname_status,
         updated_at = now()
   where id = p_opname_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.cancel_stock_opname(uuid) from public, anon;
grant execute on function public.cancel_stock_opname(uuid) to authenticated;