"""Quota math for lead delivery: a 24h rolling window per profile row.

Pure functions only — no DB access and no network calls, so it is easy to
test. The API layer reads the profile row, calls get_quota_state() with the
current time, and enforces the cooldown server-side.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Final, Optional

WINDOW: Final[timedelta] = timedelta(hours=24)  # quota window length


def _as_datetime(value: object) -> Optional[datetime]:
    """Normalize window_start values: ISO strings (PostgREST) or datetimes.

    Naive datetimes are treated as UTC. Returns None when the value is
    missing or unparsable (then no window is applied).
    """
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:  # store/compare in UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def get_quota_state(profile: dict, now: datetime) -> dict[str, Any]:
    """Compute the quota state from a profiles row. `now` should be tz-aware.

    A window expires when now >= window_start + 24h: leads_today resets to 0
    and window_start is treated as unset. When remaining hits 0 with cooldown
    enabled, the account is locked until window_start + 24h.

    With cooldown_enabled False there is no lock and no window — every click
    gets the full daily_quota.
    """
    daily_quota = int(profile.get("daily_quota") or 0)
    cooldown_enabled = bool(profile.get("cooldown_enabled"))
    leads_today = int(profile.get("leads_today") or 0)
    raw_window = profile.get("window_start")

    # Cooldown disabled: no lock, no window, full quota on every click.
    if not cooldown_enabled:
        return {
            "remaining": daily_quota,
            "leads_today": leads_today,
            "daily_quota": daily_quota,
            "window_start": None,
            "locked_until": None,
            "can_request": daily_quota > 0,
        }

    window_start = _as_datetime(raw_window)
    # Window expired (now >= start + 24h): reset counter and window.
    if window_start is not None and now >= window_start + WINDOW:
        leads_today = 0
        window_start = None

    remaining = max(0, daily_quota - leads_today)  # never negative
    return {
        "remaining": remaining,
        "leads_today": leads_today,
        "daily_quota": daily_quota,
        "window_start": window_start.isoformat() if window_start else None,
        "locked_until": (
            (window_start + WINDOW).isoformat()
            if remaining == 0 and window_start is not None
            else None
        ),
        "can_request": remaining > 0,
    }


def leads_to_fetch(state: dict[str, Any]) -> int:
    """How many leads the user may fetch right now (= remaining quota)."""
    return int(state.get("remaining") or 0)
