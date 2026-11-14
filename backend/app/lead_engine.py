"""Lead engine: bank-first lead delivery plus a Serper/Apify discovery pipeline.

fetch_new_leads NEVER writes to deliveries; the caller records them via
mark_delivered. Uses the service-key Supabase client from app.db.

Discovery is round-based and cost-aware: each round runs Serper searches in
parallel (5 workers) until enough NEW candidates are collected, then makes
exactly one Apify scrape per batch of up to 100 usernames.
"""

import math
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Final

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


def _bank(db: Client, user_id: str, count: int) -> list[dict]:
    """Step A: up to `count` accepted leads this user has NOT received yet."""
    delivered = db.table("deliveries").select("lead_id").eq("user_id", user_id).execute().data or []
    delivered_ids = [row["lead_id"] for row in delivered]

    query = db.table("leads").select("*").eq("status", "accepted").order("found_at").limit(count)
    if delivered_ids:  # "not in" fails on an empty list — only filter when needed
        query = query.not_.in_("id", delivered_ids)
    rows = query.execute().data or []
    print(f"[bank] {len(rows)} accepted leads not yet received by user {user_id[:8]}…")
    return rows


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
        "from_bank": 0, "serper_calls": 0, "candidates": 0, "prefiltered_out": 0,
        "apify_requested": 0, "apify_returned": 0, "accepted_new": 0,
        "rejected_new": 0, "returned": 0, "stopped_by_limit": False,
        "serper_seconds": 0.0, "apify_seconds": 0.0, "apify_runs": 0,
    }

    # --- Step A: bank first ------------------------------------------------------
    leads = _bank(db, user_id, count)
    stats["from_bank"] = len(leads)
    if len(leads) >= count:
        stats["returned"] = count
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
