import { sceneAgent } from "../agents/scene.js";
import { dialogueAgent } from "../agents/dialogue.js";
import { behaviorAgent } from "../agents/behavior.js";
import { subtextAgent } from "../agents/subtext.js";
import { runAgent } from "../agents/runner.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { getCanonicalCast } from "./cast.js";
import { supabase } from "../db/client.js";
import { buildSceneBrief, type PromptCharacterState } from "./promptBuilder.js";
import type { CharacterDNA } from "./sceneAudit.js";

export type SceneDraftSpec = {
  slugline: string;
  goal: string;
  conflict: string;
  turn: string;
  characters: string[];
  /** Existing scene text. When present, the Scene agent REVISES it instead
   *  of writing fresh — preserving what works. */
  currentFountain?: string;
  /** The Doctor/Continuity note(s) driving this revision. */
  revisionNote?: string;
  /** Canonical context text (cast bible + prior canonical facts) for locked drafting. */
  canonicalContext?: string;
};

export type SceneDraftResult = {
  fountain: string;
  passes: { pass: "scene" | "dialogue" | "behavior" | "subtext"; ok: boolean }[];
  lastPass: "scene" | "dialogue" | "behavior" | "subtext";
};

/**
 * Run the four-pass draft chain for a single scene. Returns the final
 * fountain plus a per-pass log so the UI can show which passes succeeded.
 * Reuses the same defensive fallbacks as the orchestrator draft_v1 stage.
 */
export async function draftOneScene(
  projectId: string,
  spec: SceneDraftSpec,
  user?: { id: string; name?: string }
): Promise<SceneDraftResult> {
  const aCtx = await hydrateContext({
    projectId,
    stage: "draft_v1",
    collaborators: ["scene", "dialogue", "behavior", "subtext"],
    query: spec.goal,
    user,
  });
  const draftOpts = { maxToolRounds: 1, maxTokens: 4096 };
  const passes: SceneDraftResult["passes"] = [];

  // Lock the cast: the Scene agent may only use these canonical names.
  const cast = await getCanonicalCast(projectId);

  const isRevision =
    typeof spec.currentFountain === "string" &&
    spec.currentFountain.trim().length > 0;

  // Build the 9-section structured brief and prepend it to the canonical
  // context. The Scene agent already reads canonicalContext verbatim, so this
  // is the cleanest place to inject the structured prompt without forking the
  // agent's system prompt. DNA + tone are pulled here so every scene gets the
  // restraint contract baked in.
  const structuredBrief = await buildStructuredBrief(projectId, spec);
  const composedCanonicalContext = [structuredBrief, spec.canonicalContext]
    .filter((x): x is string => !!x && x.trim().length > 0)
    .join("\n\n");

  const draft = await runAgent(
    sceneAgent,
    {
      intent: isRevision ? "refine" : "draft",
      brief: {
        slugline: spec.slugline,
        goal: spec.goal,
        conflict: spec.conflict,
        turn: spec.turn,
        characters: spec.characters,
      },
      // Revision context — the agent revises currentFountain to address the
      // note rather than rewriting from scratch.
      currentFountain: isRevision ? spec.currentFountain : undefined,
      revisionNote: spec.revisionNote,
      cast,
      canonicalContext: composedCanonicalContext || undefined,
    },
    aCtx,
    draftOpts
  );
  let sceneFountain = extractFountain(draft.output);
  passes.push({ pass: "scene", ok: !!sceneFountain });
  if (!sceneFountain) {
    throw new Error(
      "Scene agent did not produce a fountain string. Check /tmp/toburt-llm-dumps for the raw response."
    );
  }

  // Guardrail: if the model ignored the spec and wrote a different slugline,
  // force the spec's slugline to be the first line. Better to have a slightly
  // mismatched body than to overwrite the user's scene plan silently.
  if (spec.slugline && spec.slugline.trim()) {
    const firstLine = sceneFountain.split("\n", 1)[0]?.trim() ?? "";
    const norm = (s: string) =>
      s.toUpperCase().replace(/[—–-]/g, "-").replace(/\s+/g, " ").trim();
    if (norm(firstLine) !== norm(spec.slugline)) {
      // Strip whatever slugline the model emitted (the first INT./EXT. line)
      // and prepend the spec's slugline.
      const lines = sceneFountain.split("\n");
      const sluglineIdx = lines.findIndex((l) =>
        /^\s*(INT|EXT|INT\/EXT)[./]/i.test(l)
      );
      if (sluglineIdx >= 0) lines.splice(sluglineIdx, 1);
      sceneFountain = [spec.slugline, "", ...lines].join("\n");
      // eslint-disable-next-line no-console
      console.warn(
        `[scenePass] Scene agent emitted off-spec slugline. Overrode "${firstLine}" → "${spec.slugline}".`
      );
    }
  }

  const pass = await runAgent(
    dialogueAgent,
    { intent: "pass", sceneFountain, characters: spec.characters },
    aCtx,
    draftOpts
  );
  const afterDialogue = extractFountain(pass.output) ?? sceneFountain;
  passes.push({ pass: "dialogue", ok: extractFountain(pass.output) !== null });

  const beh = await runAgent(
    behaviorAgent,
    {
      sceneFountain: afterDialogue,
      characters: spec.characters,
      replaceStatedEmotion: true,
    },
    aCtx,
    draftOpts
  );
  const afterBehavior = extractFountain(beh.output) ?? afterDialogue;
  passes.push({ pass: "behavior", ok: extractFountain(beh.output) !== null });

  const sub = await runAgent(
    subtextAgent,
    {
      sceneFountain: afterBehavior,
      characters: spec.characters,
      preferAction: true,
    },
    aCtx,
    draftOpts
  );
  const finalFountain = extractFountain(sub.output) ?? afterBehavior;
  passes.push({ pass: "subtext", ok: extractFountain(sub.output) !== null });

  const lastSuccessful =
    [...passes].reverse().find((p) => p.ok)?.pass ?? "scene";

  return { fountain: finalFountain, passes, lastPass: lastSuccessful };
}

/**
 * Pull the project's tone + showrunner_notes and the speaking characters'
 * DNA, then compose the structured 9-section brief. Best-effort — any DB
 * miss falls back to an empty section so the rules still ship.
 */
async function buildStructuredBrief(
  projectId: string,
  spec: SceneDraftSpec
): Promise<string | null> {
  try {
    const [{ data: proj }, { data: chars }] = await Promise.all([
      supabase
        .from("projects")
        .select("tone, showrunner_notes")
        .eq("id", projectId)
        .maybeSingle(),
      supabase
        .from("characters")
        .select("name, metadata")
        .eq("project_id", projectId),
    ]);
    const nameSet = new Set(spec.characters.map((n) => n.toUpperCase()));
    const characters: PromptCharacterState[] = (chars ?? [])
      .filter((c) => nameSet.has((c.name as string).toUpperCase()))
      .map((c) => ({
        name: c.name as string,
        dna: ((c.metadata as Record<string, unknown>)?.dna as CharacterDNA | undefined) ?? null,
      }));
    // Always include any speaker named in the brief, even if no DNA exists yet.
    for (const n of spec.characters) {
      if (!characters.find((c) => c.name.toUpperCase() === n.toUpperCase())) {
        characters.push({ name: n });
      }
    }
    return buildSceneBrief({
      sceneContext: { ord: 0, slugline: spec.slugline },
      characters,
      storyFunction: spec.goal,
      // The "Goal / Conflict / Turn" trio doubles as subtext/power/turn cues
      // when the scene plan is sparse — better than leaving sections empty.
      subtextGoal: spec.conflict,
      powerDynamic: spec.conflict,
      requiredTurn: spec.turn,
      tonePacing: {
        tone: (proj?.tone as string[] | null) ?? [],
        showrunnerNotes: (proj?.showrunner_notes as string | null) ?? null,
      },
      continuityLocks: spec.canonicalContext
        ? spec.canonicalContext.split("\n").slice(0, 12)
        : undefined,
    });
  } catch {
    return null;
  }
}

function extractFountain(output: unknown): string | null {
  const o = (output ?? {}) as Record<string, unknown>;
  const keys = ["fountain", "draft", "text", "screenplay", "script", "scene"];
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return null;
}
