-- =============================================================================
-- Enable Supabase Realtime for the Writers Room channels.
-- =============================================================================
-- Adds `room_messages` and `approvals` to the `supabase_realtime` publication
-- so the frontend can subscribe to live INSERTs without polling.
--
-- Safe to re-run: `add table if not exists` isn't supported by Postgres for
-- publications, so we guard with a DO block.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'room_messages'
  ) then
    execute 'alter publication supabase_realtime add table room_messages';
  end if;
end$$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'approvals'
  ) then
    execute 'alter publication supabase_realtime add table approvals';
  end if;
end$$;

-- Optional: stream scene EI state changes too — the editor surfaces them.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'scene_emotional_states'
  ) then
    execute 'alter publication supabase_realtime add table scene_emotional_states';
  end if;
end$$;
