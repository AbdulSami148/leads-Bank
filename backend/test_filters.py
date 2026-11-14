"""Offline tests for app.filters — 10 hand-written cases, no network calls.

Run from the backend/ folder:  python test_filters.py
Prints PASS/FAIL per case with the reason, plus a final summary.
"""

from app.filters import parse_followers_from_snippet, passes_filters, snippet_prefilter

# (label, passed, detail)
results: list[tuple[str, bool, str]] = []

def check(label: str, condition: bool, detail: str) -> None:
    """Record one PASS/FAIL case with its reason."""
    results.append((label, condition, detail))
    print(f"{'PASS' if condition else 'FAIL'}: {label} — {detail}")


# 1. 25,142 followers -> reject (>= max_followers)
ok, reason = passes_filters(
    {"username": "bigshop", "bio": "Karachi clothing brand DM to order",
     "followers": 25_142, "is_private": False},
)
check("25,142 followers rejected", not ok and "followers" in reason, reason)

# 2. small Karachi clothing brand with "DM to order" -> accept
ok, reason = passes_filters(
    {"username": "karachi_threads", "bio": "Karachi clothing brand — DM to order, COD available",
     "followers": 2_500, "is_private": False},
)
check("small Karachi clothing brand accepted", ok and reason == "ok", reason)

# 3. private account -> reject
ok, reason = passes_filters(
    {"username": "private_shop", "bio": "Karachi boutique, DM to order",
     "followers": 900, "is_private": True},
)
check("private account rejected", not ok and "private" in reason, reason)

# 4. non-Pakistan brand (all e-commerce signals, no Pakistan signal) -> reject
ok, reason = passes_filters(
    {"username": "global_drip", "bio": "Premium cosmetics brand. Shop the new collection online",
     "followers": 3_000, "is_private": False},
    snippet="worldwide shipping",
)
check("non-Pakistan brand rejected", not ok and "Pakistan" in reason, reason)

# 5. news page in Lahore (Pakistan signal but reject keyword) -> reject
ok, reason = passes_filters(
    {"username": "lahore_updates", "bio": "Breaking news from Lahore",
     "followers": 1_500, "is_private": False},
)
check("news page rejected", not ok and "news" in reason, reason)

# 6. snippet prefilter: "15K followers" clearly >= 10000 -> False
check("prefilter 15K followers -> False", snippet_prefilter("Brand bio. 15K followers") is False,
      "15K >= 10000")

# 7. snippet prefilter: "776 followers" below threshold -> True
check("prefilter 776 followers -> True", snippet_prefilter("Small shop. 776 followers") is True,
      "776 < 10000")

# 8. snippet parsing: "1.2K followers" -> 1200 (also covers 14.2K style)
check("parse '1.2K followers' -> 1200", parse_followers_from_snippet("1.2K followers") == 1200,
      str(parse_followers_from_snippet("1.2K followers")))

# 9. missing/None followers -> reject
ok, reason = passes_filters(
    {"username": "no_count", "bio": "Karachi bakery, DM to order", "followers": None,
     "is_private": False},
)
check("None followers rejected", not ok and "followers" in reason, reason)

# 10. Pakistan signal present but no e-commerce signal -> reject
ok, reason = passes_filters(
    {"username": "pk_art", "bio": "Handmade crafts from Islamabad. +92 300 1234567",
     "followers": 1_200, "is_private": False},
    snippet="artwork showcase",
)
check("no e-commerce signal rejected", not ok and "e-commerce" in reason, reason)

# extra sanity (not counted as cases): 1.5M and 25,142 parsing, +92/03 phone signals
assert parse_followers_from_snippet("1.5M followers") == 1_500_000
assert parse_followers_from_snippet("25,142 followers") == 25_142
assert passes_filters(
    {"username": "wholesale_pk", "bio": "Wholesale boutique, WhatsApp +92 300 1234567",
     "followers": 800, "is_private": False},
) == (True, "ok")
assert passes_filters(
    {"username": "store_0333", "bio": "Online store, 03331234567, delivery all over pakistan",
     "followers": 5_000, "is_private": False},
) == (True, "ok")

# --- summary --------------------------------------------------------------------
passed = sum(1 for _, ok_, _ in results if ok_)
print(f"\nSummary: {passed}/{len(results)} cases passed")
raise SystemExit(0 if passed == len(results) else 1)
