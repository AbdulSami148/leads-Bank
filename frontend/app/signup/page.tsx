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
import { Button, Card } from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;
const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

export default function SignupPage() {
  const router = useRouter();
  // Wake a sleeping backend as soon as the page loads.
  useEffect(() => {
    wakeBackend();
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    const value = email.trim();
    // Client-side validation; the backend repeats these checks.
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
      await postSignup({ email: value, password });
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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-center text-lg font-semibold">Leads</p>
        <Card className="p-6">
          <h1 className="text-xl font-semibold">Create account</h1>
          <p className="mt-1 text-sm text-gray-500">
            Sign up — you get access once the admin approves your account.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-600">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-600">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-gray-600">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button type="submit" loading={busy} className="w-full py-2.5">
              Sign up
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-gray-500">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-blue-600 transition hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      </div>
    </main>
  );
}
