import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { AccountDisabledNotice } from "@/components/auth/account-disabled-notice";

export const metadata: Metadata = {
  title: "Masuk - RB AUTOLUXE",
};

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
