-- =============================================================================
-- TOBURT Studios — Character Arc tracking
-- =============================================================================
-- Stores each character's emotional ARC (starting state → current state) as
-- labelled by the Character Arc agent. This is the named-state layer behind
-- Character Arc Health in the Emotional Intelligence panel.
--
-- script_id is NULLABLE on purpose: a row scoped to a script is an EPISODE arc;
-- a row with script_id = null is reserved for future SEASON-level aggregation.
-- Append-only via `supersedes_id` + a single `current` row per
-- (project, character, script), mirroring the character_wounds pattern.
-- -----------------------------------------------------------------------------

create table character_arcs (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  character_id   uuid not null references characters(id) on delete cascade,
  script_id      uuid references scripts(id) on delete cascade,
  starting_state text not null,
  current_state  text not null,
  arc_trend      text,
  arc_strength   text,
  evidence       jsonb not null default '[]'::jsonb,
  version        int not null default 1,
  supersedes_id  uuid references character_arcs(id),
  authored_by    uuid references profiles(id),
  authored_role  text,
  current        boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index on character_arcs(project_id);
create index on character_arcs(character_id);
create index on character_arcs(script_id);
create index on character_arcs(supersedes_id);

-- One current arc per (character, script). Treats script-scoped rows; the
-- null-script (season) slot is enforced separately by the partial index below.
create unique index character_arcs_current_idx
  on character_arcs(character_id, script_id)
  where current and script_id is not null;
create unique index character_arcs_current_season_idx
  on character_arcs(character_id)
  where current and script_id is null;

-- updated_at touch trigger (reuses the shared procedure from 0005).
drop trigger if exists trg_touch_character_arcs on character_arcs;
create trigger trg_touch_character_arcs before update on character_arcs
  for each row execute procedure touch_updated_at();

-- RLS — same project-member rule as everything else.
alter table character_arcs enable row level security;
drop policy if exists character_arcs_member_all on character_arcs;
create policy character_arcs_member_all on character_arcs
  for all using (is_project_member(project_id))
  with check (is_project_member(project_id));
