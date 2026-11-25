"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError("Email atau ID staf wajib diisi.");
      return;
    }
    if (!password) {
      setError("Kata sandi wajib diisi.");
      return;
    }

    setLoading(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (signInError) {
      setError(
        signInError.message === "Invalid login credentials"
          ? "Email atau kata sandi salah."
          : signInError.message,
      );
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  async function handleReset() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Isi email terlebih dahulu untuk mengirim tautan reset.");
      return;
    }
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    );
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setInfo("Tautan reset kata sandi sudah dikirim ke email Anda.");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-surface rounded-[10px] p-6 sm:p-7 flex flex-col gap-5 clay-card border border-border"
    >
      <div className="flex flex-col gap-1.5">
        <label
          className="font-body-bold text-body-bold text-text-primary text-xs tracking-wide uppercase"
          htmlFor="email"
        >
          Email / ID Staf
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 flex items-center pointer-events-none text-outline">
            <Icon name="badge" className="text-[20px]" />
          </div>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full h-11 pl-11 pr-4 rounded-[8px] bg-surface-container-low border border-border text-text-primary font-body text-body placeholder:text-text-muted focus:outline-none focus:bg-surface focus:border-brand-500 transition-colors"
            placeholder="Masukkan Email"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          className="font-body-bold text-body-bold text-text-primary text-xs tracking-wide uppercase"
          htmlFor="password"
        >
          Kata Sandi
        </label>
        <div className="relative flex items-center">
          <div className="absolute left-3.5 flex items-center pointer-events-none text-outline">
            <Icon name="lock" className="text-[20px]" />
          </div>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full h-11 pl-11 pr-12 rounded-[8px] bg-surface-container-low border border-border text-text-primary font-body text-body placeholder:text-text-muted focus:outline-none focus:bg-surface focus:border-brand-500 transition-colors"
            placeholder="Masukkan Kata Sandi"
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

      <div className="flex items-center justify-end pt-0.5">
        <button
          type="button"
          onClick={handleReset}
          className="font-caption text-caption text-brand-600 hover:text-brand-700 font-semibold transition-colors focus:outline-none"
        >
          Lupa Sandi?
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-[8px] bg-danger-surface text-danger-text border border-danger-base/30">
          <Icon name="error" className="text-[18px] shrink-0" />
          <p className="font-caption text-caption leading-relaxed">{error}</p>
        </div>
      )}

      {info && (
        <div className="flex items-start gap-2.5 p-3 rounded-[8px] bg-success-surface text-success-text border border-success-base/30">
          <Icon name="mark_email_read" className="text-[18px] shrink-0" />
          <p className="font-caption text-caption leading-relaxed">{info}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full h-11 rounded-[8px] text-white font-body-bold text-body-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity cursor-pointer primary-gradient clay-glow disabled:opacity-70 disabled:cursor-not-allowed shadow-sm"
      >
        <span>{loading ? "MEMPROSES..." : "MASUK KE SISTEM"}</span>
        {!loading && (
          <Icon name="arrow_forward" className="text-[20px]" />
        )}
      </button>

      <div className="relative flex items-center justify-center my-1">
        <div className="w-full h-[1px] bg-border" />
        <span className="absolute px-3 bg-surface font-caption text-caption text-text-muted uppercase tracking-wider">
          atau
        </span>
      </div>

      <Link
        href="/register"
        className="w-full h-11 rounded-[8px] bg-brand-50 hover:bg-brand-100 text-brand-700 font-body-bold text-body-bold flex items-center justify-center gap-2 transition-colors border border-brand-200"
      >
        <Icon name="person_add" className="text-[20px] text-brand-600" />
        <span>Daftar Akun Staf Baru</span>
      </Link>

      <div className="flex items-start gap-2.5 p-3 rounded-[8px] bg-surface-container-low border border-border text-text-secondary mt-1">
        <div className="flex-shrink-0 text-brand-600 pt-0.5">
          <Icon name="verified_user" className="text-[18px]" />
        </div>
        <p className="font-caption text-caption text-text-secondary leading-relaxed">
          Sistem otomatis mengunci akun Anda ke cabang operasional resmi setelah
          diverifikasi oleh Owner / Maintainer.
        </p>
      </div>
    </form>
  );
}
