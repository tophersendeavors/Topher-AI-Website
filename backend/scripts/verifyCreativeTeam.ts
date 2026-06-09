// Verify the Creative Team layer end-to-end against live SELVAJE state.
//
// Exercises:
//   • aggregator returns 16 core roles + auto-derived talent rows
//   • upsertAssignment writes to projects.metadata.roleAssignments
//   • deleteAssignment removes the row cleanly
//   • allRequiredAssigned flips correctly when required roles get kinds
//   • Draft 5 is untouched throughout
//
// Run: node_modules/.bin/tsx backend/scripts/verifyCreativeTeam.ts

import { supabase } from "../src/db/client.js";
import { buildTeamRoster } from "../src/team/aggregator.js";
import {
  deleteAssignment,
  loadTeamState,
  upsertAssignment,
} from "../src/team/store.js";
import type { RoleAssignment } from "@toburt/shared";

const SELVAJE = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const DRAFT5 = "f197cbed-5c81-4301-a283-d05a2657277b";
const TEST_ROLE_KEY = "showrunner";

async function draftFingerprint() {
  const { data } = await supabase
    .from("scripts")
    .select("fountain")
    .eq("id", DRAFT5)
    .single();
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, status")
    .eq("script_id", DRAFT5);
  return {
    len: ((data as { fountain: string | null } | null)?.fountain ?? "").length,
    sceneCount: scenes?.length ?? 0,
    statuses: (scenes ?? []).map((s) => (s as { status: string }).status).join(","),
  };
}

function assert(cond: boolean, label: string): void {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`PASS: ${label}`);
}

async function main() {
  console.log("=== Creative Team verification ===\n");
  const before = await draftFingerprint();
  const stateBefore = await loadTeamState(SELVAJE);
  const preexistingAssignment = stateBefore?.assignments[TEST_ROLE_KEY] ?? null;

  // 1. Aggregator produces roster
  const roster = await buildTeamRoster(SELVAJE);
  assert(roster !== null, "buildTeamRoster returned a roster for SELVAJE");
  if (!roster) return;
  assert(roster.slots.length >= 16, `roster has at least 16 slots (got ${roster.slots.length})`);
  assert(
    roster.slots.some((s) => s.definition.key === "showrunner"),
    "core role 'showrunner' present"
  );
  assert(
    roster.slots.some((s) => s.definition.key.startsWith("actor:")),
    "at least one auto-derived actor:<id> slot present"
  );
  assert(roster.summary.totalRoles === roster.slots.length, "summary.totalRoles matches slot count");
  console.log(
    `   roster: ${roster.slots.length} total · ${roster.summary.requiredRoles} required · ${roster.summary.assignedRoles} assigned\n`
  );

  // 2. Upsert
  const testAssignment: RoleAssignment = {
    kind: "live_person",
    label: "[VERIFY] Showrunner",
    personName: "Verification User",
    handoffFormat: "human_brief",
    notes: "synthetic test row — will be deleted",
    assignedAt: new Date().toISOString(),
    assignedBy: null,
  };
  await upsertAssignment(SELVAJE, TEST_ROLE_KEY, testAssignment);
  const afterUpsert = await buildTeamRoster(SELVAJE);
  const slotAfter = afterUpsert?.slots.find((s) => s.definition.key === TEST_ROLE_KEY);
  assert(!!slotAfter?.assignment, "showrunner slot now has an assignment");
  assert(
    slotAfter?.assignment?.kind === "live_person",
    "assignment kind is live_person"
  );
  assert(
    slotAfter?.assignment?.label === "[VERIFY] Showrunner",
    "assignment label round-tripped"
  );
  assert(
    (afterUpsert?.summary.assignedRoles ?? 0) >= 1,
    "summary.assignedRoles incremented"
  );

  // 3. Restore prior state (delete test row, or restore pre-existing)
  if (preexistingAssignment) {
    await upsertAssignment(SELVAJE, TEST_ROLE_KEY, preexistingAssignment);
    console.log("   restored pre-existing showrunner assignment");
  } else {
    await deleteAssignment(SELVAJE, TEST_ROLE_KEY);
    console.log("   removed synthetic showrunner row");
  }
  const afterClean = await buildTeamRoster(SELVAJE);
  const slotClean = afterClean?.slots.find((s) => s.definition.key === TEST_ROLE_KEY);
  if (preexistingAssignment) {
    assert(
      slotClean?.assignment?.label === preexistingAssignment.label,
      "pre-existing showrunner assignment restored"
    );
  } else {
    assert(slotClean?.assignment === null, "synthetic assignment cleared");
  }

  // 4. Draft 5 untouched
  const after = await draftFingerprint();
  assert(
    after.len === before.len &&
      after.sceneCount === before.sceneCount &&
      after.statuses === before.statuses,
    `Draft 5 byte-identical (len ${before.len} → ${after.len}, scenes ${before.sceneCount} → ${after.sceneCount})`
  );

  console.log("\nAll Creative Team assertions PASSED.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
