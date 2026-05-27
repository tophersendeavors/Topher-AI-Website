-- =============================================================================
-- TOBURT Studios — initial schema
-- =============================================================================
-- Multi-agent screenplay development platform.
-- Postgres 15+, Supabase, pgvector.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type project_kind   as enum ('feature','pilot','miniseries','short','series');
create type project_status as enum ('ideation','development','draft','production','archived');

create type agent_role as enum (
  'showrunner','concept','character','world','plot',
  'scene','dialogue','script_doctor','continuity','producer'
);

create type workflow_stage_id as enum (
  'idea','logline','synopsis','treatment','season_arc',
  'episode_outline','beat_sheet','scene_list',
  'draft_v1','rewrite','continuity_pass','production_draft','exports'
);

create type workflow_stage_status as enum ('pending','running','awaiting_approval','approved','rejected','completed','skipped','rolled_back');

create type approval_status as enum ('pending','approved','rejected','revised');

create type memory_scope as enum (
  'project','season','episode','scene',
  'character','location','relationship'
);

create type memory_kind as enum (
  'fact','rule','arc','voice','wardrobe','beat','note','draft'
);

create type continuity_kind     as enum ('wardrobe','location','timeline','relationship','prop');
create type continuity_severity as enum ('info','warn','critical');

-- -----------------------------------------------------------------------------
-- Profiles (mirror of auth.users)
-- -----------------------------------------------------------------------------

create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------

create table projects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id) on delete cascade,
  title         text not null,
  kind          project_kind not null default 'feature',
  status        project_status not null default 'ideation',
  logline       text,
  genre         text[],
  tone          text[],
  -- `references` is a reserved keyword in Postgres, so we use `inspirations`.
  inspirations  text[],
  showrunner_notes text,
  cover_url     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on projects(owner_id);
create index on projects(status);

create table project_members (
  project_id    uuid not null references projects(id) on delete cascade,
  user_id       uuid not null references profiles(id) on delete cascade,
  role          text not null default 'collaborator', -- owner | editor | collaborator | viewer
  created_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index on project_members(user_id);

-- Convenience: owner is always a member
create or replace function add_owner_as_member() returns trigger language plpgsql as $$
begin
  insert into project_members(project_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger trg_project_owner_member
  after insert on projects
  for each row execute procedure add_owner_as_member();

-- -----------------------------------------------------------------------------
-- Seasons / Episodes
-- -----------------------------------------------------------------------------

create table seasons (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  number        int  not null,
  title         text,
  premise       text,
  arc           jsonb,                  -- SeasonArc artifact
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, number)
);

create table episodes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  season_id     uuid references seasons(id) on delete cascade,
  number        int  not null,
  title         text,
  logline       text,
  outline       jsonb,                  -- EpisodeOutline artifact
  beat_sheet    jsonb,                  -- BeatSheet artifact
  status        project_status not null default 'ideation',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, season_id, number)
);
create index on episodes(project_id);

-- -----------------------------------------------------------------------------
-- Characters / Relationships / Locations
-- -----------------------------------------------------------------------------

create table characters (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null,
  archetype     text,
  role          text,                   -- protagonist | antagonist | supporting | …
  biography     text,
  wants         text,
  needs         text,
  flaw          text,
  voice_notes   text,
  arc           jsonb,                  -- { act1, act2, act3 }
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on characters(project_id);

create table character_voice_fingerprints (
  id            uuid primary key default gen_random_uuid(),
  character_id  uuid not null references characters(id) on delete cascade,
  -- 1024-dim style vector (cheaper than full embedding model dims)
  fingerprint   vector(1024),
  sample_count  int  not null default 0,
  updated_at    timestamptz not null default now()
);
create index on character_voice_fingerprints(character_id);

create table relationships (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  a_id          uuid not null references characters(id) on delete cascade,
  b_id          uuid not null references characters(id) on delete cascade,
  nature        text,         -- ally | enemy | romantic | family | …
  tension       text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (project_id, a_id, b_id)
);

create table locations (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  name          text not null,
  kind          text,         -- INT | EXT | hybrid
  description   text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on locations(project_id);

create table wardrobe_items (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  character_id  uuid references characters(id) on delete cascade,
  name          text not null,
  description   text,
  active_from   text,         -- chronological key (e.g. "S01E02:scene_12")
  active_to     text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index on wardrobe_items(project_id);
create index on wardrobe_items(character_id);

-- -----------------------------------------------------------------------------
-- Scripts (Fountain source) + derived scene index
-- -----------------------------------------------------------------------------

create table scripts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  episode_id    uuid references episodes(id) on delete set null,
  title         text not null,
  draft_number  int  not null default 1,
  fountain      text not null default '',
  metadata      jsonb not null default '{}'::jsonb,
  current       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on scripts(project_id);
create index on scripts(episode_id);

create table script_scenes (
  id            uuid primary key default gen_random_uuid(),
  script_id     uuid not null references scripts(id) on delete cascade,
  ord           int  not null,
  slugline      text not null,
  location_id   uuid references locations(id) on delete set null,
  int_ext       text,         -- INT | EXT
  time_of_day   text,         -- DAY | NIGHT | …
  characters    uuid[] not null default '{}',
  summary       text,
  fountain      text,         -- the slice of the script for this scene
  tags          text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index on script_scenes(script_id);
create index on script_scenes(script_id, ord);

-- -----------------------------------------------------------------------------
-- Unified memory store (canon + drafts) with embeddings
-- -----------------------------------------------------------------------------

create table memory_entries (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  scope           memory_scope not null,
  scope_ref       uuid,
  kind            memory_kind not null,
  body            jsonb not null,
  text            text not null,
  embedding       vector(3072),
  approved        boolean not null default false,
  version         int not null default 1,
  supersedes_id   uuid references memory_entries(id),
  authored_by     uuid references profiles(id),
  authored_role   text,
  created_at      timestamptz not null default now()
);
create index on memory_entries(project_id, scope, scope_ref);
create index on memory_entries(project_id, kind);
create index on memory_entries(supersedes_id);
-- Cosine-similarity index. For 3072 dims an HNSW index may exceed pgvector's
-- per-element budget on some Supabase tiers; ivfflat works at any dim.
create index on memory_entries using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- -----------------------------------------------------------------------------
-- Workflows & stages
-- -----------------------------------------------------------------------------

create table workflows (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  episode_id      uuid references episodes(id) on delete set null,
  title           text not null,
  current_stage   workflow_stage_id not null default 'idea',
  status          workflow_stage_status not null default 'pending',
  state           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on workflows(project_id);

create table workflow_stages (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  stage_id        workflow_stage_id not null,
  status          workflow_stage_status not null default 'pending',
  started_at      timestamptz,
  completed_at    timestamptz,
  artifact_id     uuid,                 -- references workflow_stage_artifacts.id
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index on workflow_stages(workflow_id, stage_id);

create table workflow_stage_artifacts (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  stage_id        workflow_stage_id not null,
  revision        int  not null default 1,
  body            jsonb not null,       -- typed artifact (Treatment, SeasonArc, …)
  storage_path    text,                 -- optional pointer to a large blob
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
create index on workflow_stage_artifacts(workflow_id, stage_id, revision desc);

create table workflow_checkpoints (
  id              uuid primary key default gen_random_uuid(),
  workflow_id     uuid not null references workflows(id) on delete cascade,
  stage_id        workflow_stage_id not null,
  state           jsonb not null,
  artifact_id     uuid references workflow_stage_artifacts(id),
  created_at      timestamptz not null default now()
);

create table approvals (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  workflow_id     uuid references workflows(id) on delete cascade,
  stage_id        workflow_stage_id,
  target_kind     text not null,        -- 'artifact' | 'canon_change' | 'tool_call'
  target_id       uuid,
  payload         jsonb not null,
  status          approval_status not null default 'pending',
  requested_by    text,                 -- agent role or 'system'
  decided_by      uuid references profiles(id),
  decided_at      timestamptz,
  rationale       text,
  created_at      timestamptz not null default now()
);
create index on approvals(project_id, status);

-- -----------------------------------------------------------------------------
-- Writers Room timeline
-- -----------------------------------------------------------------------------

create table room_messages (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  workflow_id     uuid references workflows(id) on delete set null,
  stage_id        workflow_stage_id,
  author_kind     text not null,         -- 'agent' | 'user' | 'system'
  author_role     text,                  -- agent_role or null
  author_user_id  uuid references profiles(id),
  kind            text not null default 'message', -- message | suggestion | critique | approval | tool_call
  body            text,
  payload         jsonb,
  parent_id       uuid references room_messages(id),
  created_at      timestamptz not null default now()
);
create index on room_messages(project_id, created_at);
create index on room_messages(workflow_id);

-- -----------------------------------------------------------------------------
-- Continuity & production
-- -----------------------------------------------------------------------------

create table continuity_issues (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  script_id       uuid references scripts(id) on delete cascade,
  episode_id      uuid references episodes(id) on delete set null,
  kind            continuity_kind not null,
  severity        continuity_severity not null default 'warn',
  scene_ids       uuid[] not null default '{}',
  note            text not null,
  suggested_fix   text,
  resolved        boolean not null default false,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index on continuity_issues(project_id, resolved);

create table production_assets (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  script_id       uuid references scripts(id) on delete cascade,
  scene_id        uuid references script_scenes(id) on delete set null,
  kind            text not null,         -- shotlist | storyboard_prompt | flow_prompt | design_note
  body            jsonb not null,
  storage_path    text,
  created_at      timestamptz not null default now()
);
create index on production_assets(project_id, kind);

-- Generic version pointer (drafts, treatments, etc).
create table revisions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  target_table    text not null,
  target_id       uuid not null,
  revision        int  not null,
  snapshot        jsonb not null,
  created_by      uuid references profiles(id),
  created_at      timestamptz not null default now()
);
create index on revisions(target_table, target_id, revision desc);

-- -----------------------------------------------------------------------------
-- updated_at helpers
-- -----------------------------------------------------------------------------

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'profiles','projects','seasons','episodes','characters',
      'scripts','workflows'
    ])
  loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on %1$s
       for each row execute procedure touch_updated_at();', t);
  end loop;
end$$;
