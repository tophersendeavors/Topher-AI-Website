// READ-ONLY check: build the production package for SELVAJE EP01 and
// dump the manifest + file list. Asserts: zip is a valid PK header,
// manifest.lockedWritingDraft === true, screenplay folder is present.

import "dotenv/config";
import { buildProductionPackage } from "../src/productionPackage/builder.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

async function main() {
  const { zip, manifest, filename } = await buildProductionPackage({
    projectId: SELVAJE_PROJECT,
    episodeId: EP01_ID,
  });
  console.log("Filename:", filename);
  console.log("Zip bytes:", zip.length);
  console.log("Manifest:");
  console.log(JSON.stringify(manifest, null, 2));
  assert(zip[0] === 0x50 && zip[1] === 0x4b, "zip starts with 'PK' (valid PKZIP)");
  assert(zip.length > 1000, "zip is non-trivial size");
  assert(manifest.scriptId, "manifest carries scriptId");
  assert(manifest.lockedWritingDraft === true, "Draft 5 is recognised as locked");
  assert(manifest.draftNumber === 5, "Draft 5 selected as source");
  assert(manifest.includedSections.includes("screenplay.fountain"), "fountain included");
  assert(manifest.includedSections.includes("screenplay.fdx"), "FDX included");
  assert(manifest.includedSections.includes("screenplay.pdf"), "PDF included");
  assert(manifest.includedSections.includes("productionBible.markdown"), "master bible included");
  assert(manifest.scope === "episode", "scope is episode");

  // Role-routed briefs (Phase D follow-up). When SELVAJE has zero role
  // assignments — its current state — the bundle correctly omits the
  // role-briefs/ folder and flags it as a warning.
  assert(typeof manifest.roleBriefsIncluded === "boolean", "manifest carries roleBriefsIncluded flag");
  assert(typeof manifest.roleAssignmentCount === "number", "manifest carries roleAssignmentCount");
  assert(typeof manifest.roleSkippedCount === "number", "manifest carries roleSkippedCount");
  if ((manifest.roleAssignmentCount ?? 0) === 0) {
    assert(
      manifest.roleBriefsIncluded === false,
      "no role assignments → roleBriefsIncluded false"
    );
    assert(
      !manifest.includedSections.includes("roleBriefs.json"),
      "no role assignments → roleBriefs.json absent from includedSections"
    );
    const warn = manifest.warnings.find((w) => w.section === "roleBriefs");
    assert(
      !!warn && /not included|not assigned/i.test(warn.message),
      "warning surfaces unassigned roles"
    );
  } else {
    assert(
      manifest.roleBriefsIncluded === true,
      "assignments exist → roleBriefsIncluded true"
    );
    assert(
      manifest.includedSections.includes("roleBriefs.json"),
      "roleBriefs.json listed in includedSections"
    );
    assert(
      manifest.includedSections.includes("roleBriefs.markdown"),
      "roleBriefs.markdown listed in includedSections"
    );
  }

  console.log("\nAll assertions PASSED.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
