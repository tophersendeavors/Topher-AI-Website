// Re-classify EP01 SH02's fieldConfidence against the V3.6 widened source
// corpus (screenplay + Character / Location / Prop bibles). Reports the
// before/after counts so we can confirm the "2 visual details inferred"
// warning clears.

import { supabase } from "../src/db/client.js";
import { classifyBriefFields } from "../src/draft/aiPrompts/briefStrict.js";
import {
  buildProjectBiblesCorpus,
  joinSourceCorpus,
} from "../src/draft/aiPrompts/sourceCorpus.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP01_SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";
const SCENE_ORD = 1;
const SHOT_INDEX = 2;

function counts(fc: Record<string, string> | undefined) {
  const c = { source_confirmed: 0, conservative_inference: 0, speculative: 0, not_enough_source: 0 };
  for (const v of Object.values(fc ?? {})) {
    if (v in c) (c as Record<string, number>)[v]++;
  }
  return c;
}

async function main() {
  console.log("═══ EP01 SH02 — fieldConfidence re-classify ═══\n");

  // Load script, brief, and scene.
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("project_id, metadata")
    .eq("id", EP01_SCRIPT_ID)
    .single();
  if (!scriptRow) throw new Error("EP01 script not found");
  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const aiPrompts = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (aiPrompts.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown>) ?? {};
  const brief = sceneBriefs[SHOT_INDEX] as Record<string, unknown>;
  if (!brief) throw new Error(`SH${SHOT_INDEX} brief missing`);

  const beforeFc = brief.fieldConfidence as Record<string, string> | undefined;
  const before = counts(beforeFc);
  console.log("BEFORE:", before);
  console.log("  conservative+speculative =", before.conservative_inference + before.speculative);

  // Build the widened corpus.
  const { data: scene } = await supabase
    .from("script_scenes")
    .select("slugline, fountain")
    .eq("script_id", EP01_SCRIPT_ID)
    .eq("ord", SCENE_ORD)
    .single();
  const { data: proj } = await supabase
    .from("projects")
    .select("title, tone, showrunner_notes")
    .eq("id", PROJECT_ID)
    .single();
  const bibles = await buildProjectBiblesCorpus(PROJECT_ID);
  const screenplayBase = [
    (scene?.fountain as string) ?? "",
    (scene?.slugline as string) ?? "",
    ((proj?.tone as string[] | null) ?? []).join(" "),
    (proj?.showrunner_notes as string | null) ?? "",
  ].join("\n");
  const corpus = joinSourceCorpus(screenplayBase, bibles);
  console.log(
    `\nCorpus size: screenplay=${screenplayBase.length} + characters=${bibles.characters.length} + locations=${bibles.locations.length} + props=${bibles.props.length} → total=${corpus.length} chars`
  );

  // Re-classify.
  const { fieldConfidence } = classifyBriefFields(
    brief as unknown as Parameters<typeof classifyBriefFields>[0],
    corpus
  );
  const after = counts(fieldConfidence as Record<string, string>);
  console.log("\nAFTER :", after);
  console.log("  conservative+speculative =", after.conservative_inference + after.speculative);

  // Diff.
  console.log("\nDIFF (changed fields):");
  const keys = new Set([
    ...Object.keys(beforeFc ?? {}),
    ...Object.keys(fieldConfidence),
  ]);
  for (const k of keys) {
    const b = (beforeFc ?? {})[k];
    const a = (fieldConfidence as Record<string, string>)[k];
    if (b !== a) console.log(`  ${k}: ${b ?? "—"} → ${a ?? "—"}`);
  }

  // Persist.
  brief.fieldConfidence = fieldConfidence;
  brief.updatedAt = new Date().toISOString();
  sceneBriefs[SHOT_INDEX] = brief;
  briefs[SCENE_ORD] = sceneBriefs;
  aiPrompts.briefs = briefs;
  meta.aiPrompts = aiPrompts;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_SCRIPT_ID);

  console.log("\nPersisted updated fieldConfidence to brief.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
