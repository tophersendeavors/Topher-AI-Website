-- =============================================================================
-- Memory search RPC — hybrid (similarity × approval × recency) ranking.
-- =============================================================================

create or replace function memory_search(
  p_project_id     uuid,
  p_query_vec      vector,
  p_scope          memory_scope[] default null,
  p_scope_ref      uuid           default null,
  p_kind           memory_kind[]  default null,
  p_approved_only  boolean        default false,
  p_k              int            default 12
)
returns table (
  id            uuid,
  project_id    uuid,
  scope         memory_scope,
  scope_ref     uuid,
  kind          memory_kind,
  body          jsonb,
  text          text,
  approved      boolean,
  version       int,
  supersedes_id uuid,
  authored_by   uuid,
  authored_role text,
  created_at    timestamptz,
  similarity    double precision
)
language sql stable as $$
  select
    m.id, m.project_id, m.scope, m.scope_ref, m.kind, m.body, m.text,
    m.approved, m.version, m.supersedes_id, m.authored_by, m.authored_role,
    m.created_at,
    (1 - (m.embedding <=> p_query_vec))
      * (case when m.approved then 1.25 else 1.0 end)
      * exp(-extract(epoch from now() - m.created_at) / 2592000.0) as similarity
  from memory_entries m
  where m.project_id = p_project_id
    and m.supersedes_id is null
    and (p_scope is null or m.scope = any(p_scope))
    and (p_scope_ref is null or m.scope_ref = p_scope_ref)
    and (p_kind  is null or m.kind  = any(p_kind))
    and (p_approved_only = false or m.approved = true)
    and m.embedding is not null
  order by similarity desc
  limit p_k;
$$;
