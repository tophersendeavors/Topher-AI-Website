// EP01 (current draft) — opening-hook patch.
//
//   1. Pulls the current draft via episode → current=true.
//   2. Re-runs the V4.1 validator against the CURRENT fountain (so the
//      "before" baseline reflects the new tokenizer + revealed-token
//      union, isolating any real opening-hook gap).
//   3. Replaces only the opening lines so the hook's distinctive tokens
//      ("wakes", "husband", "texts") literally appear before the first
//      slugline-after-INT block.
//   4. Re-runs the validator on the patched fountain.
//   5. Persists the patched fountain + reports before/after.
//
// Does NOT touch shot briefs, prompts, or other scenes. Does NOT
// regenerate the episode chain. Does NOT touch other EP01 drafts.

import { supabase } from "../src/db/client.js";
import { validateScreenplay } from "../src/microDrama/screenplayValidator.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP01_NUMBER = 1;

const PATCH_FROM = `INT. MAYA'S BEDROOM - NIGHT

Maya jolts awake. The clock reads 3:17 AM.

Her phone buzzes on the nightstand. The screen lights her face.

The screen reads: "Where are you?"`;

const PATCH_TO = `INT. MAYA'S BEDROOM - NIGHT

Maya wakes at 3:17 AM. She jolts upright in bed.

Her phone buzzes on the nightstand. The screen lights her face. Her dead husband Daniel texts: "Where are you?"`;

function fmtCheck(label: string, c: { passes: boolean; message: string }) {
  return `  ${c.passes ? "✓ pass" : "✗ FAIL"} — ${label}: ${c.message}`;
}

async function main() {
  console.log("═══ EP01 — opening-hook patch (current draft) ═══\n");

  // Find current draft of EP01.
  const { data: ep } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("project_id", PROJECT_ID)
    .eq("number", EP01_NUMBER)
    .single();
  if (!ep) throw new Error("EP01 not found");
  const { data: script } = await supabase
    .from("scripts")
    .select("id, draft_number, current, fountain, metadata")
    .eq("episode_id", ep.id)
    .eq("current", true)
    .single();
  if (!script) throw new Error("EP01 current draft not found");
  console.log(`Episode: EP${ep.number} ${ep.title}`);
  console.log(`Script ID: ${script.id}  (draft ${script.draft_number}, current=${script.current})`);
  console.log();

  const chain = ((script.metadata as Record<string, unknown>)?.chainSnapshot ?? {}) as {
    hook?: string;
    setup?: string;
    twist?: string;
    cliffhanger?: string;
    revealedToAudience?: string;
    withheldFromAudience?: string;
  };
  console.log("Chain (for validator):");
  console.log(`  hook       : ${chain.hook}`);
  console.log(`  revealed   : ${chain.revealedToAudience}`);
  console.log(`  withheld   : ${chain.withheldFromAudience}`);

  const fountain = (script.fountain as string) ?? "";
  console.log(`\nFOUNTAIN BEFORE (first 300):`);
  console.log(fountain.slice(0, 300));

  console.log("\n── VALIDATION BEFORE PATCH (V4.1 rules) ──");
  const before = validateScreenplay(fountain, chain);
  console.log(fmtCheck("Hook in opening", before.checks.hookPresent));
  console.log(fmtCheck("Setup dramatized", before.checks.setupDramatized));
  console.log(fmtCheck("Twist present", before.checks.twistPresent));
  console.log(fmtCheck("Ends on cliffhanger", before.checks.endsOnCliffhanger));
  console.log(fmtCheck("Withheld stays withheld", before.checks.withheldNotExposed));
  console.log(`  overall: ${before.passes ? "PASS" : "FAIL"}`);

  // Apply the opening patch.
  if (!fountain.includes(PATCH_FROM.split("\n")[0])) {
    console.error("\nCould not find expected opening — refusing to patch.");
    process.exit(1);
  }
  const patched = fountain.replace(PATCH_FROM, PATCH_TO);
  if (patched === fountain) {
    console.error(
      "\nPatch made no change — the opening may already be patched. Skipping write."
    );
  }
  console.log(`\nFOUNTAIN AFTER (first 300):`);
  console.log(patched.slice(0, 300));

  console.log("\n── VALIDATION AFTER PATCH ──");
  const after = validateScreenplay(patched, chain);
  console.log(fmtCheck("Hook in opening", after.checks.hookPresent));
  console.log(fmtCheck("Setup dramatized", after.checks.setupDramatized));
  console.log(fmtCheck("Twist present", after.checks.twistPresent));
  console.log(fmtCheck("Ends on cliffhanger", after.checks.endsOnCliffhanger));
  console.log(fmtCheck("Withheld stays withheld", after.checks.withheldNotExposed));
  console.log(`  overall: ${after.passes ? "PASS" : "FAIL"}`);

  if (patched !== fountain) {
    const meta = (script.metadata as Record<string, unknown>) ?? {};
    // Persist the new fountain + cache the latest validation result alongside.
    meta.screenplayValidation = after;
    await supabase
      .from("scripts")
      .update({ fountain: patched, metadata: meta })
      .eq("id", script.id);
    console.log(`\nPersisted patched fountain + validation to script ${script.id}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
