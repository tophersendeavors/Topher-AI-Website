// Wayfinder resolver — returns the single most-impactful next step given
// current project + (optional) episode state.
//
// Ordering (first-match wins):
//   1. Development-phase steps (delegated to recommendNextStep — characters,
//      treatment, season arc, episodes, relationships, pitch, draft 1).
//   2. Production-phase ladder, episode-scoped:
//        a. No current draft for this episode
//        b. Draft is locked? if not, suggest lock-or-approve
//        c. Sound Bible missing
//        d. Sound Bible unapproved
//        e. Shot List empty
//        f. Shots unapproved
//        g. AI Video Prompts missing (composedPrompt absent on briefs)
//        h. Generation Queue empty / unsynced
//        i. Queue items not ready (model not assigned)
//        j. Outputs need review
//        k. Trailer not generated
//        l. Exports ready (complete)
//
// Reads from supabase only. Writes nothing. Never mutates fountain or
// script_scenes.

import { supabase } from "../db/client.js";
import { recommendNextStep, type NextStep } from "../draft/recommendedStep.js";
import { getSoundBible } from "../sound/store.js";
import { getShotList } from "../shotList/store.js";
import { getTrailerPack } from "../trailer/store.js";
import { loadQueue } from "../generationQueue/store.js";
import type {
  WayfinderResponse,
  WayfinderStep,
  WayfinderTone,
} from "@toburt/shared";

type Json = Record<string, unknown>;
const j = (v: unknown): Json => ((v ?? {}) as Json);

interface ResolveContext {
  projectId: string;
  episodeId: string | null;
}

interface EpisodeRow {
  id: string;
  number: number | null;
  title: string | null;
}

async function loadEpisode(episodeId: string | null): Promise<EpisodeRow | null> {
  if (!episodeId) return null;
  const { data } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("id", episodeId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    number: (data.number as number | null) ?? null,
    title: (data.title as string | null) ?? null,
  };
}

async function resolveCurrentScript(
  projectId: string,
  episodeId: string
): Promise<{ id: string; draftNumber: number; locked: boolean; titlePageOk: boolean } | null> {
  const { data } = await supabase
    .from("scripts")
    .select("id, draft_number, metadata, title_page")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("current", true)
    .maybeSingle();
  if (!data) return null;
  const meta = j((data as { metadata?: unknown }).metadata);
  return {
    id: data.id as string,
    draftNumber: (data.draft_number as number) ?? 0,
    locked: meta.lockedWritingDraft === true,
    titlePageOk: !!data.title_page,
  };
}

/** Heuristic for "AI Video Prompts have been generated for this episode" —
 *  any brief with a non-empty composedPrompt counts. Briefs are stored at
 *  scripts.metadata.aiPrompts.briefs[ord][shotIndex]. */
function countComposedPrompts(scriptMeta: Json): { briefs: number; composed: number } {
  const ai = j(scriptMeta.aiPrompts);
  const briefs = (ai.briefs as Record<string, Record<string, Json>>) ?? {};
  let total = 0;
  let composed = 0;
  for (const perScene of Object.values(briefs)) {
    for (const brief of Object.values(perScene)) {
      total += 1;
      const text = (brief as Json).composedPrompt;
      if (typeof text === "string" && text.trim().length > 0) composed += 1;
    }
  }
  return { briefs: total, composed };
}

// ---------------------------------------------------------------------------
// Builders — each returns a fully-shaped WayfinderStep.
// ---------------------------------------------------------------------------

function fromDevelopment(step: NextStep): WayfinderStep {
  return {
    phase: "development",
    phaseLabel: "Foundation",
    status: "In progress",
    title: step.title,
    why: step.body,
    primary: { label: step.ctaLabel, toRel: step.toRel },
    tone: (step.tone as WayfinderTone | undefined) ?? "primary",
  };
}

function step(
  phase: WayfinderStep["phase"],
  phaseLabel: string,
  status: string,
  title: string,
  why: string,
  primary: WayfinderStep["primary"],
  opts: {
    tone?: WayfinderTone;
    secondary?: WayfinderStep["secondary"];
    blockers?: string[];
  } = {}
): WayfinderStep {
  return {
    phase,
    phaseLabel,
    status,
    title,
    why,
    primary,
    secondary: opts.secondary,
    blockers: opts.blockers,
    tone: opts.tone ?? "primary",
  };
}

// ---------------------------------------------------------------------------
// Production resolver
// ---------------------------------------------------------------------------

async function resolveProductionForEpisode(
  ctx: ResolveContext & { episodeId: string }
): Promise<WayfinderStep> {
  const ep = `/episodes/${ctx.episodeId}`;

  const script = await resolveCurrentScript(ctx.projectId, ctx.episodeId);
  if (!script) {
    return step(
      "screenplay",
      "Screenplay",
      "No current draft",
      "Start the first draft for this episode",
      "Every production artifact reads from the locked screenplay. Without a current draft for this episode, none of the downstream tools can run.",
      { label: "Open Drafts", toRel: "/drafts" },
      { tone: "primary" }
    );
  }

  if (!script.locked) {
    return step(
      "screenplay",
      "Screenplay",
      `Draft ${script.draftNumber} — unlocked`,
      "Lock the current draft when it's ready",
      "Production tools (Sound Bible, Shot List, AI Prompts, Queue) read from the locked screenplay. Locking signals that this draft is canon — you can still produce an unlocked draft, but downstream tools will warn that the source can drift.",
      { label: "Open Drafts", toRel: `/drafts/${script.id}` },
      {
        tone: "info",
        secondary: { label: "Skip to Shot List", toRel: `${ep}/shot-list` },
      }
    );
  }

  // Sound Bible
  const sb = await getSoundBible(ctx.projectId, ctx.episodeId);
  const sbHasContent =
    sb.version > 0 ||
    Object.keys(sb.scenes ?? {}).length > 0 ||
    (sb.episodeSoundIdentity?.sonicPhilosophy ?? "").trim().length > 0;
  if (!sbHasContent) {
    return step(
      "sound_bible",
      "Sound Bible",
      "Not generated",
      "Generate the Sound Bible",
      "The Sound Bible defines per-scene sonic canon — ambient bed, music guidance, motifs. Approved scene rows ride into every AI Video Prompt so generated shots have grounded audio direction.",
      { label: "Open Sound Bible", toRel: `${ep}/sound-bible` },
      { tone: "primary" }
    );
  }
  const sbApproved = sb.approvedAt !== null;
  if (!sbApproved) {
    return step(
      "sound_bible",
      "Sound Bible",
      "Generated, not approved",
      "Review and approve the Sound Bible",
      "Approved sections + scene rows are what the composer reads. Until you approve, the Generation Queue treats the sound canon as missing and flags shots as not-ready.",
      { label: "Review Sound Bible", toRel: `${ep}/sound-bible` },
      { tone: "info" }
    );
  }

  // Shot List
  const list = await getShotList(script.id);
  const totalShots = list.scenes.reduce((n, s) => n + s.shots.length, 0);
  if (totalShots === 0) {
    return step(
      "shot_list",
      "Shot List",
      "Empty",
      "Auto-build briefs for all scenes",
      "The Shot List reads scene fountain + bibles and emits a Master Shot Brief per shot. The bulk button at the top of the Shot List page runs this for every scene without overwriting any existing briefs.",
      { label: "Open Shot List", toRel: `${ep}/shot-list` },
      { tone: "primary" }
    );
  }
  const unapprovedShots = list.approval.shotTotalCount - list.approval.shotApprovedCount;
  if (unapprovedShots > 0) {
    return step(
      "shot_list",
      "Shot List",
      `${list.approval.shotApprovedCount} / ${list.approval.shotTotalCount} approved`,
      `Review and approve the ${unapprovedShots} unapproved shot${unapprovedShots === 1 ? "" : "s"}`,
      "Only approved shots flow into the Generation Queue. The Shot List header has a one-click 'Approve all generated shots' option with a confirm modal.",
      { label: "Open Shot List", toRel: `${ep}/shot-list` },
      { tone: "info" }
    );
  }

  // AI Video Prompts — composedPrompt should be present on every brief.
  // Pull the script's metadata directly to count.
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", script.id)
    .single();
  const meta = j((scriptRow as { metadata?: unknown } | null)?.metadata);
  const { briefs, composed } = countComposedPrompts(meta);
  if (briefs > 0 && composed < briefs) {
    return step(
      "ai_prompts",
      "AI Video Prompts",
      `${composed} / ${briefs} composed`,
      "Generate AI Video Prompts from approved shots",
      "Approved briefs without a composedPrompt are missing the model-ready text. The composer runs from the Shot List page — each shot card has a 'Regenerate prompt' affordance.",
      { label: "Open Shot List", toRel: `${ep}/shot-list` },
      { tone: "info" }
    );
  }

  // Generation Queue
  const queue = await loadQueue(ctx.projectId, ctx.episodeId);
  const queueItems = queue?.items ?? [];
  if (queueItems.length === 0) {
    return step(
      "generation_queue",
      "Generation Queue",
      "Empty",
      "Sync approved shots into the Generation Queue",
      "The queue mirrors approved shots and tracks model assignment, status, outputs, and review notes. Open the planner and the queue will populate from your approvals automatically.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` },
      { tone: "primary" }
    );
  }
  const readyOrBetter = queueItems.filter(
    (it) => it.status !== "not_ready" && it.status !== "needs_review"
  );
  const notReady = queueItems.filter((it) => it.status === "not_ready");
  if (notReady.length > 0) {
    return step(
      "generation_queue",
      "Generation Queue",
      `${notReady.length} blocked`,
      `Resolve blockers on ${notReady.length} shot${notReady.length === 1 ? "" : "s"}`,
      "Items show their readiness blockers inline — missing visual bible, prop bible, sound canon, etc. Fix the upstream gap, then resync; the queue auto-promotes to 'ready'.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` },
      { tone: "warning" }
    );
  }
  const awaitingReview = queueItems.filter((it) => it.status === "needs_review");
  if (awaitingReview.length > 0) {
    return step(
      "review",
      "Review",
      `${awaitingReview.length} awaiting review`,
      `Review generated outputs on ${awaitingReview.length} shot${awaitingReview.length === 1 ? "" : "s"}`,
      "Generated outputs need approve / reject / retry decisions before they count toward the episode's completion %.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` },
      { tone: "info" }
    );
  }
  const ready = queueItems.filter((it) => it.status === "ready");
  if (ready.length > 0) {
    return step(
      "generation_queue",
      "Generation Queue",
      `${ready.length} ready · ${readyOrBetter.length - ready.length} downstream`,
      "Assign models and begin generation",
      "Ready shots have everything they need to generate — pick a model on each, copy the prompt block, and paste into Veo / Kling / Runway externally. Paste the output URL back to record it.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` },
      { tone: "primary" }
    );
  }

  // Trailer
  const trailer = await getTrailerPack(ctx.projectId, ctx.episodeId);
  if (!trailer) {
    return step(
      "trailer",
      "Trailer",
      "Not generated",
      "Build a trailer / teaser pack",
      "Approved shots + the Sound Bible's trailer music direction unlock the Trailer Builder — 15s / 30s / 60s / social cuts grounded in real canon.",
      { label: "Open Trailer Builder", toRel: `${ep}/trailer-builder` },
      { tone: "info" }
    );
  }

  // All clear — exports.
  return step(
    "exports",
    "Exports",
    "Ready to ship",
    "Export the production package or build the trailer",
    "Approved screenplay, sound, shots, prompts, queue, and trailer are all in place. The Export Center can download the full production package zip with every approved artifact.",
    { label: "Open Export Center", toRel: "/exports" },
    {
      tone: "success",
      secondary: { label: "Open Trailer Builder", toRel: `${ep}/trailer-builder` },
    }
  );
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

export async function resolveWayfinder(
  projectId: string,
  episodeId: string | null
): Promise<WayfinderResponse> {
  const episode = await loadEpisode(episodeId);

  // Development phase — characters, treatment, arc, episodes, relationships,
  // pitch, draft 1. Delegated to the existing engine for backward compat.
  const devStep = await recommendNextStep(projectId);

  // Detect whether the development phase is complete by checking the dev
  // engine's "all clear" signal (title = "You're in good shape"). If we're
  // still in development, return that step.
  const devIsComplete = devStep.title === "You're in good shape";
  if (!devIsComplete) {
    return {
      projectId,
      episodeId: episode?.id ?? null,
      episodeNumber: episode?.number ?? null,
      episodeTitle: episode?.title ?? null,
      step: fromDevelopment(devStep),
    };
  }

  // Production phase. If we have an episode in scope, walk its ladder;
  // otherwise pick the first episode with a current draft and walk it.
  let scopeEpisode = episode;
  if (!scopeEpisode) {
    const { data: eps } = await supabase
      .from("episodes")
      .select("id, number, title")
      .eq("project_id", projectId)
      .order("number", { ascending: true });
    const first = (eps ?? [])[0];
    if (first) {
      scopeEpisode = {
        id: first.id as string,
        number: (first.number as number | null) ?? null,
        title: (first.title as string | null) ?? null,
      };
    }
  }

  if (!scopeEpisode) {
    // No episodes yet — bounce back to dev resolver, which would have
    // surfaced this already, but keep a fallback.
    return {
      projectId,
      episodeId: null,
      episodeNumber: null,
      episodeTitle: null,
      step: step(
        "complete",
        "Foundation",
        "Ready",
        "Materialize episodes from the season arc",
        "Approve a Season Arc on the Writers Room or Overview page and the OS will create one row per episode.",
        { label: "Open Episodes", toRel: "/episodes" },
        { tone: "primary" }
      ),
    };
  }

  const productionStep = await resolveProductionForEpisode({
    projectId,
    episodeId: scopeEpisode.id,
  });

  return {
    projectId,
    episodeId: scopeEpisode.id,
    episodeNumber: scopeEpisode.number,
    episodeTitle: scopeEpisode.title,
    step: productionStep,
  };
}
