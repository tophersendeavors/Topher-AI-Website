// Seeds Visual World Rules for the TOBURT project with the user-supplied
// micro-drama aesthetic, then runs the Production Design Pass on EP01
// Draft 4 and reports the per-scene output.

import { supabase } from "../src/db/client.js";
import { runProductionDesignPass } from "../src/productionDesign/designer.js";
import type { VisualWorldRules } from "../src/productionDesign/types.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP01_DRAFT4 = "8835aa81-2f94-404b-b9bc-7eb32d0a359b";

const VWR: VisualWorldRules = {
  aesthetic: [
    "Grounded realism",
    "Phone-era thriller",
    "Realistic small apartment interiors",
    "Observational camera (never publicity-still)",
  ],
  forbidden: [
    "Glam lighting",
    "Generic horror fog",
    "Fantasy stylization",
    "Movie-poster / key-art framing",
    "Studio / ring light",
    "Volumetric god rays",
    "Color grading that reads as music-video",
  ],
  lighting: [
    "Minimal practical light only",
    "Cold blue-white phone glow (when phone is the light source)",
    "Faint red clock glow (when clock is the light source)",
    "Dark ambient room — black falls into shadow outside practicals",
  ],
  texture: [
    "Dark negative space dominates wide frames",
    "Photographic / realistic textures (no painterly look)",
    "No oversaturation; cool to neutral palette",
    "Slight wear on surfaces (lived-in, not staged)",
  ],
  notes:
    "Project-level aesthetic frame for the TOBURT micro-drama. Applies to every shot regardless of episode or scene.",
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function main() {
  console.log("═══ Production Design — seed VWR + run PD pass ═══\n");

  // 1. Seed VWR on project metadata (preserves existing if present).
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", PROJECT_ID)
    .single();
  const meta = (proj?.metadata as Record<string, unknown> | null) ?? {};
  const existing = meta.visualWorldRules as VisualWorldRules | undefined;
  const next: VisualWorldRules = {
    ...VWR,
    createdAt: existing?.createdAt ?? VWR.createdAt,
    updatedAt: new Date().toISOString(),
  };
  meta.visualWorldRules = next;
  await supabase.from("projects").update({ metadata: meta }).eq("id", PROJECT_ID);
  console.log("1. Visual World Rules seeded:");
  console.log(`   aesthetic: ${next.aesthetic.length}`);
  console.log(`   forbidden: ${next.forbidden.length}`);
  console.log(`   lighting : ${next.lighting.length}`);
  console.log(`   texture  : ${next.texture.length}`);
  console.log();

  // 2. Run PD pass on EP01 Draft 4.
  console.log("2. Running Production Design Pass on EP01 Draft 4…");
  const result = await runProductionDesignPass(EP01_DRAFT4);
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const sm = (scriptRow!.metadata as Record<string, unknown>) ?? {};
  sm.productionDesign = result;
  await supabase
    .from("scripts")
    .update({ metadata: sm })
    .eq("id", EP01_DRAFT4);
  console.log(
    `   ${result.summary.scenesTotal} scene(s): ${result.summary.scenesReady} ready, ${result.summary.scenesWarning} warning, ${result.summary.scenesFail} fail\n`
  );

  // 3. Print per-scene output.
  for (const ord of Object.keys(result.scenes)) {
    const r = result.scenes[Number(ord)];
    console.log(`── SCENE ${ord} — ${r.slugline} ──`);
    console.log(`Summary: ${r.designSummary}`);
    if (r.warnings.length > 0) {
      console.log("Warnings:");
      for (const w of r.warnings) {
        console.log(`  [${w.severity}] ${w.message}`);
      }
    }
    console.log("\n— Spatial map —");
    console.log(r.spatialMap || "(none)");
    console.log("\n— Prop map —");
    console.log(r.propMap || "(none)");
    console.log("\n— Lighting map —");
    console.log(r.lightingMap || "(none)");
    console.log("\n— Set dressing —");
    console.log(r.setDressing || "(none)");
    console.log("\n— Unified continuity prompt (injected into every shot in this scene) —");
    console.log(r.continuityPrompt || "(none)");
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
