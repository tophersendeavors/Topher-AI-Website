// Surgical fill for SELVAJE EP01 Sound Bible scene 9
// aiVideoPromptAudioNotes. The current value is truncated:
//   "Interior casita, night. Heavily"
// All other scene 9 fields (ambientBed, keyDiegetic, silenceNotes,
// characterSounds for Nadia, motif refs) are complete. Reuses them as
// source context for one LLM call, writes ONLY the one field, asserts
// every other section + scene row is byte-equal before save.
//
// Refuses to run unless Draft 5 is byte-identical, scene 9's existing
// row is the expected truncated value, and the merge invariants hold.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { getSoundBible, putSoundBible } from "../src/sound/store.js";
import type { SoundBible } from "../src/sound/types.js";
import { callLLM, extractJSON } from "../src/llm/provider.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const EP01_ID = "5fb38c08-c9a8-48e9-9cb3-17340ddab6df";
const TARGET_ORD = "9";
const DRAFT_5_SCRIPT_ID = "f197cbed-5c81-4301-a283-d05a2657277b";
const EXPECTED_FOUNTAIN_LEN = 37245;
const TRUNCATED_PREFIX = "Interior casita, night. Heavily";

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
    isCurrent: script?.current as boolean,
    metadata: ((script?.metadata as Record<string, unknown> | null) ?? {}),
    fountainHash: djb2Hex(fountain),
    fountainLen: fountain.length,
    scenesHash: djb2Hex(JSON.stringify(sceneRows)),
    sceneCount: sceneRows.length,
  };
}

async function loadScene9Fountain(): Promise<string> {
  const { data } = await supabase
    .from("script_scenes")
    .select("fountain")
    .eq("script_id", DRAFT_5_SCRIPT_ID)
    .eq("ord", 9)
    .single();
  return (data?.fountain as string) ?? "";
}

async function generateAudioNote(opts: {
  bible: SoundBible;
  scene9Fountain: string;
}): Promise<string> {
  const s9 = opts.bible.scenes[TARGET_ORD];
  if (!s9) throw new Error("Scene 9 row missing.");
  const nadia = Object.entries(opts.bible.characterSignatures).find(([k]) =>
    k.toLowerCase().includes("nadia")
  );
  const nadiaSig = nadia ? nadia[1] : null;

  const system = [
    "You are the Sound Designer. Write ONE complete, self-contained,",
    "model-ready audio note for this scene's AI video prompts (Veo audio",
    "field / Kling background sound). It will be appended verbatim to",
    "the video prompt, so it MUST be a finished thought ending in a",
    "period — no truncation, no dangling adverbs, no incomplete clauses.",
    "",
    "Target: 1-3 short sentences (160-380 chars total). Observational",
    "sound description only. DESCRIPTIVE STYLE LANGUAGE ONLY — no",
    "composer names, no score titles, no 'in the style of [X]'.",
    "",
    "Return JSON shaped EXACTLY as:",
    '{ "audioNote": string }',
  ].join("\n");

  const user = [
    `SCENE: ${s9.sceneHeading}`,
    `TIME OF DAY: ${s9.timeOfDay ?? "?"}`,
    "",
    `EXISTING AMBIENT BED (source):`,
    s9.ambientBed,
    "",
    `EXISTING KEY DIEGETIC (source):`,
    ...s9.keyDiegetic.map((k) => `  - ${k}`),
    "",
    `EXISTING SILENCE NOTES (source):`,
    s9.silenceNotes ?? "(none)",
    "",
    `EXISTING CHARACTER SOUNDS (source):`,
    Object.entries(s9.characterSounds)
      .map(([name, line]) => `  ${name}: ${line}`)
      .join("\n"),
    "",
    `MOTIFS IN SCENE: [${s9.motifIds.join(", ")}]`,
    "",
    "NADIA SOUND SIGNATURE (source):",
    nadiaSig
      ? [
          `  silencePattern: ${nadiaSig.silencePattern}`,
          `  associatedSounds: ${nadiaSig.associatedSounds.slice(0, 4).join("; ")}`,
        ].join("\n")
      : "(none)",
    "",
    "SCREENPLAY PROSE (first 1200 chars):",
    opts.scene9Fountain.slice(0, 1200),
    "",
    "Write the audio note now. End with a period. No trailing adverb.",
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 800,
  });
  const parsed = extractJSON<{ audioNote?: string }>(res.text);
  const note = (parsed.audioNote ?? "").trim();
  if (!note) throw new Error("LLM returned empty audioNote.");
  // Enforce terminal punctuation client-side as a belt-and-braces check.
  if (!/[.!?]"?$/.test(note)) {
    throw new Error(`LLM audioNote does not end with terminal punctuation: ${note.slice(-40)}`);
  }
  if (note.length < 80) {
    throw new Error(`LLM audioNote too short (${note.length} chars): ${note}`);
  }
  return note;
}

async function main() {
  console.log("=== SELVAJE EP01 Sound Bible — scene 9 audio note repair ===\n");

  const before = await loadDraft5Snapshot();
  console.log("Draft 5 (BEFORE):");
  console.log(`  scriptId:        ${before.scriptId}`);
  console.log(`  draft_number:    ${before.draftNumber}`);
  console.log(`  fountainLen:     ${before.fountainLen}`);
  console.log(`  fountainHash:    ${before.fountainHash}`);
  console.log(`  sceneCount:      ${before.sceneCount}`);
  console.log(`  scenesHash:      ${before.scenesHash}`);

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

  const priorBible = await getSoundBible(SELVAJE_PROJECT, EP01_ID);
  const s9 = priorBible.scenes[TARGET_ORD];
  if (!s9) throw new Error("Scene 9 row missing — cannot repair.");
  const existing = (s9.aiVideoPromptAudioNotes ?? "").trim();
  console.log(`\nScene 9 aiVideoPromptAudioNotes (BEFORE, ${existing.length} chars):`);
  console.log(`  >>>${existing}<<<`);

  // Preconditions: the field is the known-truncated value (or short
  // dangling-adverb variant). Refuse to overwrite a real value.
  const looksTruncated =
    existing.length < 80 ||
    existing.toLowerCase().endsWith("heavily") ||
    existing === TRUNCATED_PREFIX;
  if (!looksTruncated) {
    throw new Error(
      `Refusing to overwrite — current value does not look truncated. Got: ${existing.slice(0, 200)}`
    );
  }
  if (s9.approvedAt !== null) {
    throw new Error("Scene 9 row is already approved. Refusing to overwrite.");
  }

  const scene9Fountain = await loadScene9Fountain();
  if (!scene9Fountain || scene9Fountain.length < 100) {
    throw new Error("Scene 9 fountain is empty — cannot proceed.");
  }
  console.log(`\nScene 9 fountain loaded (${scene9Fountain.length} chars).`);

  console.log("\nCalling LLM for audio note…");
  const audioNote = await generateAudioNote({ bible: priorBible, scene9Fountain });
  console.log(`✓ LLM returned audio note (${audioNote.length} chars):`);
  console.log(`  ${audioNote}`);

  // Build merged bible — change only scene 9's audio note.
  const newScene9 = { ...s9, aiVideoPromptAudioNotes: audioNote };
  const merged: SoundBible = {
    ...priorBible,
    scenes: { ...priorBible.scenes, [TARGET_ORD]: newScene9 },
  };

  // Invariants: every other scene row, every other section is byte-equal.
  for (const [ord, row] of Object.entries(priorBible.scenes)) {
    if (ord === TARGET_ORD) continue;
    if (JSON.stringify(row) !== JSON.stringify(merged.scenes[ord])) {
      throw new Error(`Other scene row at ord ${ord} would change. Aborting.`);
    }
  }
  // Scene 9 itself: every field except aiVideoPromptAudioNotes must be byte-equal.
  for (const k of Object.keys(s9)) {
    if (k === "aiVideoPromptAudioNotes") continue;
    const a = (s9 as Record<string, unknown>)[k];
    const b = (merged.scenes[TARGET_ORD] as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      throw new Error(`Scene 9 field "${k}" would change. Aborting.`);
    }
  }
  for (const section of [
    "episodeSoundIdentity",
    "motifs",
    "characterSignatures",
    "locationSignatures",
    "musicGuidance",
  ] as const) {
    if (JSON.stringify(priorBible[section]) !== JSON.stringify(merged[section])) {
      throw new Error(`Section "${section}" would change. Aborting.`);
    }
  }
  console.log("\n✓ Merge invariants hold: only scene 9's audio note changes.");

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

  console.log("\nScene 9 aiVideoPromptAudioNotes (AFTER):");
  console.log(`  ${saved.scenes[TARGET_ORD].aiVideoPromptAudioNotes}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("REPAIR FAILED:", e);
  process.exit(1);
});
