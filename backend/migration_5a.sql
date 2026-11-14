-- =============================================================================
-- migration_5a.sql — account status on profiles (pending / active / suspended)
-- Run manually ONCE ONLY in Supabase (SQL editor / psql).
-- =============================================================================

-- New accounts start as 'pending' (the signup trigger creates the row) and an
-- admin moves them to 'active' (or 'suspended') via the API.
alter table public.profiles
  add column if not exists status
  text not null default 'pending'
  check (status in ('pending', 'active', 'suspended'));

comment on column public.profiles.status is
  'Account state: pending (awaiting approval), active, suspended.';

-- Existing users are already known — mark them active.
-- (Run once only; safe to skip if the column was added before.)
update public.profiles set status = 'active' where status <> 'active';
