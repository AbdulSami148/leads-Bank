"""
test_isolation.py — plain-python integration test for auth + RLS isolation.

Run it while the backend is already serving on http://localhost:8000:

    python test_isolation.py

Reads SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY from the
.env file next to this script. Prints PASS/FAIL for every check and a
final summary. Cleans up its test users in a `finally` block.
"""

import sys
import uuid

import requests
from dotenv import load_dotenv
import os

from supabase import create_client, Client

BASE_URL = "http://localhost:8000"

# Load keys from .env (same folder as this script).
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

SUPABASE_URL = os.environ.get("SUPABASE_URL")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

if not all([SUPABASE_URL, ANON_KEY, SERVICE_KEY]):
    print("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY in .env")
    sys.exit(1)

# Service-role client (bypasses RLS) — used only for creating/promoting/deleting users
# and for promoting userA to admin in step 8.
admin: Client = create_client(SUPABASE_URL, SERVICE_KEY)

# Anon client — used to sign users in with their password.
anon: Client = create_client(SUPABASE_URL, ANON_KEY)

results: list[tuple[str, bool]] = []  # (check name, passed)

def check(name: str, ok: bool) -> None:
    """Record and print a single PASS/FAIL check."""
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}: {name}")

def main() -> None:
    # IDs / emails for the two throwaway users.
    user_a_id = user_b_id = None
    suffix = uuid.uuid4().hex[:8]
    email_a = f"test_userA_{suffix}@example.com"
    email_b = f"test_userB_{suffix}@example.com"
    password = "TestPass!234"

    try:
        # --- 1. Create the two users via the admin API, then sign in each ----
        resp = admin.auth.admin.create_user({"email": email_a, "password": password, "email_confirm": True})
        user_a_id = resp.user.id
        resp = admin.auth.admin.create_user({"email": email_b, "password": password, "email_confirm": True})
        user_b_id = resp.user.id

        session_a = anon.auth.sign_in_with_password({"email": email_a, "password": password})
        session_b = anon.auth.sign_in_with_password({"email": email_b, "password": password})
        token_a = session_a.session.access_token
        token_b = session_b.session.access_token
        check("create users + sign in", bool(token_a and token_b))

        # --- 2. GET /health returns 200 ---------------------------------------
        r = requests.get(f"{BASE_URL}/health", timeout=10)
        check("GET /health -> 200", r.status_code == 200)

        # --- 3. GET /me with no token returns 401 ------------------------------
        r = requests.get(f"{BASE_URL}/me", timeout=10)
        check("GET /me (no token) -> 401", r.status_code == 401)

        # --- 4. GET /me with each token returns that user's own profile --------
        r = requests.get(f"{BASE_URL}/me", headers={"Authorization": f"Bearer {token_a}"}, timeout=10)
        ok_a = r.status_code == 200 and r.json().get("id") == user_a_id
        check("GET /me (token A) -> own profile", ok_a)

        r = requests.get(f"{BASE_URL}/me", headers={"Authorization": f"Bearer {token_b}"}, timeout=10)
        ok_b = r.status_code == 200 and r.json().get("id") == user_b_id
        check("GET /me (token B) -> own profile", ok_b)

        # --- 5. Direct profiles query as userA returns only userA's row --------
        # Client with anon key, then stamp userA's JWT so RLS applies to that role.
        as_user_a: Client = create_client(SUPABASE_URL, ANON_KEY)
        as_user_a.postgrest.auth(token_a)
        profiles = as_user_a.table("profiles").select("id").execute().data or []
        check(
            "RLS profiles (token A) -> only own row",
            len(profiles) == 1 and profiles[0]["id"] == user_a_id,
        )

        # --- 6. As userA: leads is empty, deliveries only contain userA's rows --
        leads = as_user_a.table("leads").select("id").execute().data or []
        check("RLS leads (token A) -> no rows", len(leads) == 0)

        deliveries = as_user_a.table("deliveries").select("user_id").execute().data or []
        check(
            "RLS deliveries (token A) -> only own rows",
            all(d["user_id"] == user_a_id for d in deliveries),
        )

        # --- 7. GET /admin/users with userA's (non-admin) token -> 403 ----------
        r = requests.get(f"{BASE_URL}/admin/users", headers={"Authorization": f"Bearer {token_a}"}, timeout=10)
        check("GET /admin/users (token A, user) -> 403", r.status_code == 403)

        # --- 8. Promote userA to admin, then /admin/users -> 200 with both -----
        admin.table("profiles").update({"role": "admin"}).eq("id", user_a_id).execute()
        r = requests.get(f"{BASE_URL}/admin/users", headers={"Authorization": f"Bearer {token_a}"}, timeout=10)
        ids = [row.get("id") for row in (r.json() if r.status_code == 200 else [])]
        check(
            "GET /admin/users (token A, admin) -> 200 incl. both users",
            r.status_code == 200 and user_a_id in ids and user_b_id in ids,
        )

    finally:
        # --- 9. Cleanup: delete both users even if a check failed --------------
        for uid, email in ((user_a_id, email_a), (user_b_id, email_b)):
            if uid:
                try:
                    admin.auth.admin.delete_user(uid)
                    print(f"Cleanup ok: {email}")
                except Exception as exc:  # don't let cleanup failure mask the results
                    print(f"Cleanup FAILED for {email}: {exc}")

    # --- summary ------------------------------------------------------------
    passed = sum(1 for _, ok in results if ok)
    print(f"\nSummary: {passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
