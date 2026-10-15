"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import { ThermalPrintButton } from "@/components/pos/thermal-print-button";
import type { ThermalReceipt } from "@/lib/thermal";
import {
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  MOBIL_SIZES,
  PAYMENT_ICONS,
  PAYMENT_LABELS,
  VEHICLE_TYPES,
  buildReceiptText,
  isAvailableForSize,
  priceForSize,
  sizeLabel,
  whatsappLink,
  type PosService,
  type VehicleSize,
  type VehicleType,
} from "@/lib/pos";
import type { Role } from "@/lib/rbac";

type CartLine = { serviceId: string; qty: number };

type TeamOption = { id: string; full_name: string };

type PaymentState = "paid" | "unpaid";

type Props = {
  services: PosService[];
  teamOptions: TeamOption[];
  branchName: string;
  canCreate: boolean;
  role: Role;
  roleLabel: string;
};

type OrderResult = {
  orderNumber: string;
  trackingToken: string;
  total: number;
  paymentState: PaymentState;
  startedImmediately: boolean;
  waHref: string | null;
  receipt: string;
  thermal: ThermalReceipt;
};

export function PosConsole({
  services,
  teamOptions,
  branchName,
  canCreate,
  role,
  roleLabel,
}: Props) {
  const isEmployee = role === "karyawan";
  const [step, setStep] = useState<"catalog" | "checkout" | "done">("catalog");
  const [vehicleType, setVehicleType] = useState<VehicleType>("mobil");
  const [size, setSize] = useState<VehicleSize>("M");
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cart, setCart] = useState<CartLine[]>([]);

  const [licensePlate, setLicensePlate] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentState, setPaymentState] = useState<PaymentState>("paid");
  const [startWork, setStartWork] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);

  const effSize: VehicleSize = vehicleType === "motor" ? "Motor" : size;

  const serviceById = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );

  const resolved = useMemo(
    () =>
      cart.flatMap((line) => {
        const service = serviceById.get(line.serviceId);
        if (!service) return [];
        const price = priceForSize(service, effSize);
        if (price <= 0) return [];
        return [{ serviceId: line.serviceId, qty: line.qty, service, price }];
      }),
    [cart, serviceById, effSize],
  );

  const total = resolved.reduce((sum, line) => sum + line.price * line.qty, 0);
  const itemCount = resolved.reduce((sum, line) => sum + line.qty, 0);

  // Hanya karyawan yang boleh menahan pembayaran; kasir wajib mencatat settled.
  const effectivePaymentState: PaymentState = isEmployee
    ? paymentState
    : "paid";

  const availableServices = useMemo(
    () => services.filter((s) => isAvailableForSize(s, effSize)),
    [services, effSize],
  );
  const mainServices = availableServices.filter((s) => !s.is_addon);
  const addonServices = availableServices.filter((s) => s.is_addon);
  const categories = Array.from(new Set(mainServices.map((s) => s.category)));
  const query = search.trim().toLowerCase();
  const filteredMain = mainServices.filter(
    (s) =>
      (activeCategory === "all" || s.category === activeCategory) &&
      (query === "" || s.name.toLowerCase().includes(query)),
  );
  const filteredAddon = addonServices.filter(
    (s) => query === "" || s.name.toLowerCase().includes(query),
  );

  function qtyInCart(id: string) {
    return cart.find((l) => l.serviceId === id)?.qty ?? 0;
  }

  function addToCart(id: string) {
    setCart((prev) => {
      const existing = prev.find((l) => l.serviceId === id);
      if (existing) {
        return prev.map((l) =>
          l.serviceId === id ? { ...l, qty: l.qty + 1 } : l,
        );
      }
      return [...prev, { serviceId: id, qty: 1 }];
    });
  }

  function changeQty(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.serviceId === id ? { ...l, qty: Math.max(0, l.qty + delta) } : l,
        )
        .filter((l) => l.qty > 0),
    );
  }

  function toggleMember(id: string) {
    setSelectedTeam((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function resetOrder() {
    setCart([]);
    setLicensePlate("");
    setVehicleModel("");
    setCustomerName("");
    setCustomerPhone("");
    setPaymentMethod("cash");
    setPaymentState("paid");
    setStartWork(false);
    setSelectedTeam([]);
    setResult(null);
    setError(null);
    setStep("catalog");
  }

  function validate(): string | null {
    if (resolved.length === 0) return "Belum ada layanan yang dipilih.";
    if (licensePlate.trim() === "") return "Nomor plat kendaraan wajib diisi.";
    if (vehicleModel.trim() === "") return "Model kendaraan wajib diisi.";
    if (customerName.trim() === "") return "Nama pelanggan wajib diisi.";
    if (customerPhone.trim() === "") return "Nomor WhatsApp wajib diisi.";
    return null;
  }

  async function submitOrder() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      // service_id, name, dan price dikirim bersama karena server belum
      // semuanya memakai harga dari katalog: server lama memakai name dan
      // price, server baru mengabaikannya dan menghitung sendiri dari
      // service_id. Setelah migrasi 0022 terpasang, name dan price di sini
      // bisa dihapus.
      const items = resolved.map((line) => ({
        service_id: line.serviceId,
        name: line.service.name,
        price: line.price,
        qty: line.qty,
      }));
      const mainNames = resolved
        .filter((l) => !l.service.is_addon)
        .map((l) => l.service.name);
      // Dikirim untuk memenuhi signature, tetapi server menyusun ulang paket
      // dari katalog karena nama paket menentukan penerbitan garansi.
      const servicePackage =
        (mainNames.length > 0 ? mainNames : resolved.map((l) => l.service.name))
          .join(", ")
          .trim() || "Layanan POS";

      /*
       * Paket layanan adalah gabungan semua nama yang dipilih kasir. Kolomnya
       * dulu varchar(150), padahal satu nama layanan bisa 39 karakter, jadi
       * empat layanan sudah melewati batas dan checkout gagal dengan pesan
       * trigger yang tidak menjelaskan apa pun. Kolomnya sekarang 500
       * karakter, dan batas ini hanya mencegah kasus yang tidak wajar agar
       * pesannya bisa ditulis dalam bahasa manusia.
       */
      if (servicePackage.length > 500) {
        setSubmitting(false);
        setError(
          `Daftar layanan yang dipilih terlalu panjang (${servicePackage.length} karakter, batas 500). Kurangi jumlah layanan atau pendekan nama layanannya.`,
        );
        return;
      }

      const { data: orderRow, error: createError } = await supabase.rpc(
        "create_pos_order_with_hold",
        {
          p_license_plate: licensePlate.trim().toUpperCase(),
          p_vehicle_model: vehicleModel.trim(),
          p_vehicle_size: effSize,
          p_customer_name: customerName.trim(),
          p_customer_phone: customerPhone.trim(),
          p_service_package: servicePackage,
          p_items: items,
          p_payment_method: paymentMethod,
          p_payment_state: effectivePaymentState,
          p_start_work: startWork,
        },
      );
      if (createError) throw new Error(createError.message);

      const order = Array.isArray(orderRow) ? orderRow[0] : orderRow;
      if (!order || !order.order_number) {
        throw new Error("Order tidak dapat dibuat.");
      }

      // Order sudah tersimpan pada titik ini. Kegagalan set tim tidak boleh
// dilempar sebagai error, karena kasir akan menekan ulang dan membuat order
      // ganda. Tim teknisi bisa diperbaiki dari antrean order.
      let teamWarning: string | null = null;
      if (selectedTeam.length > 0) {
        const { error: teamError } = await supabase.rpc("set_order_team", {
          p_order_id: order.id,
          p_member_ids: selectedTeam,
          p_lead_id: selectedTeam[0],
        });
        if (teamError) {
          teamWarning = `Order ${order.order_number} tersimpan, tetapi tim teknisi gagal ditugaskan: ${teamError.message}`;
        }
      }

      const recordedState: PaymentState =
        (order.payment_state as PaymentState | null) ?? effectivePaymentState;

      const receipt = buildReceiptText({
        orderNumber: order.order_number,
        branchName,
        vehicleModel: vehicleModel.trim(),
        licensePlate: licensePlate.trim().toUpperCase(),
        size: sizeLabel(effSize),
        customerName: customerName.trim(),
        items: resolved.map((l) => ({
          name: l.service.name,
          qty: l.qty,
          price: l.price,
        })),
        total: Number(order.total_price ?? total),
        paymentMethod,
        trackingToken: order.tracking_token,
      });

      setResult({
        orderNumber: order.order_number,
        trackingToken: order.tracking_token,
        total: Number(order.total_price ?? total),
        paymentState: recordedState,
        startedImmediately: startWork,
        receipt,
        thermal: {
          branchName,
          orderNumber: order.order_number,
          vehicleModel: vehicleModel.trim(),
          licensePlate: licensePlate.trim().toUpperCase(),
          customerName: customerName.trim(),
          items: resolved.map((l) => ({
            name: l.service.name,
            quantity: l.qty,
            total: l.price * l.qty,
          })),
          total: Number(order.total_price ?? total),
          paymentMethod,
          paid: recordedState === "paid",
          trackingUrl: `${window.location.origin}/track/${order.tracking_token}`,
        },
        waHref:
          customerPhone.trim() === ""
            ? null
            : whatsappLink(customerPhone.trim(), receipt),
      });
      setStep("done");
      if (teamWarning) setError(teamWarning);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Terjadi kesalahan, coba lagi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (!canCreate) {
    return (
      <div className="px-gutter py-6">
        <div className="clay-card p-6 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-warning-surface flex items-center justify-center">
            <span className="material-symbols-outlined text-warning-text text-[28px]">
              lock
            </span>
          </div>
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Akses Terbatas
          </h2>
          <p className="font-body text-body text-text-secondary">
            Peran Anda saat ini adalah <b>{roleLabel}</b>. Pembuatan order POS
            hanya dapat dilakukan oleh Owner, Admin Kasir, atau Maintainer.
          </p>
          <Link
            href="/pos/orders"
            className="mt-1 px-5 py-3 rounded-xl bg-primary text-white font-body-bold text-body-bold active:scale-95 transition-transform"
          >
            Lihat Antrean Order
          </Link>
        </div>
      </div>
    );
  }

  if (step === "done" && result) {
    return (
      <div className="px-gutter py-6 pb-28">
        <div className="clay-card p-6 flex flex-col items-center text-center gap-3">
          <div className="w-16 h-16 rounded-full bg-success-surface flex items-center justify-center">
            <span className="material-symbols-outlined text-success-text text-[34px]">
              check_circle
            </span>
          </div>
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Order Berhasil Dibuat
          </h2>
          <p className="font-body text-body text-text-secondary">
            Order tercatat pada sistem dan siap dikerjakan.
          </p>
          <div className="w-full mt-1 p-4 rounded-2xl bg-surface-container-low text-left flex flex-col gap-1">
            <span className="font-caption text-caption text-text-muted">
              Nomor Order
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {result.orderNumber}
            </span>
            <span className="font-caption text-caption text-text-muted mt-2">
              Kode Lacak
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {result.trackingToken}
            </span>
            <span className="font-caption text-caption text-text-muted mt-2">
              Total
            </span>
            <span className="font-headline-2 text-headline-2 text-primary">
              {formatRupiah(result.total)}
            </span>
            <span className="font-caption text-caption text-text-muted mt-2">
              Status Pembayaran
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              {result.paymentState === "paid"
                ? "Sudah Dibayar"
                : "Belum Dibayar (Bayar Nanti)"}
            </span>
            {isEmployee && result.paymentState === "paid" ? (
              <div className="mt-3 p-3 rounded-xl bg-warning-surface text-warning-text font-caption text-caption flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">
                  savings
                </span>
                <span>
                  Rp {formatRupiah(result.total)} tercatat sebagai kas titipan
                  atas nama Anda. Serahkan ke Admin Kasir saat shift dibuka.
                </span>
              </div>
            ) : null}
            {result.startedImmediately ? (
              <div className="mt-2 p-3 rounded-xl bg-success-surface text-success-text font-caption text-caption flex items-start gap-2">
                <span className="material-symbols-outlined text-[18px] shrink-0">
                  engineering
                </span>
                <span>Order sudah berstatus &ldquo;Sedang Dikerjakan&rdquo;.</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {result.waHref ? (
            <a
              href={result.waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-4 rounded-2xl bg-whatsapp text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-[0_8px_20px_-6px_rgba(37,211,102,0.6)]"
            >
              <span className="material-symbols-outlined text-[22px]">
                chat
              </span>
              Kirim Nota ke WhatsApp Pelanggan
            </a>
          ) : null}

          {/* Kontrol cetak thermal adalah salah satu dari tiga aksi utama
              setelah transaksi, dan kasir baru tidak akan menemukannya di
              balik elemen yang tertutup. */}
          {!isEmployee ? (
            <div className="rounded-2xl bg-surface-container-low p-3 flex flex-col gap-2">
              <span className="font-caption text-caption text-text-secondary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px]">print</span>
                Cetak struk ke printer thermal
              </span>
              <ThermalPrintButton receipt={result.thermal} />
            </div>
          ) : null}
          <Link
            href="/pos/orders"
            className="w-full py-4 rounded-2xl bg-primary text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">
              list_alt
            </span>
            Lihat Antrean Order
          </Link>
          <button
            type="button"
            onClick={resetOrder}
            className="w-full py-4 rounded-2xl bg-surface-container-low text-text-primary font-body-bold text-body-bold active:scale-95 transition-transform"
          >
            Buat Order Baru
          </button>
        </div>
      </div>
    );
  }

  if (step === "checkout") {
    return (
      /*
       * Ruang bawah dihitung dari navigasi (88px termasuk ruang tombol
       * tambah) ditambah bilah melayang yang lebih tinggi karena memuat
       * jumlah layanan dan total, lalu diberi ruang bernapas supaya tidak
       * ada yang menempel di baliknya.
       */
      <div className="pb-[calc(15rem+env(safe-area-inset-bottom))]">
        <div className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
          <div className="h-16 px-gutter flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("catalog");
              }}
              aria-label="Kembali ke katalog"
              className="w-11 h-11 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95 transition-transform"
            >
              <span className="material-symbols-outlined text-[22px]">
                arrow_back
              </span>
            </button>
            <h1 className="font-headline-2 text-headline-2 text-text-primary">
              Checkout Order
            </h1>
          </div>
        </div>

        <div className="px-gutter py-4 flex flex-col gap-4">
          <section className="clay-card p-4 flex flex-col gap-3">
            <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-brand-600">
                directions_car
              </span>
              Data Kendaraan
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-muted">
                  Nomor Plat
                </span>
                <input
                  value={licensePlate}
                  onChange={(e) => setLicensePlate(e.target.value)}
                  placeholder="B 1234 XYZ"
                  className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary uppercase outline-none focus:ring-2 focus:ring-brand-400"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-caption text-caption text-text-muted">
                  Model
                </span>
                <input
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  placeholder="Avanza"
                  className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
                />
              </label>
            </div>
            <div className="flex items-center gap-2 text-text-secondary font-caption text-caption">
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-brand-50 text-brand-700">
                <span className="material-symbols-outlined text-[14px]">
                  {vehicleType === "motor" ? "two_wheeler" : "directions_car"}
                </span>
                {vehicleType === "motor" ? "Motor" : "Mobil"}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-container-high">
                {sizeLabel(effSize)}
              </span>
            </div>
          </section>

          <section className="clay-card p-4 flex flex-col gap-3">
            <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-brand-600">
                person
              </span>
              Data Pelanggan
            </h2>
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Nama Pelanggan
              </span>
              <input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nama pelanggan"
                className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-caption text-caption text-text-muted">
                Nomor WhatsApp
              </span>
              <input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                inputMode="tel"
                placeholder="08123456789"
                className="h-12 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>
          </section>

          <section className="clay-card p-4 flex flex-col gap-3">
            <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-brand-600">
                groups
              </span>
              Tim Teknisi
              <span className="font-caption text-caption text-text-muted ml-auto">
                opsional, maks 5
              </span>
            </h2>
            {teamOptions.length === 0 ? (
              <p className="font-body text-body text-text-secondary">
                Belum ada teknisi aktif di cabang ini.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {teamOptions.map((member) => {
                  const index = selectedTeam.indexOf(member.id);
                  const selected = index >= 0;
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleMember(member.id)}
                      className={`px-3 min-h-11 rounded-full font-caption text-caption flex items-center gap-1 active:scale-95 transition-transform ${
                        selected
                          ? "bg-primary text-white"
                          : "bg-surface-container-low text-text-secondary"
                      }`}
                    >
                      {selected && index === 0 ? (
                        <span className="material-symbols-outlined text-[14px]">
                          star
                        </span>
                      ) : null}
                      {member.full_name}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedTeam.length > 0 ? (
              <p className="font-caption text-caption text-text-muted">
                Lead: {teamOptions.find((m) => m.id === selectedTeam[0])?.full_name}
              </p>
            ) : null}
          </section>

          <section className="clay-card p-4 flex flex-col gap-3">
            <h2 className="font-body-bold text-body-bold text-text-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-brand-600">
                payments
              </span>
              Metode Pembayaran
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {Object.keys(PAYMENT_LABELS).map((method) => {
                const active = paymentMethod === method;
                return (
                  <button
                    key={method}
                    type="button"
                    onClick={() => setPaymentMethod(method)}
                    className={`py-3 rounded-xl flex flex-col items-center gap-1 active:scale-95 transition-transform ${
                      active
                        ? "bg-primary text-white"
                        : "bg-surface-container-low text-text-secondary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {PAYMENT_ICONS[method]}
                    </span>
                    <span className="font-caption text-caption">
                      {PAYMENT_LABELS[method]}
                    </span>
                  </button>
                );
              })}
            </div>

            {isEmployee ? (
              <>
                <div className="h-px bg-outline-variant" />
                <p className="font-caption text-caption text-text-muted">
                  Uang pelanggan yang Anda terima dicatat sebagai{" "}
                  <b className="text-text-primary">kas titipan</b> atas nama
                  Anda dan hanya divalidasi oleh Admin Kasir saat shift dibuka.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentState("unpaid")}
                    aria-pressed={paymentState === "unpaid"}
                    className={`px-3 py-3 rounded-xl flex flex-col items-center gap-1 active:scale-95 transition-transform ${
                      paymentState === "unpaid"
                        ? "bg-warning-surface text-warning-text"
                        : "bg-surface-container-low text-text-secondary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      schedule
                    </span>
                    <span className="font-caption text-caption">Bayar Nanti</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentState("paid")}
                    aria-pressed={paymentState === "paid"}
                    className={`px-3 py-3 rounded-xl flex flex-col items-center gap-1 active:scale-95 transition-transform ${
                      paymentState === "paid"
                        ? "bg-primary text-white"
                        : "bg-surface-container-low text-text-secondary"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      paid
                    </span>
                    <span className="font-caption text-caption">
                      Bayar Sekarang
                    </span>
                  </button>
                </div>
                <div className="flex items-start gap-2 p-3 rounded-xl bg-surface-container-low">
                  <span className="material-symbols-outlined text-[18px] text-brand-600 mt-0.5">
                    {effectivePaymentState === "paid"
                      ? "savings"
                      : "hourglass_empty"}
                  </span>
                  <p className="font-caption text-caption text-text-secondary">
                    {effectivePaymentState === "paid" ? (
                      <>
                        Anda memegang{" "}
                        <b className="text-text-primary">
                          {formatRupiah(total)} {PAYMENT_LABELS[paymentMethod]}
                        </b>{" "}
                        milik pelanggan.
                      </>
                    ) : (
                      <>
                        Belum ada uang masuk. Tagihan Rp
                        {formatRupiah(total)} tetap tercatat dan menjadi
                        tanggung jawab kasir saat serah terima shift.
                      </>
                    )}
                  </p>
                </div>
              </>
            ) : null}

            <div className="h-px bg-outline-variant" />
            <button
              type="button"
              onClick={() => setStartWork((prev) => !prev)}
              aria-pressed={startWork}
              className={`px-3 py-3 rounded-xl flex items-center gap-3 active:scale-95 transition-transform ${
                startWork
                  ? "bg-success-surface text-success-text"
                  : "bg-surface-container-low text-text-secondary"
              }`}
            >
              <span className="material-symbols-outlined text-[20px]">
                {startWork ? "check_box" : "check_box_outline_blank"}
              </span>
              <span className="flex flex-col items-start">
                <span className="font-caption text-caption">
                  Kerjakan Sekarang
                </span>
                <span className="font-micro-badge text-micro-badge opacity-80">
                  Langsung berstatus &ldquo;Sedang Dikerjakan&rdquo;
                </span>
              </span>
            </button>
          </section>

          <section className="clay-card p-4 flex flex-col gap-2">
            <h2 className="font-body-bold text-body-bold text-text-primary">
              Rincian Pesanan
            </h2>
            {resolved.map((line) => (
              <div
                key={line.serviceId}
                className="flex items-center justify-between font-body text-body"
              >
                <span className="text-text-secondary">
                  {line.qty}x {line.service.name}
                </span>
                <span className="text-text-primary font-body-bold">
                  {formatRupiah(line.price * line.qty)}
                </span>
              </div>
            ))}
            <div className="h-px bg-outline-variant my-1" />
            <div className="flex items-center justify-between">
              <span className="font-body-bold text-body-bold text-text-primary">
                Total
              </span>
              <span className="font-headline-2 text-headline-2 text-primary">
                {formatRupiah(total)}
              </span>
            </div>
          </section>

          {error ? (
            <div className="p-3 rounded-xl bg-danger-surface text-danger-text font-body text-body flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">
                error
              </span>
              {error}
            </div>
          ) : null}
        </div>

        {/*
         * Tombol melayang, terpisah dari navigasi bawah.
         *
         * Sebelumnya bilahnya menempel tepat di tepi navigasi dengan latar
         * yang sama, sehingga keduanya terbaca sebagai satu blok besar dan
         * rincian di bawahnya tertutup. Sekarang bentuknya pil dengan
         * bayangan sendiri, jaraknya diberikan oleh token --nav-h-fab. Tinggi
         * navigasi sendiri 68px, jadi jaraknya selalu terlihat.
         */}
        <div className="fixed bottom-nav-offset left-0 right-0 z-action-bar px-gutter">
          <button
            type="button"
            disabled={submitting}
            onClick={submitOrder}
            className="w-full py-4 rounded-full primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 clay-fab active:scale-95 transition-transform disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[22px]">
              {submitting ? "hourglass_top" : "check_circle"}
            </span>
            {submitting
              ? "Memproses..."
              : `${startWork ? "Simpan & Kerjakan" : "Buat Order"} - ${formatRupiah(total)}`}
          </button>
        </div>
      </div>
    );
  }

  return (
      <div className="pb-[calc(14rem+env(safe-area-inset-bottom))]">
      <div className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md pt-safe shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
        <div className="h-16 px-gutter flex items-center justify-between gap-space-sm">
          <div className="flex items-center gap-space-sm min-w-0">
            <div className="w-8 h-8 rounded-lg bg-surface-container-low flex items-center justify-center shrink-0 p-1">
              <svg
                className="w-full h-full text-brand-600"
                fill="none"
                viewBox="0 0 40 40"
              >
                <path
                  d="M6 28L14 12H26L21 21H31L19 32L21 25H11L6 28Z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-headline-2 text-headline-2 text-text-primary leading-tight">
                Katalog Layanan
              </span>
              <span className="font-caption text-caption text-text-muted truncate">
                {branchName}
              </span>
            </div>
          </div>
          <Link
            href="/pos/orders"
            aria-label="Antrean order"
            className="w-11 h-11 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary active:scale-95 transition-transform"
          >
            <span className="material-symbols-outlined text-[22px]">
              list_alt
            </span>
          </Link>
        </div>
      </div>

      <div className="px-gutter py-4 flex flex-col gap-4">
        <div className="flex gap-2">
          {VEHICLE_TYPES.map((type) => {
            const active = vehicleType === type.value;
            return (
              <button
                key={type.value}
                type="button"
                onClick={() => setVehicleType(type.value)}
                className={`flex-1 py-3 rounded-2xl flex items-center justify-center gap-2 font-body-bold text-body-bold active:scale-95 transition-transform ${
                  active
                    ? "bg-primary text-white"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {type.icon}
                </span>
                {type.label}
              </button>
            );
          })}
        </div>

        {vehicleType === "mobil" ? (
          <div className="flex gap-2">
            {MOBIL_SIZES.map((option) => {
              const active = size === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSize(option)}
                  // min-h-11 karena py-2.5 hanya menghasilkan 40px. Tombol ukuran kendaraan
                  // ditekan di awal transaksi, sering dengan satu tangan sambil
                  // memegang kunci unit.
                  className={`flex-1 min-h-11 rounded-xl font-body-bold text-body-bold flex items-center justify-center active:scale-95 transition-transform ${
                    active
                      ? "bg-brand-600 text-white"
                      : "bg-surface-container-low text-text-secondary"
                  }`}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-2.5 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">
              two_wheeler
            </span>
            Semua layanan motor menggunakan tarif Motor.
          </div>
        )}

        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-[20px]">
            search
          </span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari layanan..."
            className="w-full h-12 pl-10 pr-3 rounded-2xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-gutter px-gutter">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={`shrink-0 px-4 min-h-11 rounded-full font-caption text-caption flex items-center active:scale-95 transition-transform ${
              activeCategory === "all"
                ? "bg-primary text-white"
                : "bg-surface-container-low text-text-secondary"
            }`}
          >
            Semua
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`shrink-0 px-4 min-h-11 rounded-full font-caption text-caption flex items-center active:scale-95 transition-transform ${
                activeCategory === category
                  ? "bg-primary text-white"
                  : "bg-surface-container-low text-text-secondary"
              }`}
            >
              {CATEGORY_LABELS[category] ?? category}
            </button>
          ))}
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-body-bold text-body-bold text-text-primary">
            Paket Utama
          </h2>
          {filteredMain.length === 0 ? (
            <p className="font-body text-body text-text-secondary py-4 text-center">
              Tidak ada layanan yang cocok.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredMain.map((service) => {
                const qty = qtyInCart(service.id);
                return (
                  <div key={service.id} className="clay-card p-3 flex flex-col gap-2">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-brand-600 text-[22px]">
                        {CATEGORY_ICONS[service.category] ?? "build"}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-body-bold text-body-bold text-text-primary leading-tight line-clamp-2">
                        {service.name}
                      </span>
                      <span className="font-caption text-caption text-text-muted">
                        {CATEGORY_LABELS[service.category] ?? service.category}
                      </span>
                    </div>
                    <span className="font-body-bold text-body-bold text-primary">
                      {formatRupiah(priceForSize(service, effSize))}
                    </span>
                    {qty > 0 ? (
                      <div className="flex items-center justify-between bg-surface-container-low rounded-xl p-1">
                        <button
                          type="button"
                          onClick={() => changeQty(service.id, -1)}
                          className="w-11 h-11 rounded-lg bg-surface flex items-center justify-center active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[18px] text-text-secondary">
                            remove
                          </span>
                        </button>
                        <span className="font-body-bold text-body-bold text-text-primary">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQty(service.id, 1)}
                          className="w-11 h-11 rounded-lg bg-primary text-white flex items-center justify-center active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            add
                          </span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addToCart(service.id)}
                        className="min-h-11 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center justify-center gap-1 active:scale-95 transition-transform"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          add
                        </span>
                        Tambah
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {filteredAddon.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-body-bold text-body-bold text-text-primary">
              Layanan Tambahan
            </h2>
            <div className="flex flex-col gap-2">
              {filteredAddon.map((service) => {
                const qty = qtyInCart(service.id);
                return (
                  <div
                    key={service.id}
                    className="clay-card p-3 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-brand-600 text-[22px]">
                        add_circle
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="font-body-bold text-body-bold text-text-primary truncate">
                        {service.name}
                      </span>
                      <span className="font-body-bold text-body-bold text-primary">
                        {formatRupiah(priceForSize(service, effSize))}
                      </span>
                    </div>
                    {qty > 0 ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => changeQty(service.id, -1)}
                          className="w-11 h-11 rounded-lg bg-surface-container-low flex items-center justify-center active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[18px] text-text-secondary">
                            remove
                          </span>
                        </button>
                        <span className="font-body-bold text-body-bold text-text-primary w-5 text-center">
                          {qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => changeQty(service.id, 1)}
                          className="w-11 h-11 rounded-lg bg-primary text-white flex items-center justify-center active:scale-95"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            add
                          </span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addToCart(service.id)}
                        aria-label={`Tambah ${service.name}`}
                        className="w-11 h-11 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center active:scale-95 transition-transform"
                      >
                        <span className="material-symbols-outlined text-[20px]">
                          add
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {itemCount > 0 ? (
        <div className="fixed bottom-nav-offset left-0 right-0 z-action-bar px-gutter">
          <div className="bg-surface rounded-[24px] clay-fab px-4 py-3 border border-outline-variant">
            <div className="flex items-center justify-between mb-2">
              <span className="font-caption text-caption text-text-secondary">
                {itemCount} layanan dipilih
              </span>
              <span className="font-headline-2 text-headline-2 text-primary">
                {formatRupiah(total)}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setStep("checkout");
              }}
              className="w-full py-4 rounded-full primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
            >
              Lanjut ke Checkout
              <span className="material-symbols-outlined text-[22px]">
                arrow_forward
              </span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
