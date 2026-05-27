# TOBURT Studios

> The operating system for a next-generation AI-native film & TV studio.

TOBURT Studios is a multi-agent screenplay development platform — a hybrid of a
Hollywood writers' room, a screenplay IDE, an AI orchestration runtime, and a
cinematic production pipeline.

It is **not** a chatbot. It is a structured, opinionated creative operating
system: specialized AI agents collaborate through orchestrated workflows to take
an idea from logline → treatment → season arc → beat sheet → screenplay →
production-ready draft, with persistent memory, continuity enforcement, and
human-in-the-loop approvals at every stage.

---

## Highlights

- **15 specialized agents** — Showrunner, Concept, Character, World/Canon,
  Plot, Scene, Dialogue, Script Doctor, Continuity, Producer, plus a 5-agent
  **Emotional Intelligence Layer** (Emotional Truth, Subtext, Character Wound,
  Behavior, Relationship Tension) that rejects scenes whose characters
  explain their feelings instead of dramatizing them.
- **LangGraph-style orchestrator** — stateful, branchable, resumable graphs with
  per-stage checkpoints, approvals and rollback.
- **Shared canonical memory** — Supabase + pgvector store project, script,
  character, location, relationship, season-arc, continuity, and approved-canon
  memory with semantic retrieval.
- **Cinematic Writers Room UI** — agents appear as participants, debate story
  decisions, post inline suggestions, and request human approvals.
- **Screenplay IDE** — Monaco-based editor with industry-standard formatting,
  scene/character tagging, drag-and-drop scene ordering and revision history.
- **Production pipeline** — shotlists, storyboard prompts, Flow/video prompts,
  wardrobe & environment continuity, VFX/budget warnings.
- **Multi-format export** — PDF, Final Draft (`.fdx`), Fountain, Markdown.

---

## Repository layout

```
.
├── frontend/                # React + TypeScript + Vite + Tailwind cinematic UI
├── backend/                 # Node + Fastify + LangGraph-style orchestration
├── packages/
│   └── shared/              # Shared TypeScript types (agents, screenplay, db)
├── supabase/
│   ├── migrations/          # SQL schema, RLS, pgvector
│   └── seed.sql
├── docs/
│   ├── ARCHITECTURE.md      # End-to-end system design
│   ├── AGENTS.md            # Per-agent role specs and prompts
│   ├── MEMORY.md            # Shared memory model & retrieval
│   ├── WORKFLOW.md          # Pipeline stages and approvals
│   └── DEPLOYMENT.md        # Production deployment guide
├── .env.example
├── package.json             # npm workspaces root
└── README.md
```

---

## Quick start (local development)

> Requirements: Node 20+, npm 10+, a Supabase project (cloud or local CLI),
> at least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
cp .env.example backend/.env
cp .env.example frontend/.env
# fill in Supabase + LLM credentials

# 3. Apply database schema
#    (uses the Supabase CLI; see docs/DEPLOYMENT.md for cloud setup)
npx supabase db push

# 4. Run everything
npm run dev
#   - frontend → http://localhost:5173
#   - backend  → http://localhost:8787
```

See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for production deploys.

---

## How it works (90-second version)

1. **Create a project** (film / TV pilot / miniseries / short). The Showrunner
   agent captures vision, genre, tone, references.
2. **Run a workflow.** The orchestrator walks the project through stages —
   logline → synopsis → treatment → season arc → episode outline → beat sheet
   → scene list → screenplay → rewrite → continuity → production. Each stage
   spawns the right subset of agents.
3. **Agents debate.** In the Writers Room, agents post drafts, critiques and
   suggestions. The Showrunner arbitrates. Humans can intervene, approve,
   reject, or rewrite at any point.
4. **Memory persists.** Every approved fact (character voice, world rule,
   timeline event, wardrobe note) lands in canonical memory, embedded and
   retrievable. Subsequent agent calls hydrate from that memory.
5. **Export.** Production-ready screenplay assets (PDF, FDX, Fountain) and
   production tools (shotlists, storyboard prompts, Flow video prompts) drop
   into the Export Center.

For the full architecture, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## Status

This is the **v0.1 architectural skeleton + working core**:

- ✅ Monorepo structure, shared types, env scaffolding
- ✅ Supabase schema (projects, scripts, characters, memory, workflows, …) with
  pgvector and RLS
- ✅ Backend: Fastify server, agent registry, orchestrator graph, memory API,
  REST routes, export endpoints
- ✅ All 10 agents implemented with prompts, tool contracts, and Showrunner
  arbitration
- ✅ Frontend: cinematic dark UI shell, dashboard, Writers Room, screenplay
  editor (Monaco), Character/Story bibles, Episodes, Drafts, Continuity,
  Production Tools, Export Center
- ✅ Workflow pipeline with stage checkpoints, approvals, rollback
- ⏳ AI video / storyboard / animatic integrations — hooks are wired, providers
  are pluggable (`backend/src/production/*`).

---

## License

Proprietary © TOBURT Studios. All rights reserved.
