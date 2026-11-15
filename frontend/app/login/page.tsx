"use client";

/** Login page: email + password only (no signup — users are created by an admin). */

import { useEffect } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getMe } from "@/lib/api";
import { wakeBackend } from "@/lib/api";
import { LogoMark } from "@/components/logo";
import { PasswordInput } from "@/components/password-input";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  // Wake a sleeping backend as soon as the page loads.
  useEffect(() => {
    wakeBackend();
  }, []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const { data, error: authError } = await getSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setBusy(false);
    if (authError) {
      // Supabase uses 400 for invalid login credentials.
      setError(
        authError.status === 400 ? "Wrong email or password." : authError.message
      );
      return;
    }

    // Check the backend profile: admins land on /admin, everyone else on /dashboard.
    const token = data.session?.access_token;
    if (!token) {
      setError("Login succeeded but no session was returned.");
      return;
    }
    try {
      const profile = await getMe(token);
      router.replace(profile.role === "admin" ? "/admin" : "/dashboard");
    } catch {
      // /me failed — fall back to the normal dashboard.
      router.replace("/dashboard");
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
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the email and password you were given.</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
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

            <Field label="Password" htmlFor="password">
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                placeholder="Your password"
              />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}

            <Button type="submit" loading={busy} size="lg" className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-sm text-slate-500">
          No account yet?{" "}
          <Link
            href="/signup"
            className="font-medium text-indigo-600 transition hover:text-indigo-700 hover:underline"
          >
            Create account
          </Link>
        </p>
      </div>
    </main>
  );
}
