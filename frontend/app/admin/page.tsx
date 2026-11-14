"use client";

/**
 * Admin panel: stat cards, a toolbar (email search, status tabs with counts,
 * add-user modal) and the users table with inline quota / cooldown editing
 * plus status actions (approve, suspend, activate). Admins only —
 * useSessionGuard sends non-admins to /dashboard and logged-out visitors to
 * /login. Passwords are sent to the API once and never shown or stored after.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  adminApproveUser,
  adminCreateUser,
  adminUpdateUser,
  describeError,
  getAdminStats,
  getAdminUsers,
  isAuthError,
} from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSessionGuard } from "@/lib/session";
import type { AccountStatus, AdminStats, Profile } from "@/lib/types";
import { TopBar } from "@/components/topbar";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  Skeleton,
  Toggle,
} from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;
const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500";

/** Toolbar tabs: every status plus "all". */
type StatusTab = "all" | AccountStatus;
const TABS: StatusTab[] = ["all", "pending", "active", "suspended"];

export default function AdminPage() {
  const router = useRouter();
  const { ready, token, profile } = useSessionGuard(true);
  const toast = useToast();

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loaded, setLoaded] = useState(false); // first data load finished
  const [loadError, setLoadError] = useState<string | null>(null);

  // Toolbar state
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<StatusTab>("all");

  // Add-user modal (password is cleared right after submit — never stored).
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newQuota, setNewQuota] = useState("50");
  const [creating, setCreating] = useState(false);

  // Approve modal (pending users only).
  const [approveUser, setApproveUser] = useState<Profile | null>(null);
  const [approveQuota, setApproveQuota] = useState("50");
  const [approving, setApproving] = useState(false);

  // --- data loading -----------------------------------------------------------

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [nextStats, nextUsers] = await Promise.all([
        getAdminStats(token),
        getAdminUsers(token),
      ]);
      setStats(nextStats);
      setUsers(nextUsers);
      setLoadError(null);
      setLoaded(true);
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login"); // session expired mid-use
        return;
      }
      setLoaded(true);
      setLoadError(describeError(error));
    }
  }, [token, router]);

  // Initial load once the session/role check passed.
  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // --- toolbar filtering (backend sends pending accounts first) ----------------

  const counts = useMemo(() => {
    const result: Record<StatusTab, number> = { all: users.length, pending: 0, active: 0, suspended: 0 };
    for (const user of users) result[user.status] += 1;
    return result;
  }, [users]);

  const visibleUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter(
      (user) =>
        (tab === "all" || user.status === tab) &&
        (!needle || (user.email ?? "").toLowerCase().includes(needle)),
    );
  }, [users, tab, search]);

  // --- actions ------------------------------------------------------------------

  async function handleCreateUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || creating) return;

    const parsedQuota = Number(newQuota);
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast("error", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (!Number.isInteger(parsedQuota) || parsedQuota < 1 || parsedQuota > 1000) {
      toast("error", "Daily quota must be a whole number between 1 and 1000.");
      return;
    }

    setCreating(true);
    try {
      const created = await adminCreateUser(token, {
        email: newEmail.trim(),
        password: newPassword,
        daily_quota: parsedQuota,
      });
      // Never keep or show the password: clear the form immediately.
      setNewEmail("");
      setNewPassword("");
      setNewQuota("50");
      setAddOpen(false);
      toast("success", `User ${created.email ?? "created"} was created (status: active).`);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setCreating(false);
    }
  }

  async function handleApprove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !approveUser || approving) return;

    const parsedQuota = Number(approveQuota);
    if (!Number.isInteger(parsedQuota) || parsedQuota < 1 || parsedQuota > 1000) {
      toast("error", "Daily quota must be a whole number between 1 and 1000.");
      return;
    }

    setApproving(true);
    try {
      await adminApproveUser(token, approveUser.id, parsedQuota);
      toast("success", `Approved ${approveUser.email ?? approveUser.id} (quota: ${parsedQuota}).`);
      setApproveUser(null);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setApproving(false);
    }
  }

  // --- render -------------------------------------------------------------------

  if (!ready) {
    // The guard redirects when not allowed; show skeletons while it works.
    return (
      <main className="min-h-screen">
        <TopBar showUsers current="users" email={profile?.email} />
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <TopBar showUsers current="users" email={profile?.email} />

      <div className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-gray-500">
          Approve accounts, set quotas and monitor activity.
        </p>

        {/* stat cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total users", value: stats?.total_users },
            { label: "Pending approval", value: stats?.pending_users },
            { label: "Delivered today", value: stats?.delivered_today },
          ].map((card) => (
            <Card key={card.label} className="p-5">
              <p className="text-sm text-gray-500">{card.label}</p>
              {card.value === undefined ? (
                <Skeleton className="mt-1 h-8 w-16" />
              ) : (
                <p className="mt-1 text-2xl font-semibold">{card.value}</p>
              )}
            </Card>
          ))}
        </div>

        {/* toolbar: search, status tabs, add user */}
        <Card className="mt-6 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by email…"
              aria-label="Search users by email"
              className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <Button onClick={() => setAddOpen(true)}>+ Add user</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
            {TABS.map((statusTab) => (
              <button
                key={statusTab}
                onClick={() => setTab(statusTab)}
                role="tab"
                aria-selected={tab === statusTab}
                className={`rounded-full px-3 py-1.5 text-sm capitalize transition ${
                  tab === statusTab
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {statusTab} ({counts[statusTab]})
              </button>
            ))}
          </div>
        </Card>

        {/* users table */}
        <Card className="mt-4">
          {loadError ? (
            <EmptyState
              title="Could not load users"
              description={loadError}
              action={
                <Button variant="secondary" onClick={() => void load()}>
                  Try again
                </Button>
              }
            />
          ) : !loaded ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-10 w-full" />
              ))}
            </div>
          ) : visibleUsers.length === 0 ? (
            <EmptyState
              title="No users match"
              description={
                search
                  ? "Try a different email or clear the filter."
                  : "No accounts with this status yet."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Daily quota</th>
                    <th className="px-4 py-2.5">Cooldown</th>
                    <th className="px-4 py-2.5">Leads today</th>
                    <th className="px-4 py-2.5">Sheet linked</th>
                    <th className="px-4 py-2.5">Joined</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      token={token ?? ""}
                      onChanged={load}
                      onApprove={(candidate) => {
                        setApproveQuota("50"); // default per spec
                        setApproveUser(candidate);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* add-user modal */}
      <Modal open={addOpen} title="Add user" onClose={() => !creating && setAddOpen(false)}>
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div>
            <label htmlFor="new-email" className="block text-sm font-medium text-gray-600">
              Email
            </label>
            <input
              id="new-email"
              type="email"
              required
              autoComplete="off"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-gray-600">
              Password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-gray-400">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div>
            <label htmlFor="new-quota" className="block text-sm font-medium text-gray-600">
              Daily quota
            </label>
            <input
              id="new-quota"
              type="number"
              min={1}
              max={1000}
              required
              value={newQuota}
              onChange={(event) => setNewQuota(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" loading={creating}>
              Create user
            </Button>
          </div>
        </form>
      </Modal>

      {/* approve modal (pending users) */}
      <Modal
        open={approveUser !== null}
        title="Approve user"
        onClose={() => !approving && setApproveUser(null)}
      >
        {approveUser && (
          <form onSubmit={handleApprove} className="space-y-4">
            <p className="text-sm text-gray-500">
              Set the daily quota for{" "}
              <span className="font-medium">{approveUser.email ?? approveUser.id}</span> and
              activate the account.
            </p>
            <div>
              <label htmlFor="approve-quota" className="block text-sm font-medium text-gray-600">
                Daily quota
              </label>
              <input
                id="approve-quota"
                type="number"
                min={1}
                max={1000}
                required
                value={approveQuota}
                onChange={(event) => setApproveQuota(event.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => setApproveUser(null)}
                disabled={approving}
              >
                Cancel
              </Button>
              <Button type="submit" loading={approving}>
                Approve
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </main>
  );
}

// --- users table row -------------------------------------------------------------

/** Everything a single row can do; `busyKind` keeps actions mutually exclusive. */
type BusyKind = "quota" | "cooldown" | "status" | null;

function UserRow({
  user,
  token,
  onChanged,
  onApprove,
}: {
  user: Profile;
  token: string;
  onChanged: () => Promise<void>;
  onApprove: (user: Profile) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [quota, setQuota] = useState(String(user.daily_quota));
  const [busyKind, setBusyKind] = useState<BusyKind>(null);
  const busy = busyKind !== null;

  /** Shared PATCH wrapper: busy flag, 401 redirect and friendly toasts. */
  async function patch(
    kind: Exclude<BusyKind, null>,
    body: Parameters<typeof adminUpdateUser>[2],
    successText: string,
  ) {
    if (!token || busy) return;
    setBusyKind(kind);
    try {
      await adminUpdateUser(token, user.id, body);
      toast("success", successText);
      await onChanged();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setBusyKind(null);
    }
  }

  function saveQuota() {
    const parsed = Number(quota);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      toast("error", "Quota must be a whole number between 1 and 1000.");
      return;
    }
    void patch("quota", { daily_quota: parsed }, `Quota updated for ${user.email ?? user.id}.`);
  }

  const email = user.email ?? user.id;

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="px-4 py-3 font-medium break-all">{email}</td>
      <td className="px-4 py-3">
        <Badge kind={user.status} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={1000}
            value={quota}
            disabled={busy}
            onChange={(event) => setQuota(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveQuota();
            }}
            aria-label={`Daily quota for ${email}`}
            className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <Button
            variant="secondary"
            loading={busyKind === "quota"}
            disabled={busy || Number(quota) === user.daily_quota}
            onClick={saveQuota}
          >
            Save
          </Button>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Toggle
            checked={user.cooldown_enabled}
            disabled={busy}
            label={`Cooldown for ${email}`}
            onChange={(checked) =>
              void patch(
                "cooldown",
                { cooldown_enabled: checked },
                `Cooldown ${checked ? "enabled" : "disabled"} for ${email}.`,
              )
            }
          />
          <span className="text-gray-500">{user.cooldown_enabled ? "On" : "Off"}</span>
        </div>
      </td>
      <td className="px-4 py-3">{user.leads_today}</td>
      <td className="px-4 py-3">{user.sheet_url ? "Yes" : "No"}</td>
      <td className="whitespace-nowrap px-4 py-3">{formatDate(user.created_at)}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2 whitespace-nowrap">
          {user.status === "pending" && (
            <Button disabled={busy} onClick={() => onApprove(user)}>
              Approve
            </Button>
          )}
          {user.status === "active" && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void patch("status", { status: "suspended" }, `${email} suspended.`)}
            >
              Suspend
            </Button>
          )}
          {user.status === "suspended" && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void patch("status", { status: "active" }, `${email} activated.`)}
            >
              Activate
            </Button>
          )}
          <Link
            href={`/admin/users/${user.id}`}
            className="rounded-lg px-2 py-1.5 text-sm font-medium text-blue-600 transition hover:underline"
          >
            View activity
          </Link>
        </div>
      </td>
    </tr>
  );
}
