import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

type Props = {
  detail?: ReactNode;
  action?: ReactNode;
};

/** Layar yang tampil bila akun sudah login tetapi belum punya baris profile. */
export function PendingVerification({ detail, action }: Props) {
  return (
    <main className="flex-1 flex items-center justify-center px-gutter">
      <div className="max-w-[420px] bg-surface rounded-3xl p-6 clay-card text-center flex flex-col items-center gap-3">
        <Icon name="pending_actions" className="text-[40px] text-warning-base" />
        <h1 className="font-headline-1 text-headline-1 text-text-primary">
          Akun Menunggu Verifikasi
        </h1>
        <p className="font-caption text-caption text-text-secondary leading-relaxed">
          {detail ??
            "Profil operasional Anda belum terhubung ke cabang. Hubungi Owner atau Maintainer untuk mengikat akun ke cabang."}
        </p>
        {action}
      </div>
    </main>
  );
}

export default PendingVerification;