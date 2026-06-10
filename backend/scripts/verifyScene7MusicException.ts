// Read-only verification of the Scene 7 near-musical canon fix.
// Asserts the conflict is resolved and Scene 10 is untouched. Renders the
// three adapter views for scene:7 to confirm they now emit the cue rather
// than a "no music" record. Exits 0 on success, 1 on any failure.

import "dotenv/config";
import { getSoundBible, getMusicPromptPack } from "../src/sound/store.js";
import { resolveSceneMusicException } from "../src/sound/musicGenerator.js";
import {
  renderSunoPrompt,
  renderUdioPrompt,
  renderComposerBrief,
} from "../src/sound/musicAdapters.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const CANOPY_KEY = "EXT_SELVAJE_RESORT_CANOPY_LOOKOUT_POINT";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

async function main() {
  console.log("=== Scene 7 near-musical exception verification ===\n");
  const bible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  const pack = await getMusicPromptPack(SELVAJE_PROJECT, EP01_ID);
  assert(pack, "Music pack present");
  if (!pack) return;

  // --- Location signature ---
  const slot = bible.locationSignatures[CANOPY_KEY];
  assert(slot, "Canopy location signature present");
  assert(slot.musicProhibited === true, "Canopy musicProhibited remains true (general rule)");
  const exs = slot.musicExceptions ?? [];
  assert(exs.length === 1, "Canopy has exactly one music exception");
  assert(exs[0]?.sceneOrds.includes(7), "Exception covers Scene 7 (matched by ord)");
  const exText = (exs[0]?.condition + " " + exs[0]?.permittedTexture + " " + (exs[0]?.rules ?? []).join(" ")).toLowerCase();
  assert(exText.includes("dusk"), "Exception condition is dusk-bound");
  assert(exText.includes("no melody") && exText.includes("no vibrato") && exText.includes("no swell"),
    "Exception encodes no-melody / no-vibrato / no-swell rules");
  assert(exText.includes("not follow") || exText.includes("not carried") || exText.includes("no carry"),
    "Exception encodes 'does not follow into the next scene'");

  // The generator resolver must find it by ord.
  assert(resolveSceneMusicException(bible, 7) !== null, "Generator resolver finds the Scene 7 exception");
  assert(resolveSceneMusicException(bible, 10) === null, "Generator resolver finds NO exception for Scene 10");

  // --- Scene 7 sound row ---
  const s7 = bible.scenes["7"];
  assert(s7, "Scene 7 sound row present");
  assert(s7.nonDiegeticMusic.trim().toLowerCase() !== "no score", "Scene 7 nonDiegeticMusic no longer 'no score'");
  assert(/near-musical|harmonic wash|woodwind breath/i.test(s7.nonDiegeticMusic),
    "Scene 7 nonDiegeticMusic describes the permitted near-musical texture");
  assert(/[.!?"”’)\]]$/.test(s7.nonDiegeticMusic.trim()), "Scene 7 nonDiegeticMusic ends with terminal punctuation (no truncation)");
  assert(!/\bno music\b/i.test(s7.aiVideoPromptAudioNotes ?? ""), "Scene 7 audio note no longer says 'No music'");
  assert(/[.!?"”’)\]]$/.test((s7.aiVideoPromptAudioNotes ?? "").trim()), "Scene 7 audio note ends with terminal punctuation");

  // --- Music Pack: Scene 7 entry ---
  const p7 = pack.scenePrompts["7"];
  assert(p7, "Pack scenePrompts['7'] present");
  assert(p7.noMusic === false, "Scene 7 pack entry noMusic === false");
  const d7 = p7.description.toLowerCase();
  assert(d7.includes("dusk"), "Scene 7 prompt is dusk-bound");
  assert(d7.includes("sparse") && d7.includes("harmonic wash"), "Scene 7 prompt includes the sparse harmonic-wash texture rule");
  assert(d7.includes("no melody") && d7.includes("no vibrato") && d7.includes("no swell"),
    "Scene 7 prompt includes no-melody / no-vibrato / no-swell");
  assert(d7.includes("duration of that light"), "Scene 7 prompt bounds the cue to the duration of the dusk light");
  assert(d7.includes("not follow") || d7.includes("no carry"), "Scene 7 prompt forbids carrying into the next scene");
  assert(p7.isInstrumental === true && p7.includesVocals === false, "Scene 7 prompt remains instrumental, no vocals");

  // --- Scene 10 untouched ---
  const p10 = pack.scenePrompts["10"];
  assert(p10, "Pack scenePrompts['10'] present");
  assert(p10.noMusic === true, "Scene 10 pack entry remains noMusic === true");

  // --- Coverage 20/20 ---
  assert(Object.keys(pack.scenePrompts).length === 20, "Music pack still covers 20/20 scenes");

  // --- Adapter views derive correctly from the fixed entry ---
  console.log("\n--- Adapter render for scene:7 ---");
  for (const [name, text] of [
    ["suno", renderSunoPrompt(p7)],
    ["udio", renderUdioPrompt(p7)],
    ["composer_brief", renderComposerBrief(p7)],
  ] as const) {
    console.log(`\n[${name}]\n${text}`);
    assert(!/no music|no cue|silence only/i.test(text), `${name} adapter renders the cue (not a 'no music' record)`);
    assert(/dusk|harmonic|woodwind|wash/i.test(text), `${name} adapter surfaces the near-musical texture`);
  }

  console.log("\nAll Scene 7 exception assertions PASSED.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
