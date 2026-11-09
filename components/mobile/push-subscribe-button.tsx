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

export function PushSubscribeButton() {
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

      const reg = await navigator.serviceWorker.ready;
      const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key.buffer as ArrayBuffer,
      });

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });

      setState(res.ok ? "subscribed" : "unsubscribed");
    } catch { setState("unsubscribed"); }
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

  const config = {
    loading:      { label: "Memuat...",         icon: "hourglass_top", cls: "bg-surface-container-low text-text-secondary opacity-60", disabled: true  },
    denied:       { label: "Notifikasi Diblok", icon: "notifications_off", cls: "bg-danger-surface text-danger-text", disabled: true  },
    subscribed:   { label: "Notifikasi Aktif ✓", icon: "notifications_active", cls: "bg-success-surface text-success-text", disabled: false },
    unsubscribed: { label: "Aktifkan Notifikasi", icon: "notifications", cls: "bg-brand-50 text-brand-700", disabled: false },
  }[state];

  return (
    <button
      type="button"
      disabled={config.disabled}
      onClick={state === "subscribed" ? unsubscribe : subscribe}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-body text-body active:scale-[0.98] transition-transform disabled:cursor-not-allowed ${config.cls}`}
    >
      <Icon name={config.icon} className="text-[20px] shrink-0" />
      <span className="flex-1 text-left">{config.label}</span>
      {state === "subscribed" && (
        <span className="font-micro-badge text-micro-badge opacity-70">Ketuk untuk nonaktifkan</span>
      )}
    </button>
  );
}
