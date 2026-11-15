-- =============================================================================
-- migration_6a.sql — last_checked_at on public.leads
-- Run manually ONCE ONLY in Supabase (SQL editor / psql).
-- =============================================================================

-- Marks when a lead row was last verified against the live profile. The
-- engine re-checks every bank lead with Apify before delivering it, so this
-- column says how fresh the stored follower count / bio / privacy flag are.
-- NULL means "never re-checked" (the row still has its discovery-time data).
alter table public.leads
  add column if not exists last_checked_at timestamptz;

comment on column public.leads.last_checked_at is
  'When the lead profile was last re-checked with Apify (fresh followers/bio/private); NULL when never checked.';
