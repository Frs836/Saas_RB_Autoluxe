"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

/* ------------------------------------------------------------------ types */
export type CommissionSetting = {
  id: string;
  profileId: string;
  serviceId: string | null;
  commissionType: "percent" | "flat";
  value: number;
  isActive: boolean;
};

export type StaffProfile = {
  id: string;
  fullName: string;
  role: string;
};

export type ServiceOption = {
  id: string;
  name: string;
};

/* ---------------------------------------------------------------- helpers */
function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

const ROLE_LABELS: Record<string, string> = {
  karyawan: "Karyawan",
  kepala_karyawan: "Kepala Karyawan",
  admin_kasir: "Admin Kasir",
  manager: "Manager",
};

/* --------------------------------------------------------------- component */
export function KomisiSettingView({
  initialSettings,
  profiles,
  services,
}: {
  initialSettings: CommissionSetting[];
  profiles: StaffProfile[];
  services: ServiceOption[];
}) {
  const [settings, setSettings] =
    useState<CommissionSetting[]>(initialSettings);
  const [pending, startTransition] = useTransition();

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formProfileId, setFormProfileId] = useState(profiles[0]?.id ?? "");
  const [formServiceId, setFormServiceId] = useState<string>("");
  const [formType, setFormType] = useState<"percent" | "flat">("percent");
  const [formValue, setFormValue] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  /* open form for new */
  function openNew() {
    setEditId(null);
    setFormProfileId(profiles[0]?.id ?? "");
    setFormServiceId("");
    setFormType("percent");
    setFormValue("");
    setFormError(null);
    setShowForm(true);
  }

  /* open form for edit */
  function openEdit(s: CommissionSetting) {
    setEditId(s.id);
    setFormProfileId(s.profileId);
    setFormServiceId(s.serviceId ?? "");
    setFormType(s.commissionType);
    setFormValue(String(s.value));
    setFormError(null);
    setShowForm(true);
  }

  /* validate */
  function validate(): string | null {
    if (!formProfileId) return "Pilih karyawan.";
    const val = parseFloat(formValue);
    if (isNaN(val) || val <= 0) return "Nilai komisi harus > 0.";
    if (formType === "percent" && val > 100)
      return "Persen tidak boleh > 100%.";
    return null;
  }

  /* save (insert or update) */
  function handleSave() {
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);

    startTransition(async () => {
      const supabase = createClient();
      const payload = {
        profile_id: formProfileId,
        service_id: formServiceId || null,
        commission_type: formType,
        value: parseFloat(formValue),
        is_active: true,
      };

      if (editId) {
        // UPDATE
        const { error } = await supabase
          .from("commission_settings")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", editId);
        if (error) {
          setFormError(error.message);
          return;
        }
        setSettings((prev) =>
          prev.map((s) =>
            s.id === editId
              ? {
                  ...s,
                  profileId: formProfileId,
                  serviceId: formServiceId || null,
                  commissionType: formType,
                  value: parseFloat(formValue),
                }
              : s,
          ),
        );
      } else {
        // INSERT
        const { data, error } = await supabase
          .from("commission_settings")
          .insert(payload)
          .select("id, profile_id, service_id, commission_type, value, is_active")
          .single();
        if (error) {
          setFormError(error.message);
          return;
        }
        if (data) {
          setSettings((prev) => [
            {
              id: data.id as string,
              profileId: data.profile_id as string,
              serviceId: (data.service_id as string | null) ?? null,
              commissionType: data.commission_type as "percent" | "flat",
              value: Number(data.value),
              isActive: Boolean(data.is_active),
            },
            ...prev,
          ]);
        }
      }
      setShowForm(false);
    });
  }

  /* toggle active */
  function handleToggle(s: CommissionSetting) {
    startTransition(async () => {
      const supabase = createClient();
      await supabase
        .from("commission_settings")
        .update({ is_active: !s.isActive, updated_at: new Date().toISOString() })
        .eq("id", s.id);
      setSettings((prev) =>
        prev.map((r) =>
          r.id === s.id ? { ...r, isActive: !r.isActive } : r,
        ),
      );
    });
  }

  /* delete */
  function handleDelete(id: string) {
    if (!confirm("Hapus setting komisi ini?")) return;
    startTransition(async () => {
      const supabase = createClient();
      await supabase.from("commission_settings").delete().eq("id", id);
      setSettings((prev) => prev.filter((s) => s.id !== id));
    });
  }

  /* helpers for display */
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const serviceMap = new Map(services.map((s) => [s.id, s.name]));

  /* group by profile */
  const grouped = profiles
    .map((p) => ({
      profile: p,
      rules: settings.filter((s) => s.profileId === p.id),
    }))
    .filter((g) => g.rules.length > 0);

  /* profiles without any rule */
  const profilesWithRules = new Set(settings.map((s) => s.profileId));
  const noRule = profiles.filter((p) => !profilesWithRules.has(p.id));

  return (
    <div className="px-gutter py-4 flex flex-col gap-4 lg:max-w-4xl lg:mx-auto lg:px-6 pb-32">
      {/* Header action */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Pengaturan Komisi Karyawan
          </h2>
          <p className="font-caption text-caption text-text-muted mt-0.5">
            Atur tarif persen atau nominal tetap per order untuk perhitungan laporan komisi.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          disabled={pending}
          className="flex items-center gap-1.5 px-4 min-h-[44px] rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-body-bold hover:opacity-95 transition-opacity shrink-0"
        >
          <Icon name="add" className="text-[18px]" />
          <span className="hidden sm:inline">Tambah Aturan</span>
        </button>
      </div>

      {/* Form modal overlay */}
      {showForm && (
        <Modal
          open={showForm}
          onClose={() => setShowForm(false)}
          title={editId ? "Edit Aturan Komisi" : "Tambah Aturan Komisi"}
        >
          {/* Karyawan */}
          <div className="flex flex-col gap-1">
            <label className="font-caption text-caption text-text-secondary">
              Karyawan
            </label>
            <select
              value={formProfileId}
              onChange={(e) => setFormProfileId(e.target.value)}
              className="h-11 rounded-[8px] border border-border px-3 font-body text-body text-text-primary bg-surface"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} ({ROLE_LABELS[p.role] ?? p.role})
                </option>
              ))}
            </select>
          </div>

          {/* Jasa (opsional) */}
          <div className="flex flex-col gap-1">
            <label className="font-caption text-caption text-text-secondary">
              Jasa{" "}
              <span className="text-text-muted">(kosong = semua jasa)</span>
            </label>
            <select
              value={formServiceId}
              onChange={(e) => setFormServiceId(e.target.value)}
              className="h-11 rounded-[8px] border border-border px-3 font-body text-body text-text-primary bg-surface"
            >
              <option value="">Semua Jasa</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tipe komisi */}
          <div className="flex flex-col gap-1">
            <label className="font-caption text-caption text-text-secondary">
              Tipe Komisi
            </label>
            <div className="flex gap-2">
              {(["percent", "flat"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFormType(t)}
                  className={`flex-1 min-h-[44px] rounded-[8px] border font-body-bold text-body-bold transition-colors ${
                    formType === t
                      ? "bg-primary text-white border-primary"
                      : "border-border text-text-secondary bg-surface hover:bg-surface-variant"
                  }`}
                >
                  {t === "percent" ? "Persen (%)" : "Flat (Rp)"}
                </button>
              ))}
            </div>
          </div>

          {/* Nilai */}
          <div className="flex flex-col gap-1">
            <label className="font-caption text-caption text-text-secondary">
              Nilai{" "}
              {formType === "percent" ? "(contoh: 5 untuk 5%)" : "(contoh: 10000 untuk Rp 10.000)"}
            </label>
            <input
              type="number"
              min={0}
              step={formType === "percent" ? 0.5 : 1000}
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              placeholder={formType === "percent" ? "Misal: 5" : "Misal: 10000"}
              className="h-11 rounded-[8px] border border-border px-3 font-body text-body text-text-primary bg-surface tabular-nums"
            />
          </div>

          {formError && (
            <p className="font-caption text-caption text-danger-text bg-danger-surface border border-red-200 rounded-[8px] px-3 py-2">
              {formError}
            </p>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="min-h-[44px] rounded-[8px] primary-gradient clay-glow text-white font-body-bold text-body-bold hover:opacity-95 transition-opacity mt-2"
          >
            {pending ? "Menyimpan..." : "Simpan Aturan"}
          </button>
        </Modal>
      )}

      {/* Grouped list */}
      <div className="flex flex-col gap-3">
        {grouped.map(({ profile, rules }) => (
          <div key={profile.id} className="clay-card rounded-[10px] overflow-hidden">
            {/* Profile header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
              <div className="w-9 h-9 rounded-full primary-gradient flex items-center justify-center shrink-0">
                <span className="font-body-bold text-[12px] text-white leading-none">
                  {initials(profile.fullName)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-body-bold text-body-bold text-text-primary truncate">
                  {profile.fullName}
                </p>
                <p className="font-caption text-caption text-text-muted">
                  {ROLE_LABELS[profile.role] ?? profile.role}
                </p>
              </div>
              <button
                type="button"
                onClick={openNew}
                title="Tambah aturan baru untuk karyawan ini"
                className="w-10 h-10 rounded-[8px] flex items-center justify-center hover:bg-brand-50 text-primary transition-colors"
              >
                <Icon name="add" className="text-[18px]" />
              </button>
            </div>

            {/* Rules */}
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle last:border-0"
              >
                <div
                  className={`w-9 h-9 rounded-[8px] flex items-center justify-center shrink-0 ${
                    rule.commissionType === "percent"
                      ? "bg-brand-50 border border-brand-200 text-primary"
                      : "bg-warning-surface border border-amber-200 text-warning-text"
                  }`}
                >
                  <Icon
                    name={rule.commissionType === "percent" ? "percent" : "payments"}
                    className="text-[16px]"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-body-bold text-body-bold text-text-primary tabular-nums">
                    {rule.commissionType === "percent"
                      ? `${rule.value}% per order`
                      : `${formatRupiah(rule.value)} per order`}
                  </p>
                  <p className="font-caption text-caption text-text-muted truncate">
                    {rule.serviceId
                      ? (serviceMap.get(rule.serviceId) ?? "Jasa tertentu")
                      : "Semua jasa"}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle(rule)}
                  disabled={pending}
                  title={rule.isActive ? "Non-aktifkan" : "Aktifkan"}
                  className={`relative w-11 h-6 rounded-[8px] transition-colors shrink-0 ${
                    rule.isActive ? "bg-primary" : "bg-border-strong"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-[6px] bg-white shadow transition-transform ${
                      rule.isActive ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => openEdit(rule)}
                  aria-label="Edit aturan"
                  className="w-10 h-10 rounded-[8px] flex items-center justify-center hover:bg-surface-variant text-text-secondary transition-colors"
                >
                  <Icon name="edit" className="text-[16px]" />
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  aria-label="Hapus aturan"
                  className="w-10 h-10 rounded-[8px] flex items-center justify-center hover:bg-danger-surface text-danger-text transition-colors"
                >
                  <Icon name="delete" className="text-[16px]" />
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* Staf tanpa setting */}
        {noRule.length > 0 && (
          <div className="clay-card rounded-[10px] p-4">
            <p className="font-caption text-caption text-text-muted mb-3">
              Karyawan belum punya aturan komisi:
            </p>
            <div className="flex flex-col gap-2">
              {noRule.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-variant flex items-center justify-center shrink-0">
                    <span className="font-caption text-caption text-text-muted">
                      {initials(p.fullName)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-body-regular text-body-regular text-text-secondary truncate">
                      {p.fullName}
                    </p>
                    <p className="font-micro-badge text-micro-badge text-text-muted">
                      {ROLE_LABELS[p.role] ?? p.role}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFormProfileId(p.id);
                      setFormServiceId("");
                      setFormType("percent");
                      setFormValue("");
                      setFormError(null);
                      setEditId(null);
                      setShowForm(true);
                    }}
                    className="min-h-[36px] px-2.5 rounded-[8px] bg-brand-50 border border-brand-200 text-primary font-caption text-caption hover:bg-brand-100 shrink-0"
                  >
                    + Tambah
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {settings.length === 0 && profiles.length === 0 && (
          <div className="clay-card rounded-[10px] p-8 flex flex-col items-center gap-3 text-center">
            <Icon name="badge" className="text-[48px] text-text-muted" />
            <p className="font-body-bold text-body-bold text-text-primary">
              Belum ada aturan komisi
            </p>
            <p className="font-caption text-caption text-text-muted">
              Tambah aturan baru agar laporan komisi terhitung otomatis.
            </p>
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="clay-card rounded-[10px] p-4 bg-brand-50 border border-brand-200">
        <div className="flex items-start gap-2">
          <Icon name="info" className="text-primary text-[18px] shrink-0 mt-0.5" />
          <div>
            <p className="font-body-bold text-body-bold text-primary">
              Cara kerja perhitungan komisi
            </p>
            <ul className="mt-1 space-y-1 font-caption text-caption text-text-secondary list-disc list-inside">
              <li>
                <strong>Persen:</strong> nilai dikali total order dibagi 100 untuk setiap order yang dikerjakan.
              </li>
              <li>
                <strong>Flat:</strong> nominal tetap per order, berapapun harga jasanya.
              </li>
              <li>
                Aturan untuk jasa tertentu diprioritaskan di atas aturan Semua Jasa.
              </li>
              <li>
                Hasil kalkulasi muncul di halaman{" "}
                <strong>Laporan Komisi Staf</strong> (/komisi).
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
