"""Lead filters: keyword signals, snippet follower parsing, and prefiltering.

Pure string/int logic only — no network calls. Used to decide which Serper
hits are worth spending Apify quota on.
"""

import re
from typing import Final, Optional

# --- keyword lists (edit freely — plain lowercase strings) ---------------------

# Signals that the account is Pakistani. "pk", "rs." etc. are matched with
# word boundaries; numeric phone/number signals live in the regex list below.
PAKISTAN_SIGNALS: Final[tuple[str, ...]] = (
    "pakistan",
    "pk",
    "+92",
    "pkr",
    "rs.",
    "karachi",
    "lahore",
    "islamabad",
    "rawalpindi",
    "faisalabad",
    "multan",
    "peshawar",
    "quetta",
    "sialkot",
    "hyderabad",
    "gujranwala",
    "all over pakistan",
)

# Numeric Pakistan signals that need regex, not simple keywords:
# "92" followed by digits (number written without +) and "03" + 9 digits.
PAKISTAN_SIGNAL_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"\b92\s?\d{6,}\b"),
    re.compile(r"\b03\d{9}\b"),
)

# Signals that the account sells something (e-commerce behavior).
ECOMMERCE_SIGNALS: Final[tuple[str, ...]] = (
    "shop",
    "store",
    "order",
    "delivery",
    "cod",
    "cash on delivery",
    "whatsapp",
    "wholesale",
    "collection",
    "boutique",
    "brand",
    "online",
    "shipping",
    "dm to order",
    "inbox",
    "sale",
)

# Signals that the account is NOT a lead (news, jokes, education, government).
REJECT_SIGNALS: Final[tuple[str, ...]] = (
    "news",
    "meme",
    "memes",
    "university",
    "college",
    "school",
    "government",
)

# "15K followers", "1.2K followers", "14.2K Followers", "776 followers", "1.5M followers"
_FOLLOWERS_RE: Final[re.Pattern[str]] = re.compile(r"(\d+(?:[.,]\d+)*)\s*([km])?\s*followers?", re.IGNORECASE)


# --- helpers -------------------------------------------------------------------


def _contains(text: str, term: str) -> bool:
    """Case-insensitive term match; word boundaries around alnum-only edges.

    "pk" matches "brand.pk" and "pk sale" but not inside "pkr";
    "rs." keeps its dot and needs no trailing boundary ("rs.300" matches).
    """
    term = term.lower()
    prefix = r"\b" if term[0].isalnum() else ""
    suffix = r"\b" if term[-1].isalnum() else ""
    return re.search(f"{prefix}{re.escape(term)}{suffix}", text.lower()) is not None


def _has_any(text: str, terms: tuple[str, ...], patterns: tuple[re.Pattern[str], ...] = ()) -> Optional[str]:
    """Return the FIRST matching term/pattern in text, or None if none match."""
    for term in terms:
        if _contains(text, term):
            return term
    for pattern in patterns:
        if pattern.search(text):
            return pattern.pattern
    return None


# --- public API -----------------------------------------------------------------


def parse_followers_from_snippet(snippet: str) -> Optional[int]:
    """Extract a follower count from text like "14.2K Followers" -> 14200.

    Understands plain numbers ("776"), thousands separators ("25,142"),
    and K/M suffixes ("15K", "1.2K", "1.5M"). Returns None when no count found.
    """
    if not snippet:
        return None
    match = _FOLLOWERS_RE.search(snippet)
    if not match:
        return None
    number_text, unit = match.group(1), match.group(2)

    if unit:  # K/M suffixes: dots are decimal points, commas are separators
        value = float(number_text.replace(",", ""))
        multiplier = 1_000 if unit.lower() == "k" else 1_000_000
        return int(value * multiplier)
    # Plain number: commas and dots are both thousands separators
    return int(number_text.replace(",", "").replace(".", ""))


def snippet_prefilter(snippet: str, max_followers: int = 10000) -> bool:
    """False only when the snippet clearly shows followers >= max_followers.

    Returns True when no follower count can be parsed (don't drop leads for
    missing data — that is what saves Apify cost without losing candidates).
    """
    followers = parse_followers_from_snippet(snippet)
    if followers is None:
        return True
    return followers < max_followers


def passes_filters(
    profile: dict,
    snippet: str = "",
    max_followers: int = 10000,
) -> tuple[bool, str]:
    """Decide whether an Apify profile row is a lead. Returns (ok, reason).

    Rules, in order:
      1. followers must be an int below max_followers
      2. account must not be private
      3. bio must contain no REJECT_SIGNALS
      4. bio + snippet must contain at least one PAKISTAN_SIGNAL
      5. bio + snippet must contain at least one ECOMMERCE_SIGNAL
    """
    followers = profile.get("followers")
    # bool is an int subclass — treat it as invalid too
    if not isinstance(followers, int) or isinstance(followers, bool):
        return (False, f"followers missing or not an int ({followers!r})")
    if followers >= max_followers:
        return (False, f"followers {followers} >= max {max_followers}")

    if profile.get("is_private") is True:
        return (False, "account is private")

    text = f"{profile.get('bio') or ''} {snippet}".lower()

    rejected = _has_any(text, REJECT_SIGNALS)
    if rejected is not None:
        return (False, f"reject signal {rejected!r}")

    pakistan = _has_any(text, PAKISTAN_SIGNALS, PAKISTAN_SIGNAL_PATTERNS)
    if pakistan is None:
        return (False, "no Pakistan signal in bio + snippet")

    ecommerce = _has_any(text, ECOMMERCE_SIGNALS)
    if ecommerce is None:
        return (False, "no e-commerce signal in bio + snippet")

    return (True, "ok")
