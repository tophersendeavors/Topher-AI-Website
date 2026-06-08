# Department Responsibilities

Canonical role registry: `ROLE_REGISTRY` in
`backend/src/workflow/state.ts`. Each role has a `label`,
`responsibility`, and `departmentKey`. This doc expands each role with:
**Decides** · **Required deliverables** · **Approval gate** · **Where
the values live in the data model**.

## Stage 1 — Script Approved · Owner: Writer / Showrunner

**Decides:** that the screenplay is locked as the production
source-of-truth. For micro-drama this means
`scripts.metadata.microDramaApproval.status === "approved"` AND
`chainSnapshot` populated. For other formats this means a draft has
been explicitly approved via the screenplay-approval flow.

**Deliverables:**
- Screenplay approved by writer.
- Story spine present (hook · setup · twist · cliffhanger for
  micro-drama; treatment + outline for longer formats).

**Gate:** milestone — no per-row canon approval.

**Data model:**
- `scripts.metadata.microDramaApproval` (micro-drama)
- `scripts.metadata.draftApproval` (other formats — to be generalized via
  `projectTypeConfig.approvalGate`)
- `scripts.metadata.chainSnapshot` (micro-drama)

## Stage 2 — Assign Roles · Owner: Showrunner / Producer

**Decides:** who plays each creative role for this episode/script.

**Deliverables:** one assignment per role in
`scripts.metadata.episodeWorkflow.roleAssignments`. Each is one of:
- `ai_generic`
- `ai_influence` with an `influenceKey` selected
- `live_person` with a project member `assigneeUserId`

**Gate:** every role must be assigned (or default `ai_generic`) before
the user can click "Confirm team — unlock Production Design".

**Data model:** `scripts.metadata.episodeWorkflow.roleAssignments`.

## Lane discipline (enforced in regen prompts for Stages 3-8)

Every role-specialized regen system prompt (`buildSingleFieldRolePrompt`
in `backend/src/workflow/deliverables.ts`, plus the DP / Director
specializations) explicitly forbids drift into other departments:

| Role | Lane | Out-of-lane (forbidden) |
|---|---|---|
| Production Designer | architecture only — walls, floor, ceiling, base palette | furniture, bedding, décor, props, camera, wardrobe, blocking |
| Art Director | set dressing only — bedding, wall décor, clutter, decorative items | architecture, hero props, camera, wardrobe, blocking |
| Propmaster | hero prop visual canon only | architecture, set dressing, camera, wardrobe, prop handling (Director) |
| Wardrobe | character clothing only | hair, makeup, set dressing, camera, blocking |
| HMU | character hair + makeup only | clothing, set dressing, camera, blocking |
| Director (Stage 7) | choreography only — blocking, eyeline, prop handling, performance beats | camera, lens, lighting, set, wardrobe |
| DP (Stage 8) | cinematography only — aspect, framing, lens, position, motion, focus, lighting, out-of-frame | set dressing, wardrobe, performance, production design |

This is the platform's structural integrity guarantee: when the AI
proposes a value for a role, it can only propose decisions that role
actually makes in a real production.

## Stage 3 — Production Design · Owner: Production Designer · Department: `production_design`

**Decides:** what kind of room/space this is, base color of the walls,
floor + material, ceiling treatment. Sets the visual world for every
downstream stage.

**Deliverables (per in-scope location):**
- Location identity (e.g. "a small, lived-in studio bedroom, late
  millennial").
- Wall color.
- Floor color + material.
- Ceiling treatment.

**Gate:** **canon · 80%** of location deliverables must have
`hasApprovedCanon` (textOverride) before stage advance.

**Data model:**
- Source bibles: `projects.metadata.locationBibles[<key>].architecture.*`
- Approved canon: `projects.metadata.canonSources[locationBibles.<key>.architecture.<field>].textOverride`

## Stage 4 — Art Direction / Set Dressing · Owner: Art Director / Set Decorator · Department: `art_dept`

**Decides:** what dressed items appear in-frame and in what condition.

**Deliverables (per in-scope location):**
- Comforter color + material.
- Sheets color.
- Pillows count, color, condition.
- Wall décor rule (wall art / mirrors / shelves).
- Clutter level (minimal / lived-in / cluttered).

**Gate:** canon · 80%.

**Data model:** `projects.metadata.locationBibles[<key>].setDressing.*`,
canon override at the same path.

## Stage 5 — Props · Owner: Propmaster · Department: `props`

**Decides:** how each hero prop must look across every shot, plus
handling rules.

**Deliverables (per in-scope prop):**
- Visual canon (look across every shot, materials, wear).

**Gate:** canon · 80%.

**Data model:** `projects.metadata.propBibles[<key>].visualDetails`,
plus `handledBy`, `episodesPresent`, `doNotChange[]`.

## Stage 6 — Wardrobe / Hair / Makeup · Owner: Wardrobe + HMU heads · Department: `wardrobe_hmu`

**Decides:** what each character wears and what their hair state is, per
episode.

**Deliverables (per character, per episode that has them):**
- Wardrobe top (primary garment).
- Hair state.

**Gate:** canon · 80%.

**Data model:**
- `characters.metadata.visualBible.wardrobeByEpisode[<ep>].top`
- `characters.metadata.visualBible.hmuByEpisode[<ep>].hairCondition`

The workflow filters wardrobe/HMU deliverables to the current episode
number (resolved from `scripts.episode_id`).

## Stage 7 — Blocking / Movement · Owner: Director · Department: `blocking`

**Decides:** per shot, the Director's complete blocking brief —
choreography only, no camera/lens/lighting decisions (those are DP).

**Deliverable (one per shot):**
A single comprehensive Director's blocking brief covering:
- Start position (per character)
- End position (per character)
- Movement path (start → end; pace + emotional beat)
- Eyeline target (where each character looks and at what beat)
- Prop handling (what each character touches/handles, how, when)
- Performance beat (the one emotional turn this shot must land)

The AI uses a Director-specialized prompt that explicitly stays in the
Director's lane (no camera/lens/lighting/set/wardrobe). The Director
approves, regenerates, or regenerates with notes per shot.

**Gate:** **canon · 80%** of shots must have `hasApprovedCanon` before
stage advance.

**Data model:**
- Canon path: `projects.metadata.canonSources[shotBriefs.<sceneOrd>.<shotIndex>.directorBrief].textOverride`
- Seeded from existing brief fields (`characterStartPosition`, `characterEndPosition`, `movementPath`, `eyelineTarget`, `propPositions`).
- The composer (`engine.ts` `applyShotCanonOverrides`) patches the brief with the approved `directorBrief` and injects it verbatim into the prompt as `[DIRECTOR'S BLOCKING BRIEF — APPROVED CANON, OBEY VERBATIM]`.

## Stage 8 — Cinematography · Owner: DP / Cinematographer · Department: `cinematography`

**Decides:** per shot, the DP's complete brief — every cinematography
decision, no production design / wardrobe / performance.

**Deliverable (one per shot):**
A single comprehensive DP brief covering:
- Aspect ratio / format
- Framing (shot size + composition)
- Lens (focal length + character of the lens)
- Camera position & angle (exact spatial position + height + angle relative to subject)
- Camera movement (locked-off, push-in, dolly, handheld, etc. + intent)
- Focus priority (what is sharp vs soft; depth-of-field strategy; rack-focus)
- Lighting — source (motivated practical / natural / off-screen)
- Lighting — direction & quality (key direction, fill, contrast ratio, hardness/softness)
- Out-of-frame (what must NOT appear in the composition)

The AI uses a DP-specialized prompt that explicitly stays in the DP's
lane (no production design / wardrobe / performance / set dressing).

**Gate:** **canon · 80%**.

**Data model:**
- Canon path: `projects.metadata.canonSources[shotBriefs.<sceneOrd>.<shotIndex>.dpBrief].textOverride`
- Seeded from existing brief fields (`aspectRatio`, `frame`/`cameraFraming`, `lensSuggestion`, `cameraViewZone`, `cameraMovement`, `lightingContinuity`, `forbiddenSetElements`).
- The composer injects the approved `dpBrief` verbatim into the prompt as `[DP BRIEF — APPROVED CANON, OBEY VERBATIM]`.

**Lane-keeping rules** (enforced via the regen system prompt):
- Director regen does NOT propose camera, lens, lighting, set, or wardrobe.
- DP regen does NOT propose performance, character emotion, set dressing, or wardrobe.

## Stage 9 — Continuity · Owner: Script Supervisor · Department: `script_supervisor`

**Decides:** review-stage. Confirms the continuity pass returned zero
failures. Continuity engine: `backend/src/continuity/`.

**Deliverables:**
- "Continuity pass — 0 failures" — derived from
  `scripts.metadata.continuity.summary`.

**Gate:** review.

## Stage 10 — Prompt Supervisor · Owner: Prompt Supervisor · Department: `prompt_supervisor`

**Decides:** translates approved department work into model-ready
prompts. The actual generation is automated; this stage is the human
verify pass.

**Deliverables:**
- "Prompts generated for every brief" — counts ready prompts vs total.

**Embeds:** the AI Video Prompts panel (`AIVideoPromptsPanel`) inline
so the user can inspect every prompt without leaving the workflow.

**Gate:** review.

## Stage 11 — Preflight · Owner: Quality Control · Department: `quality_gate`

**Decides:** review-stage. Aggregates 10-department readiness into one
status: ready / partial / blocked. The blocker is the worst non-stage-2
department.

**Deliverables:**
- "Preflight overall: ready" — from `runPreflight(scriptId)`.

**Embeds:** `PreflightCard` inline.

**Gate:** review. If Preflight reports not ready, the user fixes the
flagged department and re-runs. Generate stays locked.

## Stage 12 — Generate · Owner: Production

**Decides:** milestone — clip generation is unlocked. The gate is hard
(`STAGE_DEPS.generate = ["preflight"]`). Today the Approve click marks
the workflow complete; actual clip-generation triggers are out of
current scope.

**Deliverables:**
- "All gates pass — clip generation allowed" — computed live.

## Cross-cutting: Creative Influences

When a role is set to `ai_influence`, the user picks one of ~16 neutral
production-principle presets (see
`backend/src/workflow/creativeInfluences.ts`). Presets are written as
production rules (e.g. "Use restrained emotional staging — actors land
on stillness rather than gesture"). **They never name a living artist
or copy a personal style.** The chosen preset's principles get appended
to every LLM proposal call for that role.

## Cross-cutting: Department Workspace (Live Person)

When a role is set to `live_person`, the user gets the Department
Workspace UI (`frontend/src/features/departments/DepartmentWorkspacePage.tsx`)
embedded inside the stage. They can:
- Add an image / URL / note / color / material / moodboard.
- Tag the contribution with a Canon Target (via the picker).
- Run Vision Extraction on uploaded images (✨ Extract canon text).
- Approve the contribution — which writes to `canonSources`.

Approved contributions attach as `references[]` to the field's
`CanonSourceEntry`. If `links.canonOverrideText` is set, they also
populate the `textOverride`, which becomes the locked prompt text.

---

## Redevelopment Mode roles (Series Redevelopment)

The Series Redevelopment workflow does NOT use the standard 12-stage
department registry. It's owned by the **Showrunner** and the
**Series LLM** working as one head — there are no Live Person /
AI Influence / AI Generic role splits in the redev pass itself.

| Stage | Responsibility |
|---|---|
| R1 — Brief | Showrunner writes; LLM never auto-fills |
| R2 — Character Bibles | LLM generates per-character; Showrunner edits + approves per-row |
| R3 — Protocol Modules | LLM generates; Showrunner edits + approves per-module (Phase 2) |
| R4 — Season Arc | LLM generates 8 episodes; Showrunner edits + approves whole arc (Phase 2) |
| R5 — Pilot Strategy | LLM proposes; Showrunner approves (Phase 3) |
| R6 — Pilot Rewrite | LLM drafts; Showrunner reviews diff against prior draft; approves promotion (Phase 3) |

When a pass is **Promoted** (Phase 3), only then do the standard
departments come back into play — they're responsible for propagating
the redev decisions into their respective canon: Cast Bible → revised
character bibles, Continuity → check eyelines + props against the new
Protocol modules, Prompt Supervisor → flag every video prompt whose
canon dependencies changed.
