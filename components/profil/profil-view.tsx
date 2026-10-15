"use client";

import Link from "next/link";
import { initials } from "@/lib/format";
import type { ProfileMenuItem } from "@/lib/rbac";

type MenuItem = ProfileMenuItem;

export function ProfilView({
  profile,
  branch,
  menu,
  canManageLocation,
}: {
  profile: {
    id: string;
    fullName: string;
    email: string;
    phone: string | null;
    role: string;
    roleLabel: string;
  };
  branch: {
    name: string;
    latitude: number | null;
    longitude: number | null;
    openTime: string;
    closeTime: string;
  };
  menu: MenuItem[];
  canManageLocation: boolean;
}) {
  const branchConfigured = branch.latitude !== null && branch.longitude !== null;
  const visibleMenu = menu;
  const initialsValue = initials(profile.fullName);

  return (
    <div className="flex flex-col w-full pb-nav">
      {/* Kartu identitas */}
      <section className="px-gutter pt-4">
        <div className="relative overflow-hidden rounded-[24px] p-5 primary-gradient text-on-primary clay-glow">
          <div className="absolute -right-6 -bottom-6 opacity-10 pointer-events-none text-white">
            <span className="material-symbols-outlined text-[130px]">
              account_circle
            </span>
          </div>
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-16 h-16 rounded-[22px] bg-white/20 backdrop-blur-md flex items-center justify-center font-headline-1 text-headline-1 text-white shrink-0">
              {initialsValue}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-headline-2 text-headline-2 text-white leading-tight truncate">
                {profile.fullName}
              </h1>
              <span className="font-micro-badge text-micro-badge uppercase tracking-wider text-brand-100 block mt-0.5">
                {profile.roleLabel}
              </span>
              <span className="font-caption text-caption text-blue-50 block truncate mt-1">
                {profile.email}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Kartu cabang */}
      <section className="px-gutter pt-2.5">
        <div className="bg-surface rounded-[20px] p-4 clay-card border border-white/80 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[22px]">garage</span>
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-caption text-caption text-text-muted block">
              Cabang Penempatan
            </span>
            <span className="font-body-bold text-body-bold text-text-primary block truncate">
              {branch.name}
            </span>
            <span className="font-caption text-caption text-text-secondary block">
              Jam operasional {branch.openTime.slice(0, 5)} -{" "}
              {branch.closeTime.slice(0, 5)} WIB
            </span>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-micro-badge text-micro-badge shrink-0 ${
              branchConfigured
                ? "bg-success-surface text-success-text"
                : "bg-warning-surface text-warning-text"
            }`}
          >
            <span className="material-symbols-outlined text-[13px]">
              {branchConfigured ? "verified" : "wrong_location"}
            </span>
            {branchConfigured ? "Lokasi OK" : "Belum Diatur"}
          </span>
        </div>
      </section>

      {/* Menu modul */}
      <section className="px-gutter pt-2.5">
        <div className="bg-surface rounded-[20px] p-2 clay-card border border-white/80">
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
            <span className="material-symbols-outlined text-brand-600 text-[18px]">
              apps
            </span>
            <span className="font-body-bold text-body-bold text-text-primary">
              Modul Saya
            </span>
          </div>
          {visibleMenu.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-surface-container-low active:scale-[0.99] transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px]">
                  {item.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-body-bold text-body-bold text-text-primary block">
                  {item.label}
                </span>
                <span className="font-caption text-caption text-text-muted block truncate">
                  {item.caption}
                </span>
              </div>
              <span className="material-symbols-outlined text-text-muted text-[20px] shrink-0">
                chevron_right
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Catatan lokasi cabang */}
      {!branchConfigured && canManageLocation ? (
        <section className="px-gutter pt-2.5">
          <Link
            href="/absensi"
            className="block bg-warning-surface rounded-[16px] p-3.5 flex items-start gap-2.5 active:scale-[0.99] transition-transform"
          >
            <span className="material-symbols-outlined text-warning-text text-[20px] mt-0.5">
              wrong_location
            </span>
            <div className="flex-1 min-w-0">
              <span className="font-body-bold text-body-bold text-warning-text block">
                Lokasi cabang belum diatur
              </span>
              <span className="font-caption text-caption text-warning-text/90 block mt-0.5">
                Atur titik koordinat cabang dari halaman Absensi Biometrik agar
                geofence kehadiran aktif.
              </span>
            </div>
          </Link>
        </section>
      ) : null}

      {/* Keluar */}
      <section className="px-gutter pt-3">
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full h-[50px] rounded-full bg-danger-surface text-danger-text font-body-bold text-body-bold flex items-center justify-center gap-2.5 active:scale-[0.98] transition-transform"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            Keluar dari Aplikasi
          </button>
        </form>
        <p className="font-caption text-caption text-text-muted text-center mt-2">
          RB Autoluxe Workshop OS · v0.1
        </p>
      </section>
    </div>
  );
}