-- Tabel invoice.
--
-- Nota sebelumnya hanya dicetak atau dikirim lewat WhatsApp saat order dibuat.
-- Begitu kertas hilang atau pelanggan minta salinan, tidak ada satu pun catatan
-- yang bisa dicetak ulang, karena tidak pernah disimpan sebagai dokumen.
--
-- invoices menyimpan satu baris per order. Nomornya mengikuti nomor order
-- supaya tidak ada dua sumber kebenaran, dan isinya ikut menyalin status
-- pembayaran supaya tampilan tidak perlu menggabungkan dua tabel setiap kali
-- dibuka.

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  invoice_number text not null unique,
  branch_id uuid not null references public.branches(id),
  issued_at timestamptz not null default now(),
  total_price numeric(12,2) not null,
  payment_method public.payment_method not null,
  payment_state public.order_payment_state not null,
  status public.order_status not null,
  customer_name text,
  customer_phone text,
  license_plate text,
  vehicle_model text,
  vehicle_size public.vehicle_size,
  service_package text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_branch_issued_idx
  on public.invoices (branch_id, issued_at desc);

-- Invoice terbit bersama ordernya, dari jalur mana pun order itu dibuat.
create or replace function public.issue_invoice_for_order()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.invoices (
    order_id, invoice_number, branch_id, total_price,
    payment_method, payment_state, status,
    customer_name, customer_phone, license_plate,
    vehicle_model, vehicle_size, service_package, created_by
  )
  values (
    new.id,
    'INV-' || new.order_number,
    new.branch_id,
    new.total_price,
    new.payment_method,
    new.payment_state,
    new.status,
    new.customer_name,
    new.customer_phone,
    new.license_plate,
    new.vehicle_model,
    new.vehicle_size,
    new.service_package,
    new.created_by
  )
  on conflict (order_id) do nothing;

  return new;
end;
$function$;

drop trigger if exists orders_issue_invoice on public.orders;
create trigger orders_issue_invoice
  after insert on public.orders
  for each row
  execute function public.issue_invoice_for_order();

-- Status pembayaran dan status pengerjaan bisa berubah setelah invoice terbit,
-- jadi salinannya ikut diperbarui. Kalau tidak, invoice yang sudah dicetak ulang
-- akan menampilkan status basi.
create or replace function public.sync_invoice_with_order()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.invoices
     set payment_state = new.payment_state,
         status = new.status,
         total_price = new.total_price,
         service_package = new.service_package,
         updated_at = now()
   where order_id = new.id;

  return new;
end;
$function$;

drop trigger if exists orders_sync_invoice on public.orders;
create trigger orders_sync_invoice
  after update on public.orders
  for each row
  execute function public.sync_invoice_with_order();

-- Order lama belum punya invoice, jadi dibuatkan sekarang.
insert into public.invoices (
  order_id, invoice_number, branch_id, total_price,
  payment_method, payment_state, status,
  customer_name, customer_phone, license_plate,
  vehicle_model, vehicle_size, service_package, created_by, issued_at, created_at
)
select
  o.id,
  'INV-' || o.order_number,
  o.branch_id,
  o.total_price,
  o.payment_method,
  o.payment_state,
  o.status,
  o.customer_name,
  o.customer_phone,
  o.license_plate,
  o.vehicle_model,
  o.vehicle_size,
  o.service_package,
  o.created_by,
  o.created_at,
  o.created_at
from public.orders o
on conflict (order_id) do nothing;

alter table public.invoices enable row level security;

drop policy if exists invoices_select_privileged on public.invoices;
create policy invoices_select_privileged on public.invoices
  for select
  to authenticated
  using (
    public.has_role(
      array['owner', 'admin_kasir', 'maintainer']::public.user_role[]
    )
    and public.can_access_branch(branch_id)
  );

-- Invoice tidak boleh diubah atau dihapus dari sisi klien. Statusnya mengikuti
-- order, jadi koreksi harus lewat jalur order yang sudah ada aturannya.
revoke all on table public.invoices from anon;
grant select on table public.invoices to authenticated;