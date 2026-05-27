-- =============================================================================
-- TOBURT Studios — Emotional Intelligence Layer
-- =============================================================================
-- Adds the persistent state owned by the five EI agents:
--   * character_wounds            (Character Wound agent)
--   * relationship_tensions       (Relationship Tension agent)
--   * scene_emotional_states      (Emotional Truth + Subtext + Behavior agents)
-- Plus directness-validator violations and a project-level toggle for
-- intentionally stylistic direct emotional dialogue.

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

create type wound_kind as enum (
  'abandonment','betrayal','shame','loss','failure',
  'rejection','injustice','powerlessness','engulfment','custom'
);

create type behavior_kind as enum (
  'physical_action','avoidance','contradiction','silence',
  'micro_tell','deflection','displacement','ritual'
);

-- The continuity severity enum is reused for emotional severities. We
-- explicitly *add* two new continuity_kind values so the existing UI can
-- surface emotional flags without a separate channel.
alter type continuity_kind add value if not exists 'emotional_directness';
alter type continuity_kind add value if not exists 'emotional_truth';

-- -----------------------------------------------------------------------------
-- Project toggle — when true, the validator does not reject scenes for direct
-- emotional dialogue (intended for stylistic projects: theatre, fable, etc).
-- -----------------------------------------------------------------------------
alter table projects
  add column if not exists allow_stylistic_directness boolean not null default false;

-- -----------------------------------------------------------------------------
-- character_wounds — one row per (character, version). Append-only via
-- `supersedes_id`, mirroring the memory_entries pattern.
-- -----------------------------------------------------------------------------
create table character_wounds (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  character_id   uuid not null references characters(id) on delete cascade,
  kind           wound_kind not null default 'custom',
  wound          text not null,
  fear           text not null,
  unmet_need     text not null,
  shame_trigger  text not null,
  defenses       text[] not null default '{}',
  behavioral_signatures text[] not null default '{}',
  approved       boolean not null default false,
  version        int not null default 1,
  supersedes_id  uuid references character_wounds(id),
  authored_by    uuid references profiles(id),
  authored_role  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on character_wounds(project_id);
create index on character_wounds(character_id);
create index on character_wounds(supersedes_id);

-- -----------------------------------------------------------------------------
-- relationship_tensions — one row per (relationship, version).
-- -----------------------------------------------------------------------------
create table relationship_tensions (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  relationship_id uuid references relationships(id) on delete cascade,
  a_id            uuid references characters(id) on delete cascade,
  b_id            uuid references characters(id) on delete cascade,
  unsaid          text not null,
  history         text,
  current_power   text,
  tension_score   real not null default 0.5,
  pressure_points text[] not null default '{}',
  approved        boolean not null default false,
  version         int not null default 1,
  supersedes_id   uuid references relationship_tensions(id),
  authored_by     uuid references profiles(id),
  authored_role   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on relationship_tensions(project_id);
create index on relationship_tensions(relationship_id);
create index on relationship_tensions(a_id, b_id);

-- -----------------------------------------------------------------------------
-- scene_emotional_states — the canonical EI artifact per scene. The ten
-- required fields are all first-class columns so the UI and validators can
-- query them without unpacking JSON.
-- -----------------------------------------------------------------------------
create table scene_emotional_states (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references projects(id) on delete cascade,
  script_id               uuid not null references scripts(id) on delete cascade,
  scene_id                uuid references script_scenes(id) on delete cascade,

  -- ----- The ten required fields -----
  emotional_entry_state   text not null,
  emotional_exit_state    text not null,
  hidden_want             text not null,
  visible_want            text not null,
  fear                    text not null,
  contradiction           text not null,
  subtext                 text not null,
  behavioral_tells        text[] not null default '{}',
  power_shift             text not null,
  relationship_shift      text not null,

  -- ----- Auxiliary -----
  truth_score             real,
  directness_violations   jsonb not null default '[]'::jsonb,
  rejected                boolean not null default false,
  rejection_reason        text,
  authored_by             uuid references profiles(id),
  authored_role           text,
  version                 int not null default 1,
  supersedes_id           uuid references scene_emotional_states(id),
  -- `current = true` exactly once per scene. New revisions flip the old
  -- row to false and insert a new row with current=true. This is faster
  -- than walking the supersedes chain at query time.
  current                 boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index on scene_emotional_states(project_id);
create index on scene_emotional_states(script_id);
create index on scene_emotional_states(scene_id);
create index on scene_emotional_states(supersedes_id);
create unique index scene_emotional_states_current_idx
  on scene_emotional_states(scene_id)
  where current = true and scene_id is not null;

-- -----------------------------------------------------------------------------
-- Touch triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'character_wounds','relationship_tensions','scene_emotional_states'
    ])
  loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$s;', t);
    execute format(
      'create trigger trg_touch_%1$s before update on %1$s
       for each row execute procedure touch_updated_at();', t);
  end loop;
end$$;

-- -----------------------------------------------------------------------------
-- RLS — same project-member rule as everything else.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'character_wounds','relationship_tensions','scene_emotional_states'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$
      drop policy if exists %1$s_member_all on %1$s;
      create policy %1$s_member_all on %1$s
        for all using (is_project_member(project_id))
        with check (is_project_member(project_id));
    $f$, t);
  end loop;
end$$;
