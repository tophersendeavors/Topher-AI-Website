# CLAUDE.md — TOBURT Studios Source-of-Truth Index

> **Read this file and `docs/` BEFORE doing production-workflow work.**
> If a requirement is in chat but not in these docs, write it down here first.
> If chat conflicts with these docs, the docs win until the docs are updated.

## What TOBURT Studios is

A collaborative AI-native production studio. A screenplay becomes a guided
12-stage production workflow. After script approval, every creative role gets
assigned to **AI Generic**, **AI Creative Influence**, or **Live Person**.
Each department proposes or contributes canon. Approved canon flows into AI
video prompts and reference metadata. Non-technical creatives must be able to
drive the entire workflow without seeing IDs, paths, or raw routes.

## Project types — Micro Drama is the pilot, NOT the platform

TOBURT supports multiple project types and kinds. The workflow architecture
must remain general; format-specific behavior lives behind a
`projectTypeConfig` adapter.

| Field | Where stored | Values |
|---|---|---|
| `projects.kind` | column | `feature` · `pilot` · `miniseries` · `series` · `short` |
| `projects.metadata.projectType` | jsonb | `prestige_series` · `mini_series` · `micro_drama` |

Future Claude sessions: **never add new code paths that hard-code
`projectType === "micro_drama"` in places that should be general.** Wrap
format-specific behavior in `projectTypeConfig` (see
`docs/PROJECT_TYPE_ADAPTERS.md`).

## Source-of-truth docs

| Doc | Purpose |
|---|---|
| `docs/PRODUCT_VISION.md` | Why TOBURT exists, who it's for, scope |
| `docs/GUIDED_PRODUCTION_WORKFLOW.md` | The shared 12-stage workflow |
| `docs/DEPARTMENT_RESPONSIBILITIES.md` | Per-role deliverables + acceptance gates |
| `docs/UX_RULES.md` | How the product must behave for non-technical users |
| `docs/PROJECT_TYPE_ADAPTERS.md` | How the workflow adapts per project type/kind |
| `docs/ACCEPTANCE_TESTS.md` | Platform-wide + EP01 Micro Drama pilot tests |

Adjacent existing docs (keep, don't duplicate):

| Doc | Scope |
|---|---|
| `docs/ARCHITECTURE.md` | Backend/frontend topology, infra |
| `docs/AGENTS.md` | LLM agent registry + stage map |
| `docs/EMOTIONAL_INTELLIGENCE.md` | EI engine details |
| `docs/DEPLOYMENT.md` | Ops |
| `docs/MEMORY.md` | Project memory store |

## Operating rules for Claude in this repo

1. **Audit first, generalize, then implement.** When a feature spans more
   than one project type, look for existing micro-drama-specific code and
   refactor it behind `projectTypeConfig` before adding new branches.
2. **Never expose to normal users**: `projectId`, `episodeId`, `scriptId`,
   `canonFieldPath`, table names, jsonb paths, UUIDs, or raw route strings.
   The Canon Target Picker exists for this reason.
3. **Every backend feature must have a visible frontend path** — a button,
   link, panel, or banner. No "API exists but no UI" features ship.
4. **Every new route must have a navigation link or button** users can find
   without typing a URL.
5. **Every approved canon item must show Prompt Impact** so the user sees
   what shots will be affected before/after approval.
6. **Every stale prompt must explain WHY it's stale and HOW to update it.**
7. **Be the Feature Owner.** Don't ask the user to approve every obvious
   engineering step. Audit, plan, implement, test, report. Only ask when
   there's a genuine product or creative decision.
8. **Don't break the EP01 Micro Drama pilot** while generalizing. Both
   acceptance tests in `docs/ACCEPTANCE_TESTS.md` must keep passing.

## Where the workflow lives in code

| Surface | Path |
|---|---|
| Stage definitions + state machine | `backend/src/workflow/state.ts` (`STAGE_ORDER`, `STAGE_DEPS`, `ROLE_REGISTRY`) |
| Workflow types | `backend/src/workflow/types.ts` |
| Stage deliverables (per-stage canon + reviews) | `backend/src/workflow/state.ts` `deriveDeliverables()` |
| Workflow routes | `backend/src/routes/workflow.ts` |
| Workflow UI | `frontend/src/features/workflow/WorkflowPage.tsx` |
| Canon Target Picker | `frontend/src/features/workflow/CanonTargetPicker.tsx` · `backend/src/workflow/canonCatalog.ts` |
| Canon resolver | `backend/src/departments/canonResolver.ts` |
| Department contributions | `backend/src/departments/contributions.ts` |
| Prompt composer | `backend/src/draft/aiPrompts/` |
| Preflight | `backend/src/preflight/` |
| Vision Extraction | `backend/src/vision/extract.ts` |
| Prompt Impact Preview | `backend/src/workflow/promptImpact.ts` · `frontend/src/features/workflow/ImpactPreview.tsx` |
| Stale-prompt detection | `backend/src/workflow/stalePrompts.ts` |
| Micro-drama-specific adapter | `backend/src/microDrama/` · `backend/src/draft/recommendedStep.ts` (micro branch) |

## Where `projectTypeConfig` should live (proposal — not yet built)

- **Single file**: `packages/shared/src/projectTypeConfig.ts`
  - Exports `PROJECT_TYPE_CONFIGS: Record<ProjectType, ProjectTypeConfig>`
  - `ProjectTypeConfig` schema described in `docs/PROJECT_TYPE_ADAPTERS.md`
- **Backend usage**: imported by `state.ts`, `recommendedStep.ts`,
  `preflight.ts`, `entities.ts` screenplay paths
- **Frontend usage**: imported by `WorkflowPage.tsx`, project-create UI,
  `EpisodesPage.tsx`

Today, format-specific logic is inline `if (projectType === "micro_drama")`
checks in ~26 files. The generalization task is to lift those into the
adapter file and have call sites read `cfg.requiredStages`,
`cfg.approvalStrictness`, etc.

## Quick reference — micro-drama-specific (don't touch without adapter)

These remain micro-drama-only. Wrap behind `projectTypeConfig` when
generalizing:

| Surface | File |
|---|---|
| Episode Chain (hook · setup · twist · cliffhanger) | `backend/src/microDrama/episodeChainAgent.ts` |
| Screenplay generation (chain-grounded) | `backend/src/microDrama/screenplayAgent.ts` |
| `microDramaApproval`, `chainSnapshot` | `backend/src/routes/entities.ts` (screenplay), `scripts.metadata` |
| Vertical 9:16, 3–5s clip composer | `backend/src/microDrama/promptComposer.ts` |
| Recommended Next Step (micro branch) | `backend/src/draft/recommendedStep.ts` `recommendNextStepMicroDrama()` |
| Preflight gate on micro approval | `backend/src/preflight/preflight.ts:283–317` |
| Auto-satisfy Stage 1 from approval | `backend/src/workflow/state.ts:188–194` |

Anything not in the table above is either already general or should be made
general.
