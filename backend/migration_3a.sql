-- =============================================================================
-- migration_3a.sql — lead_jobs: async lead-fetch jobs per user
-- Run manually in Supabase (SQL editor / psql).
-- =============================================================================

create table public.lead_jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      text not null default 'running'
              check (status in ('running', 'done', 'failed')),
  requested   int,
  delivered   int not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

comment on table  public.lead_jobs             is 'One row per async lead-fetch request; run by the API via BackgroundTasks.';
comment on column public.lead_jobs.user_id     is 'Requesting profile; cascades on user deletion.';
comment on column public.lead_jobs.status      is 'running (in progress), done (leads delivered), failed (error set).';
comment on column public.lead_jobs.requested   is 'How many leads the user asked for (the quota remaining).';
comment on column public.lead_jobs.delivered   is 'How many leads were actually delivered into deliveries.';
comment on column public.lead_jobs.error       is 'Error text when status is failed; NULL otherwise.';
comment on column public.lead_jobs.finished_at is 'When the job reached a terminal status; NULL while running.';

-- RLS: a user may read only their own job rows (service role bypasses RLS).
alter table public.lead_jobs enable row level security;

create policy "lead_jobs_select_own"
  on public.lead_jobs
  for select
  to authenticated
  using (user_id = auth.uid());

comment on policy "lead_jobs_select_own" on public.lead_jobs
  is 'Users can select only their own lead_jobs rows.';

-- Index for the common lookup: latest running/done job for a user.
create index lead_jobs_user_id_status_idx
  on public.lead_jobs (user_id, status);

comment on index lead_jobs_user_id_status_idx is 'Speeds up per-user job lookups (running check, latest job).';
