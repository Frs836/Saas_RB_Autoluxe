"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type NotificationRow = {
  id: string;
  title: string | null;
  body: string | null;
  category: string | null;
  is_read: boolean | null;
  created_at: string | null;
};

function formatWhen(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(date);
}

const CATEGORY_ICON: Record<string, string> = {
  order: "assignment",
  stock: "inventory_2",
  warranty: "verified_user",
  shift: "schedule",
  attendance: "badge",
  finance: "payments",
};

export function NotificationBell({
  profileId,
  hasUnread,
}: {
  profileId: string;
  hasUnread: boolean;
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(hasUnread);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("id, title, body, category, is_read, created_at")
      .eq("recipient_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20);
    const rows = (data as NotificationRow[] | null) ?? [];
    setItems(rows);
    setUnread(rows.some((row) => !row.is_read));
    setLoading(false);
  }, [profileId, supabase]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  async function markAllRead() {
    const unreadIds = items.filter((row) => !row.is_read).map((row) => row.id);
    if (unreadIds.length === 0) return;
    setItems((prev) => prev.map((row) => ({ ...row, is_read: true })));
    setUnread(false);
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .in("id", unreadIds);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Notifikasi Operasional"
        onClick={() => setOpen(true)}
        className="relative w-9 h-9 rounded-xl bg-surface-container-low flex items-center justify-center text-text-secondary shadow-[inset_0px_2px_4px_rgba(255,255,255,0.95)] active:scale-[0.98] transition-transform"
      >
        <span className="material-symbols-outlined text-[20px]">
          notifications
        </span>
        {unread && (
          <span className="absolute top-2 right-2 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger-base opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-danger-base" />
          </span>
        )}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[460px] max-h-[80vh] bg-surface rounded-t-[24px] sm:rounded-[24px] flex flex-col clay-card overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-surface-container">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-brand-600 text-[22px]">
                  notifications
                </span>
                <span className="font-headline-2 text-headline-2 text-text-primary">
                  Notifikasi
                </span>
              </div>
              <div className="flex items-center gap-2">
                {unread ? (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="font-caption text-caption text-brand-600 font-semibold"
                  >
                    Tandai dibaca
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Tutup"
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-surface-container transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    close
                  </span>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto p-4 flex flex-col gap-3">
              {loading ? (
                <p className="font-body-regular text-body-regular text-text-muted text-center py-8">
                  Memuat notifikasi...
                </p>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-10 text-text-muted">
                  <span className="material-symbols-outlined text-[40px]">
                    notifications_off
                  </span>
                  <p className="font-caption text-caption">
                    Belum ada notifikasi
                  </p>
                </div>
              ) : (
                items.map((row) => (
                  <div
                    key={row.id}
                    className={`flex gap-3 rounded-2xl p-3 ${
                      row.is_read
                        ? "bg-surface-container/50"
                        : "bg-brand-50"
                    }`}
                  >
                    <span className="w-9 h-9 rounded-xl bg-surface flex items-center justify-center shrink-0 text-brand-600">
                      <span className="material-symbols-outlined text-[20px]">
                        {CATEGORY_ICON[row.category ?? ""] ?? "notifications"}
                      </span>
                    </span>
                    <div className="min-w-0">
                      <p className="font-body-bold text-body-bold text-text-primary">
                        {row.title ?? "Notifikasi"}
                      </p>
                      {row.body ? (
                        <p className="font-caption text-caption text-text-secondary leading-relaxed">
                          {row.body}
                        </p>
                      ) : null}
                      <p className="font-caption text-caption text-text-muted mt-1">
                        {formatWhen(row.created_at)}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
