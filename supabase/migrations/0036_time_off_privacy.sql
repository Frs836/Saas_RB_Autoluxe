-- 0036_time_off_privacy.sql
--
-- Setiap orang bisa melihat pengajuan izin, cuti, dan sakit orang lain.
--
-- Staf yang pengajuannya disetujui akan melihat jawabannya, dan begitu juga
-- yang pengajuannya ditolak. Karena daftar ditampilkan apa adanya, setiap
-- orang bisa membandingkan miliknya dengan milik rekannya di sebelahnya.
--
-- Risikonya bukan hanya soal rasa tidak enak. Dari daftar itu bisa disimpulkan
-- siapa yang sedang sakit, siapa yang cuti, dan siapa yang baru pulang.
-- Informasi kesehatan seperti itu bercampur dengan data absensi dan bisa
-- dibicarakan tanpa disengaja.
--
-- Aturannya jadi begini:
--   karyawan   hanya pengajuannya sendiri
--   admin kasir hanya pengajuannya sendiri
--   owner       semua, dengan saringan perlu ditinjau dan semua
--   maintainer  semua, dengan saringan perlu ditinjau dan semua
--
-- Yang diubah hanya hak baca. Hak memutuskan tetap milik owner dan
-- maintainer, dan pengajuan sendiri masih bisa dibatalkan sendiri selama
-- masih berstatus menunggu.

DROP POLICY IF EXISTS time_off_select_own_or_privileged ON public.time_off_requests;

CREATE POLICY time_off_select_own_or_privileged
  ON public.time_off_requests
  FOR SELECT
  TO authenticated
  USING (
    profile_id = (SELECT public.current_profile_id())
    OR COALESCE(
      (SELECT public.has_role(
        ARRAY['owner', 'maintainer']::public.user_role[]
      )),
      false
    )
  );

COMMENT ON POLICY time_off_select_own_or_privileged ON public.time_off_requests IS
  'Setiap orang hanya membaca pengajuannya sendiri. Daftar lengkap hanya untuk owner dan maintainer.';
