import { z } from "zod";
import {
  BeatSheet,
  EpisodeOutline,
  LoglinePack,
  SceneList,
  SeasonArc,
  Treatment,
  STAGE_AGENTS,
  STAGE_REQUIRES_APPROVAL,
} from "@toburt/shared";
import type { WorkflowStageId } from "@toburt/shared";
import { conceptAgent } from "../../agents/concept.js";
import { plotAgent } from "../../agents/plot.js";
import { sceneAgent } from "../../agents/scene.js";
import { dialogueAgent } from "../../agents/dialogue.js";
import { runAgent } from "../../agents/runner.js";
import { hydrateContext } from "../hydrate.js";
import { postRoomMessage } from "../room.js";
import type { Stage, StageContext, StageResult } from "../types.js";

// ---------------------------------------------------------------------------
// idea — passthrough; the user's raw prompt becomes the artifact.
// ---------------------------------------------------------------------------
export const ideaStage: Stage<{ idea: string }> = {
  id: "idea",
  title: "Idea",
  requiresApproval: false,
  inputs: [],
  agents: [],
  outputSchema: z.object({ idea: z.string().min(1) }),
  async run(ctx) {
    return {
      artifact: { idea: ctx.prompt ?? "" },
      awaitingApproval: false,
    };
  },
};

// ---------------------------------------------------------------------------
// logline — Concept + Showrunner
// ---------------------------------------------------------------------------
export const loglineStage: Stage<z.infer<typeof LoglinePack>> = {
  id: "logline",
  title: "Logline",
  requiresApproval: STAGE_REQUIRES_APPROVAL.logline,
  inputs: ["idea"],
  agents: STAGE_AGENTS.logline,
  outputSchema: LoglinePack,
  async run(ctx) {
    const idea =
      (ctx.previousArtifacts.idea as { idea?: string })?.idea ?? ctx.prompt ?? "";
    const concept = conceptAgent;

    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "logline",
      collaborators: ["concept", "showrunner"],
      query: idea,
      user: ctx.user,
    });

    const { output } = await runAgent(concept, { idea }, aCtx);
    await postRoomMessage({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stageId: "logline",
      authorKind: "agent",
      authorRole: "concept",
      kind: "suggestion",
      body: output.loglines.map((l) => `• ${l.text}`).join("\n"),
      payload: output,
    });

    return { artifact: output, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// synopsis — Concept + Plot + Showrunner
// ---------------------------------------------------------------------------
export const synopsisStage: Stage<{ synopsis: string }> = {
  id: "synopsis",
  title: "Synopsis",
  requiresApproval: STAGE_REQUIRES_APPROVAL.synopsis,
  inputs: ["logline"],
  agents: STAGE_AGENTS.synopsis,
  outputSchema: z.object({ synopsis: z.string().min(20) }),
  async run(ctx) {
    const pack = ctx.previousArtifacts.logline as z.infer<typeof LoglinePack>;
    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "synopsis",
      collaborators: ["concept", "plot", "showrunner"],
      query: pack?.premise ?? "",
      user: ctx.user,
    });

    // Use the plot agent to draft a synopsis under its `treatment` intent in
    // brief mode — we only need 250-400 words here.
    const plot = plotAgent;
    const { output } = await runAgent(plot, {
      intent: "treatment",
      brief: `Write a 250-400 word synopsis derived from this premise:\n\n${pack?.premise}\n\nLoglines: ${pack?.loglines
        .map((l) => l.text)
        .join(" | ")}`,
    }, aCtx);

    const synopsis =
      output.treatment?.premise ??
      [output.treatment?.worldStatement, ...(output.notes ?? [])]
        .filter(Boolean)
        .join("\n\n") ??
      "";

    await postRoomMessage({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stageId: "synopsis",
      authorKind: "agent",
      authorRole: "plot",
      body: synopsis,
    });

    return {
      artifact: { synopsis },
      awaitingApproval: this.requiresApproval,
    };
  },
};

// ---------------------------------------------------------------------------
// treatment — Plot + Character + World + Showrunner
// ---------------------------------------------------------------------------
export const treatmentStage: Stage<z.infer<typeof Treatment>> = {
  id: "treatment",
  title: "Treatment",
  requiresApproval: STAGE_REQUIRES_APPROVAL.treatment,
  inputs: ["synopsis"],
  agents: STAGE_AGENTS.treatment,
  outputSchema: Treatment,
  async run(ctx) {
    const syn =
      (ctx.previousArtifacts.synopsis as { synopsis?: string })?.synopsis ?? "";
    const plot = plotAgent;
    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "treatment",
      collaborators: STAGE_AGENTS.treatment,
      query: syn,
      user: ctx.user,
    });
    const { output } = await runAgent(plot, {
      intent: "treatment",
      brief: `Produce the full treatment from this synopsis:\n${syn}`,
    }, aCtx);

    if (!output.treatment) {
      throw new Error("Plot agent failed to produce a treatment.");
    }
    await postRoomMessage({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stageId: "treatment",
      authorKind: "agent",
      authorRole: "plot",
      body: `Treatment draft ready: **${output.treatment.title}**`,
      payload: output.treatment,
    });
    return { artifact: output.treatment, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// season_arc — Plot + Character + World + Showrunner
// ---------------------------------------------------------------------------
export const seasonArcStage: Stage<z.infer<typeof SeasonArc>> = {
  id: "season_arc",
  title: "Season Arc",
  requiresApproval: STAGE_REQUIRES_APPROVAL.season_arc,
  inputs: ["treatment"],
  agents: STAGE_AGENTS.season_arc,
  outputSchema: SeasonArc,
  async run(ctx) {
    const t = ctx.previousArtifacts.treatment as z.infer<typeof Treatment>;
    const plot = plotAgent;
    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "season_arc",
      collaborators: STAGE_AGENTS.season_arc,
      query: t?.premise ?? "",
      user: ctx.user,
    });
    const { output } = await runAgent(plot, {
      intent: "season_arc",
      brief: `Build a Season 1 arc from this treatment:\n${JSON.stringify(t)}`,
    }, aCtx);
    if (!output.seasonArc) throw new Error("Plot agent failed to produce a seasonArc.");
    return { artifact: output.seasonArc, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// episode_outline — Plot + Character + Showrunner
// ---------------------------------------------------------------------------
export const episodeOutlineStage: Stage<z.infer<typeof EpisodeOutline>> = {
  id: "episode_outline",
  title: "Episode Outline",
  requiresApproval: STAGE_REQUIRES_APPROVAL.episode_outline,
  inputs: ["season_arc"],
  agents: STAGE_AGENTS.episode_outline,
  outputSchema: EpisodeOutline,
  async run(ctx) {
    const arc = ctx.previousArtifacts.season_arc as z.infer<typeof SeasonArc>;
    const targetEp = arc?.episodes?.[0];
    if (!targetEp) throw new Error("No episodes in season arc");
    const plot = plotAgent;
    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "episode_outline",
      collaborators: STAGE_AGENTS.episode_outline,
      query: targetEp.logline,
      user: ctx.user,
    });
    const { output } = await runAgent(plot, {
      intent: "episode_outline",
      brief: `Episode ${targetEp.number} — ${targetEp.title}\nLogline: ${targetEp.logline}\nFull arc: ${JSON.stringify(arc)}`,
    }, aCtx);
    if (!output.episodeOutline) throw new Error("Plot agent failed to produce an episodeOutline.");
    return { artifact: output.episodeOutline, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// beat_sheet — Plot + Scene + Showrunner
// ---------------------------------------------------------------------------
export const beatSheetStage: Stage<z.infer<typeof BeatSheet>> = {
  id: "beat_sheet",
  title: "Beat Sheet",
  requiresApproval: STAGE_REQUIRES_APPROVAL.beat_sheet,
  inputs: ["episode_outline"],
  agents: STAGE_AGENTS.beat_sheet,
  outputSchema: BeatSheet,
  async run(ctx) {
    const outline = ctx.previousArtifacts.episode_outline as z.infer<typeof EpisodeOutline>;
    const plot = plotAgent;
    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "beat_sheet",
      collaborators: STAGE_AGENTS.beat_sheet,
      query: outline?.logline ?? "",
      user: ctx.user,
    });
    const { output } = await runAgent(plot, {
      intent: "beat_sheet",
      brief: `Produce a beat sheet for: ${JSON.stringify(outline)}`,
    }, aCtx);
    if (!output.beatSheet) throw new Error("Plot agent failed to produce a beatSheet.");
    return { artifact: output.beatSheet, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// scene_list — Scene + Continuity (no approval gate)
// ---------------------------------------------------------------------------
export const sceneListStage: Stage<z.infer<typeof SceneList>> = {
  id: "scene_list",
  title: "Scene List",
  requiresApproval: STAGE_REQUIRES_APPROVAL.scene_list,
  inputs: ["beat_sheet"],
  agents: STAGE_AGENTS.scene_list,
  outputSchema: SceneList,
  async run(ctx) {
    const beats = ctx.previousArtifacts.beat_sheet as z.infer<typeof BeatSheet>;
    // Synthesize a scene list deterministically from beats (the Scene agent
    // will flesh out individual scenes in draft_v1).
    const scenes = beats.beats.map((b, i) => ({
      order: i + 1,
      slugline: `INT. PLACEHOLDER - DAY`,
      intExt: "INT" as const,
      location: "PLACEHOLDER",
      timeOfDay: "DAY",
      goal: b.body,
      conflict: "TBD",
      turn: "TBD",
      characters: [] as string[],
    }));
    return { artifact: { scenes }, awaitingApproval: false };
  },
};

// ---------------------------------------------------------------------------
// draft_v1 — Scene + Dialogue + Character + Continuity + Showrunner
// ---------------------------------------------------------------------------
export const draftV1Stage: Stage<{ fountain: string }> = {
  id: "draft_v1",
  title: "First Draft",
  requiresApproval: STAGE_REQUIRES_APPROVAL.draft_v1,
  inputs: ["scene_list"],
  agents: STAGE_AGENTS.draft_v1,
  outputSchema: z.object({ fountain: z.string().min(1) }),
  async run(ctx) {
    const list = ctx.previousArtifacts.scene_list as z.infer<typeof SceneList>;
    const scene = sceneAgent;
    const dialogue = dialogueAgent;
    const fountainParts: string[] = [];

    for (const spec of list.scenes) {
      const aCtx = await hydrateContext({
        projectId: ctx.projectId,
        workflowId: ctx.workflowId,
        stage: "draft_v1",
        collaborators: ["scene", "dialogue", "character", "continuity", "showrunner"],
        query: spec.goal,
        user: ctx.user,
      });
      const draft = await runAgent(scene, {
        intent: "draft",
        brief: {
          slugline: spec.slugline,
          goal: spec.goal,
          conflict: spec.conflict,
          turn: spec.turn,
          characters: spec.characters,
        },
      }, aCtx);
      const pass = await runAgent(dialogue, {
        intent: "pass",
        sceneFountain: draft.output.fountain,
        characters: spec.characters,
      }, aCtx);
      fountainParts.push(pass.output.fountain);
    }
    const fountain = fountainParts.join("\n\n");
    return { artifact: { fountain }, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// rewrite — Script Doctor + Dialogue + Showrunner
// ---------------------------------------------------------------------------
export const rewriteStage: Stage<{ diagnoses: unknown[] }> = {
  id: "rewrite",
  title: "Rewrite",
  requiresApproval: STAGE_REQUIRES_APPROVAL.rewrite,
  inputs: ["draft_v1"],
  agents: STAGE_AGENTS.rewrite,
  outputSchema: z.object({ diagnoses: z.array(z.unknown()) }),
  async run(_ctx) {
    // Script Doctor needs a real scriptId — this stage is invoked once
    // the orchestrator has persisted a script row. Returning empty here
    // when no scriptId is available is intentional; the routes layer will
    // re-trigger this stage after persisting the draft.
    return { artifact: { diagnoses: [] }, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// continuity_pass — Continuity + World
// ---------------------------------------------------------------------------
export const continuityPassStage: Stage<{ issues: unknown[] }> = {
  id: "continuity_pass",
  title: "Continuity Pass",
  requiresApproval: STAGE_REQUIRES_APPROVAL.continuity_pass,
  inputs: ["rewrite"],
  agents: STAGE_AGENTS.continuity_pass,
  outputSchema: z.object({ issues: z.array(z.unknown()) }),
  async run(_ctx) {
    return { artifact: { issues: [] }, awaitingApproval: false };
  },
};

// ---------------------------------------------------------------------------
// production_draft — Producer + Showrunner
// ---------------------------------------------------------------------------
export const productionDraftStage: Stage<{ approved: boolean }> = {
  id: "production_draft",
  title: "Production Draft",
  requiresApproval: STAGE_REQUIRES_APPROVAL.production_draft,
  inputs: ["continuity_pass"],
  agents: STAGE_AGENTS.production_draft,
  outputSchema: z.object({ approved: z.boolean() }),
  async run(_ctx) {
    return { artifact: { approved: true }, awaitingApproval: this.requiresApproval };
  },
};

// ---------------------------------------------------------------------------
// exports — terminal
// ---------------------------------------------------------------------------
export const exportsStage: Stage<{ formats: string[] }> = {
  id: "exports",
  title: "Exports",
  requiresApproval: false,
  inputs: ["production_draft"],
  agents: [],
  outputSchema: z.object({ formats: z.array(z.string()) }),
  async run(_ctx) {
    return {
      artifact: { formats: ["fountain", "pdf", "fdx", "markdown"] },
      awaitingApproval: false,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export const STAGES: Record<WorkflowStageId, Stage<any>> = {
  idea: ideaStage,
  logline: loglineStage,
  synopsis: synopsisStage,
  treatment: treatmentStage,
  season_arc: seasonArcStage,
  episode_outline: episodeOutlineStage,
  beat_sheet: beatSheetStage,
  scene_list: sceneListStage,
  draft_v1: draftV1Stage,
  rewrite: rewriteStage,
  continuity_pass: continuityPassStage,
  production_draft: productionDraftStage,
  exports: exportsStage,
};

export function getStage(id: WorkflowStageId): Stage {
  return STAGES[id];
}

export type { Stage, StageContext, StageResult };
