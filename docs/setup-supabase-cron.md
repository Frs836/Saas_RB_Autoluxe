# Setup Supabase pg_cron untuk Attendance Notification

## Cara Apply

1. Buka **Supabase Dashboard** → project `qidtfssldidzvehssevk`
2. Klik menu **SQL Editor**
3. Jalankan migration `0112` lalu `0113` secara berurutan:

### Migration 0112 — Setup pg_cron job
Salin & paste isi file `supabase/migrations/0112_setup_pgcron_attendance.sql` → klik **Run**

### Migration 0113 — Set app settings
Salin & paste isi file `supabase/migrations/0113_app_settings_cron.sql` → klik **Run**

---

## Setup Environment Variable di Vercel

Di Vercel Dashboard → **Environment Variables**, tambahkan:

| Key | Value |
|-----|-------|
| `CRON_SECRET` | `93678cf1dd0b898151035ac15321d03e5de70f6a60c37667b2e51d86e79d1b8e` |

---

## Verifikasi

Setelah apply, cek di SQL Editor:
```sql
select * from cron.job where jobname = 'attendance-check';
```

Harus muncul satu row dengan schedule `* * * * *`.

Untuk melihat log eksekusi:
```sql
select * from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'attendance-check')
order by start_time desc
limit 20;
```

---

## Cara Kerja

```
Supabase pg_cron (setiap menit)
  → memanggil fungsi SQL cron_attendance_check()
    → net.http_post() ke https://rb-autoluxe.vercel.app/api/cron/attendance-check
      → Next.js route handler
        → cek karyawan belum absen
        → cek 5 menit sebelum jam pulang
        → kirim push notification ke device
```

## Troubleshooting

- Jika `net.http_post` tidak tersedia: aktifkan extension `pg_net` di Supabase Dashboard → **Extensions**
- Jika `cron.schedule` tidak tersedia: aktifkan extension `pg_cron` di **Extensions**
- Pastikan URL di `0113` sudah sesuai dengan domain Vercel production
