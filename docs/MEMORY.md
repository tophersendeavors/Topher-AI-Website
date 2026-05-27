# Memory

A single, unified, embedded, versioned memory store powers every agent. All
canon, drafts, beats, voice fingerprints, world rules and continuity facts
land in the same table — `memory_entries` — with strict typing on `scope` and
`kind`.

---

## Schema

```sql
create table memory_entries (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  scope           text not null check (scope in (
                    'project','season','episode','scene',
                    'character','location','relationship')),
  scope_ref       uuid,        -- season/episode/scene/character/location id
  kind            text not null check (kind in (
                    'fact','rule','arc','voice','wardrobe',
                    'beat','note','draft')),
  body            jsonb not null,
  text            text not null,        -- searchable surface form
  embedding       vector(3072),         -- pgvector
  approved        boolean not null default false,
  version         int not null default 1,
  supersedes_id   uuid references memory_entries(id),
  authored_by     uuid references profiles(id),
  authored_role   text,                 -- agent role or 'user'
  created_at      timestamptz not null default now()
);

create index on memory_entries using ivfflat (embedding vector_cosine_ops);
create index on memory_entries (project_id, scope, scope_ref);
create index on memory_entries (project_id, kind);
create index on memory_entries (supersedes_id);
```

---

## Lifecycle

1. **Draft write** — any agent or human can write a row with `approved=false`.
   It is embedded immediately so retrieval can surface it.
2. **Approval** — the Showrunner agent or an authorized human flips
   `approved=true`. Approved rows are weighted higher at retrieval time and
   are the only rows used by the Continuity agent.
3. **Edit** — never mutate; insert a new row with `supersedes_id` pointing at
   the predecessor and `version = predecessor.version + 1`. Queries default to
   `where supersedes_id is null` (latest only).
4. **Rollback** — set the newest version's `supersedes_id` chain to a prior
   row by deleting the intermediate row(s) or inserting an explicit rollback
   row.

---

## Retrieval

`memory.search(query, opts)`:

```ts
{
  projectId: string;
  scope?: Scope | Scope[];
  scopeRef?: string;
  kind?: Kind | Kind[];
  approvedOnly?: boolean;
  k?: number;          // default 12
}
```

Implementation:

```sql
select id, scope, kind, body, text,
       (1 - (embedding <=> $query_vec)) as similarity,
       approved, created_at
from memory_entries
where project_id = $pid
  and ($scope is null or scope = any($scope))
  and ($scope_ref is null or scope_ref = $scope_ref)
  and ($kind is null or kind = any($kind))
  and ($approved_only is false or approved = true)
  and supersedes_id is null
order by
  -- hybrid rank: similarity × approval × recency decay
  (1 - (embedding <=> $query_vec))
    * (case when approved then 1.25 else 1.0 end)
    * exp(-extract(epoch from now() - created_at) / 2592000) -- 30d half-life
  desc
limit $k;
```

---

## Specialized projections

For hot reads, denormalized projections are maintained:

- `character_voice_fingerprints` — latest approved `kind='voice'` row per
  character, with the raw 1024-dim style vector for cheap voice scoring.
- `world_timeline` — materialized view over approved `kind='fact'` rows with
  `scope='project'` and a parseable `when` field.
- `continuity_snapshots` — per scene, the set of wardrobe / location / prop
  facts active at that point in the story chronology.

These are refreshed by the orchestrator after each stage commit.

---

## Provider abstraction

`backend/src/memory/embeddings.ts` exposes a single `embed(texts: string[])`
that selects a provider (OpenAI `text-embedding-3-large` by default,
Voyage / Cohere pluggable). The dimension is configurable via env so the
schema can be regenerated for smaller, cheaper models if needed.
