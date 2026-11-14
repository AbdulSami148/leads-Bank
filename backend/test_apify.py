"""Quick manual test for app.apify_client: fetch 3 known profiles.

Run from the backend/ folder (needs APIFY_API_TOKEN + APIFY_ACTOR_ID in .env):
    python test_apify.py

Calls fetch_profiles exactly once (one batch of 3 usernames), so the
"starting actor run" log appears only once per test run. No run_actor call
and no raw-item print — only the normalized results.
"""

from app.apify_client import fetch_profiles

usernames = ["nike", "nasa", "unofficial_clothing_store"]

print(f"Fetching {len(usernames)} profiles...\n")

try:
    profiles = fetch_profiles(usernames)  # single call — actor starts exactly once
except Exception as exc:  # ApifyError, missing config, timeout...
    print(f"FAIL: {exc}")
    raise SystemExit(1)

print("\nNormalized results:")
for profile in profiles:
    print(
        f"  {profile['username']}: {profile['followers']} followers, "
        f"private={profile['is_private']}, verified={profile['is_verified']}"
    )
    print(f"    {(profile['bio'] or '')[:80]}")
    print(f"    {profile['profile_url']}")
