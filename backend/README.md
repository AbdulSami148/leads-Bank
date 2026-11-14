# Backend tests

## test_isolation.py

Integration test for auth (`/me`, `/admin/users`) and RLS isolation
(`profiles`, `leads`, `deliveries`). Plain Python script — no pytest.

### What it does

1. Creates two throwaway Supabase users (userA, userB) with random emails and
   signs them in to get JWTs.
2. Checks `GET /health` (200), `GET /me` unauthenticated (401), and
   `GET /me` with each token returning only that user's profile.
3. Queries `profiles`, `leads`, and `deliveries` directly with userA's token
   to verify Row Level Security (own profile only, no leads, own deliveries).
4. Checks `GET /admin/users` is 403 for userA, promotes userA to admin via the
   service key, then re-checks (200, includes both users).
5. Deletes both test users in a `try/finally` cleanup block.

Each check prints `PASS` or `FAIL`; the script exits 0 only if all pass.

### Setup

1. Backend running locally on `http://localhost:8000`:

   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

2. Create `backend/.env` (same settings the app already expects):

   ```env
   SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_KEY=your-service-key   # service role — server-side only
   FRONTEND_ORIGIN=http://localhost:5173
   ```

3. Install dependencies (already in `requirements.txt`):

   ```bash
   pip install -r requirements.txt
   ```

   Requires: `requests`, `python-dotenv`, `supabase`.

### Run

From the `backend/` folder:

```bash
python test_isolation.py
```
