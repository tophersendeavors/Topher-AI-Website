-- =============================================================================
-- 0012_projects_metadata — give `projects` a generic metadata jsonb so the
-- app can stash editable per-project config (AI model profile overrides,
-- production rules, etc.) without adding a new column for each one.
-- =============================================================================
-- This unlocks:
--   • project.metadata.modelProfileOverrides — per-project model profile edits
--   • project.metadata.productionRules       — prefer / avoid lists for the
--                                              AI Video router + adapters
--   • future per-project config without further migrations
-- =============================================================================

alter table projects
  add column if not exists metadata jsonb not null default '{}'::jsonb;
