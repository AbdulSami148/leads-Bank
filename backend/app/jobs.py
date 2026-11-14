"""Lead job runner (sync) — started by FastAPI BackgroundTasks from POST /leads/get.

Pipeline: fetch leads -> write to the user's sheet (stub) -> record deliveries
-> bump the user's quota window -> mark the lead_jobs row done. On any
exception the job is marked failed and NO leads are recorded as delivered.
"""

from datetime import datetime, timezone
from typing import Optional

from supabase import Client

from app.db import get_db
from app.lead_engine import fetch_new_leads, mark_delivered
from app.sheet_writer import append_leads


def _now_iso() -> str:
    """Current UTC time as an ISO string (PostgREST-friendly)."""
    return datetime.now(timezone.utc).isoformat()


def run_lead_job(job_id: str, user_id: str, count: int) -> None:
    """Run one lead job end-to-end and keep lead_jobs / profiles in sync.

    Never raises: any failure is written into the lead_jobs row as
    status='failed' with the error text. Even a get_db() failure is caught and
    logged to the console, so the job can never stay 'running' forever.
    """
    try:
        db: Client = get_db()
        leads, _stats = fetch_new_leads(user_id, count)
        delivered = len(leads)

        # Sheet write must succeed before anything is recorded as delivered.
        if not append_leads(user_id, leads):
            raise RuntimeError("sheet_writer.append_leads failed")

        if delivered:
            mark_delivered(user_id, [lead["id"] for lead in leads])

        _bump_quota(db, user_id, delivered)
        db.table("lead_jobs").update({
            "delivered": delivered,
            "status": "done",
            "finished_at": _now_iso(),
        }).eq("id", job_id).execute()
        print(f"[job] {job_id[:8]}… done: delivered {delivered}/{count}")
    except Exception as exc:
        # Log to the console first, then best-effort mark the job failed.
        print(f"[job] {job_id[:8]}… FAILED: {exc}", flush=True)
        try:
            _fail(get_db(), job_id, exc)
        except Exception as fail_exc:
            # Even the failure update failed (e.g. DB unavailable) — log loudly.
            print(f"[job] {job_id[:8]}… could not mark job failed: {fail_exc}", flush=True)


def _bump_quota(db: Client, user_id: str, delivered: int) -> None:
    """Count the delivery against the quota window (cooldown users only).

    leads_today += delivered; a fresh window_start is set on first delivery.
    With cooldown disabled the window and counter are left untouched.
    """
    if delivered <= 0:
        return
    response = (
        db.table("profiles")
        .select("leads_today, window_start, cooldown_enabled")
        .eq("id", user_id)
        .single()
        .execute()
    )
    profile: Optional[dict] = response.data
    if not profile or not profile.get("cooldown_enabled"):
        return  # cooldown disabled -> do not touch window_start / leads_today

    update: dict[str, object] = {
        "leads_today": int(profile.get("leads_today") or 0) + delivered,
    }
    if not profile.get("window_start"):
        update["window_start"] = _now_iso()  # open the 24h window on first delivery
    db.table("profiles").update(update).eq("id", user_id).execute()


def _fail(db: Client, job_id: str, exc: Exception) -> None:
    """Mark the job failed with the error text; nothing was delivered."""
    db.table("lead_jobs").update({
        "status": "failed",
        "error": str(exc),
        "finished_at": _now_iso(),
    }).eq("id", job_id).execute()
    print(f"[job] {job_id[:8]}… FAILED: {exc}")
