// Read-only: dump scene 9 row + Nadia character sound signature so we
// can plan a surgical patch of the truncated AI video audio note.
import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { getSoundBible } from "../src/sound/store.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const DRAFT_5_SCRIPT_ID = "f197cbed-5c81-4301-a283-d05a2657277b";

async function main() {
  const bible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  const s9 = bible.scenes["9"];
  if (!s9) {
    console.log("(no scene 9 row)");
    return;
  }
  console.log("=== Scene 9 sound row ===");
  console.log(`sceneHeading: ${s9.sceneHeading}`);
  console.log(`locationKey:  ${s9.locationKey}`);
  console.log(`timeOfDay:    ${s9.timeOfDay}`);
  console.log(`\nambientBed (${s9.ambientBed.length}):\n${s9.ambientBed}`);
  console.log(`\nkeyDiegetic (${s9.keyDiegetic.length}):`);
  for (const k of s9.keyDiegetic) console.log(`  - ${k}`);
  console.log(`\nnonDiegeticMusic: ${s9.nonDiegeticMusic}`);
  console.log(`silenceNotes: ${s9.silenceNotes}`);
  console.log(`motifIds: [${s9.motifIds.join(", ")}]`);
  console.log(`transitionSound: ${s9.transitionSound}`);
  console.log(`\ncharacterSounds:`);
  for (const [name, line] of Object.entries(s9.characterSounds)) {
    console.log(`  ${name}: ${line}`);
  }
  console.log(`\naiVideoPromptAudioNotes (${s9.aiVideoPromptAudioNotes?.length ?? 0}):`);
  console.log(`  >>>${s9.aiVideoPromptAudioNotes}<<<`);

  console.log("\n=== Character signature: Nadia ===");
  const nadia = Object.entries(bible.characterSignatures).find(([k]) =>
    k.toLowerCase().includes("nadia")
  );
  if (nadia) {
    console.log(JSON.stringify(nadia[1], null, 2));
  } else {
    console.log("(no Nadia signature row found — listing all character names)");
    console.log(`Available: [${Object.keys(bible.characterSignatures).join(", ")}]`);
  }

  console.log("\n=== Scene 9 fountain (first 1400) ===");
  const { data: row } = await supabase
    .from("script_scenes")
    .select("ord, slugline, fountain")
    .eq("script_id", DRAFT_5_SCRIPT_ID)
    .eq("ord", 9)
    .single();
  console.log(`slugline: ${row?.slugline}`);
  console.log((row?.fountain as string ?? "").slice(0, 1400));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
