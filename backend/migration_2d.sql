-- =============================================================================
-- migration_2d.sql — lead engine columns for public.leads
-- Run manually in Supabase (SQL editor / psql).
-- =============================================================================

-- status:      'accepted' (default — existing rows were all "leads") or 'rejected'
-- reject_reason: why the row was rejected (snippet prefilter / filter failure)
-- is_private:  private flag from the profile actor; unknown -> NULL (prefilter rejects)
alter table public.leads
  add column status        text not null default 'accepted'
                           check (status in ('accepted', 'rejected')),
  add column reject_reason text,
  add column is_private    bool;

comment on column public.leads.status        is 'Pipeline verdict: accepted (deliverable) or rejected.';
comment on column public.leads.reject_reason is 'Why the lead was rejected; NULL for accepted leads.';
comment on column public.leads.is_private    is 'Private flag from the profile actor; NULL when unknown.';
