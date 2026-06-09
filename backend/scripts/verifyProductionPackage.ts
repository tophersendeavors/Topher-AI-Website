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
  console.log("\nAll assertions PASSED.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
