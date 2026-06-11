# TOBURT Studios — BRAIN

> Canonical, current-state snapshot for the Toburt OS brain. Keep it accurate and
> concise. Update it whenever a meaningful change, decision, or blocker happens.

_Last updated: 2026-06-11_

## What this is

A collaborative, AI-native production studio. A screenplay becomes a guided
12-stage production workflow. After script approval, every creative role is
assigned to **AI Generic**, **AI Creative Influence**, or **Live Person**. The
product must be drivable by non-technical creatives — no IDs, paths, or routes
exposed. Micro Drama (EP01) is the **pilot format**, not the platform; the
workflow stays general behind a `projectTypeConfig` adapter.

Stack: Fastify + TypeScript backend, React + TypeScript (Vite) frontend, Supabase
(auth + Postgres + jsonb metadata). Shared types in `packages/shared`.

## Status

Active build. The immersive **Writers Room** is live and committed. **Phase 2 —
Writer/Talent Directory + Live Co-Writer wiring — is built and the DB migration is
applied; it is awaiting smoke-test + commit.**

## Key decisions — LOCKED

- **Writers Room model — two separate systems.** The table is the **writing team**
  only: **AI Writer** (automated studio writer; project foundation + Creative DNA),
  **AI Creative** (industry-inspired archetype lens, never an impersonation),
  **Live Co-Writer** (real human). The **quality/script-improvement agents**
  (Character Architect, Continuity Director, etc.) are NOT seats — they live on the
  **Review Bench** and activate along the pipeline.
- **Seats are anchored to the room plate**, not the viewport — an aspect-locked
  "stage" (PLATE 2200×1242) so seat percentages map to fixed points on the image at
  any window size. A `?debug` overlay tunes coordinates.
- **Talent Directory is account-level + reusable.** Table `public.talent_profiles`
  (owner-scoped, RLS). A Live Co-Writer seat references a profile by id, so a person
  added once is reusable across every project (no inline-only records).
- **Studio identity must stay tiny in `user_metadata`** (it rides in the JWT —
  large data caused an HTTP 431 outage). Avatars live in `profiles.avatar_url`.
- **Never hard-code `projectType === "micro_drama"`** in general code paths; wrap
  format-specific behavior behind `projectTypeConfig`.
- **Every backend feature ships with a findable frontend entrance** (no API-only
  features); approved canon must show Prompt Impact.

## Open decisions / not yet built

- **Real invite-email delivery** — Live Co-Writer invite *status* flips to
  "invited", but no email is actually sent yet.
- **Writing-mode flow** (Step 1/2 of the spec: upload script / write manually /
  start-from-concept) — not built.
- **Pipeline orchestration** — flipping Review Bench staff pending→active as passes
  run, plus the handoff package to the Creative Room — not built.
- **Phase-2 talent**: profile photo upload (currently a URL field); credits/bio are
  captured manually until the invite-accept flow exists.

## Current blockers

None active. (Resolved: Supabase migration-history drift — `0010`–`0013` existed on
remote but were unrecorded; repaired, then `0014_talent_directory.sql` applied.)

## Next 1–3 moves

1. Smoke-test `/studio/talent` + the Writers Room Live Co-Writer tab, then **commit
   Phase 2** (migration + shared types + backend + directory page + wiring).
2. Build the **writing-mode flow** (how the lead writer begins: upload / manual /
   AI-generate / build-with-co-writers).
3. **Pipeline orchestration**: drive the existing redevelopment passes + Human Read
   from the room, activating Review Bench staff, and produce the Creative Room
   handoff.

## Who's involved

- **Christopher** — solo founder; showrunner / lead writer; product owner.
- **Claude (Claude Code)** — implementation.

## Where things live (code)

- Writers Room UI: `frontend/src/features/writers-room/WritersRoomPage.tsx`
- Writers Room API: `backend/src/routes/writersRoom.ts`, `backend/src/writersRoom/`
- Talent Directory UI: `frontend/src/features/studio/StudioTalentPage.tsx` (`/studio/talent`)
- Talent API: `backend/src/routes/talent.ts`, `backend/src/talent/`
- Migration: `supabase/migrations/0014_talent_directory.sql`
- Source-of-truth docs: `CLAUDE.md` + `docs/`
