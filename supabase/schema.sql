-- ASH KROW · Supabase schema
-- Run this in the Supabase SQL editor (or `supabase db push` via the CLI).
-- Two tables: `designs` (one row per generated concept) and `brand_settings`
-- (one row, `id = 'default'`). All non-key columns are mirrored inside the
-- `payload` jsonb blob so the frontend never has to migrate when the Design
-- shape changes.

create extension if not exists "pgcrypto";

create table if not exists public.designs (
  id text primary key,
  created_at timestamptz not null default now(),
  generated_for date not null default current_date,
  title text not null,
  garment_type text not null,
  stage text not null default 'concept',
  status text not null default 'draft',
  approved boolean not null default false,
  ready_for_ninja_transfers boolean not null default false,
  payload jsonb not null
);

create index if not exists designs_generated_for_idx
  on public.designs (generated_for desc);
create index if not exists designs_status_idx
  on public.designs (status);

create table if not exists public.brand_settings (
  id text primary key,
  updated_at timestamptz not null default now(),
  payload jsonb not null
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- These tables hold internal brand IP. By default we lock them down so only
-- the service role (server-side jobs, e.g. the daily cron) can write, and
-- only signed-in authenticated users can read. Adjust to taste.

alter table public.designs enable row level security;
alter table public.brand_settings enable row level security;

drop policy if exists "designs read" on public.designs;
create policy "designs read"
  on public.designs for select
  to authenticated
  using (true);

drop policy if exists "designs write" on public.designs;
create policy "designs write"
  on public.designs for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "brand read" on public.brand_settings;
create policy "brand read"
  on public.brand_settings for select
  to authenticated
  using (true);

drop policy if exists "brand write" on public.brand_settings;
create policy "brand write"
  on public.brand_settings for all
  to authenticated
  using (true)
  with check (true);
