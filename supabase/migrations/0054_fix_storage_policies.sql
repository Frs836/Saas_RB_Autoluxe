-- Perbaiki dua policy storage yang tidak pernah berhasil dipakai.
--
-- 1. inspection_photos_insert_own dibuat tanpa ekspresi apa pun. Untuk
--    perintah INSERT, policy tanpa WITH CHECK berarti tidak ada satu pun baris
--    yang diizinkan, jadi policy itu menolak semua unggahan, bukan hanya
--    membukanya. Akibatnya foto inspeksi order tidak pernah bisa diunggah,
--    apa pun perannya.
--
-- 2. Bucket profile-avatars tidak punya policy SELECT. Unggahan dengan
--    upsert selalu membaca baris yang ada lebih dulu, dan tanpa policy SELECT
--    langkah itu ditolak dengan pesan yang menyesatkan, yaitu pelanggaran RLS
--    padahal policy INSERT-nya sendiri sudah benar.
--
-- Perbaikan pertama memakai jalur INSERT yang sudah dipakai bucket lain:
-- hanya folder sendiri. Perbaikan kedua membuka bacaan untuk bucket publik,
-- sesuai sifat bucket foto profil yang memang dibaca publik.

drop policy if exists inspection_photos_insert_own on storage.objects;
create policy inspection_photos_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists profile_avatars_select_public on storage.objects;
create policy profile_avatars_select_public
  on storage.objects for select
  to public
  using (bucket_id = 'profile-avatars');

update storage.buckets set public = true where id = 'profile-avatars';
