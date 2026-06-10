// SoundBible verifier — repeatable, read-only.
//
// Asserts, for SELVAJE EP01:
//   • source provenance is present (scriptId, draft label, hashes)
//   • the source script is the current locked draft
//   • every script_scenes ord has a SoundBible row
//   • no extra rows exist for ords that aren't in the script
//   • approvedSceneCount only counts rows with approvedAt set
//   • Draft 5 is byte-identical before and after the verifier runs
//
// Exits 0 on success, 1 on any failure.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { getSoundBible } from "../src/sound/store.js";
import { computeSoundBibleCoverage } from "../src/sound/coverage.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const EXPECTED_DRAFT_NUMBER = 5;
const EXPECTED_SCENE_COUNT = 20;

function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function loadDraft5Snapshot() {
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, fountain, draft_number, metadata, current")
    .eq("project_id", SELVAJE_PROJECT)
    .eq("episode_id", EP01_ID)
    .eq("current", true);
  const script = (scripts ?? [])[0];
  if (!script) throw new Error("No current script for SELVAJE EP01.");
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, status, fountain, last_pass")
    .eq("script_id", script.id)
    .order("ord", { ascending: true });
  const sceneRows = scenes ?? [];
  return {
    scriptId: script.id as string,
    draftNumber: script.draft_number as number,
    isCurrent: script.current as boolean,
    metadata: (script.metadata as Record<string, unknown> | null) ?? {},
    fountainHash: djb2Hex((script.fountain as string) ?? ""),
    scenesHash: djb2Hex(JSON.stringify(sceneRows)),
    sceneCount: sceneRows.length,
    sceneOrds: sceneRows.map((s) => Number(s.ord)),
  };
}

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

async function main() {
  console.log("=== SoundBible verification — SELVAJE EP01 ===\n");
  const before = await loadDraft5Snapshot();
  console.log("Draft 5 (BEFORE):");
  console.log(`  scriptId:        ${before.scriptId}`);
  console.log(`  draft_number:    ${before.draftNumber}`);
  console.log(`  current:         ${before.isCurrent}`);
  console.log(`  sceneCount:      ${before.sceneCount}`);
  console.log(`  fountainHash:    ${before.fountainHash}`);
  console.log(`  scenesHash:      ${before.scenesHash}`);
  console.log("");

  assert(before.draftNumber === EXPECTED_DRAFT_NUMBER, `Source draft is Draft ${EXPECTED_DRAFT_NUMBER}`);
  assert(before.sceneCount === EXPECTED_SCENE_COUNT, `Source has ${EXPECTED_SCENE_COUNT} scenes`);
  assert(before.metadata.lockedWritingDraft === true, "Source draft is locked");

  const bible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  assert(bible.version > 0, "SoundBible has been generated (version > 0)");

  assert(
    bible.sourceScriptId === before.scriptId,
    "sourceScriptId matches current locked draft"
  );
  assert(
    bible.sourceDraftNumber === before.draftNumber,
    `sourceDraftNumber === ${before.draftNumber}`
  );
  assert(
    bible.sourceWasLocked === true,
    "sourceWasLocked === true"
  );
  assert(
    bible.sourceDraftLabel === `Draft ${before.draftNumber}`,
    `sourceDraftLabel === "Draft ${before.draftNumber}"`
  );
  assert(
    typeof bible.sourceFountainHash === "string" && bible.sourceFountainHash.length > 0,
    "sourceFountainHash present"
  );
  assert(
    typeof bible.sourceScenesHash === "string" && bible.sourceScenesHash.length > 0,
    "sourceScenesHash present"
  );
  assert(
    bible.sourceSceneCount === before.sceneCount,
    `sourceSceneCount === ${before.sceneCount}`
  );

  const coverage = computeSoundBibleCoverage(bible, before.sceneOrds);
  console.log(
    `\nCoverage: ${coverage.presentOrds.length} of ${coverage.expectedOrds.length} scenes covered.`
  );
  console.log(`  missingOrds:     [${coverage.missingOrds.join(", ")}]`);
  console.log(`  extraOrds:       [${coverage.extraOrds.join(", ")}]`);

  assert(coverage.missingOrds.length === 0, "No missing scene rows");
  assert(coverage.extraOrds.length === 0, "No extra scene rows");
  assert(coverage.isFullyCovered === true, "Coverage is full");

  // approvedSceneCount independently
  const manualApproved = Object.values(bible.scenes).filter(
    (s) => s.approvedAt != null
  ).length;
  assert(
    coverage.approvedSceneCount === manualApproved,
    "approvedSceneCount matches independent count"
  );

  // No "pending"/empty placeholders in approval-critical sections. The
  // UI renders blank ambient beds as "pending"; we treat any whitespace-
  // only or literally "pending" string as a placeholder that blocks
  // whole-bible approval.
  const PLACEHOLDER_RE = /^(?:|pending|tbd|todo|\(pending\)|\(tbd\))$/i;
  function isPlaceholder(s: string | null | undefined): boolean {
    return PLACEHOLDER_RE.test((s ?? "").trim());
  }
  const sceneAmbientGaps: string[] = [];
  for (const [ord, row] of Object.entries(bible.scenes)) {
    if (isPlaceholder(row.ambientBed)) sceneAmbientGaps.push(ord);
  }
  assert(
    sceneAmbientGaps.length === 0,
    `No "pending"/empty ambient beds on scene rows · gaps=[${sceneAmbientGaps.join(", ")}]`
  );

  const locationAmbientGaps: string[] = [];
  for (const [key, sig] of Object.entries(bible.locationSignatures)) {
    if (isPlaceholder(sig.ambientBed)) locationAmbientGaps.push(key);
  }
  assert(
    locationAmbientGaps.length === 0,
    `No "pending"/empty ambient beds on location signatures · gaps=[${locationAmbientGaps.join(", ")}]`
  );

  const characterSilenceGaps: string[] = [];
  for (const [name, sig] of Object.entries(bible.characterSignatures)) {
    // Character signatures don't have an ambientBed; check the cluster
    // of must-be-set fields the composer reads.
    if (isPlaceholder(sig.silencePattern)) characterSilenceGaps.push(name);
  }
  assert(
    characterSilenceGaps.length === 0,
    `No "pending" silence patterns on character signatures · gaps=[${characterSilenceGaps.join(", ")}]`
  );

  // Re-snapshot Draft 5 to confirm read-only.
  const after = await loadDraft5Snapshot();
  assert(after.fountainHash === before.fountainHash, "Draft 5 fountain unchanged");
  assert(after.scenesHash === before.scenesHash, "Draft 5 scene index unchanged");
  assert(after.sceneCount === before.sceneCount, "Draft 5 scene count unchanged");

  console.log("\nAll SoundBible assertions PASSED.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
