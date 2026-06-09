// Composer directive builder.
//
// The Sound Bible lives in projects.metadata.soundBibles[episodeId].
// The AI Video Prompts composer reads ONLY APPROVED rows. The contract:
//
//   • A scene row is "live" when scenes[ord].approvedAt !== null. Only
//     live rows produce a per-shot directive.
//   • episodeSoundIdentity.sectionApprovedAt !== null gates the
//     episode-wide preamble (injected on the first shot of the episode
//     only — so prompts don't bloat).
//   • If neither is approved, this builder returns empty strings and
//     the composer's existing prompts are unchanged (zero-regression
//     contract).
//
// This file does no LLM calls and no DB writes. Pure read + format.

import type { SoundBible, SoundSceneBreakdown } from "./types.js";

export interface SoundDirectiveResult {
  /** Block to append to the system prompt for THIS shot. Empty when the
   *  scene row isn't approved or the bible doesn't cover this ord. */
  shotBlock: string;
  /** Block to append once at the start of the episode (e.g. on shot 0 of
   *  scene ord 1). Empty when episodeSoundIdentity isn't approved. */
  episodePreamble: string;
  /** Veo-style audio field: a short observational line. Empty when the
   *  scene row isn't approved or has no audio notes. */
  audioField: string;
  /** Diagnostic for the UI: was a directive returned, and why/why not. */
  status: "no_bible" | "scene_unapproved" | "missing_scene" | "ok";
}

/** Build the per-shot sound directive. Pure function — gate on approval. */
export function buildSoundDirective(args: {
  bible: SoundBible | null;
  sceneOrd: number;
  isFirstShotOfEpisode: boolean;
}): SoundDirectiveResult {
  const { bible, sceneOrd, isFirstShotOfEpisode } = args;
  if (!bible) {
    return { shotBlock: "", episodePreamble: "", audioField: "", status: "no_bible" };
  }
  const sceneRow = bible.scenes[String(sceneOrd)] as SoundSceneBreakdown | undefined;
  if (!sceneRow) {
    return { shotBlock: "", episodePreamble: "", audioField: "", status: "missing_scene" };
  }
  if (sceneRow.approvedAt == null) {
    return { shotBlock: "", episodePreamble: "", audioField: "", status: "scene_unapproved" };
  }

  const shotLines: string[] = [];
  shotLines.push("[SOUND DESIGN — APPROVED CANON, OBEY VERBATIM]");
  if (sceneRow.ambientBed) shotLines.push(`Ambient bed: ${sceneRow.ambientBed}.`);
  if (sceneRow.keyDiegetic.length > 0) {
    shotLines.push(`Key diegetic: ${sceneRow.keyDiegetic.join("; ")}.`);
  }
  if (sceneRow.nonDiegeticMusic) {
    shotLines.push(`Music: ${sceneRow.nonDiegeticMusic}.`);
  }
  if (sceneRow.silenceNotes) shotLines.push(`Silence: ${sceneRow.silenceNotes}.`);
  if (Object.keys(sceneRow.characterSounds).length > 0) {
    const sigs = Object.entries(sceneRow.characterSounds)
      .map(([name, sound]) => `${name}: ${sound}`)
      .join("; ");
    shotLines.push(`Character sounds: ${sigs}.`);
  }
  if (sceneRow.transitionSound) shotLines.push(`Transition: ${sceneRow.transitionSound}.`);
  // Location sound signature (if approved AND if the scene has a location key)
  if (sceneRow.locationKey) {
    const locSig = bible.locationSignatures[sceneRow.locationKey];
    if (locSig && locSig.sectionApprovedAt) {
      if (locSig.musicProhibited) {
        shotLines.push("Score is prohibited in this location.");
      }
    }
  }
  const shotBlock = shotLines.join("\n");

  let episodePreamble = "";
  if (isFirstShotOfEpisode && bible.episodeSoundIdentity.sectionApprovedAt) {
    const id = bible.episodeSoundIdentity;
    if (id.sonicPhilosophy) {
      episodePreamble = `[EPISODE SONIC IDENTITY — APPROVED]\n${id.sonicPhilosophy}`;
    }
  }

  const audioField = (sceneRow.aiVideoPromptAudioNotes ?? "").trim();

  return {
    shotBlock,
    episodePreamble,
    audioField,
    status: "ok",
  };
}
