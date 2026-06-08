# Acceptance Tests

Two test surfaces:
1. **Platform-wide** — the architecture supports every project type
   without hard-coded format assumptions.
2. **EP01 Micro Drama pilot** — the concrete end-to-end click-through
   on our current pilot.

Both must pass. Adding a new feature must not break either.

## 1. Platform-wide acceptance criteria

A creative can create any of the following and the Guided Production
Workflow adapts correctly:

| Project type | Kind | Required adaptations |
|---|---|---|
| `prestige_series` | `pilot` | 16:9 or 2.39:1 default, scene-level review depth, stricter approval gates, longer clip durations |
| `prestige_series` | `series` | Same as pilot + multi-episode arcs |
| `mini_series` | `miniseries` | 16:9 default, 8-episode container |
| `micro_drama` | `series` | 9:16 default, episode chain model, 3–5s clips |
| `prestige_series` | `feature` | One screenplay container, no episodes required |
| `prestige_series` | `short` | One screenplay, no episodes, looser strictness |

### Pass conditions

For every (type, kind) combo above:

- **PW-1**: Project creates successfully via the UI with the type/kind
  picker.
- **PW-2**: `resolveProjectTypeConfig()` returns a config (not throws).
- **PW-3**: The 12-stage workflow renders for every script in the
  project. Stage labels and gates respect
  `cfg.approvalStrictness`.
- **PW-4**: `cfg.defaultAspectRatio` is reflected in generated prompts.
- **PW-5**: Stage 1 approval reads from `cfg.scriptApprovalSource`
  (`micro_drama_approval` for micro, `draft_approval` for others) —
  never both checked simultaneously.
- **PW-6**: `RecommendedNextStep` dispatches to the correct branch via
  `cfg.recommendedNextStepBranch`.
- **PW-7**: No general workflow file (state.ts, preflight.ts, route
  files) contains a top-level
  `if (projectType === "micro_drama") { ... }` outside of an adapter
  call.

PW-7 is the structural integrity test. If it fails, the architecture
has regressed.

### How to verify PW-7

```bash
grep -rn 'projectType === "micro_drama"\|projectType !== "micro_drama"' \
  backend/src \
  --include="*.ts" \
  | grep -v "backend/src/microDrama/" \
  | grep -v "projectTypeConfig"
```

This grep should return ONLY hits inside an adapter call or inside
explicitly-named micro-drama files. Today it returns 26 hits in
general files — that's the generalization debt to pay down.

## 2. EP01 Micro Drama pilot — click-by-click test

This test uses the existing EP01 project (Maya's Bedroom). It does NOT
require a developer.

### Setup
- Logged in as `christophermaretich@gmail.com`.
- EP01 micro-drama project exists with an approved Draft 4 screenplay,
  bibles (locations, props, characters), and at least one round of
  generated prompts.

### Test steps

1. **Open Episodes page** for the EP01 project.
   - **Expected**: each episode card shows a "Production Workflow"
     button.
2. **Click Production Workflow on EP01**.
   - **Expected**: the URL routes to the workflow page; the page
     loads with 12 stages in the sidebar, top-down order: Script
     Approved → Assign Roles → Production Design → Art Direction →
     Props → Wardrobe/HMU → Blocking → Cinematography → Continuity →
     Prompt Supervisor → Preflight → Generate Clips.
   - Stage 1 (Script Approved) shows ✓ approved.
3. **Click Stage 2 Assign Roles**.
   - Set Production Designer = AI Generic.
   - Set Art Director = Live Person (yourself).
   - Set Propmaster = AI Creative Influence (pick "Photographic
     Naturalism").
   - Click **Confirm team**.
   - **Expected**: Stage 2 turns green; Stage 3 unlocks.
4. **Click Stage 3 Production Design**.
   - **Expected**: top-of-panel banner reads "Approving as canon —
     you're approving AI-proposed location identity, walls, floor,
     ceiling — these become locked canon."
   - The AI Proposal view auto-fires; within ~10s, proposals populate
     for each in-scope location field. A blue "Auto-propose" success
     banner appears.
   - Expand one row (e.g. MAYA'S BEDROOM — Wall color). Read the AI's
     proposal. Click **Approve as canon**.
   - **Expected**: Row turns green-tinted; badge changes from
     "Awaiting" to "✓ Approved". Below the row, the ImpactPreview
     panel shows "Approving this affects N shots across M scenes."
5. **Repeat for at least 6 of 7 fields** so the 80% gate flips.
   - **Expected**: Sidebar progress chip updates "5/7", "6/7", "7/7".
     At ≥6/7 the gate banner switches from amber to emerald-green and
     "Approve this stage" becomes clickable.
6. **Click Approve this stage**.
   - **Expected**: Stage 3 turns green; Stage 4 unlocks.
7. **Click Stage 4 Art Direction** (you're Live Person here).
   - **Expected**: top-of-panel banner reads "Approving as canon …".
     The Department Workspace embeds inline. The AI Proposal view is
     NOT shown (because you're Live Person).
8. **Click + Add image**.
   - Pick a bedroom photo from disk.
   - In the Canon Target Picker, pick **MAYA'S BEDROOM → Set Dressing
     → Comforter**.
   - **Expected**: The "✨ Extract canon text from image" button
     enables.
9. **Click ✨ Extract canon text from image**.
   - **Expected**: Spinner. Within ~10s, an info panel appears: "AI
     observed: …". The canon override textarea pre-fills with the
     suggested value.
10. **Edit the suggested text if needed**. Click **Save as candidate**.
    - In the candidate list, click **Approve** on the new
      contribution.
    - **Expected**: The canon source updates;
      `canonSources[locationBibles.<key>.setDressing.bedding.comforterColor]`
      gets a `textOverride` + reference to the uploaded image.
11. **Scroll to the Stale Prompts panel** at the top of the workflow
    page.
    - Click **Show what's stale**.
    - **Expected**: Each row reads "EP01 SC01 SH02 · Kling" (NOT
      "#0.2.kling"). Below each row, human reasons appear ("Text
      override on Comforter not surfaced in prompt").
12. **Click Regenerate affected shots**.
    - Confirm the dialog.
    - **Expected**: Progress indicator; success banner.
13. **Navigate to Stage 10 Prompt Supervisor** (skipping intermediate
    stages by clicking them in the sidebar).
    - **Expected**: AI Video Prompts panel embeds inline. Find the
      regenerated SC01 SH02 Kling prompt.
14. **Read the regenerated prompt**.
    - **Expected**: It now contains words from your approved
      comforter description (e.g. "deep charcoal heather"). It also
      lists your uploaded reference image in `referenceMetadata` /
      `canonReferences[]`.
15. **Navigate to Stage 11 Preflight**.
    - **Expected**: PreflightCard embeds inline. Status shows
      ready / partial / blocked with per-department breakdown.
16. **Navigate to Stage 12 Generate Clips**.
    - **Expected**: If Preflight is ready, the stage shows as
      `available`. If Preflight is not ready, the stage shows
      `locked` with a banner "Waiting on: Preflight" and a deep-link
      to fix.

### Fail conditions (any of these = bug)

- Any visible UUID, raw field path, table name, or jsonb path on
  screen.
- The Approve button looks "approved" before the user clicks it.
- Auto-propose doesn't fire on stage entry for AI roles.
- Vision Extraction shows raw `canonFieldPath` in any error message
  or label.
- Stale-prompt panel shows raw ordinals like "#0.2.kling".
- Regenerated prompt does NOT contain the approved canon words.
- Generate stage shows as unlocked while Preflight is failing.
- Clicking "Approve this stage" at 0/7 succeeds (gate broken).

## 3. Regression checks for future changes

Any PR that touches workflow code should:

- Run the EP01 click-through and confirm no regressions.
- Run the PW-7 grep and confirm no new hard-coded micro-drama checks
  leaked into general files.
- Bundle-check both backend (`esbuild backend/src/workflow/*.ts`) and
  frontend (`esbuild frontend/src/features/workflow/*.tsx`).
- Confirm no new raw UUIDs, paths, or routes were exposed in the UI.

## 4. Future acceptance tests (to add as features land)

- ImpactPreview embedded in the Live Person Department Workspace
  contribution form (parity with AI Proposal view).
- Generate-stage actual clip-generation trigger (when scope opens).
- Multi-user collaboration cursors.
- Sequence-level review depth for prestige.
- Real-time stale-prompt detection (today it's pull on page load).

---

## Series Redevelopment Mode — Phase 1 acceptance test

This test verifies the R1 + R2 floor on a Prestige Series / Mini Series
project. R3–R6 ship in later phases; their gates render as "Coming
next phase" placeholders in Phase 1.

1. **Setup.** Open or create a project with `projectType === "prestige_series"`
   or `"mini_series"` (or a legacy project of `kind` in `{miniseries, series, pilot}`
   with no projectType).
2. **Entry point.** On the Project Overview page, confirm the
   **Start Redevelopment Pass** button appears (with the Compass icon)
   next to the Load Protocol / Open Writers Room buttons. The button
   must NOT appear on Micro Drama projects.
3. **Start a pass.** Click Start Redevelopment Pass. A new pass is
   created and the user is navigated to
   `/projects/:projectId/redevelopment/:passId`.
4. **Stage rail.** R1–R6 are visible. R1 is "available", R2–R6 are
   "locked" until R1 is approved.
5. **R1 — Brief.** Fields are pre-filled with SELVAJE-style placeholder
   text. Edit the New Core Principle and New Season Question. Click
   **Save & Approve Brief**. The R1 chip changes to "Approved".
6. **R2 unlock.** R2 chip in the rail becomes "available". R3 also
   unlocks (R3's only dep is R1). R4–R6 remain locked.
7. **R2 — Character Bibles.** The SELVAJE starter cast (Margot, Dean,
   Nadia, Claire, Paul, Solano) is hydrated as placeholder rows with
   seed lines but blank proposed bibles. Each row says "Not yet generated".
8. **Generate one bible.** Expand the Margot row. Click
   **Generate against brief**. The ten fields populate. The row chip
   changes to "Proposed — not yet approved".
9. **Edit + approve.** Hand-edit one field. Click **Save edits**, then
   **Approve bible**. The row turns green with "Approved" + timestamp.
10. **Gate enforcement.** R4 chip remains locked — its sub-line reads
    "Locked — waiting on R2 · Character Bibles, R3 · Protocol Modules".
    R6 sub-line names all of R2, R3, R4, R5.
11. **No side effects.** The live `characters` rows for this project
    are unchanged. The existing pilot draft (if any) is unchanged.
    The 12-stage Production Workflow is unchanged.
12. **Reload.** Refresh the page. The pass, the approved brief, and the
    approved Margot bible all persist. New bibles can be generated for
    the other characters.

### Phase 2 / Phase 3 placeholders

- R3, R4, R5, R6 must render with a "Coming next phase" Compass card
  in Phase 1 so the workflow's shape is visible even when the back half
  isn't functional.
