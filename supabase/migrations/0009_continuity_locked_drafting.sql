-- =============================================================================
-- 0009_continuity_locked_drafting — locked cast bible + scene manifest
-- =============================================================================
-- Foundation for the continuity-locked drafting pipeline: the cast bible and
-- scene manifest become binding contracts the draft cannot violate.
-- =============================================================================

-- --- Cast bible: lock full identity, not just names -------------------------
alter table characters
  add column if not exists age          int,
  add column if not exists occupation   text,
  add column if not exists relationships jsonb not null default '[]'::jsonb,
  add column if not exists backstory    text,
  add column if not exists locked       boolean not null default false,
  add column if not exists locked_at    timestamptz;

-- --- Scene manifest: the pre-draft contract per scene -----------------------
-- Extends script_scenes with the manifest fields the draft must honor and the
-- canonical bookkeeping the sequential pipeline writes after each approved scene.
alter table script_scenes
  add column if not exists story_purpose     text,
  add column if not exists timeline_position int,          -- ordering within story time
  add column if not exists protocol_stage    text,         -- project-specific stage marker
  add column if not exists continuity_in     jsonb not null default '[]'::jsonb,  -- facts carried IN
  add column if not exists continuity_out    jsonb not null default '[]'::jsonb,  -- facts created BY scene
  add column if not exists canonical         boolean not null default false,      -- approved as canon
  add column if not exists canonical_summary text,         -- the summary future scenes may reference
  add column if not exists last_check        jsonb;        -- last per-scene continuity check result

create index if not exists idx_script_scenes_canonical
  on script_scenes(script_id, canonical);
