"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  gantiEmail,
  gantiSandi,
  hapusAvatar,
  simpanAvatar,
  simpanDataDiri,
  type AccountActionResult,
} from "@/app/actions/account";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { AvatarCropper } from "@/components/profil/avatar-cropper";
import { initials } from "@/lib/format";
import { urlAvatar } from "@/lib/avatar";

const MAKS_FOTO = 2 * 1024 * 1024;
const JENIS_FOTO = ["image/webp", "image/jpeg", "image/png"];

/**
 * Pengaturan akun milik staf sendiri.
 *
 * Setiap tindakan (data diri, email, sandi, foto) membuka modal overlay,
 * bukan memperluas section di bawah halaman. Ini membuat tampilan tetap
 * ringkas dan tidak membingungkan pengguna.
 */
export function AccountSettings({
  nama,
  telepon,
  tanggalLahir,
  email,
  avatarUrl,
}: {
  nama: string;
  telepon: string;
  tanggalLahir: string;
  email: string;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ nama, telepon, tanggalLahir });
  const [emailBaru, setEmailBaru] = useState("");
  const [sandi, setSandi] = useState({
    passwordLama: "",
    passwordBaru: "",
    ulangiSandi: "",
  });
  const [sandiTerlihat, setSandiTerlihat] = useState(false);
  const [avatar, setAvatar] = useState<string | null>(avatarUrl);
  const [berkasCrop, setBerkasCrop] = useState<File | null>(null);

  const [pesan, setPesan] = useState<AccountActionResult | null>(null);
  const [sibuk, setSibuk] = useState<"data" | "email" | "sandi" | "foto" | null>(null);
  const [sandiLama, setSandiLama] = useState("");

  // Modal state
  const [modalDataDiri, setModalDataDiri] = useState(false);
  const [modalEmail, setModalEmail] = useState(false);
  const [modalSandi, setModalSandi] = useState(false);

  const jalankan = async (
    kunci: "data" | "email" | "sandi" | "foto",
    kerja: () => Promise<AccountActionResult>,
  ) => {
    setSibuk(kunci);
    setPesan(null);
    try {
      const hasil = await kerja();
      setPesan(hasil);
      if (hasil.ok) router.refresh();
      return hasil;
    } catch (e) {
      setPesan({ ok: false, message: `Gagal: ${(e as Error).message}` });
      return { ok: false, message: "" } as AccountActionResult;
    } finally {
      setSibuk(null);
    }
  };

  const kirimData = async () => {
    const hasil = await jalankan("data", () =>
      simpanDataDiri({
        nama: form.nama,
        telepon: form.telepon,
        tanggalLahir: form.tanggalLahir,
      }),
    );
    if (hasil.ok) setModalDataDiri(false);
  };

  const kirimEmail = async () => {
    const hasil = await jalankan("email", () =>
      gantiEmail({ emailBaru, passwordLama: sandiLama }),
    );
    if (hasil.ok) {
      setEmailBaru("");
      setSandiLama("");
      setModalEmail(false);
    }
  };

  const kirimSandi = async () => {
    const hasil = await jalankan("sandi", () =>
      gantiSandi({
        passwordLama: sandi.passwordLama,
        passwordBaru: sandi.passwordBaru,
        ulangiSandi: sandi.ulangiSandi,
      }),
    );
    if (hasil.ok) {
      setSandi({ passwordLama: "", passwordBaru: "", ulangiSandi: "" });
      setSandiTerlihat(false);
      setModalSandi(false);
    }
  };

  const pilihFoto = async (berkas: File) => {
    if (!JENIS_FOTO.includes(berkas.type)) {
      setPesan({ ok: false, message: "Format foto harus JPG, PNG, atau WebP." });
      return;
    }
    if (berkas.size > MAKS_FOTO) {
      setPesan({ ok: false, message: "Ukuran foto maksimal 2 MB." });
      return;
    }
    setBerkasCrop(berkas);
  };

  const unggahFoto = async (gambar: Blob) => {
    setBerkasCrop(null);
    setSibuk("foto");
    setPesan(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sesi berakhir.");

      const jalur = `${user.id}/avatar-${Date.now()}.webp`;

      const { error: upErr } = await supabase.storage
        .from("profile-avatars")
        .upload(jalur, gambar, { contentType: "image/webp", upsert: true });
      if (upErr) throw new Error(upErr.message);

      const hasil = await simpanAvatar(jalur);
      setPesan(hasil);

      if (hasil.ok) {
        if (avatar) await supabase.storage.from("profile-avatars").remove([avatar]);
        setAvatar(jalur);
      } else {
        await supabase.storage.from("profile-avatars").remove([jalur]);
      }
    } catch (e) {
      setPesan({ ok: false, message: `Gagal mengunggah foto: ${(e as Error).message}` });
    } finally {
      setSibuk(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const buangFoto = async () => {
    if (!avatar) return;
    const hasil = await jalankan("foto", () => hapusAvatar(avatar));
    if (hasil.ok) setAvatar(null);
  };

  const tampilFoto = avatar ? urlAvatar(avatar) : null;

  return (
    <div className="flex flex-col gap-2.5 px-gutter pt-2.5 pb-nav">
      {/* Pesan hasil aksi */}
      {pesan ? (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-2xl px-3.5 py-2.5 text-caption ${
            pesan.ok
              ? "bg-success-surface text-success-text"
              : "bg-danger-surface text-danger-text"
          }`}
        >
          {pesan.message}
        </div>
      ) : null}

      {/* Foto profil */}
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="account_circle" className="text-brand-600 text-[18px]" />
          <span className="font-body-bold text-body-bold text-text-primary">Foto Profil</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 shrink-0">
            {tampilFoto ? (
              <img
                src={tampilFoto}
                alt="Foto profil Anda"
                className="w-20 h-20 rounded-[20px] object-cover border border-white/80"
              />
            ) : (
              <div className="w-20 h-20 rounded-[20px] bg-brand-50 text-brand-600 flex items-center justify-center font-headline-2 text-headline-2">
                {initials(form.nama)}
              </div>
            )}
            {sibuk === "foto" ? (
              <div className="absolute inset-0 rounded-[20px] bg-black/50 flex items-center justify-center">
                <Icon name="progress_activity" className="text-white text-[20px] animate-spin" />
              </div>
            ) : null}
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <input
              ref={fileRef}
              type="file"
              accept={JENIS_FOTO.join(",")}
              className="hidden"
              onChange={(e) => {
                const berkas = e.target.files?.[0];
                if (berkas) void pilihFoto(berkas);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={sibuk !== null}
              className="h-10 rounded-full bg-brand-50 text-brand-700 font-body-bold text-body-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Icon name="photo_camera" className="text-[18px]" />
              {avatar ? "Ganti Foto" : "Unggah Foto"}
            </button>
            {avatar ? (
              <button
                type="button"
                onClick={buangFoto}
                disabled={sibuk !== null}
                className="h-10 rounded-full bg-danger-surface text-danger-text font-body-bold text-body-bold flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Icon name="delete" className="text-[18px]" />
                Hapus Foto
              </button>
            ) : null}
            <span className="font-caption text-caption text-text-muted text-center">
              JPG, PNG, atau WebP. Maksimal 2 MB.
            </span>
          </div>
        </div>
      </section>

      {/* Data diri — tombol pembuka modal */}
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="badge" className="text-brand-600 text-[18px]" />
            <div>
              <span className="font-body-bold text-body-bold text-text-primary">Data Diri</span>
              <p className="font-caption text-caption text-text-muted">{form.nama}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalDataDiri(true)}
            className="h-9 px-4 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform"
          >
            <Icon name="edit" className="text-[16px]" />
            Ubah
          </button>
        </div>
      </section>

      {/* Email — tombol pembuka modal */}
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="mail" className="text-brand-600 text-[18px]" />
            <div>
              <span className="font-body-bold text-body-bold text-text-primary">Email</span>
              <p className="font-caption text-caption text-text-muted truncate max-w-[160px]">{email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalEmail(true)}
            className="h-9 px-4 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform shrink-0"
          >
            <Icon name="edit" className="text-[16px]" />
            Ganti
          </button>
        </div>
      </section>

      {/* Kata sandi — tombol pembuka modal */}
      <section className="bg-surface rounded-[20px] p-4 clay-card border border-white/80">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="lock" className="text-brand-600 text-[18px]" />
            <div>
              <span className="font-body-bold text-body-bold text-text-primary">Kata Sandi</span>
              <p className="font-caption text-caption text-text-muted">••••••••</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setModalSandi(true)}
            className="h-9 px-4 rounded-xl bg-brand-50 text-brand-700 font-caption text-caption flex items-center gap-1.5 active:scale-95 transition-transform shrink-0"
          >
            <Icon name="lock_reset" className="text-[16px]" />
            Ganti
          </button>
        </div>
      </section>

      {/* ── Modal: Ubah Data Diri ── */}
      <Modal
        open={modalDataDiri}
        onClose={() => setModalDataDiri(false)}
        title="Ubah Data Diri"
      >
        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-secondary">Nama Lengkap</span>
          <input
            value={form.nama}
            onChange={(e) => setForm({ ...form, nama: e.target.value })}
            maxLength={120}
            className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-secondary">Nomor Telepon</span>
          <input
            value={form.telepon}
            onChange={(e) => setForm({ ...form, telepon: e.target.value })}
            inputMode="tel"
            maxLength={25}
            placeholder="08xxxxxxxxxx"
            className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-caption text-caption text-text-secondary">Tanggal Lahir</span>
          <input
            type="date"
            value={form.tanggalLahir}
            onChange={(e) => setForm({ ...form, tanggalLahir: e.target.value })}
            className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
          />
        </label>
        <button
          type="button"
          onClick={kirimData}
          disabled={sibuk !== null}
          className="mt-1 h-11 rounded-full bg-brand-600 text-white font-body-bold text-body-bold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {sibuk === "data" ? (
            <Icon name="progress_activity" className="text-[18px] animate-spin" />
          ) : (
            <Icon name="save" className="text-[18px]" />
          )}
          Simpan Data Diri
        </button>
      </Modal>

      {/* ── Modal: Ganti Email ── */}
      <Modal
        open={modalEmail}
        onClose={() => setModalEmail(false)}
        title="Ganti Email"
      >
        <p className="font-caption text-caption text-text-muted">
          Email sekarang <span className="font-body-bold text-text-primary">{email}</span> dan dipakai untuk masuk.
        </p>
        <input
          value={emailBaru}
          onChange={(e) => setEmailBaru(e.target.value)}
          type="email"
          placeholder="Email baru"
          className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <input
          value={sandiLama}
          onChange={(e) => setSandiLama(e.target.value)}
          type="password"
          placeholder="Password lama"
          autoComplete="current-password"
          className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <button
          type="button"
          onClick={kirimEmail}
          disabled={sibuk !== null || emailBaru.length === 0 || sandiLama.length === 0}
          className="h-11 rounded-full bg-brand-600 text-white font-body-bold text-body-bold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {sibuk === "email" ? (
            <Icon name="progress_activity" className="text-[18px] animate-spin" />
          ) : (
            <Icon name="mark_email_read" className="text-[18px]" />
          )}
          Kirim Tautan Konfirmasi
        </button>
        <span className="font-caption text-caption text-text-muted">
          Email baru hanya aktif setelah tautan konfirmasi dibuka.
        </span>
      </Modal>

      {/* ── Modal: Ganti Kata Sandi ── */}
      <Modal
        open={modalSandi}
        onClose={() => setModalSandi(false)}
        title="Ganti Kata Sandi"
      >
        <input
          value={sandi.passwordLama}
          onChange={(e) => setSandi({ ...sandi, passwordLama: e.target.value })}
          type="password"
          placeholder="Password lama"
          autoComplete="current-password"
          className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <input
          value={sandi.passwordBaru}
          onChange={(e) => setSandi({ ...sandi, passwordBaru: e.target.value })}
          type={sandiTerlihat ? "text" : "password"}
          placeholder="Password baru, minimal 8 karakter"
          autoComplete="new-password"
          className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <input
          value={sandi.ulangiSandi}
          onChange={(e) => setSandi({ ...sandi, ulangiSandi: e.target.value })}
          type={sandiTerlihat ? "text" : "password"}
          placeholder="Ulangi password baru"
          autoComplete="new-password"
          className="h-11 rounded-2xl bg-surface-container-low px-3.5 font-body text-body text-text-primary outline-none focus:ring-2 focus:ring-brand-500/40"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSandiTerlihat(!sandiTerlihat)}
            className="font-caption text-caption text-brand-700 flex items-center gap-1"
          >
            <Icon
              name={sandiTerlihat ? "visibility_off" : "visibility"}
              className="text-[16px]"
            />
            {sandiTerlihat ? "Sembunyikan" : "Tampilkan"}
          </button>
          <span className="font-caption text-caption text-text-muted">
            Jangan pakai kata sandi yang dipakai di layanan lain.
          </span>
        </div>
        <button
          type="button"
          onClick={kirimSandi}
          disabled={
            sibuk !== null ||
            sandi.passwordLama.length === 0 ||
            sandi.passwordBaru.length === 0
          }
          className="h-11 rounded-full bg-brand-600 text-white font-body-bold text-body-bold flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {sibuk === "sandi" ? (
            <Icon name="progress_activity" className="text-[18px] animate-spin" />
          ) : (
            <Icon name="lock_reset" className="text-[18px]" />
          )}
          Ganti Kata Sandi
        </button>
      </Modal>

      {berkasCrop ? (
        <AvatarCropper
          berkas={berkasCrop}
          onBatal={() => {
            setBerkasCrop(null);
            if (fileRef.current) fileRef.current.value = "";
          }}
          onSimpan={(hasil) => void unggahFoto(hasil)}
        />
      ) : null}
    </div>
  );
}
