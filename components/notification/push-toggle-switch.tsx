"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";

type PushState = "unsupported" | "loading" | "denied" | "subscribed" | "unsubscribed";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output  = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export function PushToggleSwitch() {
  const [state, setState] = useState<PushState>("loading");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported"); return;
    }
    checkSubscription();
  }, []);

  async function checkSubscription() {
    try {
      const reg  = await navigator.serviceWorker.ready;
      const sub  = await reg.pushManager.getSubscription();
      const perm = Notification.permission;
      if (perm === "denied") { setState("denied"); return; }
      setState(sub ? "subscribed" : "unsubscribed");
    } catch { setState("unsupported"); }
  }

  async function subscribe() {
    setState("loading");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("denied"); return; }

      let reg = await navigator.serviceWorker.getRegistration("/sw.js");
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js");
      }
      await navigator.serviceWorker.ready;

      if (!VAPID_PUBLIC_KEY) {
        console.error("[Push] NEXT_PUBLIC_VAPID_PUBLIC_KEY tidak tersedia");
        setState("unsubscribed");
        return;
      }

      const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer as ArrayBuffer,
      });

      const subJson = sub.toJSON();

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: {
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh ?? "",
              auth:   subJson.keys?.auth   ?? "",
            },
          },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("[Push] Gagal simpan subscription:", err);
      }

      setState(res.ok ? "subscribed" : "unsubscribed");
    } catch (e) {
      console.error("[Push] subscribe error:", e);
      setState("unsubscribed");
    }
  }

  async function unsubscribe() {
    setState("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("unsubscribed");
    } catch { setState("unsubscribed"); }
  }

  if (state === "unsupported") return null;

  const iconName =
    state === "loading"      ? "notifications" :
    state === "denied"       ? "notifications_off" :
    state === "subscribed"   ? "notifications_active" :
                               "notifications";

  const subLabel =
    state === "loading"      ? "Memuat..." :
    state === "denied"       ? "Diblok di pengaturan peramban" :
    state === "subscribed"   ? "Notifikasi aktif di perangkat ini" :
                               "Aktifkan untuk terima peringatan";

  const isDisabled = state === "loading" || state === "denied";

  const handleToggle = () => {
    if (state === "subscribed") void unsubscribe();
    else if (state === "unsubscribed") void subscribe();
  };

  return (
    <div className="bg-surface rounded-[20px] p-4 clay-card border border-white/80 flex items-center gap-3">
      {/* Kiri: ikon + label */}
      <div className="w-11 h-11 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
        <Icon name={iconName} className="text-[22px]" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-body-bold text-body-bold text-text-primary block">
          Notifikasi Perangkat
        </span>
        <span className="font-caption text-caption text-text-muted block">
          {subLabel}
        </span>
      </div>

      {/* Kanan: toggle switch */}
      <button
        type="button"
        role="switch"
        aria-checked={state === "subscribed"}
        aria-label="Toggle notifikasi push"
        onClick={handleToggle}
        disabled={isDisabled}
        className="shrink-0"
      >
        <div
          className={`w-12 h-6 rounded-full transition-colors duration-200 flex items-center px-1 ${
            state === "subscribed" ? "bg-brand-500" : "bg-surface-container-high"
          } ${isDisabled ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          {state === "loading" ? (
            <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (
            <div
              className={`w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${
                state === "subscribed" ? "translate-x-6" : "translate-x-0"
              }`}
            />
          )}
        </div>
      </button>
    </div>
  );
}
