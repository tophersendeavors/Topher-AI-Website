// Surgical canon-conflict fix for SELVAJE EP01, Scene 7 (Canopy Lookout
// Point, dusk).
//
// The conflict:
//   Episode Sound Identity musicRestraintRules[2] and Music Guidance
//   permittedTonalUnderscoreMoments[2] BOTH name Scene 7 as the episode's
//   single permitted near-musical moment. But:
//     • the Canopy Lookout location signature said musicProhibited: true
//       with no exception,
//     • the Scene 7 sound row said nonDiegeticMusic "no score" and an
//       aiVideoPromptAudioNotes line reading "No music.",
//     • the derived Music Pack scenePrompts["7"] said noMusic: true,
//       "Canon explicitly forbids music in this scene."
//   All three contradict the authority.
//
// This script, deterministically (no LLM):
//   1. Adds an approved, scene-scoped musicException to the Canopy
//      location signature (musicProhibited stays true — the exception is
//      the only carve-out) and appends the exception to its notes.
//   2. Rewrites Scene 7's nonDiegeticMusic + aiVideoPromptAudioNotes so
//      they describe the permitted near-musical texture instead of "no
//      music" (preserving every other Scene 7 field, including approval).
//   3. Regenerates ONLY the Music Pack scenePrompts["7"] entry as the
//      permitted near-musical cue (noMusic: false). Every other pack
//      entry, the episode soundtrack, trailer and motif fragments are
//      preserved byte-for-byte. Whole-pack approval is cleared because
//      the content changed and must be re-approved.
//
// Refuses to run unless Draft 5 is byte-identical/locked/20-scene, the
// Canopy slot is musicProhibited with no existing exception, Scene 7's
// row is the known-wrong "no score", and the pack entry is noMusic:true.
// Every merge invariant is asserted before the single write, and Draft 5
// is re-snapshotted afterward.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { getSoundBible, getMusicPromptPack, putSoundBible } from "../src/sound/store.js";
import { containsCopyrightedReference } from "../src/sound/validator.js";
import type {
  LocationMusicException,
  LocationSoundSignature,
  SoundBible,
  SoundSceneBreakdown,
} from "../src/sound/types.js";
import type { MusicPrompt, MusicPromptPack } from "../src/sound/musicTypes.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const CANOPY_KEY = "EXT_SELVAJE_RESORT_CANOPY_LOOKOUT_POINT";
const SCENE7_ORD = "7";
const DRAFT_5_SCRIPT_ID = "f197cbed-5c81-4301-a283-d05a2657277b";
const EXPECTED_FOUNTAIN_LEN = 37245;

type BibleWithMusic = SoundBible & { musicPack?: MusicPromptPack };

function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function loadDraft5Snapshot() {
  const { data: script } = await supabase
    .from("scripts")
    .select("id, fountain, draft_number, current, metadata")
    .eq("id", DRAFT_5_SCRIPT_ID)
    .single();
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, status, fountain, last_pass")
    .eq("script_id", DRAFT_5_SCRIPT_ID)
    .order("ord", { ascending: true });
  const fountain = (script?.fountain as string) ?? "";
  const sceneRows = scenes ?? [];
  return {
    scriptId: script?.id as string,
    draftNumber: script?.draft_number as number,
    metadata: ((script?.metadata as Record<string, unknown> | null) ?? {}),
    fountainHash: djb2Hex(fountain),
    fountainLen: fountain.length,
    scenesHash: djb2Hex(JSON.stringify(sceneRows)),
    sceneCount: sceneRows.length,
  };
}

// ---------------------------------------------------------------------------
// The approved exception + derived copy (verbatim from the canon authority)
// ---------------------------------------------------------------------------

const SCENE7_EXCEPTION: LocationMusicException = {
  sceneOrds: [7],
  condition:
    "Dusk only — entering only after the visual has held the orange dusk light for several seconds, and sounding only for the duration of that light.",
  permittedTexture:
    "A very slow, very sparse harmonic wash — low strings or a single sustained woodwind breath tone with no defined pitch center — blended into the ambient insect layer until indistinguishable from the environment, then gone.",
  rules: [
    "No melody.",
    "No vibrato.",
    "No swell.",
    "Enters only after the orange dusk light has held for several seconds.",
    "Sounds only for the duration of that light.",
    "Does not follow the characters into the next scene — no carry across the cut into Scene 8.",
    "Indistinguishable from the ambient insect layer until it disappears.",
  ],
};

const NOTES_EXCEPTION_CLAUSE =
  " EXCEPTION (Scene 7, dusk): this is the episode's single permitted near-musical moment — a sparse harmonic wash of low strings or a woodwind breath tone, no melody, no vibrato, no swell, present only while the orange dusk light holds and never carried into the next scene.";

const SCENE7_NON_DIEGETIC_MUSIC =
  "Near-musical exception (the episode's single permitted moment): a very slow, very sparse harmonic wash — low strings or a single sustained woodwind breath tone with no defined pitch center — entering only after the orange dusk light has held for several seconds, sounding only for the duration of that light, blended into the ambient insect layer until indistinguishable from it. No melody, no vibrato, no swell. It does not follow the characters into the next scene.";

const SCENE7_AUDIO_NOTE =
  "Open-air elevated platform, full jungle ambient at canopy height. A single permitted near-musical texture, only while the orange dusk light holds: a sparse, slow harmonic wash of low strings or a woodwind breath tone, no melody, no swell, sitting so low it is nearly indistinguishable from the insect layer, and gone before the cut. Wind interference on open microphones. Footsteps on hollow wooden decking. Margot's voice delivered into open space — no room reverb, slightly absorbed. The acoustic space is wide and indifferent. Dusk transition state in the insect layer.";

const SCENE7_MUSIC_PROMPT: MusicPrompt = {
  intent:
    "The episode's single permitted near-musical moment — a constrained dusk-only harmonic wash that registers the orange light, then dissolves back into the jungle.",
  mood: ["suspended", "ambivalent", "dissolving", "withheld"],
  tempoRange: null,
  instrumentation: [
    "low strings — slow bow, detuned, no vibrato",
    "single sustained woodwind breath tone — no defined pitch center",
  ],
  texture: [
    "very sparse harmonic wash",
    "no melody",
    "no vibrato",
    "no swell",
    "blended into the ambient insect layer until indistinguishable, then gone",
  ],
  intensity: "near-silent — felt at the edge of the ambient bed, never above the insect/room level",
  durationTargetSec: null,
  loopability: "one-shot",
  noMusic: false,
  isInstrumental: true,
  includesVocals: false,
  description:
    "A very slow, very sparse harmonic wash — low strings or a single sustained woodwind breath tone with no defined pitch center — entering ONLY after the visual has held the orange dusk light for several seconds, and sounding ONLY for the duration of that light. No melody, no vibrato, no swell. It blends into the dense dusk insect layer until it is indistinguishable from the environment, then disappears. It does NOT follow the characters into the next scene — there is no carry across the cut into Scene 8; the ambient jungle layer alone bridges the transition.",
  derivedFrom: { kind: "scene_row", ref: 7 },
  approvedAt: null,
  approvedBy: null,
};

function jsonExceptKeys<T extends Record<string, unknown>>(o: T, drop: string[]): string {
  const clone: Record<string, unknown> = { ...o };
  for (const k of drop) delete clone[k];
  return JSON.stringify(clone);
}

async function main() {
  console.log("=== SELVAJE EP01 — Scene 7 near-musical canon-conflict repair ===\n");

  // 1. Draft 5 guards.
  const before = await loadDraft5Snapshot();
  console.log("Draft 5 (BEFORE):");
  console.log(`  scriptId:     ${before.scriptId}`);
  console.log(`  draft_number: ${before.draftNumber}`);
  console.log(`  fountainLen:  ${before.fountainLen}`);
  console.log(`  fountainHash: ${before.fountainHash}`);
  console.log(`  sceneCount:   ${before.sceneCount}`);
  console.log(`  scenesHash:   ${before.scenesHash}`);
  console.log(`  locked:       ${before.metadata.lockedWritingDraft === true}`);
  if (before.scriptId !== DRAFT_5_SCRIPT_ID) throw new Error("Draft 5 script id mismatch.");
  if (before.fountainLen !== EXPECTED_FOUNTAIN_LEN)
    throw new Error(`Draft 5 fountain length ${before.fountainLen} != ${EXPECTED_FOUNTAIN_LEN}.`);
  if (before.sceneCount !== 20) throw new Error(`Draft 5 has ${before.sceneCount} scenes; expected 20.`);
  if (before.metadata.lockedWritingDraft !== true) throw new Error("Draft 5 is not locked.");

  // 2. Load bible + pack, assert preconditions.
  const prior = (await getSoundBible(SELVAJE_PROJECT, EP01_ID)) as BibleWithMusic;
  const priorPack = await getMusicPromptPack(SELVAJE_PROJECT, EP01_ID);
  if (!priorPack) throw new Error("No music pack present — generate it first.");

  const slot = prior.locationSignatures[CANOPY_KEY];
  if (!slot) throw new Error(`Canopy location slot ${CANOPY_KEY} missing.`);
  if (slot.musicProhibited !== true) throw new Error("Canopy slot is not musicProhibited — unexpected state.");
  if ((slot.musicExceptions ?? []).length > 0)
    throw new Error("Canopy slot already has musicExceptions — refusing to double-apply.");
  if (!slot.ambientBed.trim()) throw new Error("Canopy slot ambientBed empty — repair location signature first.");

  const s7 = prior.scenes[SCENE7_ORD];
  if (!s7) throw new Error("Scene 7 sound row missing.");
  if (s7.nonDiegeticMusic.trim().toLowerCase() !== "no score")
    throw new Error(`Scene 7 nonDiegeticMusic is not the known-wrong "no score": "${s7.nonDiegeticMusic}"`);

  const p7 = priorPack.scenePrompts[SCENE7_ORD];
  if (!p7) throw new Error("Music pack has no scenePrompts['7'].");
  if (p7.noMusic !== true) throw new Error("Music pack scenePrompts['7'].noMusic is already not true — unexpected.");
  if (containsCopyrightedReference(SCENE7_MUSIC_PROMPT.description))
    throw new Error("Authored Scene 7 description tripped the copyright validator. Aborting.");

  console.log("\nPreconditions hold:");
  console.log(`  Canopy musicProhibited=${slot.musicProhibited}, musicExceptions=${(slot.musicExceptions ?? []).length}`);
  console.log(`  Scene 7 nonDiegeticMusic="${s7.nonDiegeticMusic}", approvedAt=${s7.approvedAt}`);
  console.log(`  Pack scenePrompts['7'].noMusic=${p7.noMusic}`);

  // 3. Build the three deterministic edits.
  const newSlot: LocationSoundSignature = {
    ...slot,
    musicExceptions: [SCENE7_EXCEPTION],
    notes: (slot.notes.trim().replace(/[.\s]*$/, ".") + NOTES_EXCEPTION_CLAUSE).trim(),
    // musicProhibited stays true; the exception is the only carve-out.
  };

  const newScene7: SoundSceneBreakdown = {
    ...s7,
    nonDiegeticMusic: SCENE7_NON_DIEGETIC_MUSIC,
    aiVideoPromptAudioNotes: SCENE7_AUDIO_NOTE,
    // approvedAt/approvedBy preserved — this is an in-canon continuity
    // correction of an already-approved row, not a re-approval.
  };

  const newPack: MusicPromptPack = {
    ...priorPack,
    version: priorPack.version + 1,
    updatedAt: new Date().toISOString(),
    // Content changed: the whole-pack approval no longer holds. The new
    // Scene 7 entry is itself a fresh draft (approvedAt: null).
    approvedAt: null,
    approvedBy: null,
    scenePrompts: { ...priorPack.scenePrompts, [SCENE7_ORD]: SCENE7_MUSIC_PROMPT },
  };

  // 4. Compose the merged carrier.
  const merged: BibleWithMusic = {
    ...prior,
    locationSignatures: { ...prior.locationSignatures, [CANOPY_KEY]: newSlot },
    scenes: { ...prior.scenes, [SCENE7_ORD]: newScene7 },
    musicPack: newPack,
  };

  // 5. Merge invariants — only the intended fields move.
  // 5a. Other location slots byte-equal; Canopy changes only notes + musicExceptions.
  if (
    jsonExceptKeys(prior.locationSignatures as unknown as Record<string, unknown>, [CANOPY_KEY]) !==
    jsonExceptKeys(merged.locationSignatures as unknown as Record<string, unknown>, [CANOPY_KEY])
  )
    throw new Error("Other location signatures would change. Aborting.");
  if (
    jsonExceptKeys(slot as unknown as Record<string, unknown>, ["notes", "musicExceptions"]) !==
    jsonExceptKeys(newSlot as unknown as Record<string, unknown>, ["notes", "musicExceptions"])
  )
    throw new Error("Canopy slot changed a field other than notes/musicExceptions. Aborting.");

  // 5b. Other scene rows byte-equal; Scene 7 changes only the two fields.
  for (const [ord, row] of Object.entries(prior.scenes)) {
    if (ord === SCENE7_ORD) continue;
    if (JSON.stringify(row) !== JSON.stringify(merged.scenes[ord]))
      throw new Error(`Other scene row at ord ${ord} would change. Aborting.`);
  }
  if (
    jsonExceptKeys(s7 as unknown as Record<string, unknown>, ["nonDiegeticMusic", "aiVideoPromptAudioNotes"]) !==
    jsonExceptKeys(newScene7 as unknown as Record<string, unknown>, ["nonDiegeticMusic", "aiVideoPromptAudioNotes"])
  )
    throw new Error("Scene 7 changed a field other than nonDiegeticMusic/aiVideoPromptAudioNotes. Aborting.");

  // 5c. Untouched bible sections byte-equal.
  for (const section of ["episodeSoundIdentity", "motifs", "characterSignatures", "musicGuidance"] as const) {
    if (JSON.stringify(prior[section]) !== JSON.stringify(merged[section]))
      throw new Error(`Section "${section}" would change. Aborting.`);
  }

  // 5d. Music pack: only scenePrompts['7'] changes; soundtrack/trailer/motifs byte-equal.
  for (const [ord, p] of Object.entries(priorPack.scenePrompts)) {
    if (ord === SCENE7_ORD) continue;
    if (JSON.stringify(p) !== JSON.stringify(newPack.scenePrompts[ord]))
      throw new Error(`Other music scenePrompt at ord ${ord} would change. Aborting.`);
  }
  if (JSON.stringify(priorPack.episodeSoundtrack) !== JSON.stringify(newPack.episodeSoundtrack))
    throw new Error("Episode soundtrack would change — not required for this fix. Aborting.");
  if (JSON.stringify(priorPack.trailer) !== JSON.stringify(newPack.trailer))
    throw new Error("Trailer would change. Aborting.");
  if (JSON.stringify(priorPack.motifFragments) !== JSON.stringify(newPack.motifFragments))
    throw new Error("Motif fragments would change. Aborting.");
  if (Object.keys(priorPack.scenePrompts).length !== Object.keys(newPack.scenePrompts).length)
    throw new Error("scenePrompts count changed — coverage drift. Aborting.");

  console.log("\n✓ Merge invariants hold:");
  console.log("    • only Canopy location slot (notes + musicExceptions) changes among locations");
  console.log("    • only Scene 7 (nonDiegeticMusic + aiVideoPromptAudioNotes) changes among scene rows");
  console.log("    • only scenePrompts['7'] changes in the music pack; soundtrack/trailer/motifs intact");

  // 6. Single write.
  const saved = (await putSoundBible(SELVAJE_PROJECT, merged as SoundBible)) as BibleWithMusic;
  console.log(`\n✓ Saved. Bible version: ${saved.version}. Pack version: ${saved.musicPack?.version}.`);

  // 7. Re-snapshot Draft 5.
  const after = await loadDraft5Snapshot();
  if (
    after.fountainHash !== before.fountainHash ||
    after.scenesHash !== before.scenesHash ||
    after.sceneCount !== before.sceneCount
  )
    throw new Error("Draft 5 changed during repair — should be impossible.");
  console.log("\n=== Draft 5 byte-identical after repair: YES ===");
  console.log(`  fountainHash: ${after.fountainHash}`);
  console.log(`  scenesHash:   ${after.scenesHash}`);
  console.log(`  sceneCount:   ${after.sceneCount}`);

  // 8. Echo the result.
  const fs = saved.locationSignatures[CANOPY_KEY];
  const fp = saved.musicPack?.scenePrompts[SCENE7_ORD];
  console.log("\nCanopy slot (AFTER):");
  console.log(`  musicProhibited: ${fs.musicProhibited}`);
  console.log(`  musicExceptions: ${(fs.musicExceptions ?? []).length} (sceneOrds=[${(fs.musicExceptions ?? [])[0]?.sceneOrds.join(", ")}])`);
  console.log("Scene 7 pack entry (AFTER):");
  console.log(`  noMusic: ${fp?.noMusic}`);
  console.log(`  description (head): ${fp?.description.slice(0, 120)}…`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("REPAIR FAILED:", e);
  process.exit(1);
});
