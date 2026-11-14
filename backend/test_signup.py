"""Signup / approval / gating flow test — requires the backend on http://localhost:8000.

    python test_signup.py

Flow: open signup returns 201 with a 'pending' profile, POST /leads/get is
gated (403) for pending and suspended users, duplicate/weak input is rejected,
the admin approves with daily_quota=2 (no real job is run), /admin/users/{id}/activity
returns profile + quota_state + jobs + daily, and a normal user gets 403 on
admin endpoints. All test users are deleted in a finally block.

Note: the backend rate-limits signups (5 per IP per hour, duplicates included),
so re-running this test several times within an hour can hit that limit.
"""

import os
import sys
import uuid
from typing import Any

import requests
from dotenv import load_dotenv

from supabase import create_client, Client

BASE_URL = "http://localhost:8000"

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
SUPABASE_URL = os.environ.get("SUPABASE_URL")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not all([SUPABASE_URL, ANON_KEY, SERVICE_KEY]):
    print("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY in .env")
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
    user_email = f"test_signup_user_{suffix}@example.com"
    password = "SignupTest!234"
    admin_email = f"test_signup_admin_{suffix}@example.com"
    user_id: Any = None
    admin_id: Any = None

    try:
        # --- setup: fresh admin (service key), promoted via profiles.role ------
        created = service.auth.admin.create_user(
            {"email": admin_email, "password": password, "email_confirm": True}
        )
        admin_id = created.user.id
        service.table("profiles").update({"role": "admin"}).eq("id", admin_id).execute()
        admin_headers = {"Authorization": f"Bearer {login(admin_email, password)}"}

        # --- a. signup -> 201, login works, /me shows status 'pending' ---------
        r = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"email": user_email, "password": password},
            timeout=30,
        )
        body = r.json() if r.status_code == 201 else {}
        user_id = body.get("id")
        check("a. signup -> 201", r.status_code == 201, f"status {r.status_code}, {body}", body=r.text)

        try:
            token = login(user_email, password)
            check("a. login works after signup", bool(token), "")
        except Exception as exc:
            token = ""
            check("a. login works after signup", False, str(exc))
        user_headers = {"Authorization": f"Bearer {token}"}

        me_resp = requests.get(f"{BASE_URL}/me", headers=user_headers, timeout=30)
        me = me_resp.json() if me_resp.status_code == 200 else {}
        check(
            "a. /me shows status 'pending'",
            r.status_code == 201 and me.get("status") == "pending",
            f"status {me.get('status')}",
            body=me_resp.text,
        )

        # --- b. pending user cannot fetch leads --------------------------------
        r = requests.post(f"{BASE_URL}/leads/get", headers=user_headers, timeout=30)
        check(
            "b. POST /leads/get as pending user -> 403",
            r.status_code == 403,
            f"status {r.status_code}, body {r.json()}",
            body=r.text,
        )

        # --- c. duplicate signup -> 409; bad input rejected ---------------------
        r = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"email": user_email, "password": password},
            timeout=30,
        )
        check("c. duplicate signup -> 409", r.status_code == 409, f"status {r.status_code}", body=r.text)

        r = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"email": f"short_{suffix}@example.com", "password": "short"},
            timeout=30,
        )
        check(
            "c. short password rejected (400 or 422)",
            r.status_code in (400, 422),
            f"status {r.status_code}",
            body=r.text,
        )

        r = requests.post(
            f"{BASE_URL}/auth/signup",
            json={"email": "not-an-email", "password": password},
            timeout=30,
        )
        check(
            "c. invalid email rejected (400 or 422)",
            r.status_code in (400, 422),
            f"status {r.status_code}",
            body=r.text,
        )

        # --- d. admin approves with quota 2; no real job is run -----------------
        r = requests.post(
            f"{BASE_URL}/admin/users/{user_id}/approve",
            headers=admin_headers,
            json={"daily_quota": 2},
            timeout=30,
        )
        approved = r.json() if r.status_code == 200 else {}
        check(
            "d. approve -> 200, status active, quota 2",
            r.status_code == 200 and approved.get("status") == "active"
            and approved.get("daily_quota") == 2,
            f"status {r.status_code}, {approved}",
            body=r.text,
        )

        me_resp = requests.get(f"{BASE_URL}/me", headers=user_headers, timeout=30)
        me = me_resp.json() if me_resp.status_code == 200 else {}
        check(
            "d. /me shows status 'active' after approval",
            me.get("status") == "active",
            f"status {me.get('status')}",
            body=me_resp.text,
        )

        # --- e. activity endpoint returns profile, quota_state, jobs, daily -----
        r = requests.get(
            f"{BASE_URL}/admin/users/{user_id}/activity", headers=admin_headers, timeout=30
        )
        activity = r.json() if r.status_code == 200 else {}
        ok = r.status_code == 200 and all(
            key in activity for key in ("profile", "quota_state", "jobs", "daily")
        )
        check("e. activity -> 200 with all keys", ok, f"status {r.status_code}, keys {list(activity)}",
              body=r.text)
        check(
            "e. activity: quota_state + daily shape",
            isinstance(activity.get("quota_state"), dict)
            and {"remaining", "leads_today", "daily_quota", "locked_until", "can_request"}
            <= set(activity.get("quota_state") or {})
            and isinstance(activity.get("daily"), list)
            and len(activity.get("daily") or []) == 30
            and all(
                {"date", "jobs", "requested", "delivered", "pending", "failed_jobs"}
                <= set(day) for day in (activity.get("daily") or [])
            ),
            f"days {len(activity.get('daily') or [])}",
            body=r.text,
        )

        # --- f. suspended user cannot fetch leads again -------------------------
        r = requests.patch(
            f"{BASE_URL}/admin/users/{user_id}",
            headers=admin_headers,
            json={"status": "suspended"},
            timeout=30,
        )
        check("f. suspend via PATCH -> 200", r.status_code == 200, f"status {r.status_code}", body=r.text)

        r = requests.post(f"{BASE_URL}/leads/get", headers=user_headers, timeout=30)
        check(
            "f. POST /leads/get as suspended user -> 403",
            r.status_code == 403,
            f"status {r.status_code}, body {r.json()}",
            body=r.text,
        )

        # --- g. normal user gets 403 on admin endpoints -------------------------
        for path in ("/admin/users", "/admin/stats", "/admin/jobs"):
            r = requests.get(f"{BASE_URL}{path}", headers=user_headers, timeout=30)
            check(f"g. GET {path} as normal user -> 403", r.status_code == 403,
                  f"status {r.status_code}", body=r.text)

    finally:
        # --- h. cleanup: delete both test users even on failure -----------------
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
