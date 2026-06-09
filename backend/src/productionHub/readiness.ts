// Production Hub — pure readiness aggregator.
//
// Reads every existing approved-canon source in one pass and projects a
// per-episode + project-level readiness summary. No writes, no LLM calls,
// no scene mutations. Reuses the same storage shapes the per-feature
// pages read from.
//
// Status enum is intentionally narrow:
//   • missing      — nothing generated yet
//   • partial      — generated but not approved
//   • approved     — approved at the relevant level (scene / section /
//                    full bible / episode-level)
//   • locked       — special status for the screenplay only
//   • complete     — used for project-level canon (characters, location
//                    bibles, prop bibles) where there's no per-episode
//                    approval gate

import { supabase } from "../db/client.js";
import type {
  ProductionHubEpisodeRow,
  ProductionHubResponse,
  ProductionHubSectionStatus,
  ProductionHubSummary,
} from "@toburt/shared";

// ---------------------------------------------------------------------------
// Section weights for the readiness score (sum to 1.0)
// ---------------------------------------------------------------------------

const WEIGHTS = {
  screenplay: 0.18,
  characters: 0.08,
  locations: 0.08,
  props: 0.06,
  soundBible: 0.12,
  shotList: 0.18,
  aiVideoPrompts: 0.12,
  trailerPack: 0.10,
  packageReady: 0.08,
} as const;

function scoreFromStatus(status: ProductionHubSectionStatus): number {
  switch (status) {
    case "approved":
    case "locked":
    case "complete":
      return 1.0;
    case "partial":
      return 0.5;
    case "missing":
    default:
      return 0.0;
  }
}

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

export async function buildProductionHub(projectId: string): Promise<ProductionHubResponse> {
  // Project + project-level canon — one round trip each.
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, metadata, tone, kind")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("project not found");
  const projectMeta = (project.metadata as Record<string, unknown> | null) ?? {};

  const projectTitle = (project.title as string) ?? null;
  const projectType = (projectMeta.projectType as string) ?? "prestige_series";

  // Episodes — drives the row set. Order by number ASC.
  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, number, title, status")
    .eq("project_id", projectId)
    .order("number", { ascending: true });

  // Scripts for the project — load once, partition per episode.
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, episode_id, draft_number, current, metadata, title")
    .eq("project_id", projectId);
  const scriptsByEpisode = new Map<string | null, typeof scripts>();
  for (const s of scripts ?? []) {
    const key = (s.episode_id as string | null) ?? null;
    const arr = scriptsByEpisode.get(key) ?? [];
    arr.push(s);
    scriptsByEpisode.set(key, arr);
  }

  // Characters — project-scoped, used for the character-canon status. We
  // tally how many have a non-empty visualBible.
  const { data: characters } = await supabase
    .from("characters")
    .select("name, metadata")
    .eq("project_id", projectId);
  const charactersWithBible = (characters ?? []).filter((c) => {
    const m = (c.metadata as Record<string, unknown> | null) ?? {};
    const vb = m.visualBible as Record<string, unknown> | undefined;
    return vb && Object.keys(vb).length > 0;
  });
  const charactersStatus: ProductionHubSectionStatus = (() => {
    const total = (characters ?? []).length;
    const withBible = charactersWithBible.length;
    if (total === 0) return "missing";
    if (withBible === 0) return "partial";
    if (withBible === total) return "complete";
    return "partial";
  })();
  const charactersDetail = `${charactersWithBible.length} of ${(characters ?? []).length} characters with visual bible`;

  // Location + prop bibles — project-scoped.
  const locationBibles = (projectMeta.locationBibles as Record<string, Record<string, unknown>> | undefined) ?? {};
  const locationApproved = Object.values(locationBibles).filter((b) => b?.approved === true).length;
  const locationTotal = Object.keys(locationBibles).length;
  const locationsStatus: ProductionHubSectionStatus =
    locationTotal === 0
      ? "missing"
      : locationApproved === locationTotal
      ? "complete"
      : "partial";
  const locationsDetail = `${locationApproved} of ${locationTotal} locations approved`;

  const propBibles = (projectMeta.propBibles as Record<string, Record<string, unknown>> | undefined) ?? {};
  const propsApproved = Object.values(propBibles).filter((b) => b?.approved === true).length;
  const propsTotal = Object.keys(propBibles).length;
  const propsStatus: ProductionHubSectionStatus =
    propsTotal === 0
      ? "missing"
      : propsApproved === propsTotal
      ? "complete"
      : "partial";
  const propsDetail = `${propsApproved} of ${propsTotal} props approved`;

  // Sound bibles, trailer packs — per-episode under project metadata.
  const soundBibles = (projectMeta.soundBibles as Record<string, Record<string, unknown>> | undefined) ?? {};
  const trailerBuilders = (projectMeta.trailerBuilder as Record<string, Record<string, unknown>> | undefined) ?? {};

  // Pitch is project-level — single status.
  const pitch = projectMeta.pitch as Record<string, unknown> | undefined;
  const pitchHasDecks =
    !!pitch &&
    Array.isArray(pitch.decks) &&
    (pitch.decks as Array<unknown>).length > 0;
  const pitchStatus: ProductionHubSectionStatus = !pitch
    ? "missing"
    : pitchHasDecks
    ? "complete"
    : "partial";

  // Walk episodes.
  const rows: ProductionHubEpisodeRow[] = [];
  for (const ep of episodes ?? []) {
    const episodeId = ep.id as string;
    const epScripts = scriptsByEpisode.get(episodeId) ?? [];
    const currentScript =
      epScripts.find((s) => s.current === true) ??
      epScripts.sort((a, b) => (b.draft_number as number) - (a.draft_number as number))[0] ??
      null;

    // --- Screenplay
    const scriptMeta = (currentScript?.metadata as Record<string, unknown> | null) ?? {};
    const scriptIsLocked = scriptMeta.lockedWritingDraft === true;
    const screenplayStatus: ProductionHubSectionStatus = !currentScript
      ? "missing"
      : scriptIsLocked
      ? "locked"
      : "partial";
    const screenplayDetail = currentScript
      ? `Draft ${currentScript.draft_number}${scriptIsLocked ? " · locked" : ""}`
      : "no draft yet";

    // --- Sound Bible (episode-scoped)
    const sb = soundBibles[episodeId] as Record<string, unknown> | undefined;
    const sbVersion = (sb?.version as number | undefined) ?? 0;
    const sbApproved = (sb?.approvedAt as string | null | undefined) ?? null;
    const sbSceneRows =
      (sb?.scenes as Record<string, { approvedAt?: string | null }> | undefined) ?? {};
    const sbApprovedSceneCount = Object.values(sbSceneRows).filter((r) => r.approvedAt != null).length;
    const sbTotalSceneCount = Object.keys(sbSceneRows).length;
    const soundBibleStatus: ProductionHubSectionStatus =
      sbVersion === 0
        ? "missing"
        : sbApproved
        ? "approved"
        : sbApprovedSceneCount > 0
        ? "partial"
        : "partial";
    const soundBibleDetail =
      sbVersion === 0
        ? "not generated"
        : sbApproved
        ? "full bible approved"
        : sbTotalSceneCount > 0
        ? `${sbApprovedSceneCount} of ${sbTotalSceneCount} scene rows approved`
        : "generated · draft";

    // --- Shot List + AI Video Prompts (read from script.metadata.aiPrompts)
    let shotApprovedCount = 0;
    let shotTotalCount = 0;
    let shotListStatus: ProductionHubSectionStatus = "missing";
    let shotListDetail = "no briefs";
    let aiPromptsStatus: ProductionHubSectionStatus = "missing";
    let aiPromptsDetail = "no prompts";
    if (currentScript) {
      const ai = (scriptMeta.aiPrompts as Record<string, unknown> | undefined) ?? {};
      const briefs =
        (ai.briefs as Record<string, Record<string, unknown>> | undefined) ?? {};
      const shotListApproval =
        (scriptMeta.shotListApproval as
          | {
              shots?: Record<string, { approvedAt: string }>;
              scenes?: Record<string, { approvedAt: string }>;
              episode?: { approvedAt: string } | null;
            }
          | undefined) ?? undefined;

      for (const [ordStr, sceneBriefs] of Object.entries(briefs)) {
        for (const idxStr of Object.keys(sceneBriefs as Record<string, unknown>)) {
          shotTotalCount += 1;
          const k = `${ordStr}-${idxStr}`;
          if (
            shotListApproval?.shots?.[k] ||
            shotListApproval?.scenes?.[ordStr] ||
            shotListApproval?.episode
          ) {
            shotApprovedCount += 1;
          }
        }
      }

      if (shotTotalCount > 0) {
        shotListStatus =
          shotListApproval?.episode
            ? "approved"
            : shotApprovedCount === shotTotalCount
            ? "approved"
            : shotApprovedCount > 0
            ? "partial"
            : "partial";
        shotListDetail = `${shotApprovedCount} of ${shotTotalCount} approved`;
      }

      // AI Video Prompts — count generated/approved prompt entries.
      const prompts =
        (ai.prompts as Record<string, Record<string, Record<string, unknown>>> | undefined) ?? {};
      let promptsGenerated = 0;
      let promptsApproved = 0;
      for (const sceneMap of Object.values(prompts)) {
        for (const shotMap of Object.values(sceneMap)) {
          for (const modelEntry of Object.values(shotMap)) {
            if (modelEntry && typeof modelEntry === "object") {
              promptsGenerated += 1;
              const m = modelEntry as Record<string, unknown>;
              if (m.approvedAt) promptsApproved += 1;
            }
          }
        }
      }
      if (promptsGenerated === 0 && shotTotalCount === 0) {
        aiPromptsStatus = "missing";
        aiPromptsDetail = "no prompts generated";
      } else if (promptsGenerated === 0) {
        aiPromptsStatus = "missing";
        aiPromptsDetail = "shot list exists, no prompts yet";
      } else {
        aiPromptsStatus = promptsApproved > 0 ? (promptsApproved === promptsGenerated ? "approved" : "partial") : "partial";
        aiPromptsDetail = `${promptsApproved} of ${promptsGenerated} prompts approved`;
      }
    }

    // --- Trailer Pack (episode-scoped)
    const tp = trailerBuilders[episodeId] as Record<string, unknown> | undefined;
    const tpVersion = (tp?.version as number | undefined) ?? 0;
    const tpApproved = (tp?.approvedAt as string | null | undefined) ?? null;
    const trailerStatus: ProductionHubSectionStatus =
      tpVersion === 0 ? "missing" : tpApproved ? "approved" : "partial";
    const trailerDetail = tpVersion === 0 ? "not generated" : tpApproved ? "pack approved" : "generated · draft";

    // --- Production package readiness
    // The package can be built any time the screenplay exists. We treat
    // "ready" as: screenplay present (locked or draft).
    const packageStatus: ProductionHubSectionStatus = !currentScript
      ? "missing"
      : scriptIsLocked
      ? "complete"
      : "partial";
    const packageDetail = !currentScript
      ? "needs a screenplay first"
      : scriptIsLocked
      ? "ready · locked source"
      : "ready · draft source";

    // --- Readiness score
    const sectionScores = {
      screenplay: scoreFromStatus(screenplayStatus),
      characters: scoreFromStatus(charactersStatus),
      locations: scoreFromStatus(locationsStatus),
      props: scoreFromStatus(propsStatus),
      soundBible: scoreFromStatus(soundBibleStatus),
      shotList: scoreFromStatus(shotListStatus),
      aiVideoPrompts: scoreFromStatus(aiPromptsStatus),
      trailerPack: scoreFromStatus(trailerStatus),
      packageReady: scoreFromStatus(packageStatus),
    };
    const readinessPct = Math.round(
      (sectionScores.screenplay * WEIGHTS.screenplay +
        sectionScores.characters * WEIGHTS.characters +
        sectionScores.locations * WEIGHTS.locations +
        sectionScores.props * WEIGHTS.props +
        sectionScores.soundBible * WEIGHTS.soundBible +
        sectionScores.shotList * WEIGHTS.shotList +
        sectionScores.aiVideoPrompts * WEIGHTS.aiVideoPrompts +
        sectionScores.trailerPack * WEIGHTS.trailerPack +
        sectionScores.packageReady * WEIGHTS.packageReady) *
        100
    );

    rows.push({
      episodeId,
      episodeNumber: (ep.number as number) ?? null,
      episodeTitle: (ep.title as string | null) ?? null,
      scriptId: (currentScript?.id as string | null) ?? null,
      scriptDraftNumber: (currentScript?.draft_number as number | null) ?? null,
      sections: {
        screenplay: { status: screenplayStatus, detail: screenplayDetail },
        characters: { status: charactersStatus, detail: charactersDetail },
        locations: { status: locationsStatus, detail: locationsDetail },
        props: { status: propsStatus, detail: propsDetail },
        soundBible: { status: soundBibleStatus, detail: soundBibleDetail },
        shotList: {
          status: shotListStatus,
          detail: shotListDetail,
          approvedCount: shotApprovedCount,
          totalCount: shotTotalCount,
        },
        aiVideoPrompts: { status: aiPromptsStatus, detail: aiPromptsDetail },
        trailerPack: { status: trailerStatus, detail: trailerDetail },
        packageReady: { status: packageStatus, detail: packageDetail },
      },
      readinessPct,
      lockedWritingDraft: scriptIsLocked,
    });
  }

  // Project-level summary across the episode rows.
  const summary: ProductionHubSummary = {
    episodeCount: rows.length,
    lockedScripts: rows.filter((r) => r.lockedWritingDraft).length,
    approvedSoundBibles: rows.filter((r) => r.sections.soundBible.status === "approved").length,
    approvedShotLists: rows.filter((r) => r.sections.shotList.status === "approved").length,
    generatedTrailers: rows.filter(
      (r) => r.sections.trailerPack.status === "approved" || r.sections.trailerPack.status === "partial"
    ).length,
    packagesReady: rows.filter(
      (r) => r.sections.packageReady.status === "complete" || r.sections.packageReady.status === "partial"
    ).length,
    overallReadinessPct:
      rows.length === 0
        ? 0
        : Math.round(rows.reduce((acc, r) => acc + r.readinessPct, 0) / rows.length),
  };

  return {
    projectId,
    projectTitle,
    projectType,
    pitchStatus,
    pitchDetail: pitchHasDecks ? "pitch deck has slides" : pitch ? "pitch present · no decks" : "no pitch materials",
    rows,
    summary,
  };
}
