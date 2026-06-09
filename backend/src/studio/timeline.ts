// Studio Timeline resolver.
//
// Derives the 10-stage project state from existing data (scripts, redev
// passes, sound bibles, shot list, queue, trailer, package) — no new
// persistence is required for Phase A. Picks a representative episode
// (first with a current draft, falling back to first episode) and uses
// it for the production-phase stages.
//
// Read-only. Never mutates fountain or script_scenes.

import { supabase } from "../db/client.js";
import { getSoundBible } from "../sound/store.js";
import { getShotList } from "../shotList/store.js";
import { getTrailerPack } from "../trailer/store.js";
import { loadQueue } from "../generationQueue/store.js";
import { buildTeamRoster } from "../team/aggregator.js";
import type {
  StudioStage,
  StudioStageKey,
  StudioStageStatus,
  StudioTimelineResponse,
} from "@toburt/shared";

type Json = Record<string, unknown>;
const j = (v: unknown): Json => ((v ?? {}) as Json);

interface ProjectRow {
  id: string;
  title: string | null;
  metadata: Json;
}

interface EpisodeRow {
  id: string;
  number: number | null;
  title: string | null;
}

async function loadProject(projectId: string): Promise<ProjectRow | null> {
  const { data } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    title: (data.title as string | null) ?? null,
    metadata: j((data as { metadata?: unknown }).metadata),
  };
}

async function pickRepresentativeEpisode(
  projectId: string
): Promise<EpisodeRow | null> {
  // Prefer the first episode with a current draft.
  const { data: scripts } = await supabase
    .from("scripts")
    .select("episode_id")
    .eq("project_id", projectId)
    .eq("current", true);
  const candidateIds = (scripts ?? [])
    .map((s) => (s.episode_id as string | null) ?? null)
    .filter((v): v is string => !!v);

  if (candidateIds.length > 0) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, number, title")
      .in("id", candidateIds)
      .order("number", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (ep) {
      return {
        id: ep.id as string,
        number: (ep.number as number | null) ?? null,
        title: (ep.title as string | null) ?? null,
      };
    }
  }

  // Otherwise — first episode.
  const { data: first } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("project_id", projectId)
    .order("number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!first) return null;
  return {
    id: first.id as string,
    number: (first.number as number | null) ?? null,
    title: (first.title as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Per-stage derivation
// ---------------------------------------------------------------------------

interface Snapshot {
  hasCurrentScript: boolean;
  scriptId: string | null;
  draftNumber: number | null;
  scriptLocked: boolean;
  hasReviewSignals: boolean;
  reviewSignalsDetail: string;
  characterCount: number;
  locationBibleCount: number;
  propBibleCount: number;
  soundBibleGenerated: boolean;
  soundBibleApproved: boolean;
  totalShots: number;
  approvedShots: number;
  briefs: number;
  composed: number;
  queueItems: number;
  queueApproved: number;
  queueAwaitingReview: number;
  queueRejected: number;
  trailerGenerated: boolean;
  packageBasicAvailable: boolean;
  packageFullReady: boolean;
  // Team state — populated by buildTeamRoster.
  totalRoles: number;
  requiredRoles: number;
  assignedRoles: number;
  assignedRequiredRoles: number;
  rosterApprovedAt: string | null;
  allRequiredRolesAssigned: boolean;
}

async function buildSnapshot(
  project: ProjectRow,
  episode: EpisodeRow | null
): Promise<Snapshot> {
  // Script + lock state
  let scriptId: string | null = null;
  let draftNumber: number | null = null;
  let scriptLocked = false;
  let scriptMeta: Json = {};
  if (episode) {
    const { data: script } = await supabase
      .from("scripts")
      .select("id, draft_number, metadata")
      .eq("project_id", project.id)
      .eq("episode_id", episode.id)
      .eq("current", true)
      .maybeSingle();
    if (script) {
      scriptId = script.id as string;
      draftNumber = (script.draft_number as number) ?? null;
      scriptMeta = j((script as { metadata?: unknown }).metadata);
      scriptLocked = scriptMeta.lockedWritingDraft === true;
    }
  }
  const hasCurrentScript = scriptId !== null;

  // Review signals — any of: redev passes exist, audit results exist on
  // the script, EI score persisted. Keep it simple for Phase A: pass if
  // any redevelopmentPasses entry exists OR script has scriptAudit.
  const redevPasses = Array.isArray(project.metadata.redevelopmentPasses)
    ? (project.metadata.redevelopmentPasses as unknown[]).length
    : 0;
  const audit = j(scriptMeta.scriptAudit);
  const auditDone =
    typeof audit.overallScore === "number" ||
    typeof audit.percentage === "number" ||
    Object.keys(audit).length > 0;
  const hasReviewSignals = redevPasses > 0 || auditDone;
  const reviewSignalsDetail =
    redevPasses > 0
      ? `${redevPasses} redev pass${redevPasses === 1 ? "" : "es"}${auditDone ? " · audit run" : ""}`
      : auditDone
        ? "Audit run"
        : "No review activity recorded";

  // Production-prep canon counts
  const { count: charCount } = await supabase
    .from("characters")
    .select("id", { count: "exact", head: true })
    .eq("project_id", project.id);
  const characterCount = charCount ?? 0;
  const locationBibles = (project.metadata.locationBibles as Json | undefined) ?? {};
  const propBibles = (project.metadata.propBibles as Json | undefined) ?? {};
  const locationBibleCount = Object.keys(locationBibles).length;
  const propBibleCount = Object.keys(propBibles).length;

  // Sound bible (per representative episode)
  let soundBibleGenerated = false;
  let soundBibleApproved = false;
  if (episode) {
    const sb = await getSoundBible(project.id, episode.id);
    soundBibleGenerated =
      sb.version > 0 ||
      Object.keys(sb.scenes ?? {}).length > 0 ||
      (sb.episodeSoundIdentity?.sonicPhilosophy ?? "").trim().length > 0;
    soundBibleApproved = sb.approvedAt !== null;
  }

  // Shot list
  let totalShots = 0;
  let approvedShots = 0;
  if (scriptId) {
    const list = await getShotList(scriptId);
    totalShots = list.scenes.reduce((n, s) => n + s.shots.length, 0);
    approvedShots = list.approval.shotApprovedCount;
  }

  // AI prompts — briefs with composedPrompt
  let briefs = 0;
  let composed = 0;
  if (scriptId) {
    const ai = j(scriptMeta.aiPrompts);
    const briefMap = (ai.briefs as Record<string, Record<string, Json>>) ?? {};
    for (const perScene of Object.values(briefMap)) {
      for (const brief of Object.values(perScene)) {
        briefs += 1;
        const text = (brief as Json).composedPrompt;
        if (typeof text === "string" && text.trim().length > 0) composed += 1;
      }
    }
  }

  // Queue (per representative episode)
  let queueItems = 0;
  let queueApproved = 0;
  let queueAwaitingReview = 0;
  let queueRejected = 0;
  if (episode) {
    const queue = await loadQueue(project.id, episode.id);
    const items = queue?.items ?? [];
    queueItems = items.length;
    queueApproved = items.filter(
      (it) => it.status === "approved" || it.status === "final"
    ).length;
    queueAwaitingReview = items.filter((it) => it.status === "needs_review").length;
    queueRejected = items.filter((it) => it.status === "rejected").length;
  }

  // Trailer
  let trailerGenerated = false;
  if (episode) {
    trailerGenerated = !!(await getTrailerPack(project.id, episode.id));
  }

  // Package readiness
  const packageBasicAvailable = scriptLocked;
  const packageFullReady =
    packageBasicAvailable &&
    soundBibleApproved &&
    totalShots > 0 &&
    approvedShots === totalShots &&
    briefs > 0 &&
    composed === briefs &&
    queueItems > 0 &&
    trailerGenerated;

  // Team roster
  const team = await buildTeamRoster(project.id);
  const totalRoles = team?.summary.totalRoles ?? 0;
  const requiredRoles = team?.summary.requiredRoles ?? 0;
  const assignedRoles = team?.summary.assignedRoles ?? 0;
  const assignedRequiredRoles = team?.summary.assignedRequiredRoles ?? 0;
  const rosterApprovedAt = team?.summary.rosterApprovedAt ?? null;
  const allRequiredRolesAssigned = team?.summary.allRequiredAssigned ?? false;

  return {
    hasCurrentScript,
    scriptId,
    draftNumber,
    scriptLocked,
    hasReviewSignals,
    reviewSignalsDetail,
    characterCount,
    locationBibleCount,
    propBibleCount,
    soundBibleGenerated,
    soundBibleApproved,
    totalShots,
    approvedShots,
    briefs,
    composed,
    queueItems,
    queueApproved,
    queueAwaitingReview,
    queueRejected,
    trailerGenerated,
    packageBasicAvailable,
    packageFullReady,
    totalRoles,
    requiredRoles,
    assignedRoles,
    assignedRequiredRoles,
    rosterApprovedAt,
    allRequiredRolesAssigned,
  };
}

// ---------------------------------------------------------------------------
// Build the 10 stages
// ---------------------------------------------------------------------------

function makeStages(
  snap: Snapshot,
  episode: EpisodeRow | null
): StudioStage[] {
  const ep = episode ? `/episodes/${episode.id}` : "";

  // 1. Write Script
  const writeScript: StudioStage = (() => {
    const status: StudioStageStatus = snap.hasCurrentScript ? "complete" : "in_progress";
    return {
      number: 1,
      key: "write_script",
      phase: "writing",
      title: "Write Script",
      deliverable: "A current screenplay draft",
      nextAction: snap.hasCurrentScript
        ? "A current draft exists — continue refining or move to review."
        : "Start the first draft for this episode.",
      status,
      statusDetail: snap.hasCurrentScript
        ? `Draft ${snap.draftNumber ?? "?"} current`
        : "No current draft yet",
      primary: snap.scriptId
        ? { label: "Open Draft", toRel: `/drafts/${snap.scriptId}` }
        : { label: "Open Drafts", toRel: "/drafts" },
      surfaces: [
        { label: "Drafts", toRel: "/drafts" },
        { label: "Writers Room", toRel: "/writers-room" },
        { label: "Episodes", toRel: "/episodes" },
      ],
    };
  })();

  // 2. Review & Collaborate
  const reviewCollaborate: StudioStage = (() => {
    const status: StudioStageStatus = !snap.hasCurrentScript
      ? "not_started"
      : snap.scriptLocked
        ? "complete"
        : snap.hasReviewSignals
          ? "in_progress"
          : "in_progress";
    return {
      number: 2,
      key: "review_collaborate",
      phase: "writing",
      title: "Review & Collaborate",
      deliverable: "A reviewed draft ready to lock",
      nextAction: !snap.hasCurrentScript
        ? "Write the first draft before review."
        : snap.scriptLocked
          ? "Review complete — script is locked."
          : "Run continuity, emotional intelligence, and rewrite passes before locking.",
      status,
      statusDetail: snap.reviewSignalsDetail,
      primary: { label: "Open Continuity", toRel: "/continuity" },
      secondary: { label: "Redevelopment", toRel: "/redevelopment" },
      surfaces: [
        { label: "Continuity", toRel: "/continuity" },
        { label: "Emotional Intelligence", toRel: "/emotional" },
        { label: "Rewrites", toRel: "/rewrites" },
        { label: "Redevelopment", toRel: "/redevelopment" },
      ],
    };
  })();

  // 3. Lock Script
  const lockScript: StudioStage = (() => {
    const status: StudioStageStatus = snap.scriptLocked
      ? "complete"
      : snap.hasCurrentScript
        ? "in_progress"
        : "not_started";
    return {
      number: 3,
      key: "lock_script",
      phase: "writing",
      title: "Lock Script",
      deliverable: "A locked canon draft",
      nextAction: snap.scriptLocked
        ? "Script is locked — proceed to assemble the team."
        : snap.hasCurrentScript
          ? "Lock the current draft so production tools have a canonical source."
          : "No draft exists yet to lock.",
      status,
      statusDetail: snap.scriptLocked
        ? `Draft ${snap.draftNumber ?? "?"} locked`
        : snap.draftNumber !== null
          ? `Draft ${snap.draftNumber} unlocked`
          : "No draft",
      primary: snap.scriptId
        ? { label: "Open Draft", toRel: `/drafts/${snap.scriptId}` }
        : { label: "Open Drafts", toRel: "/drafts" },
      surfaces: [{ label: "Drafts", toRel: "/drafts" }],
    };
  })();

  // 4. Assemble Creative Team
  const assembleTeam: StudioStage = (() => {
    // Stage 4 = the roster exists. Completion signal: either the roster
    // has been explicitly approved, or every required role has an
    // assignment (in which case the user clearly assembled the team).
    const isComplete =
      snap.rosterApprovedAt !== null || snap.allRequiredRolesAssigned;
    const isInProgress = snap.assignedRoles > 0;
    const status: StudioStageStatus = !snap.scriptLocked
      ? "blocked"
      : isComplete
        ? "complete"
        : isInProgress
          ? "in_progress"
          : "not_started";
    return {
      number: 4,
      key: "assemble_team",
      phase: "team",
      title: "Assemble Creative Team",
      deliverable: "An approved team roster covering every required role",
      nextAction: !snap.scriptLocked
        ? "Lock the script first — the team is built against a locked draft."
        : isComplete
          ? "Team is assembled. Move to role assignments."
          : isInProgress
            ? `${snap.assignedRoles} of ${snap.totalRoles} role${snap.totalRoles === 1 ? "" : "s"} assigned. Keep going on the Creative Team page.`
            : "Start the team — assign at minimum the writer, director, DP, composer, sound designer, prompt supervisor, and AI video operator.",
      status,
      statusDetail: snap.rosterApprovedAt
        ? `Roster approved ${new Date(snap.rosterApprovedAt).toLocaleDateString()}`
        : `${snap.assignedRoles} / ${snap.totalRoles} roles assigned · ${snap.assignedRequiredRoles} / ${snap.requiredRoles} required`,
      primary: { label: "Open Creative Team", toRel: "/team" },
      secondary: { label: "Character Bible", toRel: "/character-bible" },
      surfaces: [
        { label: "Creative Team", toRel: "/team" },
        { label: "Character Bible", toRel: "/character-bible" },
        { label: "Departments", toRel: "/departments" },
      ],
    };
  })();

  // 5. Assign Roles
  const assignRoles: StudioStage = (() => {
    // Stage 5 = every required role has a kind (ai / ai_creative /
    // live_person) — same signal as buildTeamRoster.allRequiredAssigned.
    const status: StudioStageStatus = !snap.scriptLocked
      ? "blocked"
      : snap.allRequiredRolesAssigned
        ? "complete"
        : snap.assignedRoles > 0
          ? "in_progress"
          : "not_started";
    return {
      number: 5,
      key: "assign_roles",
      phase: "team",
      title: "Assign Roles",
      deliverable: "Every required role mapped to AI / AI-Creative / Live Person",
      nextAction: !snap.scriptLocked
        ? "Lock the script first."
        : snap.allRequiredRolesAssigned
          ? "All required roles are assigned. Production prep can begin."
          : snap.requiredRoles - snap.assignedRequiredRoles > 0
            ? `Assign ${snap.requiredRoles - snap.assignedRequiredRoles} remaining required role${snap.requiredRoles - snap.assignedRequiredRoles === 1 ? "" : "s"} on the Creative Team page.`
            : "Open the Creative Team page to begin assignments.",
      status,
      statusDetail: `${snap.assignedRequiredRoles} / ${snap.requiredRoles} required · ${snap.assignedRoles - snap.assignedRequiredRoles} optional`,
      primary: { label: "Open Creative Team", toRel: "/team" },
      surfaces: [{ label: "Creative Team", toRel: "/team" }],
    };
  })();

  // 6. Production Prep
  const productionPrep: StudioStage = (() => {
    // Considered complete when characters + sound bible + location bibles + prop bibles all exist
    // and the sound bible is approved. Partial otherwise.
    const charsReady = snap.characterCount > 0;
    const locReady = snap.locationBibleCount > 0;
    const propReady = snap.propBibleCount > 0;
    const sbReady = snap.soundBibleApproved;
    const allReady = charsReady && locReady && propReady && sbReady;
    const someStarted = charsReady || locReady || propReady || snap.soundBibleGenerated;
    const status: StudioStageStatus = !snap.scriptLocked
      ? "blocked"
      : allReady
        ? "complete"
        : someStarted
          ? "in_progress"
          : "not_started";
    const missingPieces: string[] = [];
    if (!charsReady) missingPieces.push("characters");
    if (!locReady) missingPieces.push("locations");
    if (!propReady) missingPieces.push("props");
    if (!sbReady) missingPieces.push(snap.soundBibleGenerated ? "sound bible approval" : "sound bible");
    return {
      number: 6,
      key: "production_prep",
      phase: "production",
      title: "Production Prep",
      deliverable: "Approved canon — characters, locations, props, sound bible",
      nextAction: !snap.scriptLocked
        ? "Lock the script first — production prep reads from the locked draft."
        : missingPieces.length > 0
          ? `Missing: ${missingPieces.slice(0, 3).join(", ")}.`
          : "Production canon is complete.",
      status,
      statusDetail: `${snap.characterCount} chars · ${snap.locationBibleCount} locs · ${snap.propBibleCount} props · sound ${sbReady ? "approved" : snap.soundBibleGenerated ? "unapproved" : "not generated"}`,
      primary: ep
        ? { label: "Open Sound Bible", toRel: `${ep}/sound-bible` }
        : { label: "Open Character Bible", toRel: "/character-bible" },
      surfaces: [
        { label: "Character Bible", toRel: "/character-bible" },
        { label: "Story Bible", toRel: "/story-bible" },
        ...(ep ? [{ label: "Sound Bible", toRel: `${ep}/sound-bible` }] : []),
      ],
    };
  })();

  // 7. Shot / Prompt Planning
  const shotPromptPlanning: StudioStage = (() => {
    const allApproved = snap.totalShots > 0 && snap.approvedShots === snap.totalShots;
    const allComposed = snap.briefs > 0 && snap.composed === snap.briefs;
    const status: StudioStageStatus = !snap.scriptLocked
      ? "blocked"
      : snap.totalShots === 0
        ? "not_started"
        : allApproved && allComposed
          ? "complete"
          : "in_progress";
    return {
      number: 7,
      key: "shot_prompt_planning",
      phase: "production",
      title: "Shot / Prompt Planning",
      deliverable: "Approved shot list + composed AI video prompts",
      nextAction: !snap.scriptLocked
        ? "Lock the script first."
        : snap.totalShots === 0
          ? "Auto-build briefs for all scenes on the Shot List page."
          : !allApproved
            ? `Approve the remaining ${snap.totalShots - snap.approvedShots} shot${snap.totalShots - snap.approvedShots === 1 ? "" : "s"}.`
            : !allComposed
              ? `Compose prompts for ${snap.briefs - snap.composed} more shot${snap.briefs - snap.composed === 1 ? "" : "s"}.`
              : "Shot list + prompts complete.",
      status,
      statusDetail:
        snap.totalShots === 0
          ? "0 shots"
          : `${snap.approvedShots}/${snap.totalShots} approved · ${snap.composed}/${snap.briefs} prompts`,
      primary: ep
        ? { label: "Open Shot List", toRel: `${ep}/shot-list` }
        : { label: "Open Drafts", toRel: "/drafts" },
      surfaces: ep ? [{ label: "Shot List", toRel: `${ep}/shot-list` }] : [],
    };
  })();

  // 8. Generation Queue
  const generationQueue: StudioStage = (() => {
    const status: StudioStageStatus = !snap.scriptLocked
      ? "blocked"
      : snap.queueItems === 0
        ? "not_started"
        : snap.queueApproved === snap.queueItems
          ? "complete"
          : "in_progress";
    return {
      number: 8,
      key: "generation_queue",
      phase: "production",
      title: "Generation Queue",
      deliverable: "Generated outputs attached to every shot",
      nextAction:
        snap.queueItems === 0
          ? "Sync approved shots into the Generation Queue."
          : snap.queueApproved === snap.queueItems
            ? "All queue items have approved outputs."
            : "Assign models, generate externally, and paste output URLs back.",
      status,
      statusDetail:
        snap.queueItems === 0
          ? "Empty"
          : `${snap.queueApproved}/${snap.queueItems} approved · ${snap.queueAwaitingReview} review · ${snap.queueRejected} rejected`,
      primary: ep
        ? { label: "Open Generation Queue", toRel: `${ep}/generation-queue` }
        : { label: "Open Episodes", toRel: "/episodes" },
      surfaces: ep ? [{ label: "Generation Queue", toRel: `${ep}/generation-queue` }] : [],
    };
  })();

  // 9. Review & Final Assets
  const reviewFinalAssets: StudioStage = (() => {
    const allReviewed =
      snap.queueItems > 0 &&
      snap.queueAwaitingReview === 0 &&
      snap.queueApproved + snap.queueRejected === snap.queueItems;
    const status: StudioStageStatus =
      snap.queueItems === 0
        ? "not_started"
        : snap.queueAwaitingReview > 0
          ? "in_progress"
          : allReviewed
            ? "complete"
            : "in_progress";
    return {
      number: 9,
      key: "review_final_assets",
      phase: "production",
      title: "Review & Final Assets",
      deliverable: "All outputs approved or rejected with retry",
      nextAction:
        snap.queueItems === 0
          ? "Generate outputs first."
          : snap.queueAwaitingReview > 0
            ? `Review ${snap.queueAwaitingReview} output${snap.queueAwaitingReview === 1 ? "" : "s"} awaiting decision.`
            : "All outputs reviewed.",
      status,
      statusDetail:
        snap.queueItems === 0
          ? "Nothing to review"
          : `${snap.queueApproved} approved · ${snap.queueAwaitingReview} pending · ${snap.queueRejected} rejected`,
      primary: ep
        ? { label: "Open Generation Queue", toRel: `${ep}/generation-queue` }
        : { label: "Open Episodes", toRel: "/episodes" },
      surfaces: ep ? [{ label: "Generation Queue", toRel: `${ep}/generation-queue` }] : [],
    };
  })();

  // 10. Export / Delivery
  const exportDelivery: StudioStage = (() => {
    const status: StudioStageStatus = snap.packageFullReady
      ? "complete"
      : snap.packageBasicAvailable
        ? "in_progress"
        : "blocked";
    return {
      number: 10,
      key: "export_delivery",
      phase: "production",
      title: "Export / Delivery",
      deliverable: "Production package delivered",
      nextAction: snap.packageFullReady
        ? "Full production package is ready — download from Export Center."
        : snap.packageBasicAvailable
          ? "Basic package is exportable — sections are still missing for the full bundle."
          : "Lock the script before any package can be exported.",
      status,
      statusDetail: snap.packageFullReady
        ? "Full package ready"
        : snap.packageBasicAvailable
          ? "Basic package available — missing sections"
          : "Not ready",
      primary: { label: "Open Export Center", toRel: "/exports" },
      surfaces: [
        { label: "Export Center", toRel: "/exports" },
        ...(ep ? [{ label: "Trailer Builder", toRel: `${ep}/trailer-builder` }] : []),
      ],
    };
  })();

  return [
    writeScript,
    reviewCollaborate,
    lockScript,
    assembleTeam,
    assignRoles,
    productionPrep,
    shotPromptPlanning,
    generationQueue,
    reviewFinalAssets,
    exportDelivery,
  ];
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export async function resolveStudioTimeline(
  projectId: string
): Promise<StudioTimelineResponse | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const episode = await pickRepresentativeEpisode(projectId);
  const snap = await buildSnapshot(project, episode);
  const stages = makeStages(snap, episode);

  // Compute summary. "current" stage = the lowest-numbered stage that is
  // in_progress; if none, the lowest blocked; if all complete, null.
  let currentKey: StudioStageKey | null = null;
  for (const s of stages) {
    if (s.status === "in_progress") {
      currentKey = s.key;
      break;
    }
  }
  if (currentKey === null) {
    for (const s of stages) {
      if (s.status === "blocked" || s.status === "not_started") {
        currentKey = s.key;
        break;
      }
    }
  }
  const completeStages = stages.filter((s) => s.status === "complete").length;
  const progressPct = Math.round((completeStages / stages.length) * 100);

  return {
    projectId,
    projectTitle: project.title,
    projectType: (project.metadata.projectType as string | undefined) ?? "prestige_series",
    representativeEpisodeId: episode?.id ?? null,
    representativeEpisodeNumber: episode?.number ?? null,
    representativeEpisodeTitle: episode?.title ?? null,
    stages,
    summary: {
      totalStages: stages.length,
      completeStages,
      currentStageKey: currentKey,
      progressPct,
    },
  };
}
