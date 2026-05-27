-- =============================================================================
-- TOBURT Studios — row-level security
-- =============================================================================
-- All project-scoped tables gate access through `project_members`.
-- The backend uses the service role and re-checks membership itself.

-- Helper: does the current auth.uid() belong to project_id ?
create or replace function is_project_member(p_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from project_members
    where project_id = p_id and user_id = auth.uid()
  );
$$;

create or replace function is_project_owner(p_id uuid)
returns boolean language sql stable security definer as $$
  select exists(
    select 1 from projects
    where id = p_id and owner_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
alter table profiles enable row level security;

drop policy if exists profiles_self_read on profiles;
create policy profiles_self_read on profiles
  for select using (true);   -- any signed-in user can resolve display names

drop policy if exists profiles_self_write on profiles;
create policy profiles_self_write on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- -----------------------------------------------------------------------------
-- projects + project_members
-- -----------------------------------------------------------------------------
alter table projects enable row level security;
alter table project_members enable row level security;

drop policy if exists projects_read on projects;
create policy projects_read on projects
  for select using (is_project_member(id));

drop policy if exists projects_insert on projects;
create policy projects_insert on projects
  for insert with check (owner_id = auth.uid());

drop policy if exists projects_update on projects;
create policy projects_update on projects
  for update using (is_project_owner(id)) with check (is_project_owner(id));

drop policy if exists projects_delete on projects;
create policy projects_delete on projects
  for delete using (is_project_owner(id));

drop policy if exists project_members_read on project_members;
create policy project_members_read on project_members
  for select using (is_project_member(project_id));

drop policy if exists project_members_write on project_members;
create policy project_members_write on project_members
  for all using (is_project_owner(project_id)) with check (is_project_owner(project_id));

-- -----------------------------------------------------------------------------
-- Generic policy: any project-scoped table — SELECT/INSERT/UPDATE/DELETE
-- for project members.
--
-- The branch per table is in PL/pgSQL (not in SQL) because Postgres still
-- parses every branch of a SQL `CASE WHEN`, including ones that can't be
-- reached for a given table — and that fails when columns like
-- `character_voice_fingerprints.character_id` don't exist on the target.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select unnest(array[
      'seasons','episodes','characters','character_voice_fingerprints',
      'relationships','locations','wardrobe_items','scripts','script_scenes',
      'memory_entries','workflows','workflow_stages','workflow_stage_artifacts',
      'workflow_checkpoints','approvals','room_messages','continuity_issues',
      'production_assets','revisions'
    ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists %1$s_member_all on %1$s;', t);

    if t = 'character_voice_fingerprints' then
      execute format($f$
        create policy %1$s_member_all on %1$s
          for all
          using (is_project_member(
            (select project_id from characters c
             where c.id = character_voice_fingerprints.character_id)
          ))
          with check (is_project_member(
            (select project_id from characters c
             where c.id = character_voice_fingerprints.character_id)
          ));
      $f$, t);
    elsif t = 'script_scenes' then
      execute format($f$
        create policy %1$s_member_all on %1$s
          for all
          using (is_project_member(
            (select project_id from scripts s
             where s.id = script_scenes.script_id)
          ))
          with check (is_project_member(
            (select project_id from scripts s
             where s.id = script_scenes.script_id)
          ));
      $f$, t);
    else
      execute format($f$
        create policy %1$s_member_all on %1$s
          for all
          using (is_project_member(project_id))
          with check (is_project_member(project_id));
      $f$, t);
    end if;
  end loop;
end$$;
