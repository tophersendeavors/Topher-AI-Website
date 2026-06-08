// Surgical upgrade for EP01 Scene 1 Shot 1 — production-locked.
//
//   1. Brief: tighten frame to "slightly off-axis observational"; confirm
//      eyeline + cameraAwareness; add wardrobe-lock continuity note + props.
//   2. Prompt: writer-supplied production-locked text + negative on BOTH
//      model slots (veo + kling).
//   3. Re-evaluate readiness against the new text.
//   4. Re-run continuity pass to confirm 0/0 holds.
//
// Idempotent. Touches ONLY SC01 SH01.

import { supabase } from "../src/db/client.js";
import { readiness } from "../src/draft/aiPrompts/composer.js";
import { runContinuityPass } from "../src/continuity/validator.js";

const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;
const SHOT_INDEX = 1;

const NEW_MAIN_PROMPT =
  "Near-total darkness fills the bedroom at 3:17 AM, with only a faint cool ambient wash catching the edge of rumpled dark bedding. A woman jolts upright from the pillow in a single startled motion, the neckline of her pale grey sleep shirt breaking the stillness of the frame. Her eyes open wide and her mouth parts slightly. Locked-off 50mm lens, close-up vertical 9:16 framing, slightly off-axis and observational rather than front-on portrait. Deep shadow swallows the right side of her face while the left catches the faint pale ambient light. Her gaze stays slightly off-camera toward the nightstand, reacting to a sound nearby; she does not look into the lens. She does not move again. Her hands have not yet reached for the nightstand. The background falls to near-black. No phone in hand. Approximately 4 seconds.";

const NEW_NEGATIVE_PROMPT =
  "looking into camera, direct eye contact, portrait-style gaze, exposed bare shoulders, reaching for phone, visible phone in hand, visible closet, background movement, glamour lighting, overacting, theatrical pose";

const BRIEF_PATCH = {
  cameraFraming: "CU",
  frame:
    "CU, 50mm, slightly off-axis observational angle, locked off, 9:16 vertical — face and upper chest fill the frame; pale grey sleep shirt visible at neckline.",
  cameraAwareness: "observational_default",
  eyeline:
    "Maya's eyeline stays slightly off-camera toward the nightstand, reacting to a sound nearby. She does not look into the lens.",
  performanceDirection:
    "Single sharp waking movement: jolts upright from the pillow, eyes wide, mouth parts slightly. Hands stay at her sides; she does not yet reach for the nightstand. No further movement after the wake.",
  continuityNotes:
    "Wardrobe locked: Maya wears her pale grey sleep shirt — no bare shoulders. No phone in hand. No closet visible from this angle.",
  shotTags: ["CHAR"],
  props: [] as string[],
};

async function main() {
  console.log("═══ EP01 SC01 SH01 — production-lock patch ═══\n");

  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  if (!scriptRow) throw new Error("EP01 script not found");
  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown>) ?? {};
  const brief = sceneBriefs[SHOT_INDEX] as Record<string, unknown>;
  if (!brief) throw new Error(`Brief at SH${SHOT_INDEX} not found`);

  const promptsRoot = (ai.prompts as Record<string, unknown>) ?? {};
  const sceneSlots = (promptsRoot[SCENE_ORD] as Record<string, unknown>) ?? {};
  const shotSlots = (sceneSlots[SHOT_INDEX] as Record<string, unknown>) ?? {};

  // ---- BEFORE snapshot ----
  console.log("── BEFORE ──");
  for (const [modelKey, slotUnknown] of Object.entries(shotSlots)) {
    const slot = slotUnknown as { current?: { readiness?: { ok?: boolean; issues?: string[] }; mainPrompt?: string; negativePrompt?: string } };
    const r = slot.current?.readiness;
    console.log(`  ${modelKey} readiness ok=${r?.ok ?? "?"}, issues=${r?.issues?.length ?? 0}`);
    console.log(`  ${modelKey} prompt (first 200): ${slot.current?.mainPrompt?.slice(0, 200) ?? ""}…`);
    console.log(`  ${modelKey} negative: ${slot.current?.negativePrompt ?? "(none)"}`);
  }

  // ---- 1. Brief patch ----
  for (const [k, v] of Object.entries(BRIEF_PATCH)) brief[k] = v;
  const ueArr = Array.isArray(brief.userEditedFields)
    ? (brief.userEditedFields as string[])
    : [];
  for (const k of Object.keys(BRIEF_PATCH)) {
    if (!ueArr.includes(k)) ueArr.push(k);
  }
  brief.userEditedFields = ueArr;
  brief.updatedAt = new Date().toISOString();
  sceneBriefs[SHOT_INDEX] = brief;
  briefs[SCENE_ORD] = sceneBriefs;
  ai.briefs = briefs;

  // ---- 2. Prompt patch + recompute readiness ----
  console.log("\n── PATCHING ──");
  for (const modelKey of Object.keys(shotSlots)) {
    const slot = shotSlots[modelKey] as { current?: Record<string, unknown> };
    if (!slot.current) continue;
    const cur = slot.current;
    cur.mainPrompt = NEW_MAIN_PROMPT;
    cur.negativePrompt = NEW_NEGATIVE_PROMPT;

    const newReadiness = readiness({
      text: NEW_MAIN_PROMPT,
      negative: NEW_NEGATIVE_PROMPT,
      model: modelKey as "veo" | "kling",
      durationSec: 4,
      aspectRatio: "9:16",
      shotTags: ["CHAR"],
      characterNames: ["MAYA"],
      cameraAwareness: "observational_default",
      eyeline: BRIEF_PATCH.eyeline,
      frame: BRIEF_PATCH.frame,
      cameraFraming: BRIEF_PATCH.cameraFraming,
      // Character-driven shot — no hero override; intent = character_driven
      // is the normal case for a Maya wake reaction.
      intent: "character_driven",
      leadStrategy: "character",
    });
    cur.readiness = newReadiness;
    const notes = Array.isArray(cur.notes) ? (cur.notes as string[]) : [];
    notes.push(
      "Production-lock patch 2026-06-02: wardrobe locked, off-axis observational, no portrait drift, no bare shoulders, no direct gaze."
    );
    cur.notes = notes;
    cur.updatedAt = new Date().toISOString();
    console.log(`  ${modelKey} → readiness ok=${newReadiness.ok}, issues=${newReadiness.issues.length}`);
    for (const it of newReadiness.issues) console.log(`    - ${it}`);
  }
  ai.prompts = {
    ...promptsRoot,
    [SCENE_ORD]: { ...sceneSlots, [SHOT_INDEX]: shotSlots },
  };
  meta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_SCRIPT_ID);

  // ---- 3. Re-run continuity pass ----
  console.log("\n── CONTINUITY PASS ──");
  const result = await runContinuityPass(EP01_SCRIPT_ID);
  const { data: r2 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  const m2 = (r2!.metadata as Record<string, unknown>) ?? {};
  m2.continuity = result;
  await supabase.from("scripts").update({ metadata: m2 }).eq("id", EP01_SCRIPT_ID);
  const fails = result.issues.filter((i) => i.severity === "fail").length;
  const warns = result.issues.filter((i) => i.severity === "warning").length;
  console.log(`  ${fails} fail / ${warns} warning`);
  if (fails + warns > 0) {
    for (const i of result.issues) {
      const w = i.where;
      console.log(`    [${i.severity}] [${i.category}] SC${w.sceneOrd} SH${w.shotIndex} — ${i.message}`);
    }
  }

  console.log("\n── AFTER ──");
  console.log("Main prompt:");
  console.log(`  ${NEW_MAIN_PROMPT}`);
  console.log("\nNegative:");
  console.log(`  ${NEW_NEGATIVE_PROMPT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
