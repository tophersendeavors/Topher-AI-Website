// EP01 Draft 4 — Production Pipeline (full, fresh).
//
//   1. Patches the opening comma per user request:
//        "Her dead husband Daniel texts: \"Where are you?\""
//      → "Her dead husband, Daniel, texts: \"Where are you?\""
//   2. Re-runs the screenplay validator and confirms 5/5 still pass.
//   3. Indexes scenes on Draft 4.
//   4. SKIPS LLM cast extraction (Maya + Daniel are writer-approved;
//      reusing existing Character Bible v3.1 records).
//   5. SKIPS LLM location extraction (Maya's Bedroom Location Bible is
//      already seeded at the project level).
//   6. Auto-builds briefs for every Draft 4 scene from the patched
//      screenplay (1 LLM call per scene).
//   7. For every brief, generates BOTH veo + kling prompts via the
//      main composer — picks up the V3.4 continuity directive (Maya's
//      Bedroom + Prop Bibles), V3.2 eyeline rules, V3.5 hero rule,
//      V3.8 CHAR-shot relaxation, V3.7 portrait-disclaimer, plus the
//      per-model V3 style guides.
//   8. Runs the continuity pass on Draft 4.
//   9. Reports counts, readiness summary, continuity result.
//
// Operates ONLY on the current Draft 4 (script_id 8835aa81-...).
// Does NOT touch Draft 3. Does NOT use Draft 3 briefs/prompts.

import { supabase } from "../src/db/client.js";
import { validateScreenplay } from "../src/microDrama/screenplayValidator.js";
import { autoBuildSceneBriefs } from "../src/draft/aiPrompts/autoBuild.js";
import { generatePromptForModel } from "../src/draft/aiPrompts/engine.js";
import { runContinuityPass } from "../src/continuity/validator.js";
import { indexScenes } from "../src/screenplay/sceneIndex.js";
import type { ModelKey } from "../src/draft/aiPrompts/types.js";

const EP01_DRAFT4 = "8835aa81-2f94-404b-b9bc-7eb32d0a359b";
const DRAFT3_HISTORICAL = "2d46587a-65b8-4980-9d13-5354ae4518f8";

const COMMA_FROM = `Her dead husband Daniel texts: "Where are you?"`;
const COMMA_TO = `Her dead husband, Daniel, texts: "Where are you?"`;

function fmtCheck(label: string, c: { passes: boolean; message: string }) {
  return `  ${c.passes ? "✓" : "✗"} ${label}: ${c.message}`;
}

async function main() {
  console.log("═══ EP01 Draft 4 — Production Pipeline ═══\n");

  // ---- 1. Patch comma in opening ---------------------------------------
  const { data: script } = await supabase
    .from("scripts")
    .select("id, project_id, episode_id, current, fountain, metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  if (!script) throw new Error("Draft 4 not found");
  if (!script.current) {
    console.warn("WARNING: Draft 4 is not marked current. Aborting.");
    process.exit(1);
  }
  console.log(`Draft 4 confirmed: script_id=${script.id}, current=${script.current}`);
  console.log(`(Draft 3 historical id ${DRAFT3_HISTORICAL} will NOT be touched.)\n`);

  const fountain = (script.fountain as string) ?? "";
  const patchedFountain = fountain.includes(COMMA_FROM)
    ? fountain.replace(COMMA_FROM, COMMA_TO)
    : fountain;
  if (patchedFountain === fountain) {
    console.log("Opening already in target form — skipping comma patch.");
  } else {
    console.log("Patching opening comma:");
    console.log(`  before: ${COMMA_FROM}`);
    console.log(`  after : ${COMMA_TO}`);
    await supabase
      .from("scripts")
      .update({ fountain: patchedFountain })
      .eq("id", EP01_DRAFT4);
    console.log("  persisted.");
  }

  // ---- 2. Re-validate screenplay ---------------------------------------
  console.log("\n── Screenplay validation ──");
  const chain = ((script.metadata as Record<string, unknown>)?.chainSnapshot ?? {}) as Parameters<
    typeof validateScreenplay
  >[1];
  const validation = validateScreenplay(patchedFountain, chain);
  console.log(fmtCheck("Hook in opening", validation.checks.hookPresent));
  console.log(fmtCheck("Setup dramatized", validation.checks.setupDramatized));
  console.log(fmtCheck("Twist present", validation.checks.twistPresent));
  console.log(fmtCheck("Ends on cliffhanger", validation.checks.endsOnCliffhanger));
  console.log(fmtCheck("Withheld stays withheld", validation.checks.withheldNotExposed));
  console.log(`  overall: ${validation.passes ? "PASS" : "FAIL"}`);
  if (!validation.passes) {
    console.error("Screenplay validation failed — aborting production run.");
    process.exit(1);
  }
  // Cache the validation alongside the script.
  const sMeta = (script.metadata as Record<string, unknown>) ?? {};
  sMeta.screenplayValidation = validation;
  await supabase
    .from("scripts")
    .update({ metadata: sMeta })
    .eq("id", EP01_DRAFT4);

  // ---- 3. Scene indexing ----------------------------------------------
  console.log("\n── Scene indexing ──");
  const { count: existingScenes } = await supabase
    .from("script_scenes")
    .select("ord", { count: "exact", head: true })
    .eq("script_id", EP01_DRAFT4);
  let sceneCount = existingScenes ?? 0;
  if (sceneCount === 0) {
    const r = await indexScenes(EP01_DRAFT4, patchedFountain);
    sceneCount = r.count;
    console.log(`  Indexed ${sceneCount} scene(s) from the patched fountain.`);
  } else {
    console.log(`  Already indexed (${sceneCount} scene[s]). Re-indexing to pick up the comma patch.`);
    // Re-index against current fountain to catch the patched opening.
    const r = await indexScenes(EP01_DRAFT4, patchedFountain);
    sceneCount = r.count;
    console.log(`  Re-indexed: ${sceneCount} scene(s).`);
  }

  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", EP01_DRAFT4)
    .order("ord");
  console.log(`  Scenes:`);
  for (const s of scenes ?? []) {
    console.log(`    SC${String(s.ord).padStart(2, "0")} — ${s.slugline}`);
  }

  // ---- 4. Cast / 5. Location: SKIPPED (using existing bibles) ----------
  console.log(
    "\n── Cast & Location extraction SKIPPED ──"
  );
  console.log("  Reusing existing Character Bible (Maya v3.1, Daniel text-only).");
  console.log("  Reusing existing Location Bible (Maya's Bedroom).");
  console.log("  Reusing existing Prop Bibles (phone, clock, closet door, blood smear).");

  // ---- 6. Auto-build briefs per scene ----------------------------------
  console.log("\n── Brief generation ──");
  const briefsByScene: Record<number, number> = {};
  for (const s of scenes ?? []) {
    const r = await autoBuildSceneBriefs({
      scriptId: EP01_DRAFT4,
      sceneOrd: s.ord as number,
      opts: {
        mode: "replace",
        confirmOverwriteUserEdits: true,
        sourceStrict: true,
      },
    });
    briefsByScene[s.ord as number] = r.briefs.length;
    console.log(`  SC${String(s.ord).padStart(2, "0")}: ${r.briefs.length} brief(s) built.`);
  }
  const totalBriefs = Object.values(briefsByScene).reduce((a, b) => a + b, 0);

  // ---- 7. Generate prompts (veo + kling) per shot ----------------------
  console.log("\n── Prompt generation (veo + kling) ──");
  const { data: afterBriefs } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const briefsRoot = ((afterBriefs!.metadata as Record<string, unknown>)?.aiPrompts as Record<
    string,
    unknown
  >)?.briefs as Record<string, Record<string, unknown>> | undefined;
  let promptCount = 0;
  let readinessFail = 0;
  let readinessOk = 0;
  for (const sceneOrdStr of Object.keys(briefsRoot ?? {})) {
    const sceneOrd = Number(sceneOrdStr);
    const shotMap = (briefsRoot![sceneOrdStr] ?? {}) as Record<string, unknown>;
    for (const shotIdxStr of Object.keys(shotMap)) {
      const shotIndex = Number(shotIdxStr);
      for (const model of ["veo", "kling"] as ModelKey[]) {
        try {
          const v = await generatePromptForModel({
            scriptId: EP01_DRAFT4,
            sceneOrd,
            shotIndex,
            model,
          });
          if (v.readiness?.ok) readinessOk += 1;
          else readinessFail += 1;
          promptCount += 1;
          console.log(
            `  SC${String(sceneOrd).padStart(2, "0")} SH${String(shotIndex).padStart(2, "0")} ${model.padEnd(5)} — ${v.readiness?.ok ? "ready" : "issues=" + v.readiness?.issues?.length}`
          );
        } catch (err) {
          console.log(
            `  SC${sceneOrd} SH${shotIndex} ${model} — ERROR: ${(err as Error).message}`
          );
        }
      }
    }
  }

  // ---- 8. Continuity pass ----------------------------------------------
  console.log("\n── Continuity pass ──");
  const result = await runContinuityPass(EP01_DRAFT4);
  const { data: s2 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const m2 = (s2!.metadata as Record<string, unknown>) ?? {};
  m2.continuity = result;
  await supabase.from("scripts").update({ metadata: m2 }).eq("id", EP01_DRAFT4);
  const cFails = result.issues.filter((i) => i.severity === "fail").length;
  const cWarns = result.issues.filter((i) => i.severity === "warning").length;
  console.log(`  ${cFails} fail / ${cWarns} warning`);
  if (cFails + cWarns > 0) {
    for (const i of result.issues.slice(0, 20)) {
      const w = i.where;
      console.log(
        `    [${i.severity}] [${i.category}] SC${w.sceneOrd ?? "?"} SH${w.shotIndex ?? "?"} — ${i.message}`
      );
    }
  }

  // ---- 9. Verify Draft 3 untouched -------------------------------------
  const { data: d3 } = await supabase
    .from("scripts")
    .select("draft_number, current")
    .eq("id", DRAFT3_HISTORICAL)
    .single();
  console.log(
    `\nDraft 3 status: draft_number=${d3?.draft_number}, current=${d3?.current} (untouched)`
  );

  // ---- 10. Final summary -----------------------------------------------
  console.log("\n═══ EP01 Draft 4 Production Pipeline — Summary ═══");
  console.log(`  Draft 4 script_id    : ${EP01_DRAFT4}`);
  console.log(`  Scenes               : ${sceneCount}`);
  console.log(`  Briefs               : ${totalBriefs}`);
  console.log(`  Prompts (×2 models)  : ${promptCount}`);
  console.log(`  Readiness OK         : ${readinessOk}`);
  console.log(`  Readiness issues     : ${readinessFail}`);
  console.log(`  Continuity fails     : ${cFails}`);
  console.log(`  Continuity warnings  : ${cWarns}`);
  console.log(`  Draft 3 used         : NO (id ${DRAFT3_HISTORICAL} untouched)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
