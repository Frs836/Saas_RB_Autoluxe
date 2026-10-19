-- Bucket tidak terbaca oleh peramban, sehingga unggahan ke bucket publik gagal.
--
-- storage.buckets punya RLS aktif, tetapi tidak punya satu pun policy select.
-- Akibatnya akun yang sudah masuk tidak dapat membaca baris bucket sama
-- sekali. API Storage membutuhkan baris bucket untuk memastikan bucket itu
-- publik sebelum menerima unggahan, dan saat baris itu tidak terlihat,
-- permintaan ditolak dengan pesan yang sama dengan pelanggaran RLS biasa:
-- "new row violates row-level security policy".
--
-- Gejalanya: unggahan ke bucket privat berhasil, unggahan ke bucket publik
-- selalu ditolak. Buck privat: attendance-photos, cash-proofs,
-- timeoff-proofs. Buck publik: inspection-photos dan profile-avatars.
--
-- Jadi ini bukan hanya masalah foto profil. Foto inspeksi order juga gagal
-- diunggah untuk semua peran sejak bucket publik pertama dibuat.
--
-- Policy ini hanya membuka metadata bucket, yaitu id, nama, batas ukuran,
-- dan jenis berkas yang diizinkan. Isi berkas tetap governed oleh policy
-- di storage.objects.

drop policy if exists read_bucket_metadata on storage.buckets;
create policy read_bucket_metadata
  on storage.buckets for select
  to authenticated, anon
  using (true);

drop policy if exists tmp_probe_avatars on storage.objects;
