# Frontend (Next.js App Router + TypeScript + Tailwind)

Login-only frontend for the Leads API: `/login` signs in with Supabase auth,
`/dashboard` shows the quota card and a Get Lead button that starts a backend
job and polls its status. All data comes from the backend API with a
`Bearer` access token — Supabase is used only for login/session.

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

## Endpoints used

| Call               | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `GET /me`          | profile row (not used by pages right now)        |
| `GET /leads/status`| quota state + latest job (polled every 5s)       |
| `POST /leads/get`  | start a lead job (409 running, 429 locked, 400)  |
