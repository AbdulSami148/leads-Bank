-- =============================================================================
-- migration_7a.sql — display username on public.profiles
-- Run manually ONCE ONLY in Supabase (SQL editor / psql).
-- =============================================================================

-- The display name shown in the app ("Ali Khan"): letters and single spaces
-- only, 2-30 characters (the rule lives in backend/app/usernames.py).
-- NULL means "not set yet" — the user can add it later via PATCH /me.
alter table public.profiles
  add column if not exists username text;

comment on column public.profiles.username is
  'Display name of the user (letters and single spaces, 2-30 characters); NULL when not set.';
