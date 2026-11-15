/**
 * Small API helper: every request to the backend carries the Supabase access
 * token as "Authorization: Bearer <token>". Throws ApiError with the HTTP
 * status and the backend's `detail` payload so pages can show friendly text.
 *
 * Sleeping-backend handling:
 *   - Every request has a 90s timeout.
 *   - If a request is still running after 5s, the server status is set to
 *     "starting" so the banner shows "Server is starting, please wait up to a
 *     minute"; it returns to "idle" when the request finishes.
 *   - GET requests that fail with a network error or 502/503/504 are retried
 *     once automatically. POST /leads/get is never auto-retried.
 *   - A 401 is retried once with the fresh Supabase session token, so a stale
 *     token (e.g. right after a password change) never breaks the request.
 *   - If the backend is still unreachable after the retry, a friendly error
 *     ("Server is not responding, please try again in a minute") is raised
 *     instead of a raw network error.
 */

import type {
  AccountStatus,
  AdminStats,
  LeadGet,
  LeadStatus,
  Profile,
  SheetInfo,
  SignupOut,
  UserActivity,
} from "./types";

import { getSupabase } from "./supabase";
import { serverStatus } from "./serverStatus";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const REQUEST_TIMEOUT_MS = 90_000; // 90 seconds
const SLOW_REQUEST_THRESHOLD_MS = 5_000; // 5 seconds
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

const SERVER_UNREACHABLE_MESSAGE =
  "Server is not responding, please try again in a minute";

export class ApiError extends Error {
  status: number;
  detail: unknown;

  constructor(status: number, detail: unknown) {
    super(typeof detail === "string" ? detail : JSON.stringify(detail));
    this.status = status;
    this.detail = detail;
  }

  isServerUnreachable(): boolean {
    return RETRYABLE_STATUS_CODES.has(this.status);
  }
}

/** Set externally by the banner/wake-up logic; kept null by default. */
/** Fire a background GET /health to wake a sleeping backend; ignore the result. */
export function wakeBackend(): void {
  fetch(`${API_URL}/health`, { method: "GET" }).catch(() => {
    /* ignore — best-effort wake-up */
  });
}

/**
 * The access token of the CURRENT Supabase session.
 *
 * The session is refreshed by Supabase in the background (and after a
 * password change), so this always returns the freshest token — the API
 * helper uses it to keep working when a cached token has gone stale.
 */
export async function currentAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<T>(
  path: string,
  accessToken?: string,
  init?: RequestInit,
  retryCount = 0
): Promise<T> {
  const isGet = !init?.method || init.method === "GET";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Mark the request as slow after 5s so the banner can show.
  let slowTimer: ReturnType<typeof setTimeout>;
  const markSlow = () => {
    slowTimer = setTimeout(() => {
      serverStatus.set("starting");
    }, SLOW_REQUEST_THRESHOLD_MS);
  };
  const clearSlow = () => clearTimeout(slowTimer);

  markSlow();

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init?.headers,
      },
    });
    clearSlow();
    serverStatus.set("idle");

    if (!res.ok) {
      let detail: unknown = res.statusText;
      try {
        const body = await res.json();
        detail = body?.detail ?? body ?? res.statusText;
      } catch {
        // non-JSON error body — keep statusText
      }

      // Retry once for GET requests on 502/503/504.
      if (isGet && retryCount === 0 && RETRYABLE_STATUS_CODES.has(res.status)) {
        return request(path, accessToken, init, retryCount + 1);
      }

      // The cached token may be stale (e.g. right after a password change):
      // retry once with the fresh session token before giving up.
      if (res.status === 401 && retryCount === 0) {
        const fresh = await currentAccessToken();
        if (fresh && fresh !== accessToken) {
          return request(path, fresh, init, retryCount + 1);
        }
      }

      if (RETRYABLE_STATUS_CODES.has(res.status)) {
        serverStatus.set("unreachable");
      }
      throw new ApiError(res.status, detail);
    }

    return res.json() as Promise<T>;
  } catch (exc) {
    clearSlow();

    if (exc instanceof ApiError) {
      throw exc;
    }

    // Network error or abort (timeout).
    const isNetworkError =
      exc instanceof Error &&
      (exc instanceof TypeError || exc.name === "AbortError");

    // Retry once for GET requests on network errors.
    if (isGet && retryCount === 0 && isNetworkError) {
      return request(path, accessToken, init, retryCount + 1);
    }

    if (isNetworkError) {
      serverStatus.set("unreachable");
      throw new Error(SERVER_UNREACHABLE_MESSAGE);
    }

    throw exc;
  }
}

/** True when the session itself is invalid — the page should go to /login. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Turn any thrown error into a short, friendly sentence. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Session expired — please log in again.";
    if (error.status === 403) return "You do not have permission for this action.";
    if (error.isServerUnreachable()) {
      return SERVER_UNREACHABLE_MESSAGE;
    }
    return error.message || "Something went wrong.";
  }
  return error instanceof Error ? error.message : "Network error — is the API running?";
}

/** GET /me — the logged-in user's profile row. */
export const getMe = (token: string) => request<Profile>("/me", token);

/** POST /auth/signup — open registration; returns the created (pending) account. */
export const postSignup = (body: { email: string; password: string; username: string }) =>
  request<SignupOut>("/auth/signup", undefined, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** PATCH /me — update the signed-in user's display name. */
export const patchMeUsername = (token: string, username: string) =>
  request<Profile>("/me", token, {
    method: "PATCH",
    body: JSON.stringify({ username }),
  });

/** POST /me/change-email — change the signed-in user's email address. */
export const postChangeEmail = (token: string, body: { current_password: string; new_email: string }) =>
  request<Profile>("/me/change-email", token, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** GET /leads/status — quota state plus the latest job. */
export const getStatus = (token: string) => request<LeadStatus>("/leads/status", token);

/** POST /leads/get — start a lead job. 409 = already running, 429 = locked. Never auto-retried. */
export const postGetLeads = (token: string) =>
  request<LeadGet>("/leads/get", token, { method: "POST" });

/** GET /sheet/info — service account email (to share the sheet with) + linked URL. */
export const getSheetInfo = (token: string) => request<SheetInfo>("/sheet/info", token);

/** POST /sheet/link — link a Google Sheet. Body: { sheet_url }. */
export const postSheetLink = (token: string, sheetUrl: string) =>
  request<SheetInfo>("/sheet/link", token, {
    method: "POST",
    body: JSON.stringify({ sheet_url: sheetUrl }),
  });

// --- admin endpoints (admin role required by the backend) ----------------------

/** GET /admin/stats — user counts and deliveries made today (UTC). */
export const getAdminStats = (token: string) => request<AdminStats>("/admin/stats", token);

/** GET /admin/users — all profile rows (pending accounts first). */
export const getAdminUsers = (token: string) => request<Profile[]>("/admin/users", token);

/** GET /admin/users/{user_id}/activity — profile, quota state, jobs, daily rollup. */
export const getAdminUserActivity = (token: string, userId: string) =>
  request<UserActivity>(`/admin/users/${userId}/activity`, token);

/** POST /admin/users — create a pre-approved user (email confirmed, status active). */
export const adminCreateUser = (
  token: string,
  body: { email: string; password: string; daily_quota: number; username?: string },
) =>
  request<Profile>("/admin/users", token, {
    method: "POST",
    body: JSON.stringify(body),
  });

/** PATCH /admin/users/{user_id} — update quota (1–1000), cooldown and/or status. */
export const adminUpdateUser = (
  token: string,
  userId: string,
  body: { daily_quota?: number; cooldown_enabled?: boolean; status?: AccountStatus },
) =>
  request<Profile>(`/admin/users/${userId}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

/** POST /admin/users/{user_id}/approve — set status active plus the daily quota. */
export const adminApproveUser = (token: string, userId: string, dailyQuota: number) =>
  request<Profile>(`/admin/users/${userId}/approve`, token, {
    method: "POST",
    body: JSON.stringify({ daily_quota: dailyQuota }),
  });

/** POST /admin/users/{user_id}/reset-window — leads_today = 0, window cleared. */
export const adminResetWindow = (token: string, userId: string) =>
  request<Profile>(`/admin/users/${userId}/reset-window`, token, { method: "POST" });
