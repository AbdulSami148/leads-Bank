"""Google Sheets lead writer.

Delivered leads are appended to the Google Sheet each user links on their
profile (profiles.sheet_url). Access works by sharing the sheet with the
service-account email (Editor permission); no OAuth flow is involved.

Credentials come from config: either a key file (GOOGLE_SERVICE_ACCOUNT_FILE,
local dev) or the raw key JSON (GOOGLE_SERVICE_ACCOUNT_JSON, deployment — wins
over the file). Key contents are never printed or logged.
"""

import json
import re
from datetime import datetime, timezone
from functools import lru_cache
from typing import Final

import gspread
from google.oauth2.service_account import Credentials
from supabase import Client

from app.config import get_settings
from app.db import get_db

# The writer needs full sheets access (appending + header setup).
_SCOPES: Final[list[str]] = ["https://www.googleapis.com/auth/spreadsheets"]

# .../spreadsheets/d/<id>/... — the canonical share-link form.
_SHEET_ID_RE: Final[re.Pattern[str]] = re.compile(r"/spreadsheets/d/([a-zA-Z0-9_-]+)")

# Row 1 of the first worksheet, ensured (inserted if missing) by
# verify_sheet and append_leads — see _ensure_header.
HEADER_ROW: Final[list[str]] = ["Username", "Bio", "Followers", "Profile URL", "Date Added"]


class SheetError(Exception):
    """The sheet exists but cannot be used (not shared, API error, ...)."""


@lru_cache(maxsize=1)
def _credentials() -> Credentials:
    """Build the service-account credentials (JSON string wins over the file)."""
    settings = get_settings()
    if settings.GOOGLE_SERVICE_ACCOUNT_JSON:
        info = json.loads(settings.GOOGLE_SERVICE_ACCOUNT_JSON)
        return Credentials.from_service_account_info(info, scopes=_SCOPES)
    return Credentials.from_service_account_file(
        settings.GOOGLE_SERVICE_ACCOUNT_FILE, scopes=_SCOPES
    )


@lru_cache(maxsize=1)
def get_service_account_email() -> str:
    """Email of the service account — users must share their sheet with it.

    The email is not a secret (it is shown in the UI so users know what to
    share with); the key itself is never exposed.
    """
    return _credentials().service_account_email


def extract_sheet_id(url: str) -> str:
    """Pull the spreadsheet id out of a Google Sheets URL (.../d/<id>/...).

    Raises ValueError when the URL is not a Google Sheets document.
    """
    match = _SHEET_ID_RE.search(url.strip())
    if not match:
        raise ValueError("This is not a valid Google Sheets URL")
    return match.group(1)


def _open_first_worksheet(url: str) -> gspread.Worksheet:
    """Open the spreadsheet and return its first worksheet.

    Raises SheetError with a user-facing message when the sheet is not
    shared with the service account or otherwise unreachable.
    """
    try:
        spreadsheet = gspread.authorize(_credentials()).open_by_key(extract_sheet_id(url))
    except gspread.exceptions.APIError as exc:
        if exc.code in (401, 403):
            raise SheetError(
                "The sheet is not shared with the service account "
                f"{get_service_account_email()} (needs Editor access)"
            ) from exc
        if exc.code == 404:
            raise SheetError("Spreadsheet not found — check the link") from exc
        raise SheetError(f"Could not open the spreadsheet (Google API error {exc.code})") from exc
    except ValueError as exc:
        raise SheetError(str(exc)) from exc
    return spreadsheet.sheet1  # first worksheet


def _ensure_header(worksheet: gspread.Worksheet) -> None:
    """Make row 1 exactly the header row (inserted, never overwriting).

    Reads row 1 of the first worksheet: anything other than the exact
    HEADER_ROW (including an empty sheet) gets HEADER_ROW inserted at
    row 1 — insert_row adds a new row and shifts existing data down, so
    a first lead that landed in row 1 is preserved under the header.
    Afterwards the header cells are made bold and row 1 is frozen
    (both idempotent, cheap to repeat).
    """
    if worksheet.row_values(1) != HEADER_ROW:
        worksheet.insert_row(HEADER_ROW, index=1)  # new row; data shifts down
    last_col = chr(ord("A") + len(HEADER_ROW) - 1)  # "E" for the 5 header cells
    worksheet.format(f"A1:{last_col}1", {"textFormat": {"bold": True}})
    worksheet.freeze(rows=1)


def verify_sheet(url: str) -> None:
    """Check the sheet is usable and set up the header row.

    Called by POST /sheet/link before the URL is saved to the profile:
    opens the first worksheet with the service account (a clear SheetError
    when it is not shared) and ensures row 1 is exactly the header row —
    inserted (never overwriting data), bold and frozen.
    """
    worksheet = _open_first_worksheet(url)
    _ensure_header(worksheet)


def _profile_sheet_url(db: Client, user_id: str) -> str:
    """Read the user's linked sheet_url from profiles (service-key client)."""
    response = db.table("profiles").select("sheet_url").eq("id", user_id).single().execute()
    url = str((response.data or {}).get("sheet_url") or "")
    if not url:
        raise ValueError("No Google Sheet is linked for this user")
    return url


def append_leads(user_id: str, leads: list[dict]) -> bool:
    """Append delivered leads to the user's Google Sheet in one batch.

    Reads the linked sheet_url from profiles, converts every lead to a row
    ([username, bio, followers, profile_url, date added]; newlines in the bio
    replaced by spaces so one lead stays on one sheet row) and writes all of
    them with a single append_rows call. Retried once on failure; raises on
    the final failure so the lead job is marked failed with the reason.

    Returns True (jobs.py treats a falsy return as a failure).
    """
    if not leads:
        return True

    db = get_db()
    worksheet = _open_first_worksheet(_profile_sheet_url(db, user_id))

    # Guard against a wrong or missing header (sheet linked but never
    # verified, or a first lead that landed in row 1 before the header).
    _ensure_header(worksheet)

    today = datetime.now(timezone.utc).date().isoformat()
    rows: list[list[object]] = []
    for lead in leads:
        bio = str(lead.get("bio") or "").replace("\n", " ").replace("\r", " ")
        followers = lead.get("followers")
        rows.append([
            lead.get("username") or "",
            bio,
            "" if followers is None else followers,
            lead.get("profile_url") or "",
            today,
        ])

    # One batched write for the whole delivery; one retry on failure.
    try:
        worksheet.append_rows(rows, value_input_option="USER_ENTERED")
    except Exception:
        worksheet.append_rows(rows, value_input_option="USER_ENTERED")  # second and last try
    return True
