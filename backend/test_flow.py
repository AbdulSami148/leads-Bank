"""End-to-end flow test — requires the backend running on http://localhost:8000.

    python test_flow.py

Flow: service-key client creates a fresh admin (promoted via profiles.role),
the admin creates a quota-3 test user via POST /admin/users, the user links
its Google Sheet (TEST_SHEET_URL from .env) via POST /sheet/link, the user
fetches leads until the job delivers exactly 3, gets 429 on the next request,
admin resets the window and the user can start another job, and /admin/jobs +
/admin/stats return data. Both test users are deleted in a finally block.
"""

import sys
import time
import uuid
from typing import Any

import requests
from dotenv import load_dotenv
import os

from supabase import create_client, Client

BASE_URL = "http://localhost:8000"
POLL_INTERVAL = 5        # seconds between /leads/status polls
POLL_MAX = 10 * 60       # give the discovery pipeline up to 10 minutes

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
SUPABASE_URL = os.environ.get("SUPABASE_URL")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
TEST_SHEET_URL = os.environ.get("TEST_SHEET_URL")  # sheet the test user links in a3
if not all([SUPABASE_URL, ANON_KEY, SERVICE_KEY]):
    print("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY in .env")
    sys.exit(1)
if not TEST_SHEET_URL:
    print(
        "Missing TEST_SHEET_URL in .env — set it to the Google Sheet URL the test "
        "user links (shared with the service account as Editor)"
    )
    sys.exit(1)

service: Client = create_client(SUPABASE_URL, SERVICE_KEY)
anon: Client = create_client(SUPABASE_URL, ANON_KEY)

results: list[tuple[str, bool, str]] = []

def check(label: str, condition: bool, detail: str = "", body: str = "") -> bool:
    """Record and print one PASS/FAIL step (body shown on failure)."""
    results.append((label, condition, detail))
    line = f"{'PASS' if condition else 'FAIL'}: {label}" + (f" — {detail}" if detail else "")
    if not condition and body:
        line += f"\n    response body: {body}"
    print(line)
    return condition

def login(email: str, password: str) -> str:
    """Password login via the anon client; returns the access token."""
    session = anon.auth.sign_in_with_password({"email": email, "password": password})
    return session.session.access_token

def main() -> None:
    suffix = uuid.uuid4().hex[:8]
    admin_email = f"test_flow_admin_{suffix}@example.com"
    user_email = f"test_flow_user_{suffix}@example.com"
    password = "FlowTest!234"
    admin_id = user_id = None
    admin_token = user_token = ""

    try:
        # --- setup: fresh admin (service key), promoted via profiles.role ----
        created = service.auth.admin.create_user(
            {"email": admin_email, "password": password, "email_confirm": True}
        )
        admin_id = created.user.id
        service.table("profiles").update({"role": "admin"}).eq("id", admin_id).execute()
        admin_token = login(admin_email, password)
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # --- a. create the test user via POST /admin/users -------------------
        r = requests.post(
            f"{BASE_URL}/admin/users",
            headers=admin_headers,
            json={"email": user_email, "password": password, "daily_quota": 3},
            timeout=30,
        )
        profile = r.json() if r.status_code == 201 else {}
        ok = check(
            "a. POST /admin/users creates user with daily_quota=3",
            r.status_code == 201 and profile.get("daily_quota") == 3,
            f"status {r.status_code}, quota {profile.get('daily_quota')}",
            body=r.text,
        )
        user_id = profile.get("id")
        if not ok or not user_id:
            raise RuntimeError("cannot continue without the test user")

        # --- a2. approve the user (status active + quota in one call) ----------
        r = requests.post(
            f"{BASE_URL}/admin/users/{user_id}/approve",
            headers=admin_headers,
            json={"daily_quota": 3},
            timeout=30,
        )
        profile = r.json() if r.status_code == 200 else {}
        check(
            "a2. approve -> status active, daily_quota=3",
            r.status_code == 200 and profile.get("status") == "active"
            and profile.get("daily_quota") == 3,
            f"status {r.status_code}, {profile}",
            body=r.text,
        )

        # --- a3. link the test user's Google Sheet ----------------------------
        user_token = login(user_email, password)
        user_headers = {"Authorization": f"Bearer {user_token}"}
        r = requests.post(
            f"{BASE_URL}/sheet/link",
            headers=user_headers,
            json={"sheet_url": TEST_SHEET_URL},
            timeout=60,
        )
        check(
            "a3. POST /sheet/link verifies and links the sheet",
            r.status_code == 200,
            f"status {r.status_code}, {(r.json() or {}).get('sheet_url')}",
            body=r.text,
        )

        # --- b. user fetches leads; poll until the job is done ----------------
        r = requests.post(f"{BASE_URL}/leads/get", headers=user_headers, timeout=30)
        body = r.json() if r.status_code == 200 else {}
        job_id = body.get("job_id")
        check(
            "b. POST /leads/get starts job (requested=3)",
            r.status_code == 200 and job_id and body.get("requested") == 3,
            f"status {r.status_code}, {body}",
            body=r.text,
        )
        if r.status_code != 200:
            # Fail immediately: there is no job to poll for — the finally block
            # below still deletes both test users.
            raise RuntimeError("cannot continue: POST /leads/get did not return 200")

        delivered, job_error, job_status = None, None, None
        deadline = time.time() + POLL_MAX
        while time.time() < deadline:
            time.sleep(POLL_INTERVAL)
            r = requests.get(f"{BASE_URL}/leads/status", headers=user_headers, timeout=30)
            job = (r.json() or {}).get("job") if r.status_code == 200 else None
            if not job:
                continue
            job_status = job.get("status")
            if job_status in ("done", "failed"):
                delivered = job.get("delivered")
                job_error = job.get("error")
                break
        check(
            "b. job done with delivered == 3",
            job_status == "done" and delivered == 3,
            f"status {job_status}, delivered {delivered}, error {job_error}",
        )

        # --- c. immediate second fetch -> 429 with locked_until ---------------
        r = requests.post(f"{BASE_URL}/leads/get", headers=user_headers, timeout=30)
        detail = (r.json() or {}).get("detail") or {}
        check(
            "c. second POST /leads/get -> 429 with locked_until",
            r.status_code == 429 and bool(detail.get("locked_until")),
            f"status {r.status_code}, detail {detail}",
            body=r.text,
        )

        # --- d. admin resets the window; user can start another job ----------
        r = requests.post(
            f"{BASE_URL}/admin/users/{user_id}/reset-window",
            headers=admin_headers,
            timeout=30,
        )
        check("d. reset-window -> 200", r.status_code == 200, f"status {r.status_code}", body=r.text)

        r = requests.post(f"{BASE_URL}/leads/get", headers=user_headers, timeout=30)
        check(
            "d. POST /leads/get works again (200, new job)",
            r.status_code == 200 and bool((r.json() or {}).get("job_id")),
            f"status {r.status_code}",
            body=r.text,
        )
        # stop here — do NOT wait for the second job

        # --- e. admin data endpoints ------------------------------------------
        r = requests.get(f"{BASE_URL}/admin/jobs", headers=admin_headers, timeout=30)
        jobs = r.json() if r.status_code == 200 else []
        check(
            "e. GET /admin/jobs -> 200 with rows incl. email",
            r.status_code == 200 and len(jobs) >= 1 and jobs[0].get("email") is not None,
            f"status {r.status_code}, {len(jobs)} rows",
            body=r.text[:2000],
        )

        r = requests.get(f"{BASE_URL}/admin/stats", headers=admin_headers, timeout=30)
        stats = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and all(
            key in stats for key in
            ("total_users", "pending_users", "active_users", "delivered_today")
        )
        check("e. GET /admin/stats -> 200 with all keys", ok, str(stats), body=r.text)
        check(
            "e. stats: delivered_today >= 3 (first job recorded)",
            isinstance(stats.get("delivered_today"), int) and stats["delivered_today"] >= 3,
            f"delivered_today={stats.get('delivered_today')}",
            body=r.text,
        )

    finally:
        # --- f. cleanup: delete both test users even on failure ----------------
        for uid, email in ((admin_id, admin_email), (user_id, user_email)):
            if uid:
                try:
                    service.auth.admin.delete_user(uid)
                    print(f"Cleanup ok: {email}")
                except Exception as exc:
                    print(f"Cleanup FAILED for {email}: {exc}")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\nSummary: {passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
