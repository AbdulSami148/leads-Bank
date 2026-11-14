-- =============================================================================
-- schema.sql — Supabase Postgres schema
-- Tables: profiles, leads, deliveries
-- Plus: auth.users trigger, RLS policies, admin helper function
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. profiles
-- One row per application user. Linked 1:1 with auth.users.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text,
  role             text not null default 'user' check (role in ('admin', 'user')),
  daily_quota      int  not null default 50,
  cooldown_enabled bool not null default true,
  sheet_url        text,                                        -- nullable by default
  window_start     timestamptz,                                 -- nullable by default
  leads_today      int  not null default 0,
  created_at       timestamptz not null default now()
);

comment on table  public.profiles                 is 'Per-user settings and quota state, linked to auth.users.';
comment on column public.profiles.id              is 'Mirrors auth.users.id; cascades on user deletion.';
comment on column public.profiles.role            is 'Either "admin" or "user" (default).';
comment on column public.profiles.daily_quota     is 'Maximum leads a user may receive per day.';
comment on column public.profiles.cooldown_enabled is 'Whether delivery cooldowns are active for this user.';
comment on column public.profiles.sheet_url       is 'Optional link to the user''s Google Sheet.';
comment on column public.profiles.window_start    is 'Start of the current quota window.';
comment on column public.profiles.leads_today     is 'Leads delivered to this user in the current window.';

-- -----------------------------------------------------------------------------
-- 2. leads
-- Scrape results. No RLS policies: only the service role (bypasses RLS) reads it.
-- -----------------------------------------------------------------------------
create table public.leads (
  id          uuid not null default gen_random_uuid(),
  username    text not null unique,
  bio         text,
  followers   int,
  profile_url text,
  found_at    timestamptz not null default now()
);

-- id is intentionally NOT a primary key here (per spec); add a key for joins.
alter table public.leads add constraint leads_pkey primary key (id);

comment on table  public.leads              is 'Scraped leads; readable only via the service role (no RLS policies).';
comment on column public.leads.username     is 'Handle of the lead; unique across the table.';
comment on column public.leads.bio          is 'Profile bio text as scraped.';
comment on column public.leads.followers    is 'Follower count at scrape time.';
comment on column public.leads.profile_url  is 'Public profile URL of the lead.';
comment on column public.leads.found_at     is 'When the lead was discovered.';

-- -----------------------------------------------------------------------------
-- 3. deliveries
-- Which lead was delivered to which user, and when.
-- -----------------------------------------------------------------------------
create table public.deliveries (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  lead_id      uuid not null references public.leads (id)    on delete cascade,
  delivered_at timestamptz not null default now(),
  constraint deliveries_user_id_lead_id_key unique (user_id, lead_id)
);

comment on table  public.deliveries                is 'Junction of delivered leads per user; one delivery per (user, lead) pair.';
comment on column public.deliveries.user_id        is 'Recipient profile; cascades when the profile is deleted.';
comment on column public.deliveries.lead_id        is 'Delivered lead; cascades when the lead is deleted.';
comment on column public.deliveries.delivered_at   is 'Timestamp of the delivery.';

-- -----------------------------------------------------------------------------
-- Helper: is_admin()
-- SECURITY DEFINER so RLS policies evaluate against the table owner and do not
-- recurse back into profiles (which would error: "infinite recursion detected").
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

comment on function public.is_admin() is 'True when the calling user has role "admin"; security definer to avoid RLS recursion.';

-- -----------------------------------------------------------------------------
-- 4. Trigger: auto-create a profiles row on signup
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is 'Inserts a matching profiles row (id, email) whenever auth.users gains a new row.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

comment on trigger on_auth_user_created on auth.users
  is 'Fires handle_new_user() after every new auth.users insert to seed a profile.';

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.leads      enable row level security;
alter table public.deliveries enable row level security;

-- --- profiles ---
-- A user can read only their own row.
create policy "profiles_select_own"
  on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- An admin can read every profile row.
create policy "profiles_select_admin"
  on public.profiles
  for select to authenticated
  using (public.is_admin());

comment on policy "profiles_select_own"   on public.profiles is 'Users can select only their own profile.';
comment on policy "profiles_select_admin" on public.profiles is 'Admins can select all profiles via is_admin().';

-- --- leads ---
-- Intentionally NO policies: with RLS enabled, regular users see nothing.

-- --- deliveries ---
-- A user can read only their own deliveries.
create policy "deliveries_select_own"
  on public.deliveries
  for select to authenticated
  using (user_id = auth.uid());

comment on policy "deliveries_select_own" on public.deliveries is 'Users can select only their own deliveries.';
