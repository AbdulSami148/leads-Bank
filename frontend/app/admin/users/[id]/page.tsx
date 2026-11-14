"use client";

/**
 * User activity page (/admin/users/[id]): status card with quota numbers and
 * a live cooldown countdown, a 30-day daily history table and the user's
 * recent lead jobs. Admins only (useSessionGuard).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  adminResetWindow,
  adminUpdateUser,
  describeError,
  getAdminUserActivity,
  isAuthError,
} from "@/lib/api";
import { formatCountdown, formatTime } from "@/lib/format";
import { useSessionGuard } from "@/lib/session";
import type { DailyBucket, UserActivity } from "@/lib/types";
import { TopBar } from "@/components/topbar";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Toggle,
  type BadgeKind,
} from "@/components/ui";

/** Badge kind for one daily row: Failed wins, then Partial, then Complete. */
function dailyBadgeKind(day: DailyBucket): BadgeKind {
  if (day.failed_jobs > 0) return "failed";
  if (day.pending > 0) return "partial";
  return "complete";
}

/** One labeled number inside the status card. */
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function UserActivityPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const { ready, token, profile } = useSessionGuard(true);
  const toast = useToast();

  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [loaded, setLoaded] = useState(false); // first data load finished
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false); // a PATCH / reset-window is in flight
  const [confirmReset, setConfirmReset] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);

  // --- data loading -----------------------------------------------------------

  const load = useCallback(async () => {
    if (!token || !userId) return;
    try {
      const next = await getAdminUserActivity(token, userId);
      setActivity(next);
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
  }, [token, userId, router]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // --- live countdown while the account is locked ------------------------------

  const quotaState = activity?.quota_state ?? null;
  const lockedUntil = quotaState?.locked_until ?? null;
  const canRequest = quotaState?.can_request ?? false;

  useEffect(() => {
    if (!lockedUntil || canRequest) {
      setCountdown(null);
      return;
    }
    const target = new Date(lockedUntil).getTime();
    const tick = () => {
      const ms = target - Date.now();
      if (ms <= 0) {
        setCountdown(null);
        void load(); // lock expired — refresh the quota state
      } else {
        setCountdown(formatCountdown(ms));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, canRequest, load]);

  // --- actions ------------------------------------------------------------------

  /** PATCH the cooldown toggle immediately when it flips. */
  async function patchCooldown(enabled: boolean) {
    if (!token || !userId || busy) return;
    setBusy(true);
    try {
      await adminUpdateUser(token, userId, { cooldown_enabled: enabled });
      toast("success", `Cooldown ${enabled ? "enabled" : "disabled"}.`);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  /** POST reset-window ("Remove cooldown") after the ConfirmDialog. */
  async function resetWindow() {
    if (!token || !userId || busy) return;
    setBusy(true);
    try {
      await adminResetWindow(token, userId);
      toast("success", "Cooldown removed — the quota window was reset.");
      setConfirmReset(false);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  // --- render -------------------------------------------------------------------

  const userProfile = activity?.profile ?? null;

  return (
    <main className="min-h-screen">
      <TopBar showUsers current="users" email={profile?.email} />

      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link href="/admin" className="text-sm text-blue-600 transition hover:underline">
          ← Back to users
        </Link>
        <header className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold break-all">
            {loaded && userProfile ? userProfile.email ?? userProfile.id : "User activity"}
          </h1>
          {userProfile && <Badge kind={userProfile.status} />}
        </header>

        {loadError ? (
          <Card className="mt-6">
            <EmptyState
              title="Could not load this user"
              description={loadError}
              action={
                <Button variant="secondary" onClick={() => void load()}>
                  Try again
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {/* current status card */}
            <Card className="mt-6 p-5">
              {!loaded || !quotaState || !userProfile ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Metric label="Daily quota" value={quotaState.daily_quota} />
                    <Metric label="Used today" value={quotaState.leads_today} />
                    <Metric label="Remaining" value={quotaState.remaining} />
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-4">
                    {quotaState.can_request ? (
                      <span className="text-sm font-medium text-green-600">
                        Ready to fetch leads
                      </span>
                    ) : countdown ? (
                      <span className="text-sm font-medium text-amber-600">
                        Next leads in {countdown}
                      </span>
                    ) : (
                      <span className="text-sm text-amber-600">
                        No leads left — waiting for the window to reset.
                      </span>
                    )}
                    <div className="ml-auto flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <Toggle
                          checked={userProfile.cooldown_enabled}
                          disabled={busy}
                          label={`Cooldown for ${userProfile.email ?? userProfile.id}`}
                          onChange={(checked) => void patchCooldown(checked)}
                        />
                        <span className="text-sm text-gray-500">
                          Cooldown {userProfile.cooldown_enabled ? "on" : "off"}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        loading={busy}
                        onClick={() => setConfirmReset(true)}
                      >
                        Remove cooldown
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Card>

            {/* daily history (last 30 days, newest first) */}
            <Card className="mt-4">
              <h2 className="px-5 pt-5 font-semibold">
                Daily history{" "}
                <span className="text-sm font-normal text-gray-400">(last 30 days)</span>
              </h2>
              <div className="mt-3 overflow-x-auto pb-4">
                {!loaded || !activity ? (
                  <div className="space-y-3 px-5">
                    {[0, 1, 2, 3].map((row) => (
                      <Skeleton key={row} className="h-8 w-full" />
                    ))}
                  </div>
                ) : (
                  (() => {
                    // Only days that actually had jobs; zero days are hidden.
                    const activeDays = activity.daily.filter((day) => day.jobs > 0);
                    if (activeDays.length === 0) {
                      return (
                        <EmptyState
                          title="No activity yet"
                          description="This user has not fetched any leads in the last 30 days."
                        />
                      );
                    }
                    return (
                      <table className="w-full min-w-[600px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                            <th className="px-4 py-2.5">Date</th>
                            <th className="px-4 py-2.5">Jobs</th>
                            <th className="px-4 py-2.5">Requested</th>
                            <th className="px-4 py-2.5">Delivered</th>
                            <th className="px-4 py-2.5">Pending</th>
                            <th className="px-4 py-2.5">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeDays.map((day) => (
                            <tr key={day.date} className="border-b border-gray-100 last:border-0">
                              <td className="whitespace-nowrap px-4 py-2.5">{day.date}</td>
                              <td className="px-4 py-2.5">{day.jobs}</td>
                              <td className="px-4 py-2.5">{day.requested}</td>
                              <td className="px-4 py-2.5">{day.delivered}</td>
                              <td className="px-4 py-2.5">{day.pending}</td>
                              <td className="px-4 py-2.5">
                                <Badge kind={dailyBadgeKind(day)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()
                )}
              </div>
            </Card>

            {/* recent jobs (newest first) */}
            <Card className="mb-8 mt-4">
              <h2 className="px-5 pt-5 font-semibold">Recent jobs</h2>
              <div className="mt-3 overflow-x-auto pb-4">
                {!loaded || !activity ? (
                  <div className="space-y-3 px-5">
                    {[0, 1, 2].map((row) => (
                      <Skeleton key={row} className="h-8 w-full" />
                    ))}
                  </div>
                ) : activity.jobs.length === 0 ? (
                  <EmptyState title="No jobs yet" description="This user has not fetched any leads." />
                ) : (
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                        <th className="px-4 py-2.5">Time</th>
                        <th className="px-4 py-2.5">Status</th>
                        <th className="px-4 py-2.5">Requested</th>
                        <th className="px-4 py-2.5">Delivered</th>
                        <th className="px-4 py-2.5">Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.jobs.map((job) => (
                        <tr key={job.id} className="border-b border-gray-100 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2.5">
                            {formatTime(job.created_at)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge kind={job.status} />
                          </td>
                          <td className="px-4 py-2.5">{job.requested ?? "—"}</td>
                          <td className="px-4 py-2.5">{job.delivered}</td>
                          <td className="px-4 py-2.5 break-all">{job.error ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* remove-cooldown confirmation */}
      <ConfirmDialog
        open={confirmReset}
        title="Remove cooldown"
        message={`Reset the quota window for ${
          userProfile?.email ?? "this user"
        }? Leads today will be set to 0 and the account can fetch again right away.`}
        confirmLabel="Remove cooldown"
        danger
        loading={busy}
        onConfirm={() => void resetWindow()}
        onCancel={() => !busy && setConfirmReset(false)}
      />
    </main>
  );
}
