"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";

/**
 * Pengajuan klaim garansi dari halaman lacak publik.
 *
 * Pelanggan tidak punya akun, jadi pengajuan dikirim lewat RPC publik yang
 * sudah memvalidasi token lacak, masa garansi, dan status unit. Komponen ini
 * hanya collects input; semua keputusan tetap di server.
 */
export function PublicWarrantyClaim({ token }: { token: string }) {
  const supabase = createClient();
  const [terbuka, setTerbuka] = useState(false);
  const [deskripsi, setDeskripsi] = useState("");
  const [mengirim, setMengirim] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sukses, setSukses] = useState<string | null>(null);

  async function kirim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSukses(null);

    if (deskripsi.trim().length < 10) {
      setError("Detail keluhan minimal 10 karakter.");
      return;
    }

    setMengirim(true);
    const { error: rpcError } = await supabase.rpc("create_public_warranty_claim", {
      p_token: token,
      p_problem_description: deskripsi.trim(),
      p_proof_photo_url: null,
    });
    setMengirim(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setSukses("Klaim terkirim. Tim kami akan menghubungi Anda untuk pemeriksaan.");
    setDeskripsi("");
  }

  if (sukses) {
    return (
      <div className="mt-4 flex items-start gap-2.5 p-3.5 rounded-xl bg-success-surface text-success-text">
        <Icon name="check_circle" className="text-[20px] shrink-0 mt-0.5" />
        <p className="font-caption text-caption leading-relaxed">{sukses}</p>
      </div>
    );
  }

  if (!terbuka) {
    return (
      <button
        type="button"
        onClick={() => setTerbuka(true)}
        className="mt-4 w-full h-12 rounded-2xl primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 clay-glow active:scale-[0.98] transition-transform"
      >
        <Icon name="verified_user" className="text-[20px]" />
        Ajukan Klaim Garansi
      </button>
    );
  }

  return (
    <form onSubmit={kirim} className="mt-4 flex flex-col gap-3">
      <p className="font-caption text-caption text-text-secondary leading-relaxed">
        Jelaskan kerusakan yang dialami pada kendaraan Anda. Klaim akan ditinjau
        tim kami dan Anda diberi kabar melalui nomor yang terdaftar.
      </p>
      <textarea
        value={deskripsi}
        onChange={(e) => setDeskripsi(e.target.value)}
        rows={4}
        placeholder="Contoh: Coating peel off di bagian kap depan setelah 2 minggu..."
        className="p-3 rounded-2xl bg-surface-container text-body-regular text-text-primary outline-none focus:ring-2 focus:ring-brand-400 resize-none"
      />
      {error ? (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-danger-surface text-danger-text">
          <Icon name="error" className="text-[18px] shrink-0" />
          <p className="font-caption text-caption leading-relaxed">{error}</p>
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={mengirim}
          className="flex-1 h-12 rounded-2xl primary-gradient text-white font-body-bold text-body-bold flex items-center justify-center gap-2 clay-glow active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          <Icon name={mengirim ? "hourglass_top" : "send"} className="text-[20px]" />
          {mengirim ? "Mengirim..." : "Kirim Klaim"}
        </button>
        <button
          type="button"
          onClick={() => setTerbuka(false)}
          className="h-12 px-5 rounded-2xl bg-surface-container text-text-secondary font-body-bold text-body-bold flex items-center justify-center active:scale-[0.98] transition-transform"
        >
          Batal
        </button>
      </div>
    </form>
  );
}