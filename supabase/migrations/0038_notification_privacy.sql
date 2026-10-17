-- 0038_notification_privacy.sql
--
-- Notifikasi bocor ke role istimewa.
--
-- Policy notifications_select_own masih berbunyi:
--
--   recipient_id = current_profile_id()
--   OR has_role(['owner','admin_kasir','maintainer'])
--
-- Klausa OR itu membuat owner, admin kasir, dan maintainer membaca SELURUH
-- baris notifications, bukan hanya miliknya. Akibatnya lonceng notifikasi
-- menghitung pesan orang lain, dan halaman /notifikasi menampilkan pesan
-- pribadi staf lain ("Wajah Anda disetujui", pengajuan cuti rekan) seolah
-- milik sendiri. Yang tampak seperti notifikasi ganda sebenarnya pesan
-- milik penerima yang berbeda.
--
-- 0036 sudah menutup kebocoran serupa di time_off_requests. Ini menutup yang
-- tertinggal di notifications.
--
-- Notifikasi bersifat pribadi: halaman /notifikasi dan lonceng hanya membaca
-- milik pengguna, penandaan dibaca juga hanya untuk baris sendiri. Pengawasan
-- izin tetap lewat halaman /izin (time_off_requests), bukan lewat notifikasi.
--
-- Idempoten: aman dijalankan berulang kali.

DROP POLICY IF EXISTS notifications_select_own ON public.notifications;

CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated
  USING (recipient_id = (SELECT public.current_profile_id()));

COMMENT ON POLICY notifications_select_own ON public.notifications IS
  'Setiap pengguna hanya membaca notifikasi miliknya sendiri.';
