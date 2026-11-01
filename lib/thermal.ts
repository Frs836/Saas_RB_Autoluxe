/**
 * Cetak struk ke printer thermal Bluetooth memakai Web Bluetooth dan ESC/POS.
 *
 * Cakupan dukungan browser penting dan tidak bisa diabaikan:
 *   - Chrome dan Edge di Android serta desktop mendukung Web Bluetooth.
 *   - Safari di iOS maupun iPadOS tidak mendukung Web Bluetooth sama sekali.
 *   - Mode browser pribadi dan beberapa tampilan webview memblokir Bluetooth.
 *
 * Karena itu modul ini selalu mengembalikan status yang bisa ditampilkan ke
 * pengguna, bukan melempar error, dan pemanggil wajib menampilkan Dukungan
 * jaringan sebagai aksi yang disebut pengguna, bukan disembunyikan.
 */

// ---------------------------------------------------------------------------
// Konstanta ESC/POS
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const ESC_POS = {
  init: [ESC, 0x40],
  /** Memilih halaman kode karakterstandar ASCII. */
  charset: [ESC, 0x74, 0x00],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  alignRight: [ESC, 0x61, 0x02],
  boldOn: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  underlineOn: [ESC, 0x2d, 0x01],
  underlineOff: [ESC, 0x2d, 0x00],
  /** Memotong kertas. Mode 0 menghasilkan potongan penuh. */
  cutPaper: [GS, 0x56, 0x00],
  /** Membuka laci uang. Tidak semua printer punya laci, diabaikan bila gagal. */
  openDrawer: [ESC, 0x70, 0x00, 0x19, 0xfa],
} as const;

/** Lebar kertas 58 mm setara 32 kolom monospace. */
const PAPER_COLUMNS = 32;

export type BluetoothSupport = {
  supported: boolean;
  reason: string | null;
};

export function bluetoothSupport(): BluetoothSupport {
  if (typeof window === "undefined") {
    return { supported: false, reason: "Pemeriksaan dilakukan di peramban." };
  }
  if (!("bluetooth" in navigator)) {
    return {
      supported: false,
      reason:
        "Peramban ini tidak mendukung Web Bluetooth. Gunakan Chrome atau Edge di Android atau desktop. Safari di iOS tidak mendukungnya.",
    };
  }
  return { supported: true, reason: null };
}

export type PrinterInfo = {
  id: string;
  name: string;
};

type GattServer = {
  connected: boolean;
  // connect() mengembalikan objek server yang bentuknya sama, sehingga
  // tipe hasil keduanya tidak perlu dibedakan.
  connect: () => Promise<GattServer>;
  getPrimaryService: (service: string) => Promise<{
    getCharacteristic: (characteristic: string) => Promise<{
      writeValue: (data: BufferSource) => Promise<void>;
    }>;
  }>;
};

type BluetoothLike = {
  requestDevice: (options: {
    filters: { namePrefix?: string; services?: string[] }[];
    optionalServices?: string[];
  }) => Promise<{ id: string; name?: string | null; gatt?: GattServer }>;
  getDevices?: () => Promise<
    { id: string; name?: string | null; gatt?: GattServer }[]
  >;
};

function getBluetooth(): BluetoothLike {
  return (navigator as unknown as { bluetooth: BluetoothLike }).bluetooth;
}

export async function listPairedPrinters(): Promise<PrinterInfo[]> {
  const bt = getBluetooth();
  if (!bt.getDevices) return [];
  const devices = await bt.getDevices();
  return devices
    .filter((device) => (device.name ?? "").length > 0)
    .map((device) => ({ id: device.id, name: device.name ?? "Printer" }));
}

export async function requestPrinter(): Promise<PrinterInfo> {
  const device = await getBluetooth().requestDevice({
    // Filter longgar supaya printer non-SDK tetap bisa ditemukan, lalu
    // fallback ke service UUID umum printer thermal.
    filters: [],
    optionalServices: [
      "000018f0-0000-1000-8000-00805f9b34fb",
      "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    ],
  });
  return { id: device.id, name: device.name ?? "Printer thermal" };
}

async function openCharacteristic(deviceId: string) {
  const devices = (await getBluetooth().getDevices?.()) ?? [];
  const device = devices.find((item) => item.id === deviceId);

  if (!device || !device.gatt) {
    throw new Error("Printer tidak ditemukan. Hubungkan ulang printer.");
  }

  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();

  const service = await server.getPrimaryService(
    "000018f0-0000-1000-8000-00805f9b34fb",
  );
  return service.getCharacteristic("00002af1-0000-1000-8000-00805f9b34fb");
}

export type PrintResult = { ok: true } | { ok: false; message: string };

export async function printToThermalPrinter(
  deviceId: string,
  text: string,
): Promise<PrintResult> {
  try {
    const characteristic = await openCharacteristic(deviceId);
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode(text));

    // ESC/POS Bluetooth tidak punya framing transaction, jadi penulisan
    // dipecah agar tidak melebihi ukuran paket characteristic.
    const CHUNK = 180;
    for (let offset = 0; offset < bytes.length; offset += CHUNK) {
      await characteristic.writeValue(new Uint8Array(bytes.slice(offset, offset + CHUNK)));
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Gagal menghubungi printer thermal.",
    };
  }
}

// ---------------------------------------------------------------------------
// Penyusun struk
// ---------------------------------------------------------------------------

export type ReceiptLine = {
  label: string;
  value: string;
};

/** Memotong teks agar tidak melebihi lebar kertas. */
function clamp(text: string, columns = PAPER_COLUMNS): string {
  if (text.length <= columns) return text;
  return text.slice(0, Math.max(0, columns - 3)) + "...";
}

/** Baris dengan label di kiri dan nilai di kanan, memakai lebar tetap. */
function labelValue(label: string, value: string): string {
  const left = clamp(label, 16);
  const right = clamp(value, PAPER_COLUMNS - left.length - 1);
  const gap = Math.max(1, PAPER_COLUMNS - left.length - right.length);
  return `${left}${" ".repeat(gap)}${right}`;
}

/** Baris rincian item: jumlah dan nama di kiri, total diratakan kanan. */
function itemLine(name: string, quantity: number, total: string): string {
  const right = clamp(total, 11);
  const left = clamp(`${quantity}x ${name}`, PAPER_COLUMNS - right.length - 1);
  const gap = Math.max(1, PAPER_COLUMNS - left.length - right.length);
  return `${left}${" ".repeat(gap)}${right}`;
}

export type ThermalReceipt = {
  branchName: string;
  orderNumber: string;
  vehicleModel: string;
  licensePlate: string;
  customerName: string;
  items: { name: string; quantity: number; total: number }[];
  total: number;
  paymentMethod: string;
  paid: boolean;
  trackingUrl: string;
  /**
   * Nomor WhatsApp untuk saran & keluhan, format internasional tanpa "+".
   * Contoh: "6281122334455". Bila tidak diisi, baris keluhan tidak ditampilkan.
   */
  complaintWa?: string | null;
};

function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString("id-ID")}`;
}

/**
 * Membangun struk ESC/POS.
 *
 * Lebar kolom 32 mengikuti printer 58 mm yang paling umum dipakai di kios.
 * Printer 80 mm memiliki lebar lebih besar, tetapi memakai kolom 32 di sana
 * hanya membuat teks lebih rapat tanpa membuat hasil salah.
 */
export function buildThermalReceipt(receipt: ThermalReceipt): string {
  const out: string[] = [];

  const push = (bytes: readonly number[], lines: string[] = []) => {
    out.push(String.fromCharCode(...bytes), ...lines);
  };

  push(ESC_POS.init);
  push(ESC_POS.charset);
  push(ESC_POS.alignCenter, [
    "RB AUTOLUXE",
    receipt.branchName,
    "====================",
  ]);
  push(ESC_POS.alignLeft, [
    labelValue("No. Order", receipt.orderNumber),
    labelValue("Kendaraan", receipt.vehicleModel),
    labelValue("Plat", receipt.licensePlate),
    labelValue("Pelanggan", receipt.customerName),
    "",
    "--------------------",
    "RINCIAN",
  ]);

  for (const item of receipt.items) {
    push([], [itemLine(item.name, item.quantity, rupiah(item.total))]);
  }

  push([], [
    "--------------------",
    labelValue("TOTAL", rupiah(receipt.total)),
  ]);

  push(ESC_POS.boldOn, [labelValue("TOTAL BAYAR", rupiah(receipt.total))]);
  push(ESC_POS.boldOff, [
    `Pembayaran: ${receipt.paymentMethod}`,
    `Status   : ${receipt.paid ? "LUNAS" : "BELUM BAYAR"}`,
    "",
    "Terima kasih telah mempercayakan",
    "kendaraan Anda di RB AUTOLUXE.",
    "",
    "Lacak progres pengerjaan:",
    clamp(receipt.trackingUrl, PAPER_COLUMNS),
    "",
  ]);

  push(ESC_POS.alignCenter, ["", "Saran & Keluhan:", `wa.me/${receipt.complaintWa ?? "6281122334455"}`]);
  push(ESC_POS.alignLeft, ["", "", ""]);
  push(ESC_POS.cutPaper, ["", ""]);

  return out.join(`${String.fromCharCode(LF)}`);
}

// ---------------------------------------------------------------------------
// Struk pembayaran order
// ---------------------------------------------------------------------------

export type PaymentReceiptData = {
  workshopName: string;
  orderNumber: string;
  customerName: string;
  licensePlate: string;
  vehicleModel: string | null;
  servicePackage: string | null;
  totalPrice: number;
  paidAmount: number; // cumulative amount paid so far after this payment
  paymentAmount: number; // amount paid in this transaction
  paymentMethod: string;
  paymentType: 'dp' | 'pelunasan' | 'full';
  sisaPembayaran: number; // totalPrice - paidAmount
  recordedAt: string; // ISO timestamp
  note: string | null;
  cashierName: string | null;
};

export function buildPaymentReceiptText(data: PaymentReceiptData): string {
  const COL = PAPER_COLUMNS;
  function line(text: string) { return text.substring(0, COL).padEnd(COL) + '\n'; }
  function divider() { return '-'.repeat(COL) + '\n'; }
  function center(text: string) {
    const pad = Math.max(0, Math.floor((COL - text.length) / 2));
    return ' '.repeat(pad) + text.substring(0, COL) + '\n';
  }
  function row(label: string, value: string) {
    const maxLabel = COL - value.length - 1;
    return label.substring(0, maxLabel).padEnd(maxLabel) + ' ' + value + '\n';
  }
  function fRp(amount: number) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount);
  }
  function fDate(iso: string) {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(iso));
  }
  const payTypeLabel = data.paymentType === 'dp' ? 'DP / Uang Muka' : data.paymentType === 'pelunasan' ? 'Pelunasan' : 'Lunas';
  const methodLabel = data.paymentMethod === 'cash' ? 'Tunai' : data.paymentMethod === 'qris' ? 'QRIS' : 'Transfer Bank';

  let out = '';
  out += center(data.workshopName);
  out += center('NOTA PEMBAYARAN');
  out += divider();
  out += row('No. Order', data.orderNumber);
  out += row('Pelanggan', data.customerName.substring(0, 16));
  out += row('Kendaraan', data.licensePlate);
  if (data.vehicleModel) out += row('Model', data.vehicleModel.substring(0, 16));
  if (data.servicePackage) out += row('Paket', data.servicePackage.substring(0, 16));
  out += divider();
  out += row('Tipe Bayar', payTypeLabel);
  out += row('Metode', methodLabel);
  out += row('Dibayarkan', fRp(data.paymentAmount));
  out += row('Total Tagihan', fRp(data.totalPrice));
  out += row('Total Dibayar', fRp(data.paidAmount));
  if (data.sisaPembayaran > 0) {
    out += row('Sisa Tagihan', fRp(data.sisaPembayaran));
  } else {
    out += row('Status', 'LUNAS');
  }
  out += divider();
  out += row('Waktu', fDate(data.recordedAt));
  if (data.cashierName) out += row('Kasir', data.cashierName.substring(0, 16));
  if (data.note) out += line('Ket: ' + data.note.substring(0, COL - 5));
  out += divider();
  out += center('Terima kasih');
  out += center('atas kepercayaan Anda');
  out += '\n\n\n';
  return out;
}