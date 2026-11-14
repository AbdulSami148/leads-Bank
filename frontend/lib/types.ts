/** Types mirroring the backend Pydantic models in backend/app/main.py. */

/** profiles.status — account state, set by an admin. */
export type AccountStatus = "pending" | "active" | "suspended";

/** lead_jobs.status */
export type JobStatus = "running" | "done" | "failed";

/** GET /me and GET /admin/users rows → ProfileOut */
export interface Profile {
  id: string;
  email?: string | null;
  role: string;
  status: AccountStatus;
  daily_quota: number;
  cooldown_enabled: boolean;
  sheet_url?: string | null;
  window_start?: string | null;
  leads_today: number;
  created_at?: string | null;
}

/** quota part of GET /leads/status → QuotaStateOut */
export interface QuotaState {
  remaining: number;
  leads_today: number;
  daily_quota: number;
  window_start?: string | null;
  locked_until?: string | null;
  can_request: boolean;
}

/** job part of GET /leads/status → LeadJobOut */
export interface LeadJob {
  id: string;
  status: JobStatus;
  requested?: number | null;
  delivered?: number | null;
  error?: string | null;
}

/** GET /leads/status → LeadStatusOut */
export interface LeadStatus {
  status: AccountStatus;
  quota: QuotaState;
  job: LeadJob | null;
}

/** POST /leads/get → LeadGetOut */
export interface LeadGet {
  job_id: string;
  requested: number;
}

/** GET /sheet/info and POST /sheet/link → SheetInfoOut */
export interface SheetInfo {
  service_account_email: string;
  sheet_url?: string | null;
}

/** POST /auth/signup → SignupOut */
export interface SignupOut {
  id: string;
  email?: string | null;
  status: AccountStatus;
}

/** GET /admin/stats → AdminStatsOut */
export interface AdminStats {
  total_users: number;
  pending_users: number;
  active_users: number;
  delivered_today: number;
}

/** GET /admin/users/{id}/activity quota_state → QuotaStateBriefOut */
export interface QuotaStateBrief {
  remaining: number;
  leads_today: number;
  daily_quota: number;
  locked_until?: string | null;
  can_request: boolean;
}

/** One lead_jobs row in GET /admin/users/{id}/activity → ActivityJobOut */
export interface ActivityJob {
  id: string;
  status: JobStatus;
  requested?: number | null;
  delivered: number;
  error?: string | null;
  created_at?: string | null;
}

/** One UTC day of the activity rollup → DailyBucketOut */
export interface DailyBucket {
  date: string;
  jobs: number;
  requested: number;
  delivered: number;
  pending: number;
  failed_jobs: number;
}

/** GET /admin/users/{id}/activity → ActivityOut */
export interface UserActivity {
  profile: Profile;
  quota_state: QuotaStateBrief;
  jobs: ActivityJob[];
  daily: DailyBucket[];
}
