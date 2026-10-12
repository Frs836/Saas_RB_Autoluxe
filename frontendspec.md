# Frontend Specification RB AUTOLUXE — Versi 2.0 (Production-Ready)

Dokumen ini memuat arsitektur modul frontend, struktur folder Next.js App Router, skema validasi Zod terintegrasi, custom hooks hardware, serta komponen UI untuk mendukung operasional multi-cabang RB AUTOLUXE.

---

## 1. Arsitektur Folder Next.js 14+ (App Router)

Struktur direktori diorganisasikan untuk mendukung PWA, isolasi halaman berdasarkan hak akses, serta modul operasional harian.

```text
rb-autoluxe-app/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── absensi/
│   │   │   └── page.tsx
│   │   ├── orders/
│   │   │   ├── page.tsx
│   │   │   ├── new/
│   │   │   │   └── page.tsx
│   │   │   └── [id]/
│   │   │       └── page.tsx
│   │   ├── inventory/          -- Modul Baru: Stok & Audit Bahan Baku Cabang
│   │   │   └── page.tsx
│   │   ├── shift-audit/
│   │   │   └── page.tsx
│   │   ├── petty-cash/
│   │   │   └── page.tsx
│   │   ├── warranty/
│   │   │   └── page.tsx
│   │   └── settings/
│   │       └── page.tsx
│   ├── track/
│   │   └── [token]/
│   │       └── page.tsx
│   ├── api/
│   │   └── print-template/
│   │       └── route.ts
│   ├── layout.tsx
│   ├── globals.css
│   ├── manifest.ts
│   └── sw.ts
├── components/
│   ├── ui/
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── modal.tsx
│   │   ├── badge.tsx
│   │   └── segmented-pill.tsx
│   ├── forms/
│   │   ├── inspection-photo-input.tsx
│   │   └── vehicle-size-selector.tsx
│   ├── pos/
│   │   ├── moka-grid-catalog.tsx   -- Komponen Baru: Grid Katalog POS Cepat
│   │   ├── landscape-cashier-panel.tsx
│   │   └── print-receipt-button.tsx
│   ├── attendance/
│   │   ├── face-camera-scanner.tsx
│   │   └── late-reason-modal.tsx   -- Komponen Baru: Input Alasan Terlambat (>07:30)
│   ├── inventory/
│   │   └── stock-audit-table.tsx   -- Komponen Baru: Tabel Opname & Stock In/Out
│   └── tracking/
│       └── client-progress-view.tsx
├── hooks/
│   ├── use-face-detection.ts
│   ├── use-bluetooth-printer.ts
│   ├── use-gps-location.ts
│   ├── use-image-compressor.ts
│   └── use-offline-sync.ts
├── lib/
│   ├── supabase-client.ts
│   ├── cloudinary.ts
│   ├── excel-exporter.ts
│   ├── offline-db.ts
│   └── zod-schemas.ts
├── types/
│   └── index.ts
├── public/
│   ├── icons/
│   └── models/
│       └── face_landmarker.task
├── tailwind.config.js
└── package.json

```

---

## 2. Skema Validasi Form (Zod Schemas)

Validasi input dikerjakan langsung di sisi klien sebelum data dikirim ke API atau Server Actions.

```typescript
// lib/zod-schemas.ts
import { z } from 'zod';

export const CreateOrderSchema = z.object({
  branch_id: z.string().uuid('ID Cabang wajib diisi'),
  license_plate: z
    .string()
    .min(3, 'Plat nomor minimal 3 karakter')
    .max(15, 'Plat nomor maksimal 15 karakter')
    .transform((val) => val.toUpperCase().trim()),
  vehicle_category: z.enum(['size_s', 'size_m', 'size_l', 'size_xl', 'motor']),
  vehicle_model: z.string().min(2, 'Model kendaraan wajib diisi'),
  client_name: z.string().min(2, 'Nama klien wajib diisi'),
  client_phone: z
    .string()
    .min(10, 'Nomor HP minimal 10 digit')
    .regex(/^08[0-9]+$/, 'Format nomor HP harus diawali 08'),
  items: z
    .array(
      z.object({
        service_id: z.string().optional(),
        package_id: z.string().optional(),
        item_name: z.string(),
        price: z.number().positive('Harga harus lebih dari 0')
      })
    )
    .min(1, 'Pilih minimal satu layanan'),
  payment_method: z.enum(['cash', 'qris', 'bank_transfer']),
  is_shift_pagi: z.boolean().default(false),
  team_members: z
    .array(z.string().uuid())
    .min(1, 'Pilih minimal 1 karyawan')
    .max(5, 'Maksimal 5 karyawan per order')
});

export const AttendanceCheckInSchema = z.object({
  user_id: z.string().uuid(),
  branch_id: z.string().uuid(),
  latitude: z.number(),
  longitude: z.number(),
  photo_url: z.string().url(),
  is_late: z.boolean(),
  late_minutes: z.number().min(0),
  late_reason: z.string().optional()
});

export const InventoryStockLogSchema = z.object({
  branch_id: z.string().uuid(),
  item_id: z.string().uuid(),
  log_type: z.enum(['in', 'out']),
  quantity: z.number().positive('Jumlah stok harus lebih dari 0')
});

export const TimeOffRequestSchema = z.object({
  type: z.enum(['izin', 'cuti', 'sakit']),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(5, 'Alasan wajib diisi'),
  proof_photo_url: z.string().url('Foto bukti wajib diunggah')
});

export const InspectionPhotoSchema = z.object({
  order_id: z.string().uuid(),
  stage: z.enum(['before', 'process', 'after']),
  photo_file: z.custom<File>((val) => val instanceof File, 'File foto wajib diunggah'),
  mandatory_note: z
    .string()
    .min(5, 'Catatan kondisi wajib diisi minimal 5 karakter')
});

export const ShiftHandoffSchema = z.object({
  employee_id: z.string().uuid(),
  physical_cash_received: z.number().min(0, 'Nominal tidak boleh negatif'),
  notes: z.string().optional()
});

```

---

## 3. Implementasi Custom Hooks Hardware & MediaPipe

### 3.1 MediaPipe Face Landmarker (`hooks/use-face-detection.ts`)



```typescript
import { useState, useEffect } from 'react';
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

export function useFaceDetection() {
  const [landmarker, setLandmarker] = useState<FaceLandmarker | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function initMediaPipe() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );
      const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/face_landmarker.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numFaces: 1
      });
      setLandmarker(faceLandmarker);
      setIsReady(true);
    }
    initMediaPipe();
  }, []);

  const extractVector = (videoElement: HTMLVideoElement): number[] | null => {
    if (!landmarker) return null;
    const results = landmarker.detectForVideo(videoElement, Date.now());
    if (results.faceLandmarks.length === 0) return null;

    const landmarks = results.faceLandmarks[0];
    const vector: number[] = [];
    landmarks.slice(0, 42).forEach((pt) => {
      vector.push(pt.x, pt.y, pt.z);
    });
    return vector;
  };

  return { isReady, extractVector };
}

```

### 3.2 Web Bluetooth Thermal Printer ESC/POS (`hooks/use-bluetooth-printer.ts`)



```typescript
import { useState } from 'react';

export function useBluetoothPrinter() {
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  const connectAndPrint = async (receiptText: string) => {
    setIsPrinting(true);
    try {
      let activeDevice = device;
      if (!activeDevice || !activeDevice.gatt?.connected) {
        activeDevice = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
        });
        setDevice(activeDevice);
      }

      const server = await activeDevice.gatt?.connect();
      const service = await server?.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      const characteristic = await service?.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

      const initCommand = new Uint8Array([0x1b, 0x40]);
      const alignCenter = new Uint8Array([0x1b, 0x61, 0x01]);
      const encoder = new TextEncoder();
      const bodyText = encoder.encode(receiptText);
      const cutPaper = new Uint8Array([0x1d, 0x56, 0x41, 0x03]);

      await characteristic?.writeValue(initCommand);
      await characteristic?.writeValue(alignCenter);
      await characteristic?.writeValue(bodyText);
      await characteristic?.writeValue(cutPaper);
    } catch (error) {
      console.error('Gagal mencetak struk:', error);
    } finally {
      setIsPrinting(false);
    }
  };

  return { connectAndPrint, isPrinting };
}

```

### 3.3 Client Image Compressor (`hooks/use-image-compressor.ts`)



```typescript
import imageCompression from 'browser-image-compression';

export function useImageCompressor() {
  const compressPhoto = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 0.1, // Target < 100 KB
      maxWidthOrHeight: 1080,
      useWebWorker: true,
      fileType: 'image/webp'
    };
    try {
      return await imageCompression(file, options);
    } catch (error) {
      console.error('Gagal kompresi foto:', error);
      return file;
    }
  };
  return { compressPhoto };
}

```

---

## 4. Matriks Antarmuka Pengguna & Komponen Interaktif

* Layout Mobile Portrait (Operasional Karyawan): Dioptimalkan untuk absensi selfie, validasi jam operasional 07:30 WIB, form alasan terlambat jika check-in melewati batas waktu, serta upload foto inspeksi SOP.


* Layout Tablet Landscape (POS Moka-Style & Admin): Menampilkan katalog grid visual di sisi kiri dan ringkasan keranjang/pembayaran di sisi kanan, terintegrasi langsung dengan pemotongan stok inventaris cabang otomatis.


* Layout Public Tracking Klien: Diakses via URL unik `/track/[token]` untuk memantau status pengerjaan secara real-time.


* **Komponen Manajemen Inventaris & Stok Cabang:** Tabel opname fisik, tombol input *Stock In* dari supplier, dan peringatan *min_stock_alert*.

---

## 5. Konfigurasi Progressive Web App (PWA)



```typescript
// app/manifest.ts
import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'RB AUTOLUXE POS & Multi-Branch Operational',
    short_name: 'RB AUTOLUXE',
    description: 'Sistem Manajemen Operasional Multi-Cabang dan POS RB AUTOLUXE',
    start_url: '/',
    display: 'standalone',
    background_color: '#F2F5F8',
    theme_color: '#077A7D',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png'
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png'
      }
    ]
  };
}

```

