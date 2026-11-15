"""Lead engine: bank-first lead delivery plus a Serper/Apify discovery pipeline.

fetch_new_leads NEVER writes to deliveries; the caller records them via
mark_delivered. Uses the service-key Supabase client from app.db.

Every delivered lead is verified in the SAME run: bank leads are re-checked
with Apify (fresh followers, bio, privacy flag) before they are handed out, and
leads scraped in Step B are fresh by definition. A lead that no longer passes
the filters is marked 'rejected' and is never delivered.

Discovery is round-based and cost-aware: each round runs Serper searches in
parallel (5 workers) until enough NEW candidates are collected, then makes
exactly one Apify scrape per batch of up to 100 usernames.
"""

import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Final, Optional

from supabase import Client

from app.apify_client import fetch_profiles
from app.db import get_db
from app.filters import parse_followers_from_snippet, passes_filters, snippet_prefilter
from app.serper import build_queries, search_instagram_profiles

BATCH_SIZE: Final[int] = 100           # usernames per Apify run (batches of up to 100)
MAX_SERPER_CALLS: Final[int] = 60      # max search_instagram_profiles invocations
MAX_APIFY_PROFILES: Final[int] = 300   # max usernames sent to the Apify actor
MAX_FOLLOWERS: Final[int] = 10000      # shared max_followers for prefilter/filters
SERPER_WORKERS: Final[int] = 5         # parallel Serper searches
CANDIDATE_YIELD: Final[float] = 0.25   # expected fraction of candidates that survive filters


# --- database helpers -----------------------------------------------------------


def _now_iso() -> str:
    """Current UTC time as an ISO string (PostgREST-friendly)."""
    return datetime.now(timezone.utc).isoformat()


# Cached result of the last_checked_at column probe (None = not probed yet).
_HAS_LAST_CHECKED_AT: Optional[bool] = None


def _has_last_checked_at(db: Client) -> bool:
    """True when public.leads has the last_checked_at column (migration_6a).

    The column is added by a manual migration, so the engine degrades
    gracefully on a database that has not been migrated yet: leads are still
    re-checked and refreshed, only the timestamp is skipped.
    """
    global _HAS_LAST_CHECKED_AT
    if _HAS_LAST_CHECKED_AT is None:
        rows = db.table("leads").select("*").limit(1).execute().data or []
        # An empty table proves nothing — assume the column is there.
        _HAS_LAST_CHECKED_AT = True if not rows else "last_checked_at" in rows[0]
        if not _HAS_LAST_CHECKED_AT:
            print("[warn] public.leads.last_checked_at is missing — run migration_6a.sql")
    return _HAS_LAST_CHECKED_AT


def _update_lead(db: Client, lead_id: str, values: dict) -> None:
    """Write fresh values into one leads row (no-op when the row is gone)."""
    db.table("leads").update(values).eq("id", lead_id).execute()


def _bank(db: Client, user_id: str, count: int, exclude: set[str] | None = None) -> list[dict]:
    """Step A: up to `count` accepted leads this user has NOT received yet.

    `exclude` holds usernames already handled in this run — they are still
    'accepted' and not delivered, so they have to be skipped explicitly.
    """
    delivered = db.table("deliveries").select("lead_id").eq("user_id", user_id).execute().data or []
    delivered_ids = [row["lead_id"] for row in delivered]
    skip = exclude or set()

    # The limit must leave room for the excluded rows: they are filtered out
    # server-side, so a plain limit(count) would return too few rows.
    query = (
        db.table("leads").select("*")
        .eq("status", "accepted").order("found_at").limit(count + len(skip))
    )
    if delivered_ids:  # "not in" fails on an empty list — only filter when needed
        query = query.not_.in_("id", delivered_ids)
    if skip:
        query = query.not_.in_("username", sorted(skip))
    rows = query.execute().data or []
    print(f"[bank] {len(rows)} accepted leads not yet received by user {user_id[:8]}…")
    return rows[:count]


def _recheck_leads(db: Client, rows: list[dict]) -> tuple[list[dict], int]:
    """Re-check bank leads with Apify and refresh their rows.

    `fetch_profiles` sends the usernames in batches of up to 100 — exactly one
    Apify run per batch. For every lead the fresh followers, bio and privacy
    flag are written back to the leads table, together with last_checked_at.
    The fresh profile is then run through `passes_filters`: a lead that no
    longer passes (followers over the limit, a private account, or no data
    returned at all) is marked 'rejected' and is NOT returned.

    Returns (kept_leads, dropped_count).
    """
    usernames = [row["username"] for row in rows]
    profiles = fetch_profiles(usernames)  # one Apify run per batch of <= 100
    fresh = {profile["username"]: profile for profile in profiles}

    stamp = _now_iso()                       # one timestamp for the whole batch
    has_stamp = _has_last_checked_at(db)    # False until migration_6a is run

    kept: list[dict] = []
    dropped = 0
    for row in rows:
        profile = fresh.get(row["username"])
        if profile is None:
            # No profile back from the actor — the lead cannot be delivered.
            reason = "profile missing or no data returned on re-check"
            values: dict = {"status": "rejected", "reject_reason": reason}
            if has_stamp:
                values["last_checked_at"] = stamp
            _update_lead(db, row["id"], values)
            dropped += 1
            print(f"[recheck] {row['username']}: dropped — {reason}")
            continue

        # The stored bio is the only context kept from the discovery snippet;
        # it carries the signals that made the lead acceptable back then.
        ok, reason = passes_filters(profile, row.get("bio") or "", MAX_FOLLOWERS)
        values = {
            "followers": profile["followers"],
            "bio": profile["bio"],
            "is_private": profile["is_private"],
            "status": "accepted" if ok else "rejected",
            "reject_reason": None if ok else reason,
        }
        if has_stamp:
            values["last_checked_at"] = stamp
        _update_lead(db, row["id"], values)

        if ok:
            kept.append({**row, **values})
            print(f"[recheck] {row['username']}: kept "
                  f"(followers {row.get('followers')} -> {profile['followers']})")
        else:
            dropped += 1
            print(f"[recheck] {row['username']}: dropped — {reason} "
                  f"(followers {row.get('followers')} -> {profile['followers']})")
    return kept, dropped


def _known_usernames(db: Client) -> set[str]:
    """All usernames already in the leads table (ANY status) — never scrape twice."""
    rows = db.table("leads").select("username").execute().data or []
    return {row["username"] for row in rows}


def _upsert_leads(db: Client, rows: list[dict]) -> list[dict]:
    """Upsert rows into leads on username; return the fresh rows (with ids)."""
    if not rows:
        return []
    db.table("leads").upsert(rows, on_conflict="username").execute()
    usernames = [row["username"] for row in rows]
    resp = db.table("leads").select("*").in_("username", usernames).execute()
    return resp.data or []


# --- engine ----------------------------------------------------------------------


def fetch_new_leads(user_id: str, count: int) -> tuple[list[dict], dict]:
    """Return (leads, stats) — exactly `count` leads when possible (partial OK).

    Step A serves from the bank of accepted leads the user has not received.
    Every bank lead is re-checked with Apify first: its row is refreshed
    (followers, bio, privacy flag, last_checked_at) and a lead that no longer
    passes the filters is rejected instead of delivered. When the rejections
    leave the request short, more bank leads are pulled — and re-checked the
    same way — before the discovery pipeline starts.

    Step B runs discovery ROUNDS: each round first collects new candidates in
    parallel Serper searches (5 workers) until target = ceil(needed / 0.25)
    candidates (capped by MAX_APIFY_PROFILES), then scrapes them with as few
    Apify runs as possible (batches of up to 100). Rounds repeat with the next
    queries while leads are still short, and stop at MAX_SERPER_CALLS /
    MAX_APIFY_PROFILES. Newly accepted leads are stored first, so extras stay
    banked for later runs.
    """
    db = get_db()
    stats: dict[str, int | bool | float] = {
        "from_bank": 0, "rechecked": 0, "dropped_on_recheck": 0,
        "serper_calls": 0, "candidates": 0, "prefiltered_out": 0,
        "apify_requested": 0, "apify_returned": 0, "accepted_new": 0,
        "rejected_new": 0, "returned": 0, "stopped_by_limit": False,
        "serper_seconds": 0.0, "apify_seconds": 0.0, "apify_runs": 0,
    }

    # --- Step A: bank first, every candidate re-checked with Apify -----------
    leads: list[dict] = []
    checked: set[str] = set()   # usernames already re-checked in this run

    while len(leads) < count:
        need = count - len(leads)
        bank_rows = _bank(db, user_id, need, exclude=checked)
        if not bank_rows:
            break  # the bank is empty (or everything left was already checked)
        checked.update(row["username"] for row in bank_rows)
        kept, dropped = _recheck_leads(db, bank_rows)
        stats["rechecked"] += len(bank_rows)
        stats["dropped_on_recheck"] += dropped
        leads.extend(kept[:need])   # extras stay banked (status accepted)
    stats["from_bank"] = len(leads)

    if len(leads) >= count:
        stats["returned"] = count
        print(f"[done] stats: {stats}")
        return leads, stats

    known = _known_usernames(db)      # any status — nothing scraped twice
    requested: set[str] = set()       # usernames already sent to Apify this run
    snippets: dict[str, str] = {}     # username -> Serper snippet (for filtering)
    print(f"[bank] {len(leads)}/{count} leads served; "
          f"discovering {count - len(leads)} more…")

    # --- Step B: discovery rounds -------------------------------------------------
    tasks = [(query, page) for query in build_queries() for page in (1, 2, 3)]
    task_index = 0

    while len(leads) < count and task_index < len(tasks):
        # Collect-first target: expect ~CANDIDATE_YIELD of candidates to survive
        # the filters, so search until ceil(needed / 0.25) candidates — capped
        # by the remaining Apify allowance.
        target = min(
            math.ceil((count - len(leads)) / CANDIDATE_YIELD),
            MAX_APIFY_PROFILES - stats["apify_requested"],
        )
        if target <= 0:
            stats["stopped_by_limit"] = True
            break

        # --- Serper collection phase (parallel waves, 5 workers) ---------------
        round_candidates: list[str] = []
        prefilter_rejects: list[dict] = []
        serper_started = time.perf_counter()
        with ThreadPoolExecutor(max_workers=SERPER_WORKERS) as pool:
            while (len(round_candidates) < target
                   and task_index < len(tasks)
                   and stats["serper_calls"] < MAX_SERPER_CALLS):
                wave = tasks[task_index : task_index + SERPER_WORKERS * 2]
                if stats["serper_calls"] + len(wave) > MAX_SERPER_CALLS:
                    wave = wave[: MAX_SERPER_CALLS - stats["serper_calls"]]
                    stats["stopped_by_limit"] = True
                if not wave:
                    break
                task_index += len(wave)
                stats["serper_calls"] += len(wave)
                print(f"[discover] serper wave of {len(wave)} calls "
                      f"({stats['serper_calls']}/{MAX_SERPER_CALLS})")
                # map preserves wave order; exceptions propagate like before
                for (query, page), hits in zip(
                    wave,
                    pool.map(lambda t: search_instagram_profiles(t[0], t[1]), wave),
                ):
                    for hit in hits:
                        username = hit["username"]
                        if username in known or username in requested:
                            continue  # already stored (any status) or already sent
                        snippet = hit.get("snippet", "")
                        if not snippet_prefilter(snippet, MAX_FOLLOWERS):
                            followers = parse_followers_from_snippet(snippet)
                            reason = (
                                f"snippet shows {followers} followers (>= {MAX_FOLLOWERS})"
                                if followers is not None
                                else f"snippet shows followers >= {MAX_FOLLOWERS}"
                            )
                            # Store as rejected; followers unknown is allowed here.
                            prefilter_rejects.append({
                                "username": username,
                                "profile_url": hit["profile_url"],
                                "status": "rejected",
                                "reject_reason": reason,
                                "is_private": None,
                            })
                            known.add(username)
                            continue
                        round_candidates.append(username)
                        snippets[username] = snippet
        stats["serper_seconds"] += round(time.perf_counter() - serper_started, 2)

        stats["candidates"] += len(round_candidates)
        stats["prefiltered_out"] += len(prefilter_rejects)
        if prefilter_rejects:
            _upsert_leads(db, prefilter_rejects)
            stats["rejected_new"] += len(prefilter_rejects)
            print(f"[discover] prefiltered out: {len(prefilter_rejects)} (stored as rejected)")

        # --- Apify phase: as few runs as possible (batches of up to 100) -------
        for start in range(0, len(round_candidates), BATCH_SIZE):
            if stats["apify_requested"] >= MAX_APIFY_PROFILES:
                stats["stopped_by_limit"] = True
                break
            batch = round_candidates[start : start + BATCH_SIZE]
            requested.update(batch)
            stats["apify_requested"] += len(batch)

            apify_started = time.perf_counter()
            detail = fetch_profiles(batch)
            stats["apify_seconds"] += round(time.perf_counter() - apify_started, 2)
            stats["apify_runs"] += 1

            # Classify each profile row the actor actually returned.
            lead_rows: list[dict] = []
            for prof in detail:
                ok, reason = passes_filters(prof, snippets.get(prof["username"], ""), MAX_FOLLOWERS)
                lead_rows.append({
                    "username": prof["username"],
                    "bio": prof["bio"],
                    "followers": prof["followers"],
                    "profile_url": prof["profile_url"],
                    "is_private": prof["is_private"],
                    "status": "accepted" if ok else "rejected",
                    "reject_reason": None if ok else reason,
                })
            if lead_rows and _has_last_checked_at(db):
                # Scraped in this run — the data is fresh, so stamp it.
                stamp = _now_iso()
                for lead_row in lead_rows:
                    lead_row["last_checked_at"] = stamp
            stored = _upsert_leads(db, lead_rows)
            accepted_rows = [row for row in stored if row["status"] == "accepted"]
            stats["accepted_new"] += len(accepted_rows)
            stats["rejected_new"] += len(stored) - len(accepted_rows)
            known.update(row["username"] for row in stored)
            # Profiles the actor returned nothing for are intentionally NOT
            # stored — they stay out of `known` so a later run can retry them.
            for row in accepted_rows:
                if len(leads) < count:
                    leads.append(row)  # extras just stay banked (status accepted)
            print(f"[discover] apify run {stats['apify_runs']} of {len(batch)} -> "
                  f"returned {len(detail)}, accepted {len(accepted_rows)}, "
                  f"rejected {len(stored) - len(accepted_rows)}, "
                  f"missing {len(batch) - len(detail)}")

    if (stats["serper_calls"] >= MAX_SERPER_CALLS
            or stats["apify_requested"] >= MAX_APIFY_PROFILES):
        stats["stopped_by_limit"] = True

    stats["returned"] = len(leads)
    print(f"[done] stats: {stats}")
    return leads, stats


def mark_delivered(user_id: str, lead_ids: list[str]) -> None:
    """Record deliveries; on-conflict-do-nothing on (user_id, lead_id)."""
    if not lead_ids:
        return
    db = get_db()
    rows = [{"user_id": user_id, "lead_id": lead_id} for lead_id in lead_ids]
    db.table("deliveries").upsert(
        rows, on_conflict="user_id,lead_id", ignore_duplicates=True,
    ).execute()
    print(f"[deliveries] recorded {len(rows)} deliveries for user {user_id[:8]}…")
