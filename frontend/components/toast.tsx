"use client";

/**
 * Toast notifications: a ToastProvider around the whole app (see app/layout.tsx)
 * plus a useToast() hook. Toasts stack in the top-right corner and auto-dismiss.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

/** Push a toast: toast("success", "Saved."). */
type PushToast = (kind: ToastKind, text: string) => void;

const ToastContext = createContext<PushToast>(() => {});

/** Show a toast from anywhere inside <ToastProvider>. */
export function useToast(): PushToast {
  return useContext(ToastContext);
}

const TOAST_STYLES: Record<ToastKind, string> = {
  success: "border-emerald-200 bg-white text-emerald-900",
  error: "border-rose-200 bg-white text-rose-900",
  info: "border-slate-200 bg-white text-slate-800",
};

const TOAST_ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const TOAST_ICON_COLORS: Record<ToastKind, string> = {
  success: "text-emerald-600",
  error: "text-rose-600",
  info: "text-indigo-600",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback<PushToast>((kind, text) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, text }]);
    // Auto-dismiss after 4 seconds.
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 4000);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Stacked toasts, top-right, above everything else. */}
      <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((toast) => {
          const Icon = TOAST_ICONS[toast.kind];
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex animate-slide-up items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-pop ${TOAST_STYLES[toast.kind]}`}
            >
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TOAST_ICON_COLORS[toast.kind]}`} aria-hidden />
              <span className="min-w-0 break-words">{toast.text}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
