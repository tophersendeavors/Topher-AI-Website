// Surgical fill for the SELVAJE EP01 Sound Bible location signature at
// `EXT. SELVAJE RESORT - CANOPY LOOKOUT POINT` (key
// EXT_SELVAJE_RESORT_CANOPY_LOOKOUT_POINT). The slot exists with an
// empty ambientBed shown as "pending" in the UI. Scene 7 already lives
// at this location with a fully written sound row; this script
// composes a location-level signature from scene 7 + the existing
// SoundBible canon, then writes ONLY that one row.
//
// Refuses to run unless Draft 5 is byte-identical, the target slot is
// still empty, every other slot is left untouched, and every other
// section of the bible is unchanged after save.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { getSoundBible, putSoundBible } from "../src/sound/store.js";
import type {
  LocationSoundSignature,
  SoundBible,
} from "../src/sound/types.js";
import { callLLM, extractJSON } from "../src/llm/provider.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const TARGET_KEY = "EXT_SELVAJE_RESORT_CANOPY_LOOKOUT_POINT";
const TARGET_NAME = "EXT. SELVAJE RESORT - CANOPY LOOKOUT POINT -";
const SCENE7_ORD = "7";
const DRAFT_5_SCRIPT_ID = "f197cbed-5c81-4301-a283-d05a2657277b";
const EXPECTED_FOUNTAIN_LEN = 37245;

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
  return {
    scriptId: script?.id as string,
    draftNumber: script?.draft_number as number,
    isCurrent: script?.current as boolean,
    metadata: ((script?.metadata as Record<string, unknown> | null) ?? {}),
    fountainHash: djb2Hex((script?.fountain as string) ?? ""),
    fountainLen: ((script?.fountain as string) ?? "").length,
    scenesHash: djb2Hex(JSON.stringify(scenes ?? [])),
    sceneCount: (scenes ?? []).length,
  };
}

async function loadScene7Fountain(): Promise<string> {
  const { data } = await supabase
    .from("script_scenes")
    .select("fountain")
    .eq("script_id", DRAFT_5_SCRIPT_ID)
    .eq("ord", 7)
    .single();
  return (data?.fountain as string) ?? "";
}

interface LocationSignatureUpdate {
  ambientBed: string;
  keyDiegeticPresent: string[];
  anchoredMotifIds: string[];
  musicProhibited: boolean;
  notes: string;
}

async function generateCanopyLocationSignature(opts: {
  bible: SoundBible;
  scene7Fountain: string;
}): Promise<LocationSignatureUpdate> {
  const s7 = opts.bible.scenes[SCENE7_ORD];
  if (!s7) throw new Error("Scene 7 sound row missing — cannot use it as source.");

  const motifList = opts.bible.motifs
    .map((m) => `- ${m.id} (${m.label}) — ${m.description}`)
    .join("\n");

  const otherLocSnippets = Object.entries(opts.bible.locationSignatures)
    .filter(([k]) => k !== TARGET_KEY)
    .slice(0, 3)
    .map(
      ([k, v]) =>
        `--- ${k} ---\nambientBed: ${v.ambientBed}\nkeyDiegeticPresent: ${v.keyDiegeticPresent.slice(0, 4).join("; ")}\nnotes: ${v.notes.slice(0, 200)}`
    )
    .join("\n\n");

  const system = [
    "You are the Sound Designer. Build the LOCATION-LEVEL sound signature",
    "for the canopy lookout platform. This is a per-LOCATION row, not a",
    "per-scene row — it must hold across any time of day, not just the",
    "dusk lighting of scene 7. Pull observational sound detail from the",
    "scene 7 row and the screenplay prose, then generalise to the",
    "location's enduring sonic identity.",
    "",
    "DESCRIPTIVE STYLE LANGUAGE ONLY. No composer names, no score titles,",
    'no "in the style of [X]". Observational sound description only.',
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "ambientBed": string,            // 2-4 sentences, location-level',
    '  "keyDiegeticPresent": string[],  // 4-8 entries: enduring sounds heard whenever a scene is here',
    '  "anchoredMotifIds": string[],    // motif IDs from the registry that belong to this location',
    '  "musicProhibited": boolean,      // true only if score MUST never play here',
    '  "notes": string                  // 1-3 sentences: continuity rules for this location',
    "}",
  ].join("\n");

  const user = [
    `LOCATION (display name): ${TARGET_NAME}`,
    `LOCATION KEY: ${TARGET_KEY}`,
    "",
    "EPISODE SOUND IDENTITY (selected):",
    `  sonicPhilosophy: ${opts.bible.episodeSoundIdentity.sonicPhilosophy.slice(0, 600)}`,
    `  emotionalUseOfSound: ${opts.bible.episodeSoundIdentity.emotionalUseOfSound.slice(0, 400)}`,
    `  forbiddenSoundCliches: ${opts.bible.episodeSoundIdentity.forbiddenSoundCliches.join("; ")}`,
    "",
    "REGISTERED MOTIFS (use only these IDs):",
    motifList,
    "",
    "EXISTING LOCATION SIGNATURE STYLE (reference for tone, not content):",
    otherLocSnippets,
    "",
    `SCENE ${SCENE7_ORD} SOUND ROW (primary source — generalise the location-level enduring qualities, do not repeat dusk-specific language):`,
    `  sceneHeading: ${s7.sceneHeading}`,
    `  timeOfDay: ${s7.timeOfDay ?? "?"}`,
    `  ambientBed: ${s7.ambientBed}`,
    `  keyDiegetic: ${s7.keyDiegetic.join(" | ")}`,
    `  motifIds: ${s7.motifIds.join(", ")}`,
    "",
    "SCENE 7 SCREENPLAY PROSE (first 1500 chars):",
    opts.scene7Fountain.slice(0, 1500),
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 1500,
  });
  const parsed = extractJSON<LocationSignatureUpdate>(res.text);

  function stringOf(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
  }
  function stringListOf(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => stringOf(x)).filter((s) => s.length > 0);
  }
  const out: LocationSignatureUpdate = {
    ambientBed: stringOf(parsed.ambientBed),
    keyDiegeticPresent: stringListOf(parsed.keyDiegeticPresent),
    anchoredMotifIds: stringListOf(parsed.anchoredMotifIds).filter((id) =>
      opts.bible.motifs.some((m) => m.id === id)
    ),
    musicProhibited: parsed.musicProhibited === true,
    notes: stringOf(parsed.notes),
  };
  if (!out.ambientBed) {
    throw new Error("LLM returned no ambientBed. Aborting.");
  }
  if (out.keyDiegeticPresent.length === 0) {
    throw new Error("LLM returned no keyDiegeticPresent entries. Aborting.");
  }
  return out;
}

function jsonExceptKey<T extends Record<string, unknown>>(o: T, k: string): string {
  const clone: Record<string, unknown> = { ...o };
  delete clone[k];
  return JSON.stringify(clone);
}

async function main() {
  console.log("=== SELVAJE EP01 Sound Bible — canopy lookout signature repair ===\n");

  // 1. Snapshot Draft 5.
  const before = await loadDraft5Snapshot();
  console.log("Draft 5 (BEFORE):");
  console.log(`  scriptId:        ${before.scriptId}`);
  console.log(`  draft_number:    ${before.draftNumber}`);
  console.log(`  fountainLen:     ${before.fountainLen}`);
  console.log(`  fountainHash:    ${before.fountainHash}`);
  console.log(`  sceneCount:      ${before.sceneCount}`);
  console.log(`  scenesHash:      ${before.scenesHash}`);
  console.log(`  lockedDraft:     ${before.metadata.lockedWritingDraft === true}`);
  if (before.fountainLen !== EXPECTED_FOUNTAIN_LEN) {
    throw new Error(`Draft 5 fountain length ${before.fountainLen} != ${EXPECTED_FOUNTAIN_LEN}.`);
  }
  if (before.sceneCount !== 20) {
    throw new Error(`Draft 5 has ${before.sceneCount} scenes; expected 20.`);
  }
  if (before.metadata.lockedWritingDraft !== true) {
    throw new Error("Draft 5 is not locked.");
  }
  if (before.scriptId !== DRAFT_5_SCRIPT_ID) {
    throw new Error("Draft 5 script id mismatch.");
  }

  // 2. Load the bible and assert preconditions.
  const priorBible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  const slot = priorBible.locationSignatures[TARGET_KEY];
  if (!slot) {
    throw new Error(`Location slot ${TARGET_KEY} not present in bible — refusing to create from thin air.`);
  }
  console.log("\nTarget slot (BEFORE):");
  console.log(`  key:                 ${TARGET_KEY}`);
  console.log(`  locationName:        ${slot.locationName}`);
  console.log(`  ambientBed:          ${slot.ambientBed || "(empty)"}`);
  console.log(`  keyDiegeticPresent:  [${slot.keyDiegeticPresent.join(", ")}]`);
  console.log(`  anchoredMotifIds:    [${slot.anchoredMotifIds.join(", ")}]`);
  console.log(`  sectionApprovedAt:   ${slot.sectionApprovedAt}`);
  if (slot.ambientBed && slot.ambientBed.trim().length > 0) {
    throw new Error("Target slot is already filled. Refusing to overwrite.");
  }
  if (slot.sectionApprovedAt !== null) {
    throw new Error("Target slot is already approved. Refusing to overwrite.");
  }
  if (!priorBible.scenes[SCENE7_ORD]) {
    throw new Error("Scene 7 sound row missing — cannot repair location signature from it.");
  }

  // 3. Pull scene 7 fountain as additional source.
  const scene7Fountain = await loadScene7Fountain();
  if (!scene7Fountain || scene7Fountain.length < 100) {
    throw new Error("Scene 7 fountain is empty — cannot proceed.");
  }
  console.log(`\nScene 7 fountain loaded (${scene7Fountain.length} chars).`);

  // 4. Generate the new signature via one LLM call.
  console.log("\nGenerating location signature via callLLM…");
  const update = await generateCanopyLocationSignature({
    bible: priorBible,
    scene7Fountain,
  });
  console.log("✓ LLM returned:");
  console.log(`  ambientBed (${update.ambientBed.length} chars): ${update.ambientBed.slice(0, 160)}…`);
  console.log(`  keyDiegeticPresent: ${update.keyDiegeticPresent.length} entries`);
  console.log(`  anchoredMotifIds:   [${update.anchoredMotifIds.join(", ")}]`);
  console.log(`  musicProhibited:    ${update.musicProhibited}`);

  // 5. Build the merged signature, preserving the slot's identity fields.
  const newSig: LocationSoundSignature = {
    ...slot,
    ambientBed: update.ambientBed,
    keyDiegeticPresent: update.keyDiegeticPresent,
    anchoredMotifIds: update.anchoredMotifIds,
    musicProhibited: update.musicProhibited,
    notes: update.notes,
    // sectionApprovedAt / sectionApprovedBy untouched — stays null.
  };

  // 6. Compose the merged bible.
  const merged: SoundBible = {
    ...priorBible,
    locationSignatures: {
      ...priorBible.locationSignatures,
      [TARGET_KEY]: newSig,
    },
  };

  // 7. Invariants: only the target slot must change. Everything else byte-equal.
  if (jsonExceptKey(priorBible.locationSignatures as unknown as Record<string, unknown>, TARGET_KEY) !==
      jsonExceptKey(merged.locationSignatures as unknown as Record<string, unknown>, TARGET_KEY)) {
    throw new Error("Other location signatures would change. Aborting before save.");
  }
  if (JSON.stringify(priorBible.scenes) !== JSON.stringify(merged.scenes)) {
    throw new Error("Scene rows would change. Aborting before save.");
  }
  if (JSON.stringify(priorBible.episodeSoundIdentity) !== JSON.stringify(merged.episodeSoundIdentity)) {
    throw new Error("Episode sound identity would change. Aborting before save.");
  }
  if (JSON.stringify(priorBible.musicGuidance) !== JSON.stringify(merged.musicGuidance)) {
    throw new Error("Music guidance would change. Aborting before save.");
  }
  if (JSON.stringify(priorBible.motifs) !== JSON.stringify(merged.motifs)) {
    throw new Error("Motifs would change. Aborting before save.");
  }
  if (JSON.stringify(priorBible.characterSignatures) !== JSON.stringify(merged.characterSignatures)) {
    throw new Error("Character signatures would change. Aborting before save.");
  }
  console.log("\n✓ Merge invariants hold: only target slot changes; all other sections byte-equal.");

  // 8. Persist + re-snapshot Draft 5.
  const saved = await putSoundBible(SELVAJE_PROJECT, merged);
  console.log(`\n✓ Saved. Version: ${saved.version}.`);

  const after = await loadDraft5Snapshot();
  if (
    after.fountainHash !== before.fountainHash ||
    after.scenesHash !== before.scenesHash ||
    after.sceneCount !== before.sceneCount
  ) {
    throw new Error("Draft 5 changed during repair — should be impossible.");
  }
  console.log("\n=== Draft 5 byte-identical after repair: YES ===");
  console.log(`  fountainHash:    ${after.fountainHash}`);
  console.log(`  scenesHash:      ${after.scenesHash}`);
  console.log(`  sceneCount:      ${after.sceneCount}`);

  // 9. Re-verify the slot.
  const finalSlot = saved.locationSignatures[TARGET_KEY];
  console.log("\nTarget slot (AFTER):");
  console.log(`  ambientBed (${finalSlot.ambientBed.length} chars).`);
  console.log(`  keyDiegeticPresent:  ${finalSlot.keyDiegeticPresent.length} entries`);
  console.log(`  anchoredMotifIds:    [${finalSlot.anchoredMotifIds.join(", ")}]`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("REPAIR FAILED:", e);
  process.exit(1);
});
