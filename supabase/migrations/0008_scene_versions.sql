-- =============================================================================
-- 0008_scene_versions — per-scene version history for safe regeneration
-- =============================================================================
-- Each Generate / Regenerate on a scene snapshots the prior `fountain` into
-- this table BEFORE overwrite. Lets the UI offer Restore + A/B compare.
-- =============================================================================

create table if not exists script_scene_versions (
  id            uuid primary key default gen_random_uuid(),
  scene_id      uuid not null references script_scenes(id) on delete cascade,
  fountain      text not null,
  last_pass     text,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_scene_versions_scene on script_scene_versions(scene_id, created_at desc);

-- RLS: inherit access via script_scenes -> scripts -> project_members.
alter table script_scene_versions enable row level security;

drop policy if exists scene_versions_select on script_scene_versions;
create policy scene_versions_select on script_scene_versions
  for select using (
    exists (
      select 1 from script_scenes ss
        join scripts s on s.id = ss.script_id
        join project_members pm on pm.project_id = s.project_id
      where ss.id = script_scene_versions.scene_id and pm.user_id = auth.uid()
    )
  );
