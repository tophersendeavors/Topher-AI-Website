-- =============================================================================
-- TOBURT Studios — Writer / Talent Directory (Phase 2)
-- Reusable people records owned by a studio (the account owner). A Writers Room
-- Live Co-Writer references one of these by id so the same person is reusable
-- across every project — no inline-only seat records.
-- =============================================================================

create table if not exists public.talent_profiles (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  -- optional link to a real auth user once an invited person signs up
  user_id         uuid references public.profiles(id),
  name            text not null,
  email           text,
  category        text not null default 'writer',
    -- writer | co_writer | human_reader | consultant | producer | director
  role            text,
  avatar_url      text,
  bio             text,
  credits         text[]  not null default '{}'::text[],
  specialties     text[]  not null default '{}'::text[],
  permission      text    not null default 'comment',
  invite_status   text    not null default 'draft',
    -- draft | invited | active
  project_history jsonb   not null default '[]'::jsonb,
  metadata        jsonb   not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists talent_owner_idx    on public.talent_profiles(owner_id);
create index if not exists talent_category_idx on public.talent_profiles(owner_id, category);
create index if not exists talent_user_idx      on public.talent_profiles(user_id);

alter table public.talent_profiles enable row level security;

drop policy if exists talent_select on public.talent_profiles;
drop policy if exists talent_insert on public.talent_profiles;
drop policy if exists talent_update on public.talent_profiles;
drop policy if exists talent_delete on public.talent_profiles;

-- Owner can see and manage their own roster. The invited person (once linked)
-- can read their own record.
create policy talent_select on public.talent_profiles
  for select using (owner_id = auth.uid() or user_id = auth.uid());

create policy talent_insert on public.talent_profiles
  for insert with check (owner_id = auth.uid());

create policy talent_update on public.talent_profiles
  for update using (owner_id = auth.uid());

create policy talent_delete on public.talent_profiles
  for delete using (owner_id = auth.uid());

-- keep updated_at fresh
create or replace function public.touch_talent_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists talent_touch on public.talent_profiles;
create trigger talent_touch
  before update on public.talent_profiles
  for each row execute procedure public.touch_talent_updated_at();
