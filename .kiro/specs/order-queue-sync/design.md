# Design Document

## Overview

Bug fix untuk tiga root cause independen yang menyebabkan halaman antrian order (`/pos/orders`) tidak menampilkan order baru:

1. **Parameter `undefined` pada RPC** — `branchId ?? undefined` menyebabkan Supabase client melewatkan parameter `p_branch_id` sepenuhnya, sehingga fungsi PostgreSQL tidak menerima filter cabang yang valid.
2. **Tidak ada realtime subscription** — `OrderQueue` tidak memantau perubahan tabel `orders`, jadi tampilan tidak pernah update kecuali halaman di-refresh manual.
3. **Cache tidak diinvalidasi** — `create_pos_order_with_hold` dipanggil langsung dari client component (`PosConsole`), sehingga tidak ada kesempatan memanggil `revalidatePath('/pos/orders')` dari server.

Ketiga fix ini berdiri sendiri dan bisa di-deploy secara terpisah, tapi paling efektif bila dilakukan bersama.

## Architecture

```
Browser (Tab /pos)                    Browser (Tab /pos/orders)
┌─────────────────────────┐           ┌──────────────────────────────────┐
│  PosConsole             │           │  OrderQueuePage (Server Component)│
│  ┌───────────────────┐  │           │  └── OrderQueue (Client Component)│
│  │ submitOrder()     │  │           │       ├── initialOrders props      │
│  │  ├─ supabase.rpc( │  │           │       └── useEffect: realtime sub  │
│  │  │  create_pos_   │  │           │            ├─ INSERT → refresh()   │
│  │  │  order_with_   │  │           │            └─ UPDATE → refresh()   │
│  │  │  hold)         │  │           └──────────────────────────────────┘
│  │  └─ createPosOrder│  │                          ▲
│  │     (server action│  │           Supabase       │ postgres_changes
│  │     baru)         │  │           Realtime ───────┘
│  │     ├─ revalidate │  │
│  │     │  Path(...)  │  │           ┌──────────────────────────────────┐
│  │     └─ router     │  │           │  Supabase DB                      │
│  │        .refresh() │  │           │  Table: orders                    │
│  └───────────────────┘  │           │  Function: get_order_queue_with_  │
└─────────────────────────┘           │  team(p_branch_id := NULL | UUID) │
                                      └──────────────────────────────────┘
```

## Components and Interfaces

### Fix 1: `app/pos/orders/page.tsx`

Satu baris perubahan pada baris 28:

```typescript
// SEBELUM (bug)
p_branch_id: branchId ?? undefined,

// SESUDAH (fix)
p_branch_id: branchId ?? null,
```

**Kenapa ini penting:** Supabase JS client menggunakan `JSON.stringify` untuk membangun body request. Nilai `undefined` dihilangkan dari JSON object, sehingga parameter `p_branch_id` tidak terkirim ke PostgreSQL sama sekali. Nilai `null` dikirim sebagai `null` dalam JSON dan diterima PostgreSQL sebagai `NULL`, yang merupakan perilaku yang diinginkan untuk super-admin yang melihat seluruh cabang.

### Fix 2: `components/pos/order-queue.tsx`

Tambah `useEffect` dengan Supabase realtime channel. Konsisten dengan pola yang sudah ada di `notification-bell.tsx`:

```typescript
// Di dalam komponen OrderQueue, setelah deklarasi state yang sudah ada:
useEffect(() => {
  const supabase = createClient();
  const channel = supabase
    .channel("order-queue-changes")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "orders" },
      () => router.refresh(),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "orders" },
      () => router.refresh(),
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
}, [router]);
```

**Dependency array:** `[router]` — `router` dari `useRouter()` adalah objek stabil yang tidak berubah antar render, sehingga effect hanya berjalan sekali saat mount dan dibersihkan saat unmount.

**Kenapa hanya INSERT dan UPDATE:** Event `DELETE` tidak relevan untuk antrian (order tidak dihapus dari database, hanya diubah statusnya ke `cancelled`). Menghindari refresh yang tidak perlu.

### Fix 3: `app/actions/pos.ts` (file baru)

Bungkus pemanggilan RPC `create_pos_order_with_hold` dalam server action baru. `PosConsole` akan memanggil server action ini alih-alih memanggil Supabase RPC secara langsung.

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type CreateOrderParams = {
  p_license_plate: string;
  p_vehicle_model: string;
  p_vehicle_size: string;
  p_customer_name: string;
  p_customer_phone: string;
  p_service_package: string;
  p_items: Array<{ service_id: string; name: string; price: number; qty: number }>;
  p_payment_method: "cash" | "qris" | "bank_transfer";
  p_payment_state: "paid" | "unpaid";
  p_start_work: boolean;
  p_team_ids: string[];
};

type CreateOrderResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; message: string };

export async function createPosOrder(
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  const supabase = await createClient();

  const { data: orderRow, error: createError } = await supabase.rpc(
    "create_pos_order_with_hold",
    params,
  );

  if (createError) {
    return { ok: false, message: createError.message };
  }

  const order = Array.isArray(orderRow) ? orderRow[0] : orderRow;
  if (!order || !order.order_number) {
    return { ok: false, message: "Order tidak dapat dibuat." };
  }

  // Hanya invalidasi cache setelah order berhasil disimpan.
  revalidatePath("/pos/orders");

  return { ok: true, data: order as Record<string, unknown> };
}
```

**Alternatif yang tidak dipilih:**
- **(a) Route handler `/api/orders/revalidate`:** Memerlukan HTTP round-trip tambahan dari client, lebih kompleks, dan tidak ada keuntungan dibanding server action.
- **(b) Hanya mengandalkan `router.refresh()` + realtime:** `router.refresh()` di `PosConsole` merefresh cache untuk `/pos`, bukan `/pos/orders`. Tab lain yang sudah membuka `/pos/orders` akan ter-update via realtime, tetapi tab baru yang membuka halaman itu pertama kali masih bisa menerima data cache lama sampai realtime trigger terjadi. `revalidatePath` memastikan data selalu fresh.

### Modifikasi `components/pos/pos-console.tsx`

Ganti pemanggilan `supabase.rpc("create_pos_order_with_hold", ...)` dengan pemanggilan ke server action `createPosOrder`:

```typescript
// SEBELUM
import { createClient } from "@/lib/supabase/client";
// ...
const supabase = createClient();
const { data: orderRow, error: createError } = await supabase.rpc(
  "create_pos_order_with_hold",
  { /* params */ },
);
if (createError) throw new Error(createError.message);

// SESUDAH
import { createPosOrder } from "@/app/actions/pos";
// ...
const result = await createPosOrder({ /* params */ });
if (!result.ok) throw new Error(result.message);
const order = result.data;
```

`router.refresh()` di akhir `submitOrder()` tetap dipertahankan — ini merefresh `/pos` untuk memperbarui highlight card di dashboard POS.

## Data Models

Tidak ada perubahan pada skema database. Fix ini murni di layer aplikasi.

**Alur data setelah fix:**

```
submitOrder() di PosConsole
  → createPosOrder() [server action]
    → supabase.rpc("create_pos_order_with_hold")
      → INSERT ke tabel orders di Supabase
        → Supabase Realtime broadcast ke semua subscriber
          → OrderQueue.useEffect callback: router.refresh()
            → OrderQueuePage re-fetch: get_order_queue_with_team(p_branch_id := null | UUID)
    → revalidatePath('/pos/orders')  [invalidasi cache untuk visitor baru]
  → router.refresh() [update /pos dashboard]
```

## Error Handling

| Skenario | Penanganan |
|---|---|
| RPC `create_pos_order_with_hold` gagal | Server action mengembalikan `{ ok: false, message }`. `PosConsole` menampilkan pesan error. `revalidatePath` **tidak** dipanggil. |
| Realtime channel gagal connect | `router.refresh()` tidak dipanggil dari realtime, tapi data masih bisa diperbarui manual atau via navigasi. Tidak ada crash. |
| `unsubscribe()` pada unmount | Cleanup function `useEffect` selalu dipanggil, mencegah memory leak dan duplikasi koneksi WebSocket. |
| `branchId` adalah `undefined` (kasus sebelum fix) | Setelah fix, `scopedBranchId()` mengembalikan `null` untuk super-admin, dan ekspresi `branchId ?? null` menghasilkan `null`. Nilai `undefined` tidak pernah muncul. |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Parameter p_branch_id tidak pernah undefined

*For any* nilai `branchId` yang mungkin dikembalikan oleh `scopedBranchId()` (yaitu `null` atau UUID string), ekspresi `branchId ?? null` yang digunakan sebagai `p_branch_id` SHALL selalu menghasilkan nilai yang bukan `undefined`, sehingga Supabase client selalu mengirimkan parameter tersebut ke PostgreSQL.

**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Setiap event INSERT atau UPDATE memicu refresh

*For any* event `postgres_changes` dengan tipe `INSERT` atau `UPDATE` pada tabel `orders` yang diterima oleh realtime channel, komponen `OrderQueue` SHALL memanggil `router.refresh()` tepat satu kali per event, tanpa memperhatikan isi payload event tersebut.

**Validates: Requirements 2.2, 2.3**

### Property 3: revalidatePath dipanggil jika dan hanya jika order berhasil dibuat

*For any* set parameter order yang dikirim ke server action `createPosOrder`, `revalidatePath('/pos/orders')` SHALL dipanggil jika dan hanya jika RPC `create_pos_order_with_hold` berhasil dan mengembalikan `order_number` yang valid. Jika RPC gagal, `revalidatePath` SHALL tidak dipanggil.

**Validates: Requirements 3.1, 3.3**

## Testing Strategy

**Unit tests (example-based):**
- `branchId ?? null` untuk semua kemungkinan input (`null`, UUID string) tidak pernah menghasilkan `undefined`
- `createPosOrder` mengembalikan `{ ok: false }` dan tidak memanggil `revalidatePath` ketika RPC gagal
- `createPosOrder` memanggil `revalidatePath('/pos/orders')` setelah RPC berhasil
- `channel.unsubscribe()` dipanggil saat `OrderQueue` di-unmount

**Property-based tests:**
- Property 1: Untuk setiap nilai `branchId` (null atau arbitrary string), `branchId ?? null` tidak pernah `undefined`
- Property 2: Untuk setiap event object dengan `eventType` "INSERT" atau "UPDATE", callback realtime selalu memanggil `router.refresh()`
- Property 3: Untuk setiap set parameter order, `revalidatePath` dipanggil jika dan hanya jika RPC berhasil

**Integration/manual verification:**
- Buat order dari `/pos`, buka `/pos/orders` di tab terpisah — kartu baru muncul tanpa refresh manual
- Login sebagai super-admin (branchId null) — antrian menampilkan order dari seluruh cabang
- Login sebagai staff satu cabang (branchId UUID) — antrian hanya menampilkan order cabang tersebut
