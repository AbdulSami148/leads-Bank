"use client";

/**
 * Toast notifications: a ToastProvider around the whole app (see app/layout.tsx)
 * plus a useToast() hook. Toasts stack in the top-right corner and auto-dismiss.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";

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
  success: "border-green-200 bg-green-50 text-green-800",
  error: "border-red-200 bg-red-50 text-red-700",
  info: "border-gray-200 bg-white text-gray-700",
};

const TOAST_ICONS: Record<ToastKind, string> = {
  success: "✓",
  error: "!",
  info: "i",
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
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-md ${TOAST_STYLES[toast.kind]}`}
          >
            <span className="mt-0.5 font-semibold">{TOAST_ICONS[toast.kind]}</span>
            <span className="min-w-0 break-words">{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
