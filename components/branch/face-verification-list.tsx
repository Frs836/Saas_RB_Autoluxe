"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/ui/icon";

export type FaceRegistration = {
  profile_id: string;
  full_name: string;
  role: string;
  branch_name: string | null;
  face_verification: "pending" | "approved" | "rejected";
  face_review_note: string | null;
  registered_at: string | null;
  reference_photo_url: string | null;
  has_descriptor: boolean;
};

const STATUS_META: Record<
  FaceRegistration["face_verification"],
  { label: string; cls: string }
> = {
  pending: {
    label: "Menunggu tinjauan",
    cls: "bg-warning-surface text-warning-text",
  },
  approved: {
    label: "Disetujui",
    cls: "bg-success-surface text-success-text",
  },
  rejected: {
    label: "Ditolak",
    cls: "bg-danger-surface text-danger-text",
  },
};

/**
 * Peninjauan sampel wajah master oleh Maintainer.
 *
 * Daftar hanya memuat profil yang sudah mendaftarkan sampel wajah. Staf tanpa
 * sampel tidak muncul karena tidak ada yang perlu dinilai.
 */
/**
 * Foto referensi wajah untuk diverifikasi.
 *
 * Tanpa ini, maintainer hanya melihat nama, peran, dan cabang, lalu diminta
 * memutuskan apakah wajah itu benar. Wajahnya sendiri tidak pernah tampil.
 *
 * Bucket attendance-photos privat, jadi foto diambil lewat createSignedUrl
 * yang berlaku singkat. URL langsung tidak dipakai karena tidak kedaluwarsa
 * dan bisa dibagikan.
 */
function FaceReferencePhoto({
  path,
  name,
}: {
  path: string | null;
  name: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [gagal, setGagal] = useState(!path);

  useEffect(() => {
    let batal = false;

    if (!path) return;

    createClient()
      .storage.from("attendance-photos")
      .createSignedUrl(path, 60 * 30)
      .then(({ data, error }) => {
        if (batal) return;
        if (error || !data?.signedUrl) setGagal(true);
        else setUrl(data.signedUrl);
      })
      .catch(() => {
        if (!batal) setGagal(true);
      });

    return () => {
      batal = true;
    };
  }, [path]);

  if (!path || gagal) {
    return (
      <div className="rounded-xl bg-surface-container-low p-4 flex flex-col items-center gap-1.5 text-center">
        <Icon name="no_photography" className="text-[22px] text-text-muted" />
        <p className="font-caption text-caption text-text-secondary">
          {path
            ? "Foto referensi tidak bisa dimuat. Minta staf mendaftar ulang."
            : "Staff ini mendaftar tanpa foto referensi. Minta pendaftaran ulang."}
        </p>
      </div>
    );
  }

  return (
    <figure className="flex flex-col gap-1.5">
      <div className="rounded-xl overflow-hidden bg-[#0F172A] aspect-[4/3]">
        {url ? (
          <img
            src={url}
            alt={`Foto referensi wajah ${name}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon name="image" className="text-[26px] text-white/60 animate-pulse" />
          </div>
        )}
      </div>
      <figcaption className="font-micro-badge text-micro-badge text-text-muted">
        Foto referensi untuk {name}. Bandingkan dengan wajah staf saat absensi
        harian.
      </figcaption>
    </figure>
  );
}

export function FaceVerificationList({
  registrations,
}: {
  registrations: FaceRegistration[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const review = useCallback(
    async (profileId: string, approved: boolean) => {
      setError(null);
      setSuccess(null);

      if (!approved) {
        const reason = (note[profileId] ?? "").trim();
        if (reason.length < 5) {
          setError("Penolakan wajib disertai alasan minimal 5 karakter.");
          return;
        }
      }

      setBusyId(profileId);
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("review_staff_face", {
        p_profile_id: profileId,
        p_approved: approved,
        p_note: note[profileId]?.trim() ? note[profileId].trim() : null,
      });
      setBusyId(null);

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      setSuccess(approved ? "Wajah disetujui." : "Wajah ditolak dan staf diberi tahu.");
      router.refresh();
    },
    [note, router],
  );

  if (registrations.length === 0) {
    return (
      <div className="px-gutter py-6">
        <div className="clay-card p-6 flex flex-col items-center gap-3 text-center">
          <Icon name="verified_user" className="text-[40px] text-success-base" />
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Belum Ada Pendaftaran Wajah
          </h2>
          <p className="font-caption text-caption text-text-secondary">
            Daftar ini terisi otomatis saat staf mendaftarkan sampel wajahnya di
            halaman absensi.
          </p>
        </div>
      </div>
    );
  }

  const pendingCount = registrations.filter(
    (row) => row.face_verification === "pending",
  ).length;

  // Padding bawah memperhitungkan bilah navigasi dan safe area, supaya tombol
  // Setujui dan Tolak pada kartu terakhir tidak tertutup.
  return (
      <div className="px-gutter pt-4 pb-nav-plain flex flex-col gap-3">
      <section className="clay-card p-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-headline-2 text-headline-2 text-text-primary">
            Verifikasi Wajah Master
          </h1>
          <p className="font-caption text-caption text-text-muted">
            {pendingCount > 0
              ? `${pendingCount} menunggu tinjauan`
              : "Semua sampel sudah ditinjau."}
          </p>
        </div>
        <Icon name="face_retouching_natural" className="text-[28px] text-brand-600" />
      </section>

      {pendingCount > 0 ? (
        <p className="rounded-xl bg-warning-surface text-warning-text p-3 font-caption text-caption leading-relaxed">
          Staf dengan sampel berstatus menunggu tidak dapat melakukan absensi
          sampai Anda meninjaunya. Mendaftarkan ulang wajah akan mengembalikan
          status ke menunggu.
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl bg-danger-surface text-danger-text p-3 font-caption text-caption">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-xl bg-success-surface text-success-text p-3 font-caption text-caption">
          {success}
        </p>
      ) : null}

      {registrations.map((row) => {
        const meta = STATUS_META[row.face_verification];
        const busy = busyId === row.profile_id;

        return (
          <section key={row.profile_id} className="clay-card p-4 flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="font-body-bold text-body-bold text-text-primary">
                  {row.full_name}
                </span>
                <span className="font-micro-badge text-micro-badge text-text-muted">
                  {row.role} - {row.branch_name ?? "Belum ditugaskan"}
                </span>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full font-micro-badge text-micro-badge ${meta.cls}`}
              >
                {meta.label}
              </span>
            </div>

            {row.face_review_note ? (
              <p className="font-caption text-caption text-text-secondary bg-surface-container-low rounded-lg px-2.5 py-2">
                Catatan: {row.face_review_note}
              </p>
            ) : null}

            <FaceReferencePhoto path={row.reference_photo_url} name={row.full_name} />

            <label className="flex flex-col gap-1">
              <span className="font-micro-badge text-micro-badge text-text-muted">
                Catatan maintainer
              </span>
              <input
                value={note[row.profile_id] ?? ""}
                onChange={(e) =>
                  setNote((prev) => ({ ...prev, [row.profile_id]: e.target.value }))
                }
                placeholder="Wajib bila menolak, contoh: wajah kurang terang"
                className="h-11 px-3 rounded-xl bg-surface-container-low font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-400"
              />
            </label>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => review(row.profile_id, true)}
                className="flex-1 h-11 rounded-xl bg-success-base text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
              >
                <Icon name={busy ? "hourglass_top" : "check"} className="text-[18px]" />
                Setujui
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => review(row.profile_id, false)}
                className="flex-1 h-11 rounded-xl bg-danger-base text-white font-caption text-caption flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-60"
              >
                <Icon name="close" className="text-[18px]" />
                Tolak
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}