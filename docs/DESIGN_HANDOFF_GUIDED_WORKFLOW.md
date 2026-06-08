# Design Handoff — Guided Production Workflow

> **For Claude Design.** This document explains the current state of
> TOBURT Studios' Guided Production Workflow surface so you can propose
> a visual redesign without breaking product logic.
>
> Read this **plus** these source-of-truth docs before proposing
> anything:
> - `CLAUDE.md`
> - `docs/PRODUCT_VISION.md`
> - `docs/GUIDED_PRODUCTION_WORKFLOW.md`
> - `docs/DEPARTMENT_RESPONSIBILITIES.md`
> - `docs/UX_RULES.md`
> - `docs/PROJECT_TYPE_ADAPTERS.md`
> - `docs/ACCEPTANCE_TESTS.md`

---

## 1. Product context

**TOBURT Studios** is a collaborative AI-native production studio.

The product turns a screenplay into a **12-stage Guided Production
Workflow**. After a script is approved, every creative role is assigned
to one of three states:

- **AI Generic** — the system proposes values; user approves.
- **AI Creative Influence** — same, styled by a preset (~16 neutral
  production-principle presets, never a living artist's name).
- **Live Person** — a human collaborator uploads references, picks
  canon targets, and approves contributions.

Each department contributes or approves **canon** (locked production
decisions: wall color, comforter, prop look, hair state, blocking, lens,
etc.). Approved canon flows into AI video prompts (Kling, Veo, Runway,
Midjourney, Luma, Pika) and reference metadata.

**Audience**: solo creators, indie writer-directors, small studios.
Non-technical creatives must be able to drive the entire workflow
without ever seeing a database path, ID, or raw route.

**Project types supported**:

| Field | Source | Values |
|---|---|---|
| `projects.kind` | column | `feature` · `pilot` · `miniseries` · `series` · `short` |
| `projects.metadata.projectType` | jsonb | `prestige_series` · `mini_series` · `micro_drama` |

**Micro Drama is the pilot format, NOT the platform**. The design must
also support Prestige Series, Mini Series, Feature, TV Pilot,
Miniseries, Series, and Short via the `projectTypeConfig` adapter (not
yet implemented; see `docs/PROJECT_TYPE_ADAPTERS.md`).

---

## 2. Screens / routes to redesign

| # | Screen | What it is |
|---|---|---|
| 1 | **Episodes page** | List of episodes inside a project. Each episode card has a **Production Workflow** button. |
| 2 | **Production Workflow page** | The main workflow surface. 12 stages in a left rail; current stage detail in the center. |
| 3 | **Stage 2 — Role Assignment** | Dedicated screen for assigning every creative role to AI Generic / AI Influence / Live Person. |
| 4 | **Stage 3 — Production Design** | Canon stage. AI proposes location identity, walls, floor, ceiling. User approves per deliverable. 80% gate. |
| 5 | **Stage 4 — Art Direction / Set Dressing** | Canon stage. Bedding, wall décor, clutter level. |
| 6 | **Stage 5 — Props** | Canon stage. Visual canon per hero prop. |
| 7 | **Stage 6 — Wardrobe / HMU** | Canon stage. Wardrobe top + hair condition per character per episode. |
| 8 | **Stage 7 — Blocking / Movement** | Canon stage. One comprehensive Director's brief per shot. |
| 9 | **Stage 8 — Cinematography** | Canon stage. One comprehensive DP brief per shot (aspect / framing / lens / position / movement / focus / lighting / out-of-frame). |
| 10 | **Stage 9 — Continuity** | Review stage. Script Supervisor's pass + manual findings. |
| 11 | **Stage 10 — Prompt Supervisor** | Review stage. Embeds the AI Video Prompts panel where each shot's video prompt is regenerated. |
| 12 | **Stage 11 — Preflight** | Review stage. 10-department readiness dashboard. |
| 13 | **Stage 12 — Generate (locked state)** | Final gate. Locked until Preflight is approved; embeds PreflightCard inline. |
| 14 | **Live Person Department Workspace / upload flow** | Embedded in any Stage 3–8 when role = Live Person. Upload image → pick canon target → ✨ extract canon text → save → approve. |

---

## 3. Current route paths

The URL bar contains IDs (that's how routing works) but **page content
must never expose IDs**. Designers can use friendly labels in the UI.

| Friendly description | Developer route |
|---|---|
| Episodes for a project | `/projects/:projectId/episodes` |
| Production Workflow for an episode | `/projects/:projectId/episodes/:episodeId/workflow` |
| Project's department workspace (standalone) | `/projects/:projectId/departments/:deptKey` |
| Character Bible | `/projects/:projectId/character-bible` |
| AI Video Prompts panel (standalone) | embedded only — appears inside Stage 10 |
| Preflight card (standalone) | embedded only — appears inside Stage 11 + locked Generate |

`projectId`, `episodeId`, `scriptId` are UUIDs. The workflow page
internally resolves `episodeId → current script` so the user never
sees the script UUID.

---

## 4. Current React components

All files in `frontend/src/`.

### Workflow surface
- `features/workflow/WorkflowPage.tsx` — top-level page; sidebar + center detail; breadcrumb + onboarding banner + stale-prompts panel + per-stage embed
- `features/workflow/AIProposalView.tsx` — per-stage AI proposal rows (Approve / Regenerate / Regenerate-with-notes / Reject / Inline Edit)
- `features/workflow/CanonTargetPicker.tsx` — cascading 4-step picker (Location → Category → Item → Field). Hides raw paths.
- `features/workflow/ImpactPreview.tsx` — "Approving this affects N shots across M scenes" with collapsible affected-shots list
- `features/workflow/AppliedCanonPanel.tsx` — diagnostic showing exactly what canon flows into a shot's prompt regen (Approved / Draft / Bible-only)
- `features/workflow/DPLocationConstraints.tsx` — per-location lighting + framing rules that flow into every DP brief regen for that location
- `features/workflow/ContinuityPanel.tsx` — Stage 9 panel with hero result + 6-category grid + findings + manual-finding form + override
- `features/workflow/ContinuityPanel.tsx` (sub) — `CoverageDisclosure`, `ManualFindingForm`, `IssueGroup`

### Live Person upload
- `features/departments/DepartmentWorkspacePage.tsx` — full Live Person workspace; embeds inside any Live-Person stage
- `features/departments/DepartmentWorkspacePage.tsx` (sub) — `ContributionForm` (upload → picker → vision extract → save)

### Stages 7 + 8 specifics
- `features/workflow/AIProposalView.tsx` `GroupedDeliverables` + `SceneGroup` — collapsible scene-grouped rows (SC01 → SH01 SH02 SH03; SC02 → …) for shot-level canon (Blocking, Cinematography)
- `features/workflow/AIProposalView.tsx` `DeliverableRow` — single deliverable row with the inline editor (Save as draft / Approve as canon / Cancel)

### Stage 10 — Prompt Supervisor
- `features/drafts/AIVideoPromptsPanel.tsx` — the full AI Video Prompts panel; embeds `AppliedCanonPanel` at the top of each shot

### Stage 11 — Preflight + Stage 12 locked Generate
- `features/preflight/PreflightCard.tsx` — the preflight dashboard. Renders `PreflightCardBody` + `DepartmentCard` + `DepartmentDetailsBody`. Already dark-themed.

### Shared
- `features/episodes/EpisodesPage.tsx` — per-project episode list
- `app/AppShell.tsx` — global app shell with collapsed sidebar
- `components/ui/Panel.tsx` — generic panel wrapper used everywhere
- `components/ui/Button.tsx` — button primitives

### Backend touchpoints (do not redesign — listed for context only)
- `backend/src/workflow/state.ts` — stage state machine
- `backend/src/workflow/canonCatalog.ts` — friendly-label catalog the picker reads
- `backend/src/departments/canonResolver.ts` — canon resolution
- `backend/src/draft/aiPrompts/engine.ts` — prompt composer + applyShotCanonOverrides

---

## 5. Current user problems

Documented from real user feedback during the build of these features:

1. **Still feels like an admin/dev dashboard.** The user described it
   as "a technical QA panel" even after the last polish pass.
2. **Too many boxes with equal weight.** Owner / Status / What unlocks
   next + canon recap + AI Proposal view + Impact preview all sit at
   the same visual level. Nothing reads as "this is the main thing."
3. **Too much small text.** Headers, labels, badges, and body text
   sit too close in size. The eye has nowhere to rest.
4. **Not enough premium cinematic hierarchy.** The sidebar phase
   groupings (Plan / Visual canon / Coverage / Delivery) help, but
   the center pane doesn't sing.
5. **Stage panels feel technical.** Continuity defaulted to "0
   passing / 0 warnings / 0 fails" before we rewrote it — the new copy
   helps but the visual still reads like a build log, not a department
   report.
6. **Upload flow feels like a form, not a guided workflow.**
   `ContributionForm` is four vertical sections stacked (title/body →
   picker → vision extract → save). The user can't tell which step
   they're in or what's next.
7. **Preflight + Prompt Supervisor still feel technical.** Both embed
   working dashboards but the framing around them ("Production
   Preflight" → grid of department cards) still reads as engineering
   output, not a creative report.
8. **Collaborators need clearer "what do I do next?"** Each stage
   panel has copy explaining what the user is approving, but the
   primary CTA (Approve as canon vs Save as draft vs Run pass)
   isn't visually obvious until you read.

The user explicitly said: *"It still feels like a technical/admin QA
panel. It still feels like a technical/admin QA panel."* — exact words.

---

## 6. Desired design direction

The product should feel like **premium cinematic production
software**. Specifically:

- **Calm, dark, elegant.** Existing dark theme is the right
  foundation; refine, don't replace. Tokens defined in
  `docs/UX_RULES.md` rule 12 (text-bone-100/300/400/500, bg-white/[0.03–0.06],
  ring-1 ring-white/10, sky/emerald/amber/red accents).
- **Not sci-fi gimmick.** No neon, no glow effects, no animated
  starfields. Reference: high-end editing software (DaVinci Resolve's
  dark UI), prestige Apple product pages, Linear, the calm of a film
  set's call sheet.
- **Not generic SaaS.** No "ProductHunt-style" rounded cards with
  brand-pastel gradients. This is a tool for filmmakers.
- **Clear production timeline.** The 12-stage left rail should read
  like a production schedule, not a checklist of buttons. Phase bands
  (Plan / Visual canon / Coverage / Delivery) already exist; lean in.
- **Clear department reports.** Each review stage (Continuity,
  Preflight, Prompt Supervisor) should read like a department's
  professional report (a continuity report, a preflight call sheet, a
  prompt-supervisor handoff), not a test panel.
- **Polished cards.** Cards should feel composed, not stacked.
  Consider: serif headlines (Panel already uses font-serif),
  small-caps eyebrows, generous internal padding, no double borders.
- **Better spacing.** Reduce label density; let primary content
  breathe. The sidebar is sticky at 280px — center column has room.
- **Strong hierarchy.** Each stage should have one hero element
  (the action area) + a status recap + a forward-look footer.
  Currently the eye doesn't know where to start.
- **Plain-language creative workflow.** Microcopy reflects how a
  film crew thinks: "Maya's Bedroom", "Director", "Prompt Supervisor",
  "Approve as canon", "Open Preflight" — never "deliverable",
  "canonFieldPath", "approvalProgress".

---

## 7. Design areas Claude Design should solve

For each of the following, deliver a visual + structural
recommendation.

### 7.1 Global page layout
- Current: `mx-auto max-w-7xl p-4 md:p-6` with a 280px sticky sidebar
  and a flexible right column. Breadcrumb + header + onboarding +
  stale-prompts panel above the workflow grid.
- Open questions: should the breadcrumb live inside the panel or as a
  ribbon? Where does the current project name + episode title belong?
  How should the global app shell (sidebar with All Projects / Plan /
  Write & Produce / Pitch / Export) relate to the workflow page?

### 7.2 Left workflow rail
- Current: 4 phase labels (PLAN / VISUAL CANON / COVERAGE / DELIVERY),
  each with stages. Active stage gets a sky-blue left accent rail. Approved
  stages dim. Locked stages fade.
- Open questions: should phases feel like film acts (numbered I / II / III / IV)?
  Should the rail show a vertical progress line? How should the
  per-stage approval chip (e.g. "5/7") be styled?

### 7.3 Stage detail cards
- Current vertical stack (top-down):
  1. Locked banner (if locked) — amber, with deep-link button to blocker
  2. "What you're approving" callout (sky-tinted, pinned)
  3. Owner / Status / What unlocks next — three mini cards
  4. Embed area (AI Proposal view OR Live Person workspace OR review panel)
  5. Status recap (Approved as canon / Awaiting your approval)
  6. Forward-look ("What happens when you approve" + "Next stage")
  7. Stage Gate Banner + Approve / Override / Request changes buttons
- Open questions: should the Owner card become a film-credit
  treatment ("DIRECTOR · Christopher M." in small caps)? Should
  "What you're approving" become a serif headline at the top of every
  stage?

### 7.4 Department report layout (Continuity, Preflight, Prompt Supervisor)
- Current Continuity panel structure (see section 6 user problem #5):
  - Hero result card (emerald / amber / red / muted)
  - 6-category grid showing Passed / Warning / Failed / Not checked yet
  - Findings list (failures, warnings, notes — collapsible groups)
  - Coverage disclosure ("what this catches / what it misses")
  - Manual-finding form
  - Forward-look footer
- Open questions: should the category grid be horizontal instead of a
  2×3 grid? Should each category be a small typographic block with a
  status dot, rather than a card? Should the findings list look like a
  PA's notes (datelined + signed)?

### 7.5 Role assignment screen (Stage 2)
- Current: grid of role rows (Director, Production Designer, Art
  Director, Set Decorator, Propmaster, Wardrobe, HMU, Cinematographer,
  Blocking, Prompt Supervisor, Quality Control). Each row has three
  toggle buttons (AI Generic / AI Influence / Live Person) + a status
  chip + an influence picker (when AI Influence) + a member picker
  (when Live Person).
- Open questions: should this read like a casting sheet? Should the
  role's "responsibility" line be more typographically prominent?
  Should the three assignment options use cards rather than toggle
  buttons?

### 7.6 Upload / reference wizard (Live Person Department Workspace)
- Current: single `ContributionForm` with file input → title/body
  textareas → CanonTargetPicker → optional Vision Extract button →
  ImpactPreview → Save button. Renders as ~7 vertical sections.
- Open questions: should this become a 3-step wizard (Upload → Tag →
  Extract & approve)? Should the picker live in a side panel? Should
  the AI's extracted canon text appear in a confirmation modal rather
  than inline?

### 7.7 Prompt Impact card
- Current: collapsible blue card. Shows "Approving this affects N
  shots across M scenes" + collapsed list of affected scenes/shots
  with per-shot match reasons. Hidden when no shots affected.
- Open questions: should this become a small ribbon at the top of the
  approval row? Could it visualize as a tiny timeline strip showing
  affected shots in red?

### 7.8 Preflight dashboard
- Current: Hero result card at top + grid of 10 department cards.
  Each card is color-tinted by status (emerald / amber / red / muted)
  and expandable to show field details, blocks, or a table.
- Open questions: should this be a single horizontal status strip
  with department names? Should each department open in a side drawer
  rather than expand inline? Should "blocking" departments float to
  the top?

### 7.9 Generate locked state
- Current: amber Locked banner ("Waiting on Preflight" + "Go to
  Preflight →" button). Below that, the full PreflightCard embeds
  inline with a header "Preflight readiness — what's blocking
  Generate". Below the embed: the standard Approve buttons (disabled
  when locked).
- Open questions: should the locked state feel like a *not-ready-for-
  release* poster or a *cleared-for-takeoff* checklist? Should the
  "Open Preflight" link become a primary CTA?

### 7.10 Empty / loading / error states
- Current empty states: "(no proposal yet — click Regenerate)",
  "(none approved yet)", "(no findings)", "(no activity yet)".
- Current loading: small Loader2 spinner + text.
- Current errors: red banner with the error message.
- Open questions: should empty states have illustrations? Should
  loading become a low-contrast skeleton?

---

## 8. Constraints

These are **non-negotiable**. The design proposal must respect them.

1. **Do not change product logic.** Don't propose moving the approval
   flow, the canon model, the 12-stage order, the role assignments,
   or the stage dependencies. Visual + structural redesign only.
2. **Do not remove existing functionality.** Every feature currently
   in the UI must remain accessible: Save as draft, Approve as canon,
   Override and approve anyway, Manual finding form, Coverage
   disclosure, Stale prompts panel, Applied Canon panel,
   DPLocationConstraints, etc. They can be reorganized but not deleted.
3. **Never expose raw identifiers.** `projectId`, `episodeId`,
   `scriptId`, UUIDs, `canonFieldPath`, table names, jsonb paths, raw
   API route strings — all forbidden in page content. (URL bar still
   contains IDs; that's fine.) See `docs/UX_RULES.md` rule 1.
4. **Design must support every project type.** Don't propose
   micro-drama-only treatments. Don't propose 9:16-only layouts. The
   workflow is the same 12 stages for Prestige Series, Mini Series,
   Micro Drama, Feature, TV Pilot, Miniseries, Series, Short. The
   `projectTypeConfig` adapter (proposed in
   `docs/PROJECT_TYPE_ADAPTERS.md`) handles format-specific behavior;
   the visual frame is shared.
5. **Micro Drama is the pilot, not the whole platform.** The user's
   pilot project ("THE TEXT AFTER MIDNIGHT") is a micro-drama. Don't
   theme the entire UI around vertical 9:16 phone-screen aesthetics.
6. **Honor every UX rule in `docs/UX_RULES.md`.** Specifically:
   top-down logical layout (rule 6), Canon Target Picker is the only
   way to reference a field (rule 7), visible loading + success + error
   (rule 9), friendly error messages (rule 10), transparent stage
   gates (rule 11), dark-theme tokens (rule 12), breadcrumbs (rule 14),
   no auto-rewrites (rule 15), microcopy reflects production reality
   (rule 16), no advanced-only critical features (rule 17), Generate
   gate must be explained (rule 18).
7. **Keep accessibility considerations.** Color must not be the only
   signal — every status uses an icon + text label too. Buttons must
   be focusable and keyboard-operable.
8. **Tailwind-first.** The codebase uses Tailwind utility classes
   throughout. Design specs should translate cleanly to Tailwind class
   strings; don't require new design tokens unless absolutely
   necessary. If new tokens are proposed, list them explicitly.

---

## 9. Ask Claude Design for

Return a single deliverable document (or set of documents) that
contains:

1. **Full visual redesign direction** — a written narrative
   describing the proposed look-and-feel, with two or three reference
   moodboard concepts (described in words, not images). Should answer:
   what does the workflow page feel like at a glance?
2. **Component structure** — for each of the 10 design areas in
   section 7, propose the component breakdown. Use the existing React
   file names as anchors. Note which components stay, which should be
   split, which should be merged.
3. **Layout recommendations** — Tailwind grid / flex / spacing
   specifics for each area. Include sticky behavior, responsive
   breakpoints, and how the layout adapts to a 13" laptop (the user's
   working size).
4. **Typography / color / spacing guidance** — typeface choices
   (serif for headlines? mono for codes?), font-size scale (suggest
   a tight 4-step scale), color palette refinements within the
   existing dark-theme tokens, spacing rhythm (4 / 8 / 16 / 24 / 40 px).
5. **Tailwind-ready implementation notes** — for each redesigned
   element, provide the actual Tailwind class string (or a recipe).
   Example: "Stage hero callout: `rounded-lg border border-sky-700/30
   bg-sky-900/15 px-5 py-4 space-y-1.5`".
6. **Before / after UX recommendations** — for each user problem in
   section 5, what specifically the proposal solves and how.
7. **Specific instructions Claude Code can implement** — a numbered
   build order Claude Code can follow without further design back-and-
   forth. Example: "1. Update `WorkflowPage.tsx` header to use…
   2. Replace the StageDetail Owner / Status / Unlocks cards with…"

---

## Screenshots to attach

Attach these screenshots when handing the package to Claude Design:

- [ ] **Episodes page** — `/projects/:projectId/episodes` with the
      Production Workflow button visible on EP01.
- [ ] **Production Workflow main page** — opening view, full sidebar +
      stage detail visible, breadcrumb at the top.
- [ ] **Stage 2 Role Assignment** — full role grid with at least one of
      each assignment type (AI Generic / AI Influence with picker open /
      Live Person with member picker open).
- [ ] **Stage 4 Art Direction** — canon stage with AI Proposal view
      partially populated (some Approved, some Awaiting, gate banner
      visible).
- [ ] **Stage 8 Cinematography** — DP brief stage with scene group
      headers (SC01 / SC02 …) visible + at least one DP brief row
      expanded showing the full structured brief.
- [ ] **Stage 9 Continuity** — current professional report (hero result
      card + 6-category grid + manual finding form). Include states:
      pre-run, clean, and with-blockers.
- [ ] **Stage 10 Prompt Supervisor** — AI Video Prompts panel with
      AppliedCanonPanel open at the top + a shot detail visible.
- [ ] **Stage 11 Preflight** — full dashboard with hero card + all 10
      department cards, at least one expanded.
- [ ] **Stage 12 Generate (locked state)** — locked banner + embedded
      PreflightCard showing what's blocking.
- [ ] **Live Person upload / reference form** — `ContributionForm` open
      with file selected, picker populated, Vision Extract result
      visible, ImpactPreview visible.

If possible also attach:
- [ ] **Approved canon row in green-tinted state** — to show the
      success treatment.
- [ ] **Stale Prompts panel** open at the top of the workflow page.
- [ ] **Sidebar approved/locked/active states** — close-up of the
      left rail.

---

## Notes for Claude Design's process

- The user (`christophermaretich@gmail.com`) is non-technical and
  prioritizes clarity over cleverness. When in doubt, choose
  legibility.
- The current build is functional. Every feature mentioned in this
  doc actually exists and works. Bundles are clean; backend is alive.
  Your job is purely visual + structural.
- The user has explicitly said the product feels "like a developer
  panel." That's the feeling to remove.
- When ready to hand back to Claude Code, package the recommendation
  as a numbered build order with concrete Tailwind class strings and
  component changes. Avoid open questions in the final deliverable —
  make a decision and explain the trade-off.

---

**End of handoff.** When you (Claude Design) have read this + the
attached screenshots + the source-of-truth docs, propose the
redesign.
