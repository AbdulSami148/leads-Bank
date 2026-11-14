"""Serper.dev lead discovery: Google-search queries that surface Instagram
business profiles (Pakistan Instagram shops), plus URL filtering helpers."""

import re
from typing import Final
from urllib.parse import urlparse

import requests

from app.config import get_settings

# --- constants ----------------------------------------------------------------

SERPER_URL: Final[str] = "https://google.serper.dev/search"
REQUEST_TIMEOUT: Final[float] = 15.0  # seconds

# Instagram links must have exactly this one path segment: /<username>/
_PROFILE_HOST_RE: Final[re.Pattern[str]] = re.compile(
    r"^(www|m|l)\.instagram\.com$|^instagram\.com$", re.IGNORECASE
)

# Reserved IG paths that are NOT usernames (post/reel/story views, site pages...).
_RESERVED_PATHS: Final[frozenset[str]] = frozenset(
    {
        "popular", "explore", "accounts", "p", "reel", "reels", "stories",
        "tv", "directory", "about", "legal", "web", "developer",
    }
)

# A valid IG username: 1–30 chars of letters, digits, dots or underscores.
_USERNAME_RE: Final[re.Pattern[str]] = re.compile(r"[A-Za-z0-9_.]{1,30}")


class SerperError(RuntimeError):
    """Raised when the Serper API call fails (bad key, HTTP error, timeout, network)."""


# --- raw search ---------------------------------------------------------------


def search_organic(query: str, page: int = 1) -> list[dict]:
    """Run one Google search via Serper and return the RAW organic results list.

    Raises SerperError on HTTP/network failure. No filtering here — see
    search_instagram_profiles for the profile-filtered version.
    """
    api_key = get_settings().SERPER_API_KEY
    if not api_key:
        raise SerperError("SERPER_API_KEY is not set — add it to backend/.env")

    body: dict = {"q": query, "gl": "pk", "num": 10, "page": page}
    try:
        response = requests.post(
            SERPER_URL,
            headers={"X-API-KEY": api_key, "Content-Type": "application/json"},
            json=body,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()  # any 4xx/5xx lands in the HTTPError branch
    except requests.Timeout as exc:
        raise SerperError(f"Serper request timed out after {REQUEST_TIMEOUT}s") from exc
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else "?"
        detail = exc.response.text[:200] if exc.response is not None else ""
        raise SerperError(f"Serper returned HTTP {status} for query {query!r}: {detail}") from exc
    except requests.RequestException as exc:
        raise SerperError(f"Serper request failed: {exc}") from exc

    return response.json().get("organic", [])


# --- profile-filtered search --------------------------------------------------


def search_instagram_profiles(query: str, page: int = 1) -> list[dict]:
    """Google-search via Serper and return Instagram profile hits only.

    Returns a list of {"username", "profile_url", "snippet"} dicts with no
    duplicate usernames. If page 1 yields fewer than 10 profiles, page 2 and
    page 3 are also requested. Raises SerperError on HTTP/network failure.
    """
    found: dict[str, dict] = {}  # dedupe by username; keeps first-seen order

    for serper_page in (page, page + 1, page + 2):
        for item in search_organic(query, serper_page):
            username = extract_username(item.get("link", ""))
            if username and username not in found:
                found[username] = {
                    "username": username,
                    "profile_url": f"https://www.instagram.com/{username}/",
                    "snippet": item.get("snippet", ""),
                }

        # Only keep requesting extra pages while we are short of 10 profiles.
        if len(found) >= 10:
            break
    return list(found.values())


def extract_username(url: str) -> str | None:
    """Return the IG username from an instagram.com URL, or None if not a profile page.

    A profile link is instagram.com/<username>/ with EXACTLY one non-empty path
    segment; /p/, /reel/, /explore/, /stories/ and other reserved paths are
    rejected (multi-segment links like /p/<code>/ fail the one-segment rule).
    """
    try:
        parsed = urlparse(url or "")
    except ValueError:
        return None

    host = parsed.hostname or ""
    if not _PROFILE_HOST_RE.fullmatch(host):
        return None

    # Exactly one non-empty path segment, e.g. "/brand.pk/" or "/brand.pk".
    segments = [seg for seg in parsed.path.split("/") if seg]
    if len(segments) != 1:
        return None
    username = segments[0]

    # Must look like a username and must not be a reserved site path.
    if not _USERNAME_RE.fullmatch(username) or username.lower() in _RESERVED_PATHS:
        return None
    return username


# --- query generation ---------------------------------------------------------
# 20 short, simple queries ("site:instagram.com <category> <city>") rotated
# across categories and Pakistani cities. No quotes, no filler phrases.


def build_queries() -> list[str]:
    """Return 20 Serper queries for finding Pakistani Instagram shops."""
    return [
        # clothing / apparel
        "site:instagram.com clothing brand Karachi",
        "site:instagram.com clothing brand Lahore",
        # jewelry
        "site:instagram.com jewelry brand Lahore",
        "site:instagram.com jewelry brand Karachi",
        # shoes
        "site:instagram.com shoes brand Pakistan",
        "site:instagram.com shoes brand Karachi",
        # bags
        "site:instagram.com handbags brand Lahore",
        "site:instagram.com handbags brand Karachi",
        # cosmetics / beauty
        "site:instagram.com cosmetics brand Pakistan",
        "site:instagram.com makeup brand Karachi",
        # skincare
        "site:instagram.com skincare brand Lahore",
        # perfume
        "site:instagram.com perfume brand Pakistan",
        "site:instagram.com perfume brand Karachi",
        # watches
        "site:instagram.com watches brand Karachi",
        # home decor
        "site:instagram.com home decor Pakistan",
        "site:instagram.com home decor Islamabad",
        # kids wear
        "site:instagram.com kids wear Lahore",
        "site:instagram.com kids wear Karachi",
        # bakery
        "site:instagram.com bakery Islamabad",
        "site:instagram.com bakery Lahore",
    ]
