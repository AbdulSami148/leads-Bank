"use client";

/**
 * Open signup: creates the account (status "pending" until an admin approves
 * it) and signs the user in automatically. Passwords are sent to the API once
 * and never shown or stored afterwards.
 */

import { useEffect } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, postSignup } from "@/lib/api";
import { wakeBackend } from "@/lib/api";
import { getSupabase } from "@/lib/supabase";
import { MAX_USERNAME_LENGTH, validateUsername } from "@/lib/username";
import { LogoMark } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const router = useRouter();
  // Wake a sleeping backend as soon as the page loads.
  useEffect(() => {
    wakeBackend();
  }, []);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live validation: the message appears as soon as the field was touched.
  const usernameError = usernameTouched ? validateUsername(username) : null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const value = email.trim();
    setUsernameTouched(true);
    // Client-side validation; the backend repeats these checks.
    const nameError = validateUsername(username);
    if (nameError) {
      setError(nameError);
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await postSignup({ email: value, password, username: username.trim() });
      // Automatic login right after signup, then straight to the dashboard.
      const { error: authError } = await getSupabase().auth.signInWithPassword({
        email: value,
        password,
      });
      if (authError) {
        setError("Account created — but automatic sign-in failed. Please log in.");
        return;
      }
      // The password has served its purpose — drop it before moving on.
      setPassword("");
      setConfirm("");
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) setError("This email is already registered");
        else if (err.status === 429) setError("Too many attempts, try again later");
        else setError(err.message || "Something went wrong.");
      } else {
        setError("Network error — is the API running?");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-indigo-50 via-slate-50 to-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <LogoMark className="h-11 w-11 rounded-2xl text-sm" />
          <div>
            <p className="text-lg font-semibold tracking-tight text-slate-900">Lead Bank</p>
            <p className="mt-1 text-sm text-slate-500">Fresh Instagram leads for your business</p>
          </div>
        </div>

        <Card className="animate-slide-up p-6 sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Create account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Sign up — you get access once the admin approves your account.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <Field
              label="Name"
              htmlFor="username"
              hint="Your display name, e.g. Ali Khan — letters and single spaces."
              error={usernameError}
            >
              <Input
                id="username"
                type="text"
                required
                minLength={2}
                maxLength={MAX_USERNAME_LENGTH}
                autoComplete="name"
                placeholder="Ali Khan"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setUsernameTouched(true);
                }}
                onBlur={() => setUsernameTouched(true)}
                aria-invalid={usernameError ? true : undefined}
              />
            </Field>

            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            <Field
              label="Password"
              htmlFor="password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            >
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                placeholder="Choose a password"
              />
            </Field>

            <Field label="Confirm password" htmlFor="confirm">
              <PasswordInput
                id="confirm"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
                placeholder="Repeat your password"
              />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}

            <Button type="submit" loading={busy} size="lg" className="w-full">
              Sign up
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-indigo-600 transition hover:text-indigo-700 hover:underline"
            >
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
