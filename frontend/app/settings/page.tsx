"use client";

/**
 * Settings (both roles): the profile card (name, email, role, status), the
 * change-email form (POST /me/change-email) and the change-password form.
 *
 * Changing a password re-authenticates the user first
 * (supabase.auth.signInWithPassword with the current password); only when
 * that succeeds is the new password applied
 * (supabase.auth.updateUser). After an email change the session is refreshed
 * (supabase.auth.refreshSession) — if that fails the user is signed out and
 * asked to log in with the new address. Passwords are never logged or stored.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Mail, ShieldCheck, User } from "lucide-react";
import { ApiError, currentAccessToken, patchMeUsername, postChangeEmail } from "@/lib/api";
import { patchPublishedProfile, publishProfile, useSessionGuard } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";
import { MAX_USERNAME_LENGTH, validateUsername } from "@/lib/username";
import { PasswordInput } from "@/components/password-input";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Skeleton } from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function SettingsPage() {
  const router = useRouter();
  const toast = useToast();
  const { ready, profile, token } = useSessionGuard(false);

  // Name (PATCH /me) — live-validated while typing.
  const [username, setUsername] = useState("");
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const usernameError = usernameTouched ? validateUsername(username) : null;

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [busyPassword, setBusyPassword] = useState(false);

  // Change email
  const [newEmail, setNewEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [busyEmail, setBusyEmail] = useState(false);

  // The profile arrives after the session check — fill the forms once (and
  // only while the user has not typed anything).
  useEffect(() => {
    if (!usernameTouched) setUsername(profile?.username ?? "");
  }, [profile?.username, usernameTouched]);
  useEffect(() => {
    if (!emailTouched) setNewEmail(profile?.email ?? "");
  }, [profile?.email, emailTouched]);

  async function handleNameSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingName || !token) return;
    setUsernameTouched(true);

    const nameError = validateUsername(username);
    if (nameError) return; // the live error is already showing

    setSavingName(true);
    try {
      const saved = await patchMeUsername(token, username.trim());
      patchPublishedProfile({ username: saved.username }); // updates the nav too
      toast("success", "Name updated.");
    } catch (err) {
      if (err instanceof ApiError) {
        toast("error", err.message || "Could not update the name.");
      } else {
        toast("error", "Could not update name — please try again.");
      }
    } finally {
      setSavingName(false);
    }
  }

  async function handlePasswordSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyPassword) return;
    setPasswordError(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("New password must be different from the current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }
    const email = profile?.email;
    if (!email) {
      setPasswordError("Could not read your email address — please log in again.");
      return;
    }

    setBusyPassword(true);
    try {
      const { error: signInError } = await getSupabase().auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInError) {
        setPasswordError("Current password is incorrect.");
        return;
      }

      const { error: updateError } = await getSupabase().auth.updateUser({
        password: newPassword,
      });
      if (updateError) {
        setPasswordError(updateError.message || "Could not update the password.");
        return;
      }

      const freshToken = await currentAccessToken();
      if (!freshToken) {
        setPasswordError("Session expired — please log in again.");
        router.replace("/login");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("success", "Password updated.");
    } catch {
      setPasswordError("Could not update the password — please try again.");
    } finally {
      setBusyPassword(false);
    }
  }

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyEmail || !token) return;
    setEmailError(null);

    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setEmailError("Invalid email address.");
      return;
    }
    const currentEmail = (profile?.email ?? "").toLowerCase();
    if (email === currentEmail) {
      setEmailError("The new email is the same as the current one.");
      return;
    }
    if (!emailCurrentPassword) {
      setEmailError("Current password is required.");
      return;
    }

    setBusyEmail(true);
    try {
      const res = await postChangeEmail(token, {
        current_password: emailCurrentPassword,
        new_email: email,
      });
      // The auth user moved to the new address — refresh the session so this
      // browser keeps a valid token for it.
      const { error: refreshError } = await getSupabase().auth.refreshSession();
      if (refreshError) {
        // The session is no longer usable: sign out and ask for a fresh login
        // with the new address (the change itself already succeeded).
        await getSupabase().auth.signOut();
        publishProfile(null);
        toast("error", `Email changed to ${email} — please log in again with the new address.`);
        router.replace("/login");
        return;
      }
      patchPublishedProfile({ email: res.email }); // updates every mounted page
      setEmailCurrentPassword("");
      toast("success", "Email updated — you are signed in with the new address.");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setEmailError("This email is already in use.");
        } else if (err.status === 429) {
          setEmailError("Too many attempts, try again later.");
        } else if (err.status === 400 && /current password/i.test(err.message)) {
          setEmailError("Current password is incorrect.");
        } else {
          setEmailError(err.message || "Could not change email.");
        }
      } else {
        setEmailError("Could not change email — please try again.");
      }
    } finally {
      setBusyEmail(false);
    }
  }

  if (!ready) {
    // The layout frame shows its own chrome skeleton — fill the page area.
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Your account details, name, email and password.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* account & name */}
        <Card className="p-6 sm:p-7">
          <CardHeader
            title="Profile"
            description="Your display name and email address."
          />
          <dl className="mt-5 space-y-4">
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <dt className="text-sm text-slate-500">Email</dt>
              <dd className="break-all text-sm font-medium text-slate-900">
                {profile?.email ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <dt className="text-sm text-slate-500">Role</dt>
              <dd className="text-sm font-medium capitalize text-slate-900">
                {profile?.role ?? "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-slate-500">Status</dt>
              <dd>
                <Badge kind={profile?.status ?? "pending"} />
              </dd>
            </div>
          </dl>

          {/* editable name */}
          <div className="mt-6 pt-6 border-t border-slate-100">
            <form onSubmit={handleNameSubmit} className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Display name</p>
              <Field label="Name" htmlFor="username" error={usernameError}>
                <Input
                  id="username"
                  type="text"
                  required
                  minLength={2}
                  maxLength={MAX_USERNAME_LENGTH}
                  autoComplete="name"
                  placeholder="Ali Khan"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setUsernameTouched(true);
                  }}
                  onBlur={() => setUsernameTouched(true)}
                  aria-invalid={usernameError ? true : undefined}
                />
              </Field>
              <Button type="submit" loading={savingName} disabled={savingName}>
                <User className="h-4 w-4" aria-hidden />
                Save name
              </Button>
            </form>
          </div>
        </Card>

        {/* change email */}
        <Card className="p-6 sm:p-7">
          <CardHeader
            title="Change email"
            description="Enter your current password to confirm, then provide the new email address."
          />
          <form onSubmit={handleEmailSubmit} className="mt-5 space-y-4">
            <Field
              label="New email"
              htmlFor="new-email"
              hint="A valid address not used by another account."
            >
              <Input
                id="new-email"
                type="email"
                required
                autoComplete="email"
                placeholder="new@example.com"
                value={newEmail}
                onChange={(e) => {
                  setNewEmail(e.target.value);
                  setEmailTouched(true);
                  setEmailError(null);
                }}
                aria-invalid={emailError ? true : undefined}
              />
            </Field>

            <Field label="Current password" htmlFor="email-current-password">
              <PasswordInput
                id="email-current-password"
                value={emailCurrentPassword}
                onChange={setEmailCurrentPassword}
                autoComplete="current-password"
                placeholder="Your current password"
                disabled={busyEmail}
              />
            </Field>

            {emailError && <Alert kind="error">{emailError}</Alert>}

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
              <Button type="submit" loading={busyEmail} disabled={busyEmail}>
                <Mail className="h-4 w-4" aria-hidden />
                Update email
              </Button>
              <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                The address changes immediately — use the new one at the next login.
              </p>
            </div>
          </form>
        </Card>
      </div>

      <div className="mt-6">
        {/* change password */}
        <Card className="p-6 sm:p-7">
          <CardHeader
            title="Change password"
            description="You confirm your current password before a new one is set."
          />
          <form onSubmit={handlePasswordSubmit} className="mt-5 space-y-4">
            <Field label="Current password" htmlFor="current-password">
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
                placeholder="Your current password"
                disabled={busyPassword}
              />
            </Field>

            <Field
              label="New password"
              htmlFor="new-password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
            >
              <PasswordInput
                id="new-password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
                placeholder="Choose a new password"
                disabled={busyPassword}
              />
            </Field>

            <Field label="Confirm new password" htmlFor="confirm-password">
              <PasswordInput
                id="confirm-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                placeholder="Repeat the new password"
                disabled={busyPassword}
              />
            </Field>

            {passwordError && <Alert kind="error">{passwordError}</Alert>}

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
              <Button type="submit" loading={busyPassword} disabled={busyPassword}>
                <KeyRound className="h-4 w-4" aria-hidden />
                Update password
              </Button>
              <p className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                You stay signed in after the change.
              </p>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}