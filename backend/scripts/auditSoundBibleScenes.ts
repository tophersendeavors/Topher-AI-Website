// READ-ONLY audit: does the SELVAJE EP01 Sound Bible cover every
// scene in Draft 5? No mutations. No regeneration. Just report.

import "dotenv/config";
import { supabase } from "../src/db/client.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";

interface Json {
  [k: string]: unknown;
}

async function main() {
  // 1. Pull the project metadata to find the sound bible
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", SELVAJE_PROJECT)
    .maybeSingle();
  const meta = ((proj?.metadata as Json | null) ?? {}) as Json;
  const soundBibles = (meta.soundBibles as Json | undefined) ?? {};
  const sb = (soundBibles[EP01_ID] as Json | undefined) ?? null;

  console.log("=== Sound Bible audit — SELVAJE EP01 ===\n");
  if (!sb) {
    console.log("Sound Bible: NOT GENERATED for EP01.");
    process.exit(0);
  }
  const sbScriptId = sb.scriptId as string | undefined;
  const sbVersion = sb.version as number | undefined;
  const sbApproved = sb.approvedAt as string | null | undefined;
  const sbScenes = (sb.scenes as Record<string, Json> | undefined) ?? {};
  const sbSceneKeys = Object.keys(sbScenes).sort(
    (a, b) => Number(a) - Number(b)
  );
  console.log("Sound Bible metadata:");
  console.log(`  scriptId:        ${sbScriptId ?? "(not set)"}`);
  console.log(`  version:         ${sbVersion ?? "(not set)"}`);
  console.log(`  approvedAt:      ${sbApproved ?? "(null)"}`);
  console.log(`  scene rows:      ${sbSceneKeys.length}`);
  console.log(`  scene row keys:  [${sbSceneKeys.join(", ")}]`);

  // 2. Pull the current Draft 5 script for EP01.
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, draft_number, current, metadata")
    .eq("project_id", SELVAJE_PROJECT)
    .eq("episode_id", EP01_ID);
  const current = (scripts ?? []).find((s) => s.current === true);
  if (!current) {
    console.log("\nNo current script found for EP01.");
    process.exit(0);
  }
  const draftMeta = ((current.metadata as Json | null) ?? {}) as Json;
  const isLocked = draftMeta.lockedWritingDraft === true;
  console.log("\nCurrent script:");
  console.log(`  scriptId:        ${current.id}`);
  console.log(`  draft_number:    ${current.draft_number}`);
  console.log(`  lockedDraft:     ${isLocked}`);

  // 3. Pull the scene index for the current script.
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, slugline, status")
    .eq("script_id", current.id)
    .order("ord", { ascending: true });
  const sceneRows = (scenes ?? []) as Array<{
    id: string;
    ord: number;
    slugline: string | null;
    status: string | null;
  }>;
  console.log(`\nDraft ${current.draft_number} scene index:`);
  console.log(`  total scenes:    ${sceneRows.length}`);
  console.log(`  scene ords:      [${sceneRows.map((s) => s.ord).join(", ")}]`);

  // 4. Cross-reference.
  console.log("\n=== Cross-reference ===");
  const scriptIdMatches = sbScriptId === current.id;
  console.log(
    `  Sound Bible scriptId matches Draft ${current.draft_number}: ${
      scriptIdMatches ? "YES" : "NO"
    }`
  );
  if (!scriptIdMatches) {
    console.log(`    (sb scriptId=${sbScriptId} · current=${current.id})`);
  }

  const scriptSceneOrds = new Set(sceneRows.map((s) => Number(s.ord)));
  const sbSceneOrds = new Set(sbSceneKeys.map((k) => Number(k)));
  const missingFromSB = [...scriptSceneOrds]
    .filter((o) => !sbSceneOrds.has(o))
    .sort((a, b) => a - b);
  const extraInSB = [...sbSceneOrds]
    .filter((o) => !scriptSceneOrds.has(o))
    .sort((a, b) => a - b);
  console.log(`  Scenes in script but missing from Sound Bible: ${missingFromSB.length}`);
  for (const ord of missingFromSB) {
    const s = sceneRows.find((r) => Number(r.ord) === ord);
    console.log(`    · ord ${ord} — ${s?.slugline ?? "(no slugline)"}`);
  }
  console.log(`  Scenes in Sound Bible but missing from script: ${extraInSB.length}`);
  for (const ord of extraInSB) {
    console.log(`    · ord ${ord}`);
  }

  // 5. Approval rollup.
  let approvedCount = 0;
  for (const k of sbSceneKeys) {
    const r = sbScenes[k] as Record<string, unknown>;
    if (r.approvedAt != null) approvedCount += 1;
  }
  console.log(`\n  Approved scene rows:  ${approvedCount} / ${sbSceneKeys.length}`);
  console.log(`  Display would show:  Scenes approved ${approvedCount}/${sbSceneKeys.length}`);

  console.log("\n=== Verdict ===");
  if (sceneRows.length === sbSceneKeys.length && missingFromSB.length === 0) {
    console.log("Sound Bible covers every scene in the current draft.");
  } else {
    console.log(
      `Sound Bible has ${sbSceneKeys.length} rows; Draft ${current.draft_number} has ${sceneRows.length} scenes. ` +
        (missingFromSB.length > 0
          ? `Missing: scene_ord ${missingFromSB.join(", ")}.`
          : "Counts differ but no missing ords detected (check key shape).")
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
