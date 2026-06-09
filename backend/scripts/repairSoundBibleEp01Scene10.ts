// Surgical repair for the SELVAJE EP01 Sound Bible.
//
// 1. Generate a single new SoundBible scene row for ord 10 only.
// 2. Backfill provenance fields (sourceScriptId, sourceDraftLabel,
//    sourceFountainHash, sourceScenesHash, sourceSceneCount).
//
// Never touches scripts.fountain, never touches script_scenes, never
// overwrites the other 19 existing rows. The script aborts if any of
// those invariants would be broken.
//
// Run:
//   node --import tsx --env-file=../.env \
//     scripts/repairSoundBibleEp01Scene10.ts

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import {
  buildGeneratorContext,
  generateScenes,
  type GeneratorContext,
} from "../src/sound/generator.js";
import { putSoundBible, getSoundBible } from "../src/sound/store.js";
import type { SoundBible } from "../src/sound/types.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const MISSING_ORD = 10;
const DRAFT_5_SCRIPT_ID = "f197cbed-5c81-4301-a283-d05a2657277b";
const EXPECTED_FOUNTAIN_LEN = 37245;

function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function loadDraft5Snapshot() {
  const { data: script } = await supabase
    .from("scripts")
    .select("id, fountain, draft_number, metadata, current")
    .eq("id", DRAFT_5_SCRIPT_ID)
    .single();
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, status, fountain, last_pass")
    .eq("script_id", DRAFT_5_SCRIPT_ID)
    .order("ord", { ascending: true });
  if (!script) throw new Error("Draft 5 script row not found");
  const fountain = (script.fountain as string) ?? "";
  const sceneRows = scenes ?? [];
  return {
    scriptId: script.id as string,
    draftNumber: script.draft_number as number,
    isCurrent: script.current as boolean,
    metadata: (script.metadata as Record<string, unknown> | null) ?? {},
    fountainLen: fountain.length,
    fountainHash: djb2Hex(fountain),
    scenesHash: djb2Hex(JSON.stringify(sceneRows)),
    sceneCount: sceneRows.length,
  };
}

async function main() {
  console.log("=== SELVAJE EP01 Sound Bible — scene 10 repair ===\n");

  // 1. Snapshot Draft 5 first (read-only) — establish the source of truth.
  const before = await loadDraft5Snapshot();
  console.log("Draft 5 (BEFORE):");
  console.log(`  scriptId:        ${before.scriptId}`);
  console.log(`  draft_number:    ${before.draftNumber}`);
  console.log(`  current:         ${before.isCurrent}`);
  console.log(`  fountainLen:     ${before.fountainLen}`);
  console.log(`  fountainHash:    ${before.fountainHash}`);
  console.log(`  sceneCount:      ${before.sceneCount}`);
  console.log(`  scenesHash:      ${before.scenesHash}`);
  console.log(`  lockedDraft:     ${before.metadata.lockedWritingDraft === true}`);

  if (before.fountainLen !== EXPECTED_FOUNTAIN_LEN) {
    throw new Error(
      `Draft 5 fountain length ${before.fountainLen} != expected ${EXPECTED_FOUNTAIN_LEN}. Refusing to proceed.`
    );
  }
  if (before.sceneCount !== 20) {
    throw new Error(
      `Draft 5 has ${before.sceneCount} scenes; expected 20. Refusing to proceed.`
    );
  }
  if (before.metadata.lockedWritingDraft !== true) {
    throw new Error("Draft 5 is not flagged lockedWritingDraft=true. Refusing to proceed.");
  }

  // 2. Build the full generator context (for episode-level canon), then
  //    narrow `scenes` to just ord 10 before calling generateScenes.
  const fullCtx = await buildGeneratorContext(SELVAJE_PROJECT, EP01_ID);
  if (fullCtx.scriptId !== DRAFT_5_SCRIPT_ID) {
    throw new Error(
      `Generator resolved scriptId=${fullCtx.scriptId} != Draft 5 (${DRAFT_5_SCRIPT_ID}). Refusing to proceed.`
    );
  }
  const targetScene = fullCtx.scenes.find((s) => s.ord === MISSING_ORD);
  if (!targetScene) {
    throw new Error(
      `Scene ord ${MISSING_ORD} not present in Draft 5 script_scenes — cannot repair.`
    );
  }
  console.log(`\nTarget scene (ord ${MISSING_ORD}):`);
  console.log(`  slugline:        ${targetScene.slugline}`);
  console.log(`  timeOfDay:       ${targetScene.timeOfDay ?? "(none)"}`);
  console.log(`  characters:      ${targetScene.characters.join(", ") || "(none)"}`);

  // 3. Load the existing bible to preserve its 19 rows + episode-level
  //    sections. We must NOT regenerate identity / motifs / signatures.
  const priorBible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  const priorSceneKeys = Object.keys(priorBible.scenes).sort((a, b) => Number(a) - Number(b));
  console.log("\nPrior SoundBible:");
  console.log(`  version:         ${priorBible.version}`);
  console.log(`  approvedAt:      ${priorBible.approvedAt ?? "(null)"}`);
  console.log(`  scene rows:      ${priorSceneKeys.length}`);
  console.log(`  scene row keys:  [${priorSceneKeys.join(", ")}]`);
  if (priorBible.scenes[String(MISSING_ORD)]) {
    throw new Error(
      `Bible already has a row at ord ${MISSING_ORD}. Refusing to overwrite an existing row.`
    );
  }

  // 4. Generate JUST the missing scene. We reuse the existing motifs and
  //    characterSignatures so the new row matches the rest of the bible
  //    stylistically.
  const narrowedCtx: GeneratorContext = {
    ...fullCtx,
    scenes: [targetScene],
  };
  console.log("\nCalling generateScenes() for the single missing scene…");
  const generated = await generateScenes(
    narrowedCtx,
    priorBible.motifs,
    priorBible.characterSignatures
  );
  const newRow = generated[String(MISSING_ORD)];
  if (!newRow) {
    throw new Error(
      `generateScenes() returned nothing for ord ${MISSING_ORD}. Aborting without writing.`
    );
  }
  console.log(`✓ generateScenes returned row for ord ${MISSING_ORD}.`);
  console.log(`  ambientBed:      ${newRow.ambientBed.slice(0, 80)}…`);
  console.log(`  nonDiegeticMusic: ${newRow.nonDiegeticMusic.slice(0, 80)}…`);

  // 5. Merge: existing 19 rows + the one new row, plus provenance backfill.
  const sourceDraftLabel = `Draft ${before.draftNumber}`;
  const merged: SoundBible = {
    ...priorBible,
    scenes: { ...priorBible.scenes, [String(MISSING_ORD)]: newRow },
    sourceScriptId: before.scriptId,
    sourceDraftNumber: before.draftNumber,
    sourceWasLocked: before.metadata.lockedWritingDraft === true,
    sourceDraftLabel,
    sourceFountainHash: before.fountainHash,
    sourceScenesHash: before.scenesHash,
    sourceSceneCount: before.sceneCount,
  };

  const mergedKeys = Object.keys(merged.scenes).sort((a, b) => Number(a) - Number(b));
  if (mergedKeys.length !== 20) {
    throw new Error(
      `Merged bible has ${mergedKeys.length} rows; expected 20. Aborting before save.`
    );
  }
  for (const k of priorSceneKeys) {
    if (
      JSON.stringify(merged.scenes[k]) !== JSON.stringify(priorBible.scenes[k])
    ) {
      throw new Error(
        `Pre-existing row at ord ${k} changed during merge. Aborting before save.`
      );
    }
  }
  console.log("\n✓ Merge invariants hold: 20 rows, prior 19 untouched, ord 10 new.");

  // 6. Persist.
  console.log("\nWriting merged bible…");
  const saved = await putSoundBible(SELVAJE_PROJECT, merged);
  console.log(`✓ Saved. New version: ${saved.version}.`);

  // 7. Re-snapshot Draft 5 and assert byte-identical.
  const after = await loadDraft5Snapshot();
  if (
    after.fountainHash !== before.fountainHash ||
    after.scenesHash !== before.scenesHash ||
    after.sceneCount !== before.sceneCount
  ) {
    throw new Error(
      "Draft 5 changed during repair — this should be impossible. Investigate immediately."
    );
  }
  console.log("\n=== Draft 5 byte-identical after repair: YES ===");
  console.log(`  fountainHash:    ${after.fountainHash}`);
  console.log(`  scenesHash:      ${after.scenesHash}`);
  console.log(`  sceneCount:      ${after.sceneCount}`);

  // 8. Final coverage summary.
  const finalKeys = Object.keys(saved.scenes).sort((a, b) => Number(a) - Number(b));
  console.log("\n=== Final SoundBible state ===");
  console.log(`  scene rows:      ${finalKeys.length}`);
  console.log(`  scene row keys:  [${finalKeys.join(", ")}]`);
  console.log(`  sourceScriptId:  ${saved.sourceScriptId}`);
  console.log(`  sourceDraftLabel: ${saved.sourceDraftLabel}`);
  console.log(`  sourceWasLocked: ${saved.sourceWasLocked}`);
  console.log(`  sourceFountainHash: ${saved.sourceFountainHash}`);
  console.log(`  sourceScenesHash: ${saved.sourceScenesHash}`);
  console.log(`  sourceSceneCount: ${saved.sourceSceneCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("REPAIR FAILED:", e);
    process.exit(1);
  });
