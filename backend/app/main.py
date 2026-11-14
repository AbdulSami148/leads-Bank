"""FastAPI entrypoint: CORS, health check, open signup, /me, account gating,
/leads endpoints and /admin user management (approval, stats, activity)."""

import re
import threading
from datetime import date, datetime, timedelta, timezone

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Request,
    status,
)
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from supabase_auth.types import User as SupabaseUser
from supabase import Client

from app.auth import get_current_user, require_admin
from app.config import get_settings
from app.db import get_db
from app.jobs import run_lead_job
from app.quota import get_quota_state, leads_to_fetch
from app import sheet_writer
from typing import Final, Literal, Optional
from pydantic import BaseModel, Field

# --- /me response model ------------------------------------------------------


class ProfileOut(BaseModel):
    """A profiles table row."""

    id: str
    email: Optional[str] = None
    role: str
    status: str = "pending"  # pending / active / suspended
    daily_quota: int
    cooldown_enabled: bool
    sheet_url: Optional[str] = None
    window_start: Optional[str] = None
    leads_today: int
    created_at: Optional[str] = None


# --- /leads response models ---------------------------------------------------


class QuotaStateOut(BaseModel):
    """Quota window state for the logged-in user."""

    remaining: int
    leads_today: int
    daily_quota: int
    window_start: Optional[str] = None
    locked_until: Optional[str] = None
    can_request: bool


class LeadJobOut(BaseModel):
    """The latest lead_jobs row for the user."""

    id: str
    status: str
    requested: Optional[int] = None
    delivered: Optional[int] = None
    error: Optional[str] = None


class LeadGetOut(BaseModel):
    """POST /leads/get response: the started job."""

    job_id: str
    requested: int


class LeadStatusOut(BaseModel):
    """GET /leads/status response: account status, quota state and latest job."""

    status: str = "pending"  # account status (pending / active / suspended)
    quota: QuotaStateOut
    job: Optional[LeadJobOut] = None


# --- /sheet request + response models ------------------------------------------

class SheetLinkIn(BaseModel):
    """POST /sheet/link body."""

    sheet_url: str


class SheetInfoOut(BaseModel):
    """GET /sheet/info and POST /sheet/link response."""

    service_account_email: str
    sheet_url: Optional[str] = None


# --- /auth/signup request + response models ------------------------------------


class SignupIn(BaseModel):
    """POST /auth/signup body."""

    email: str
    password: str


class SignupOut(BaseModel):
    """POST /auth/signup response: the created (pending) account."""

    id: str
    email: Optional[str] = None
    status: str = "pending"


# --- /admin request + response models ------------------------------------------


class AdminCreateUserIn(BaseModel):
    """POST /admin/users body."""

    email: str
    password: str
    daily_quota: int = 50


class AdminUpdateUserIn(BaseModel):
    """PATCH /admin/users/{user_id} body — all fields optional."""

    daily_quota: Optional[int] = Field(None, ge=1, le=1000)
    cooldown_enabled: Optional[bool] = None
    status: Optional[Literal["pending", "active", "suspended"]] = None


class AdminApproveIn(BaseModel):
    """POST /admin/users/{user_id}/approve body."""

    daily_quota: int = Field(..., ge=1, le=1000)


class AdminJobOut(BaseModel):
    """One lead_jobs row as seen by the admin."""

    id: str
    status: str
    requested: Optional[int] = None
    delivered: int = 0
    error: Optional[str] = None
    created_at: Optional[str] = None
    email: Optional[str] = None


class AdminStatsOut(BaseModel):
    """GET /admin/stats response."""

    total_users: int
    pending_users: int
    active_users: int
    delivered_today: int  # deliveries in the current UTC day


# --- /admin/users/{id}/activity response models ---------------------------------


class QuotaStateBriefOut(BaseModel):
    """Quota snapshot for the activity view (subset of quota.get_quota_state)."""

    remaining: int
    leads_today: int
    daily_quota: int
    locked_until: Optional[str] = None
    can_request: bool


class ActivityJobOut(BaseModel):
    """One lead_jobs row in the activity view."""

    id: str
    status: str
    requested: Optional[int] = None
    delivered: int = 0
    error: Optional[str] = None
    created_at: Optional[str] = None


class DailyBucketOut(BaseModel):
    """One UTC day of the per-user activity rollup."""

    date: str
    jobs: int
    requested: int
    delivered: int
    pending: int  # requested - delivered, floored at 0
    failed_jobs: int


class ActivityOut(BaseModel):
    """GET /admin/users/{id}/activity response."""

    profile: ProfileOut
    quota_state: QuotaStateBriefOut
    jobs: list[ActivityJobOut]
    daily: list[DailyBucketOut]


# --- /leads helpers ------------------------------------------------------------

STALE_JOB_MINUTES: int = 15  # a 'running' job older than this is considered crashed


def _fail_stale_running_jobs(db: Client) -> None:
    """Mark 'running' lead_jobs older than STALE_JOB_MINUTES as failed ('timed out').

    A crashed BackgroundTask would otherwise leave the row 'running' forever
    and block the user from ever starting another job (409).
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=STALE_JOB_MINUTES)).isoformat()
    db.table("lead_jobs").update({
        "status": "failed",
        "error": "timed out",
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("status", "running").lt("created_at", cutoff).execute()


def _own_profile(db: Client, user: SupabaseUser) -> dict:
    """Load the calling user's profiles row; 404 when it does not exist."""
    response = db.table("profiles").select("*").eq("id", user.id).single().execute()
    if not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return response.data


# --- app setup ---------------------------------------------------------------

app = FastAPI(title="Leads API")

# Allow CORS from the configured frontend origins: comma-separated list,
# surrounding whitespace and trailing slashes are ignored.
_origins = [
    origin.strip().rstrip("/")
    for origin in get_settings().FRONTEND_ORIGIN.split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- open signup ----------------------------------------------------------------

# Simple email shape check (local@domain.tld); deep validation is out of scope.
_EMAIL_RE: re.Pattern[str] = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

SIGNUP_RATE_LIMIT: Final[int] = 5                 # max signups per IP...
SIGNUP_RATE_WINDOW: Final[timedelta] = timedelta(hours=1)  # ...per rolling hour
_signup_attempts: dict[str, list[datetime]] = {}  # ip -> attempt timestamps (UTC)
_signup_lock = threading.Lock()  # sync endpoints run in a thread pool


def _check_signup_rate(ip: str) -> None:
    """Sliding-window in-memory rate limit: 5 signups per IP per hour (429).

    Counts attempts that reach user creation (201 or 409); requests rejected
    earlier by validation do not consume the budget.
    """
    now = datetime.now(timezone.utc)
    with _signup_lock:
        stamps = [t for t in _signup_attempts.get(ip, []) if now - t < SIGNUP_RATE_WINDOW]
        if len(stamps) >= SIGNUP_RATE_LIMIT:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "Too many signup attempts, try again later",
            )
        stamps.append(now)
        _signup_attempts[ip] = stamps


@app.post("/auth/signup", response_model=SignupOut, status_code=status.HTTP_201_CREATED)
def signup(
    request: Request,
    payload: SignupIn,
    db: Client = Depends(get_db),
) -> SignupOut:
    """Open signup: validate the input, create the auth user via the service key.

    The DB trigger creates the profiles row, which defaults to status
    'pending' until an admin approves it. Passwords are never logged.
    """
    # Lowercase + validate the email; enforce the minimum password length.
    email_value = payload.email.strip().lower()
    if not _EMAIL_RE.match(email_value):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid email address")
    if len(payload.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 8 characters")

    ip = request.client.host if request.client else "unknown"
    _check_signup_rate(ip)

    try:
        created = db.auth.admin.create_user({
            "email": email_value,
            "password": payload.password,  # passed to Supabase only, never logged
            "email_confirm": True,
        })
    except Exception as exc:
        # Duplicate email -> 409. Keep other failures generic (no password echo).
        if "already" in str(exc).lower():
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not create user")

    return SignupOut(id=created.user.id, email=email_value, status="pending")


# --- routes ------------------------------------------------------------------


@app.get("/health")
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}


@app.get("/me", response_model=ProfileOut)
def me(
    user: SupabaseUser = Depends(get_current_user),
    db: Client = Depends(get_db),
) -> ProfileOut:
    """Return the logged-in user's own profile row."""
    response = db.table("profiles").select("*").eq("id", user.id).single().execute()
    if not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return ProfileOut(**response.data)


@app.get("/admin/users", response_model=list[ProfileOut])
def admin_users(
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> list[ProfileOut]:
    """Return all profile rows (admin only): pending first, then newest."""
    rows = db.table("profiles").select("*").execute().data or []
    # Two-pass stable sort: newest first, then pending accounts float to the top.
    rows.sort(key=lambda row: row.get("created_at") or "", reverse=True)
    rows.sort(key=lambda row: row.get("status") != "pending")
    return [ProfileOut(**row) for row in rows]


# --- lead endpoints -----------------------------------------------------------


@app.post("/leads/get", response_model=LeadGetOut)
def get_leads(
    background_tasks: BackgroundTasks,
    user: SupabaseUser = Depends(get_current_user),
    db: Client = Depends(get_db),
) -> LeadGetOut:
    """Start an async lead-fetch job for the caller (quota + cooldown enforced here).

    409 when a job is already running; 429 (with locked_until) when the
    daily quota is used up and cooldown is active.
    """
    profile = _own_profile(db, user)
    # Account gating: pending and suspended users may not request leads.
    if profile.get("status") != "active":
        return JSONResponse(status_code=403, content={"message": "Account not approved"})
    # Leads are delivered by appending to the user's Google Sheet — no sheet,
    # no job. The frontend shows this as "Link your Google Sheet first."
    if not profile.get("sheet_url"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Link your Google Sheet first"
        )
    state = get_quota_state(profile, datetime.now(timezone.utc))

    # Clean up crashed jobs before the running-check so they cannot block.
    _fail_stale_running_jobs(db)

    # One job at a time per user.
    running = (
        db.table("lead_jobs")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "running")
        .limit(1)
        .execute()
        .data
        or []
    )
    if running:
        raise HTTPException(status.HTTP_409_CONFLICT, "A lead job is already running")

    if not state["can_request"]:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            {
                "message": "Daily quota used up",
                "locked_until": state["locked_until"],
            },
        )

    requested = leads_to_fetch(state)
    inserted = (
        db.table("lead_jobs")
        .insert({"user_id": user.id, "status": "running", "requested": requested})
        .execute()
    )
    job_id = inserted.data[0]["id"]

    background_tasks.add_task(run_lead_job, job_id, user.id, requested)
    return LeadGetOut(job_id=job_id, requested=requested)


@app.get("/leads/status", response_model=LeadStatusOut)
def lead_status(
    user: SupabaseUser = Depends(get_current_user),
    db: Client = Depends(get_db),
) -> LeadStatusOut:
    """Return the caller's quota state plus their latest lead job."""
    profile = _own_profile(db, user)
    quota = get_quota_state(profile, datetime.now(timezone.utc))

    # Stale 'running' rows show up as failed in the reported job as well.
    _fail_stale_running_jobs(db)

    latest = (
        db.table("lead_jobs")
        .select("id, status, requested, delivered, error")
        .eq("user_id", user.id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    return LeadStatusOut(
        status=str(profile.get("status") or "pending"),
        quota=QuotaStateOut(**quota),
        job=LeadJobOut(**latest[0]) if latest else None,
    )


# --- sheet endpoints ------------------------------------------------------------


@app.get("/sheet/info", response_model=SheetInfoOut)
def sheet_info(
    user: SupabaseUser = Depends(get_current_user),
    db: Client = Depends(get_db),
) -> SheetInfoOut:
    """The service-account email (to share the sheet with) and the linked URL."""
    profile = _own_profile(db, user)
    return SheetInfoOut(
        service_account_email=sheet_writer.get_service_account_email(),
        sheet_url=profile.get("sheet_url"),
    )


@app.post("/sheet/link", response_model=SheetInfoOut)
def sheet_link(
    payload: SheetLinkIn,
    user: SupabaseUser = Depends(get_current_user),
    db: Client = Depends(get_db),
) -> SheetInfoOut:
    """Verify a Google Sheet (shared with the service account) and link it.

    verify_sheet opens the first worksheet and writes the header row if the
    sheet is empty. Only after a successful check is the URL saved on the
    profile, so a linked sheet is always usable.
    """
    try:
        sheet_writer.verify_sheet(payload.sheet_url)
    except (ValueError, sheet_writer.SheetError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    _updated_profile(db, user.id, {"sheet_url": payload.sheet_url})
    return SheetInfoOut(
        service_account_email=sheet_writer.get_service_account_email(),
        sheet_url=payload.sheet_url,
    )


# --- admin endpoints ------------------------------------------------------------


def _updated_profile(db: Client, user_id: str, updates: dict) -> dict:
    """Apply a profiles update and return the fresh row; 404 when it vanishes."""
    updated = db.table("profiles").update(updates).eq("id", user_id).execute()
    rows = updated.data or []
    if not rows:  # update may return nothing in odd cases — fetch explicitly
        rows = db.table("profiles").select("*").eq("id", user_id).execute().data or []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    return rows[0]


@app.post("/admin/users", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def admin_create_user(
    payload: AdminCreateUserIn,
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> ProfileOut:
    """Create an auth user (service key, email confirmed) and set its daily quota."""
    try:
        created = db.auth.admin.create_user({
            "email": payload.email,
            "password": payload.password,
            "email_confirm": True,
        })
    except Exception as exc:  # duplicate email, weak password, bad request...
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Could not create user: {exc}")

    user_id = created.user.id
    # The signup trigger has already created the profile row; admin-created
    # users are pre-approved: set the quota and status 'active'.
    return ProfileOut(
        **_updated_profile(
            db, user_id, {"daily_quota": payload.daily_quota, "status": "active"}
        )
    )


@app.patch("/admin/users/{user_id}", response_model=ProfileOut)
def admin_update_user(
    user_id: str,
    payload: AdminUpdateUserIn,
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> ProfileOut:
    """Update daily_quota (1–1000), cooldown_enabled and/or status."""
    updates: dict = {}
    if payload.daily_quota is not None:
        updates["daily_quota"] = payload.daily_quota  # bounds enforced by the model
    if payload.cooldown_enabled is not None:
        updates["cooldown_enabled"] = payload.cooldown_enabled
    if payload.status is not None:
        updates["status"] = payload.status  # allowed values enforced by the model
    if not updates:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to update")
    return ProfileOut(**_updated_profile(db, user_id, updates))


@app.post("/admin/users/{user_id}/approve", response_model=ProfileOut)
def admin_approve_user(
    user_id: str,
    payload: AdminApproveIn,
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> ProfileOut:
    """Approve the account: status 'active' plus the daily quota in one call."""
    return ProfileOut(
        **_updated_profile(
            db, user_id, {"status": "active", "daily_quota": payload.daily_quota}
        )
    )


@app.post("/admin/users/{user_id}/reset-window", response_model=ProfileOut)
def admin_reset_window(
    user_id: str,
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> ProfileOut:
    """Reset the user's quota window: leads_today = 0, window_start = null.

    Shown in the UI as "Remove cooldown" (clears the 24h lock early).
    """
    return ProfileOut(
        **_updated_profile(db, user_id, {"leads_today": 0, "window_start": None})
    )


@app.get("/admin/jobs", response_model=list[AdminJobOut])
def admin_jobs(
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> list[AdminJobOut]:
    """The latest 50 lead jobs with the requesting user's email."""
    response = (
        db.table("lead_jobs")
        .select("id, status, requested, delivered, error, created_at, profiles(email)")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    out: list[AdminJobOut] = []
    for row in response.data or []:
        profile = row.pop("profiles", None) or {}  # flatten the embedded email
        row["email"] = profile.get("email")
        out.append(AdminJobOut(**row))
    return out


@app.get("/admin/stats", response_model=AdminStatsOut)
def admin_stats(
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> AdminStatsOut:
    """User counts by status plus deliveries made today (UTC day)."""
    total_users = db.table("profiles").select("id", count="exact").execute().count or 0
    pending_users = (
        db.table("profiles").select("id", count="exact").eq("status", "pending").execute().count
        or 0
    )
    active_users = (
        db.table("profiles").select("id", count="exact").eq("status", "active").execute().count
        or 0
    )

    # Start of the current UTC day.
    day_start = (
        datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    )
    delivered_today = (
        db.table("deliveries")
        .select("id", count="exact")
        .gte("delivered_at", day_start)
        .execute()
        .count
        or 0
    )

    return AdminStatsOut(
        total_users=total_users,
        pending_users=pending_users,
        active_users=active_users,
        delivered_today=delivered_today,
    )


# --- /admin/users/{id}/activity --------------------------------------------------

ACTIVITY_DAYS: Final[int] = 30   # daily rollup window (UTC days)
ACTIVITY_JOBS: Final[int] = 50   # how many recent jobs to return


def _utc_date(value: object) -> Optional[date]:
    """Parse a timestamp and return its UTC calendar date (None if unparsable)."""
    if value is None:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:  # naive timestamps are treated as UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).date()


@app.get("/admin/users/{user_id}/activity", response_model=ActivityOut)
def admin_user_activity(
    user_id: str,
    _admin: SupabaseUser = Depends(require_admin),
    db: Client = Depends(get_db),
) -> ActivityOut:
    """Per-user activity: profile, quota state, recent jobs and a daily rollup."""
    rows = db.table("profiles").select("*").eq("id", user_id).execute().data or []
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Profile not found")
    profile = rows[0]

    # Quota math comes straight from quota.get_quota_state.
    state = get_quota_state(profile, datetime.now(timezone.utc))

    # All of this user's jobs from the ACTIVITY_DAYS window (small scale: fetch
    # all of them), newest first. The first ACTIVITY_JOBS rows are returned
    # verbatim; the full set feeds the daily rollup.
    since = (datetime.now(timezone.utc) - timedelta(days=ACTIVITY_DAYS)).isoformat()
    jobs = (
        db.table("lead_jobs")
        .select("id, status, requested, delivered, error, created_at")
        .eq("user_id", user_id)
        .gte("created_at", since)
        .order("created_at", desc=True)
        .execute()
        .data
        or []
    )

    # Rollup: one bucket per UTC day, newest day first; empty days stay at 0.
    today = datetime.now(timezone.utc).date()
    buckets: dict[date, dict[str, int]] = {
        today - timedelta(days=i): {"jobs": 0, "requested": 0, "delivered": 0, "failed_jobs": 0}
        for i in range(ACTIVITY_DAYS)
    }
    for row in jobs:
        bucket = buckets.get(_utc_date(row.get("created_at")))
        if bucket is None:
            continue
        bucket["jobs"] += 1
        bucket["requested"] += int(row.get("requested") or 0)
        bucket["delivered"] += int(row.get("delivered") or 0)
        if row.get("status") == "failed":
            bucket["failed_jobs"] += 1

    daily = [
        DailyBucketOut(
            date=day.isoformat(),
            jobs=bucket["jobs"],
            requested=bucket["requested"],
            delivered=bucket["delivered"],
            pending=max(bucket["requested"] - bucket["delivered"], 0),
            failed_jobs=bucket["failed_jobs"],
        )
        for day, bucket in sorted(buckets.items(), reverse=True)
    ]

    return ActivityOut(
        profile=ProfileOut(**profile),
        quota_state=QuotaStateBriefOut(
            remaining=state["remaining"],
            leads_today=state["leads_today"],
            daily_quota=state["daily_quota"],
            locked_until=state["locked_until"],
            can_request=state["can_request"],
        ),
        jobs=[ActivityJobOut(**row) for row in jobs[:ACTIVITY_JOBS]],
        daily=daily,
    )
