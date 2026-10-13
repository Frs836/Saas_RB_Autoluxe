-- 0018: stok masuk dari supplier.
--
-- PRD 5.2 meminta pencatatan stok masuk dari supplier dengan tanggal, nama
-- barang, jumlah, dan harga beli. Tabel stock_logs sudah ada sejak 0001 tetapi
-- belum punya jalur tulisan, sehingga pembelian dari supplier tidak pernah
-- tercatat dan saldo stok hanya bergerak karena klaim staf.
--
-- Harga beli disimpan terpisah di inventory_items.unit_cost. Nilainya dipakai
-- sebagai harga acuan terakhir, bukan harga jual, dan tidak ikut dipotong saat
-- stok keluar.

alter table public.inventory_items
  add column if not exists unit_cost numeric(12,2);

comment on column public.inventory_items.unit_cost is
  'Harga beli terakhir per unit dari supplier, nullable bila belum ada pembelian.';

-- stock_logs tidak punya kolom teks. reference_id bertipe uuid sehingga tidak
-- bisa dipakai untuk nama supplier atau nomor nota.
alter table public.stock_logs
  add column if not exists note text;

comment on column public.stock_logs.note is
  'Catatan pembelian supplier atau nomor nota untuk log stok masuk.';

create or replace function public.record_stock_in(
  p_item_id uuid,
  p_quantity numeric,
  p_unit_cost numeric default null,
  p_note text default null::text
)
returns public.inventory_items
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_profile uuid;
  v_item    public.inventory_items%rowtype;
  v_balance numeric;
  v_row     public.inventory_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Stok masuk hanya bisa dicatat oleh pengguna yang sudah masuk.';
  end if;

  v_profile := (select public.current_profile_id());
  if v_profile is null then
    raise exception 'Sesi tidak valid.';
  end if;

  -- PRD menetapkan admin atau maintainer yang mencatat stok masuk.
  if not coalesce((
    select public.has_role(array['owner', 'admin_kasir', 'maintainer']::public.user_role[])
  ), false) then
    raise exception 'Hanya owner, admin kasir, dan maintainer yang bisa mencatat stok masuk.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah stok masuk harus lebih dari nol.';
  end if;

  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'Harga beli tidak boleh negatif.';
  end if;

  select * into v_item
    from public.inventory_items
   where id = p_item_id
   for update;

  if not found then
    raise exception 'Item stok tidak ditemukan.';
  end if;

  if not public.can_access_branch(v_item.branch_id) then
    raise exception 'Item stok ini milik cabang lain.';
  end if;

  v_balance := round(v_item.current_stock + p_quantity, 2);

  update public.inventory_items
     set current_stock = v_balance,
         unit_cost = case
           when p_unit_cost is null then v_item.unit_cost
           else round(p_unit_cost, 2)
         end,
         updated_at = now()
   where id = v_item.id
  returning * into v_row;

  insert into public.stock_logs (
    branch_id, item_id, log_type, quantity, balance_after, note, created_by
  )
  values (
    v_item.branch_id,
    v_item.id,
    'in'::public.stock_log_type,
    round(p_quantity, 2),
    v_balance,
    nullif(btrim(coalesce(p_note, '')), ''),
    v_profile
  );

  return v_row;
end;
$function$;

revoke all on function public.record_stock_in(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.record_stock_in(uuid, numeric, numeric, text) to authenticated;