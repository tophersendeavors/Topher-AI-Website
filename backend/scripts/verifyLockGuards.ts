// Verify the lock guards refuse to mutate a locked draft.
// READ-ONLY against the live DB except for the guards themselves, which
// would only write if they failed. The script runs each dangerous path
// pointed at Draft 5 (which is locked) and asserts each one throws a
// LockedDraftError. If any path produces a write or doesn't throw, the
// script exits with a non-zero code and the restoration is aborted.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import {
  assertScriptUnlockedForMutation,
  assertCanDemoteLockedCurrent,
  isScriptLocked,
  LockedDraftError,
} from "../src/draft/lockGuard.js";
import { draftSceneGated } from "../src/draft/gatedDraft.js";
import { reassembleLiveFountain } from "../src/draft/reassemble.js";
import { indexScenes } from "../src/screenplay/sceneIndex.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const DRAFT_5 = "f197cbed-5c81-4301-a283-d05a2657277b";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";

interface Probe {
  name: string;
  blocked: boolean;
  error?: string;
}

async function snapshot() {
  const { data: script } = await supabase
    .from("scripts")
    .select("fountain, updated_at, metadata")
    .eq("id", DRAFT_5)
    .single();
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, status, fountain, last_pass")
    .eq("script_id", DRAFT_5)
    .order("ord", { ascending: true });
  return {
    fountainLen: (script?.fountain as string)?.length ?? 0,
    fountainHash: hash((script?.fountain as string) ?? ""),
    updatedAt: script?.updated_at,
    sceneCount: scenes?.length ?? 0,
    scenesHash: hash(JSON.stringify(scenes ?? [])),
  };
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function main() {
  console.log("===== PRE-CHECK =====");
  const locked = await isScriptLocked(DRAFT_5);
  console.log("Draft 5 isScriptLocked():", locked);
  if (!locked) {
    console.error("ABORT — Draft 5 is not locked. Guard test would not be meaningful.");
    process.exit(2);
  }

  const before = await snapshot();
  console.log("Pre-test snapshot:", before);

  const probes: Probe[] = [];

  // Probe 1: assertScriptUnlockedForMutation (base primitive)
  try {
    await assertScriptUnlockedForMutation(DRAFT_5, "test:assertScriptUnlockedForMutation");
    probes.push({ name: "assertScriptUnlockedForMutation", blocked: false });
  } catch (err) {
    probes.push({
      name: "assertScriptUnlockedForMutation",
      blocked: err instanceof LockedDraftError,
      error: (err as Error).message,
    });
  }

  // Probe 2: draftSceneGated (the path that actually caused the mutation)
  // Pick ord 6, which is still pending — if the lock is missing, it would
  // overwrite scene 6's fountain.
  try {
    await draftSceneGated({ scriptId: DRAFT_5, ord: 6, user: { id: "test" } });
    probes.push({ name: "draftSceneGated(ord=6)", blocked: false });
  } catch (err) {
    probes.push({
      name: "draftSceneGated(ord=6)",
      blocked: err instanceof LockedDraftError,
      error: (err as Error).message,
    });
  }

  // Probe 3: reassembleLiveFountain — the bottom-of-stack primitive
  try {
    await reassembleLiveFountain(DRAFT_5);
    probes.push({ name: "reassembleLiveFountain", blocked: false });
  } catch (err) {
    probes.push({
      name: "reassembleLiveFountain",
      blocked: err instanceof LockedDraftError,
      error: (err as Error).message,
    });
  }

  // Probe 4: indexScenes — without allowLocked
  try {
    await indexScenes(DRAFT_5, "EXT. SOMEWHERE - DAY\n\nA test.\n");
    probes.push({ name: "indexScenes (no allowLocked)", blocked: false });
  } catch (err) {
    probes.push({
      name: "indexScenes (no allowLocked)",
      blocked: err instanceof LockedDraftError,
      error: (err as Error).message,
    });
  }

  // Probe 5: assertCanDemoteLockedCurrent — without override
  try {
    await assertCanDemoteLockedCurrent({ projectId: SELVAJE_PROJECT, episodeId: EP01_ID });
    probes.push({ name: "assertCanDemoteLockedCurrent (no override)", blocked: false });
  } catch (err) {
    probes.push({
      name: "assertCanDemoteLockedCurrent (no override)",
      blocked: err instanceof LockedDraftError,
      error: (err as Error).message,
    });
  }

  // Probe 6: assertCanDemoteLockedCurrent — WITH override (should pass)
  let overridePassed = false;
  try {
    await assertCanDemoteLockedCurrent(
      { projectId: SELVAJE_PROJECT, episodeId: EP01_ID },
      { allowLockedDemotion: true }
    );
    overridePassed = true;
  } catch {
    overridePassed = false;
  }

  console.log("\n===== PROBE RESULTS =====");
  for (const p of probes) {
    console.log(
      `${p.blocked ? "BLOCKED ✓" : "NOT BLOCKED ✗"}  ${p.name}` +
        (p.error ? ` — ${p.error.slice(0, 100)}` : "")
    );
  }
  console.log(
    `${overridePassed ? "PASSED ✓ " : "FAILED ✗ "}  assertCanDemoteLockedCurrent with allowLockedDemotion:true (override works)`
  );

  // Snapshot AFTER — must be identical to BEFORE
  const after = await snapshot();
  console.log("\nPost-test snapshot:", after);
  const unchanged =
    before.fountainHash === after.fountainHash &&
    before.scenesHash === after.scenesHash &&
    before.fountainLen === after.fountainLen &&
    before.sceneCount === after.sceneCount &&
    before.updatedAt === after.updatedAt;
  console.log("Draft 5 unchanged by probes:", unchanged ? "YES ✓" : "NO ✗");

  const allBlocked = probes.every((p) => p.blocked);
  if (!allBlocked || !overridePassed || !unchanged) {
    console.error("\nGUARD VERIFICATION FAILED.");
    process.exit(1);
  }
  console.log("\nALL GUARDS WORKING.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VERIFY FAILED:", err);
    process.exit(1);
  });
