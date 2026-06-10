// Read-only: find the Canopy Lookout Point location signature and the
// Scene 7 sound row so we can plan a surgical patch.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { getSoundBible } from "../src/sound/store.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";

async function main() {
  const bible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  console.log("=== Location Signatures ===");
  for (const [key, sig] of Object.entries(bible.locationSignatures)) {
    console.log(`- key=${key} name=${sig.locationName}`);
    console.log(`  ambientBed: ${sig.ambientBed}`);
    console.log(`  keyDiegeticPresent: [${sig.keyDiegeticPresent.join(", ")}]`);
    console.log(`  anchoredMotifIds: [${sig.anchoredMotifIds.join(", ")}]`);
    console.log(`  musicProhibited: ${sig.musicProhibited}`);
    console.log(`  notes: ${sig.notes.slice(0, 100)}`);
    console.log(`  sectionApprovedAt: ${sig.sectionApprovedAt}`);
    console.log("");
  }
  console.log("=== Scene 7 sound row ===");
  const s7 = bible.scenes["7"];
  if (!s7) {
    console.log("(no scene 7 row)");
  } else {
    console.log(`  sceneHeading: ${s7.sceneHeading}`);
    console.log(`  locationKey: ${s7.locationKey}`);
    console.log(`  timeOfDay: ${s7.timeOfDay}`);
    console.log(`  ambientBed: ${s7.ambientBed}`);
    console.log(`  keyDiegetic: [${s7.keyDiegetic.join(", ")}]`);
    console.log(`  nonDiegeticMusic: ${s7.nonDiegeticMusic}`);
    console.log(`  motifIds: [${s7.motifIds.join(", ")}]`);
    console.log(`  characterSounds: ${JSON.stringify(s7.characterSounds)}`);
  }
  console.log("\n=== Scene 7 fountain (script_scenes) ===");
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id")
    .eq("project_id", SELVAJE_PROJECT)
    .eq("episode_id", EP01_ID)
    .eq("current", true);
  const scriptId = scripts?.[0]?.id;
  if (scriptId) {
    const { data: row } = await supabase
      .from("script_scenes")
      .select("ord, slugline, fountain")
      .eq("script_id", scriptId)
      .eq("ord", 7)
      .single();
    console.log(`  slugline: ${row?.slugline}`);
    console.log(`  fountain (first 600): ${(row?.fountain ?? "").slice(0, 600)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
