import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { AccountDisabledNotice } from "@/components/auth/account-disabled-notice";

export const metadata: Metadata = {
  title: "Masuk - RB AUTOLUXE",
};

// searchParams dipakai untuk membaca alasan penolakan akun, jadi halaman ini
// tidak boleh di-prerender dan ditandai sebagai route blocking.
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <AuthShell>
      {reason === "disabled" ? <AccountDisabledNotice /> : null}
      <LoginForm />
    </AuthShell>
  );
}
