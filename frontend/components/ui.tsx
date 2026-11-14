"use client";

/**
 * Small reusable UI pieces (Tailwind). Kept tiny and typed so pages can focus
 * on their data and layout.
 */

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";

// --- Card ---------------------------------------------------------------------

/** White rounded card with a subtle border — the basic page building block. */
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
      {children}
    </section>
  );
}

// --- Button ---------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-600",
  secondary:
    "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 focus-visible:outline-gray-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

/** Button with a built-in loading state (spinner + disabled — no double submits). */
export function Button({
  variant = "primary",
  loading = false,
  disabled = false,
  type = "button",
  onClick,
  className = "",
  children,
}: {
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  type?: ButtonHTMLAttributes<HTMLButtonElement>["type"];
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {loading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}

// --- Badge ---------------------------------------------------------------------

export type BadgeKind =
  | "pending"
  | "active"
  | "suspended" // account status
  | "running"
  | "done"
  | "failed" // lead job status
  | "complete"
  | "partial"; // daily rollup status

const BADGE_STYLES: Record<BadgeKind, string> = {
  pending: "bg-amber-100 text-amber-800",
  active: "bg-green-100 text-green-800",
  suspended: "bg-red-100 text-red-700",
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-700",
  complete: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-800",
};

/** Colored pill for statuses (accounts, jobs, daily rows). */
export function Badge({ kind, children }: { kind: BadgeKind; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${BADGE_STYLES[kind]}`}
    >
      {children ?? kind}
    </span>
  );
}

// --- Modal ---------------------------------------------------------------------

/** Centered overlay dialog; closes on Escape and on backdrop click. */
export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()} // clicks inside must not close
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- ConfirmDialog ---------------------------------------------------------------------

/** Modal wrapper for actions that need an explicit confirmation first. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="text-sm text-gray-600">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// --- Skeleton ---------------------------------------------------------------------

/** Gray pulsing block used while data is loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200 ${className}`} aria-hidden />;
}

// --- EmptyState ---------------------------------------------------------------------

/** Friendly placeholder for empty lists and load errors. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <p className="font-medium text-gray-700">{title}</p>
      {description && <p className="max-w-sm text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// --- Toggle ---------------------------------------------------------------------

/** Small on/off switch (used for the cooldown flag). */
export function Toggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-blue-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ${
          checked ? "translate-x-[18px]" : "translate-x-1"
        }`}
      />
    </button>
  );
}
