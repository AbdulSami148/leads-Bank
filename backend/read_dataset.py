"""Offline debug for the "Insufficient permissions for the dataset" issue.

Reads and normalizes an EXISTING dataset end-point only — it never starts an
actor run. Usage (from the backend/ folder):

    python read_dataset.py <dataset_id>

Prints the dataset id used, the token prefix (first 8 chars, never the full
token), the raw items, the normalized results, and the full HTTP error if any.
"""

import sys

from apify_client import ApifyClient

from app.apify_client import _normalize_item, _token_hint
from app.config import get_settings


def main() -> None:
    if len(sys.argv) != 2:
        print("usage: python read_dataset.py <dataset_id>")
        raise SystemExit(1)
    dataset_id = sys.argv[1]

    settings = get_settings()
    token = settings.APIFY_API_TOKEN
    if not token:
        print("APIFY_API_TOKEN is not set — add it to backend/.env")
        raise SystemExit(1)

    print(f"dataset id: {dataset_id!r} (from argv)")
    print(f"token prefix: {_token_hint(token)!r}...  (full token never printed)")
    print(f"GET /v2/datasets/{dataset_id}/items ...")

    # Explicitly pass the token whose account should own the dataset.
    client = ApifyClient(token.strip())
    try:
        items = list(client.dataset(dataset_id).list_items(clean=True).items)
    except Exception as exc:  # ApifyApiError etc. — show FULL details, no truncation
        print(f"FAIL: full HTTP error details:\n{exc}")
        raise SystemExit(1)

    print(f"OK: {len(items)} items")
    if items:
        print("\nFirst raw item (as the actor saved it):")
        print(items[0])

    print("\nNormalized results:")
    for item in items:
        normalized = _normalize_item(item)
        if normalized is None:
            print("  (skipped: no username)")
            continue
        print(
            f"  {normalized['username']}: {normalized['followers']} followers, "
            f"private={normalized['is_private']}, verified={normalized['is_verified']}"
        )
        print(f"    {(normalized['bio'] or '')[:80]}")
        print(f"    {normalized['profile_url']}")


if __name__ == "__main__":
    main()
