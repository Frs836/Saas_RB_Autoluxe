-- Bucket publik tanpa policy SELECT menolak unggahan dengan upsert.
--
-- Unggahan dengan upsert membaca baris yang ada lebih dulu. Tanpa policy
-- SELECT, langkah itu ditolak dan API melaporkan pelanggaran RLS, padahal
-- policy INSERT-nya sendiri sudah benar. Gejalanya sama persis dengan
-- policy INSERT yang salah, jadi mudah salah diagnosa.
--
-- Bucket privat punya policy select_scoped sendiri, jadi tidak kena masalah
-- ini. Hanya bucket publik yang belum memilikinya: inspection-photos dan
-- profile-avatars.

drop policy if exists inspection_photos_select_public on storage.objects;
create policy inspection_photos_select_public
  on storage.objects for select
  to public
  using (bucket_id = 'inspection-photos');
