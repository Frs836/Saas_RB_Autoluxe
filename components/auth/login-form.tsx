"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
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
      className="bg-surface rounded-3xl p-6 sm:p-7 flex flex-col gap-5 clay-card"
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
            <span className="material-symbols-outlined text-[20px]">badge</span>
          </div>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full h-12 pl-11 pr-4 rounded-xl bg-slate-50 text-text-primary font-body-regular text-body-regular placeholder:text-text-muted focus:outline-none focus:bg-white focus:shadow-md transition-all duration-200"
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
            <span className="material-symbols-outlined text-[20px]">lock</span>
          </div>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full h-12 pl-11 pr-12 rounded-xl bg-slate-50 text-text-primary font-body-regular text-body-regular placeholder:text-text-muted focus:outline-none focus:bg-white focus:shadow-md transition-all duration-200"
            placeholder="Masukkan Kata Sandi"
          />
          <button
            type="button"
            aria-label="Tampilkan sandi"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute right-3.5 flex items-center justify-center text-outline hover:text-brand-600 focus:outline-none transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">
              {showPassword ? "visibility_off" : "visibility"}
            </span>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="w-4 h-4 rounded text-brand-500 focus:ring-0 focus:outline-none accent-brand-500 cursor-pointer"
          />
          <span className="font-caption text-caption text-text-secondary hover:text-text-primary transition-colors">
            Ingat Sesi di Perangkat
          </span>
        </label>
        <button
          type="button"
          onClick={handleReset}
          className="font-caption text-caption text-brand-600 hover:text-brand-700 font-semibold transition-colors focus:outline-none"
        >
          Lupa Sandi?
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-danger-surface text-danger-text">
          <span className="material-symbols-outlined text-[18px] shrink-0">
            error
          </span>
          <p className="font-caption text-caption leading-relaxed">{error}</p>
        </div>
      )}

      {info && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-success-surface text-success-text">
          <span className="material-symbols-outlined text-[18px] shrink-0">
            mark_email_read
          </span>
          <p className="font-caption text-caption leading-relaxed">{info}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full h-[50px] rounded-full text-on-primary font-headline-2 text-headline-2 flex items-center justify-center gap-2 active:scale-[0.98] transition-all duration-200 cursor-pointer primary-gradient clay-glow disabled:opacity-70 disabled:cursor-not-allowed"
      >
        <span>{loading ? "MEMPROSES..." : "MASUK KE SISTEM"}</span>
        {!loading && (
          <span className="material-symbols-outlined text-[20px]">
            arrow_forward
          </span>
        )}
      </button>

      <div className="relative flex items-center justify-center my-1">
        <div className="w-full h-[1px] bg-slate-200" />
        <span className="absolute px-3 bg-surface font-caption text-caption text-text-muted uppercase tracking-wider">
          atau
        </span>
      </div>

      <Link
        href="/register"
        className="w-full h-[46px] rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-600 font-body-bold text-body-bold flex items-center justify-center gap-2 active:scale-[0.99] transition-all duration-200"
      >
        <span className="material-symbols-outlined text-[22px] text-brand-600">
          person_add
        </span>
        <span>Daftar Akun Staf Baru</span>
      </Link>

      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-overlay text-text-secondary mt-1">
        <div className="flex-shrink-0 text-brand-600 pt-0.5">
          <span className="material-symbols-outlined text-[18px]">verified_user</span>
        </div>
        <p className="font-caption text-caption text-text-secondary leading-relaxed">
          Sistem otomatis mengunci akun Anda ke cabang operasional resmi setelah
          diverifikasi oleh Owner / Maintainer.
        </p>
      </div>
    </form>
  );
}
