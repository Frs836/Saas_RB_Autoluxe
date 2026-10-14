/**
 * Daftar syarat yang belum terpenuhi sebelum tombol kirim bisa ditekan.
 *
 * Tombol yang hanya disabled tanpa penjelasan membuat orang mengira aplikasinya
 * rusak. Mereka sudah mengisi alasan, sudah memindai wajah, tapi tombol tetap
 * mati dan tidak ada yang memberi tahu bagian mana yang kurang.
 *
 * Komponen ini dipakai bersama di semua form yang punya syarat, supaya
 * perilakunya konsisten dan tidak perlu ditebak.
 */
export type Syarat = {
  /** True berarti sudah terpenuhi. */
  terpenuhi: boolean;
  /** Apa yang harus dilakukan. */
  label: string;
};

export function SyaratBelumTerpenuhi({
  syarat,
  judul = "Sisa langkah sebelum bisa mengirim",
}: {
  syarat: Syarat[];
  judul?: string;
}) {
  const belum = syarat.filter((s) => !s.terpenuhi);

  if (belum.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-success-surface text-success-text px-3.5 py-2.5 font-caption text-caption">
        <span className="material-symbols-outlined text-[18px]">check_circle</span>
        Semua syarat terpenuhi, tombol kirim sudah aktif.
      </p>
    );
  }

  return (
    <div className="rounded-xl bg-warning-surface text-warning-text px-3.5 py-2.5 flex flex-col gap-1.5">
      <p className="font-caption text-caption flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px]">pending_actions</span>
        {judul} ({belum.length})
      </p>
      <ul className="flex flex-col gap-1 pl-6">
        {belum.map((s) => (
          <li key={s.label} className="font-micro-badge text-micro-badge list-disc">
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}