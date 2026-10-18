-- Status profil aktif bisa dibaca tanpa lewat jaringan.
--
-- Middleware sebelumnya memanggil RPC current_profile_state dari PostgREST
-- pada setiap permintaan halaman. Itu satu perjalanan bolak-balik ke Supabase
-- tambahan yang tidak perlu: halaman-halaman server sudah memanggilnya sendiri
-- lewat getSessionProfile, jadi hasilnya sama sekali tidak dipakai.
--
-- Fungsi ini dibuat sebagai SQL, bukan plpgsql, supaya PostgREST bisa
-- menyajikannya lewat jalur yang sama dengan fungsi lain tetapi jauh lebih
-- murah. Di它的 tempat, middleware hanya perlu satu getUser, bukan dua
-- perjalanan.

create or replace function public.current_profile_state()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select case
    when (select p.is_active from public.profiles p
           where p.auth_id = (select auth.uid())
           order by p.created_at asc limit 1) = false
      then 'inactive'
    else 'active'
  end;
$function$;

revoke all on function public.current_profile_state() from public;
grant execute on function public.current_profile_state() to anon, authenticated;