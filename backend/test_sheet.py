"""Google Sheets writer test — run with the sheet you want to test:

    python test_sheet.py <sheet_url>

Before running: share the spreadsheet with the service account (Editor) —
its email is printed below. The script verifies the sheet (shared + header
row) and then appends 3 dummy leads straight through the sheet_writer
functions — no lead engine, no Apify.

Uses the persistent test user test_engine@example.com (same find-or-create
logic as run_engine.py); the given sheet URL is saved as that user's
profiles.sheet_url before appending. The user is KEPT after the run.
"""

import os
import sys
import uuid
from pathlib import Path
from typing import Final, Optional

from dotenv import load_dotenv
from supabase import create_client, Client

from app.sheet_writer import append_leads, get_service_account_email, verify_sheet

TEST_EMAIL: Final[str] = "test_engine@example.com"

# 3 dummy leads: bio contains a newline on purpose (must become one sheet row).
DUMMY_LEADS: Final[list[dict]] = [
    {
        "id": f"dummy-{i}",
        "username": f"dummy_user_{i}",
        "bio": f"Test bio {i}\nwith a newline",
        "followers": 100 + i,
        "profile_url": f"https://instagram.com/dummy_user_{i}",
    }
    for i in range(1, 4)
]


def _test_user_id(service: Client) -> str:
    """Resolve the test user's id; create_user only as the last resort.

    Lookup order (profiles logic mirrors run_engine.py, plus a fallback):
    1. profiles table lookup by email (source of truth)
    2. auth user listing via list_users() — exact email match,
       case-insensitive (catches users missing from profiles)
    3. create_user — only when both lookups come up empty
    """
    def _lookup_profiles() -> Optional[str]:
        """Return the profiles.id for TEST_EMAIL, or None when absent."""
        rows = (
            service.table("profiles")
            .select("id")
            .eq("email", TEST_EMAIL)
            .execute()
            .data
            or []
        )
        return rows[0]["id"] if rows else None

    def _find_auth_user() -> Optional[str]:
        """Page through list_users() matching TEST_EMAIL exactly (case-insensitive)."""
        per_page, page = 100, 1
        while True:
            users = service.auth.admin.list_users(page=page, per_page=per_page)
            for user in users:
                if str(user.email or "").strip().lower() == TEST_EMAIL:
                    return user.id
            if len(users) < per_page:
                return None
            page += 1

    found = _lookup_profiles()
    if found:
        print(f"[user] found existing test user in profiles ({found})")
        return found

    found = _find_auth_user()
    if found:
        print(f"[user] found existing auth user ({found})")
        return found

    # Not found anywhere — create it with a random password (kept after the run).
    try:
        created = service.auth.admin.create_user({
            "email": TEST_EMAIL,
            "password": f"Engine!{uuid.uuid4().hex[:12]}",
            "email_confirm": True,
        })
        print(f"[user] created test user ({created.user.id})")
        return created.user.id
    except Exception as exc:
        if "already been registered" not in str(exc):
            raise
        # Someone registered TEST_EMAIL in the meantime — retry both lookups.
        found = _lookup_profiles() or _find_auth_user()
        if found:
            print(f"[user] already registered; using existing test user ({found})")
            return found
        raise


def main() -> None:
    """verify_sheet + append_leads as the test user, PASS/FAIL printed."""
    if len(sys.argv) != 2:
        print("usage: python test_sheet.py <sheet_url>")
        sys.exit(1)
    sheet_url: str = sys.argv[1]

    service: Client = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"],
    )

    # 1. who to share the sheet with (email is not a secret; the key is)
    print(f"service account: {get_service_account_email()}")

    try:
        # 2. the test user owns the sheet link (found or created, then kept)
        user_id = _test_user_id(service)

        # 3. save the given sheet URL on that user's profile
        service.table("profiles").update({"sheet_url": sheet_url}).eq("id", user_id).execute()
        print(f"[user] sheet_url saved for {TEST_EMAIL}")

        # 4. verify: opens the sheet, writes the header row if it is empty
        verify_sheet(sheet_url)
        print("PASS: sheet verified (opened, header row present)")

        # 5. append the dummy leads through the writer (one append_rows call)
        append_leads(user_id, DUMMY_LEADS)
        print(f"PASS: {len(DUMMY_LEADS)} dummy leads appended to the sheet")
    except Exception as exc:
        print(f"FAIL: {exc}")
        sys.exit(1)


# .env lives next to this script (backend/.env) — load it before touching env.
load_dotenv(Path(__file__).parent / ".env")
main()
