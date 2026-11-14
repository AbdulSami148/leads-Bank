"""Create (or reset) a user account directly via the service key.

    python create_user.py <email> <password> [--admin] [--quota 50]

- If an auth user with that email exists: reset the password and re-confirm
  the email via auth.admin.update_user_by_id.
- Otherwise: create the user with auth.admin.create_user (email_confirm True).
- Then update the profile: role ('admin' only with --admin) and daily_quota.
- Finally verify the new password by signing in with an anon-key client.
- Password must be at least 8 characters; the password is never printed.
"""

import argparse
import sys

from supabase import create_client

from app.config import get_settings
from app.db import get_db

MIN_PASSWORD_LENGTH = 8


def find_auth_user_id(email: str, db) -> str | None:
    """Return the auth user id whose email matches exactly (case-insensitive).

    The profiles table is not trusted for the id: its id can drift from the
    auth user id, which would make update_user_by_id hit the wrong (or no)
    auth user.
    """
    target = email.strip().lower()
    for user in db.auth.admin.list_users():
        if (user.email or "").strip().lower() == target:
            return user.id
    return None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or reset a user account (service key)."
    )
    parser.add_argument("email", help="user email")
    parser.add_argument("password", help="account password (never printed)")
    parser.add_argument("--admin", action="store_true", help="give the user role='admin'")
    parser.add_argument("--quota", type=int, default=50, help="daily_quota (default 50)")
    args = parser.parse_args()

    if len(args.password) < MIN_PASSWORD_LENGTH:
        print(f"FAIL: password must be at least {MIN_PASSWORD_LENGTH} characters")
        sys.exit(1)

    db = get_db()
    user_id = find_auth_user_id(args.email, db)

    if user_id:
        # Existing user: reset password and make sure the email stays confirmed.
        db.auth.admin.update_user_by_id(
            user_id,
            {"password": args.password, "email_confirm": True},
        )
        action = "reset password for existing user"
    else:
        # New user: create it; the signup trigger adds the profiles row.
        created = db.auth.admin.create_user({
            "email": args.email,
            "password": args.password,
            "email_confirm": True,
        })
        user_id = created.user.id
        action = "created new user"

    # Update the profile row: role + daily quota.
    profile_updates: dict = {"daily_quota": args.quota}
    if args.admin:
        profile_updates["role"] = "admin"
    db.table("profiles").update(profile_updates).eq("id", user_id).execute()

    # Verify the new password by signing in with an anon-key client.
    anon = create_client(get_settings().SUPABASE_URL, get_settings().SUPABASE_ANON_KEY)
    try:
        anon.auth.sign_in_with_password({"email": args.email, "password": args.password})
    except Exception as exc:
        raise RuntimeError(
            f"password reset for {args.email} did not take effect: login failed ({exc})"
        ) from exc
    anon.auth.sign_out()
    print("login verified")

    # Report without ever printing the password.
    role = "admin" if args.admin else "user"
    print(f"OK ({action})")
    print(f"email: {args.email}")
    print(f"role:  {role}")
    print(f"quota: {args.quota}")


if __name__ == "__main__":
    main()
