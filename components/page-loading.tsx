/**
 * Placeholder saat server sedang mengambil data.
 *
 * Pola lama memakai teks "Memuat..." atau menghidupkan opacity. Keduanya
 * membuat layar terlihat kosong tanpa penjelasan, dan saat database sedang
 * lambat pengguna menekan tombol berulang kali.
 *
 * Kerangka di sini memakai ukuran yang sama dengan isi sebenarnya, jadi
 * tata letak tidak melompat begitu data datang.
 */
export function PageLoading({ label = "Memuat data" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="px-gutter py-4 flex flex-col gap-4"
    >
      <span className="sr-only">{label}...</span>

      <div className="h-6 w-40 rounded-lg bg-surface-container animate-pulse" />

      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-2xl bg-surface-container-low p-4 flex flex-col gap-2"
          >
            <div className="h-4 w-2/3 rounded bg-surface-container animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-surface-container animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default PageLoading;