import Link from "next/link";

export function AccountDisabledNotice() {
  return (
    <div className="w-full rounded-2xl bg-danger-surface text-danger-text px-4 py-3 flex items-start gap-3 shadow-[inset_0px_1px_2px_rgba(255,255,255,0.6)]">
      <span className="material-symbols-outlined text-[22px] shrink-0">
        block
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-body-bold text-body-bold">
          Akun Anda dinonaktifkan
        </p>
        <p className="font-caption text-caption leading-relaxed">
          Akses operasional sudah dicabut oleh Owner atau Maintainer. Hubungi
          mereka bila ini keliru, atau masuk kembali bila akun Anda sudah aktif.
        </p>
        <Link
          href="/login"
          className="self-start mt-1 font-caption text-caption font-semibold underline underline-offset-2"
        >
          Coba masuk lagi
        </Link>
      </div>
    </div>
  );
}

export default AccountDisabledNotice;