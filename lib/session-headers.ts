/**
 * Nama header yang dipakai proxy untuk meneruskan identitas hasil verifikasi
 * ke halaman server pada permintaan yang sama.
 *
 * Dipisah dari modul proxy supaya halaman tidak perlu mengimpor kode proxy
 * hanya untuk membaca dua nama header.
 */
export const USER_ID_HEADER = "x-rb-user-id";
export const USER_EMAIL_HEADER = "x-rb-user-email";
