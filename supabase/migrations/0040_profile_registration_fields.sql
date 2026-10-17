-- Data diri saat pendaftaran: tanggal lahir + nomor WhatsApp.
--
-- Pendaftaran kini meminta tanggal lahir dan nomor WhatsApp, bukan hanya nama
-- dan email. Keduanya disimpan di metadata auth lalu disalin ke profil oleh
-- trigger yang sama supaya tetap satu sumber data. Kolomnya ditambah lebih
-- dulu, baru fungsinya diperbarui, agar trigger tidak gagal saat signup.

alter table public.profiles
  add column if not exists date_of_birth date;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_phone text  := nullif(btrim(coalesce(v_meta ->> 'phone_number', '')), '');
  v_dob   text  := nullif(btrim(coalesce(v_meta ->> 'date_of_birth', '')), '');
begin
  insert into public.profiles (
    auth_id, full_name, role, branch_id, phone_number, date_of_birth
  )
  values (
    new.id,
    coalesce(
      nullif(btrim(v_meta ->> 'full_name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'karyawan'::public.user_role,
    (select id from public.branches order by created_at asc limit 1),
    case when v_phone ~ '^[0-9+][0-9 -]{6,}$' then v_phone else null end,
    case when v_dob ~ '^\d{4}-\d{2}-\d{2}$' then v_dob::date else null end
  )
  on conflict (auth_id) do nothing;
  return new;
end;
$function$;
