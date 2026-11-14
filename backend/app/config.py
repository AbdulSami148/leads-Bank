"""Application settings loaded from environment variables / .env file."""

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed configuration, read once from the environment."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Supabase project credentials
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_KEY: str  # server-side only — never send to clients

    # CORS origin allowed to call this API
    FRONTEND_ORIGIN: str

    # Serper.dev API key — used for lead discovery (Google search)
    SERPER_API_KEY: str

    # Apify — profile-details enrichment actor (Instagram scrape). Actor ID is
    # the numeric id or its name+version form (e.g. "user/some-actor").
    APIFY_API_TOKEN: str
    APIFY_ACTOR_ID: str

    # Google service account used for Sheets writes. Credentials are either a
    # key file path (local dev) or the raw key JSON (deployment, wins over the
    # file). Neither value is ever printed or logged.
    GOOGLE_SERVICE_ACCOUNT_FILE: str = "service_account.json"
    GOOGLE_SERVICE_ACCOUNT_JSON: Optional[str] = None


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
