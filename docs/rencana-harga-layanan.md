# Rencana Aman: Harga Layanan Jadi Baris

Status: **rencana, belum dieksekusi.** Tidak ada satu pun perintah di dokumen
ini yang sudah dijalankan ke database produksi.

Ini perubahan skema terberat yang tersisa, jadi urutannya disusun supaya setiap
langkah bisa dibatalkan sendiri tanpa kehilangan data dan tanpa mematikan
layanan.

---

## 1. Keadaan sekarang (terukur)

`services` menyimpan harga dalam sembilan kolom:

```
price_s, price_m, price_l, price_xl,
price_motor, price_motor_s, price_motor_m, price_motor_l, price_motor_xl
```

Isi tabel saat ini: **15 layanan, semuanya aktif.**

Yang membaca harga:

| Pembaca | Cara membaca |
|---|---|
| `service_price_for_size(services, vehicle_size)` | `case` atas sembilan kolom, mengembalikan `null` bila harga ukuran motor nol |
| `create_pos_order_with_hold(...)` | satu-satunya pemanggil `service_price_for_size` |
| `set_service(...)` | menulis sembilan kolom sekaligus |
| `lib/pos.ts` → `priceForSize()` | memetakan `VehicleSize` ke nama kolom |
| `components/pos/service-manager.tsx` | membaca kolom untuk formulir harga |

Jadi wilayah yang tersentuh hanya dua fungsi SQL, satu tipe di `lib/pos.ts`,
dan satu komponen formulir. Tidak ada kueri lain yang membaca kolom harga.

## 2. Aturan harga yang wajib dipertahankan

Ini bagian yang paling mudah salah. Perilaku sekarang:

- Ukuran `S`, `M`, `L`, `XL`, `Motor` memakai kolomnya masing-masing apa adanya,
  termasuk nilai nol.
- Ukuran `Motor S`, `Motor M`, `Motor L`, `Motor XL` memakai kolom khususnya
  **hanya bila lebih dari nol**. Bila nol, `service_price_for_size`
  mengembalikan `null`, lalu pemanggil memakai `price_motor` sebagai harga
  cadangan.

Migrasi yang mengabaikan cadangan ini akan membuat layanan motor ukuran S/M/L/XL
tiba-tiba tidak bisa dijual (harga nol) atau berubah harga. Verifikasi di
bagian 6 membandingkan seluruh 135 kombinasi supaya hal itu tidak lolos.

Dua hal yang sudah diperiksa langsung di database:

- `create_pos_order_with_hold` memang memuat cadangan itu secara eksplisit:
  bila `service_price_for_size` mengembalikan `null` atau nol untuk ukuran yang
  berawalan `Motor `, nilainya diganti `v_service.price_motor`. Jadi menghapus
  perilaku `null` di fungsi baca aman selama penyalinan sudah menyelesaikan
  cadangannya.
- Saat ini **tidak ada satu layanan pun** yang harga motor per ukurannya nol
  sementara harga motor umumnya terisi. Artinya cadangan itu belum pernah
  mengubah harga. Delapan layanan memang bermotor nol seluruhnya (layanan
  mobil saja), dan tujuh sisanya mengisi semua ukuran motor dengan angka sama.

## 3. Skema tujuan

```sql
create table public.service_prices (
  id            uuid primary key default gen_random_uuid(),
  service_id    uuid not null references public.services(id) on delete cascade,
  vehicle_type  text not null check (vehicle_type in ('mobil', 'motor')),
  size_code     text not null check (size_code in ('S', 'M', 'L', 'XL', 'ALL')),
  price         numeric not null check (price >= 0),
  valid_from    timestamptz not null default now(),
  valid_to      timestamptz,
  changed_by    uuid references public.profiles(id) on delete set null,
  change_note   text
);

-- Satu harga berlaku per layanan, jenis kendaraan, dan ukuran.
create unique index service_prices_aktif_unique
  on public.service_prices (service_id, vehicle_type, size_code)
  where valid_to is null;
```

`size_code = 'ALL'` dipakai untuk harga motor umum (`price_motor`) yang menjadi
cadangan semua ukuran motor. Dengan begitu cadangan tetap tersimpan sebagai
data, bukan tersembunyi di kode.

Riwayat tidak perlu tabel terpisah: menutup baris lama dengan `valid_to` sudah
meninggalkan jejak, dan `changed_by` mencatat pelakunya.

## 4. Langkah migrasi

Setiap langkah dijalankan sendiri, lalu diperiksa, baru lanjut. Semua langkah
penulisan dibungkus transaksi.

### Langkah 1 — tambah tabel, belum dipakai

Tambahkan `service_prices` persis seperti bagian 3, plus:

```sql
alter table public.service_prices enable row level security;

create policy service_prices_select_authenticated
  on public.service_prices for select
  to authenticated
  using (true);
```

Tidak ada penulisan dari klien. Harga hanya ditulis lewat `set_service` yang
berjalan sebagai `security definer`, jadi tidak perlu policy insert/update.

**Belum ada yang berubah bagi pengguna.** Rollback: `drop table service_prices;`

### Langkah 2 — salin harga lama ke baris

```sql
insert into public.service_prices (service_id, vehicle_type, size_code, price)
select s.id, v.vehicle_type, v.size_code, v.price
from public.services s
cross join lateral (values
  ('mobil', 'S',   s.price_s),
  ('mobil', 'M',   s.price_m),
  ('mobil', 'L',   s.price_l),
  ('mobil', 'XL',  s.price_xl),
  ('motor', 'ALL', s.price_motor),
  ('motor', 'S',   coalesce(nullif(s.price_motor_s, 0), s.price_motor)),
  ('motor', 'M',   coalesce(nullif(s.price_motor_m, 0), s.price_motor)),
  ('motor', 'L',   coalesce(nullif(s.price_motor_l, 0), s.price_motor)),
  ('motor', 'XL',  coalesce(nullif(s.price_motor_xl, 0), s.price_motor))
) as v(vehicle_type, size_code, price);
```

Perhatikan `coalesce(nullif(..., 0), price_motor)`: cadangan di bagian 2
diselesaikan **saat penyalinan**, sehingga setelah ini tidak ada lagi aturan
cadangan yang perlu diingat kode mana pun.

Hasil yang diharapkan: **15 × 9 = 135 baris.**

Rollback: `delete from service_prices;`

### Langkah 3 — alihkan pembacaan

Ganti isi `service_price_for_size` supaya membaca tabel baru, dengan tanda
tangan fungsi yang sama sehingga pemanggilnya tidak perlu diubah:

```sql
create or replace function public.service_price_for_size(
  p_service services, p_size vehicle_size
) returns numeric
language sql stable
set search_path to ''
as $function$
  select sp.price
  from public.service_prices sp
  where sp.service_id = p_service.id
    and sp.valid_to is null
    and (sp.vehicle_type, sp.size_code) = case p_size
      when 'S'   then ('mobil', 'S')
      when 'M'   then ('mobil', 'M')
      when 'L'   then ('mobil', 'L')
      when 'XL'  then ('mobil', 'XL')
      when 'Motor'   then ('motor', 'ALL')
      when 'Motor S' then ('motor', 'S')
      when 'Motor M' then ('motor', 'M')
      when 'Motor L' then ('motor', 'L')
      when 'Motor XL' then ('motor', 'XL')
    end
  limit 1;
$function$;
```

Catatan: fungsi ini sekarang `stable`, bukan `immutable`, karena membaca tabel.
Tidak ada indeks yang bergantung pada `immutable`-nya, jadi aman.

**Verifikasi wajib sebelum lanjut ke langkah 4** (bagian 6).

### Langkah 4 — alihkan penulisan

`set_service` diubah agar menutup baris lama dan membuka baris baru, bukan
memperbarui kolom. Tanda tangannya tetap sama sehingga formulir lama masih bisa
memanggilnya.

```sql
-- potongan inti, dijalankan setelah baris layanan diperbarui
update public.service_prices
   set valid_to = now(), changed_by = auth_profile_id(), change_note = 'perubahan harga'
 where service_id = p_service_id and valid_to is null;

insert into public.service_prices (service_id, vehicle_type, size_code, price, changed_by)
values
  (p_service_id, 'mobil', 'S',   p_price_s,   auth_profile_id()),
  (p_service_id, 'mobil', 'M',   p_price_m,   auth_profile_id()),
  (p_service_id, 'mobil', 'L',   p_price_l,   auth_profile_id()),
  (p_service_id, 'mobil', 'XL',  p_price_xl,  auth_profile_id()),
  (p_service_id, 'motor', 'ALL', p_price_motor, auth_profile_id()),
  (p_service_id, 'motor', 'S',  coalesce(nullif(p_price_motor_s, 0), p_price_motor), auth_profile_id()),
  (p_service_id, 'motor', 'M',  coalesce(nullif(p_price_motor_m, 0), p_price_motor), auth_profile_id()),
  (p_service_id, 'motor', 'L',  coalesce(nullif(p_price_motor_l, 0), p_price_motor), auth_profile_id()),
  (p_service_id, 'motor', 'XL', coalesce(nullif(p_price_motor_xl, 0), p_price_motor), auth_profile_id());
```

Kolom lama tetap ditulis pada langkah ini (dual write). Dengan begitu, kalau
langkah 5 ditunda atau dibatalkan, aplikasi lama tetap benar.

### Langkah 5 — hentikan pemakaian kolom lama

1. `lib/pos.ts`: ganti `PRICE_FIELD` menjadi peta ukuran ke
   `{ vehicleType, sizeCode }`, dan `priceForSize` membaca dari harga yang
   dikirim server, bukan dari kolom.
2. `components/pos/service-manager.tsx`: formulir mengirim harga sebagai
   daftar pasangan ukuran-harga, bukan sembilan field.
3. Setelah kode baru terpasang dan teruji, baru:

```sql
alter table public.services
  drop column price_s, drop column price_m,
  drop column price_l, drop column price_xl,
  drop column price_motor, drop column price_motor_s,
  drop column price_motor_m, drop column price_motor_l,
  drop column price_motor_xl;
```

Langkah 5 adalah satu-satunya yang tidak bisa dibatalkan dengan mudah, karena
datanya sudah tidak ada di kolom lama. Karena itu langkah ini **paling akhir**
dan hanya setelah semua verifikasi di bawah lolos.

## 5. Mengapa urutan ini aman

- Langkah 1 dan 2 hanya menambah. Aplikasi yang sedang berjalan tidak tahu
  tabel baru ada.
- Langkah 3 mengubah satu fungsi dengan tanda tangan sama. Bila hasilnya salah,
  cukup jalankan ulang definisi fungsi lama (tersimpan di migrasi
  `0042_server_motor_size_pricing.sql`) tanpa menyentuh data.
- Langkah 4 menulis ke dua tempat. Data lama tetap utuh.
- Langkah 5 hanya dijalankan setelah kode baru terbukti.

Tidak ada langkah yang butuh menghentikan layanan. Tidak ada jendela waktu di
mana harga bisa terbaca salah, karena langkah 3 dan 4 dipisah dan diverifikasi
di antaranya.

## 6. Verifikasi yang harus lolos sebelum langkah 5

Bandingkan seluruh kombinasi. Harus **135 baris, 0 selisih**:

```sql
with pasangan as (
  select s.id, s.name, u.size,
    public.service_price_for_size(
      s,
      u.size::public.vehicle_size
    ) as baru,
    case u.size
      when 'S'      then s.price_s
      when 'M'      then s.price_m
      when 'L'      then s.price_l
      when 'XL'     then s.price_xl
      when 'Motor'  then s.price_motor
      when 'Motor S'  then coalesce(nullif(s.price_motor_s, 0), s.price_motor)
      when 'Motor M'  then coalesce(nullif(s.price_motor_m, 0), s.price_motor)
      when 'Motor L'  then coalesce(nullif(s.price_motor_l, 0), s.price_motor)
      when 'Motor XL' then coalesce(nullif(s.price_motor_xl, 0), s.price_motor)
    end as lama
  from public.services s
  cross join (values ('S'),('M'),('L'),('XL'),('Motor'),
                     ('Motor S'),('Motor M'),('Motor L'),('Motor XL')) as u(size)
)
select count(*) as total,
       count(*) filter (where baru is distinct from lama) as selisih
from pasangan;
```

Selain itu:

- Buat satu order POS uji, lalu bandingkan `order_items.price` dengan harga
  katalog. Hapus order uji setelahnya.
- Ubah satu harga lewat halaman Kelola Jasa, lalu pastikan baris lama
  mendapat `valid_to` dan baris baru muncul.

## 7. Risiko

| Risiko | Dampak | Penanganan |
|---|---|---|
| Cadangan harga motor terlewat | Harga motor S/M/L/XL jadi 0 | Kueri verifikasi bagian 6 |
| `service_price_for_size` dipanggil di tempat lain | Harga salah di order | Sudah diperiksa: hanya `create_pos_order_with_hold` |
| Formulir lama masih mengirim sembilan field | Harga tidak tersimpan | Langkah 4 tetap dual-write, jadi tidak ada yang hilang |
| Lupa membatalkan langkah 5 saat rollback | Kolom hilang permanen | Langkah 5 ditunda sampai semua uji lolos |

## 8. Yang perlu diputuskan sebelum dijalankan

1. Apakah `size_code = 'ALL'` untuk harga motor umum disetujui, atau lebih baik
   harga motor umum disalin ke setiap ukuran motor sehingga tidak ada cadangan
   sama sekali?
2. Apakah riwayat harga perlu ditampilkan di halaman Kelola Jasa, atau cukup
   tersimpan untuk audit?
3. Apakah `changed_by` wajib, atau boleh kosong untuk perubahan yang dilakukan
   sebelum fitur ini ada?
