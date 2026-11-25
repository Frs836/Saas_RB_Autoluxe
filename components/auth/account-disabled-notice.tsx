import Link from "next/link";
import { Icon } from "@/components/ui/icon";

export function AccountDisabledNotice() {
  return (
    <div className="w-full rounded-[8px] bg-danger-surface text-danger-text px-4 py-3 flex items-start gap-3 border border-danger-base/30 shadow-xs">
      <Icon name="block" className="text-[22px] shrink-0" />
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