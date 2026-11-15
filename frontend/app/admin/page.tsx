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
  Activity,
  BarChart3,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  UserCheck,
  Users as UsersIcon,
  UserX,
} from "lucide-react";
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
import { MAX_USERNAME_LENGTH, validateUsername } from "@/lib/username";
import { PasswordInput } from "@/components/password-input";
import { useToast } from "@/components/toast";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dropdown,
  EmptyState,
  Field,
  Input,
  Modal,
  Skeleton,
  StatCard,
  Toggle,
  type DropdownItem,
} from "@/components/ui";

const MIN_PASSWORD_LENGTH = 8;

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
  const [newUsername, setNewUsername] = useState("");
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
    // Optional username validation (letters and single spaces, 2-30 chars)
    const trimmedUsername = newUsername.trim();
    if (trimmedUsername) {
      const nameError = validateUsername(trimmedUsername);
      if (nameError) {
        toast("error", nameError);
        return;
      }
    }

    setCreating(true);
    try {
      const created = await adminCreateUser(token, {
        email: newEmail.trim(),
        password: newPassword,
        daily_quota: parsedQuota,
        username: trimmedUsername || undefined,
      });
      // Never keep or show the password: clear the form immediately.
      setNewEmail("");
      setNewUsername("");
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
    // The guard redirects when not allowed; the layout frame shows the
    // sidebar skeleton — these fill the page area while the role check runs.
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((card) => (
            <Skeleton key={card} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Users</h1>
        <p className="mt-1 text-sm text-slate-500">
          Approve accounts, set quotas and monitor activity.
        </p>
      </header>

      {/* stat cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total users"
          value={stats?.total_users}
          icon={UsersIcon}
          loading={!stats}
          hint="All accounts"
        />
        <StatCard
          label="Pending approval"
          value={stats?.pending_users}
          icon={UserCheck}
          loading={!stats}
          hint="Waiting for review"
        />
        <StatCard
          label="Active users"
          value={stats?.active_users}
          icon={ShieldCheck}
          loading={!stats}
          hint="Can fetch leads"
        />
        <StatCard
          label="Delivered today"
          value={stats?.delivered_today}
          icon={BarChart3}
          loading={!stats}
          hint="Leads sent (UTC)"
        />
      </div>

      {/* toolbar: search, status tabs, add user */}
      <Card className="mt-6 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by email…"
            aria-label="Search users by email"
            className="w-full sm:max-w-xs"
          />
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add user
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {TABS.map((statusTab) => (
            <button
              key={statusTab}
              onClick={() => setTab(statusTab)}
              role="tab"
              aria-selected={tab === statusTab}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium capitalize transition ${
                tab === statusTab
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800"
              }`}
            >
              {statusTab} ({counts[statusTab]})
            </button>
          ))}
        </div>
      </Card>

      {/* users table */}
      <Card className="mt-4 overflow-hidden">
        {loadError ? (
          <EmptyState
            title="Could not load users"
            description={loadError}
            icon={UsersIcon}
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        ) : !loaded ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((row) => (
              <Skeleton key={row} className="h-12 w-full" />
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
            icon={UsersIcon}
          />
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2.5 py-3 pl-4 font-medium">User</th>
                  <th className="px-2.5 py-3 font-medium">Status</th>
                  <th className="px-2.5 py-3 font-medium">Daily quota</th>
                  <th className="px-2.5 py-3 font-medium">Cooldown</th>
                  <th className="px-2.5 py-3 font-medium">Leads today</th>
                  <th className="px-2.5 py-3 font-medium">Sheet</th>
                  <th className="px-2.5 py-3 font-medium">Joined</th>
                  <th className="px-2.5 py-3 pr-4 text-right font-medium">Actions</th>
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

      {/* add-user modal */}
      <Modal open={addOpen} title="Add user" onClose={() => !creating && setAddOpen(false)}>
        <form onSubmit={handleCreateUser} className="space-y-4">
          <Field label="Email" htmlFor="new-email">
            <Input
              id="new-email"
              type="email"
              required
              autoComplete="off"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
            />
          </Field>
          <Field
            label="Name (optional)"
            htmlFor="new-username"
            hint="Display name, e.g. Ali Khan — letters and single spaces."
            error={
              newUsername.trim() ? validateUsername(newUsername, { required: false }) : null
            }
          >
            <Input
              id="new-username"
              type="text"
              maxLength={MAX_USERNAME_LENGTH}
              autoComplete="name"
              placeholder="Ali Khan"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
              aria-invalid={
                newUsername.trim() && validateUsername(newUsername, { required: false })
                  ? true
                  : undefined
              }
            />
          </Field>
          <Field
            label="Password"
            htmlFor="new-password"
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          >
            <PasswordInput
              id="new-password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              placeholder="Temporary password"
            />
          </Field>
          <Field label="Daily quota" htmlFor="new-quota">
            <Input
              id="new-quota"
              type="number"
              min={1}
              max={1000}
              required
              value={newQuota}
              onChange={(event) => setNewQuota(event.target.value)}
            />
          </Field>
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
            <p className="text-sm text-slate-600">
              Set the daily quota for{" "}
              <span className="font-medium text-slate-900">
                {approveUser.email ?? approveUser.id}
              </span>{" "}
              and activate the account.
            </p>
            <Field label="Daily quota" htmlFor="approve-quota">
              <Input
                id="approve-quota"
                type="number"
                min={1}
                max={1000}
                required
                value={approveQuota}
                onChange={(event) => setApproveQuota(event.target.value)}
              />
            </Field>
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
    </>
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
  const displayName = user.username ?? email;

  // Compact actions menu — the common actions live in a dropdown.
  const items: DropdownItem[] = [];
  if (user.status === "pending") {
    items.push({
      id: "approve",
      label: "Approve",
      icon: UserCheck,
      disabled: busy,
      onSelect: () => onApprove(user),
    });
  }
  if (user.status === "active") {
    items.push({
      id: "suspend",
      label: "Suspend",
      icon: UserX,
      disabled: busy,
      onSelect: () => void patch("status", { status: "suspended" }, `${email} suspended.`),
    });
  }
  if (user.status === "suspended") {
    items.push({
      id: "activate",
      label: "Activate",
      icon: ShieldCheck,
      disabled: busy,
      onSelect: () => void patch("status", { status: "active" }, `${email} activated.`),
    });
  }
  items.push({
    id: "activity",
    label: "View activity",
    icon: Activity,
    href: `/admin/users/${user.id}`,
  });

  return (
    <tr className="border-b border-slate-100 transition last:border-0 hover:bg-slate-50/60">
      <td className="px-2.5 py-3 pl-4 min-w-[150px]">
        <div className="flex items-center gap-2.5">
          <Avatar name={displayName} size="sm" />
          <div className="min-w-0 flex flex-col">
            <span className="font-medium text-slate-800 truncate">{displayName}</span>
            {user.username && (
              <span className="truncate text-xs text-slate-500">{email}</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-2.5 py-3">
        <Badge kind={user.status} />
      </td>
      <td className="px-2.5 py-3">
        <div className="flex items-center gap-1.5">
          <Input
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
            className="w-28 flex-none px-3 py-1.5 text-center tabular-nums appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <Button
            variant="secondary"
            size="sm"
            loading={busyKind === "quota"}
            disabled={busy || Number(quota) === user.daily_quota}
            onClick={saveQuota}
          >
            Save
          </Button>
        </div>
      </td>
      <td className="px-2.5 py-3">
        <div className="flex items-center gap-1.5">
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
          <span className="text-slate-500">{user.cooldown_enabled ? "On" : "Off"}</span>
        </div>
      </td>
      <td className="px-2.5 py-3 tabular-nums text-slate-700">{user.leads_today}</td>
      <td className="px-2.5 py-3">
        <span className={user.sheet_url ? "text-slate-700" : "text-slate-400"}>
          {user.sheet_url ? "Linked" : "—"}
        </span>
      </td>
      <td className="whitespace-nowrap px-2.5 py-3 text-xs text-slate-600">
        {formatDate(user.created_at)}
      </td>
      <td className="px-2.5 py-3 pr-4 text-right">
        <div className="flex items-center justify-end gap-0.5">
          {items.length > 1 && (
            <Link
              href={`/admin/users/${user.id}`}
              className="rounded-lg px-2 py-1.5 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700"
            >
              Activity
            </Link>
          )}
          <Dropdown
            menuLabel={`Actions for ${email}`}
            items={items}
            trigger={(props) => (
              <button
                {...props}
                aria-label={`Actions for ${email}`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <MoreHorizontal className="h-4 w-4" aria-hidden />
              </button>
            )}
          />
        </div>
      </td>
    </tr>
  );
}
