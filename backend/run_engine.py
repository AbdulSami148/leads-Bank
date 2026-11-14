"""CLI for the lead engine.

    python run_engine.py --count 10            # dry run, deliveries NOT written
    python run_engine.py --count 10 --record   # also mark leads as delivered

Finds or creates the test user test_engine@example.com (service key,
email_confirm True; the user is KEPT after the run), calls fetch_new_leads,
prints each lead and the stats, and records deliveries only with --record.
"""

import argparse
import uuid
from typing import Optional

from supabase import Client

from app.db import get_db
from app.lead_engine import fetch_new_leads, mark_delivered

TEST_EMAIL: str = "test_engine@example.com"


def _test_user_id() -> str:
    """Find the test user's id in the profiles table; create the account if missing.

    The profiles row (id mirrors auth.users.id, email) is the source of truth;
    auth.admin.create_user is only called when no profile row has TEST_EMAIL.
    """
    db = get_db()

    def _lookup() -> Optional[str]:
        """Return the profiles.id for TEST_EMAIL, or None when absent."""
        rows = db.table("profiles").select("id").eq("email", TEST_EMAIL).execute().data or []
        return rows[0]["id"] if rows else None

    found = _lookup()
    if found:
        print(f"[user] found existing test user ({found})")
        return found

    # Not found — create it with a random password (kept after the run).
    try:
        created = db.auth.admin.create_user({
            "email": TEST_EMAIL,
            "password": f"Engine!{uuid.uuid4().hex[:12]}",
            "email_confirm": True,
        })
        print(f"[user] created test user ({created.user.id})")
        return created.user.id
    except Exception as exc:
        if "already been registered" not in str(exc):
            raise
        # Someone registered TEST_EMAIL in the meantime — use its profile row.
        found = _lookup()
        if found:
            print(f"[user] already registered; using existing test user ({found})")
            return found
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the lead engine for the test user.")
    parser.add_argument("--count", type=int, default=10, help="how many leads to fetch")
    parser.add_argument("--record", action="store_true", help="also mark fetched leads as delivered")
    args = parser.parse_args()

    user_id = _test_user_id()
    print(f"[run] fetching {args.count} new leads for {TEST_EMAIL}…\n")

    leads, stats = fetch_new_leads(user_id, args.count)

    print(f"\n[run] {len(leads)} leads:")
    for lead in leads:
        bio = (lead.get("bio") or "")[:60]
        print(f"  {lead['username']:30s} followers={lead['followers']}  bio={bio}")
    print("\n[run] stats:")
    for key, value in stats.items():
        print(f"  {key}: {value}")

    if args.record:
        mark_delivered(user_id, [lead["id"] for lead in leads])
    else:
        print("\n[run] --record not passed: deliveries were NOT written")


if __name__ == "__main__":
    main()
