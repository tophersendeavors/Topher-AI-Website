// Recommended Next Step engine. Inspects current project state and returns
// the single most-impactful action the writer can take right now.
//
// Order of inspection (first match wins — we never overwhelm with five
// banners; the OS is opinionated):
//   1. No characters       → add main characters
//   2. No treatment         → develop story foundation (Writers Room)
//   3. No season arc        → run Season Arc
//   4. Episodes unapproved  → approve episode titles
//   5. No relationships     → Generate Relationship Map
//   6. Speculative rels     → run Source-Strict
//   7. Unapproved relationships → review + approve
//   8. No pitch deck        → generate a Pitch Deck
//   9. Pitch incomplete     → fill missing source (audience, comps, creator)
//  10. Script not audited   → run the 95% audit on Draft 1
//  11. Title page missing   → set writer/creator credits
//  12. All clear            → ship-ready message

import { supabase } from "../db/client.js";
import { isMicroDramaProject } from "@toburt/shared";

export interface NextStep {
  title: string;
  body: string;
  ctaLabel: string;
  /** Internal route path under /projects/:id (e.g. "/character-bible"). */
  toRel: string;
  tone?: "primary" | "warning" | "info";
}

type Json = Record<string, unknown>;
const j = (v: unknown): Json => ((v ?? {}) as Json);

export async function recommendNextStep(projectId: string): Promise<NextStep> {
  // Read the project once up front so we can branch on projectType.
  // Legacy projects without metadata.projectType fall through to the
  // existing prestige-series workflow.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const projectMeta = j(projectRow?.metadata);
  const projectType = (projectMeta.projectType as string) ?? "prestige_series";

  // Config-driven branch — replaces `projectType === "micro_drama"` bare
  // string compare. `isMicroDramaProject` reads
  // shotPolicy.isMicroDramaTier on the resolved config.
  if (isMicroDramaProject(projectType)) {
    const microStep = await recommendNextStepMicroDrama(projectId, projectMeta);
    if (microStep) return microStep;
    // Fall through to the prestige branch's "all clear" tail if everything is
    // already in place (so the writer never sees an empty banner).
  }

  // --- Characters
  const { data: chars } = await supabase
    .from("characters")
    .select("id, name, role, biography, metadata")
    .eq("project_id", projectId);
  const cast = chars ?? [];
  if (cast.length === 0) {
    return {
      title: "Add your main characters",
      body: "Every downstream system (relationships, dialogue, pitch deck) reads from the Character Bible. Add 3–6 leads with a one-line bio each.",
      ctaLabel: "Open Character Bible",
      toRel: "/character-bible",
      tone: "primary",
    };
  }

  // --- Treatment / season arc — read latest workflow artifacts
  const { data: wfs } = await supabase
    .from("workflows")
    .select("id, episode_id")
    .eq("project_id", projectId);
  const projWf = (wfs ?? []).find((w) => !w.episode_id) ?? (wfs ?? [])[0];
  let hasTreatment = false;
  let hasSeasonArc = false;
  if (projWf) {
    const { data: art } = await supabase
      .from("workflow_stage_artifacts")
      .select("stage_id")
      .eq("workflow_id", projWf.id);
    const stages = new Set((art ?? []).map((a) => a.stage_id as string));
    hasTreatment = stages.has("treatment");
    hasSeasonArc = stages.has("season_arc");
  }
  if (!hasTreatment) {
    return {
      title: "Develop your story foundation",
      body: "The Treatment is the source the whole OS reads from — logline, synopsis, tone, world, themes, season engine.",
      ctaLabel: "Open Writers Room",
      toRel: "/writers-room",
      tone: "primary",
    };
  }
  if (!hasSeasonArc) {
    return {
      title: "Generate your Season Arc",
      body: "The season arc unlocks episode summaries, the pitch deck's arc slide, and the cross-episode context the scene agents use.",
      ctaLabel: "Open Writers Room",
      toRel: "/writers-room",
      tone: "primary",
    };
  }

  // --- Episodes / title approval
  const { data: eps } = await supabase
    .from("episodes")
    .select("id, number, title, title_status, logline")
    .eq("project_id", projectId);
  const episodes = eps ?? [];
  if (episodes.length === 0) {
    return {
      title: "Materialize your episodes",
      body: "We have the season arc but no episode rows yet. Generate episodes so you can name + develop each one.",
      ctaLabel: "Open Episodes",
      toRel: "/episodes",
      tone: "primary",
    };
  }
  const unapprovedTitles = episodes.filter((e) => (e.title_status as string) !== "approved");
  if (unapprovedTitles.length > 0) {
    return {
      title: `Approve episode titles (${unapprovedTitles.length} pending)`,
      body: "Until episode titles are approved, they show as 'Untitled' in exports, file names, and the pitch deck. AI can suggest titles — you approve.",
      ctaLabel: "Open Episodes",
      toRel: "/episodes",
      tone: "info",
    };
  }

  // --- Relationships
  const { data: rels } = await supabase
    .from("relationships")
    .select("id, metadata")
    .eq("project_id", projectId);
  const relRows = rels ?? [];
  if (relRows.length === 0) {
    return {
      title: "Generate your Relationship Map",
      body: "One click reads your treatment + character bible and drafts the core relationships with full dynamics. You review and approve.",
      ctaLabel: "Open Relationships",
      toRel: "/character-bible?tab=relationships",
      tone: "primary",
    };
  }
  // Detect speculative content (auditor flagged any field as speculative).
  let speculativeCount = 0;
  let unapprovedCount = 0;
  for (const r of relRows) {
    const f = (j(r.metadata).fields as Json) ?? {};
    if ((f.approvalStatus as string) !== "approved") unapprovedCount++;
    if (Array.isArray(f.lastStrictRemoved) && (f.lastStrictRemoved as unknown[]).length > 0) {
      speculativeCount++;
    }
  }
  if (speculativeCount > 0) {
    return {
      title: `${speculativeCount} relationship${speculativeCount === 1 ? "" : "s"} ${speculativeCount === 1 ? "contains" : "contain"} speculative details`,
      body: "Run Source-Strict Regenerate to remove invented specifics before approving. Source-strict mode reads only your approved bibles.",
      ctaLabel: "Open Relationships",
      toRel: "/character-bible?tab=relationships",
      tone: "warning",
    };
  }
  if (unapprovedCount > 0) {
    return {
      title: `Review + approve ${unapprovedCount} relationship draft${unapprovedCount === 1 ? "" : "s"}`,
      body: "The AI has drafted relationship dynamics. Read the buyer summary on each card, run Regenerate-with-notes if anything misses, then approve.",
      ctaLabel: "Open Relationships",
      toRel: "/character-bible?tab=relationships",
      tone: "info",
    };
  }

  // --- Pitch
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const pitchDecks = (() => {
    const meta = j(proj?.metadata);
    const p = j(meta.pitch);
    return Object.values((p.decks as Record<string, Json>) ?? {});
  })();
  if (pitchDecks.length === 0) {
    return {
      title: "Generate your Pitch Deck",
      body: "The OS can read your approved story + relationships and write a buyer-facing series deck. You review, edit, and approve each slide.",
      ctaLabel: "Open Pitch Materials",
      toRel: "/pitch?kind=series_pitch_deck",
      tone: "primary",
    };
  }
  // Check if any deck is in needs_review state.
  const deckNeedsReview = pitchDecks.find(
    (d) => (j(d).status as string) === "draft_generated" || (j(d).status as string) === "needs_review"
  );
  if (deckNeedsReview) {
    const kind = (j(deckNeedsReview).kind as string) ?? "series_pitch_deck";
    return {
      title: "Review your Pitch Deck",
      body: "Slides are drafted. Walk the deck, edit anything that misses, then mark Approved when it's buyer-ready.",
      ctaLabel: "Open Pitch Materials",
      toRel: `/pitch?kind=${kind}`,
      tone: "info",
    };
  }

  // --- Drafts
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, draft_number, current, metadata")
    .eq("project_id", projectId)
    .eq("current", true);
  if (!scripts || scripts.length === 0) {
    return {
      title: "Start your first draft",
      body: "Foundation, episodes, and relationships are in place. Time to write Draft 1 scene-by-scene.",
      ctaLabel: "Open Drafts",
      toRel: "/drafts",
      tone: "primary",
    };
  }

  // --- All clear
  return {
    title: "You're in good shape",
    body: "Foundation, relationships, and pitch are all moving forward. Keep refining scenes and run the 95% audit before final approval.",
    ctaLabel: "Open Project",
    toRel: "",
    tone: "info",
  };
}

// ---------------------------------------------------------------------------
// Micro Drama recommended next-step
// ---------------------------------------------------------------------------
// Vertical drama lives or dies by retention, not by long-form structure. So
// the workflow inverts: define the Hook, lock the Cliffhanger Engine,
// generate the per-episode chain (HOOK/SETUP/TWIST/CLIFFHANGER), then build
// the characters and finally generate the episode rows. Prestige and Mini
// Series workflows are untouched — this only fires when
// metadata.projectType === "micro_drama".
//
// Returns null when the micro-drama pipeline is fully primed (so the caller
// falls through to the shared "all clear" / pitch / draft tail).
async function recommendNextStepMicroDrama(
  projectId: string,
  projectMeta: Json
): Promise<NextStep | null> {
  const bible = j(projectMeta.microDramaBible);
  const hook = typeof bible.hook === "string" ? bible.hook.trim() : "";
  const cliff =
    typeof bible.cliffhangerEngine === "string"
      ? bible.cliffhangerEngine.trim()
      : "";

  // 1. Define Hook
  if (!hook) {
    return {
      title: "Define your Hook",
      body: "Vertical drama lives or dies in the first three seconds. Write the one-sentence concept that stops the scroll — this becomes the seed for every episode in the chain.",
      ctaLabel: "Open Micro Drama Bible",
      toRel: "",
      tone: "primary",
    };
  }

  // 2. Define Cliffhanger Engine
  if (!cliff) {
    return {
      title: "Define your Cliffhanger Engine",
      body: "What unresolved question forces the viewer to tap next? The Cliffhanger Engine is the spine the Episode Chain Generator builds against.",
      ctaLabel: "Open Micro Drama Bible",
      toRel: "",
      tone: "primary",
    };
  }

  // 3. Generate Episode Chain — episodes either don't exist yet, or none
  // have a microDrama planning block on them.
  const { data: eps } = await supabase
    .from("episodes")
    .select("id, number, metadata")
    .eq("project_id", projectId)
    .order("number");
  const episodes = eps ?? [];
  const haveChain = episodes.some((e) => {
    const md = j(j(e.metadata).microDrama);
    return (
      (typeof md.hook === "string" && md.hook.length > 0) ||
      (typeof md.cliffhanger === "string" && md.cliffhanger.length > 0)
    );
  });
  if (!haveChain) {
    return {
      title: "Generate your Episode Chain",
      body: "Turn the Micro Drama Bible into a complete HOOK / SETUP / TWIST / CLIFFHANGER plan across every episode in the season. Preview first — accept only when the Binge Score holds.",
      ctaLabel: "Open Micro Drama Bible",
      toRel: "",
      tone: "primary",
    };
  }

  // 4. Build Characters
  const { data: chars } = await supabase
    .from("characters")
    .select("id")
    .eq("project_id", projectId);
  if ((chars ?? []).length === 0) {
    return {
      title: "Build your characters",
      body: "The chain is locked. Add the principals who carry the reveals — the Character Reveal Tracker maps known / unknown / false-assumption per character.",
      ctaLabel: "Open Character Bible",
      toRel: "/character-bible",
      tone: "primary",
    };
  }

  // 5. Generate Episode rows (episodes table). If the chain was authored
  // before the rows were materialized, prompt the writer to create them.
  if (episodes.length === 0) {
    return {
      title: "Generate your episodes",
      body: "Materialize the episode rows so each chain entry has an editable card with its own Binge Score and Viral Test result.",
      ctaLabel: "Open Episodes",
      toRel: "/episodes",
      tone: "primary",
    };
  }

  // All micro-drama setup is in place — fall through.
  return null;
}
