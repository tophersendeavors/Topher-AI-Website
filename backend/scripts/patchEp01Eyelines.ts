// Phase 2 of the eyeline auto-patch:
//   1. Write brief.eyeline + camera awareness for SC01 SH03/05/07/09/13
//   2. Add brief.props so prop-bible matching fires (phone / clock / closet door)
//   3. Re-generate only those 5 prompts via generatePromptForModel (every
//      configured model slot already in the prompt map)
//   4. Re-run the continuity pass
//
// Idempotent. Other shots untouched. Screenplay untouched.

import { supabase } from "../src/db/client.js";
import { generatePromptForModel } from "../src/draft/aiPrompts/engine.js";
import { runContinuityPass } from "../src/continuity/validator.js";
import type { ContinuityIssue } from "../src/continuity/types.js";
import type { ModelKey } from "../src/draft/aiPrompts/types.js";

const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;

interface ShotPatch {
  shot: number;
  eyeline: string;
  // Heuristic prop tags so the prop-bible matcher can fire. Additive only —
  // we DO NOT clobber existing props.
  addProps: string[];
}

const PATCHES: ShotPatch[] = [
  {
    shot: 3,
    eyeline:
      "Maya's eyeline tracks the phone glow on the nightstand to her right; she does not register the camera.",
    addProps: ["phone"],
  },
  {
    shot: 5,
    eyeline:
      "Maya looks down at the phone screen across her chest, eyeline buried in the screen; the lens stays off-axis.",
    addProps: ["phone"],
  },
  {
    shot: 7,
    eyeline:
      "Maya's eyeline drifts toward the closet door across the room; the camera observes from beside the bed.",
    addProps: ["closet door"],
  },
  {
    shot: 9,
    eyeline:
      "Maya's gaze tracks the clock face on her right; the red glow reflects in her eye but never on the lens.",
    addProps: ["clock"],
  },
  {
    shot: 13,
    eyeline:
      "Maya stares at the half-open closet doorway across the room; her eyeline never crosses the lens.",
    addProps: ["closet door"],
  },
];

async function main() {
  console.log("═══ EP01 eyeline auto-patch ═══\n");

  // 1. Patch briefs in-place.
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
  const nowIso = new Date().toISOString();
  for (const p of PATCHES) {
    const brief = sceneBriefs[p.shot] as Record<string, unknown> | undefined;
    if (!brief) {
      console.log(`  (skip) SH${String(p.shot).padStart(2, "0")} not in briefs`);
      continue;
    }
    brief.eyeline = p.eyeline;
    brief.cameraAwareness = brief.cameraAwareness ?? "observational_default";
    const existingProps = Array.isArray(brief.props) ? (brief.props as string[]) : [];
    const merged = Array.from(new Set([...existingProps, ...p.addProps]));
    brief.props = merged;
    const ue = Array.isArray(brief.userEditedFields)
      ? (brief.userEditedFields as string[])
      : [];
    for (const f of ["eyeline", "cameraAwareness", "props"]) {
      if (!ue.includes(f)) ue.push(f);
    }
    brief.userEditedFields = ue;
    brief.updatedAt = nowIso;
    console.log(
      `  SH${String(p.shot).padStart(2, "0")} eyeline set; props=[${merged.join(", ")}]`
    );
  }
  briefs[SCENE_ORD] = sceneBriefs;
  aiPrompts.briefs = briefs;
  meta.aiPrompts = aiPrompts;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_SCRIPT_ID);

  // 2. Re-generate only the affected prompt slots. Walk the existing
  //    prompt map so we touch only the slots that ALREADY existed; we
  //    don't materialise new model slots for these shots.
  console.log("\nRegenerating prompts for patched shots…");
  const { data: scriptRow2 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  const m2 = (scriptRow2!.metadata as Record<string, unknown>) ?? {};
  const ai2 = (m2.aiPrompts as Record<string, unknown>) ?? {};
  const promptsRoot = (ai2.prompts as Record<string, unknown>) ?? {};
  const sceneSlots = (promptsRoot[SCENE_ORD] as Record<string, unknown>) ?? {};
  const regenerated: Array<{ shot: number; model: string }> = [];
  for (const p of PATCHES) {
    const slot = sceneSlots[p.shot] as Record<string, unknown> | undefined;
    if (!slot) {
      console.log(`  (skip) SH${String(p.shot).padStart(2, "0")} — no existing prompts`);
      continue;
    }
    for (const modelKey of Object.keys(slot)) {
      try {
        await generatePromptForModel({
          scriptId: EP01_SCRIPT_ID,
          sceneOrd: SCENE_ORD,
          shotIndex: p.shot,
          model: modelKey as ModelKey,
          notes:
            "Patched eyeline + camera-awareness applied. Honor the eyeline field verbatim; subject must NOT look into the lens.",
        });
        regenerated.push({ shot: p.shot, model: modelKey });
        console.log(
          `  ✓ SH${String(p.shot).padStart(2, "0")} (${modelKey})`
        );
      } catch (err) {
        console.log(
          `  ✗ SH${String(p.shot).padStart(2, "0")} (${modelKey}) — ${(err as Error).message}`
        );
      }
    }
  }

  // 3. Re-run the continuity pass.
  console.log("\nRe-running continuity pass…");
  const result = await runContinuityPass(EP01_SCRIPT_ID);
  const { data: scriptRow3 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  const m3 = (scriptRow3!.metadata as Record<string, unknown>) ?? {};
  m3.continuity = result;
  await supabase
    .from("scripts")
    .update({ metadata: m3 })
    .eq("id", EP01_SCRIPT_ID);

  const fails = result.issues.filter((i) => i.severity === "fail").length;
  const warns = result.issues.filter((i) => i.severity === "warning").length;
  console.log(`\nResult: ${fails} fail / ${warns} warning`);
  if (warns + fails > 0) {
    for (const i of result.issues as ContinuityIssue[]) {
      const w = i.where;
      const loc = [
        w.episodeNumber != null ? `EP${String(w.episodeNumber).padStart(2, "0")}` : null,
        w.sceneOrd != null ? `SC${String(w.sceneOrd).padStart(2, "0")}` : null,
        w.shotIndex != null ? `SH${String(w.shotIndex).padStart(2, "0")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      console.log(`  [${i.severity}] [${i.category}] ${loc} — ${i.message}`);
    }
  }
  console.log(`\nRegenerated ${regenerated.length} prompt(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
