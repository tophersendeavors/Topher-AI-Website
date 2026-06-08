// Runs the heuristic Continuity Pass over EP01 and prints a structured
// report. Also persists the result to script.metadata.continuity so the
// UI picks it up.

import { supabase } from "../src/db/client.js";
import { runContinuityPass } from "../src/continuity/validator.js";
import type { ContinuityIssue } from "../src/continuity/types.js";

const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";

async function main() {
  console.log("═══ EP01 Continuity Pass ═══\n");
  const result = await runContinuityPass(EP01_SCRIPT_ID);

  console.log("Summary by category:");
  for (const [cat, counts] of Object.entries(result.summary)) {
    const total = counts.pass + counts.warning + counts.fail;
    if (total === 0) continue;
    console.log(
      `  ${cat.padEnd(20)} pass=${counts.pass} warning=${counts.warning} fail=${counts.fail}`
    );
  }
  console.log();

  const bySeverity = (sev: ContinuityIssue["severity"]) =>
    result.issues.filter((i) => i.severity === sev);

  for (const sev of ["fail", "warning"] as const) {
    const items = bySeverity(sev);
    if (items.length === 0) continue;
    console.log(`── ${sev.toUpperCase()} (${items.length}) ──`);
    for (const i of items) {
      const w = i.where;
      const loc = [
        w.episodeNumber != null ? `EP${String(w.episodeNumber).padStart(2, "0")}` : null,
        w.sceneOrd != null ? `SC${String(w.sceneOrd).padStart(2, "0")}` : null,
        w.shotIndex != null ? `SH${String(w.shotIndex).padStart(2, "0")}` : null,
        w.characterName,
        w.locationName,
        w.propName,
      ]
        .filter(Boolean)
        .join(" · ");
      console.log(`  [${i.category}] ${loc || "(global)"}`);
      console.log(`    ${i.message}`);
      if (i.suggestedFix) console.log(`    fix: ${i.suggestedFix}`);
    }
    console.log();
  }

  // Persist.
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  const meta = (script?.metadata as Record<string, unknown>) ?? {};
  meta.continuity = result;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_SCRIPT_ID);
  console.log("Persisted to scripts.metadata.continuity.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
