// Inspect what the wayfinder will surface for SELVAJE EP01.
// Run: node_modules/.bin/tsx backend/scripts/inspectWayfinder.ts

import { resolveWayfinder } from "../src/wayfinder/resolver.js";

const PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01 = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";

async function main() {
  console.log("=== Wayfinder — project scope (no episode) ===");
  const proj = await resolveWayfinder(PROJECT, null);
  console.log(JSON.stringify(proj, null, 2));
  console.log("\n=== Wayfinder — EP01 scope ===");
  const ep = await resolveWayfinder(PROJECT, EP01);
  console.log(JSON.stringify(ep, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
