import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { InspectionPhoto } from "@/components/track/inspection-photo";
import { PublicWarrantyClaim } from "@/components/track/public-warranty-claim";
import { Icon } from "@/components/ui/icon";

export const instant = false;

type TrackingOrder = {
  order_number: string | null;
  status: string | null;
  customer_name: string | null;
  license_plate: string | null;
  vehicle_model: string | null;
  service_package: string | null;
  total_price: number | string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
  cancellation_reason: string | null;
};

type Inspection = {
  phase: string | null;
  photo_url: string | null;
  notes: string | null;
  created_at: string | null;
};

type Warranty = {
  warranty_code: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
};

type Claim = {
  claim_date: string | null;
  problem_description: string | null;
  status: string | null;
  resolution_note: string | null;
  proof_photo_url: string | null;
};

type TrackingPayload = {
  order: TrackingOrder;
  inspections: Inspection[];
  warranty: Warranty | null;
  claims: Claim[];
};

/**
 * Mengubah path objek di bucket publik menjadi URL yang bisa dimuat peramban.
 *
 * Nilai di database adalah path relatif. Nilai yang sudah berupa URL lengkap
 * dikembalikan apa adanya supaya data lama tidak ikut rusak.
 */
function storageObjectUrl(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;

  return `${base}/storage/v1/object/public/inspection-photos/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

/*
 * Tahap yang dilalui pelanggan, berurutan dari order dibuat sampai unit
 * diambil pulang.
 *
 * Daftar ini sebelumnya hanya memuat queued sampai completed. Padahal
 * migrasi 0030 menambah dua tahap lagi ke enum order_status, yaitu
 * menunggu_diambil dan diserahkan. Karena keduanya tidak ada di daftar,
 * findIndex mengembalikan -1, semua tahap jatuh ke "Menunggu", dan
 * lencana status jatuh ke teks cadangan "Diproses". Pelanggan yang
 * Eug belum mengambil kendaraannya tetap membaca "Diproses".
 *
 * Urutan di enum: queued, in_progress, qc_review, completed,
 * menunggu_diambil, diserahkan. Jangan diubah seenaknya, karena apply_order_status
 * dan advance_handover memvalidasi transisinya.
 */
const STEPS: { key: string; label: string; icon: string; note?: string }[] = [
  { key: "queued", label: "Antre", icon: "schedule" },
  { key: "in_progress", label: "Pengerjaan", icon: "build" },
  { key: "qc_review", label: "Quality Control", icon: "fact_check" },
  {
    key: "completed",
    label: "Pengerjaan Selesai",
    icon: "task_alt",
    note: "Pekerjaan utama selesai dan sudah lolos pemeriksaan",
  },
  {
    key: "menunggu_diambil",
    label: "Siap Diambil",
    icon: "local_shipping",
    note: "Kendaraan sudah selesai dan siap diambil pelanggan",
  },
  {
    key: "diserahkan",
    label: "Telah Diambil",
    icon: "verified",
    note: "Kendaraan sudah diserahkan ke pelanggan",
  },
];

/* Cadangan kalau status tidak dikenal. Tidak boleh berbunyi "Diproses". */
const STATUS_UNKNOWN = "Status tidak tersedia";

const PHASE_LABEL: Record<string, string> = {
  before: "Kondisi Sebelum",
  process: "Proses Pengerjaan",
  after: "Hasil Sesudah",
};

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

function formatRupiah(value: number | string | null) {
  if (value === null || value === undefined) return "-";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(num);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return { title: `Lacak Order ${token.slice(0, 8)} · RB Autoluxe` };
}

export default async function TrackPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("get_order_tracking", { p_token: token });
  const payload = data as TrackingPayload | null;

  if (!payload?.order) return notFound();

  const order = payload.order;
  const warranty = payload.warranty ?? null;
  const claims = payload.claims ?? [];

  // photo_url disimpan sebagai path relatif di bucket publik, misalnya
  // demo/unit-002-before.webp. Dipakai langsung sebagai src, browser
  // mencarinya relatif terhadap /track/[token] sehingga gambarnya tidak pernah
  // termuat. Pathnya harus diubah menjadi URL objek publik lebih dulu.
  const inspections = (payload.inspections ?? []).map((item) => ({
    ...item,
    photo_url: storageObjectUrl(item.photo_url),
  }));

  const isCancelled = order.status === "cancelled";
  const currentIndex = STEPS.findIndex((step) => step.key === order.status);

  /*
   * Setelah diserahkan, pelanggan sudah membawa unit pulang, jadi semua
   * tahap tampil tuntas dan tidak ada yang berhenti sebagai "Sedang
   * berlangsung".
   */
  const selesaiDiserahkan = order.status === "diserahkan";
  const indexTampil = selesaiDiserahkan ? STEPS.length : currentIndex;

  const lencanaStatus = isCancelled
    ? "Dibatalkan"
    : currentIndex >= 0
      ? STEPS[currentIndex].label
      : STATUS_UNKNOWN;

  const siapDiambil = order.status === "menunggu_diambil";

  return (
    <div className="min-h-screen bg-surface pb-16">
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-white/70">
        <div className="px-gutter pt-safe">
          <div className="h-14 flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl primary-gradient clay-glow flex items-center justify-center">
              <Icon name="local_car_wash" className="text-on-primary text-[20px]" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="font-headline-2 text-headline-2 text-text-primary">
                RB Autoluxe
              </span>
              <span className="font-caption text-caption text-text-muted">
                Lacak Pengerjaan Kendaraan
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="px-gutter pt-4 flex flex-col gap-4">
        <section className="bg-surface rounded-[20px] p-5 clay-card border border-white/80">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-caption text-caption text-text-muted uppercase tracking-wide">
                Nomor Order
              </p>
              <p className="font-headline-2 text-headline-2 text-text-primary mt-0.5">
                {order.order_number ?? "-"}
              </p>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body-bold text-caption ${
                isCancelled
                  ? "bg-danger-surface text-danger-text"
                  : order.status === "diserahkan"
                    ? "bg-success-surface text-success-text"
                    : siapDiambil
                      ? "bg-success-surface text-success-text"
                      : "bg-brand-50 text-brand-600"
              }`}
            >
              <Icon
                name={
                  isCancelled
                    ? "cancel"
                    : order.status === "diserahkan"
                      ? "verified"
                      : siapDiambil
                        ? "local_shipping"
                        : "pending"
                }
                className="text-[16px]"
              />
              {lencanaStatus}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div className="rounded-2xl bg-surface-container/60 p-3">
              <p className="font-caption text-caption text-text-muted">
                Pemilik
              </p>
              <p className="font-body-bold text-body-bold text-text-primary mt-0.5">
                {order.customer_name ?? "-"}
              </p>
            </div>
            <div className="rounded-2xl bg-surface-container/60 p-3">
              <p className="font-caption text-caption text-text-muted">
                Kendaraan
              </p>
              <p className="font-body-bold text-body-bold text-text-primary mt-0.5">
                {order.license_plate ?? "-"}
              </p>
              {order.vehicle_model ? (
                <p className="font-caption text-caption text-text-muted">
                  {order.vehicle_model}
                </p>
              ) : null}
            </div>
            <div className="rounded-2xl bg-surface-container/60 p-3">
              <p className="font-caption text-caption text-text-muted">
                Paket Layanan
              </p>
              <p className="font-body-bold text-body-bold text-text-primary mt-0.5">
                {order.service_package ?? "-"}
              </p>
            </div>
            <div className="rounded-2xl bg-surface-container/60 p-3">
              <p className="font-caption text-caption text-text-muted">
                Total Biaya
              </p>
              <p className="font-body-bold text-body-bold text-brand-600 mt-0.5">
                {formatRupiah(order.total_price)}
              </p>
            </div>
          </div>

          {isCancelled && order.cancellation_reason ? (
            <div className="mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-danger-surface text-danger-text">
              <Icon name="info" className="text-[18px] shrink-0" />
              <p className="font-caption text-caption leading-relaxed">
                Alasan pembatalan: {order.cancellation_reason}
              </p>
            </div>
          ) : null}

          {/*
           * Pengerjaan selesai tapi unit belum diambil adalah kabar yang
           * paling ditunggu pelanggan. Sebelum ada banner ini, tahap
           * "menunggu_diambil" tidak dikenal sama sekali oleh halaman ini,
           * sehingga yang terbaca hanya "Diproses".
           */}
          {siapDiambil ? (
            <div className="mt-4 flex items-start gap-2.5 p-3.5 rounded-xl bg-success-surface text-success-text">
              <Icon name="local_shipping" className="text-[20px] shrink-0 mt-0.5" />
              <div>
                <p className="font-body-bold text-body-bold">
                  Pengerjaan selesai, kendaraan siap diambil
                </p>
                <p className="font-caption text-caption leading-relaxed mt-0.5">
                  Silakan datang ke workshop. Unit Anda sudah selesai dan
                  menunggu untuk diserahkan.
                </p>
              </div>
            </div>
          ) : null}

          {selesaiDiserahkan ? (
            <div className="mt-4 flex items-start gap-2.5 p-3.5 rounded-xl bg-success-surface text-success-text">
              <Icon name="verified" className="text-[20px] shrink-0 mt-0.5" />
              <div>
                <p className="font-body-bold text-body-bold">
                  Kendaraan sudah diserahkan
                </p>
                <p className="font-caption text-caption leading-relaxed mt-0.5">
                  Terima kasih telah mempercayakan kendaraan Anda.
                  {order.completed_at
                    ? ` Diserahkan pada ${formatDate(order.completed_at)}.`
                    : ""}
                </p>
              </div>
            </div>
          ) : null}
        </section>

        <section className="bg-surface rounded-[20px] p-5 clay-card border border-white/80">
          <div className="flex items-center gap-2 mb-4">
            <Icon name="timeline" className="text-brand-600 text-[20px]" />
            <span className="font-headline-2 text-headline-2 text-text-primary">
              Progres Pengerjaan
            </span>
          </div>

          {isCancelled ? (
            <p className="font-body-regular text-body-regular text-text-secondary">
              Order ini telah dibatalkan sehingga proses pengerjaan dihentikan.
            </p>
          ) : (
            <ol className="flex flex-col">
              {STEPS.map((step, index) => {
                const done = indexTampil >= 0 && index < indexTampil;
                const active = index === indexTampil && !selesaiDiserahkan;
                const reached = done || active;
                const isLast = index === STEPS.length - 1;
                return (
                  <li key={step.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                          reached
                            ? "primary-gradient text-on-primary"
                            : "bg-surface-container text-text-muted"
                        }`}
                      >
                        <Icon name={done ? "check" : step.icon} className="text-[18px]" />
                      </span>
                      {!isLast ? (
                        <span
                          className={`w-0.5 flex-1 min-h-[28px] ${
                            done ? "bg-brand-500" : "bg-surface-container"
                          }`}
                        />
                      ) : null}
                    </div>
                    <div className="pb-5">
                      <p
                        className={`font-body-bold text-body-bold ${
                          reached ? "text-text-primary" : "text-text-muted"
                        }`}
                      >
                        {step.label}
                      </p>
                      <p className="font-caption text-caption text-text-muted">
                        {done
                          ? "Selesai"
                          : active
                            ? "Sedang berlangsung"
                            : step.note && (siapDiambil || selesaiDiserahkan)
                              ? "Belum tercapai"
                              : "Menunggu"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {inspections.length > 0 ? (
          <section className="bg-surface rounded-[20px] p-5 clay-card border border-white/80">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="photo_library" className="text-brand-600 text-[20px]" />
              <span className="font-headline-2 text-headline-2 text-text-primary">
                Dokumentasi Foto
              </span>
            </div>
            <div className="flex flex-col gap-5">
              {["before", "process", "after"].map((phase) => {
                const items = inspections.filter((i) => i.phase === phase);
                if (items.length === 0) return null;
                return (
                  <div key={phase}>
                    <p className="font-body-bold text-body-bold text-text-secondary mb-2">
                      {PHASE_LABEL[phase]}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {items.map((item, idx) => (
                        <figure
                          key={`${phase}-${idx}`}
                          className="rounded-2xl overflow-hidden bg-surface-container/60"
                        >
                          {item.photo_url ? (
                            <InspectionPhoto
                              src={item.photo_url}
                              alt={PHASE_LABEL[phase]}
                            />
                          ) : (
                            <div className="w-full h-32 flex items-center justify-center text-text-muted">
                              <Icon name="image" className="text-[28px]" />
                            </div>
                          )}
                          {item.notes ? (
                            <figcaption className="font-caption text-caption text-text-secondary p-2">
                              {item.notes}
                            </figcaption>
                          ) : null}
                        </figure>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {warranty ? (
          <section className="bg-surface rounded-[20px] p-5 clay-card border border-white/80">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="verified_user" className="text-brand-600 text-[20px]" />
              <span className="font-headline-2 text-headline-2 text-text-primary">
                Sertifikat Garansi
              </span>
            </div>
            <div className="rounded-2xl bg-surface-container/60 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-caption text-caption text-text-muted">
                    Kode Garansi
                  </p>
                  <p className="font-body-bold text-body-bold text-text-primary mt-0.5">
                    {warranty.warranty_code ?? "-"}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-body-bold text-caption ${
                    warranty.status === "active"
                      ? "bg-success-surface text-success-text"
                      : warranty.status === "claimed"
                        ? "bg-warning-surface text-warning-text"
                        : "bg-surface-container text-text-secondary"
                  }`}
                >
                  {warranty.status === "active"
                    ? "Aktif"
                    : warranty.status === "claimed"
                      ? "Sudah Diklaim"
                      : "Kedaluwarsa"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <p className="font-caption text-caption text-text-muted">
                    Mulai
                  </p>
                  <p className="font-body-bold text-body-bold text-text-primary">
                    {formatDate(warranty.start_date)}
                  </p>
                </div>
                <div>
                  <p className="font-caption text-caption text-text-muted">
                    Berakhir
                  </p>
                  <p className="font-body-bold text-body-bold text-text-primary">
                    {formatDate(warranty.end_date)}
                  </p>
                </div>
              </div>
            </div>

            {claims.length > 0 ? (
              <div className="mt-4">
                <p className="font-body-bold text-body-bold text-text-secondary mb-2">
                  Riwayat Klaim
                </p>
                <div className="flex flex-col gap-3">
                  {claims.map((claim, idx) => (
                    <div
                      key={idx}
                      className="rounded-2xl bg-surface-container/60 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-caption text-caption text-text-muted">
                          {formatDate(claim.claim_date)}
                        </span>
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full font-caption text-caption ${
                            claim.status === "approved"
                              ? "bg-success-surface text-success-text"
                              : claim.status === "rejected"
                                ? "bg-danger-surface text-danger-text"
                                : "bg-warning-surface text-warning-text"
                          }`}
                        >
                          {claim.status === "approved"
                            ? "Disetujui"
                            : claim.status === "rejected"
                              ? "Ditolak"
                              : "Menunggu"}
                        </span>
                      </div>
                      {claim.problem_description ? (
                        <p className="font-body-regular text-body-regular text-text-primary mt-1.5">
                          {claim.problem_description}
                        </p>
                      ) : null}
                      {claim.resolution_note ? (
                        <p className="font-caption text-caption text-text-secondary mt-1">
                          Catatan: {claim.resolution_note}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/*
              Klaim hanya ditawarkan ketika garansi masih aktif dan belum ada
              klaim yang menunggu, supaya tombol tidak pernah mengarah ke
              penolakan yang sudah pasti.
            */}
            {warranty.status === "active" &&
            !claims.some((c) => c.status === "pending") ? (
              <PublicWarrantyClaim token={token} />
            ) : null}
          </section>
        ) : null}

        <section className="bg-surface-overlay rounded-[20px] p-4">
          <div className="flex items-start gap-2.5">
            <Icon name="info" className="text-brand-600 text-[18px] shrink-0" />
            <p className="font-caption text-caption text-text-secondary leading-relaxed">
              Pembaruan terakhir: {formatDate(order.updated_at ?? order.created_at)}
              {order.completed_at
                ? ` · Selesai: ${formatDate(order.completed_at)}`
                : ""}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
