"""Offline tests for app.quota — 8 cases, no network and no database.

Run from the backend/ folder:  python test_quota.py
Prints PASS/FAIL per case with the reason, plus a final summary.
"""

from datetime import datetime, timedelta, timezone

from app.quota import get_quota_state, leads_to_fetch

NOW = datetime(2026, 11, 10, 12, 0, 0, tzinfo=timezone.utc)

results: list[tuple[str, bool, str]] = []

def check(label: str, condition: bool, detail: str) -> None:
    """Record one PASS/FAIL case with its reason."""
    results.append((label, condition, detail))
    print(f"{'PASS' if condition else 'FAIL'}: {label} — {detail}")


# 1. fresh user: no window, full quota
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": True, "leads_today": 0, "window_start": None},
    NOW,
)
check(
    "fresh user: full quota, no lock",
    state["remaining"] == 50 and state["can_request"] and state["locked_until"] is None
    and state["leads_today"] == 0 and state["window_start"] is None
    and leads_to_fetch(state) == 50,
    str(state),
)

# 2. 30 of 50 used (window started 2h ago) — 20 remaining, unlocked
start = NOW - timedelta(hours=2)
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": True, "leads_today": 30,
     "window_start": start.isoformat()},  # ISO string, as PostgREST returns it
    NOW,
)
check(
    "30/50 used: 20 remaining, no lock",
    state["remaining"] == 20 and state["can_request"] and state["locked_until"] is None
    and state["window_start"] == start.isoformat() and leads_to_fetch(state) == 20,
    str(state),
)

# 3. 50 of 50 used — locked until window_start + 24h
start = NOW - timedelta(hours=5)
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": True, "leads_today": 50,
     "window_start": start.isoformat()},
    NOW,
)
expected_lock = (start + timedelta(hours=24)).isoformat()
check(
    "50/50 used: locked until start+24h",
    state["remaining"] == 0 and not state["can_request"]
    and state["locked_until"] == expected_lock and leads_to_fetch(state) == 0,
    str(state),
)

# 4. window expired after 24h — counter resets, window cleared, full quota
start = NOW - timedelta(hours=25)
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": True, "leads_today": 50,
     "window_start": start.isoformat()},
    NOW,
)
check(
    "expired window (>24h) resets",
    state["leads_today"] == 0 and state["remaining"] == 50 and state["can_request"]
    and state["window_start"] is None and state["locked_until"] is None,
    str(state),
)

# 5. exactly at the 24h boundary — expired (comparison is >=)
start = NOW - timedelta(hours=24)
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": True, "leads_today": 50,
     "window_start": start.isoformat()},
    NOW,
)
check(
    "exactly at 24h boundary counts as expired",
    state["remaining"] == 50 and state["window_start"] is None and state["can_request"],
    str(state),
)

# 6. cooldown disabled — no lock, no window, full quota on every click
start = NOW - timedelta(hours=3)
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": False, "leads_today": 50,
     "window_start": start.isoformat()},
    NOW,
)
check(
    "cooldown disabled: full quota, no lock/window",
    state["remaining"] == 50 and state["locked_until"] is None
    and state["window_start"] is None and state["can_request"]
    and leads_to_fetch(state) == 50,
    str(state),
)

# 7. daily_quota 100 — full 100 remaining
state = get_quota_state(
    {"daily_quota": 100, "cooldown_enabled": True, "leads_today": 0, "window_start": None},
    NOW,
)
check(
    "quota 100: 100 remaining",
    state["remaining"] == 100 and state["daily_quota"] == 100
    and leads_to_fetch(state) == 100,
    str(state),
)

# 8. leads_today > quota — remaining clamps to 0, still locked to window end
start = NOW - timedelta(hours=1)
state = get_quota_state(
    {"daily_quota": 50, "cooldown_enabled": True, "leads_today": 60,
     "window_start": start.isoformat()},
    NOW,
)
expected_lock = (start + timedelta(hours=24)).isoformat()
check(
    "leads_today > quota: remaining 0, never negative",
    state["remaining"] == 0 and not state["can_request"]
    and state["locked_until"] == expected_lock,
    str(state),
)

# --- summary --------------------------------------------------------------------
passed = sum(1 for _, ok, _ in results if ok)
print(f"\nSummary: {passed}/{len(results)} cases passed")
raise SystemExit(0 if passed == len(results) else 1)
