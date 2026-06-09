// Wayfinder resolver — returns the single most-impactful next step given
// current project + (optional) episode state.
//
// Two scopes:
//   • "general"    — runs the dev-phase engine first. Only flips into the
//                    production ladder once dev is "all clear". Used on
//                    Project Overview / Story Bible.
//   • "production" — skips dev. Walks the production ladder only. Dev
//                    issues, if any, are returned as nonProductionWarnings
//                    (secondary) instead of overriding the next step. Used
//                    on Production Hub, Episodes, Sound/Shot/Trailer/Queue
//                    pages, and the Export Center.
//
// The production ladder reads:
//   screenplay locked → sound bible → shot list → AI prompts →
//   generation queue → trailer → exports.
//
// Read-only. Never mutates fountain or script_scenes.

import { supabase } from "../db/client.js";
import { recommendNextStep, type NextStep } from "../draft/recommendedStep.js";
import { getSoundBible } from "../sound/store.js";
import { getShotList } from "../shotList/store.js";
import { getTrailerPack } from "../trailer/store.js";
import { loadQueue } from "../generationQueue/store.js";
import type {
  ProductionPathState,
  ProductionPathStep,
  WayfinderResponse,
  WayfinderScope,
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

interface ScriptInfo {
  id: string;
  draftNumber: number;
  locked: boolean;
}

async function resolveCurrentScript(
  projectId: string,
  episodeId: string
): Promise<ScriptInfo | null> {
  const { data } = await supabase
    .from("scripts")
    .select("id, draft_number, metadata")
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
  };
}

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
// Production state snapshot — one place that reads every signal the
// ladder + path stepper care about. The resolver picks the next step,
// the stepper visualizes the whole ladder, both from the same snapshot.
// ---------------------------------------------------------------------------

interface ProductionSnapshot {
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  script: ScriptInfo | null;
  // Sound Bible
  soundBibleGenerated: boolean;
  soundBibleApproved: boolean;
  // Shot List
  totalShots: number;
  approvedShots: number;
  // AI Prompts (composed text on briefs)
  briefs: number;
  composed: number;
  // Queue
  queueItems: number;
  queueBlocked: number;
  queueReady: number;
  queueAwaitingReview: number;
  queueApproved: number;
  // Trailer
  trailerGenerated: boolean;
  // Exports — basic vs full readiness
  packageBasicAvailable: boolean; // any screenplay export possible (locked draft + something)
  packageFullReady: boolean;       // all sections present
}

async function snapshotEpisode(
  projectId: string,
  episode: EpisodeRow
): Promise<ProductionSnapshot> {
  const script = await resolveCurrentScript(projectId, episode.id);

  const [sb, list, trailer, queue, scriptRow] = await Promise.all([
    getSoundBible(projectId, episode.id),
    script ? getShotList(script.id) : Promise.resolve(null),
    getTrailerPack(projectId, episode.id),
    loadQueue(projectId, episode.id),
    script
      ? supabase
          .from("scripts")
          .select("metadata")
          .eq("id", script.id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const soundBibleGenerated =
    sb.version > 0 ||
    Object.keys(sb.scenes ?? {}).length > 0 ||
    (sb.episodeSoundIdentity?.sonicPhilosophy ?? "").trim().length > 0;
  const soundBibleApproved = sb.approvedAt !== null;

  const totalShots = list ? list.scenes.reduce((n, s) => n + s.shots.length, 0) : 0;
  const approvedShots = list?.approval.shotApprovedCount ?? 0;

  const scriptMeta = j((scriptRow as { data: { metadata?: unknown } | null }).data?.metadata);
  const { briefs, composed } = script ? countComposedPrompts(scriptMeta) : { briefs: 0, composed: 0 };

  const items = queue?.items ?? [];
  const queueBlocked = items.filter((it) => it.status === "not_ready").length;
  const queueReady = items.filter((it) => it.status === "ready").length;
  const queueAwaitingReview = items.filter((it) => it.status === "needs_review").length;
  const queueApproved = items.filter(
    (it) => it.status === "approved" || it.status === "final"
  ).length;

  // Package readiness:
  //   • basic: locked draft + at least screenplay text present.
  //   • full:  every production section (sound approved, shots approved,
  //            ai prompts composed, queue not empty, trailer generated).
  const packageBasicAvailable = !!script && script.locked;
  const packageFullReady =
    packageBasicAvailable &&
    soundBibleApproved &&
    totalShots > 0 &&
    approvedShots === totalShots &&
    briefs > 0 &&
    composed === briefs &&
    items.length > 0 &&
    trailer !== null;

  return {
    episodeId: episode.id,
    episodeNumber: episode.number,
    episodeTitle: episode.title,
    script,
    soundBibleGenerated,
    soundBibleApproved,
    totalShots,
    approvedShots,
    briefs,
    composed,
    queueItems: items.length,
    queueBlocked,
    queueReady,
    queueAwaitingReview,
    queueApproved,
    trailerGenerated: trailer !== null,
    packageBasicAvailable,
    packageFullReady,
  };
}

// ---------------------------------------------------------------------------
// Step builders
// ---------------------------------------------------------------------------

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

function fromDevelopment(devStep: NextStep): WayfinderStep {
  return {
    phase: "development",
    phaseLabel: "Foundation",
    status: "In progress",
    title: devStep.title,
    why: devStep.body,
    primary: { label: devStep.ctaLabel, toRel: devStep.toRel },
    tone: (devStep.tone as WayfinderTone | undefined) ?? "primary",
  };
}

// ---------------------------------------------------------------------------
// Production ladder — picks the next step from a snapshot.
// ---------------------------------------------------------------------------

function ladderFromSnapshot(snap: ProductionSnapshot): WayfinderStep {
  const ep = `/episodes/${snap.episodeId}`;

  // 1. Screenplay
  if (!snap.script) {
    return step(
      "screenplay",
      "Screenplay",
      "No current draft",
      "Start the first draft for this episode",
      "Every production artifact reads from the current screenplay. Without a draft for this episode, none of the downstream tools can run.",
      { label: "Open Drafts", toRel: "/drafts" }
    );
  }
  if (!snap.script.locked) {
    return step(
      "screenplay",
      "Screenplay",
      `Draft ${snap.script.draftNumber} — unlocked`,
      "Lock the current draft when it's ready",
      "Locking signals that this draft is canon. The Sound Bible, Shot List, and Generation Queue all warn when their source can drift.",
      { label: "Open Drafts", toRel: `/drafts/${snap.script.id}` },
      {
        tone: "info",
        secondary: { label: "Skip to Shot List", toRel: `${ep}/shot-list` },
      }
    );
  }

  // 2. Sound Bible
  if (!snap.soundBibleGenerated) {
    return step(
      "sound_bible",
      "Sound Bible",
      "Not generated",
      "Generate Sound Bible",
      "Per-scene sonic canon — ambient bed, music guidance, motifs. Approved scene rows ride into every AI Video Prompt so generated shots have grounded audio direction.",
      { label: "Open Sound Bible", toRel: `${ep}/sound-bible` }
    );
  }
  if (!snap.soundBibleApproved) {
    return step(
      "sound_bible",
      "Sound Bible",
      "Generated, not approved",
      "Review and approve Sound Bible",
      "Approved sections + scene rows are what the composer reads. Until you approve, the Generation Queue treats the sound canon as missing and flags shots as not-ready.",
      { label: "Review Sound Bible", toRel: `${ep}/sound-bible` },
      { tone: "info" }
    );
  }

  // 3. Shot List
  if (snap.totalShots === 0) {
    return step(
      "shot_list",
      "Shot List",
      "Empty",
      "Auto-build Shot List",
      "The Shot List reads scene fountain + bibles and emits a Master Shot Brief per shot. The bulk button at the top of the Shot List page runs this for every scene without overwriting any existing briefs.",
      { label: "Open Shot List", toRel: `${ep}/shot-list` }
    );
  }
  const unapprovedShots = snap.totalShots - snap.approvedShots;
  if (unapprovedShots > 0) {
    return step(
      "shot_list",
      "Shot List",
      `${snap.approvedShots} / ${snap.totalShots} approved`,
      "Approve Shot List",
      "Only approved shots flow into the Generation Queue. The Shot List header has a one-click 'Approve all generated shots' button.",
      { label: "Open Shot List", toRel: `${ep}/shot-list` },
      { tone: "info" }
    );
  }

  // 4. AI Prompts
  if (snap.briefs > 0 && snap.composed < snap.briefs) {
    return step(
      "ai_prompts",
      "AI Video Prompts",
      `${snap.composed} / ${snap.briefs} composed`,
      "Generate AI Video Prompts",
      "Approved briefs without a composedPrompt are missing the model-ready text. The composer runs from the Shot List page — each shot card has a 'Regenerate prompt' affordance.",
      { label: "Open Shot List", toRel: `${ep}/shot-list` },
      { tone: "info" }
    );
  }

  // 5. Generation Queue
  if (snap.queueItems === 0) {
    return step(
      "generation_queue",
      "Generation Queue",
      "Empty",
      "Sync Generation Queue",
      "The queue mirrors approved shots and tracks model assignment, status, outputs, and review notes. Open the planner and the queue will populate from your approvals automatically.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` }
    );
  }
  if (snap.queueBlocked > 0) {
    return step(
      "generation_queue",
      "Generation Queue",
      `${snap.queueBlocked} blocked`,
      `Resolve blockers on ${snap.queueBlocked} shot${snap.queueBlocked === 1 ? "" : "s"}`,
      "Items show their readiness blockers inline — missing visual bible, prop bible, sound canon, etc. Fix the upstream gap, then resync.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` },
      { tone: "warning" }
    );
  }
  if (snap.queueAwaitingReview > 0) {
    return step(
      "review",
      "Review",
      `${snap.queueAwaitingReview} awaiting review`,
      `Review outputs on ${snap.queueAwaitingReview} shot${snap.queueAwaitingReview === 1 ? "" : "s"}`,
      "Generated outputs need approve / reject / retry decisions before they count toward the episode's completion %.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` },
      { tone: "info" }
    );
  }
  if (snap.queueReady > 0) {
    return step(
      "generation_queue",
      "Generation Queue",
      `${snap.queueReady} ready`,
      "Assign models and begin generation",
      "Ready shots have everything they need to generate. Pick a model on each, copy the prompt block, and paste into Veo / Kling / Runway externally. Paste the output URL back to record it.",
      { label: "Open Generation Queue", toRel: `${ep}/generation-queue` }
    );
  }

  // 6. Trailer
  if (!snap.trailerGenerated) {
    return step(
      "trailer",
      "Trailer",
      "Not generated",
      "Build Trailer",
      "Approved shots + the Sound Bible's trailer music direction unlock the Trailer Builder — 15s / 30s / 60s / social cuts grounded in real canon.",
      { label: "Open Trailer Builder", toRel: `${ep}/trailer-builder` },
      { tone: "info" }
    );
  }

  // 7. Exports
  return step(
    "exports",
    "Exports",
    "Ready to ship",
    "Export Production Package",
    "Approved screenplay, sound, shots, prompts, queue, and trailer are all in place. The Export Center can download the full production package zip with every approved artifact.",
    { label: "Open Export Center", toRel: "/exports" },
    {
      tone: "success",
      secondary: { label: "Open Trailer Builder", toRel: `${ep}/trailer-builder` },
    }
  );
}

// Build the path stepper from a snapshot. State per step:
//   • complete — fully done
//   • current  — the next-step's phase (in_progress)
//   • missing  — not started yet
//   • blocked  — has unresolved blockers from upstream
function pathFromSnapshot(snap: ProductionSnapshot, currentPhase: WayfinderStep["phase"]): ProductionPathStep[] {
  const ep = `/episodes/${snap.episodeId}`;
  const steps: ProductionPathStep[] = [];
  const isCurrent = (phase: string) => currentPhase === phase;

  // Screenplay
  const screenplayState: ProductionPathState = !snap.script
    ? "missing"
    : !snap.script.locked
      ? isCurrent("screenplay") ? "current" : "blocked"
      : "complete";
  steps.push({
    key: "screenplay",
    label: "Locked Script",
    state: screenplayState,
    status: !snap.script
      ? "No current draft"
      : snap.script.locked
        ? `Draft ${snap.script.draftNumber} locked`
        : `Draft ${snap.script.draftNumber} unlocked`,
    toRel: snap.script ? `/drafts/${snap.script.id}` : "/drafts",
  });

  // Sound Bible
  const sbState: ProductionPathState =
    !snap.soundBibleGenerated
      ? isCurrent("sound_bible") ? "current" : "missing"
      : !snap.soundBibleApproved
        ? isCurrent("sound_bible") ? "current" : "blocked"
        : "complete";
  steps.push({
    key: "sound_bible",
    label: "Sound Bible",
    state: sbState,
    status: !snap.soundBibleGenerated
      ? "Not generated"
      : snap.soundBibleApproved
        ? "Approved"
        : "Unapproved",
    toRel: `${ep}/sound-bible`,
  });

  // Shot List
  const shotState: ProductionPathState =
    snap.totalShots === 0
      ? isCurrent("shot_list") ? "current" : "missing"
      : snap.approvedShots < snap.totalShots
        ? isCurrent("shot_list") ? "current" : "blocked"
        : "complete";
  steps.push({
    key: "shot_list",
    label: "Shot List",
    state: shotState,
    status:
      snap.totalShots === 0
        ? "Empty"
        : `${snap.approvedShots} / ${snap.totalShots} approved`,
    toRel: `${ep}/shot-list`,
  });

  // AI Prompts
  const promptState: ProductionPathState =
    snap.briefs === 0
      ? snap.approvedShots === 0
        ? "missing"
        : isCurrent("ai_prompts") ? "current" : "missing"
      : snap.composed < snap.briefs
        ? isCurrent("ai_prompts") ? "current" : "blocked"
        : "complete";
  steps.push({
    key: "ai_prompts",
    label: "AI Prompts",
    state: promptState,
    status:
      snap.briefs === 0
        ? "No briefs"
        : `${snap.composed} / ${snap.briefs} composed`,
    toRel: `${ep}/shot-list`,
  });

  // Queue
  const queueState: ProductionPathState =
    snap.queueItems === 0
      ? isCurrent("generation_queue") ? "current" : "missing"
      : snap.queueBlocked > 0
        ? isCurrent("generation_queue") ? "current" : "blocked"
        : snap.queueAwaitingReview > 0
          ? isCurrent("review") ? "current" : "blocked"
          : snap.queueReady > 0 || snap.queueApproved < snap.queueItems
            ? isCurrent("generation_queue") || isCurrent("review") ? "current" : "blocked"
            : "complete";
  steps.push({
    key: "generation_queue",
    label: "Generation Queue",
    state: queueState,
    status:
      snap.queueItems === 0
        ? "Empty"
        : `${snap.queueApproved} approved · ${snap.queueAwaitingReview} review · ${snap.queueBlocked} blocked`,
    toRel: `${ep}/generation-queue`,
  });

  // Trailer
  const trailerState: ProductionPathState = snap.trailerGenerated
    ? "complete"
    : isCurrent("trailer")
      ? "current"
      : "missing";
  steps.push({
    key: "trailer",
    label: "Trailer",
    state: trailerState,
    status: snap.trailerGenerated ? "Generated" : "Not generated",
    toRel: `${ep}/trailer-builder`,
  });

  // Exports
  const exportsState: ProductionPathState = snap.packageFullReady
    ? "complete"
    : snap.packageBasicAvailable
      ? isCurrent("exports") ? "current" : "blocked"
      : "missing";
  steps.push({
    key: "exports",
    label: "Production Package",
    state: exportsState,
    status: snap.packageFullReady
      ? "Full package ready"
      : snap.packageBasicAvailable
        ? "Basic package available — missing sections"
        : "Not ready",
    toRel: "/exports",
  });

  return steps;
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

async function pickScopeEpisode(
  projectId: string,
  episodeId: string | null
): Promise<EpisodeRow | null> {
  if (episodeId) {
    return loadEpisode(episodeId);
  }
  const { data: eps } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("project_id", projectId)
    .order("number", { ascending: true });
  const first = (eps ?? [])[0];
  if (!first) return null;
  return {
    id: first.id as string,
    number: (first.number as number | null) ?? null,
    title: (first.title as string | null) ?? null,
  };
}

export async function resolveWayfinder(
  projectId: string,
  episodeId: string | null,
  scope: WayfinderScope = "general"
): Promise<WayfinderResponse> {
  if (scope === "production") {
    return resolveProductionScope({ projectId, episodeId });
  }
  return resolveGeneralScope({ projectId, episodeId });
}

async function resolveGeneralScope(ctx: ResolveContext): Promise<WayfinderResponse> {
  const episode = await loadEpisode(ctx.episodeId);
  const devStep = await recommendNextStep(ctx.projectId);
  const devIsComplete = devStep.title === "You're in good shape";

  if (!devIsComplete) {
    return {
      projectId: ctx.projectId,
      episodeId: episode?.id ?? null,
      episodeNumber: episode?.number ?? null,
      episodeTitle: episode?.title ?? null,
      scope: "general",
      step: fromDevelopment(devStep),
    };
  }

  // Dev complete — walk the production ladder.
  const scopeEpisode = episode ?? (await pickScopeEpisode(ctx.projectId, null));
  if (!scopeEpisode) {
    return {
      projectId: ctx.projectId,
      episodeId: null,
      episodeNumber: null,
      episodeTitle: null,
      scope: "general",
      step: step(
        "complete",
        "Foundation",
        "Ready",
        "Materialize episodes from the season arc",
        "Approve a Season Arc on the Writers Room or Overview page and the OS will create one row per episode.",
        { label: "Open Episodes", toRel: "/episodes" }
      ),
    };
  }

  const snap = await snapshotEpisode(ctx.projectId, scopeEpisode);
  const ladderStep = ladderFromSnapshot(snap);
  return {
    projectId: ctx.projectId,
    episodeId: scopeEpisode.id,
    episodeNumber: scopeEpisode.number,
    episodeTitle: scopeEpisode.title,
    scope: "general",
    step: ladderStep,
  };
}

async function resolveProductionScope(
  ctx: ResolveContext
): Promise<WayfinderResponse> {
  const scopeEpisode = await pickScopeEpisode(ctx.projectId, ctx.episodeId);

  if (!scopeEpisode) {
    return {
      projectId: ctx.projectId,
      episodeId: null,
      episodeNumber: null,
      episodeTitle: null,
      scope: "production",
      step: step(
        "complete",
        "Production",
        "No episodes yet",
        "Materialize episodes from the season arc",
        "Approve a Season Arc on the Writers Room or Overview page. Production tools run per-episode.",
        { label: "Open Episodes", toRel: "/episodes" }
      ),
      productionPath: [],
      nonProductionWarnings: [],
    };
  }

  const snap = await snapshotEpisode(ctx.projectId, scopeEpisode);
  const ladderStep = ladderFromSnapshot(snap);
  const productionPath = pathFromSnapshot(snap, ladderStep.phase);

  // Carry dev-phase findings as secondary warnings (not the primary step).
  const devStep = await recommendNextStep(ctx.projectId);
  const nonProductionWarnings: string[] = [];
  if (devStep.title !== "You're in good shape") {
    nonProductionWarnings.push(`${devStep.title}. ${devStep.body}`);
  }

  return {
    projectId: ctx.projectId,
    episodeId: scopeEpisode.id,
    episodeNumber: scopeEpisode.number,
    episodeTitle: scopeEpisode.title,
    scope: "production",
    step: ladderStep,
    productionPath,
    nonProductionWarnings,
  };
}
