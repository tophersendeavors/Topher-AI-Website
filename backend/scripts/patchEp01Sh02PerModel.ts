// Surgical per-model patch for EP01 SC01 SH02.
//   • Kling slot: spatial-continuity-locked text (technical-constraint heavy)
//   • Veo slot:   writer-supplied Flow/Veo cinematic-natural prompt
//   • Both slots: extended negative with phone-face-down + room-flip bans
// Re-evaluates readiness on both. Touches ONLY SH02.

import { supabase } from "../src/db/client.js";
import { readiness } from "../src/draft/aiPrompts/composer.js";
import { runContinuityPass } from "../src/continuity/validator.js";

const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;
const SHOT_INDEX = 2;

// ---- Kling — explicit technical constraints + direct continuity ---------
const KLING_MAIN = [
  "Hero image: a red LED digital clock on Maya's right-side nightstand",
  "reads 3:17 AM. The clock face is angled toward Maya's side of the bed",
  "so the numerals are clearly readable from her pillow. Vertical 9:16,",
  "tight macro insert, locked-off camera, approximately 5 seconds.",
  "The bedroom around the nightstand is nearly black; only the faint red",
  "glow of the clock numerals lights the immediate surface. The clock face",
  "dominates the frame as the visual hero. A phone lies face-up beside the",
  "clock at the lower edge of the frame, secondary and partially in shadow.",
  "After a still beat, the phone begins to vibrate softly against the",
  "nightstand surface, but the clock numerals remain dominant in the frame.",
  "No camera movement, no zoom, no dolly. Maya's right side of the bed —",
  "do not flip the room layout. No visible person, no closet, no warm",
  "lamp light, no extra objects on the nightstand.",
].join(" ");

const KLING_NEGATIVE = [
  // — added per the user's spatial-continuity requirements —
  "phone face-down",
  "clock facing away from Maya",
  "wrong side of bed",
  "flipped room layout",
  // — kept from the SH02 hero-image lock —
  "unreadable numbers",
  "extra clocks",
  "alarm clock on floor",
  "warm lamp light",
  "wide room shot",
  "visible person",
  "visible closet",
  "phone dominating the frame",
  // — anti-portrait / lens-gaze / lighting drift bans —
  "direct eye contact with camera",
  "looking into the lens",
  "looking into camera",
  "portrait-style posing",
  "selfie framing",
  "fourth wall break",
  "glamour lighting",
  "studio lighting",
  "ring light",
  "cinematic crane shot",
  "movie poster framing",
  "blurry digits",
  "distorted numerals",
  "multiple clocks",
  "analog hands",
  "Android phone",
  "notifications visible",
].join(", ");

// ---- Flow / Veo — writer-supplied cinematic-natural prompt --------------
const VEO_MAIN =
  "A red LED digital clock on Maya's right-side nightstand reads 3:17 AM, angled toward Maya's pillow so it is clearly readable from her side of the bed. Tight vertical 9:16 macro insert, locked-off camera. The clock face dominates the frame; the red numerals are the hero image. The bedroom around it is almost completely black. A phone lies face-up beside the clock at the lower edge of frame, secondary and partially in shadow. After a still beat, the phone begins to vibrate softly against the wood, but the clock remains dominant. No visible person, no closet, no warm lamp light, no room flip, no extra objects. Approximately 5 seconds.";

const VEO_NEGATIVE =
  "clock facing away from Maya, wrong side of bed, flipped room layout, unreadable numbers, extra clocks, phone dominating frame, phone face-down, visible person, visible closet, warm lamp light, wide room shot, dramatic camera movement, cluttered nightstand";

async function main() {
  console.log("═══ EP01 SC01 SH02 — per-model patch ═══\n");

  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  if (!scriptRow) throw new Error("EP01 script not found");
  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const promptsRoot = (ai.prompts as Record<string, unknown>) ?? {};
  const sceneSlots = (promptsRoot[SCENE_ORD] as Record<string, unknown>) ?? {};
  const shotSlots = (sceneSlots[SHOT_INDEX] as Record<string, unknown>) ?? {};

  // Pull the brief for the readiness call signature.
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const brief = ((briefs[SCENE_ORD] as Record<string, unknown>) ?? {})[
    SHOT_INDEX
  ] as Record<string, unknown> | undefined;
  if (!brief) throw new Error("Brief SH02 missing");
  const heroSubject = (brief.heroSubject as string | undefined) ?? "clock";
  const forbiddenDominantDetails =
    (brief.forbiddenDominantDetails as string[] | undefined) ?? [];

  type SlotKey = "veo" | "kling";
  const PATCHES: Array<{ key: SlotKey; main: string; negative: string }> = [
    { key: "veo", main: VEO_MAIN, negative: VEO_NEGATIVE },
    { key: "kling", main: KLING_MAIN, negative: KLING_NEGATIVE },
  ];

  console.log("── BEFORE ──");
  for (const p of PATCHES) {
    const s = shotSlots[p.key] as { current?: Record<string, unknown> } | undefined;
    const cur = s?.current as
      | { readiness?: { ok?: boolean; issues?: string[] }; mainPrompt?: string }
      | undefined;
    console.log(
      `  ${p.key.padEnd(6)} readiness ok=${cur?.readiness?.ok ?? "?"}, issues=${cur?.readiness?.issues?.length ?? 0}`
    );
  }

  console.log("\n── PATCHING ──");
  for (const p of PATCHES) {
    const s = shotSlots[p.key] as { current?: Record<string, unknown> } | undefined;
    if (!s?.current) {
      console.log(`  (skip) ${p.key} — no existing slot`);
      continue;
    }
    s.current.mainPrompt = p.main;
    s.current.negativePrompt = p.negative;
    const r = readiness({
      text: p.main,
      negative: p.negative,
      model: p.key,
      durationSec: 5,
      aspectRatio: "9:16",
      shotTags: ["INSERT", "OBJECT"],
      characterNames: ["MAYA"],
      cameraAwareness: "observational_default",
      eyeline:
        (brief.eyeline as string | undefined) ??
        "Maya is asleep off-frame; camera observes the clock face directly.",
      frame: brief.frame as string | undefined,
      cameraFraming: brief.cameraFraming as string | undefined,
      heroSubject,
      forbiddenDominantDetails,
    });
    s.current.readiness = r;
    const notes = Array.isArray(s.current.notes)
      ? (s.current.notes as string[])
      : [];
    notes.push(
      `Per-model patch 2026-06-02 (${p.key}): spatial continuity + phone face-up + clock hero locked.`
    );
    s.current.notes = notes;
    s.current.updatedAt = new Date().toISOString();
    console.log(`  ${p.key.padEnd(6)} → readiness ok=${r.ok}, issues=${r.issues.length}`);
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

  console.log("\n── AFTER ── (Kling)");
  console.log("Main:");
  console.log(`  ${KLING_MAIN}`);
  console.log("Negative:");
  console.log(`  ${KLING_NEGATIVE}`);
  console.log("\n── AFTER ── (Flow / Veo)");
  console.log("Main:");
  console.log(`  ${VEO_MAIN}`);
  console.log("Negative:");
  console.log(`  ${VEO_NEGATIVE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
