# Deployment

## How to start the backend

From the `backend/` directory:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

`$PORT` is supplied by the hosting platform. The app requires Python 3.13
(see `backend/.python-version`) and the packages pinned in
`backend/requirements.txt`.

## Environment variables

All of the following must be set in the deployment environment. No real
values are listed here.

### Backend

| Variable | Description |
|----------|-------------|
| SUPABASE_URL | Supabase project URL used by the server-side Supabase client. |
| SUPABASE_ANON_KEY | Supabase anon (public) key used by the server-side client. |
| SUPABASE_SERVICE_KEY | Supabase service-role key (server-side only, bypasses RLS — never expose to clients or browsers). |
| FRONTEND_ORIGIN | Comma-separated list of frontend origins allowed to call the API (CORS; trailing slashes are ignored). |
| SERPER_API_KEY | Serper.dev API key used for Google-search lead discovery. |
| APIFY_API_TOKEN | Apify API token used to run the Instagram profile-scraper actor. |
| APIFY_ACTOR_ID | ID of the Apify actor used to enrich Instagram profiles. |
| GOOGLE_SERVICE_ACCOUNT_JSON | Raw Google service-account key JSON used for Google Sheets writes (takes precedence over GOOGLE_SERVICE_ACCOUNT_FILE). |

### Frontend

| Variable | Description |
|----------|-------------|
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL for the browser Supabase client (session handling only). |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key for the browser Supabase client. |
| NEXT_PUBLIC_API_URL | Base URL of the backend API (defaults to http://localhost:8000). |

## Files that must not be committed

`backend/.env`, `frontend/.env.local` and `backend/service_account.json` contain
secrets and are covered by the root `.gitignore`. Create `.env` files on the
deployment host (or use the platform's environment-variable UI) instead.
