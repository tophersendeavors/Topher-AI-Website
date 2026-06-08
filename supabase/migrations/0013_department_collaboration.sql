-- =============================================================================
-- TOBURT Studios — Department Collaboration (Stage 4 Phase A)
-- Corrected for existing schema:
-- real membership table = public.project_members
-- columns: project_id, user_id, role, created_at
-- =============================================================================

-- -----------------------------------------------------------------------------
-- department_contributions
-- -----------------------------------------------------------------------------
create table if not exists public.department_contributions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  department      text not null,
  contributor_id  uuid references public.profiles(id),
  kind            text not null,
  title           text,
  body            text,
  url             text,
  storage_path    text,
  thumbnail_url   text,
  color_hex       text,
  status          text not null default 'inspiration',
  tags            text[] not null default '{}'::text[],
  links           jsonb not null default '{}'::jsonb,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists dc_proj_dept_idx
  on public.department_contributions(project_id, department);

create index if not exists dc_proj_status_idx
  on public.department_contributions(project_id, status);

create index if not exists dc_contrib_idx
  on public.department_contributions(contributor_id);

create index if not exists dc_links_gin_idx
  on public.department_contributions using gin (links);

alter table public.department_contributions enable row level security;

drop policy if exists dc_select on public.department_contributions;
drop policy if exists dc_insert on public.department_contributions;
drop policy if exists dc_update on public.department_contributions;
drop policy if exists dc_delete on public.department_contributions;

create policy dc_select on public.department_contributions
  for select using (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_contributions.project_id
        and pm.user_id = auth.uid()
    )
  );

create policy dc_insert on public.department_contributions
  for insert with check (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_contributions.project_id
        and pm.user_id = auth.uid()
    )
  );

create policy dc_update on public.department_contributions
  for update using (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_contributions.project_id
        and pm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_contributions.project_id
        and pm.user_id = auth.uid()
    )
  );

create policy dc_delete on public.department_contributions
  for delete using (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_contributions.project_id
        and pm.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- department_activity
-- -----------------------------------------------------------------------------
create table if not exists public.department_activity (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  department    text not null,
  actor_id      uuid references public.profiles(id),
  action        text not null,
  target_type   text,
  target_id     text,
  diff          jsonb,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists da_proj_time_idx
  on public.department_activity(project_id, created_at desc);

create index if not exists da_proj_dept_idx
  on public.department_activity(project_id, department);

alter table public.department_activity enable row level security;

drop policy if exists da_select on public.department_activity;
drop policy if exists da_insert on public.department_activity;

create policy da_select on public.department_activity
  for select using (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_activity.project_id
        and pm.user_id = auth.uid()
    )
  );

create policy da_insert on public.department_activity
  for insert with check (
    exists (
      select 1
      from public.project_members pm
      where pm.project_id = department_activity.project_id
        and pm.user_id = auth.uid()
    )
  );
