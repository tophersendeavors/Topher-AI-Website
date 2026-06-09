// Inspect what the wayfinder will surface for SELVAJE EP01.
// Run: node_modules/.bin/tsx backend/scripts/inspectWayfinder.ts

import { resolveWayfinder } from "../src/wayfinder/resolver.js";

const PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01 = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";

async function main() {
  console.log("=== Wayfinder · scope=general (Project Overview) ===");
  const general = await resolveWayfinder(PROJECT, null, "general");
  console.log(JSON.stringify(general.step, null, 2));
  console.log("\n=== Wayfinder · scope=production (Production Hub) ===");
  const prod = await resolveWayfinder(PROJECT, EP01, "production");
  console.log("Primary step:");
  console.log(JSON.stringify(prod.step, null, 2));
  console.log("\nProduction path:");
  for (const s of prod.productionPath ?? []) {
    console.log(`  ${s.state.padEnd(8)} ${s.label.padEnd(20)} ${s.status}`);
  }
  console.log("\nNon-production warnings:");
  for (const w of prod.nonProductionWarnings ?? []) {
    console.log(`  • ${w.slice(0, 120)}…`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
