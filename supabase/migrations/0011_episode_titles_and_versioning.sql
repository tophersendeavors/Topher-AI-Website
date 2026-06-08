-- =============================================================================
-- 0011_episode_titles_and_versioning — disentangle Episode Title, Episode
-- Number, and Draft/Version Label so the dashboard, exports, and file names
-- can talk about them as three independent concepts.
-- =============================================================================
-- Episodes get:
--   • title_status      — 'untitled' | 'suggested' | 'approved'
--   • title_suggestion  — {suggested, reason, alternates[], suggested_at}
--   • metadata          — generic jsonb for future per-episode settings
-- Scripts already have a `metadata` jsonb (0001) and `draft_number` int,
-- so version_label / version_type / approved_for_export / title_page all
-- live under scripts.metadata without a column-level migration. Querying
-- by version_label is rare; if that ever changes we can promote later.
-- =============================================================================

alter table episodes
  add column if not exists title_status text not null default 'untitled'
    check (title_status in ('untitled', 'suggested', 'approved'));

alter table episodes
  add column if not exists title_suggestion jsonb;

alter table episodes
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Existing episodes that already carry a title default to 'approved' so the
-- dashboard doesn't suddenly demote previously-named episodes to Untitled.
update episodes
   set title_status = 'approved'
 where title is not null
   and length(trim(title)) > 0
   and title_status = 'untitled';

-- Backfill: any pre-existing scripts with episode_id set that were inserted
-- before per-episode draft_number scoping should be renumbered. We pick the
-- earliest insert per episode as Draft 1 and resequence from there.
-- This is idempotent because draft_number is only ever rewritten downward.
with ranked as (
  select id,
         episode_id,
         project_id,
         row_number() over (
           partition by project_id, episode_id
           order by created_at asc
         ) as new_num
    from scripts
   where episode_id is not null
)
update scripts s
   set draft_number = r.new_num
  from ranked r
 where s.id = r.id
   and s.draft_number <> r.new_num;
