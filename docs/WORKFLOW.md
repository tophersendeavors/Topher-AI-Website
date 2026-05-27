# Workflow Pipeline

Every project moves through a directed graph of stages. Each stage is a
small, self-contained module under `backend/src/orchestrator/stages/`.

---

## Stage list

| Stage | Inputs | Agents | Output artifact |
|---|---|---|---|
| `idea` | user free-text | — | `Idea` |
| `logline` | `Idea` | Concept, Showrunner | `LoglinePack` |
| `synopsis` | `LoglinePack` | Concept, Plot, Showrunner | `Synopsis` |
| `treatment` | `Synopsis` | Plot, Character, World, Showrunner | `Treatment` |
| `season_arc` | `Treatment` | Plot, Character, World, Showrunner | `SeasonArc` |
| `episode_outline` | `SeasonArc` (per episode) | Plot, Character, Showrunner | `EpisodeOutline` |
| `beat_sheet` | `EpisodeOutline` | Plot, Scene, Showrunner | `BeatSheet` |
| `scene_list` | `BeatSheet` | Scene, Continuity | `SceneList` |
| `draft_v1` | `SceneList` | Scene, Dialogue, Character, Continuity, Showrunner | `Script` (Fountain) |
| `rewrite` | `Script` | Script Doctor, Dialogue, Showrunner | `Script` (Fountain, n+1) |
| `continuity_pass` | `Script` | Continuity, World | `ContinuityReport` |
| `production_draft` | `Script` + `ContinuityReport` | Producer, Showrunner | `ProductionDraft` |
| `exports` | `ProductionDraft` | — | PDF / FDX / Fountain / Markdown |

---

## Stage contract

Every stage exports:

```ts
export const stage: Stage = {
  id: "treatment",
  title: "Treatment",
  requiresApproval: true,        // pauses for Showrunner + human
  inputs: ["synopsis"],
  agents: ["plot", "character", "world", "showrunner"],
  outputSchema: TreatmentSchema,
  run: async (ctx) => { /* … */ },
};
```

The `run` function is responsible for:

1. Hydrating context (memory pulls, transcript window).
2. Invoking agents (in parallel where possible).
3. Reconciling outputs (Showrunner arbitration).
4. Persisting the artifact (`workflow_stage_artifacts`) + canonical memory
   writes for any approved facts.
5. Returning the artifact.

---

## Checkpointing

After every stage `run` resolves, the orchestrator writes a row into
`workflow_checkpoints`:

```sql
(id, workflow_id, stage_id, state_jsonb, artifact_id, created_at)
```

`state_jsonb` is the full orchestrator state (current stage, completed
stages, pending approvals). Re-running a stage:

- Forks a new revision (`revisions` table).
- Old artifacts are kept; the workflow `current_revision` pointer advances.
- A human can `POST /workflows/:id/rollback?to=<checkpoint_id>` to return to
  an earlier state.

---

## Approval gates

Stages with `requiresApproval: true` create an `approvals` row when their
draft artifact is ready, then *pause*. The orchestrator is restartable:

- The next `POST /workflows/:id/advance` call inspects pending approvals.
- If the approval is `approved`, the stage finalizes and the next stage
  starts.
- If `rejected`, the originating agent is re-invoked with the rejection
  rationale appended as `critique`.

The Writers Room UI renders these gates as cards with `Approve / Revise /
Reject` controls.
