"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";

export function RegisterForm() {
  const router = useRouter();
  const supabase = createClient();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!fullName.trim()) {
      setError("Nama lengkap wajib diisi.");
      return;
    }
    if (!email.trim()) {
      setError("Email wajib diisi.");
      return;
    }
    if (password.length < 8) {
      setError("Kata sandi minimal 8 karakter.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Konfirmasi kata sandi tidak cocok.");
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    setLoading(false);

    if (signUpError) {
      setError(
        signUpError.message.includes("already registered")
          ? "Email ini sudah terdaftar. Silakan masuk."
          : signUpError.message,
      );
      return;
    }

    if (data.session) {
      router.replace("/dashboard");
      router.refresh();
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div className="bg-surface rounded-3xl p-6 sm:p-7 flex flex-col gap-5 clay-card text-center">
        <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto">
          <Icon name="mark_email_read" className="text-[28px]" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="font-headline-1 text-headline-1 text-text-primary">
            Cek Email Anda
          </h2>
          <p className="font-caption text-caption text-text-secondary leading-relaxed">
            Kami mengirim tautan verifikasi ke{" "}
            <span className="font-semibold text-text-primary">{email}</span>.
            Buka tautan tersebut untuk mengaktifkan akun, lalu masuk ke sistem.
          </p>
        </div>
        <Link
          href="/login"
          className="w-full h-[46px] rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-600 font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-all duration-200"
        >
          <Icon name="login" className="text-[22px] text-brand-600" />
          <span>Kembali ke Halaman Masuk</span>
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface rounded-3xl p-6 sm:p-7 flex flex-col gap-5 clay-card"
    >
      <div className="flex flex-col gap-1.5">
        <label
          className="font-body-bold text-body-bold text-text-primary text-xs tracking-wide uppercase"
          htmlFor="full-name"
        >
          Nama Lengkap
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 flex items-center pointer-events-none text-outline">
            <Icon name="person" className="text-[20px]" />
          </div>
          <input
            id="full-name"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-50 text-text-primary font-body-regular text-body-regular placeholder:text-text-muted focus:outline-none focus:bg-white focus:shadow-md transition-all duration-200"
            placeholder="Nama sesuai data staf"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          className="font-body-bold text-body-bold text-text-primary text-xs tracking-wide uppercase"
          htmlFor="reg-email"
        >
          Email
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 flex items-center pointer-events-none text-outline">
            <Icon name="mail" className="text-[20px]" />
          </div>
          <input
            id="reg-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-50 text-text-primary font-body-regular text-body-regular placeholder:text-text-muted focus:outline-none focus:bg-white focus:shadow-md transition-all duration-200"
            placeholder="nama@rbautoluxe.id"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          className="font-body-bold text-body-bold text-text-primary text-xs tracking-wide uppercase"
          htmlFor="reg-password"
        >
          Kata Sandi
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 flex items-center pointer-events-none text-outline">
            <Icon name="lock" className="text-[20px]" />
          </div>
          <input
            id="reg-password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full h-12 pl-11 pr-12 rounded-xl bg-slate-50 text-text-primary font-body-regular text-body-regular placeholder:text-text-muted focus:outline-none focus:bg-white focus:shadow-md transition-all duration-200"
            placeholder="Minimal 8 karakter"
          />
          <button
            type="button"
            aria-label="Tampilkan sandi"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-3.5 flex items-center justify-center text-outline hover:text-brand-600 focus:outline-none transition-colors"
          >
            <Icon name={showPassword ? "visibility_off" : "visibility"} className="text-[20px]" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          className="font-body-bold text-body-bold text-text-primary text-xs tracking-wide uppercase"
          htmlFor="reg-confirm"
        >
          Konfirmasi Kata Sandi
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 flex items-center pointer-events-none text-outline">
            <Icon name="lock_reset" className="text-[20px]" />
          </div>
          <input
            id="reg-confirm"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-50 text-text-primary font-body-regular text-body-regular placeholder:text-text-muted focus:outline-none focus:bg-white focus:shadow-md transition-all duration-200"
            placeholder="Ulangi kata sandi"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-danger-surface text-danger-text">
          <Icon name="error" className="text-[18px] shrink-0" />
          <p className="font-caption text-caption leading-relaxed">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full h-[50px] rounded-full text-on-primary font-headline-2 text-headline-2 flex items-center justify-center gap-2 active:scale-[0.98] transition-all duration-200 cursor-pointer primary-gradient clay-glow disabled:opacity-70 disabled:cursor-not-allowed"
      >
        <span>{loading ? "MENDAFTAR..." : "DAFTAR AKUN STAF"}</span>
        {!loading && (
          <Icon name="arrow_forward" className="text-[20px]" />
        )}
      </button>

      <div className="relative flex items-center justify-center my-1">
        <div className="w-full h-[1px] bg-slate-200" />
        <span className="absolute px-3 bg-surface font-caption text-caption text-text-muted uppercase tracking-wider">
          sudah punya akun
        </span>
      </div>

      <Link
        href="/login"
        className="w-full h-[46px] rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-600 font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-all duration-200"
      >
        <Icon name="login" className="text-[22px] text-brand-600" />
        <span>Masuk ke Sistem</span>
      </Link>
    </form>
  );
}
