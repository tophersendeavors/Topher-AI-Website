// One-shot patch: EP01 Scene 1 Shot 1 — eyeline fix.
//
// Sets cameraAwareness=observational_default + a specific eyeline on the
// brief, and rewrites the current PromptVersion's mainPrompt + appends
// the no-lens-gaze bans to its negativePrompt. Does NOT regenerate via
// the LLM — this is a surgical in-place edit so the writer can verify
// the fix without burning another LLM call.
//
// Idempotent: re-running produces the same DB state.

import { supabase } from "../src/db/client.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;
const SHOT_INDEX = 1;

// The user-approved replacement prompt for SH01.
const NEW_MAIN_PROMPT =
  "Maya jolts awake and turns her head toward the nightstand off-frame right, reacting to the phone buzzing nearby. Her eyeline stays off-camera. She does not look into the lens. The camera observes her from a slight three-quarter angle.";

const EYELINE_BAN_PHRASES = [
  "direct eye contact with camera",
  "looking into the lens",
  "looking into camera",
  "portrait-style posing",
  "selfie framing",
  "influencer delivery",
  "vlog delivery",
  "character acknowledging the lens",
  "addressing the camera",
  "fourth wall break",
];

async function main() {
  console.log("═══ EP01 SH01 — eyeline patch ═══\n");

  // 1. Update the Master Shot Brief: add cameraAwareness + eyeline.
  const { data: scriptRow, error: sErr } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  if (sErr || !scriptRow) {
    console.error("Could not load script:", sErr);
    process.exit(1);
  }
  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const aiPrompts = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs = (aiPrompts.briefs as Record<string, unknown> | undefined) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown> | undefined) ?? {};
  const brief = sceneBriefs[SHOT_INDEX] as Record<string, unknown> | undefined;
  if (!brief) {
    console.error(`No brief at scene ${SCENE_ORD} / shot ${SHOT_INDEX}.`);
    process.exit(1);
  }
  brief.cameraAwareness = "observational_default";
  brief.eyeline =
    "Maya's eyeline stays off-camera toward the nightstand, reacting to the phone buzz; she never looks into the lens.";
  brief.updatedAt = new Date().toISOString();
  // Mark this field as writer-edited so future Auto-build runs don't
  // silently overwrite the eyeline.
  const userEditedFields = Array.isArray(brief.userEditedFields)
    ? (brief.userEditedFields as string[])
    : [];
  for (const f of ["cameraAwareness", "eyeline"]) {
    if (!userEditedFields.includes(f)) userEditedFields.push(f);
  }
  brief.userEditedFields = userEditedFields;

  // 2. Patch the current PromptVersion for every model slot at SC01_SH01.
  const promptsRoot = (aiPrompts.prompts as Record<string, unknown> | undefined) ?? {};
  const sceneSlots = (promptsRoot[SCENE_ORD] as Record<string, unknown> | undefined) ?? {};
  const shotSlots = (sceneSlots[SHOT_INDEX] as Record<string, unknown> | undefined) ?? {};
  let patched = 0;
  for (const [modelKey, slotUnknown] of Object.entries(shotSlots)) {
    const slot = slotUnknown as { current?: Record<string, unknown> } | undefined;
    const current = slot?.current;
    if (!current) continue;
    const prevNegative = String(current.negativePrompt ?? "");
    const lower = prevNegative.toLowerCase();
    const missing = EYELINE_BAN_PHRASES.filter(
      (p) => !lower.includes(p.toLowerCase())
    );
    const nextNegative = missing.length
      ? prevNegative
        ? `${prevNegative}, ${missing.join(", ")}`
        : missing.join(", ")
      : prevNegative;
    const prevMain = String(current.mainPrompt ?? "");
    // Preserve any trailing Midjourney flags (e.g. --ar 9:16 --stylize 80).
    const flagMatch = prevMain.match(/(--ar\s+\S+(?:\s+--stylize\s+\S+)?)\s*$/);
    const trailingFlags = flagMatch ? ` ${flagMatch[1]}` : "";
    current.mainPrompt = `${NEW_MAIN_PROMPT}${trailingFlags}`;
    current.negativePrompt = nextNegative;
    const notes = Array.isArray(current.notes) ? (current.notes as string[]) : [];
    if (
      !notes.some((n) =>
        n.startsWith("Eyeline patched")
      )
    ) {
      notes.push(
        "Eyeline patched 2026-06-02: observational camera, Maya does not look into lens."
      );
    }
    current.notes = notes;
    current.updatedAt = new Date().toISOString();
    console.log(`  patched slot: ${modelKey}`);
    patched += 1;
  }

  // 3. Persist.
  meta.aiPrompts = {
    ...aiPrompts,
    briefs: { ...briefs, [SCENE_ORD]: { ...sceneBriefs, [SHOT_INDEX]: brief } },
    prompts: {
      ...promptsRoot,
      [SCENE_ORD]: { ...sceneSlots, [SHOT_INDEX]: shotSlots },
    },
  };
  const { error: uErr } = await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_SCRIPT_ID);
  if (uErr) {
    console.error("Update failed:", uErr);
    process.exit(1);
  }

  console.log(
    `\nDone. Brief eyeline + cameraAwareness set; ${patched} prompt slot${
      patched === 1 ? "" : "s"
    } patched.`
  );
  console.log("\nNew SH01 main prompt:");
  console.log(`  ${NEW_MAIN_PROMPT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
// PROJECT_ID is referenced only for documentation; the script targets
// EP01_SCRIPT_ID directly.
void PROJECT_ID;
