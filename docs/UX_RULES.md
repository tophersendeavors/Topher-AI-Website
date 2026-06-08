# UX Rules

These are the product behavior rules every page, panel, and dialog must
follow. They are not style suggestions. Code that violates them is a
bug.

## 1. Never expose technical identifiers

The user must never see:
- `projectId`, `episodeId`, `scriptId`
- raw UUIDs
- `canonFieldPath` (e.g. `locationBibles.INT_MAYA_BEDROOM_NIGHT.architecture.wallColor`)
- table names (`script_scenes`, `department_contributions`)
- jsonb paths
- raw API route strings (e.g. `/scripts/.../workflow/deliverables/approve`)

**Replace with:**
- Friendly labels via the Canon Target Picker
  (`frontend/src/features/workflow/CanonTargetPicker.tsx`).
- Episode + scene + shot labels: `EP01 SC02 SH04` instead of raw ords.
- Model display names: `Kling`, `Veo`, `Runway` (see `MODEL_DISPLAY`
  in `backend/src/workflow/stalePrompts.ts`).
- Owner names from `profiles.name` / `profiles.email`, not user UUIDs.

**Exception:** the URL bar will still contain IDs (that's how routing
works). The page CONTENT must not.

## 2. Every backend feature must have a visible frontend path

If a route exists but no button/link/panel in the UI references it,
it doesn't count as shipped. Build the entry point or delete the route.

## 3. Every new route must have a navigation link or button

Users should not need to type a URL or be told "go to
`/projects/<UUID>/workflow`". Add a nav button somewhere discoverable.

## 4. Every approved canon item must show Prompt Impact

Wherever a user approves a canon value (AI Proposal view OR Live Person
upload), the page must show an `ImpactPreview` widget for the canon
field. The widget answers: which scenes/shots does this affect, what
parts of the prompt change (text vs reference metadata vs both), and
whether existing prompts will go stale.

## 5. Every stale prompt must explain WHY and HOW to update

Stale prompt entries must show:
- A friendly label (`EP01 SC02 SH04 · Kling`), not raw ordinals.
- One or more human reasons (e.g. "New approved reference for Wall Color
  not attached", "Text override on Bed Design not surfaced in prompt").
- A one-click "Regenerate affected shots" action.

## 6. Top-down logical layout in stage panels

Every workflow stage detail panel renders, top to bottom:
1. **What you're approving** callout (blue, pinned at top).
2. **Owner / Status / What unlocks next** cards.
3. **Embed area** — AI Proposal view, Live Person Department Workspace,
   review summary, or sub-tool (AI Video Prompts, Preflight).
4. **Status recap** — Already approved / Still needed (canon stages
   only).
5. **Approve this stage / Request changes** at the bottom.

The actionable controls always appear above the recap; the user lands
on the work, not on a summary.

## 7. Canon Target Picker is the ONLY way to reference a canon field

Never let the user type a `canonFieldPath`. The picker must be present
wherever a canon field needs to be chosen (upload contribution, vision
extraction setup, direct canon edit). Field paths are derived from the
picker's selection server-side.

## 8. Auto-propose where possible

When an AI-role stage opens with empty deliverables, the page should
auto-fire the LLM and pre-populate proposals. The user arrives at
"ready to Approve" rather than "click Regenerate first." Costs are
amortized by caching proposals on `script.metadata.workflowAIProposals`
keyed by canon field path.

## 9. Visible loading + success + error states

Every async action (Approve, Regenerate, Extract, Auto-propose, Save)
must show:
- A spinner while pending.
- A green checkmark or color change on success.
- A red banner with the error message on failure.

No silent state changes. The current Approve button's transition from
"Awaiting" to "✓ Approved" + green-tinted row background is the
reference pattern.

## 10. Friendly error messages

Backend errors that bubble to the UI must read like sentences a
creative would understand. "Stage gate not met: 5/7 deliverables
approved as canon — need 80%" is good. "FST_ERR_400" is not.

## 11. Stage advance gates must be transparent

If the user can't advance a stage, show:
- The exact threshold required ("need 80%").
- Current progress ("5/7 deliverables approved as canon (71%)").
- A progress bar.
- What they need to do next.

## 12. Dark theme tokens (visual consistency)

This product uses a dark theme. Use the existing tokens:
- Text: `text-bone-100`, `text-bone-300`, `text-bone-400`, `text-bone-500`
- Backgrounds: `bg-white/[0.03]`, `bg-white/[0.06]`, `bg-black/30`
- Borders: `ring-1 ring-white/10`, `border-white/8`
- Accent: sky-700 for info, emerald-700 for success, amber-700 for
  warning, red-700 for error
- Approved canon row: green-tinted (`bg-emerald-900/10
  border-emerald-700/30`)
- Stage gate warning: amber-tinted (`bg-amber-900/15
  border-amber-700/30`)

No white cards on dark backgrounds. No emojis unless the user
explicitly asked for them.

## 13. Onboarding banners are dismissible + remembered

First-run banners use `localStorage` keys like
`toburt:workflow:onboarding:dismissed`. Once dismissed, they stay
dismissed across sessions.

## 14. Breadcrumbs on every workflow page

Workflow pages render a breadcrumb (`Episodes › EP01 — title › Stage
4 Art Direction`) so the user can see where they are and how to get
back.

## 15. Don't auto-rewrite the user's work

- Approving canon does NOT silently rewrite the screenplay.
- Approving canon does NOT auto-regenerate prompts.
- Approving canon DOES mark affected prompts stale and offer a
  one-click regenerate.
- "Reject" on a deliverable clears the user's approval but does NOT
  delete the underlying bible value.

## 16. Microcopy that reflects production reality

Labels should match how a film crew thinks, not how the database is
structured:
- "MAYA'S BEDROOM" not `INT_MAYA_BEDROOM_NIGHT`.
- "Comforter color + material" not `setDressing.bedding.comforterColor`.
- "Director" not `role_blocking`.
- "Prompt Supervisor" not "ai_video_prompt_engineer".

## 17. Don't ship features only Advanced users can find

If a feature is critical to the journey (Vision Extract, Impact
Preview, Stale-prompt regen), it must be visible by default — not
behind a `simpleAdvancedMode` toggle. Advanced mode is for power tools
(raw paths visible, model picker exposed, etc.), not core flow.

## 18. Generate stage is gated, not blocked-with-no-explanation

When Stage 12 is locked because Preflight failed, show the user
exactly what Preflight is unhappy about and a deep-link to fix it.
Locking a stage without explanation is a UX bug.
