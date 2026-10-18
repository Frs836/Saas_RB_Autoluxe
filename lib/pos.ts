export type VehicleSize =
  | "S"
  | "M"
  | "L"
  | "XL"
  | "Motor"
  | "Motor S"
  | "Motor M"
  | "Motor L"
  | "Motor XL";

export type VehicleType = "mobil" | "motor";

export const MOBIL_SIZES: VehicleSize[] = ["S", "M", "L", "XL"];

// Motor juga dipecah per ukuran, mengikuti label enum yang sama dengan database.
export const MOTOR_SIZES: VehicleSize[] = [
  "Motor S",
  "Motor M",
  "Motor L",
  "Motor XL",
];

export const VEHICLE_TYPES: { value: VehicleType; label: string; icon: string }[] =
  [
    { value: "mobil", label: "Mobil", icon: "directions_car" },
    { value: "motor", label: "Motor", icon: "two_wheeler" },
  ];

export type PosService = {
  id: string;
  name: string;
  category: string;
  price_s: number;
  price_m: number;
  price_l: number;
  price_xl: number;
  price_motor: number;
  price_motor_s: number;
  price_motor_m: number;
  price_motor_l: number;
  price_motor_xl: number;
  is_addon: boolean;
};

const PRICE_FIELD: Record<VehicleSize, keyof PosService> = {
  S: "price_s",
  M: "price_m",
  L: "price_l",
  XL: "price_xl",
  Motor: "price_motor",
  "Motor S": "price_motor_s",
  "Motor M": "price_motor_m",
  "Motor L": "price_motor_l",
  "Motor XL": "price_motor_xl",
};

export function priceForSize(service: PosService, size: VehicleSize): number {
  const field = PRICE_FIELD[size];
  const value = field ? service[field] : 0;
  const angka = typeof value === "number" ? value : Number(value ?? 0);
  // Ukuran motor per label memakai kolomnya sendiri; kalau kolom itu nol,
  // harga motor umum dipakai supaya layanan tetap bisa dijual.
  if (angka > 0) return angka;
  if (size.startsWith("Motor ")) return Number(service.price_motor ?? 0);
  return angka;
}

export function isAvailableForSize(
  service: PosService,
  size: VehicleSize,
): boolean {
  return priceForSize(service, size) > 0;
}

export function sizeLabel(size: VehicleSize): string {
  if (size === "Motor") return "Motor";
  if (size.startsWith("Motor ")) return `Motor Size ${size.slice(6)}`;
  return `Size ${size}`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  wash: "Cuci (Wash)",
  coating: "Coating",
  detailing: "Detailing",
  other: "Lainnya",
};

export const CATEGORY_ICONS: Record<string, string> = {
  wash: "local_car_wash",
  coating: "auto_awesome",
  detailing: "airline_seat_recline_extra",
  other: "build",
};

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai / Cash",
  qris: "QRIS Instan",
  bank_transfer: "Transfer Bank",
};

export const PAYMENT_ICONS: Record<string, string> = {
  cash: "account_balance_wallet",
  qris: "qr_code_scanner",
  bank_transfer: "account_balance",
};

export function normalizeWaNumber(input: string | null | undefined): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

/*
 * Nomor WhatsApp Indonesia yang wajar setelah dinormalkan ke awalan 62.
 *
 * Panjang seluler Indonesia adalah 10-13 digit lokal (08 + 8 s/d 11 angka).
 * Setelah awalan 0 diganti 62, polanya menjadi 628 + 8..11 angka. Nomor
 * seperti 08541236215421 (14 digit lokal) hampir pasti salah ketik, dan tanpa
 * pemeriksaan ini ia tersimpan apa adanya lalu tautan lacak/nota dikirim ke
 * nomor yang salah.
 */
export function isValidWaNumber(input: string | null | undefined): boolean {
  return /^628\d{8,11}$/.test(normalizeWaNumber(input));
}

export function formatAngka(value: number): string {
  return Number(value ?? 0).toLocaleString("id-ID");
}

export function whatsappLink(phone: string, text: string): string {
  const number = normalizeWaNumber(phone);
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${number}?text=${encoded}`;
}

export type ReceiptItem = { name: string; qty: number; price: number };

export function buildReceiptText(params: {
  orderNumber: string;
  branchName: string;
  vehicleModel: string;
  licensePlate: string;
  size: string;
  customerName: string;
  items: ReceiptItem[];
  total: number;
  paymentMethod: string;
  trackingToken: string;
}): string {
  const lines: string[] = [];
  lines.push("*RB AUTOLUXE*");
  if (params.branchName && params.branchName.trim().toUpperCase() !== "RB AUTOLUXE") {
    lines.push(params.branchName.trim());
  }
  lines.push("");
  lines.push(`No. Order : ${params.orderNumber}`);
  lines.push(`Kendaraan : ${params.vehicleModel} (${params.size})`);
  lines.push(`Plat      : ${params.licensePlate}`);
  lines.push(`Nama      : ${params.customerName}`);
  lines.push("");
  lines.push("*Rincian Layanan*");
  params.items.forEach((item) => {
    lines.push(
      `${item.qty}x ${item.name} - Rp ${formatAngka(item.price * item.qty)}`,
    );
  });
  lines.push("");
  lines.push(`*TOTAL: Rp ${formatAngka(params.total)}*`);
  lines.push(
    `Pembayaran: ${PAYMENT_LABELS[params.paymentMethod] ?? params.paymentMethod}`,
  );
  lines.push("");
  lines.push(`Kode Lacak: ${params.trackingToken}`);
  lines.push("Simpan kode ini untuk menanyakan progres pengerjaan.");
  lines.push("");
  lines.push("Terima kasih telah mempercayakan kendaraan Anda di RB AUTOLUXE.");
  return lines.join("\n");
}
