"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatRupiah } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-headline-2 text-headline-2 text-text-primary">
            Tarif Komisi Karyawan
          </h2>
          <p className="font-caption text-caption text-text-muted mt-0.5">
            Setting berlaku untuk Laporan Komisi — dihitung otomatis per order.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          disabled={pending}
          className="flex items-center gap-1.5 px-4 h-10 rounded-xl primary-gradient text-white font-body-bold text-body-bold active:scale-95 transition-transform shrink-0"
        >
          <Icon name="add" className="text-[18px]" />
          <span className="hidden sm:inline">Tambah</span>
        </button>
      </div>

      {/* Form modal overlay */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="bg-surface rounded-[20px] clay-card w-full max-w-sm flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-headline-2 text-headline-2 text-text-primary">
                {editId ? "Edit Komisi" : "Tambah Komisi"}
              </h3>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container"
              >
                <Icon name="close" className="text-[20px] text-text-muted" />
              </button>
            </div>

            {/* Karyawan */}
            <div className="flex flex-col gap-1">
              <label className="font-caption text-caption text-text-muted">
                Karyawan
              </label>
              <select
                value={formProfileId}
                onChange={(e) => setFormProfileId(e.target.value)}
                className="h-11 rounded-xl border border-border-subtle px-3 font-body-regular text-body-regular text-text-primary bg-surface"
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
              <label className="font-caption text-caption text-text-muted">
                Jasa{" "}
                <span className="text-text-muted/60">(kosong = semua jasa)</span>
              </label>
              <select
                value={formServiceId}
                onChange={(e) => setFormServiceId(e.target.value)}
                className="h-11 rounded-xl border border-border-subtle px-3 font-body-regular text-body-regular text-text-primary bg-surface"
              >
                <option value="">— Semua Jasa —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Tipe komisi */}
            <div className="flex flex-col gap-1">
              <label className="font-caption text-caption text-text-muted">
                Tipe Komisi
              </label>
              <div className="flex gap-2">
                {(["percent", "flat"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFormType(t)}
                    className={`flex-1 h-11 rounded-xl border font-body-bold text-body-bold transition-colors ${
                      formType === t
                        ? "primary-gradient text-white border-transparent"
                        : "border-border-subtle text-text-secondary bg-surface"
                    }`}
                  >
                    {t === "percent" ? "Persen (%)" : "Flat (Rp)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Nilai */}
            <div className="flex flex-col gap-1">
              <label className="font-caption text-caption text-text-muted">
                Nilai{" "}
                {formType === "percent" ? "(contoh: 5 = 5%)" : "(contoh: 10000 = Rp 10.000)"}
              </label>
              <input
                type="number"
                min={0}
                step={formType === "percent" ? 0.5 : 1000}
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                placeholder={formType === "percent" ? "Misal: 5" : "Misal: 10000"}
                className="h-11 rounded-xl border border-border-subtle px-3 font-body-regular text-body-regular text-text-primary bg-surface"
              />
            </div>

            {formError && (
              <p className="font-caption text-caption text-danger-text bg-danger-surface rounded-xl px-3 py-2">
                {formError}
              </p>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="h-12 rounded-xl primary-gradient text-white font-body-bold text-body-bold active:scale-95 transition-transform"
            >
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </div>
      )}

      {/* Grouped list */}
      <div className="flex flex-col gap-3">
        {grouped.map(({ profile, rules }) => (
          <div key={profile.id} className="clay-card rounded-[16px] overflow-hidden">
            {/* Profile header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant">
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
                title="Tambah rule baru untuk karyawan ini"
                className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-brand-50 text-brand-600 transition-colors"
              >
                <Icon name="add" className="text-[18px]" />
              </button>
            </div>

            {/* Rules */}
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant last:border-0"
              >
                {/* Type badge */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                    rule.commissionType === "percent"
                      ? "bg-brand-50 text-brand-600"
                      : "bg-amber-50 text-amber-600"
                  }`}
                >
                  <Icon
                    name={rule.commissionType === "percent" ? "percent" : "payments"}
                    className="text-[16px]"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-body-bold text-body-bold text-text-primary">
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

                {/* Active toggle */}
                <button
                  type="button"
                  onClick={() => handleToggle(rule)}
                  disabled={pending}
                  title={rule.isActive ? "Non-aktifkan" : "Aktifkan"}
                  className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                    rule.isActive ? "bg-brand-500" : "bg-surface-container-low"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      rule.isActive ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>

                {/* Edit */}
                <button
                  type="button"
                  onClick={() => openEdit(rule)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-surface-container text-text-muted transition-colors"
                >
                  <Icon name="edit" className="text-[16px]" />
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => handleDelete(rule.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-danger-surface text-danger-text transition-colors"
                >
                  <Icon name="delete" className="text-[16px]" />
                </button>
              </div>
            ))}
          </div>
        ))}

        {/* Staf tanpa setting */}
        {noRule.length > 0 && (
          <div className="clay-card rounded-[16px] p-4">
            <p className="font-caption text-caption text-text-muted mb-3">
              Karyawan belum punya setting komisi:
            </p>
            <div className="flex flex-col gap-2">
              {noRule.map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-container-low flex items-center justify-center shrink-0">
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
                    className="text-brand-600 font-caption text-caption hover:underline shrink-0"
                  >
                    + Tambah
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {settings.length === 0 && profiles.length === 0 && (
          <div className="clay-card rounded-[16px] p-8 flex flex-col items-center gap-3 text-center">
            <Icon name="badge" className="text-[48px] text-text-muted" />
            <p className="font-body-bold text-body-bold text-text-primary">
              Belum ada setting komisi
            </p>
            <p className="font-caption text-caption text-text-muted">
              Tekan tombol &quot;Tambah&quot; untuk membuat tarif komisi pertama.
            </p>
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="clay-card rounded-[16px] p-4 bg-brand-50/50 border border-brand-100">
        <div className="flex items-start gap-2">
          <Icon name="info" className="text-brand-600 text-[18px] shrink-0 mt-0.5" />
          <div>
            <p className="font-body-bold text-body-bold text-brand-700">
              Cara kerja komisi
            </p>
            <ul className="mt-1 space-y-1 font-caption text-caption text-brand-700/80 list-disc list-inside">
              <li>
                <strong>Persen:</strong> nilai × total_order / 100 — dihitung per order yang dikerjakan.
              </li>
              <li>
                <strong>Flat:</strong> nilai tetap per order, berapapun harganya.
              </li>
              <li>
                Jika ada setting untuk jasa tertentu, rule itu lebih diprioritaskan daripada rule &quot;Semua Jasa&quot;.
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
