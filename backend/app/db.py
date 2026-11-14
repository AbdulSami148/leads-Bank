"""Supabase client creation (server-side only)."""

from typing import Final

from supabase import create_client, Client

from app.config import get_settings

# Single service-role client; the service key must never be exposed to clients.
# Supabase recommends a singleton for this client (service_role, bypasses RLS).
# IMPORTANT: never call auth.sign_in_* on this shared client — sign-ins must use
# a separate throwaway anon client, or the service session gets clobbered.
_client: Final[Client] = create_client(
    get_settings().SUPABASE_URL,
    get_settings().SUPABASE_SERVICE_KEY,
)


def get_db() -> Client:
    """Return the shared service-role Supabase client."""
    return _client
