"use client";

import * as React from "react";

type ToastProps = {
  title?: string;
  description?: string;
  actionLabel?: React.ReactNode;
  onAction?: () => void;
  variant?: "default" | "destructive" | "success";
  onClose?: () => void;
};

export function Toast({ title, description, actionLabel, onAction, variant = "default", onClose }: ToastProps) {
  const [isVisible, setIsVisible] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      onClose?.();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!isVisible) return null;

  const variantStyles = {
    default: "bg-surface text-text-primary border-border-subtle",
    destructive: "bg-danger-surface text-danger-text border-danger",
    success: "bg-success-surface text-success-text border-success",
  };

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-200 flex items-start gap-3 w-80 max-w-sm rounded-xl border p-4 shadow-xl ${
        variantStyles[variant]
      }`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex-1 min-w-0">
        {title && (
          <div className="font-semibold text-sm">{title}</div>
        )}
        {description && (
          <div className="text-sm opacity-90 mt-1">{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actionLabel && onAction && (
          <button
            onClick={() => {
              onAction();
              setIsVisible(false);
            }}
            className="text-sm font-medium underline hover:opacity-80"
          >
            {actionLabel}
          </button>
        )}
        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          className="p-1 rounded hover:bg-black/10 transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

type ToastContextType = {
  toast: (props: ToastProps) => void;
};

const ToastContext = React.createContext<{ toast: (props: ToastProps) => void } | null>(null);

export function useToast() {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = React.useState<
    Array<ToastProps & { id: string }>
  >([]);

  const toast = React.useCallback((props: ToastProps) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...props, id }]);
    return id;
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onClose={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}