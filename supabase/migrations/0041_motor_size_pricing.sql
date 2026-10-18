-- Harga per ukuran motor: S, M, L, XL.
--
-- Sebelumnya motor hanya punya satu harga (price_motor), padahal ukuran motor
-- sangat bervariasi, dari motor scoot sampai big bike tidak bisa berharga sama.
-- Empat kolom baru mewakili Motor S sampai Motor XL. Nilainya disalin dari
-- price_motor supaya katalog yang sudah ada tetap punya harga tanpa perlu diisi
-- ulang; perhitungan di sisi server memakai kolom baru dan jatuh ke price_motor
-- kalau kolom baru masih nol.

alter table public.services
  add column if not exists price_motor_s numeric(12,2) not null default 0,
  add column if not exists price_motor_m numeric(12,2) not null default 0,
  add column if not exists price_motor_l numeric(12,2) not null default 0,
  add column if not exists price_motor_xl numeric(12,2) not null default 0;

update public.services
   set price_motor_s = price_motor,
       price_motor_m = price_motor,
       price_motor_l = price_motor,
       price_motor_xl = price_motor
 where price_motor_s = 0
   and price_motor_m = 0
   and price_motor_l = 0
   and price_motor_xl = 0
   and price_motor > 0;

-- Label ukuran motor pada enum vehicle_size.
do $$
begin
  if not exists (select 1 from pg_enum where enumtypid = 'public.vehicle_size'::regtype and enumlabel = 'Motor S') then
    alter type public.vehicle_size add value 'Motor S';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.vehicle_size'::regtype and enumlabel = 'Motor M') then
    alter type public.vehicle_size add value 'Motor M';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.vehicle_size'::regtype and enumlabel = 'Motor L') then
    alter type public.vehicle_size add value 'Motor L';
  end if;
  if not exists (select 1 from pg_enum where enumtypid = 'public.vehicle_size'::regtype and enumlabel = 'Motor XL') then
    alter type public.vehicle_size add value 'Motor XL';
  end if;
end
$$;