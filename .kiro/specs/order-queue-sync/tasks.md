# Implementation Plan: Order Queue Sync Bug Fix

## Overview

Fix tiga root cause independen yang menyebabkan halaman `/pos/orders` tidak menampilkan order baru: koreksi parameter RPC `p_branch_id`, penambahan realtime subscription di `OrderQueue`, dan pembuatan server action `createPosOrder` dengan `revalidatePath`.

## Tasks

- [x] 1. Fix parameter p_branch_id di OrderQueuePage
  - [x] 1.1 Ganti `branchId ?? undefined` menjadi `branchId ?? null` di `app/pos/orders/page.tsx`
    - Ubah satu baris pada pemanggilan RPC `get_order_queue_with_team` agar `p_branch_id` selalu mendapat nilai eksplisit (`null` atau UUID string), bukan `undefined` yang dilewatkan Supabase client
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.2 Tulis property test untuk Property 1
    - **Property 1: Parameter p_branch_id tidak pernah undefined**
    - Untuk setiap nilai `branchId` (null atau arbitrary string), `branchId ?? null` tidak pernah menghasilkan `undefined`
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 2. Tambah realtime subscription di OrderQueue
  - [x] 2.1 Tambah `useEffect` realtime channel ke `components/pos/order-queue.tsx`
    - Buat Supabase realtime channel `"order-queue-changes"` yang memantau event `INSERT` dan `UPDATE` pada tabel `orders` di schema `public`
    - Setiap event memanggil `router.refresh()`
    - Cleanup function `useEffect` memanggil `channel.unsubscribe()` untuk mencegah memory leak
    - Dependency array `[router]` agar effect hanya berjalan sekali saat mount
    - Konsisten dengan pola yang ada di `components/notification-bell.tsx`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 2.2 Tulis property test untuk Property 2
    - **Property 2: Setiap event INSERT atau UPDATE memicu refresh**
    - Untuk setiap event object dengan `eventType` "INSERT" atau "UPDATE", callback realtime selalu memanggil `router.refresh()` tepat satu kali
    - **Validates: Requirements 2.2, 2.3**

  - [ ]* 2.3 Tulis unit test untuk cleanup unsubscribe
    - Verifikasi `channel.unsubscribe()` dipanggil saat `OrderQueue` di-unmount
    - _Requirements: 2.4_

- [x] 3. Checkpoint — Pastikan semua perubahan di tasks 1 dan 2 tidak ada TypeScript error
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Buat server action createPosOrder
  - [x] 4.1 Buat file `app/actions/pos.ts` dengan server action `createPosOrder`
    - Tandai file dengan `"use server"`
    - Definisikan type `CreateOrderParams` dan `CreateOrderResult`
    - Panggil `supabase.rpc("create_pos_order_with_hold", params)` dari server menggunakan `createClient` dari `@/lib/supabase/server`
    - Kembalikan `{ ok: false, message }` jika RPC gagal — jangan panggil `revalidatePath`
    - Kembalikan `{ ok: false, message: "Order tidak dapat dibuat." }` jika `order_number` tidak ada di hasil
    - Panggil `revalidatePath('/pos/orders')` hanya setelah RPC berhasil dan `order_number` valid
    - Kembalikan `{ ok: true, data: order }`
    - _Requirements: 3.1, 3.3_

  - [ ]* 4.2 Tulis property test untuk Property 3
    - **Property 3: revalidatePath dipanggil jika dan hanya jika order berhasil dibuat**
    - Untuk setiap set parameter, `revalidatePath('/pos/orders')` dipanggil jika dan hanya jika RPC berhasil dan mengembalikan `order_number` yang valid
    - **Validates: Requirements 3.1, 3.3**

  - [ ]* 4.3 Tulis unit test untuk createPosOrder
    - Test: RPC gagal → kembalikan `{ ok: false }` dan `revalidatePath` tidak dipanggil
    - Test: RPC berhasil tanpa `order_number` → kembalikan `{ ok: false }` dan `revalidatePath` tidak dipanggil
    - Test: RPC berhasil dengan `order_number` valid → kembalikan `{ ok: true }` dan `revalidatePath` dipanggil dengan `'/pos/orders'`
    - _Requirements: 3.1, 3.3_

- [x] 5. Ganti direct RPC call di PosConsole dengan server action
  - [x] 5.1 Modifikasi `components/pos/pos-console.tsx` untuk menggunakan `createPosOrder`
    - Hapus import `createClient` dari `@/lib/supabase/client` jika tidak digunakan di tempat lain
    - Tambah import `createPosOrder` dari `@/app/actions/pos`
    - Ganti pemanggilan `supabase.rpc("create_pos_order_with_hold", ...)` dengan `createPosOrder({ ...params })`
    - Ganti pengecekan error dari `if (createError)` ke `if (!result.ok)`
    - Ambil data order dari `result.data` alih-alih dari `orderRow`
    - Pertahankan `router.refresh()` di akhir `submitOrder()` untuk merefresh `/pos`
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. Checkpoint final — Pastikan semua test pass dan tidak ada TypeScript error
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks bertanda `*` bersifat opsional dan bisa dilewati untuk MVP
- Task 1.1 adalah satu baris perubahan — paling cepat dan paling aman dimerge lebih dulu
- Task 4.1 harus selesai sebelum task 5.1 karena `pos-console.tsx` mengimpor dari `app/actions/pos.ts`
- `router.refresh()` di `PosConsole` (task 5.1) dipertahankan — ini merefresh `/pos`, bukan `/pos/orders`
- Realtime subscription (task 2.1) dan `revalidatePath` (task 4.1) saling melengkapi: realtime untuk tab yang sudah terbuka, `revalidatePath` untuk tab baru yang membuka halaman pertama kali

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "5.1"] }
  ]
}
```
