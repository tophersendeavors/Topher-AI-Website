-- =============================================================================
-- 0007_scene_status — per-scene drafting state for the Episode Drafting Workspace
-- =============================================================================
-- Adds a status column to script_scenes so the UI can render per-scene
-- generation/lock state, support per-scene regeneration, and gate range runs.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'scene_draft_status') then
    create type scene_draft_status as enum (
      'pending',
      'generating',
      'generated',
      'revised',
      'locked'
    );
  end if;
end$$;

alter table script_scenes
  add column if not exists status        scene_draft_status not null default 'pending',
  add column if not exists generated_at  timestamptz,
  add column if not exists locked_at     timestamptz,
  add column if not exists last_pass     text,           -- "scene"|"dialogue"|"behavior"|"subtext"
  add column if not exists notes         text;

create index if not exists idx_script_scenes_status on script_scenes(script_id, status);
