"use client";

/** Login page: email + password only (no signup — users are created by an admin). */

import { useEffect } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { getMe } from "@/lib/api";
import { wakeBackend } from "@/lib/api";

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
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <p className="mb-4 text-center text-lg font-semibold">Leads</p>
        <form
          onSubmit={handleSubmit}
          className="w-full space-y-4 rounded-xl bg-white p-6 shadow"
        >
          <h1 className="text-xl font-semibold">Sign in</h1>

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
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          No account yet?{" "}
          <Link href="/signup" className="font-medium text-blue-600 transition hover:underline">
            Create account
          </Link>
        </p>
      </div>
    </main>
  );
}
