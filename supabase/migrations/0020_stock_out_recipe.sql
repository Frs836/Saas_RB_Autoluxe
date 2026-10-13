-- 0020: resep bahan per layanan dan pemotongan stok otomatis.
--
-- PRD 5.2 meminta stok bahan terpotong otomatis ketika SPK berstatus
-- completed, mengikuti resep atau formula layanan. Sebelumnya tidak ada
-- relasi layanan ke bahan sama sekali, sehingga stok hanya bergerak karena
-- klaim manual staf.
--
-- Resep dibuat per cabang karena inventaris juga per cabang. Satu cabang bisa
-- memakai shampoo merek berbeda dari cabang lain untuk layanan yang sama.
--
-- Keputusan penting: pemotongan tidak diblokir bila stok tidak cukup.
-- Menolak penyelesaian order akan membuat kendaraan pelanggan tertahan hanya
-- karena bahan habis, sedangkan persetujuan QC adalah keputusan mutu yang
-- tidak boleh bergantung pada stok. Saldo boleh menjadi negatif agar
-- ketidaksesuaian langsung terlihat di laporan dan opname, dan setiap
-- pemotongan tercatat di stock_logs lengkap dengan sisa saldo.

create table if not exists public.service_material_recipes (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity numeric(10,2) not null check (quantity > 0),
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_material_recipes_unique
    unique (branch_id, service_id, item_id)
);

comment on table public.service_material_recipes is
  'Jumlah bahan yang dipakai per unit layanan, per cabang.';

create index if not exists service_material_recipes_branch_service_idx
  on public.service_material_recipes (branch_id, service_id);

alter table public.service_material_recipes enable row level security;

drop policy if exists service_material_recipes_select_privileged on public.service_material_recipes;
create policy service_material_recipes_select_privileged
  on public.service_material_recipes for select to authenticated
  using (public.can_access_branch(branch_id));

drop policy if exists service_material_recipes_write_privileged on public.service_material_recipes;
create policy service_material_recipes_write_privileged
  on public.service_material_recipes for all to authenticated
  using (public.can_access_branch(branch_id))
  with check (public.can_access_branch(branch_id));

-- ---------------------------------------------------------------------------
-- 1. Kelola resep
-- ---------------------------------------------------------------------------

create or replace function public.set_service_recipe(
  p_branch_id uuid,
  p_service_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_remove boolean default false
)
returns public.service_material_recipes
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_item    public.inventory_items%rowtype;
  v_row     public.service_material_recipes%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Resep bahan hanya bisa diubah pengguna yang sudah masuk.';
  end if;

  v_profile := public.current_profile_id();
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  if not coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa mengatur resep bahan.';
  end if;

  if not public.can_access_branch(p_branch_id) then
    raise exception 'Cabang tersebut tidak dapat diakses.';
  end if;

  if not exists (
    select 1 from public.services s where s.id = p_service_id
  ) then
    raise exception 'Layanan tidak ditemukan.';
  end if;

  select * into v_item from public.inventory_items where id = p_item_id;
  if not found then
    raise exception 'Item stok tidak ditemukan.';
  end if;

  -- Resep tidak boleh menunjuk bahan milik cabang lain, karena pemotongan
  -- akan terjadi pada inventaris cabang itu.
  if v_item.branch_id <> p_branch_id then
    raise exception 'Item stok bukan milik cabang yang dipilih.';
  end if;

  if coalesce(p_remove, false) then
    delete from public.service_material_recipes
     where branch_id = p_branch_id
       and service_id = p_service_id
       and item_id = p_item_id
    returning * into v_row;

    if not found then
      raise exception 'Resep tidak ditemukan.';
    end if;

    return v_row;
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah pemakaian bahan harus lebih dari nol.';
  end if;

  insert into public.service_material_recipes (
    branch_id, service_id, item_id, quantity, created_by
  )
  values (
    p_branch_id, p_service_id, p_item_id, round(p_quantity, 2), v_profile
  )
  on conflict (branch_id, service_id, item_id)
  do update set quantity = excluded.quantity, updated_at = now()
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.set_service_recipe(uuid, uuid, uuid, numeric, boolean)
  from public, anon;
grant execute on function public.set_service_recipe(uuid, uuid, uuid, numeric, boolean)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Pemotongan otomatis
-- ---------------------------------------------------------------------------

-- Dipisah dari apply_order_status agar logika stok mudah diuji sendiri.
-- Idempoten terhadap pemanggilan berulang untuk order yang sama karena
-- memeriksa log out untuk order tersebut sebelum memotong lagi.
create or replace function public.consume_order_materials(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_branch  uuid;
  v_cut     integer := 0;
  r         record;
begin
  select branch_id into v_branch from public.orders where id = p_order_id;
  if v_branch is null then
    raise exception 'Order tidak ditemukan.';
  end if;

  -- Jangan potong dua kali untuk order yang sama. stock_logs memakai
  -- reference_id untuk menandai asal pemotongan otomatis.
  if exists (
    select 1
      from public.stock_logs l
     where l.reference_id = p_order_id
       and l.log_type = 'out'::public.stock_log_type
       and l.note = 'auto: pemakaian bahan order'
  ) then
    return 0;
  end if;

  for r in
    select oi.service_id,
           oi.quantity as service_qty,
           rec.item_id,
           rec.quantity as per_unit
      from public.order_items oi
      join public.service_material_recipes rec
        on rec.service_id = oi.service_id
       and rec.branch_id = v_branch
     where oi.order_id = p_order_id
       and oi.service_id is not null
  loop
    declare
      v_amount numeric;
      v_item   public.inventory_items%rowtype;
      v_balance numeric;
    begin
      v_amount := round(r.per_unit * r.service_qty, 2);
      if v_amount <= 0 then
        continue;
      end if;

      select * into v_item
        from public.inventory_items
       where id = r.item_id
       for update;

      if not found then
        raise exception 'Item stok resep sudah tidak ada: %', r.item_id;
      end if;

      -- Saldo boleh negatif. Menolak sini akan menahan penyelesaian order
      -- hanya karena bahan habis, padahal persetujuan QC adalah keputusan
      -- mutu. Ketidaksesuaian terekam di stock_logs dan terlihat di opname.
      v_balance := round(v_item.current_stock - v_amount, 2);

      update public.inventory_items
         set current_stock = v_balance,
             updated_at = now()
       where id = r.item_id;

      insert into public.stock_logs (
        branch_id, item_id, log_type, quantity, balance_after,
        reference_id, created_by, note
      )
      values (
        v_branch, r.item_id, 'out'::public.stock_log_type, v_amount,
        v_balance, p_order_id, public.current_profile_id(),
        'auto: pemakaian bahan order'
      );

      v_cut := v_cut + 1;
    end;
  end loop;

  return v_cut;
end;
$function$;

revoke all on function public.consume_order_materials(uuid) from public, anon;
grant execute on function public.consume_order_materials(uuid) to authenticated;