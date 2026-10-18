-- Klaim garansi dari link lacak publik.
--
-- Pelanggan tidak punya akun di sistem, jadi klaim yang dulu hanya bisa
-- diajukan staf dari dalam aplikasi. Padahal yang paling perlu adalah
-- pelanggan sendiri yang melaporkan kerusakan setelah memakai unit. Link lacak
-- (tracking_token) sudah menjadi surat jalan unit itu, jadi token itulah yang
-- dipakai sebagai bukti kepemilikan, lalu divalidasi terhadap garansi aktif.
--
-- Klaim tetap berstatus pending dan hanya bisa disetujui staf, jadi fungsi ini
-- tidak membuka akses ke data lain dan tidak bisa dipakai untuk mengubah
-- garansi.

create or replace function public.create_public_warranty_claim(
  p_token              text,
  p_problem_description text,
  p_proof_photo_url    text default null
)
returns public.warranty_claims
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_token    text := nullif(btrim(p_token), '');
  v_order    public.orders%rowtype;
  v_warranty public.warranties%rowtype;
  v_today    date := (now() at time zone 'Asia/Jakarta')::date;
  v_row      public.warranty_claims%rowtype;
begin
  if v_token is null then
    raise exception 'Token lacak tidak valid.';
  end if;

  if length(btrim(coalesce(p_problem_description, ''))) < 10 then
    raise exception 'Detail keluhan minimal 10 karakter.';
  end if;

  select * into v_order
    from public.orders o
   where o.tracking_token = v_token;

  if not found then
    raise exception 'Token lacak tidak ditemukan.';
  end if;

  if v_order.status not in (
    'completed'::public.order_status,
    'menunggu_diambil'::public.order_status,
    'diserahkan'::public.order_status
  ) then
    raise exception 'Garansi baru bisa diklaim setelah pengerjaan selesai.';
  end if;

  select * into v_warranty
    from public.warranties w
   where w.order_id = v_order.id
   order by w.created_at desc
   limit 1;

  if not found then
    raise exception 'Unit ini tidak memiliki sertifikat garansi.';
  end if;

  if v_warranty.status <> 'active'::public.warranty_status then
    raise exception 'Sertifikat garansi berstatus %, tidak dapat diklaim.', v_warranty.status;
  end if;

  if v_warranty.end_date < v_today then
    raise exception 'Masa garansi berakhir pada %s.',
      to_char(v_warranty.end_date, 'DD/MM/YYYY');
  end if;

  if exists (
    select 1 from public.warranty_claims c
     where c.order_id = v_order.id
       and c.status = 'pending'::public.warranty_claim_status
  ) then
    raise exception 'Sudah ada klaim yang sedang diproses untuk unit ini.';
  end if;

  insert into public.warranty_claims (
    order_id, problem_description, proof_photo_url, status, created_by
  ) values (
    v_order.id,
    btrim(p_problem_description),
    nullif(btrim(coalesce(p_proof_photo_url, '')), ''),
    'pending'::public.warranty_claim_status,
    v_order.created_by
  ) returning * into v_row;

  return v_row;
end;
$function$;

-- Halaman lacak dibuka tanpa login, jadi anon harus boleh memanggil fungsi ini.
-- Fungsi sudah membatasi herself pada satu order yang tokennya cocok.
revoke all on function public.create_public_warranty_claim(text, text, text)
  from public;

grant execute on function public.create_public_warranty_claim(text, text, text)
  to anon, authenticated;