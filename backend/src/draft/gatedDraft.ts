import { supabase } from "../db/client.js";
import { draftOneScene } from "./scenePass.js";
import { getCanonicalContext, commitSceneCanonical } from "./canonical.js";
import { checkScene, type SceneCheckResult } from "./sceneChecker.js";
import { reassembleLiveFountain } from "./reassemble.js";

export type GatedDraftResult = {
  ord: number;
  slugline: string;
  fountain: string;
  check: SceneCheckResult;
  attempts: number;
  committed: boolean;
};

/**
 * Continuity-locked drafting of ONE scene:
 *   1. Build canonical context (locked cast + prior canonical facts).
 *   2. Generate the scene under that lock.
 *   3. Run the grounded per-scene continuity check.
 *   4. If it fails, regenerate addressing the violations (up to maxFix tries).
 *   5. Commit the scene as canonical (summary + established facts).
 * Returns the scene + the final check so the UI can show the gate.
 */
export async function draftSceneGated(args: {
  scriptId: string;
  ord: number;
  user: { id: string };
  maxFix?: number;
}): Promise<GatedDraftResult> {
  const { scriptId, ord, user } = args;
  const maxFix = args.maxFix ?? 1;

  const { data: script } = await supabase
    .from("scripts")
    .select("project_id")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");

  const { data: scene } = await supabase
    .from("script_scenes")
    .select("*")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (!scene) throw new Error(`scene ${ord} not found`);
  if (scene.status === "locked") {
    throw new Error(`Scene ${ord} is locked. Unlock before re-drafting.`);
  }

  const ctx = await getCanonicalContext(scriptId, ord);
  const characters = (scene.tags ?? []).filter(Boolean) as string[];
  const manifest = {
    storyPurpose: (scene.story_purpose as string) ?? (scene.summary as string) ?? null,
    timelinePosition: (scene.timeline_position as number) ?? ord,
    protocolStage: (scene.protocol_stage as string) ?? null,
    continuityIn: Array.isArray(scene.continuity_in) ? (scene.continuity_in as unknown[]) : [],
  };

  await supabase.from("script_scenes").update({ status: "generating" }).eq("id", scene.id);

  try {
    let fountain = "";
    let check: SceneCheckResult | null = null;
    let attempts = 0;
    let revisionNote: string | undefined;

    for (let attempt = 0; attempt <= maxFix; attempt++) {
      attempts = attempt + 1;
      const result = await draftOneScene(
        script.project_id,
        {
          slugline: scene.slugline as string,
          goal: manifest.storyPurpose ?? `Drive scene ${ord}.`,
          conflict: fountain ? "(preserve from current scene)" : "TBD",
          turn: fountain ? "(preserve from current scene)" : "TBD",
          characters,
          currentFountain: fountain || undefined,
          revisionNote,
          canonicalContext: ctx.text,
        },
        user
      );
      fountain = result.fountain;
      check = await checkScene({ ord, sceneFountain: fountain, ctx, manifest });
      if (check.pass) break;
      // Build a revision note from the violations for the next attempt.
      revisionNote =
        "Fix these continuity violations without changing anything else:\n" +
        check.violations
          .map((v) => `- [${v.facet}] ${v.detail} (re: "${v.evidence}")`)
          .join("\n");
    }

    const finalCheck = check!;
    // Commit canonical regardless of pass (we keep the best attempt), but mark
    // status to reflect whether it passed clean.
    await commitSceneCanonical(scene.id, finalCheck.canonicalSummary, finalCheck.continuityOut);
    await supabase
      .from("script_scenes")
      .update({
        fountain,
        status: finalCheck.pass ? "generated" : "revised",
        generated_at: new Date().toISOString(),
        last_pass: "subtext",
        last_check: finalCheck as unknown as object,
      })
      .eq("id", scene.id);

    await reassembleLiveFountain(scriptId);

    return {
      ord,
      slugline: scene.slugline as string,
      fountain,
      check: finalCheck,
      attempts,
      committed: true,
    };
  } catch (err) {
    await supabase
      .from("script_scenes")
      .update({ status: "pending", notes: `Gated draft failed: ${(err as Error).message}` })
      .eq("id", scene.id);
    throw err;
  }
}

/** Find the next non-canonical scene ord for a script (lowest ord). */
export async function nextSceneToDraft(scriptId: string): Promise<number | null> {
  const { data } = await supabase
    .from("script_scenes")
    .select("ord, canonical")
    .eq("script_id", scriptId)
    .eq("canonical", false)
    .order("ord", { ascending: true })
    .limit(1);
  return data && data.length > 0 ? (data[0].ord as number) : null;
}
