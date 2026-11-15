# Lead Bank — Frontend (Next.js App Router + TypeScript + Tailwind)

Lead Bank frontend: `/login` signs in with Supabase auth, `/dashboard` shows
the quota card and a Get Lead button that starts a backend job and polls its
status, `/settings` shows the account details and changes the password.
All data comes from the backend API with a `Bearer` access token — Supabase is
used only for login/session.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` (copy `.env.local.example`) and fill in:

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   NEXT_PUBLIC_API_URL=http://localhost:8000
   ```

3. The backend (in `../backend`) must be running with CORS allowed for this
   origin — set `FRONTEND_ORIGIN=http://localhost:3000` in the backend `.env`.

## Run

```bash
npm run dev
```

Then open http://localhost:3000 (redirects to `/login`; after sign-in you
land on `/dashboard`).

## Pages

| Route              | Who            | What it does                                              |
| ------------------ | -------------- | --------------------------------------------------------- |
| `/login`           | everyone       | Email + password sign-in                                  |
| `/signup`          | everyone       | Creates an account (pending until an admin approves it)   |
| `/dashboard`       | everyone       | Quota ring, Get Lead button, Google Sheet connection      |
| `/settings`        | everyone       | Account details and change password                       |
| `/admin`           | admins         | Users table, quotas, cooldown, approve/suspend, activity   |
| `/admin/users/:id` | admins         | Quota state, daily history and recent jobs of one user    |

## Endpoints used

| Call               | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `GET /me`          | profile row (role, status, quota)                |
| `GET /leads/status`| quota state + latest job (polled every 5s)       |
| `POST /leads/get`  | start a lead job (409 running, 429 locked, 400)  |
| `GET /sheet/info`  | linked sheet + service account email             |
| `POST /sheet/link` | link a Google Sheet                              |
| `GET /admin/stats` | user counts and deliveries today                 |
| `GET /admin/users` | all profile rows                                 |
| `GET/PATCH/POST /admin/users…` | quota, cooldown, status, activity, reset window |
