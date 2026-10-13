import Link from "next/link";

/**
 * Halaman tidak ditemukan untuk pelanggan halaman lacak.
 *
 * Pelanggan sering salah menyalin tautan atau tautannya sudah kedaluwarsa.
 * Halaman galat bawaan Next.js berbahasa Inggris tanpa tombol keluar, sehingga
 * pelanggan bingung dan believe aplikasinya rusak.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-gutter">
      <div className="w-full max-w-[420px] text-center flex flex-col items-center gap-4">
        <span className="material-symbols-outlined text-[56px] text-text-muted">
          link_off
        </span>

        <h1 className="font-headline-1 text-headline-1 text-text-primary">
          Tautan Tidak Ditemukan
        </h1>

        <p className="font-caption text-caption text-text-secondary leading-relaxed">
          Tautan pelacakan ini tidak dikenali. Kemungkinan tautannya salah
          disalin atau sudah tidak berlaku karena order sudah selesai lebih dari
          90 hari lalu.
        </p>

        <div className="w-full clay-card bg-surface rounded-2xl p-4 text-left flex flex-col gap-1.5">
          <span className="font-caption text-caption text-text-secondary">
            Punya link yang tidak terbuka?
          </span>
          <span className="font-body text-body text-text-primary">
            Hubungi workshop RB AUTOLUXE dan sebutkan nomor polisi kendaraan
            Anda. Kami bantu cek statusnya.
          </span>
          <a
            href="https://wa.me/6281122334455"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 self-start h-11 px-4 rounded-xl bg-whatsapp text-white font-caption text-caption flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">chat</span>
            Hubungi via WhatsApp
          </a>
        </div>

        <Link
          href="/login"
          className="font-caption text-caption text-text-secondary underline"
        >
          Masuk ke sistem
        </Link>
      </div>
    </div>
  );
}