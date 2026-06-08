// EP01 SH01 — character-shot opening patch.
//
// Rewrites sentence 1 to include character + action + location/time +
// emotion + wardrobe IN ONE SENTENCE, then preserves the rest of the
// previously-locked production prompt. Re-evaluates readiness on both
// veo + kling against the relaxed CHAR-shot rule (V3.8).

import { supabase } from "../src/db/client.js";
import { readiness } from "../src/draft/aiPrompts/composer.js";
import { runContinuityPass } from "../src/continuity/validator.js";

const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;
const SHOT_INDEX = 1;

const NEW_MAIN_PROMPT =
  "A woman jolts upright in a dark bedroom at 3:17 AM, face slack with shock, the neckline of her pale grey sleep shirt catching faint cool ambient light. Locked-off 50mm lens, close-up vertical 9:16 framing, slightly off-axis and observational rather than front-on portrait. Deep shadow swallows the right side of her face while the left catches the faint pale ambient light. Her gaze stays slightly off-camera toward the nightstand, reacting to a sound nearby; she does not look into the lens. She does not move again. Her hands have not yet reached for the nightstand. The background falls to near-black. No phone in hand. Approximately 4 seconds.";

const NEW_NEGATIVE_PROMPT =
  "looking into camera, direct eye contact, portrait-style gaze, exposed bare shoulders, reaching for phone, visible phone in hand, visible closet, background movement, glamour lighting, overacting, theatrical pose";

async function main() {
  console.log("═══ EP01 SC01 SH01 — character-opening patch ═══\n");

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
  if (!brief) throw new Error("Brief SH01 missing");
  const promptsRoot = (ai.prompts as Record<string, unknown>) ?? {};
  const sceneSlots = (promptsRoot[SCENE_ORD] as Record<string, unknown>) ?? {};
  const shotSlots = (sceneSlots[SHOT_INDEX] as Record<string, unknown>) ?? {};

  // ---- BEFORE: re-evaluate the OLD prompt against the V3.8 rule first so
  //              we can show the "before" state under the new logic.
  console.log("── BEFORE (re-evaluating OLD stored prompt against V3.8 rule) ──");
  for (const [modelKey, slotUnknown] of Object.entries(shotSlots)) {
    const slot = slotUnknown as { current?: Record<string, unknown> };
    const oldMain = (slot.current?.mainPrompt as string | undefined) ?? "";
    const oldNeg = (slot.current?.negativePrompt as string | undefined) ?? "";
    const r = readiness({
      text: oldMain,
      negative: oldNeg,
      model: modelKey as "veo" | "kling",
      durationSec: 4,
      aspectRatio: "9:16",
      shotTags: ["CHAR"],
      characterNames: ["MAYA"],
      cameraAwareness: "observational_default",
      eyeline: brief.eyeline as string | undefined,
      frame: brief.frame as string | undefined,
      cameraFraming: brief.cameraFraming as string | undefined,
      intent: "character_driven",
      leadStrategy: "character",
      briefPrimaryImage: brief.primaryImage as string | undefined,
    });
    console.log(`  ${modelKey} readiness ok=${r.ok}, issues=${r.issues.length}`);
    for (const it of r.issues) console.log(`    - ${it}`);
  }

  // ---- 1. Patch prompts ---------------------------------------------------
  console.log("\n── PATCHING ──");
  for (const modelKey of Object.keys(shotSlots)) {
    const slot = shotSlots[modelKey] as { current?: Record<string, unknown> };
    if (!slot.current) continue;
    const cur = slot.current;
    cur.mainPrompt = NEW_MAIN_PROMPT;
    cur.negativePrompt = NEW_NEGATIVE_PROMPT;
    const r = readiness({
      text: NEW_MAIN_PROMPT,
      negative: NEW_NEGATIVE_PROMPT,
      model: modelKey as "veo" | "kling",
      durationSec: 4,
      aspectRatio: "9:16",
      shotTags: ["CHAR"],
      characterNames: ["MAYA"],
      cameraAwareness: "observational_default",
      eyeline: brief.eyeline as string | undefined,
      frame: brief.frame as string | undefined,
      cameraFraming: brief.cameraFraming as string | undefined,
      intent: "character_driven",
      leadStrategy: "character",
      briefPrimaryImage: brief.primaryImage as string | undefined,
    });
    cur.readiness = r;
    const notes = Array.isArray(cur.notes) ? (cur.notes as string[]) : [];
    notes.push(
      "Character-opening patch 2026-06-02: sentence 1 combines character+action+location+emotion+wardrobe."
    );
    cur.notes = notes;
    cur.updatedAt = new Date().toISOString();
    console.log(`  ${modelKey} → readiness ok=${r.ok}, issues=${r.issues.length}`);
    for (const it of r.issues) console.log(`    - ${it}`);
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

  console.log("\n── AFTER ──");
  console.log("Main:");
  console.log(`  ${NEW_MAIN_PROMPT}`);
  console.log("\nNegative:");
  console.log(`  ${NEW_NEGATIVE_PROMPT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
