"use client";

/**
 * Shared UI primitives (Tailwind). Every piece is typed and keeps the
 * loading / disabled / focus behaviour consistent across the app.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";

// --- Card ---------------------------------------------------------------------

/** White rounded-2xl card with a hairline border and a soft shadow. */
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white shadow-soft ${className}`}>
      {children}
    </section>
  );
}

/** Card title row with an optional description and an optional action slot. */
export function CardHeader({
  title,
  description,
  action,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// --- Button -------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 active:bg-indigo-800 disabled:bg-indigo-300",
  secondary:
    "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 active:bg-slate-100",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200",
  danger:
    "bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-300",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

/** Button with a built-in loading state (spinner + disabled — no double submits). */
export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  type = "button",
  onClick,
  className = "",
  children,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
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
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]} ${className}`}
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

/** Square icon-only button (needs an aria-label). */
export function IconButton({
  label,
  onClick,
  className = "",
  children,
  ...rest
}: {
  label: string;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "onClick" | "className">) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 active:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// --- Badge --------------------------------------------------------------------

export type BadgeKind =
  | "pending"
  | "active"
  | "suspended" // account status
  | "running"
  | "done"
  | "failed" // lead job status
  | "complete"
  | "partial" // daily rollup status
  | "neutral";

const BADGE_STYLES: Record<BadgeKind, string> = {
  pending: "bg-amber-50 text-amber-700 ring-amber-200/70",
  active: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  suspended: "bg-rose-50 text-rose-700 ring-rose-200/70",
  running: "bg-indigo-50 text-indigo-700 ring-indigo-200/70",
  done: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  failed: "bg-rose-50 text-rose-700 ring-rose-200/70",
  complete: "bg-emerald-50 text-emerald-700 ring-emerald-200/70",
  partial: "bg-amber-50 text-amber-700 ring-amber-200/70",
  neutral: "bg-slate-100 text-slate-600 ring-slate-200/70",
};

const BADGE_DOTS: Record<BadgeKind, string> = {
  pending: "bg-amber-500",
  active: "bg-emerald-500",
  suspended: "bg-rose-500",
  running: "bg-indigo-500",
  done: "bg-emerald-500",
  failed: "bg-rose-500",
  complete: "bg-emerald-500",
  partial: "bg-amber-500",
  neutral: "bg-slate-400",
};

/** Colored pill for statuses (accounts, jobs, daily rows). */
export function Badge({ kind, children }: { kind: BadgeKind; children?: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset ${BADGE_STYLES[kind]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${BADGE_DOTS[kind]}`} aria-hidden />
      {children ?? kind}
    </span>
  );
}

// --- Inputs -------------------------------------------------------------------

const FIELD_BASE =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

/** Shared input styling (exported so special inputs match the normal ones). */
export function inputClassName(extra = ""): string {
  return `${FIELD_BASE} ${extra}`;
}

/** Styled text input (border, focus ring, disabled state). */
export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_BASE} ${className}`} {...rest} />;
}

/** Label + control + optional hint/error, wired up with aria. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// --- Modal --------------------------------------------------------------------

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
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Close on Escape while open; lock the page behind the dialog.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()} // clicks inside must not close
        className="w-full max-w-md animate-scale-in rounded-t-2xl bg-white p-6 shadow-pop outline-none sm:rounded-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

// --- ConfirmDialog ------------------------------------------------------------

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
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
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

// --- Skeleton -----------------------------------------------------------------

/** Pulsing placeholder used while data is loading. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} aria-hidden />;
}

// --- EmptyState ---------------------------------------------------------------

/** Friendly placeholder for empty lists and load errors. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
      )}
      <p className="font-medium text-slate-800">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// --- Alert --------------------------------------------------------------------

type AlertKind = "info" | "success" | "error" | "warning";

const ALERT_STYLES: Record<AlertKind, string> = {
  info: "bg-indigo-50 text-indigo-800 ring-indigo-200/70",
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  error: "bg-rose-50 text-rose-700 ring-rose-200/70",
  warning: "bg-amber-50 text-amber-800 ring-amber-200/70",
};

const ALERT_ICONS: Record<AlertKind, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertCircle,
};

/** Inline status/error box (friendly error states). */
export function Alert({
  kind = "info",
  children,
  className = "",
}: {
  kind?: AlertKind;
  children: ReactNode;
  className?: string;
}) {
  const Icon = ALERT_ICONS[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm ring-1 ring-inset ${ALERT_STYLES[kind]} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

// --- Toggle -------------------------------------------------------------------

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
        checked ? "bg-indigo-600" : "bg-slate-300"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${
          checked ? "translate-x-[18px]" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// --- Progress -----------------------------------------------------------------

/** Horizontal progress bar (quota usage). */
export function ProgressBar({
  value,
  max,
  className = "",
  tone = "indigo",
}: {
  value: number;
  max: number;
  className?: string;
  tone?: "indigo" | "emerald" | "amber";
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const tones = {
    indigo: "bg-indigo-600",
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
  };
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tones[tone]}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/** Circular progress ring — used for the quota hero card. */
export function ProgressRing({
  value,
  max,
  size = 148,
  stroke = 12,
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-100"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-indigo-600 transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

// --- Avatar -------------------------------------------------------------------

const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
];

/** Initials avatar with a color picked from the name (stable per address).
 * Shows a SINGLE uppercase initial from username (preferred) or email. */
export function Avatar({
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const displayName = name || "?";
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";
  const tone = AVATAR_TONES[
    displayName.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length
  ];
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-12 w-12 text-base",
  };
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tone} ${sizes[size]} ${className}`}
      title={displayName}
    >
      {initial}
    </span>
  );
}

// --- StatCard -----------------------------------------------------------------

/** One number with a label and an optional icon — the admin stats row. */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  loading = false,
}: {
  label: string;
  value?: number;
  icon?: LucideIcon;
  hint?: string;
  loading?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          {loading || value === undefined ? (
            <Skeleton className="mt-2 h-8 w-16" />
          ) : (
            <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
          )}
          {hint && <p className="mt-1 truncate text-xs text-slate-400">{hint}</p>}
        </div>
        {Icon && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </div>
    </Card>
  );
}

// --- Dropdown -----------------------------------------------------------------

export interface DropdownTriggerProps {
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "menu";
  ref: React.Ref<HTMLButtonElement>;
}

export interface DropdownItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}

/** Keyboard-friendly dropdown menu (Escape closes, focus returns to trigger). */
export function Dropdown({
  trigger,
  items,
  align = "right",
  menuLabel,
}: {
  /** Renders the trigger button; spread the given props onto it. */
  trigger: (props: DropdownTriggerProps) => ReactNode;
  items: DropdownItem[];
  align?: "left" | "right";
  menuLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | HTMLAnchorElement | null)[]>([]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  function select(item: DropdownItem) {
    if (item.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    item.onSelect?.();
  }

  return (
    <div className="relative" ref={rootRef}>
      {trigger({
        onClick: () => setOpen((value) => !value),
        "aria-expanded": open,
        "aria-haspopup": "menu",
        ref: triggerRef,
      })}
      {open && (
        <div
          role="menu"
          aria-label={menuLabel}
          className={`absolute z-50 mt-2 w-56 animate-scale-in overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-pop ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            const className = `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${
              item.danger
                ? "text-rose-600 hover:bg-rose-50"
                : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            } ${item.disabled ? "cursor-not-allowed opacity-50" : ""}`;
            const content = (
              <>
                {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
                {item.label}
              </>
            );
            return item.href ? (
              <Link
                key={item.id}
                role="menuitem"
                href={item.href}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                className={className}
              >
                {content}
              </Link>
            ) : (
              <button
                key={item.id}
                role="menuitem"
                type="button"
                disabled={item.disabled}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                onClick={() => select(item)}
                className={className}
              >
                {content}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}