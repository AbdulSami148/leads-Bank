"""Shared username rule — the display name a user shows in the app ("Ali Khan").

One validator for every place a username is accepted (signup, PATCH /me and
the admin user form), so the rule can never drift apart. Pure logic only: no
database access and no network calls.
"""

from typing import Final

USERNAME_MIN_LENGTH: Final[int] = 2    # "Al" is the shortest accepted name
USERNAME_MAX_LENGTH: Final[int] = 30   # long enough for "Muhammad Abdul Rehman"


class UsernameError(ValueError):
    """Raised for an invalid username — the message is shown to the user."""


def validate_username(raw: str) -> str:
    """Return the cleaned username or raise UsernameError with a clear message.

    Rules:
      - the value is trimmed before it is checked
      - 2 to 30 characters
      - letters of any script (str.isalpha) separated by single spaces
      - no digits, no symbols, no double/leading/trailing spaces
    """
    value = (raw or "").strip()

    if not value:
        raise UsernameError("Username is required")
    if len(value) < USERNAME_MIN_LENGTH or len(value) > USERNAME_MAX_LENGTH:
        raise UsernameError(
            f"Username must be between {USERNAME_MIN_LENGTH} and "
            f"{USERNAME_MAX_LENGTH} characters"
        )

    parts = value.split(" ")
    if any(not part for part in parts):
        # An empty part means a leading, trailing or repeated space.
        raise UsernameError("Username may only contain single spaces between words")
    if not all(part.isalpha() for part in parts):
        raise UsernameError("Username may only contain letters and single spaces")

    return value
