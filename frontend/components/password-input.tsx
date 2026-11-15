"use client";

/**
 * Password field with a show/hide toggle inside the input.
 *
 * The toggle is a real <button> (keyboard reachable, announced through
 * aria-label / aria-pressed) and swaps the eye icon for the eye-off icon.
 * The value is never logged or stored anywhere.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { inputClassName } from "./ui";

export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder,
  disabled = false,
  required = false,
  error = null,
  hint,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Error text — wired to aria-invalid / aria-describedby. */
  error?: string | null;
  /** Hint text — wired to aria-describedby. */
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClassName("pr-11")}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}
