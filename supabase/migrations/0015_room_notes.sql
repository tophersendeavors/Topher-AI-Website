-- =============================================================================
-- TOBURT Studios — Room Notes & Annotations (Writers Room Phase B)
-- Studio-wide production-note system (not chat). A note targets the room, a
-- script, a scene, a line, a beat, a character, or an episode; carries an
-- author, optional assignee, visibility, and a resolvable status. The `room`
-- column makes this reusable in the Creative/Production/Screening rooms later.
-- =============================================================================

create table if not exists public.room_notes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  room              text not null default 'writers',
  author_id         uuid references public.profiles(id),
  assignee_id       uuid references public.profiles(id),
  body              text not null,
  -- target
  target_type       text not null default 'room',
    -- room | script | scene | line | beat | character | episode
  target_ref        text,        -- id / locator of the target (script id, scene ord, line #, character id, episode id)
  target_label      text,        -- human-readable label for display
  -- collaboration
  visibility        text not null default 'room',
    -- private | selected | room | project
  selected_user_ids uuid[] not null default '{}'::uuid[],
  status            text not null default 'open',
    -- open | in_review | accepted | rejected | applied | resolved
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz
);

create index if not exists room_notes_proj_room_idx on public.room_notes(project_id, room);
create index if not exists room_notes_target_idx     on public.room_notes(project_id, target_type, target_ref);
create index if not exists room_notes_status_idx      on public.room_notes(project_id, status);
create index if not exists room_notes_assignee_idx    on public.room_notes(assignee_id);

alter table public.room_notes enable row level security;

drop policy if exists room_notes_select on public.room_notes;
drop policy if exists room_notes_insert on public.room_notes;
drop policy if exists room_notes_update on public.room_notes;
drop policy if exists room_notes_delete on public.room_notes;

-- Any project member can read project/room-visible notes, plus their own
-- private/selected notes. (Visibility is also enforced in the API layer.)
create policy room_notes_select on public.room_notes
  for select using (
    exists (select 1 from public.project_members pm
            where pm.project_id = room_notes.project_id and pm.user_id = auth.uid())
    and (
      visibility in ('room', 'project')
      or author_id = auth.uid()
      or assignee_id = auth.uid()
      or auth.uid() = any (selected_user_ids)
    )
  );

create policy room_notes_insert on public.room_notes
  for insert with check (
    exists (select 1 from public.project_members pm
            where pm.project_id = room_notes.project_id and pm.user_id = auth.uid())
  );

create policy room_notes_update on public.room_notes
  for update using (
    exists (select 1 from public.project_members pm
            where pm.project_id = room_notes.project_id and pm.user_id = auth.uid())
  );

create policy room_notes_delete on public.room_notes
  for delete using (
    author_id = auth.uid()
    or exists (select 1 from public.project_members pm
               where pm.project_id = room_notes.project_id and pm.user_id = auth.uid()
                 and pm.role in ('owner', 'producer'))
  );

-- keep updated_at fresh + stamp resolved_at when a note resolves
create or replace function public.touch_room_notes() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  if new.status = 'resolved' and (old.status is distinct from 'resolved') then
    new.resolved_at = now();
  elsif new.status <> 'resolved' then
    new.resolved_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists room_notes_touch on public.room_notes;
create trigger room_notes_touch
  before update on public.room_notes
  for each row execute procedure public.touch_room_notes();
