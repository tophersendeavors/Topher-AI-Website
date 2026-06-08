# Guided Production Workflow

The shared 12-stage workflow that runs for **every** project type. Format
differences live in `projectTypeConfig` (see
`docs/PROJECT_TYPE_ADAPTERS.md`), not in the stage list.

Backend canonical order: `STAGE_ORDER` in
`backend/src/workflow/state.ts`.
Frontend renders in the same canonical order, ignoring `Object.keys()`
insertion order.

## The 12 stages

| # | Key | Owner role | Kind | What's approved here |
|---|---|---|---|---|
| 1 | `script_approved` | Writer / Showrunner | milestone | Screenplay is locked as production source-of-truth |
| 2 | `roles_assigned` | Showrunner / Producer | milestone | Every creative role assigned to AI Generic / AI Influence / Live Person |
| 3 | `production_design` | Production Designer | canon | Location identity, walls, floor, ceiling per scoped location |
| 4 | `art_dept` | Art Director / Set Decorator | canon | Set dressing — bedding, wall décor, clutter level |
| 5 | `props` | Propmaster | canon | Visual canon (look + handling rules) per hero prop |
| 6 | `wardrobe_hmu` | Wardrobe + HMU heads | canon | Per-episode wardrobe top + hair state per character |
| 7 | `blocking` | Director | canon | Per shot — start position + eyeline target (approved per-shot) |
| 8 | `cinematography` | DP / Cinematographer | canon | Per shot — framing + lens + camera view zone (approved per-shot) |
| 9 | `continuity` | Script Supervisor | review | Continuity pass — zero failures |
| 10 | `prompt_supervisor` | Prompt Supervisor | review | Model-ready prompt generated for every shot |
| 11 | `preflight` | Quality Control | review | Overall readiness — all upstream gates clean |
| 12 | `generate` | Production | milestone | Final gate — clip generation unlocked |

**Stage kinds** (`STAGE_KIND` in `WorkflowPage.tsx`):
- `milestone` — pure gate, no embedded work.
- `canon` — user explicitly approves AI-proposed values per deliverable.
  These stages run the 80% approval gate (see below).
- `review` — values were generated upstream (briefs); user reads a
  summary and acknowledges. No per-row Approve as canon; one stage-level
  Approve.

## Stage dependencies

Encoded in `STAGE_DEPS` (`backend/src/workflow/state.ts`). A stage is
`locked` until every dep is `approved`. Reopening a stage via "Request
changes" puts it back to `in_progress` but does NOT auto-relock
downstream stages — they continue showing whatever canon they had.

```
script_approved
   └─ roles_assigned
        └─ production_design
             ├─ art_dept
             ├─ props (also deps on art_dept)
             ├─ wardrobe_hmu
             └─ blocking (deps on PD + art_dept + props + wardrobe_hmu)
                  └─ cinematography (deps on PD/art/props/wardrobe/blocking)
                       └─ continuity (deps on blocking + cinematography)
                            └─ prompt_supervisor (deps on continuity)
                                 └─ preflight (deps on prompt_supervisor)
                                      └─ generate (deps on preflight)
```

## Stage advance gate (canon stages)

For stages whose kind is `canon`, the user must explicitly approve at
least **80%** of the canon-bearing deliverables before "Approve this
stage" enables. See `STAGE_APPROVAL_GATE` in
`backend/src/workflow/state.ts`. The threshold is per-stage and lives
under `projectTypeConfig.approvalStrictness` for adapters that want
something tighter or looser.

Approval = a `textOverride` entry exists on `canonSources` for that
field. "Bible has a value" alone does not count.

The frontend shows:
- A progress chip in the sidebar (e.g. "5/7") for canon stages.
- An amber banner on the detail panel: "Stage gate not met. 5/7
  deliverables approved as canon (71%) — need 80% before you can
  advance."
- The "Approve this stage" button disabled with a tooltip.

The backend also enforces the gate in `approveStage()`; direct API hits
return an error if the user tries to bypass.

## Role Assignment (Stage 2)

Each role from `ROLE_REGISTRY` is assigned by the user to one of:
- **AI Generic** (`ai_generic`) — the system generates proposals using
  the project's Visual World Rules and screenplay context.
- **AI Creative Influence** (`ai_influence`) — same, but styled by a
  selected preset (see `backend/src/workflow/creativeInfluences.ts` —
  ~16 neutral production-principle presets; we never name living
  artists).
- **Live Person** (`live_person`) — assigned to a project member who
  uploads references, picks Canon Targets via the picker, and approves
  contributions.

When the user clicks "Confirm team — unlock Production Design", Stage 2
is marked approved and Stage 3 unlocks.

## What each stage looks like in the UI

Every stage panel renders, top-down:

1. **"What you're approving"** callout (blue, pinned) — one sentence
   that explains whether this is canon, review, or milestone, and what
   the user is committing.
2. **Owner / Status / What unlocks next** mini-cards.
3. **Embed area** — depends on role:
   - **AI role**: the AI Proposal view (rows of deliverables with
     Approve / Regenerate / Regenerate-with-notes / Reject buttons).
     Auto-fires `auto-propose` on first open so the writer arrives at
     populated proposals.
   - **Live Person role**: the Department Workspace (contribution form
     with Canon Target Picker + Vision Extraction button).
   - **Review stages**: a one-block summary list with green/amber dots.
   - **Embedded sub-tools**: Prompt Supervisor stage embeds the AI Video
     Prompts panel; Preflight stage embeds the Preflight card.
4. **Status recap** (canon stages only) — "Already approved" / "Still
   needed", with action shortcuts.
5. **Approve this stage / Request changes** controls at the bottom.

## Auto-proposing on stage entry

When an AI-role stage opens with empty deliverables, the frontend calls
`POST /scripts/:id/workflow/stages/:stageKey/auto-propose`. The backend
loops empty `canonFieldPath` deliverables in parallel, calls
`regenDeliverableProposal()` for each, and writes the result to
`script.metadata.workflowAIProposals[fieldPath]`. The next call to
`getWorkflowReport` surfaces these as `currentValue` with
`hasAIProposal: true`. The user can Approve in one click without first
clicking Regenerate.

## Canon Target Picker

`frontend/src/features/workflow/CanonTargetPicker.tsx` is the friendly
4-step cascade (Location → Category → Item → Field) that hides raw
field paths. Driven by
`GET /projects/:id/canon-catalog` → `buildCanonCatalog()` in
`backend/src/workflow/canonCatalog.ts`. Used in:
- Live Person contribution upload form (DepartmentWorkspace).
- Vision Extraction setup.
- Future direct-canon-edit flows.

## Vision Extraction

`backend/src/vision/extract.ts` runs Claude Sonnet vision on an uploaded
reference image. Given the image URL + canon target (resolved from the
picker) + Visual World Rules, returns:
- `observed` — short sentence describing what's actually in the image
  (so the user can sanity-check the AI).
- `suggestedValue` — a short, production-ready canon text the user can
  edit before saving.

Wired into the Live Person contribution upload (✨ Extract canon text
from image button).

## Prompt Impact Preview

`backend/src/workflow/promptImpact.ts` computes which shots a canon
field affects, in friendly labels (EP01 SC01 SH02). Categories:
`location` (matches scenes by slugline), `prop` (matches shots by
`visibleSetElements`), `character` (matches shots that include the
character). Each result lists affected scenes with shot counts and a
human reason ("scene takes place in this location" /
"prop 'phone' is visible in this shot").

UI: `ImpactPreview.tsx`. Embedded inside every AI Proposal row. Auto-
shows after approval; hides when empty (no affected shots).

**Required rule**: every canon-approval surface — AI Proposal view OR
Live Person upload approval — must show ImpactPreview when a target is
picked. Today AI Proposal view has it; Live Person Department Workspace
contribution form does not. That's the next implementation gap.

## Stale-prompt detection

`backend/src/workflow/stalePrompts.ts` finds stored prompts whose
referenced canon has changed since generation. Two failure modes:
1. A new approved canon reference exists for a field visible in this
   shot but isn't attached to the prompt's `referenceMetadata`.
2. A text override exists for a canon path visible in this shot whose
   distinctive tokens are absent from the prompt body.

Output includes a `label` (e.g. "EP01 SC02 SH02 · Kling") and human
`reasons[]`. Surfaced in the StalePromptsPanel at the top of the
workflow page, plus a one-click "Regenerate affected shots" button.

## What auto-flows where

- Approved canon → `loadResolvedCanon()` → prompt composer
  (`backend/src/draft/aiPrompts/engine.ts`).
- Per-canon-field references → prompt's `referenceMetadata.canonReferences[]`.
- Text overrides → prompt body via `buildVisibleCanonBlock()`.
- Bibles → continuity loader → continuity directive in prompt system.
- Visual World Rules → composer + Vision Extraction system prompts.

If canon changes, stale-prompt detection flags the affected shots; the
writer hits Regenerate; the new prompt visibly bakes in the new canon.

## What format-specific behavior lives where

The 12 stages are universal. Format differences live in:
- `projectTypeConfig` (proposed, see PROJECT_TYPE_ADAPTERS.md): required
  stages, optional stages, approval strictness, aspect ratio, prompt
  strategy, scene/shot organization.
- Micro-drama-only adapters: `backend/src/microDrama/*`,
  `recommendNextStepMicroDrama()`, screenplay generation in
  `entities.ts`.
- Prestige/Mini/Series-only: the orchestrator workflow stages prior to
  Stage 1 (idea → treatment → season_arc → episodes → drafts).

## Don't do this

- Don't add new `if (projectType === "micro_drama")` branches in the
  12-stage code. Add an adapter field instead.
- Don't expose raw `canonFieldPath`, `scriptId`, `episodeId`, or
  `projectId` to the user. The Canon Target Picker and Workflow route
  IDs are internal.
- Don't auto-approve canon stages. The 80% gate is the safety mechanism
  that prevents the AI from silently dictating every visual decision.
- Don't auto-rewrite prompts when canon changes. Mark them stale and
  let the user regenerate.
- Don't hard-code stage names. Use `STAGE_ORDER` and `STAGE_LABEL` from
  `frontend/src/features/workflow/WorkflowPage.tsx`.

---

## Series Redevelopment Mode (Prestige Series / Mini Series)

The 12-stage workflow above moves forward — idea → script → canon →
prompts → final. There is a second, parallel mode for when the series
**engine** changes mid-development and you need to revise the architecture
(character bibles, system/protocol modules, season arc, pilot strategy)
**without** overwriting drafts or approved canon.

This mode is called **Series Redevelopment** and is exposed only on
Prestige Series and Mini Series projects.

### When to use it

- The show's core principle has shifted (different premise, different
  thematic question, different engine driving each scene).
- An audit of the pilot reveals it's built on assumptions you no longer
  believe (e.g. SELVAJE moved from *"the Protocol exposes a fraud"* to
  *"the Protocol destroys avoidance"*).
- You want to redesign Season One — but the existing pilot draft must
  be preserved and the redev architecture must be approved first.

### The six redev stages

| Stage | Owner | Output | Gate |
|---|---|---|---|
| **R1 — Brief** | Showrunner | What changed, new core principle, new season question, primary/secondary mystery, what must NOT change, scope | — |
| **R2 — Character Bibles** | Showrunner + LLM | Ten-field bibles per principal: Public/Private identity, Core Wound, Avoidance Strategy, Hidden Truth, Think-they-need vs Actually-need, Protocol Vulnerability, Season Revelation, Final Choice | R1 approved |
| **R3 — Protocol Modules** | Showrunner + LLM (Phase 2) | 10–15 modules: name, purpose, psychological target, avoidance stripped, somatic exercise, visual execution, dramatic risks, affected characters, truth pressured, episode placement | R1 approved |
| **R4 — Season Arc Redesign** | Showrunner + LLM (Phase 2) | 8 episodes: title, theme, protocol module used, character breakthrough/collision, mystery progression, revelation, cliffhanger, pilot plant | R2 + R3 approved |
| **R5 — Pilot Strategy** | Showrunner + LLM (Phase 3) | What changes / stays / removed / added; character intro adjustments; final-hook options | R4 approved |
| **R6 — Pilot Rewrite** | Showrunner + LLM (Phase 3) | Revised draft preserved as new version; original draft retained | R2 + R3 + R4 + R5 approved |

### Non-destructive by design

- Redev outputs live under `projects.metadata.redevelopmentPasses[]` —
  separate from the live `characters` table, the live `scripts`, and
  any approved canon textOverrides.
- Approving an R2 bible writes `approvedAt` on the proposed payload —
  it does **not** mutate the live character bible.
- A future **Promote Pass** action (Phase 3) is the only way a pass's
  approved revisions replace live canon. Until then, the live data is
  untouched.

### How redev and the 12-stage workflow relate

- The 12-stage workflow continues to operate on the **live** bibles and
  scripts. A redev pass running in parallel does not block production.
- Once a pass is Promoted (Phase 3), the 12-stage workflow's stale-prompt
  detector will flag every shot whose canon dependencies changed — so
  the supervisor can regenerate prompts against the new bible.

### Where the code lives

| Surface | Path |
|---|---|
| Types | `backend/src/redevelopment/types.ts` |
| Store (reads/writes `projects.metadata.redevelopmentPasses`) | `backend/src/redevelopment/store.ts` |
| R2 character bible LLM agent | `backend/src/redevelopment/characterBibleAgent.ts` |
| Routes | `backend/src/routes/redevelopment.ts` |
| Page | `frontend/src/features/redevelopment/RedevelopmentPage.tsx` |
| Entry button | `RedevelopmentButton` in `frontend/src/features/dashboard/ProjectOverviewPage.tsx` |
