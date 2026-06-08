# Product Vision — TOBURT Studios

## One line

TOBURT Studios turns screenplays into guided AI-native productions that a
non-technical creative can run end-to-end without ever seeing a database
path, ID, or raw route.

## Audience

- **Primary**: solo creators, indie writer-directors, small studios who
  want to develop and produce screen content with AI assistance.
- **Secondary**: production teams who want collaborative canon (Wardrobe,
  Props, PD, etc.) without learning a database schema.
- **Not the audience**: developers, prompt engineers, or model-tweakers.
  Power features can exist behind an Advanced toggle, but the default
  surface is for creatives.

## What TOBURT does

1. **Writers Room** — drives a screenplay from idea → treatment → season
   arc → episodes → drafts. Multi-agent + approval gates.
2. **Approval** — a writer/showrunner approves a draft, locking it as the
   production source-of-truth.
3. **Guided Production Workflow** — 12 stages, in order, mirroring how a
   real production crew works. See
   `docs/GUIDED_PRODUCTION_WORKFLOW.md`.
4. **Role Assignment** — every creative role gets assigned to one of:
   - **AI Generic** — the system proposes values; user approves.
   - **AI Creative Influence** — same, but styled by a preset (e.g.
     restrained emotional staging, naturalistic overlap).
   - **Live Person** — a human collaborator uploads references, picks
     canon targets, and approves.
5. **Canon** — every locked decision (wall color, comforter, prop look,
   hair state, blocking, lens) is canonical and reused by downstream
   stages. Stored in `projects.metadata.canonSources` by field path.
6. **Prompts** — approved canon flows into per-shot AI video prompts and
   reference metadata. Models supported include Kling, Veo, Runway,
   Midjourney, Luma, Pika.
7. **Preflight + Generate** — Preflight verifies every gate. Generate is
   the final stage and only unlocks when Preflight is green.

## What TOBURT is NOT

- Not a model. We orchestrate Claude + image/video models; we don't train.
- Not "just a screenplay editor." The screenplay is one stage of 12.
- Not Micro-Drama-only. Micro Drama is our pilot format. Architecture
  must support Prestige Series, Mini Series, Features, TV Pilots,
  Miniseries, Series, and Shorts via `projectTypeConfig`.
- Not a developer tool. No raw IDs, paths, or routes in the UI.

## Project types and kinds

| Project type (`metadata.projectType`) | Description |
|---|---|
| `prestige_series` | Long-form drama, traditional season structure |
| `mini_series` | Limited-series structure, 4–8 episodes |
| `micro_drama` | Vertical 9:16, 30–120 sec episodes, chain-driven |

| Kind (`projects.kind`) | Description |
|---|---|
| `feature` | One screenplay, ~80–120 pages |
| `pilot` | TV-style series pilot (single episode) |
| `miniseries` | Limited-series creative scope |
| `series` | Multi-season scope |
| `short` | <30-page short film |

`kind` describes container/length; `projectType` describes the production
mode and what stages, prompt strategy, and approval depth apply.
`projectTypeConfig` resolves both into actual workflow behavior — see
`docs/PROJECT_TYPE_ADAPTERS.md`.

## Why this exists

Existing AI tooling assumes the user is a developer or prompt engineer.
TOBURT's bet is that you can give a non-technical creative the same
power if you:

- Hide every ID, path, and route.
- Translate "canon field path" → "MAYA'S BEDROOM → Furniture → Bed
  Design" via the Canon Target Picker.
- Show the consequences of every decision (Prompt Impact Preview).
- Tell the user exactly why something is wrong and how to fix it
  (stale-prompt detection, Preflight gates with friendly messages).
- Treat every stage like a real production department, owned by a role
  (AI or Live), with explicit deliverables.

## Success criteria

- A creative can ship EP01 of a micro-drama end-to-end without help. See
  `docs/ACCEPTANCE_TESTS.md` for the click-by-click test.
- The same workflow runs for a Prestige Series pilot episode without
  hard-coded micro-drama assumptions leaking through.
- New project types can be added by writing one `projectTypeConfig`
  entry, not by editing 26 files.

## What's deliberately deferred

These are explicitly NOT priorities for the current build phase:

- Advanced talent profiles or "creative DNA" beyond Creative Influence
  presets.
- Actual clip generation in Stage 12 (the gate works; the trigger is a
  separate scope).
- Per-project cost/usage tracking dashboards.
- Multi-tenant org management.
- Real-time multi-user collaboration cursors.

Finish the basic usable workflow first.
