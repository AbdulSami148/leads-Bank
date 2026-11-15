"""Re-check test: every delivered lead must carry a fresh follower count.

Run from the backend/ folder (needs SUPABASE_* and APIFY_* in .env):

    python test_recheck.py

What it does:
  1. Seeds LEAD_COUNT known accepted bank leads with a deliberately wrong
     follower count (1). One of them is BALANCE_LEAD — a genuine Pakistani
     lead that was accepted thanks to its discovery snippet; it must survive
     the re-check. Another one gets TOO_MANY_FOLLOWERS (12000) injected into
     its fresh Apify data — it must be dropped.
  2. Creates a throwaway test user and runs the engine for 3 leads.
  3. Prints, per seeded lead: the old follower count, the fresh follower count
     and whether the lead was kept (delivered) or dropped.
  4. Restores every lead row the run touched and deletes the test user.

Every check prints PASS or FAIL; the script exits 0 only when all checks pass.
"""

import os
import sys
import uuid
from typing import Any, Optional

from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))   # must run before app imports
sys.path.insert(0, BACKEND_DIR)
sys.stdout.reconfigure(encoding="utf-8")          # bios/usernames may be unicode

import app.lead_engine as lead_engine                          # noqa: E402
from app.db import get_db                                     # noqa: E402
from app.lead_engine import fetch_new_leads                   # noqa: E402

LEAD_COUNT = 3          # leads the engine is asked for
WRONG_FOLLOWERS = 1     # the deliberately wrong follower count stored in the bank
BALANCE_LEAD = "balance_pakistan"   # accepted earlier via its snippet — must be kept
TOO_MANY_FOLLOWERS = 12000           # fresh follower count that must be dropped

# The seeded leads are moved to the front of the bank (oldest first), because
# several bank rows share the same found_at timestamp — without this the
# "first N leads" cut is not reproducible. found_at is restored afterwards.
SEED_FOUND_AT = "2000-01-01T00:00:00+00:00"

# Fields the test snapshots and restores (last_checked_at only exists after
# migration_6a has been run, so it is restored only when the column is there).
TRACKED_FIELDS: tuple[str, ...] = (
    "username", "bio", "followers", "profile_url", "is_private",
    "status", "reject_reason", "found_at", "last_checked_at",
)

results: list[tuple[str, bool, str]] = []


def check(label: str, condition: bool, detail: str = "") -> bool:
    """Record and print one PASS/FAIL check."""
    results.append((label, condition, detail))
    print(f"{'PASS' if condition else 'FAIL'}: {label}" + (f" — {detail}" if detail else ""))
    return condition


def snapshot_leads(db: Any) -> dict[str, dict]:
    """Snapshot every leads row (tracked fields only) for the cleanup."""
    rows = db.table("leads").select("*").execute().data or []
    return {
        row["id"]: {field: row[field] for field in TRACKED_FIELDS if field in row}
        for row in rows
    }


def restore_leads(db: Any, snapshot: dict[str, dict]) -> int:
    """Restore every leads row that changed during the run. Returns the count."""
    rows = db.table("leads").select("*").execute().data or []
    restored = 0
    for row in rows:
        before = snapshot.get(row["id"])
        if before is None:
            continue  # row created during the run — nothing to restore
        changes = {
            field: value
            for field, value in before.items()
            if field in row and row[field] != value
        }
        if changes:
            db.table("leads").update(changes).eq("id", row["id"]).execute()
            restored += 1
    return restored


def pick_leads(db: Any, count: int) -> list[dict]:
    """Pick the bank leads to seed: BALANCE_LEAD first, then the next accepted ones."""
    rows = (
        db.table("leads").select("id,username,followers")
        .eq("status", "accepted").order("found_at").execute().data or []
    )
    picked: list[dict] = []
    balance = next((row for row in rows if row["username"] == BALANCE_LEAD), None)
    if balance:
        picked.append(balance)
    for row in rows:
        if len(picked) >= count:
            break
        if row["username"] == BALANCE_LEAD:
            continue
        picked.append(row)
    return picked[:count]


def seed_leads(db: Any, rows: list[dict]) -> list[dict]:
    """Overwrite the stored follower count of the given leads with a wrong value.

    The rows are moved to the front of the bank, so the engine pulls exactly
    these leads first and the wrong follower count is guaranteed to be seen.
    """
    for row in rows:
        db.table("leads").update({
            "followers": WRONG_FOLLOWERS,
            "status": "accepted",
            "reject_reason": None,
            "found_at": SEED_FOUND_AT,
        }).eq("id", row["id"]).execute()
    return rows


def main() -> None:
    db = get_db()
    snapshot = snapshot_leads(db)
    seeded: list[dict] = []
    user_id: Optional[str] = None
    user_email = f"test_recheck_{uuid.uuid4().hex[:8]}@example.com"
    real_fetch_profiles = lead_engine.fetch_profiles

    try:
        # --- setup: known accepted leads with a wrong follower count ----------
        seeded = seed_leads(db, pick_leads(db, LEAD_COUNT))
        if not check(
            f"seeded {LEAD_COUNT} accepted leads with followers={WRONG_FOLLOWERS}",
            len(seeded) == LEAD_COUNT,
            f"got {len(seeded)}",
        ):
            return

        balance_rows = [row for row in seeded if row["username"] == BALANCE_LEAD]
        if not balance_rows:
            print(f"[warn] {BALANCE_LEAD} is not in the bank — that case is skipped")
        # The last seeded lead gets too many followers in its fresh data.
        too_many_row = seeded[-1]
        if too_many_row["username"] == BALANCE_LEAD:
            too_many_row = seeded[0]

        # --- setup: inject TOO_MANY_FOLLOWERS into that lead's fresh data -----
        def patched_fetch_profiles(usernames: list[str]) -> list[dict]:
            """Real Apify data, except the one lead that grew past the limit."""
            profiles = real_fetch_profiles(usernames)
            for profile in profiles:
                if profile["username"] == too_many_row["username"]:
                    profile["followers"] = TOO_MANY_FOLLOWERS
            return profiles

        lead_engine.fetch_profiles = patched_fetch_profiles

        # --- setup: throwaway test user (deleted in the cleanup) --------------
        created = db.auth.admin.create_user({
            "email": user_email,
            "password": f"Recheck!{uuid.uuid4().hex[:12]}",
            "email_confirm": True,
        })
        user_id = created.user.id
        print(f"[setup] test user {user_email} ({user_id})")
        print(f"[setup] {too_many_row['username']} will report {TOO_MANY_FOLLOWERS} "
              f"fresh followers")

        # --- run the engine for 3 leads ---------------------------------------
        leads, stats = fetch_new_leads(user_id, LEAD_COUNT)
        delivered = {lead["username"] for lead in leads}

        # --- report: old vs fresh follower count per seeded lead --------------
        print(f"\n=== Re-check report ===")
        print(f"{'username':28s} {'old followers':>14s} {'fresh followers':>16s}  kept")
        current = {
            row["id"]: row
            for row in (db.table("leads").select("*").execute().data or [])
        }
        for row in seeded:
            after = current.get(row["id"], {})
            fresh_followers = after.get("followers")
            kept = row["username"] in delivered
            note = "" if kept else f" ({after.get('reject_reason') or 'not delivered'})"
            print(f"{row['username']:28s} {WRONG_FOLLOWERS:>14d} "
                  f"{str(fresh_followers):>16s}  {'yes' if kept else 'no'}{note}")

        print(f"\nDelivered ({len(leads)}):")
        for lead in leads:
            print(f"  {lead['username']:28s} followers={lead.get('followers')}")
        print("\nStats:")
        for key, value in stats.items():
            print(f"  {key}: {value}")

        # --- checks ------------------------------------------------------------
        for row in seeded:
            after = current.get(row["id"], {})
            fresh_followers = after.get("followers")
            check(
                f"{row['username']}: follower count refreshed in the DB",
                isinstance(fresh_followers, int) and fresh_followers != WRONG_FOLLOWERS,
                f"old {WRONG_FOLLOWERS} -> fresh {fresh_followers}",
            )
            if row["username"] in delivered:
                delivered_lead = next(l for l in leads if l["username"] == row["username"])
                check(
                    f"{row['username']}: delivered with the fresh follower count",
                    delivered_lead.get("followers") == fresh_followers,
                    f"delivered {delivered_lead.get('followers')} vs db {fresh_followers}",
                )

        # The genuine lead accepted via its snippet must survive the re-check.
        if balance_rows:
            after = current.get(balance_rows[0]["id"], {})
            check(
                f"{BALANCE_LEAD}: kept after the re-check (snippet-only lead)",
                BALANCE_LEAD in delivered,
                f"followers {after.get('followers')}, status {after.get('status')}",
            )
            check(
                f"{BALANCE_LEAD}: still accepted in the DB",
                after.get("status") == "accepted",
                f"status {after.get('status')}, reason {after.get('reject_reason')}",
            )

        # The lead that grew past the follower limit must be dropped.
        after = current.get(too_many_row["id"], {})
        check(
            f"{too_many_row['username']}: dropped (fresh followers {TOO_MANY_FOLLOWERS})",
            too_many_row["username"] not in delivered and after.get("status") == "rejected",
            f"status {after.get('status')}, reason {after.get('reject_reason')}",
        )

        check(
            "every delivered lead carries a fresh follower count",
            all(isinstance(lead.get("followers"), int) and lead["followers"] != WRONG_FOLLOWERS
                for lead in leads),
            f"delivered {[lead.get('followers') for lead in leads]}",
        )
        check(
            "engine re-checked the bank leads (stats.rechecked > 0)",
            int(stats.get("rechecked") or 0) > 0,
            f"rechecked={stats.get('rechecked')}, dropped_on_recheck={stats.get('dropped_on_recheck')}",
        )
        check(
            "engine counted the drop (stats.dropped_on_recheck > 0)",
            int(stats.get("dropped_on_recheck") or 0) > 0,
            f"dropped_on_recheck={stats.get('dropped_on_recheck')}",
        )
        check(
            "engine delivered at most the requested number of leads",
            len(leads) <= LEAD_COUNT,
            f"delivered {len(leads)} of {LEAD_COUNT}",
        )

    finally:
        # --- cleanup: restore the lead rows and delete the test user ----------
        lead_engine.fetch_profiles = real_fetch_profiles
        restored = restore_leads(db, snapshot)
        print(f"\n[cleanup] restored {restored} lead row(s)")
        if user_id:
            try:
                db.auth.admin.delete_user(user_id)
                print(f"[cleanup] deleted test user {user_email}")
            except Exception as exc:
                print(f"[cleanup] FAILED to delete test user {user_email}: {exc}")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\nSummary: {passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
