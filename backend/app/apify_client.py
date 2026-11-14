"""Apify lead enrichment: run an Instagram profile-details actor and normalize
its dataset items to a common {"username", "bio", "followers", "profile_url",
"is_private", "is_verified"} shape."""

from datetime import timedelta
import time
from typing import Final, Optional

from apify_client import ApifyClient
from apify_client.errors import ApifyApiError

from app.config import get_settings

MAX_BATCH_SIZE: Final[int] = 100      # usernames per actor run — one run per batch
RUN_TIMEOUT_SECS: Final[int] = 300.0  # max seconds to wait per run

class ApifyError(RuntimeError):
    """Raised when the Apify actor fails, times out, or config is missing."""

# Actor outputs differ — try these keys in order for each normalized field.
_BIO_KEYS: Final[tuple[str, ...]] = ("biography", "bio")
_FOLLOWER_KEYS: Final[tuple[str, ...]] = (
    "followerCount", "follower_count", "followersCount", "followers",
    "followers_count", "edge_followed_by",
)
_PRIVATE_KEYS: Final[tuple[str, ...]] = ("isPrivate", "is_private")
_VERIFIED_KEYS: Final[tuple[str, ...]] = ("isVerified", "is_verified")


def fetch_profiles(usernames: list[str]) -> list[dict]:
    """Fetch and normalize Instagram profile details for the given usernames.

    Sends the usernames to the actor in batches of MAX_BATCH_SIZE (exactly one
    actor run per batch) and returns one dict per item with keys {"username",
    "bio", "followers", "profile_url", "is_private", "is_verified"}. Items are
    skipped when the username is missing or when the actor row is empty/failed
    (no numeric followers value — followers is None). Logs how many usernames
    were requested, returned, and skipped. Raises ApifyError on actor failure.
    """
    results: list[dict] = []
    skipped = 0  # rows dropped: no username, or followers parsed to None

    for start in range(0, len(usernames), MAX_BATCH_SIZE):
        batch = usernames[start : start + MAX_BATCH_SIZE]
        for item in run_actor(batch):
            normalized = _normalize_item(item)
            if normalized is None:
                skipped += 1  # no username — cannot identify the account
                continue
            if normalized["followers"] is None:
                skipped += 1  # empty/failed actor row — no numeric follower count
                continue
            results.append(normalized)

    requested = len(usernames)
    print(
        f"fetch_profiles: {requested} usernames requested, "
        f"{len(results)} returned, {skipped} skipped",
        flush=True,
    )
    return results


def run_actor(usernames: list[str]) -> list[dict]:
    """Run the configured actor once with {"usernames": usernames} and return
    the RAW dataset items (unnormalized). Useful for inspecting actor output.

    Every start is announced with "starting actor run" so duplicate runs are
    visible. A batch starts the actor exactly once; there is never a retry
    after a SUCCEEDED outcome. Retry happens at most once, and only when the
    previous attempt genuinely failed (raised, timed out, or a non-SUCCEEDED
    terminal status). A failed dataset READ is not retried here — the run
    already succeeded, so starting the actor again would just burn quota.
    Raises ApifyError on missing config, actor failure, timeout, or dataset read failure.
    """
    settings = get_settings()
    if not settings.APIFY_API_TOKEN:
        raise ApifyError("APIFY_API_TOKEN is not set — add it to backend/.env")
    if not settings.APIFY_ACTOR_ID:
        raise ApifyError("APIFY_ACTOR_ID is not set — add it to backend/.env")

    client = ApifyClient(settings.APIFY_API_TOKEN.strip())  # strip stray whitespace from .env

    run: object = None  # run object/dict from the latest attempt
    status: str = "unknown"
    dataset_id: Optional[str] = None
    dataset_source: str = "?"  # where the dataset id appears to come from

    for attempt in (1, 2):  # one try + at most one retry
        print(f"starting actor run for {settings.APIFY_ACTOR_ID!r} (attempt {attempt}/2)", flush=True)
        try:
            # call() starts the run and blocks (up to wait_duration) until it
            # finishes. 3.x expects a timedelta (the old wait_secs=int kwarg).
            # The sones actor supports concurrent profile fetching — enable it.
            run_input: dict = {"usernames": usernames}
            if "sones" in settings.APIFY_ACTOR_ID.lower():
                run_input["maxConcurrentProfiles"] = 10
            run = client.actor(settings.APIFY_ACTOR_ID).call(
                run_input=run_input,
                wait_duration=timedelta(seconds=RUN_TIMEOUT_SECS),
            )
        except Exception as exc:  # network errors; genuine failure of attempt
            if attempt == 2:
                raise ApifyError(
                    f"Apify actor {settings.APIFY_ACTOR_ID!r} failed or timed out "
                    f"after {RUN_TIMEOUT_SECS}s (retry included): {exc}"
                ) from exc
            print(f"actor run attempt 1 failed ({exc}); retrying once", flush=True)
            continue

        status, dataset_id, dataset_source = _read_run_fields(run)
        if status == "SUCCEEDED":
            break  # success — never start the actor again for this batch
        if attempt == 2:
            timed_out = status in {"READY", "RUNNING"}  # no terminal status reached yet
            reason = f"did not finish within {RUN_TIMEOUT_SECS}s" if timed_out else "failed"
            raise ApifyError(
                f"Apify actor {settings.APIFY_ACTOR_ID!r} {reason} (status {status!r})"
            )
        print(f"actor run ended with status {status!r}; retrying once", flush=True)

    if run is None or not dataset_id:
        raise ApifyError("Apify run returned no defaultDatasetId")

    # Debug visibility: which run produced the dataset id, and from which field.
    run_id = run.get("id") if isinstance(run, dict) else getattr(run, "id", None)
    print(f"dataset id {dataset_id!r} taken from run {run_id!r} via {dataset_source}", flush=True)
    if not run_id:
        print("no run id on the run object/object — skipping cross-check", flush=True)
    else:
        # Cross-check WITHOUT starting any run: a plain GET on the run resource.
        try:
            fetched = client.run(run_id).get()
            verified = (
                fetched.get("defaultDatasetId")
                if isinstance(fetched, dict)
                else getattr(fetched, "default_dataset_id", None)
            )
            print(
                f"cross-check client.run({run_id!r}).get() "
                f"reports defaultDatasetId {verified!r}",
                flush=True,
            )
            if verified and verified != dataset_id:
                print(
                    f"MISMATCH: using the run-reported dataset {verified!r} instead of {dataset_id!r}",
                    flush=True,
                )
                dataset_id = verified
        except Exception as exc:
            print(f"could not cross-check dataset id via client.run(): {exc}", flush=True)

    # Read with a client built explicitly from the SAME settings token that
    # started the run (stripped of stray whitespace/newlines from .env).
    # Up to 3 attempts, 5s apart — retried ONLY for permission (404/403 /
    # "Insufficient permissions") errors, e.g. while the dataset settles
    # right after a successful run. Everything else fails immediately.
    read_client = ApifyClient(settings.APIFY_API_TOKEN.strip())
    for attempt in (1, 2, 3):
        try:
            return list(read_client.dataset(dataset_id).list_items(clean=True).items)
        except ApifyApiError as exc:
            retryable = (
                exc.status_code in {403, 404}
                or "insufficient permissions" in str(getattr(exc, "message", exc)).lower()
            )
            if attempt == 3 or not retryable:
                hint = _token_hint(settings.APIFY_API_TOKEN)  # first 8 chars only — never the full token
                raise ApifyError(
                    f"Failed to read Apify dataset {dataset_id!r} "
                    f"(GET /v2/datasets/{dataset_id}/items, attempt {attempt}/3; "
                    f"retried only on permission/404 errors). Token starts with {hint!r}... "
                    f"Full error: {exc}"
                ) from exc
            print(
                f"dataset read attempt {attempt}/3 retryable-failed "
                f"(status {exc.status_code}); waiting 5s, then retrying",
                flush=True,
            )
            time.sleep(5)
        except Exception as exc:  # non-API failure — no retry, full details
            hint = _token_hint(settings.APIFY_API_TOKEN)
            raise ApifyError(
                f"Failed to read Apify dataset {dataset_id!r} "
                f"(GET /v2/datasets/{dataset_id}/items). Token starts with {hint!r}... "
                f"Full error: {exc}"
            ) from exc


def _read_run_fields(run: object) -> tuple[str, Optional[str], str]:
    """Return (status, dataset_id, dataset_id_source) from a run that is a dict OR a 3.x object.

    Reads run.get("status"/"defaultDatasetId") for dicts and getattr(run,
    "status"/"default_dataset_id") for objects. Status may be a string or an
    enum — normalized via .value when present, "unknown" when missing. The
    third element names exactly where the dataset id came from, for debug logs.
    """
    if isinstance(run, dict):
        raw_status = run.get("status")
        dataset_id = run.get("defaultDatasetId")
        source = "dict 'defaultDatasetId'"
    else:
        raw_status = getattr(run, "status", None)
        dataset_id = getattr(run, "default_dataset_id", None)
        source = f"{type(run).__name__}.default_dataset_id attribute"

    if hasattr(raw_status, "value"):  # enum status — compare its string value
        status = str(raw_status.value)
    else:
        status = str(raw_status) if raw_status is not None else "unknown"
    return status, dataset_id, source


def _token_hint(token: str) -> str:
    """First 8 characters of the token for debug output — never the whole token."""
    return (token or "")[:8]


def _normalize_item(item: dict) -> Optional[dict]:
    """Map one raw dataset item onto the common schema; None if no username.

    Tolerant lookups, camelCase or snake_case: username; bio from biography/
    bio; followers from followerCount/follower_count/followersCount/followers/
    followers_count/edge_followed_by; privacy from isPrivate/is_private;
    verification from isVerified/is_verified. profile_url is taken from the
    item when present, else built canonically from the username.
    """
    username = str(item.get("username") or "").strip()
    if not username:
        return None  # useless without identifying the account

    # First present, non-empty bio field wins.
    bio_raw = _first_present(item, _BIO_KEYS)
    bio = bio_raw if isinstance(bio_raw, str) and bio_raw.strip() else None

    # First follower field that parses to an int wins; remains None otherwise.
    followers = _to_int(_first_present(item, _FOLLOWER_KEYS))
    is_private = _to_bool(_first_present(item, _PRIVATE_KEYS))
    is_verified = _to_bool(_first_present(item, _VERIFIED_KEYS))

    # Prefer an actor-provided profile URL; otherwise build the canonical one.
    profile_url = str(item.get("profile_url") or "").strip()
    if not profile_url:
        profile_url = f"https://www.instagram.com/{username}/"

    return {
        "username": username,
        "bio": bio,
        "followers": followers,
        "profile_url": profile_url,
        "is_private": is_private,
        "is_verified": is_verified,
    }


def _first_present(item: dict, keys: tuple[str, ...]) -> object:
    """Return the value of the first key present in the item (None if none)."""
    for key in keys:
        if key in item:
            return item[key]
    return None


def _to_bool(value: object) -> Optional[bool]:
    """Coerce boolean-ish actor fields; None when unclear."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1", "yes"}:
            return True
        if text in {"false", "0", "no"}:
            return False
    return None


def _to_int(value: object) -> Optional[int]:
    """Coerce follower values to int; edge_followed_by dicts use a "count" key."""
    if isinstance(value, dict):  # edge_followed_by: {"count": 123}
        value = value.get("count")
    if isinstance(value, bool):  # bool is an int subclass — never a follower count
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None
