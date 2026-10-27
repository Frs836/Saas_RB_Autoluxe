"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createStaffProfile } from "@/app/actions/staff";
import { useToast } from "@/components/toast";
import { Icon } from "@/components/ui/icon";

type Branch = { id: string; name: string };

export function StaffCreateForm({ branches }: { branches: { id: string; name: string }[] }) {
  const router = useRouter();
  const { sukses, gagal } = useToast();
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    phoneNumber: "",
    dateOfBirth: "",
    password: "",
    branchId: "",
    role: "karyawan" as "karyawan" | "admin_kasir" | "maintainer" | "owner",
    workSchedule: "field" as "field" | "office",
    isActive: true,
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof typeof formData, string>>>({});
  const [passwordVisible, setPasswordVisible] = useState(false);

  const validateField = (name: string, value: string) => {
    switch (name) {
      case "fullName":
        if (!value.trim()) return "Nama lengkap wajib diisi";
        break;
      case "email":
        if (!value.trim()) return "Email wajib diisi";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "Format email tidak valid";
        break;
      case "password":
        if (!value) return "Password wajib diisi";
        if (value.length < 8) return "Password minimal 8 karakter";
        break;
      case "dateOfBirth":
        if (!value) return "Tanggal lahir wajib diisi";
        if (new Date(value) > new Date()) return "Tanggal lahir tidak boleh di masa depan";
        break;
      case "branchId":
        if (!value) return "Cabang wajib dipilih";
        break;
    }
    return "";
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    const error = validateField(name, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all fields
    const newErrors: typeof errors = {};
    (["fullName", "email", "password", "dateOfBirth", "branchId"] as const).forEach((field) => {
      const error = validateField(field, formData[field]);
      if (error) newErrors[field] = error;
    });

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      gagal("Error", "Periksa kembali isian yang ditandai");
      return;
    }

    setLoading(true);
    try {
      const result = await createStaffProfile(formData);
      if (!result.ok) throw new Error(result.message);

      sukses("Sukses", "Staf berhasil ditambahkan");
      router.refresh();
      // Reset form
      setFormData({
        fullName: "",
        email: "",
        phoneNumber: "",
        dateOfBirth: "",
        password: "",
        branchId: "",
        role: "karyawan",
        workSchedule: "field",
        isActive: true,
      });
    } catch (err) {
      gagal("Error", err instanceof Error ? err.message : "Gagal menambah staf");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto">
      {/* Nama Lengkap */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Nama Lengkap <span className="text-danger">*</span>
        </label>
        <input
          name="fullName"
          value={formData.fullName}
          onChange={e => setFormData({ ...formData, fullName: e.target.value })}
          required={true}
          className={`w-full px-3 py-2 rounded-xl border ${errors.fullName ? "border-danger" : "border-border-subtle"} bg-surface text-text-primary focus:ring-2 focus:ring-brand-400`}
          placeholder="Nama lengkap staf"
        />
        {errors.fullName && <p className="text-sm text-danger mt-1">{errors.fullName}</p>}
      </div>

      {/* Email */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Email <span className="text-danger">*</span>
        </label>
        <input
          type="email"
          name="email"
          value={formData.email}
          onChange={e => setFormData({ ...formData, email: e.target.value })}
          required={true}
          className={`w-full px-3 py-2 rounded-xl border ${errors.email ? "border-danger" : "border-border-subtle"} bg-surface text-text-primary focus:ring-2 focus:ring-brand-400`}
          placeholder="staf@rbautoluxe.com"
        />
        {errors.email && <p className="text-sm text-danger mt-1">{errors.email}</p>}
      </div>

      {/* Password */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          Password <span className="text-danger">*</span>
        </label>
        <div className="relative">
          <input
            type={passwordVisible ? "text" : "password"}
            name="password"
            value={formData.password}
            onChange={e => setFormData({ ...formData, password: e.target.value })}
            minLength={8}
            required={true}
            className={`w-full px-3 py-2 rounded-xl border ${errors.password ? "border-danger" : "border-border-subtle"} bg-surface text-text-primary focus:ring-2 focus:ring-brand-400 pr-12`}
            placeholder="Minimal 8 karakter"
          />
          <button
            type="button"
            onClick={() => setPasswordVisible(!passwordVisible)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            aria-label={passwordVisible ? "Sembunyikan password" : "Tampilkan password"}
          >
            <Icon name={passwordVisible ? "visibility_off" : "visibility"} className="text-[20px]" />
          </button>
        </div>
        {errors.password && <p className="text-sm text-danger mt-1">{errors.password}</p>}
        <p className="text-xs text-text-muted mt-1">Minimal 8 karakter</p>
      </div>

      {/* Nomor WhatsApp */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Nomor WhatsApp</label>
        <input
          name="phoneNumber"
          type="tel"
          value={formData.phoneNumber}
          onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })}
          placeholder="0812 3456 7890"
          className="w-full px-3 py-2 rounded-xl border border-border-subtle bg-surface text-text-primary focus:ring-2 focus:ring-brand-400"
        />
      </div>

      {/* Tanggal Lahir */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Tanggal Lahir <span className="text-danger">*</span></label>
        <input
          type="date"
          name="dateOfBirth"
          value={formData.dateOfBirth}
          onChange={e => setFormData({ ...formData, dateOfBirth: e.target.value })}
          max={new Date().toISOString().split("T")[0]}
          required={true}
          className={`w-full px-3 py-2 rounded-xl border ${errors.dateOfBirth ? "border-danger" : "border-border-subtle"} bg-surface text-text-primary focus:ring-2 focus:ring-brand-400`}
        />
        {errors.dateOfBirth && <p className="text-sm text-danger mt-1">{errors.dateOfBirth}</p>}
      </div>

      {/* Cabang */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Cabang <span className="text-danger">*</span></label>
        <select
          name="branchId"
          value={formData.branchId}
          onChange={e => setFormData({ ...formData, branchId: e.target.value })}
          required={true}
          className={`w-full px-3 py-2 rounded-xl border ${errors.branchId ? "border-danger" : "border-border-subtle"} bg-surface text-text-primary focus:ring-2 focus:ring-brand-400`}
        >
          <option value="">Pilih cabang</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        {errors.branchId && <p className="text-sm text-danger mt-1">{errors.branchId}</p>}
      </div>

      {/* Role */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Role <span className="text-danger">*</span></label>
        <select
          name="role"
          value={formData.role}
          onChange={e => setFormData({ ...formData, role: e.target.value as any })}
          required
          className="w-full px-3 py-2 rounded-xl border border-border-subtle bg-surface text-text-primary focus:ring-2 focus:ring-brand-400"
        >
          <option value="karyawan">Karyawan</option>
          <option value="admin_kasir">Admin Kasir</option>
          <option value="maintainer">Maintainer</option>
          <option value="owner">Owner</option>
        </select>
      </div>

      {/* Jadwal Kerja */}
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1">Jadwal Kerja</label>
        <select
          name="workSchedule"
          value={formData.workSchedule}
          onChange={e => setFormData({ ...formData, workSchedule: e.target.value as any })}
          className="w-full px-3 py-2 rounded-xl border border-border-subtle bg-surface text-text-primary focus:ring-2 focus:ring-brand-400"
        >
          <option value="field">Lapangan</option>
          <option value="office">Kantor</option>
        </select>
      </div>

      {/* Submit */}
      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex-1 py-3 rounded-xl bg-surface-container text-text-secondary font-medium active:scale-95"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={loading}
          className="flex-1 py-3 rounded-xl bg-primary text-white font-medium active:scale-95 disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Menyimpan...
            </>
          ) : (
            <>
              <Icon name="save" className="text-[18px]" />
              Simpan Staf
            </>
          )}
        </button>
      </div>
    </form>
  );
}