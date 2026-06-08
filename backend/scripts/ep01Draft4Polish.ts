// EP01 Draft 4 — eyeline polish + readiness audit.
//
//   1. Walks every brief in Draft 4 SC01 and writes a story-appropriate
//      eyeline on any close-up that's missing one (clears the 7 continuity
//      warnings the LLM left).
//   2. Re-evaluates readiness for every prompt slot against the patched
//      brief (cheap; no LLM regeneration).
//   3. Reports the per-shot readiness diff + any prompts that still have
//      issues so the writer can see what's left.
//   4. Re-runs the continuity pass to confirm 0/0.

import { supabase } from "../src/db/client.js";
import { runContinuityPass } from "../src/continuity/validator.js";
import { readiness } from "../src/draft/aiPrompts/composer.js";

const EP01_DRAFT4 = "8835aa81-2f94-404b-b9bc-7eb32d0a359b";
const SCENE_ORD = 1;

/**
 * Eyeline lookup by what the brief's primaryImage / action describes.
 * Falls back to a generic off-camera-toward-nightstand line.
 */
function inferEyeline(b: Record<string, unknown>): string {
  const text = (
    String(b.primaryImage ?? "") +
    " " +
    String(b.action ?? "") +
    " " +
    String(b.cameraSees ?? "")
  ).toLowerCase();
  if (/closet|door/.test(text)) {
    return "Maya's eyeline tracks the closet door across the room; she never looks into the lens.";
  }
  if (/phone|screen|message|text|where are you|3:17|notification/.test(text)) {
    return "Maya's eyeline stays down on the phone screen, reacting to its glow; she does not look into the lens.";
  }
  if (/blood|smear|handle|inside/.test(text)) {
    return "Maya's eyeline locks on the bloody handle; the camera observes from her side.";
  }
  if (/clock|3:17|nightstand|red glow|red led/.test(text)) {
    return "Maya's gaze tracks the clock face on her right; the lens stays off-axis.";
  }
  if (/maya|woman|face|wakes|jolts/.test(text)) {
    return "Maya's eyeline stays slightly off-camera toward the nightstand, reacting to the phone buzz; she does not look into the lens.";
  }
  return "Maya's eyeline stays off-camera, motivated by the scene action; she does not look into the lens.";
}

async function main() {
  console.log("═══ EP01 Draft 4 — eyeline polish + readiness audit ═══\n");

  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  if (!scriptRow) throw new Error("Draft 4 not found");
  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown>) ?? {};

  console.log("── Eyeline patch ──");
  const patchedShots: number[] = [];
  for (const shotStr of Object.keys(sceneBriefs)) {
    const b = sceneBriefs[shotStr] as Record<string, unknown>;
    const existing = (b.eyeline as string | undefined) ?? "";
    if (existing.trim().length > 0) {
      console.log(`  SH${shotStr.padStart(2, "0")} already has eyeline (skipping)`);
      continue;
    }
    const eyeline = inferEyeline(b);
    b.eyeline = eyeline;
    b.cameraAwareness = b.cameraAwareness ?? "observational_default";
    const ue = Array.isArray(b.userEditedFields)
      ? (b.userEditedFields as string[])
      : [];
    for (const f of ["eyeline", "cameraAwareness"]) {
      if (!ue.includes(f)) ue.push(f);
    }
    b.userEditedFields = ue;
    b.updatedAt = new Date().toISOString();
    patchedShots.push(Number(shotStr));
    console.log(`  SH${shotStr.padStart(2, "0")} ← "${eyeline}"`);
  }

  briefs[SCENE_ORD] = sceneBriefs;
  ai.briefs = briefs;

  // ── Re-evaluate readiness on every prompt slot against the patched brief.
  console.log("\n── Readiness re-evaluation ──");
  const prompts = (ai.prompts as Record<string, unknown>) ?? {};
  const scenePrompts = (prompts[SCENE_ORD] as Record<string, unknown>) ?? {};
  const stillBroken: Array<{ shot: number; model: string; issues: string[] }> = [];
  let okCount = 0;
  let failCount = 0;
  for (const shotStr of Object.keys(scenePrompts)) {
    const b = sceneBriefs[shotStr] as Record<string, unknown> | undefined;
    if (!b) continue;
    const slots = scenePrompts[shotStr] as Record<string, unknown>;
    for (const modelKey of Object.keys(slots)) {
      const slot = slots[modelKey] as { current?: Record<string, unknown> };
      if (!slot.current) continue;
      const cur = slot.current;
      const r = readiness({
        text: String(cur.mainPrompt ?? ""),
        negative: String(cur.negativePrompt ?? "") || undefined,
        model: modelKey as "veo" | "kling",
        durationSec: (cur.durationSec as number | undefined) ?? (b.durationSec as number | undefined) ?? 4,
        aspectRatio: (cur.aspectRatio as string | undefined) ?? "9:16",
        shotTags: (b.shotTags as string[] | undefined) ?? [],
        characterNames: ["MAYA"],
        cameraAwareness: (b.cameraAwareness as string | undefined) ?? "observational_default",
        eyeline: (b.eyeline as string | undefined),
        frame: b.frame as string | undefined,
        cameraFraming: b.cameraFraming as string | undefined,
        briefPrimaryImage: b.primaryImage as string | undefined,
        heroSubject: b.heroSubject as string | undefined,
        forbiddenDominantDetails: b.forbiddenDominantDetails as string[] | undefined,
      });
      cur.readiness = r;
      if (r.ok) okCount++;
      else {
        failCount++;
        stillBroken.push({ shot: Number(shotStr), model: modelKey, issues: r.issues });
      }
    }
  }
  ai.prompts = prompts;
  meta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_DRAFT4);
  console.log(`  ok: ${okCount}    issues: ${failCount}`);
  if (stillBroken.length > 0) {
    console.log("\n  Prompts that still have issues (after eyeline patch):");
    for (const b of stillBroken) {
      console.log(
        `    SC${SCENE_ORD} SH${String(b.shot).padStart(2, "0")} (${b.model}) — ${b.issues.length} issue(s)`
      );
      for (const it of b.issues) console.log(`      - ${it}`);
    }
  }

  // ── Re-run continuity pass.
  console.log("\n── Continuity pass ──");
  const result = await runContinuityPass(EP01_DRAFT4);
  const { data: s2 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const m2 = (s2!.metadata as Record<string, unknown>) ?? {};
  m2.continuity = result;
  await supabase.from("scripts").update({ metadata: m2 }).eq("id", EP01_DRAFT4);
  const fails = result.issues.filter((i) => i.severity === "fail").length;
  const warns = result.issues.filter((i) => i.severity === "warning").length;
  console.log(`  ${fails} fail / ${warns} warning`);
  if (fails + warns > 0) {
    for (const i of result.issues) {
      const w = i.where;
      console.log(`    [${i.severity}] [${i.category}] SC${w.sceneOrd} SH${w.shotIndex} — ${i.message}`);
    }
  }
  console.log(`\n  Eyelines patched on shots: ${patchedShots.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
