"use client";

import { useMemo, useState } from "react";

const TEMPLATES = [
  {
    key: "nota",
    name: "Nota Transaksi POS",
    text: "Halo [Nama], terima kasih atas pembelian layanan di RB AUTOLUXE. No. Order: [Order]. Total: Rp [Total]. Terima kasih.",
  },
  {
    key: "status",
    name: "Update Status Pengerjaan",
    text: "Halo [Nama], status unit [Plat] saat ini: [Status]. Estimasi selesai: [Estimasi].",
  },
  {
    key: "garansi",
    name: "Sertifikat & Kode Garansi",
    text: "Halo [Nama], layanan [Order] telah selesai. Kode garansi: [KodeGaransi]. Berlaku s/d [Expired].",
  },
];

export function WhatsappConsole() {
  const [active, setActive] = useState("nota");
  const [values, setValues] = useState<Record<string, string>>({
    Nama: "",
    Order: "",
    Total: "",
    Plat: "",
    Status: "Dalam Pengerjaan",
    Estimasi: "",
    KodeGaransi: "",
    Expired: "",
  });

  const draft = useMemo(() => {
    const tpl = TEMPLATES.find((t) => t.key === active);
    if (!tpl) return "";
    return tpl.text
      .replace(/\[Nama\]/g, values.Nama || "[Nama]")
      .replace(/\[Order\]/g, values.Order || "[Order]")
      .replace(/\[Total\]/g, values.Total || "[Total]")
      .replace(/\[Plat\]/g, values.Plat || "[Plat]")
      .replace(/\[Status\]/g, values.Status || "[Status]")
      .replace(/\[Estimasi\]/g, values.Estimasi || "[Estimasi]")
      .replace(/\[KodeGaransi\]/g, values.KodeGaransi || "[KodeGaransi]")
      .replace(/\[Expired\]/g, values.Expired || "[Expired]");
  }, [active, values]);

  const openWa = () => {
    const text = encodeURIComponent(draft);
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-canvas">
      <div className="pb-[calc(68px+env(safe-area-inset-bottom)+24px)] px-gutter pt-4 space-y-space-lg">
        <section className="clay-card flex flex-col gap-space-md p-space-lg">
          <div className="flex items-center justify-between">
            <h2 className="font-headline-2 text-headline-2 text-text-primary">Draf Pesan Otomatis</h2>
            <span className="font-caption text-caption text-text-muted">Template berbasis pola transaksi</span>
          </div>

          <div className="flex gap-space-xs overflow-x-auto">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                onClick={() => setActive(tpl.key)}
                className={`px-3 py-2 rounded-xl font-caption text-caption whitespace-nowrap ${
                  active === tpl.key
                    ? "bg-brand-50 text-brand-600"
                    : "bg-surface-container-low text-text-secondary"
                }`}
              >
                {tpl.name}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-space-sm">
            <div className="grid grid-cols-2 gap-space-sm">
              <input
                value={values.Nama}
                onChange={(e) => setValues((v) => ({ ...v, Nama: e.target.value }))}
                placeholder="Nama Pelanggan"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.Order}
                onChange={(e) => setValues((v) => ({ ...v, Order: e.target.value }))}
                placeholder="No. Order"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.Total}
                onChange={(e) => setValues((v) => ({ ...v, Total: e.target.value }))}
                placeholder="Total (Rp)"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.Plat}
                onChange={(e) => setValues((v) => ({ ...v, Plat: e.target.value }))}
                placeholder="No. Pol"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.Status}
                onChange={(e) => setValues((v) => ({ ...v, Status: e.target.value }))}
                placeholder="Status Pengerjaan"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.Estimasi}
                onChange={(e) => setValues((v) => ({ ...v, Estimasi: e.target.value }))}
                placeholder="Estimasi Selesai"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.KodeGaransi}
                onChange={(e) => setValues((v) => ({ ...v, KodeGaransi: e.target.value }))}
                placeholder="Kode Garansi"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
              <input
                value={values.Expired}
                onChange={(e) => setValues((v) => ({ ...v, Expired: e.target.value }))}
                placeholder="Berlaku s/d"
                className="h-11 rounded-xl bg-surface px-3 font-body-regular text-body-regular text-text-primary shadow-[inset_0px_2px_4px_rgba(15,23,42,0.06)]"
              />
            </div>
          </div>

          <div className="clay-card p-space-md flex flex-col gap-space-xs bg-surface">
            <p className="font-body-bold text-body-bold text-text-primary">Pratinjau Pesan</p>
            <p className="font-body-regular text-body-regular text-text-primary whitespace-pre-wrap">{draft}</p>
          </div>

          <button
            onClick={openWa}
            className="h-[50px] rounded-full bg-gradient-to-r from-emerald-600 to-whatsapp flex items-center justify-center gap-2 text-on-primary font-body-bold text-body-bold shadow-[0px_10px_22px_rgba(34,197,94,0.32)]"
          >
            <span className="material-symbols-outlined">chat</span>
            Kirim Pesan via WhatsApp
          </button>
        </section>
      </div>
    </div>
  );
}
