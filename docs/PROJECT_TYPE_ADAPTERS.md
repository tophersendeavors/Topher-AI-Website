# Project Type Adapters

> The 12-stage Guided Production Workflow runs for every project type.
> Format-specific behavior lives behind a `projectTypeConfig` adapter —
> **never** as inline `if (projectType === "micro_drama")` checks in
> general workflow code.

## Two fields, two purposes

| Field | Source | Purpose |
|---|---|---|
| `projects.kind` | column (`feature` / `pilot` / `miniseries` / `series` / `short`) | Container/length classification. Drives Writers Room scaffolding. |
| `projects.metadata.projectType` | jsonb (`prestige_series` / `mini_series` / `micro_drama`) | Production mode. Drives workflow strictness, prompt strategy, output format. |

`projectTypeConfig` resolves both into actual behavior at every decision
point.

## Where it should live

**Proposed (not yet built):**

- **Single canonical config**: `packages/shared/src/projectTypeConfig.ts`
- Exports:
  ```ts
  export type ProjectType = "prestige_series" | "mini_series" | "micro_drama";
  export type ProjectKind = "feature" | "pilot" | "miniseries" | "series" | "short";

  export interface ProjectTypeConfig {
    // ---- Workflow shape ----
    requiredStages: StageKey[];
    optionalStages: StageKey[];
    /** Per-stage approval ratio (override of STAGE_APPROVAL_GATE). */
    approvalStrictness: Partial<Record<StageKey, number>>;

    // ---- Default roles ----
    /** Roles auto-assigned to ai_generic vs left unassigned. */
    defaultRoleAssignments: Partial<Record<RoleKey, AssignmentType>>;

    // ---- Output ----
    defaultAspectRatio: "9:16" | "16:9" | "2.39:1" | "1:1";
    defaultClipDurationSec: { min: number; max: number };
    promptStrategy: "shot_level" | "scene_level" | "sequence_level";
    reviewDepth: "per_shot" | "per_scene" | "per_sequence";

    // ---- Episode / scene organization ----
    /** How episode-level work materializes. */
    episodeModel: "chain" | "outline" | "scene_list";
    /** Whether episodes are required (vs single-script projects). */
    requiresEpisodes: boolean;

    // ---- Approval gates ----
    scriptApprovalSource: "micro_drama_approval" | "draft_approval";
    preflightStrictness: "lenient" | "standard" | "strict";

    // ---- Recommended-next-step branch ----
    recommendedNextStepBranch: "micro_drama" | "prestige";
  }

  export const PROJECT_TYPE_CONFIGS: Record<ProjectType, ProjectTypeConfig> = {
    micro_drama: { ... },
    prestige_series: { ... },
    mini_series: { ... },
  };

  export function resolveProjectTypeConfig(
    projectType: ProjectType | undefined,
    kind: ProjectKind | undefined,
  ): ProjectTypeConfig { ... }
  ```

- **Backend consumers** (must call `resolveProjectTypeConfig()` instead
  of inline checks):
  - `backend/src/workflow/state.ts` — required stages, approval strictness
  - `backend/src/preflight/preflight.ts` — preflight strictness +
    approval source
  - `backend/src/draft/recommendedStep.ts` — branch selection
  - `backend/src/routes/entities.ts` — screenplay generation +
    approval-gate writes
  - `backend/src/draft/aiPrompts/autoBuild.ts` — pipeline shape

- **Frontend consumers**:
  - `frontend/src/features/dashboard/ProjectsPage.tsx` (create form
    surfaces kind + projectType)
  - `frontend/src/features/episodes/EpisodesPage.tsx` (episode list
    shape)
  - `frontend/src/features/workflow/WorkflowPage.tsx` (stage labels,
    auto-propose triggers)
  - Adapters re-export friendly labels per project type.

## Default configs (proposed)

### `micro_drama`

```ts
{
  requiredStages: ALL_STAGE_KEYS, // all 12
  optionalStages: [],
  approvalStrictness: {
    production_design: 0.8,
    art_dept: 0.8,
    props: 0.8,
    wardrobe_hmu: 0.8,
  },
  defaultRoleAssignments: {
    director: "ai_generic",
    production_designer: "ai_generic",
    art_director: "ai_generic",
    propmaster: "ai_generic",
    wardrobe: "ai_generic",
    cinematographer: "ai_generic",
  },
  defaultAspectRatio: "9:16",
  defaultClipDurationSec: { min: 3, max: 5 },
  promptStrategy: "shot_level",
  reviewDepth: "per_shot",
  episodeModel: "chain",
  requiresEpisodes: true,
  scriptApprovalSource: "micro_drama_approval",
  preflightStrictness: "standard",
  recommendedNextStepBranch: "micro_drama",
}
```

### `prestige_series`

```ts
{
  requiredStages: ALL_STAGE_KEYS,
  optionalStages: [],
  approvalStrictness: {
    production_design: 0.9,   // tighter — bigger budget, tighter canon
    art_dept: 0.9,
    props: 0.9,
    wardrobe_hmu: 0.9,
  },
  defaultRoleAssignments: {
    director: "live_person",
    production_designer: "live_person",
    cinematographer: "live_person",
    // other roles default to ai_generic until staffed
  },
  defaultAspectRatio: "2.39:1",
  defaultClipDurationSec: { min: 4, max: 12 },
  promptStrategy: "scene_level",
  reviewDepth: "per_scene",
  episodeModel: "outline",
  requiresEpisodes: true,
  scriptApprovalSource: "draft_approval",
  preflightStrictness: "strict",
  recommendedNextStepBranch: "prestige",
}
```

### `mini_series`

```ts
{
  ...prestige_series defaults,
  approvalStrictness: { production_design: 0.8, art_dept: 0.8, props: 0.8, wardrobe_hmu: 0.8 },
  defaultAspectRatio: "16:9",
  defaultClipDurationSec: { min: 4, max: 8 },
  promptStrategy: "scene_level",
  reviewDepth: "per_scene",
  preflightStrictness: "standard",
}
```

## Adapter resolution rule

For ambiguous cases (e.g. `projectType` unset, only `kind` known),
`resolveProjectTypeConfig()` falls back:

| Input | Resolution |
|---|---|
| `projectType` set | use that config |
| `projectType` unset, `kind === "feature"` or `"pilot"` | `prestige_series` |
| `projectType` unset, `kind === "miniseries"` | `mini_series` |
| `projectType` unset, `kind === "short"` or `"series"` | `prestige_series` |
| both unset | `prestige_series` (safe default) |

## Naming rules (don't violate)

**Good (general):**
- `productionWorkflow`, `guidedWorkflow`, `departmentWorkflow`,
  `projectWorkflow`, `formatAdapter`, `projectTypeConfig`

**Bad (would be wrong as general names):**
- `microDramaWorkflow` for the whole system
- `microDramaOnlyPreflight`
- `microDramaDepartments` as the base workflow
- `chainSnapshot` as a workflow concept (it's a micro-drama-specific
  artifact)

If something exists only for one type, name it accordingly and put it
in that type's directory (`backend/src/microDrama/*` is good — its
contents are correctly scoped).

## What to generalize (today's hard-coded surfaces)

The audit found 26 files with hard-coded `projectType === "micro_drama"`
checks. The generalization plan:

| File | Today | After projectTypeConfig |
|---|---|---|
| `backend/src/preflight/preflight.ts:283–317` | hard-checks `microDramaApproval` | reads `cfg.scriptApprovalSource` |
| `backend/src/workflow/state.ts:188–194` | auto-approves Stage 1 from `microDramaApproval` | reads approval source from config |
| `backend/src/draft/recommendedStep.ts:45–334` | dispatches to micro branch | dispatches via `cfg.recommendedNextStepBranch` |
| `backend/src/routes/entities.ts` screenplay paths | writes `microDramaApproval` + `chainSnapshot` | wrapped in micro-adapter; prestige writes `draftApproval` |
| `backend/src/routes/projects.ts:200` | guards chain generation | reads `cfg.episodeModel === "chain"` |
| `backend/src/draft/aiPrompts/autoBuild.ts:241` | skips prestige pipeline | reads `cfg.promptStrategy` |
| `frontend/src/features/dashboard/ProjectsPage.tsx:195,217` | UI defaults | reads config |
| `frontend/src/features/dashboard/ProjectOverviewPage.tsx:2000,2020` | UI branches | reads config |
| `frontend/src/features/episodes/EpisodesPage.tsx:591,623,1373` | approval UI | reads config |

Generalization can happen incrementally — adapter file gets created;
call sites migrate one at a time. Don't break EP01 in the process.

## What stays micro-drama-specific (forever)

These should live in `backend/src/microDrama/*` and never leak to the
base workflow:

- Episode Chain agent + cohesion scoring
- 4-beat (HOOK/SETUP/TWIST/CLIFFHANGER) structure logic
- Vertical 9:16 prompt composer specialization
- Curiosity-gap / cliffhanger-engine tracker

Same for any future prestige-only system (e.g. multi-camera coverage
plans, sequence-level storyboard generators) — put it in
`backend/src/prestige/*` and gate via `projectTypeConfig`.

## How to add a new project type

1. Add an enum value to `ProjectType` in `projectTypeConfig.ts`.
2. Add a `ProjectTypeConfig` entry to `PROJECT_TYPE_CONFIGS`.
3. If the type needs a unique pipeline (like episode chain), add a
   directory under `backend/src/<typename>/`.
4. Add a frontend label + creation path in the project-create UI.
5. Add an entry to `docs/PROJECT_TYPE_ADAPTERS.md`.
6. Add platform-wide acceptance test coverage in
   `docs/ACCEPTANCE_TESTS.md`.

No general workflow code should need to change.

---

## Redevelopment Mode is Prestige Series / Mini Series only

The Series Redevelopment workflow (see
`docs/GUIDED_PRODUCTION_WORKFLOW.md` → "Series Redevelopment Mode") is
exposed only on Prestige Series and Mini Series projects. The "Start
Redevelopment Pass" button in the project header gates on:

```ts
projectType === "prestige_series" || projectType === "mini_series"
  || (!projectType && (kind === "miniseries" || kind === "series" || kind === "pilot"))
```

Micro-drama redevelopment (revising the episode chain mid-development)
is a different shape — it should regenerate the 4-beat chain through
`microDrama.chain` rather than the six-stage architecture pass. That
flow already exists and lives in `backend/src/microDrama/`.

When adding a new project type, decide explicitly: does it use the
six-stage architecture redev (then add the type to the gate above), or
does it want its own redev model? Don't let the button drift onto a
type that doesn't have the underlying gate logic.
