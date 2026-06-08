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
import { supabase } from "../../db/client.js";
import { runScriptDoctor } from "../../draft/scriptDoctor.js";
import { runContinuityPass } from "../../draft/continuityPass.js";
import { runProductionPass } from "../../draft/productionPass.js";
import { parseFountain } from "../../screenplay/fountain.js";
import { getCanonicalCast, persistCastFromTreatment } from "../../draft/cast.js";
import { conceptAgent } from "../../agents/concept.js";
import { plotAgent } from "../../agents/plot.js";
import { sceneAgent } from "../../agents/scene.js";
import { dialogueAgent } from "../../agents/dialogue.js";
import { behaviorAgent } from "../../agents/behavior.js";
import { subtextAgent } from "../../agents/subtext.js";
import { runAgent } from "../../agents/runner.js";
import { hydrateContext } from "../hydrate.js";
import { postRoomMessage } from "../room.js";
import type { Stage, StageContext, StageResult } from "../types.js";

/**
 * Render an arbitrary nested object/array/primitive as readable plain prose
 * (markdown-light). Used to recover when an LLM emits structured data inside
 * a field that the schema expected to be plain text.
 */
function renderProse(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (v && typeof v === "object") {
          const rendered = renderProse(v, depth + 1);
          // Indent multi-line entries so they read as one bullet.
          return `- ${rendered.replace(/\n/g, "\n  ")}`;
        }
        return `- ${String(v)}`;
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== null && v !== undefined && v !== ""
    );
    if (entries.length === 0) return "";

    // If the object has a name/title + a description-like field, lead with
    // those — produces a much more readable section than alphabetical keys.
    const obj = value as Record<string, unknown>;
    const heading =
      (typeof obj.name === "string" && obj.name) ||
      (typeof obj.title === "string" && obj.title) ||
      null;
    const lead =
      (typeof obj.description === "string" && obj.description) ||
      (typeof obj.summary === "string" && obj.summary) ||
      null;

    const parts: string[] = [];
    if (heading) parts.push(depth === 0 ? `**${heading}**` : heading);
    if (lead) parts.push(lead);

    for (const [k, v] of entries) {
      if (k === "name" || k === "title" || k === "description" || k === "summary") continue;
      const label = humanLabel(k);
      const rendered = renderProse(v, depth + 1);
      if (!rendered) continue;
      if (rendered.includes("\n")) {
        parts.push(`**${label}:**\n${rendered}`);
      } else {
        parts.push(`**${label}:** ${rendered}`);
      }
    }
    return parts.join("\n\n");
  }
  return String(value);
}

function humanLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Pull a string-valued field from a record using a list of candidate keys.
 * Used when the Plot agent emits content under alternate names (e.g. it uses
 * `logline` where the schema wants `premise`).
 */
function pickString(
  obj: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Pull an array-valued field from a record using a list of candidate keys.
 */
function pickArray(
  obj: Record<string, unknown>,
  keys: string[]
): unknown[] | null {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) return v;
  }
  return null;
}

/**
 * Render any non-string value to readable prose so it can live inside a
 * schema field that expected a string.
 */
function asProse(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  return renderProse(v);
}

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
    let idea = ctx.prompt?.trim() ?? "";
    if (!idea) {
      const { data: project } = await supabase
        .from("projects")
        .select("logline, title")
        .eq("id", ctx.projectId)
        .maybeSingle();
      idea = project?.logline?.trim() || project?.title?.trim() || "";
    }
    if (!idea) {
      throw new Error(
        "This workflow needs a seed idea. Add one in the 'Seed idea' field when starting the workflow, or set a logline on the project."
      );
    }
    return {
      artifact: { idea },
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

    const { output } = await runAgent(
      concept,
      { idea, critique: ctx.revisionNote },
      aCtx
    );
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
      critique: ctx.revisionNote,
      brief: [
        "Write a 250-400 word prose synopsis of the story.",
        "Put the full synopsis text in the `treatment.premise` field.",
        "Set `treatment.title` to a working title. Leave `acts` and `protagonists` empty unless you have strong opinions.",
        "",
        `Premise from the Concept agent:\n${pack?.premise ?? ""}`,
        "",
        `Logline variants:\n${(pack?.loglines ?? []).map((l) => `• ${l.text}`).join("\n")}`,
      ].join("\n"),
    }, aCtx);

    const candidates = [
      output.treatment?.premise,
      output.treatment?.worldStatement,
      ...(output.treatment?.acts ?? []).map((a) => a.summary),
      ...(output.treatment?.protagonists ?? []).map((p) => p.summary),
      ...(output.notes ?? []),
    ]
      .map((s) => (s ?? "").trim())
      .filter((s) => s.length > 0);

    const synopsis = candidates.join("\n\n").trim();
    if (synopsis.length < 20) {
      throw new Error(
        "The Plot agent did not return a usable synopsis. Try clicking Advance again, or reject the logline and regenerate."
      );
    }

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
    const { data: projRow } = await supabase
      .from("projects")
      .select("kind")
      .eq("id", ctx.projectId)
      .maybeSingle();
    const projectKind = (projRow?.kind as string) ?? "";
    const { output } = await runAgent(plot, {
      intent: "treatment",
      critique: ctx.revisionNote,
      brief: [
        "Produce a complete, professional development treatment — this is the",
        "single source of truth the script, pitch deck, lookbook and production",
        "package will all build from. Be concrete and specific.",
        "",
        "Return a JSON `result` shaped exactly:",
        "{",
        '  "treatment": {',
        '    "title": "<the strongest working title>",',
        '    "titleOptions": ["<3-5 alternative titles>"],',
        '    "logline": "<one-sentence logline>",',
        '    "format": "<feature | limited series | series | pilot | short>",',
        '    "genre": "<primary genre + any blend>",',
        '    "tone": "<the tonal target, e.g. prestige horror / dark satire>",',
        '    "premise": "<2-3 paragraph premise>",',
        '    "shortSynopsis": "<one tight paragraph synopsis>",',
        '    "treatmentProse": "<the FULL prose treatment, several paragraphs walking the whole story start to finish>",',
        '    "worldStatement": "<world / rules / central phenomenon>",',
        '    "centralConflict": "<the core dramatic conflict driving the story>",',
        '    "emotionalEngine": "<what keeps the audience emotionally invested; the recurring emotional pull>",',
        '    "protagonists": [{ "name": "...", "role": "...", "summary": "..." }],',
        '    "acts": [{ "number": 1, "goal": "...", "turn": "...", "summary": "..." }],',
        '    "endingHook": "<how it ends / the hook that leaves the audience wanting more>",',
        '    "visualTone": "<the visual language: palette, texture, camera feel>",',
        '    "seriesEngine": "<ONLY if this is a series: the repeatable engine that generates new stories each episode/season; otherwise empty string>",',
        '    "themes": ["..."]',
        "  }",
        "}",
        "",
        projectKind
          ? `This project's format is "${projectKind}". If it is a feature or short, leave seriesEngine empty and focus acts on the feature structure. If it is a series/pilot/miniseries, fill seriesEngine and frame acts as the pilot/episode structure.`
          : "If this is a feature, leave seriesEngine empty; if a series, fill it.",
        "Honor the Showrunner notes above. Lead with the people, not the metaphysics.",
        "Do not leave treatmentProse empty — it is the heart of the document.",
        "",
        "Synopsis to expand:",
        syn,
      ].join("\n"),
    }, aCtx, { maxTokens: 16000, maxToolRounds: 1 });

    if (!output.treatment) {
      // The LLM frequently flattens the treatment to the top level of `output`
      // and uses adjacent field names (logline, central_phenomenon, etc.)
      // instead of the schema's exact keys. Reconstruct a usable Treatment
      // from whatever the model actually produced.
      const flat = output as unknown as Record<string, unknown>;
      const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
      const stringify = (v: unknown): string | null => {
        if (typeof v === "string") return v.trim() || null;
        if (v && typeof v === "object") return renderProse(v).trim() || null;
        return null;
      };

      const title = str(flat.title) ?? str(flat.workingTitle) ?? null;
      const premiseParts = [
        str(flat.premise),
        str(flat.logline),
        str(flat.format),
      ].filter(Boolean) as string[];
      const phenom = flat.central_phenomenon ?? flat.centralPhenomenon;
      const worldParts = [
        str(flat.worldStatement),
        str(flat.world),
        stringify(phenom),
        stringify(flat.mythology),
        stringify(flat.mythology_rules),
      ].filter(Boolean) as string[];
      const themeArr = Array.isArray(flat.themes)
        ? (flat.themes as unknown[]).filter((t): t is string => typeof t === "string")
        : [];
      const protArr = Array.isArray(flat.protagonists)
        ? (flat.protagonists as Record<string, unknown>[]).map((p) => ({
            name: typeof p?.name === "string" ? p.name : "Unnamed",
            role: typeof p?.role === "string" ? p.role : "",
            summary:
              stringify(p?.summary) ??
              stringify(p?.description) ??
              stringify(p?.arc) ??
              "",
          }))
        : [];
      const actArr = Array.isArray(flat.acts)
        ? (flat.acts as Record<string, unknown>[]).map((a, i) => ({
            number: typeof a?.number === "number" ? a.number : i + 1,
            goal: typeof a?.goal === "string" ? a.goal : "",
            turn: typeof a?.turn === "string" ? a.turn : "",
            summary: stringify(a?.summary) ?? stringify(a?.description) ?? "",
          }))
        : [];

      const strArr = (v: unknown): string[] =>
        Array.isArray(v) ? (v.filter((x): x is string => typeof x === "string")) : [];
      const hasContent = title || premiseParts.length > 0 || worldParts.length > 0;
      if (hasContent) {
        return {
          artifact: {
            title: title ?? "Untitled treatment",
            titleOptions: strArr(flat.titleOptions ?? flat.title_options),
            logline: str(flat.logline) ?? "",
            format: str(flat.format) ?? "",
            genre: str(flat.genre) ?? "",
            tone: str(flat.tone) ?? "",
            premise:
              premiseParts.join("\n\n") ||
              "(no premise text returned; see World section below)",
            shortSynopsis:
              str(flat.shortSynopsis) ?? str(flat.short_synopsis) ?? str(flat.synopsis) ?? "",
            treatmentProse:
              stringify(flat.treatmentProse) ??
              stringify(flat.treatment_prose) ??
              stringify(flat.treatment) ??
              "",
            worldStatement: worldParts.join("\n\n"),
            centralConflict:
              str(flat.centralConflict) ?? str(flat.central_conflict) ?? str(flat.conflict) ?? "",
            emotionalEngine:
              str(flat.emotionalEngine) ?? str(flat.emotional_engine) ?? "",
            protagonists: protArr,
            acts: actArr,
            endingHook:
              str(flat.endingHook) ?? str(flat.ending_hook) ?? str(flat.ending) ?? str(flat.hook) ?? "",
            visualTone: str(flat.visualTone) ?? str(flat.visual_tone) ?? "",
            seriesEngine:
              str(flat.seriesEngine) ?? str(flat.series_engine) ?? "",
            themes: themeArr,
          },
          awaitingApproval: this.requiresApproval,
        };
      }
      const fallback = (output.notes ?? []).join("\n\n").trim();
      if (fallback.length >= 40) {
        return {
          artifact: {
            title: "Untitled treatment",
            premise: fallback,
            worldStatement: "",
            protagonists: [],
            acts: [],
            themes: [],
          },
          awaitingApproval: this.requiresApproval,
        };
      }
      // eslint-disable-next-line no-console
      console.error(
        "[stage:treatment] plot agent returned no usable treatment. Raw output:",
        JSON.stringify(output, null, 2)
      );
      throw new Error(
        "The Plot agent did not return a structured treatment. Click Advance again to retry — the agent now has tighter formatting instructions."
      );
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
    // Auto-populate the Character Bible from the treatment's protagonists so a
    // canonical cast exists to lock against during drafting.
    await persistCastFromTreatment(ctx.projectId, output.treatment);
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
      critique: ctx.revisionNote,
      brief: [
        "Build the full Season 1 arc.",
        "",
        "Return a JSON `result` shaped exactly:",
        "{",
        '  "seasonArc": {',
        '    "seasonNumber": 1,',
        '    "title": "<series title>",',
        '    "premise": "<one paragraph season premise>",',
        '    "throughline": "<the central question/arc that pulls the audience through the season>",',
        '    "episodes": [',
        '      { "number": 1, "title": "...", "logline": "...", "tentpole": false },',
        '      ...',
        "    ]",
        "  }",
        "}",
        "",
        "Honor the Showrunner notes above. Lead with the people, not the metaphysics.",
        "Episode count: 8-10 unless the showrunner notes specify otherwise.",
        "Mark tentpole episodes (cold open, midpoint, all-is-lost, climax) with tentpole=true.",
        "",
        "Treatment to expand:",
        JSON.stringify(t, null, 2),
      ].join("\n"),
    }, aCtx, { maxTokens: 12000, maxToolRounds: 1 });

    if (!output.seasonArc) {
      const flat = output as unknown as Record<string, unknown>;

      const title =
        pickString(flat, ["title", "seriesTitle", "workingTitle"]) ??
        t?.title ??
        "Untitled season";
      const premise =
        pickString(flat, ["premise", "logline", "summary"]) ??
        t?.premise ??
        "";
      const throughline =
        pickString(flat, [
          "throughline",
          "through_line",
          "season_throughline",
          "central_question",
          "mystery_engine",
        ]) ??
        asProse(flat.central_phenomenon ?? flat.centralPhenomenon ?? null) ??
        "";

      // Episodes can be under many names — the Plot agent is wildly inconsistent.
      const epSource =
        pickArray(flat, [
          "episodes",
          "episode_arc",
          "episode_outlines",
          "episode_breakdown",
          "episode_summaries",
          "episode_summary",
          "season_structure",
          "season_breakdown",
          "arc",
          "season",
          "episodeList",
        ]) ?? [];
      const episodes = epSource.map((raw, i) => {
        const e = (raw ?? {}) as Record<string, unknown>;
        // Logline can come from explicit field, structure_note, or the first
        // beat's description if the model produced beats-per-episode.
        let logline =
          pickString(e, [
            "logline",
            "summary",
            "description",
            "body",
            "synopsis",
            "structure_note",
          ]) ?? "";
        if (!logline && Array.isArray(e.beats) && e.beats.length > 0) {
          const first = (e.beats as Record<string, unknown>[])[0];
          if (typeof first?.description === "string") logline = first.description;
        }
        if (!logline) logline = asProse(e);
        return {
          number:
            typeof e.number === "number"
              ? e.number
              : typeof e.episode === "number"
              ? e.episode
              : typeof e.episodeNumber === "number"
              ? e.episodeNumber
              : i + 1,
          title:
            pickString(e, ["title", "episode_title", "name"]) ??
            `Episode ${i + 1}`,
          logline,
          tentpole: typeof e.tentpole === "boolean" ? e.tentpole : undefined,
        };
      });

      if (premise || episodes.length > 0) {
        return {
          artifact: {
            seasonNumber: 1,
            title,
            premise,
            throughline,
            episodes,
          },
          awaitingApproval: this.requiresApproval,
        };
      }
      // eslint-disable-next-line no-console
      console.error(
        "[stage:season_arc] plot agent returned no usable seasonArc. Raw output:",
        JSON.stringify(output, null, 2)
      );
      throw new Error(
        "The Plot agent did not return a structured season arc. Click Advance again to retry."
      );
    }
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
    // Target the episode this workflow is scoped to (episode-scoped workflow).
    // Fall back to the first episode for a legacy project-scoped workflow.
    const targetEp =
      (ctx.episodeNumber != null
        ? arc?.episodes?.find((e) => e.number === ctx.episodeNumber)
        : undefined) ?? arc?.episodes?.[0];
    if (!targetEp) throw new Error("No episodes in season arc");
    const plot = plotAgent;
    const aCtx = await hydrateContext({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId,
      stage: "episode_outline",
      collaborators: STAGE_AGENTS.episode_outline,
      query: targetEp.logline,
      user: ctx.user,
      episodeNumber: ctx.episodeNumber ?? targetEp.number,
    });
    const { output } = await runAgent(plot, {
      intent: "episode_outline",
      critique: ctx.revisionNote,
      brief: [
        `Outline Episode ${targetEp.number} — "${targetEp.title}".`,
        `Logline: ${targetEp.logline}`,
        "",
        "Return a JSON `result` shaped exactly:",
        "{",
        '  "episodeOutline": {',
        `    "episodeNumber": ${targetEp.number},`,
        `    "title": "${targetEp.title.replace(/"/g, '\\"')}",`,
        '    "logline": "<one-sentence episode logline>",',
        '    "cold_open": "<optional pre-titles teaser>",',
        '    "acts": [',
        '      { "number": 1, "summary": "<what happens this act>", "turn": "<the act-out>" },',
        "      ...",
        "    ],",
        '    "tag": "<optional final scene/button>"',
        "  }",
        "}",
        "",
        "Acts: 4-5 acts for hour-long prestige TV. Each act needs a turn.",
        "",
        "Full season arc for context:",
        JSON.stringify(arc, null, 2),
      ].join("\n"),
    }, aCtx, { maxTokens: 8000, maxToolRounds: 1 });

    if (!output.episodeOutline) {
      const flat = output as unknown as Record<string, unknown>;
      const acts = pickArray(flat, ["acts", "structure", "beats", "act_breakdown"]) ?? [];
      const recoveredActs = acts.map((raw, i) => {
        const a = (raw ?? {}) as Record<string, unknown>;
        return {
          number: typeof a.number === "number" ? a.number : i + 1,
          summary:
            pickString(a, ["summary", "description", "body", "content"]) ??
            asProse(a),
          turn:
            pickString(a, ["turn", "act_out", "cliffhanger", "twist"]) ?? "",
        };
      });
      const recovered = {
        episodeNumber:
          typeof flat.episodeNumber === "number"
            ? (flat.episodeNumber as number)
            : typeof flat.episode === "number"
            ? (flat.episode as number)
            : targetEp.number,
        title: pickString(flat, ["title", "episode_title"]) ?? targetEp.title,
        logline:
          pickString(flat, ["logline", "summary"]) ?? targetEp.logline,
        cold_open: pickString(flat, ["cold_open", "coldOpen", "teaser"]) ?? undefined,
        acts: recoveredActs,
        tag: pickString(flat, ["tag", "button", "ending"]) ?? undefined,
      };
      if (recovered.logline || recovered.acts.length > 0) {
        return { artifact: recovered, awaitingApproval: this.requiresApproval };
      }
      // eslint-disable-next-line no-console
      console.error(
        "[stage:episode_outline] plot agent returned no usable outline. Raw output:",
        JSON.stringify(output, null, 2)
      );
      throw new Error("The Plot agent did not return a structured episode outline. Click Advance again to retry.");
    }
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
      episodeNumber: ctx.episodeNumber ?? outline?.episodeNumber,
    });
    const { output } = await runAgent(plot, {
      intent: "beat_sheet",
      critique: ctx.revisionNote,
      brief: [
        "Produce the beat sheet for this episode.",
        "",
        "Return a JSON `result` shaped exactly:",
        "{",
        '  "beatSheet": {',
        `    "episodeNumber": ${outline?.episodeNumber ?? 1},`,
        '    "beats": [',
        '      { "id": "b1", "order": 1, "type": "opening_image", "body": "..." },',
        '      { "id": "b2", "order": 2, "type": "setup", "body": "..." },',
        "      ...",
        "    ]",
        "  }",
        "}",
        "",
        "Beat types: opening_image | setup | inciting_incident | act_break | midpoint | all_is_lost | climax | resolution | tag | custom.",
        "Aim for 15-25 beats. Each beat is a single concrete dramatic moment.",
        "",
        "Episode outline:",
        JSON.stringify(outline, null, 2),
      ].join("\n"),
    }, aCtx, { maxTokens: 8000, maxToolRounds: 1 });

    if (!output.beatSheet) {
      const flat = output as unknown as Record<string, unknown>;
      const rawBeats =
        pickArray(flat, ["beats", "beat_sheet", "structure", "sequence"]) ?? [];
      const beats = rawBeats.map((raw, i) => {
        const b = (raw ?? {}) as Record<string, unknown>;
        const validTypes = [
          "opening_image",
          "setup",
          "inciting_incident",
          "act_break",
          "midpoint",
          "all_is_lost",
          "climax",
          "resolution",
          "tag",
          "custom",
        ];
        const typeRaw = typeof b.type === "string" ? b.type : "custom";
        return {
          id: typeof b.id === "string" ? b.id : `b${i + 1}`,
          order: typeof b.order === "number" ? b.order : i + 1,
          type: validTypes.includes(typeRaw) ? typeRaw : "custom",
          body:
            pickString(b, ["body", "description", "summary", "content"]) ??
            asProse(b),
        };
      });
      if (beats.length > 0) {
        return {
          artifact: {
            episodeNumber: outline?.episodeNumber ?? 1,
            beats,
          },
          awaitingApproval: this.requiresApproval,
        };
      }
      // eslint-disable-next-line no-console
      console.error(
        "[stage:beat_sheet] plot agent returned no usable beats. Raw output:",
        JSON.stringify(output, null, 2)
      );
      throw new Error("The Plot agent did not return a structured beat sheet. Click Advance again to retry.");
    }
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
    const list = ctx.previousArtifacts.scene_list as z.infer<typeof SceneList> & {
      ready_for_draft?: boolean;
    };
    if (!list?.ready_for_draft) {
      throw new Error(
        "Scene list is not marked ready for draft. Open the project overview, expand the Scene List in 'Completed stages', and click 'Enrich scene list' before generating a draft."
      );
    }
    // Pilot mode: caller can pass `prompt: "pilot"` (or "pilot:N") to limit
    // the draft to the first N scenes. Default N=1.
    const pilotMatch =
      typeof ctx.prompt === "string" ? ctx.prompt.match(/^pilot(?::(\d+))?$/) : null;
    const pilotScenes = pilotMatch ? Math.max(1, parseInt(pilotMatch[1] ?? "1", 10)) : null;
    const scenesToRun = pilotScenes
      ? list.scenes.slice(0, pilotScenes)
      : list.scenes;

    const scene = sceneAgent;
    const dialogue = dialogueAgent;
    const fountainParts: string[] = [];
    // Tight agent options for draft work — these stages are run in a tight
    // loop, so we cap retries and tokens per call to keep cost predictable.
    const draftOpts = { maxToolRounds: 1, maxTokens: 4096 };
    // Lock the cast so scene names can't drift during the full draft.
    const cast = await getCanonicalCast(ctx.projectId);

    for (const spec of scenesToRun) {
      // Skip any leftover placeholder scenes that slipped past enrichment so
      // we never burn LLM calls on `INT. PLACEHOLDER - DAY`.
      if (
        !spec.slugline ||
        spec.location === "PLACEHOLDER" ||
        spec.slugline.includes("PLACEHOLDER")
      ) {
        continue;
      }
      const aCtx = await hydrateContext({
        projectId: ctx.projectId,
        workflowId: ctx.workflowId,
        stage: "draft_v1",
        collaborators: STAGE_AGENTS.draft_v1,
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
        cast,
      }, aCtx, draftOpts);
      const sceneFountain = extractFountain(draft.output);
      if (!sceneFountain) {
        fountainParts.push(skipMarker(spec, "Scene agent"));
        continue;
      }
      const pass = await runAgent(dialogue, {
        intent: "pass",
        sceneFountain,
        characters: spec.characters,
      }, aCtx, draftOpts);
      const afterDialogue = extractFountain(pass.output) ?? sceneFountain;
      // --- Emotional Intelligence Layer: behavior → subtext ---
      // The full Emotional Truth + Relationship Tension pass runs after
      // scenes are persisted (in /scripts/:id/emotional/pass) so the
      // SceneEmotionalState rows can be linked to real script_scenes.id.
      const beh = await runAgent(behaviorAgent, {
        sceneFountain: afterDialogue,
        characters: spec.characters,
        replaceStatedEmotion: true,
      }, aCtx, draftOpts);
      const afterBehavior = extractFountain(beh.output) ?? afterDialogue;
      const sub = await runAgent(subtextAgent, {
        sceneFountain: afterBehavior,
        characters: spec.characters,
        preferAction: true,
      }, aCtx, draftOpts);
      const finalFountain = extractFountain(sub.output) ?? afterBehavior;
      fountainParts.push(finalFountain);
    }
    const fountain = fountainParts.join("\n\n") || "(no scenes drafted)";

    // Sync the draft into the `scripts` table so it appears in the Drafts
    // page and the editor. The workflow's draft lives in
    // workflow_stage_artifacts, but the Drafts UI + exports read `scripts`.
    // Create a fresh draft row (marking prior ones non-current) and index its
    // scenes so the per-scene workspace works on it too.
    try {
      await syncDraftToScripts(ctx.projectId, fountain, ctx.episodeId ?? null);
    } catch (err) {
      // Non-fatal: the artifact is still saved by the runner. Surface in logs.
      // eslint-disable-next-line no-console
      console.warn(
        "[stage:draft_v1] failed to sync draft to scripts table:",
        (err as Error).message
      );
    }

    return { artifact: { fountain }, awaitingApproval: this.requiresApproval };
  },
};

/**
 * Persist a workflow-generated draft into the `scripts` table (and index its
 * scenes) so it shows up in the Drafts UI, the editor, and exports.
 */
async function syncDraftToScripts(
  projectId: string,
  fountain: string,
  episodeId: string | null
) {
  const { data: proj } = await supabase
    .from("projects")
    .select("title")
    .eq("id", projectId)
    .maybeSingle();

  // Next draft number — SCOPED TO (project_id, episode_id). Episode 1's
  // first draft is Draft 1 even if the project also has a legacy Draft 1
  // with episode_id=null.
  let existingQ = supabase
    .from("scripts")
    .select("draft_number")
    .eq("project_id", projectId)
    .order("draft_number", { ascending: false })
    .limit(1);
  existingQ = episodeId ? existingQ.eq("episode_id", episodeId) : existingQ.is("episode_id", null);
  const { data: existing } = await existingQ;
  const nextNum = (existing?.[0]?.draft_number ?? 0) + 1;

  // Demote prior drafts in the SAME scope only — every episode keeps its
  // own current script (season-level scoring reads one per episode).
  const demote = supabase
    .from("scripts")
    .update({ current: false })
    .eq("project_id", projectId);
  await (episodeId ? demote.eq("episode_id", episodeId) : demote.is("episode_id", null));

  // Compose a display title that respects Episode N : Title — Draft N.
  const ep = episodeId
    ? (
        await supabase
          .from("episodes")
          .select("number, title")
          .eq("id", episodeId)
          .maybeSingle()
      ).data
    : null;
  const epLabel = ep ? `Episode ${ep.number}${ep.title ? `: ${ep.title}` : ""}` : null;
  const draftTitle = epLabel
    ? `${proj?.title ?? "Untitled"} — ${epLabel} — Draft ${nextNum}`
    : `${proj?.title ?? "Untitled"} — Draft ${nextNum}`;

  const { data: script, error } = await supabase
    .from("scripts")
    .insert({
      project_id: projectId,
      episode_id: episodeId,
      title: draftTitle,
      draft_number: nextNum,
      fountain,
      current: true,
      metadata: { source: "workflow_draft_v1" },
    })
    .select("id")
    .single();
  if (error) throw error;

  // Index scenes from the fountain so the per-scene workspace can operate.
  const parsed = parseFountain(fountain);
  if (parsed.scenes.length > 0) {
    await supabase.from("script_scenes").delete().eq("script_id", script.id);
    await supabase.from("script_scenes").insert(
      parsed.scenes.map((s) => ({
        script_id: script.id,
        ord: s.order,
        slugline: s.slugline,
        int_ext: s.intExt,
        time_of_day: s.timeOfDay,
        characters: [],
        summary: null,
        fountain: s.fountain,
        tags: [],
        status: "generated" as const,
        generated_at: new Date().toISOString(),
        last_pass: "subtext",
      }))
    );
  }
}

function nonEmpty(s: unknown): string | null {
  return typeof s === "string" && s.trim().length > 0 ? s : null;
}

/**
 * Pull a Fountain string out of an agent's output. The schema field is named
 * `fountain`, but the model frequently puts the screenplay under alternate
 * keys like `draft`, `text`, `script`, `screenplay`, or `scene`. Try all of
 * them before giving up.
 */
function extractFountain(output: unknown): string | null {
  const o = (output ?? {}) as Record<string, unknown>;
  const keys = ["fountain", "draft", "text", "screenplay", "script", "scene"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}

function skipMarker(
  spec: { slugline?: string; order?: number },
  agent: string
): string {
  return `${spec.slugline ?? "INT. UNKNOWN - DAY"}\n\n[${agent} failed for scene #${
    spec.order ?? "?"
  }. Skipped.]\n`;
}

// ---------------------------------------------------------------------------
// rewrite — Script Doctor diagnostic pass against the current script
// ---------------------------------------------------------------------------
export const rewriteStage: Stage<{
  diagnoses: unknown[];
  emotionalArcScore: number;
  scriptId?: string;
}> = {
  id: "rewrite",
  title: "Rewrite",
  requiresApproval: STAGE_REQUIRES_APPROVAL.rewrite,
  inputs: ["draft_v1"],
  agents: STAGE_AGENTS.rewrite,
  outputSchema: z.object({
    diagnoses: z.array(z.unknown()),
    emotionalArcScore: z.number().min(0).max(1).default(0.5),
    scriptId: z.string().optional(),
  }),
  async run(ctx) {
    // Find the current script for this project. Prefer `current=true`; if
    // none, fall back to the most recently updated script.
    const { data: scripts } = await supabase
      .from("scripts")
      .select("id, current, updated_at")
      .eq("project_id", ctx.projectId)
      .order("updated_at", { ascending: false });
    const target =
      (scripts ?? []).find((s) => s.current) ?? (scripts ?? [])[0];
    if (!target) {
      throw new Error(
        "No script exists for this project yet. Generate at least one scene before running Rewrite."
      );
    }
    const result = await runScriptDoctor(target.id, ctx.user);
    return {
      artifact: {
        diagnoses: result.diagnoses,
        emotionalArcScore: result.emotionalArcScore,
        scriptId: result.scriptId,
      },
      awaitingApproval: this.requiresApproval,
    };
  },
};

// ---------------------------------------------------------------------------
// continuity_pass — Continuity agent against the current draft
// ---------------------------------------------------------------------------
export const continuityPassStage: Stage<{
  issues: unknown[];
  scriptId?: string;
}> = {
  id: "continuity_pass",
  title: "Continuity Pass",
  requiresApproval: STAGE_REQUIRES_APPROVAL.continuity_pass,
  inputs: ["rewrite"],
  agents: STAGE_AGENTS.continuity_pass,
  outputSchema: z.object({
    issues: z.array(z.unknown()),
    scriptId: z.string().optional(),
  }),
  async run(ctx) {
    const { data: scripts } = await supabase
      .from("scripts")
      .select("id, current, updated_at")
      .eq("project_id", ctx.projectId)
      .order("updated_at", { ascending: false });
    const target =
      (scripts ?? []).find((s) => s.current) ?? (scripts ?? [])[0];
    if (!target) {
      throw new Error(
        "No script exists for this project yet. Generate at least one scene before running Continuity."
      );
    }
    const result = await runContinuityPass(target.id, ctx.user);
    return {
      artifact: {
        issues: result.issues,
        scriptId: result.scriptId,
      },
      awaitingApproval: false,
    };
  },
};

// ---------------------------------------------------------------------------
// production_draft — Producer + Showrunner
// ---------------------------------------------------------------------------
export const productionDraftStage: Stage<{
  estimate?: unknown;
  flags?: unknown[];
  aiGen?: unknown[];
  scriptId?: string;
}> = {
  id: "production_draft",
  title: "Production Draft",
  requiresApproval: STAGE_REQUIRES_APPROVAL.production_draft,
  inputs: ["continuity_pass"],
  agents: STAGE_AGENTS.production_draft,
  outputSchema: z.object({
    estimate: z.unknown().optional(),
    flags: z.array(z.unknown()).default([]),
    aiGen: z.array(z.unknown()).default([]),
    scriptId: z.string().optional(),
  }),
  async run(ctx) {
    const { data: scripts } = await supabase
      .from("scripts")
      .select("id, current, updated_at")
      .eq("project_id", ctx.projectId)
      .order("updated_at", { ascending: false });
    const target =
      (scripts ?? []).find((s) => s.current) ?? (scripts ?? [])[0];
    if (!target) {
      throw new Error(
        "No script exists for this project yet. Generate at least one scene before the Production pass."
      );
    }
    const report = await runProductionPass(target.id, ctx.user);
    return {
      artifact: {
        estimate: report.estimate,
        flags: report.flags,
        aiGen: report.aiGen,
        scriptId: report.scriptId,
      },
      awaitingApproval: this.requiresApproval,
    };
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
