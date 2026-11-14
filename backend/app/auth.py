"""Authentication dependencies: Bearer token verification and admin gate."""

import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase_auth.types import User as SupabaseUser
from supabase_auth.errors import AuthApiError, AuthInvalidJwtError
from supabase import Client

from app.db import get_db

logger = logging.getLogger("uvicorn.error")  # prints to the server console

# Extracts the "Authorization: Bearer <token>" header.
bearer_scheme = HTTPBearer(auto_error=False)

# Supabase error codes that mean "this token is invalid or expired".
_BAD_TOKEN_CODES: frozenset[str] = frozenset({
    "invalid_jwt",
    "bad_jwt",
    "expired_token",
    "session_expired",
})


def _is_bad_token(exc: Exception) -> bool:
    """True when Supabase itself rejected the token as invalid or expired."""
    if isinstance(exc, AuthInvalidJwtError):
        return True
    if isinstance(exc, AuthApiError) and getattr(exc, "status", None) == 401:
        return True
    code = str(getattr(exc, "code", "") or "").lower()
    return code in _BAD_TOKEN_CODES


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Client = Depends(get_db),
) -> SupabaseUser:
    """Verify the Supabase JWT and return the authenticated user.

    401 only when Supabase itself says the token is invalid or expired.
    Any other error (network hiccup, Supabase rate limit) is retried once,
    then surfaces as 503. The exception message is logged to the server
    console — never the token itself.
    """
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    user = None
    for attempt in (1, 2):
        try:
            response = db.auth.get_user(credentials.credentials)
            user = response.user
            break
        except Exception as exc:
            if _is_bad_token(exc):
                # Real token rejection: no retry helps. Log the reason, not the token.
                logger.error("Token rejected by Supabase auth: %s", exc)
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
            if attempt == 2:
                # Transient error on both attempts: tell the client to retry later.
                logger.error("Auth check failed after retry: %s", exc)
                raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Auth service unavailable, try again")
            logger.warning("Auth check error (attempt %s/2, retrying): %s", attempt, exc)

    if user is None:
        logger.error("Auth check returned no user for the provided token")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")

    return user


def require_admin(
    user: SupabaseUser = Depends(get_current_user),
    db: Client = Depends(get_db),
) -> SupabaseUser:
    """Allow only users whose profiles.role is 'admin'; otherwise 403."""
    response = (
        db.table("profiles")
        .select("role")
        .eq("id", user.id)
        .single()
        .execute()
    )
    role = (response.data or {}).get("role")

    if role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")

    return user
