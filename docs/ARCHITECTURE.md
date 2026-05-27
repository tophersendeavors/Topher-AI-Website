# TOBURT Studios — System Architecture

This document describes the full architecture of the platform: the agent
runtime, the memory system, the workflow pipeline, the database, and how the
frontend, backend and Supabase fit together.

---

## 1. High-level topology

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                              │
│                                                                            │
│  React + TypeScript + Vite + Tailwind (cinematic dark UI)                  │
│  ├── Dashboard / Projects                                                  │
│  ├── Writers Room (multi-agent chat surface, approvals, debates)           │
│  ├── Screenplay Editor (Monaco, FDX/Fountain compatible)                   │
│  ├── Character Bible · Story Bible · Episodes · Drafts · Rewrites          │
│  ├── Continuity · Production Tools · Export Center                         │
│  └── Realtime channel for agent events (Supabase Realtime)                 │
└────────────────┬───────────────────────────────────────────┬───────────────┘
                 │ HTTPS / JSON                              │ Realtime (WSS)
                 ▼                                           ▼
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│      BACKEND (Node + Fastify)   │         │       SUPABASE PLATFORM          │
│                                 │         │                                  │
│  REST API                       │         │  Postgres + pgvector             │
│  ├── /projects                  │◀────────┤    project / script / character  │
│  ├── /workflows                 │   SQL   │    memory / continuity / canon   │
│  ├── /agents                    │         │                                  │
│  ├── /memory                    │         │  Storage (drafts, exports, art)  │
│  ├── /scripts                   │         │  Auth (JWT)                      │
│  ├── /exports                   │         │  Realtime channels               │
│  └── /production                │         │                                  │
│                                 │         └──────────────────────────────────┘
│  AGENT RUNTIME                  │                       ▲
│  ├── Registry  (10 agents)      │                       │
│  ├── Orchestrator (graph)       │                       │
│  ├── Memory service             │ ─── embeddings ──────▶│
│  ├── Toolbelt (canon read/      │                       │
│  │   write, retrieval, voice)   │                       │
│  └── Export pipeline            │                       │
│                                 │                       │
│  LLM PROVIDERS                  │                       │
│  ├── Anthropic (default)        │                       │
│  ├── OpenAI (fallback / embed)  │                       │
└─────────────────────────────────┘
```

---

## 2. Agent runtime

### 2.1 Roles

| # | Agent | Responsibility |
|---|---|---|
| 1 | Showrunner | Vision, genre/tone, season arc, arbitration & approvals |
| 2 | Concept | Loglines, hooks, premise, thematic exploration |
| 3 | Character | Bibles, arcs, voice fingerprints, relationship graph |
| 4 | World / Canon | Lore, timeline, world rules, continuity facts |
| 5 | Plot | Acts, episodes, pacing, cliffhangers, tension |
| 6 | Scene | Scene construction, transitions, cinematic flow |
| 7 | Dialogue | Voice, subtext, emotional realism |
| 8 | Script Doctor | Pacing fixes, cliché detection, structural rewrites |
| 9 | Continuity | Wardrobe/location memory, timeline conflicts |
| 10 | Producer | Budget, feasibility, VFX warnings, AI-gen practicality |

Each agent is a small object — see `backend/src/agents/*.ts` — with:

- `role` (enum `AgentRole`)
- `systemPrompt(ctx)`  — context-aware prompt builder
- `inputSchema` / `outputSchema` (zod) — strict I/O contracts
- `tools[]` — only the tools they're allowed to call
- `model` — defaulted from env (`SHOWRUNNER_MODEL` etc.)

### 2.2 Communication model

Agents do **not** call each other directly. They communicate through:

1. **The orchestrator** — a LangGraph-style state graph. The orchestrator
   chooses the next agent based on the current workflow stage and message
   state, and routes the previous agent's structured output as the next
   agent's input.
2. **Shared memory** — anything an agent wants to be canonical must be written
   through the memory service (`memory.write*`). The Showrunner can elevate
   drafts to "approved canon" — only then is it embedded and exposed to other
   agents' retrieval calls.
3. **Writers Room messages** — every agent turn produces a `RoomMessage`
   persisted to Postgres and broadcast over Supabase Realtime so the human
   writers' room UI updates live.

### 2.3 Tools

Agents have a small toolbelt, defined in `backend/src/agents/toolbelt.ts`:

- `retrieveCanon(query, scope)` — semantic search over approved canon.
- `retrieveDrafts(query, scope)` — semantic search over working drafts.
- `proposeCanonChange(facts[])` — request Showrunner approval.
- `getCharacter(id)` / `getRelationship(a, b)` / `getTimeline(range)`.
- `tagSceneEntities(sceneId)` — extract characters/locations/objects.
- `voiceFingerprint(characterId, sample)` — score dialogue against canon voice.
- `requestApproval(target, payload, rationale)` — interrupt for human gate.

Tools are JSON-schema described and exposed to the LLM via provider-native tool
use.

### 2.4 Showrunner arbitration

The Showrunner is special:

- It has a **veto tool** (`vetoOutput`).
- It is invoked as a gate at the end of every major stage (treatment, season
  arc, episode outline, draft).
- If it vetoes, the orchestrator loops back to the originating agent with the
  veto rationale appended as `critique`.
- The user can override the Showrunner from the Writers Room UI at any time;
  human approval is final.

---

## 3. Workflow pipeline

The pipeline is a directed graph (`backend/src/orchestrator/graph.ts`):

```
   idea
    │
    ▼
 logline ──► synopsis ──► treatment ──► season_arc ──► episode_outline
                                                              │
                                                              ▼
                                                         beat_sheet
                                                              │
                                                              ▼
                                                         scene_list
                                                              │
                                                              ▼
                                                          draft_v1
                                                              │
                                                              ▼
                                                      ┌──── rewrite ◀────┐
                                                      │       │           │
                                                      │       ▼           │
                                                      │  continuity_pass  │
                                                      │       │           │
                                                      │       ▼           │
                                                      └── production_draft
                                                              │
                                                              ▼
                                                           exports
```

For each stage:

- **Inputs**: previous stage's output + retrieved canon.
- **Agents invoked**: a curated subset (e.g. `beat_sheet` runs Plot + Scene +
  Showrunner; `draft_v1` runs Scene + Dialogue + Character + Continuity +
  Showrunner).
- **Output**: a typed artifact (`Treatment`, `SeasonArc`, `BeatSheet`, …)
  saved as a `workflow_stage_artifact` row + Supabase Storage blob for the
  large body.
- **Checkpoint**: orchestrator state is checkpointed to `workflow_checkpoints`.
  Re-running a stage forks a new revision; previous revisions are preserved
  for rollback.
- **Approval gate**: stages flagged `requiresApproval: true` pause until the
  human or Showrunner approves.

---

## 4. Shared memory

See [`MEMORY.md`](./MEMORY.md) for the full model. Summary:

- All memory rows have `(project_id, scope, kind, body, embedding,
  approved, version, supersedes_id)`.
- `scope ∈ { project | season | episode | scene | character | location |
  relationship }`.
- `kind ∈ { fact | rule | arc | voice | wardrobe | beat | note | draft }`.
- Embedded with `text-embedding-3-large` (3072-dim) into a `vector(3072)`
  column with an `ivfflat` index.
- Retrieval is hybrid: `cosine(embedding, query) + scope filter + kind
  filter`, then re-ranked by recency × approval.

Memory is **append-only**. Edits write a new row with `supersedes_id` set;
queries default to the latest non-superseded row.

---

## 5. Screenplay editor

- Monaco Editor with a custom **Fountain-compatible** language definition
  (`frontend/src/features/editor/fountain.ts`).
- Round-trips between Fountain (storage) and FDX / PDF on export.
- Scene-level metadata (location, INT/EXT, time-of-day, characters present) is
  parsed from the Fountain source and indexed.
- The editor surfaces:
  - inline AI suggestions (gutter chips per scene)
  - voice-mismatch warnings (dialogue lines that score < 0.6 against the
    character's canonical voice fingerprint)
  - continuity warnings (e.g. a character listed as dead reappearing)

Storage:

- Authoritative source = Fountain text in Postgres (`scripts.fountain`).
- Compiled artifacts (FDX, PDF, Markdown) live in Supabase Storage and are
  regenerated on export.

---

## 6. Frontend

```
frontend/src
├── app/                       # Router, providers, layout shell
├── components/ui/             # Buttons, dialogs, glass panels, etc.
├── components/agents/         # AgentAvatar, AgentBadge, AgentBubble
├── features/
│   ├── dashboard/             # Projects list, recent activity
│   ├── writers-room/          # Multi-agent room, approvals, debate
│   ├── editor/                # Monaco-based screenplay IDE
│   ├── character-bible/
│   ├── story-bible/
│   ├── episodes/
│   ├── drafts/
│   ├── rewrites/
│   ├── continuity/
│   ├── production/
│   └── exports/
├── lib/
│   ├── api.ts                 # Typed REST client
│   ├── supabase.ts            # Browser client (auth + realtime)
│   └── format.ts              # Fountain helpers
└── styles/
    └── globals.css
```

Styling: Tailwind + custom CSS variables for a cinematic palette (deep
charcoal, ember accent, glassmorphism panels). See
`frontend/tailwind.config.js`.

---

## 7. Backend

```
backend/src
├── index.ts                   # Fastify bootstrap
├── config.ts                  # env + zod validation
├── db/
│   ├── client.ts              # Supabase server client (service role)
│   └── queries.ts             # Typed DB helpers
├── auth/
│   └── verifyJwt.ts           # Supabase JWT verification
├── agents/
│   ├── types.ts               # Agent / Tool / RoomMessage types
│   ├── registry.ts            # Per-role config & model selection
│   ├── toolbelt.ts            # Tool implementations
│   ├── prompts.ts             # System prompt builders
│   ├── runner.ts              # LLM-agnostic run(agent, input, ctx)
│   ├── showrunner.ts
│   ├── concept.ts
│   ├── character.ts
│   ├── world.ts
│   ├── plot.ts
│   ├── scene.ts
│   ├── dialogue.ts
│   ├── scriptDoctor.ts
│   ├── continuity.ts
│   └── producer.ts
├── orchestrator/
│   ├── graph.ts               # Stage graph definition
│   ├── runner.ts              # Stage executor + checkpointing
│   └── stages/                # One file per workflow stage
├── memory/
│   ├── index.ts               # write/read/search/approve
│   └── embeddings.ts          # provider-agnostic embed()
├── screenplay/
│   ├── fountain.ts            # parse / format
│   ├── fdx.ts                 # FDX exporter
│   └── pdf.ts                 # PDF exporter
├── production/
│   ├── shotlist.ts
│   ├── storyboard.ts
│   └── flow.ts                # cinematic video-gen prompt builder
└── routes/
    ├── projects.ts
    ├── workflows.ts
    ├── agents.ts
    ├── memory.ts
    ├── scripts.ts
    ├── exports.ts
    └── production.ts
```

The server is **stateless**. State lives in Postgres (incl. workflow
checkpoints) + Supabase Storage. This allows horizontal scaling and clean
local-prod parity.

---

## 8. Database

Detailed in `supabase/migrations/0001_init.sql`. Tables (abridged):

- `profiles` — Supabase user mirror.
- `projects` — film / TV pilot / miniseries / short.
- `seasons`, `episodes`.
- `characters`, `character_voice_fingerprints`, `relationships`.
- `locations`, `wardrobe_items`.
- `scripts` — Fountain source + metadata, one per draft.
- `script_scenes` — derived per-scene index.
- `memory_entries` — the polymorphic canon/draft store with `embedding
  vector(3072)`.
- `workflows`, `workflow_stages`, `workflow_stage_artifacts`,
  `workflow_checkpoints`, `approvals`.
- `room_messages` — Writers Room timeline.
- `continuity_issues`, `production_assets`.
- `revisions` — generic version history pointer.

All tables enforce RLS; project-scoped tables join `project_members` to gate
access.

---

## 9. Realtime & approvals

- The backend writes a `room_messages` row for every agent turn. Supabase
  Realtime broadcasts these on the `room:{project_id}` channel.
- Approval gates create an `approvals` row with `status='pending'`. The
  frontend subscribes to `approvals:{project_id}` and renders inline cards.
- Approving / rejecting updates the row, which the orchestrator polls (or
  receives via callback) to resume the stage.

---

## 10. Security

- All backend endpoints require a Supabase JWT (verified server-side).
- Service-role key never leaves the backend.
- LLM provider keys never reach the browser.
- RLS on every table; the backend uses the service role for cross-row
  orchestration but always re-checks project membership before mutating.
- Tool calls from agents go through `toolbelt.ts`, which validates the
  caller, payload, and target — agents can't bypass it.

---

## 11. Extensibility

- **New agent**: add `backend/src/agents/<name>.ts`, register in
  `registry.ts`, add to relevant stages in `orchestrator/stages/`.
- **New stage**: add a file under `orchestrator/stages/`, declare its inputs,
  agents, output schema, and approval policy.
- **New export format**: add a builder under `backend/src/screenplay/` and a
  route in `routes/exports.ts`.
- **New production tool**: add a builder under `backend/src/production/`.

The architecture is intentionally **modular and scalable** so that adding a
new agent or stage is a localized change — never a refactor.
