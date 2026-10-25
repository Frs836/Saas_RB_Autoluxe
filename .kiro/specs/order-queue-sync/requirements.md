# Requirements Document

## Introduction

Halaman antrian order (`/pos/orders`) tidak menampilkan order baru yang baru saja dibuat dari POS, walaupun order tersebut sudah muncul di highlight card pada dashboard. Masalah ini disebabkan oleh tiga root cause yang saling berdiri sendiri: parameter `p_branch_id` yang di-skip oleh Supabase karena nilainya `undefined`, tidak adanya realtime subscription di komponen antrian, dan `router.refresh()` pasca-pembuatan order yang hanya merefresh halaman `/pos` bukan `/pos/orders`. Fix mencakup koreksi parameter RPC, penambahan realtime subscription di `order-queue.tsx`, dan `revalidatePath('/pos/orders')` dari server action setelah order dibuat.

## Glossary

- **OrderQueuePage**: Server component di `app/pos/orders/page.tsx` yang mengambil data antrian dan merender `OrderQueue`.
- **OrderQueue**: Client component di `components/pos/order-queue.tsx` yang menampilkan daftar kartu order dan menerima `initialOrders` sebagai props dari `OrderQueuePage`.
- **RPC get_order_queue_with_team**: Fungsi PostgreSQL `SECURITY DEFINER` yang memfilter order berdasarkan `p_branch_id`. Ketika parameter ini `NULL`, fungsi mengembalikan order dari semua cabang; ketika diisi UUID, hanya order cabang tersebut.
- **PosConsole**: Client component di `components/pos/pos-console.tsx` yang menangani pembuatan order baru dari halaman `/pos`.
- **Realtime Subscription**: Koneksi WebSocket ke Supabase yang memantau perubahan baris pada tabel `orders` via `postgres_changes`.
- **branchId**: UUID cabang yang di-scope dari sesi pengguna. Bernilai `null` untuk peran super-admin yang melihat seluruh cabang, atau UUID untuk peran yang dibatasi ke satu cabang.

## Requirements

### Requirement 1: Koreksi Parameter RPC p_branch_id

**User Story:** As a kasir or manager, I want the order queue page to display orders from the correct branch, so that I can monitor all new orders as soon as they are created.

#### Acceptance Criteria

1. WHEN `branchId` bernilai `null`, THE `OrderQueuePage` SHALL memanggil RPC `get_order_queue_with_team` dengan `p_branch_id: null` sehingga fungsi menerima parameter eksplisit dan mengembalikan order dari seluruh cabang.
2. WHEN `branchId` bernilai UUID string, THE `OrderQueuePage` SHALL memanggil RPC `get_order_queue_with_team` dengan `p_branch_id` berisi UUID tersebut sehingga fungsi memfilter order hanya untuk cabang yang bersangkutan.
3. THE `OrderQueuePage` SHALL tidak menggunakan ekspresi `branchId ?? undefined` sebagai nilai `p_branch_id`, karena nilai `undefined` menyebabkan Supabase client melewati parameter tersebut dan RPC tidak menerima filter cabang yang valid.

### Requirement 2: Realtime Subscription di OrderQueue

**User Story:** As a staff member viewing the order queue, I want the queue to automatically update when a new order is created, so that I do not need to manually refresh the page.

#### Acceptance Criteria

1. WHEN `OrderQueue` dipasang (mounted) di browser, THE `OrderQueue` SHALL membuat satu Supabase realtime channel yang memantau event `INSERT` dan `UPDATE` pada tabel `orders` di schema `public`.
2. WHEN event `INSERT` diterima dari channel `orders`, THE `OrderQueue` SHALL memanggil `router.refresh()` untuk memicu re-fetch data server component `OrderQueuePage`.
3. WHEN event `UPDATE` diterima dari channel `orders`, THE `OrderQueue` SHALL memanggil `router.refresh()` untuk memperbarui status order yang sudah ada di antrian.
4. WHEN `OrderQueue` dilepas (unmounted) dari DOM, THE `OrderQueue` SHALL memanggil `unsubscribe()` pada channel realtime yang telah dibuat untuk mencegah memory leak dan koneksi ganda.
5. THE `OrderQueue` SHALL menggunakan pola `useEffect` dengan cleanup function yang memanggil `channel.unsubscribe()`, konsisten dengan pola yang sudah ada di `NotificationBell`.

### Requirement 3: Invalidasi Cache Server Component Setelah Order Dibuat

**User Story:** As a cashier who just created a new order, I want the order queue page to reflect the new order immediately when another user opens it, so that all staff see the same up-to-date queue.

#### Acceptance Criteria

1. WHEN server action pembuatan order berhasil menyimpan data ke database, THE server action SHALL memanggil `revalidatePath('/pos/orders')` untuk menghapus cache Next.js App Router pada halaman antrian.
2. WHEN `PosConsole` memanggil `router.refresh()` setelah order berhasil dibuat, THE `PosConsole` SHALL tetap memanggil `router.refresh()` pada halaman `/pos` yang sudah ada, tanpa menghapus pemanggilan tersebut.
3. IF server action pembuatan order gagal, THEN THE server action SHALL tidak memanggil `revalidatePath('/pos/orders')` sehingga cache yang valid tidak dihapus tanpa alasan.
