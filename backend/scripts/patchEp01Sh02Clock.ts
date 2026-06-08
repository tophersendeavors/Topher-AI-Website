// Surgical patch for EP01 Scene 1 Shot 2 (clock insert).
//
//   1. Brief updates:
//        - shotTags ← ["INSERT","OBJECT"] (silences the generic "supporting
//          detail dominates" check; this IS a detail-driven shot)
//        - heroSubject ← "clock"
//        - forbiddenDominantDetails ← ["nightstand","wood grain","wood-grain","phone","room"]
//        - props ← ["clock","phone"] (matches Prop Bibles)
//        - eyeline ← "Maya is asleep off-frame; camera observes the clock face directly."
//        - cameraAwareness ← "observational_default"
//   2. Prompt updates: writer-supplied main prompt + negative on BOTH model
//      slots (veo + kling).
//   3. Recompute readiness using the freshly exported readiness() against
//      the new prompt text + brief, persist alongside.
//
// Idempotent. Touches ONLY SC01 SH02.

import { supabase } from "../src/db/client.js";
import { readiness } from "../src/draft/aiPrompts/composer.js";

const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;
const SHOT_INDEX = 2;

const NEW_MAIN_PROMPT =
  "A red LED digital clock on Maya's right-side nightstand reads 3:17 AM. The clock face is angled toward Maya's side of the bed, readable from her pillow. The bedroom is nearly black. The phone lies face-up beside the clock but remains secondary and mostly still. The red numerals are the hero image. Vertical 9:16, tight macro insert, 4 seconds, no camera movement, no room flip, no extra objects.";

const NEW_NEGATIVE_PROMPT =
  "wrong side of bed, clock facing away from Maya, unreadable numbers, extra clocks, alarm clock on floor, warm lamp light, wide room shot, visible person, visible closet, phone dominating the frame, flipped room layout";

const BRIEF_PATCH = {
  shotTags: ["INSERT", "OBJECT"] as string[],
  heroSubject: "clock",
  forbiddenDominantDetails: [
    "nightstand",
    "wood grain",
    "wood-grain",
    "phone",
    "room",
  ],
  props: ["clock", "phone"],
  eyeline:
    "Maya is asleep off-frame; camera observes the clock face directly.",
  cameraAwareness: "observational_default",
  cameraFraming: "ECU",
  frame:
    "Macro insert, vertical 9:16, locked off — red LED clock numerals fill the upper two-thirds of the frame; phone visible at lower edge but recessed.",
};

async function main() {
  console.log("═══ EP01 SC01 SH02 — Clock Hero Patch ═══\n");

  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  if (!scriptRow) throw new Error("EP01 script not found");

  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const aiPrompts = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (aiPrompts.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown>) ?? {};
  const brief = sceneBriefs[SHOT_INDEX] as Record<string, unknown>;
  if (!brief) throw new Error(`Brief at SC${SCENE_ORD} SH${SHOT_INDEX} not found`);

  // ---- BEFORE snapshot ---------------------------------------------------
  const beforeSlots = (aiPrompts.prompts as Record<string, unknown>)?.[
    SCENE_ORD
  ] as Record<string, unknown> | undefined;
  const beforeShotSlots = (beforeSlots?.[SHOT_INDEX] as
    | Record<string, unknown>
    | undefined) ?? {};
  console.log("── BEFORE ──");
  for (const [modelKey, slotUnknown] of Object.entries(beforeShotSlots)) {
    const slot = slotUnknown as { current?: { readiness?: { ok?: boolean; issues?: string[] }; mainPrompt?: string } };
    const r = slot.current?.readiness;
    console.log(
      `  ${modelKey.padEnd(8)} readiness ok=${r?.ok ?? "?"}, issues=${r?.issues?.length ?? 0}`
    );
    if (r?.issues?.length) {
      for (const it of r.issues) console.log(`    - ${it}`);
    }
  }

  // ---- 1. Brief patch ----------------------------------------------------
  for (const [k, v] of Object.entries(BRIEF_PATCH)) brief[k] = v;
  const ueArr = Array.isArray(brief.userEditedFields)
    ? (brief.userEditedFields as string[])
    : [];
  for (const k of [
    "shotTags",
    "heroSubject",
    "forbiddenDominantDetails",
    "props",
    "eyeline",
    "cameraAwareness",
    "cameraFraming",
    "frame",
  ]) {
    if (!ueArr.includes(k)) ueArr.push(k);
  }
  brief.userEditedFields = ueArr;
  brief.updatedAt = new Date().toISOString();
  sceneBriefs[SHOT_INDEX] = brief;
  briefs[SCENE_ORD] = sceneBriefs;
  aiPrompts.briefs = briefs;

  // ---- 2. Prompt patch (veo + kling) ------------------------------------
  const promptsRoot = (aiPrompts.prompts as Record<string, unknown>) ?? {};
  const sceneSlotsW = (promptsRoot[SCENE_ORD] as Record<string, unknown>) ?? {};
  const shotSlotsW = (sceneSlotsW[SHOT_INDEX] as Record<string, unknown>) ?? {};

  for (const modelKey of Object.keys(shotSlotsW)) {
    const slot = shotSlotsW[modelKey] as { current?: Record<string, unknown> };
    if (!slot.current) continue;
    const cur = slot.current;
    cur.mainPrompt = NEW_MAIN_PROMPT;
    cur.negativePrompt = NEW_NEGATIVE_PROMPT;

    // Recompute readiness against the new text. We don't have the full
    // composer context here (intent, hierarchy, etc.) so we feed in the
    // minimum the readiness gate needs to evaluate the parts that
    // changed: hero-subject + 40% check, eyeline, fragment patterns,
    // model-shape, and word-count rules.
    const newReadiness = readiness({
      text: NEW_MAIN_PROMPT,
      negative: NEW_NEGATIVE_PROMPT,
      model: modelKey as "veo" | "kling",
      durationSec: 4,
      aspectRatio: "9:16",
      // Tag the brief as INSERT so the existing "first-noun is a supporting
      // detail" gate stays silent (the detail IS the shot).
      shotTags: ["INSERT", "OBJECT"],
      characterNames: ["MAYA"],
      cameraAwareness: "observational_default",
      eyeline: BRIEF_PATCH.eyeline,
      frame: BRIEF_PATCH.frame,
      cameraFraming: BRIEF_PATCH.cameraFraming,
      heroSubject: "clock",
      forbiddenDominantDetails: BRIEF_PATCH.forbiddenDominantDetails,
    });
    cur.readiness = newReadiness;

    const notes = Array.isArray(cur.notes) ? (cur.notes as string[]) : [];
    notes.push(
      "Clock-Hero patch 2026-06-02: writer-supplied prompt + negative. Hero subject = clock. Insert tagged."
    );
    cur.notes = notes;
    cur.updatedAt = new Date().toISOString();
    console.log(
      `  patched ${modelKey} — readiness ok=${newReadiness.ok}, issues=${newReadiness.issues.length}`
    );
    for (const it of newReadiness.issues) console.log(`    - ${it}`);
  }

  aiPrompts.prompts = {
    ...promptsRoot,
    [SCENE_ORD]: { ...sceneSlotsW, [SHOT_INDEX]: shotSlotsW },
  };
  meta.aiPrompts = aiPrompts;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_SCRIPT_ID);

  console.log("\n── AFTER ──");
  console.log("New main prompt:");
  console.log(`  ${NEW_MAIN_PROMPT}`);
  console.log("\nNew negative:");
  console.log(`  ${NEW_NEGATIVE_PROMPT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
