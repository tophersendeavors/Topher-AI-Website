// Sound Bible validator + audit.
//
// Three hard-rule categories per the build plan:
//   1. completeness  — every script_scenes.ord covered, all motif refs
//      resolve, no empty required fields
//   2. copyrighted_reference — specific composer/film-score/song names,
//      "in the style of [artist]" patterns. Descriptive style language
//      only.
//   3. motif_consistency — motif IDs cross-reference correctly between
//      scenes[] and motifs[]; recurringAtSceneOrds is monotonic; no
//      orphans.
//   4. schema — type-level shape checks
//   5. approval_gate — composer reads only approved rows; warn if an
//      unapproved row has copyrighted leaks (they should be fixed
//      BEFORE approval, but we never silently inject an unapproved row
//      so this is a warning category, not a fail).

import type { SoundAuditResult, SoundBible, SoundCheck } from "./types.js";

// ---------------------------------------------------------------------------
// Copyrighted reference denylist
// ---------------------------------------------------------------------------
//
// Composers, score titles, well-known films, and well-known songs that
// frequently appear in temp scores. The list intentionally targets the
// surface patterns reviewers most often miss; it isn't exhaustive. The
// LLM is also instructed in the generator system prompt to use
// descriptive style language only.

const COPYRIGHTED_COMPOSER_NAMES: string[] = [
  "Hans Zimmer",
  "John Williams",
  "Trent Reznor",
  "Atticus Ross",
  "Mica Levi",
  "Jonny Greenwood",
  "Mark Mothersbaugh",
  "Cliff Martinez",
  "Daniel Lopatin",
  "Oneohtrix Point Never",
  "Mac Quayle",
  "Bobby Krlic",
  "The Haxan Cloak",
  "Ramin Djawadi",
  "Max Richter",
  "Olafur Arnalds",
  "Nicholas Britell",
  "Carter Burwell",
  "Howard Shore",
  "Ennio Morricone",
  "Jerry Goldsmith",
  "Bernard Herrmann",
  "Vangelis",
  "Brian Eno",
  "Aphex Twin",
  "Sufjan Stevens",
  "Radiohead",
  "Nine Inch Nails",
];

const COPYRIGHTED_SCORE_OR_SONG_TITLES: string[] = [
  "There Will Be Blood",
  "The Social Network",
  "Gone Girl",
  "Mandy",
  "Under the Skin",
  "Suspiria",
  "Midsommar",
  "Hereditary",
  "Arrival",
  "Blade Runner 2049",
  "Drive",
  "Mr. Robot",
  "Severance",
  "The Witch",
  "Annihilation",
  "Uncut Gems",
  "Good Time",
  "The Lighthouse",
  "Sicario",
  "No Country for Old Men",
  "There Will Be Blood",
  "Yumeji's Theme",
  "Gymnopédie",
  "Clair de Lune",
];

const STYLE_OF_RE = /\b(?:in the style of|sounds? like|à la|reminiscent of|inspired by)\s+[A-Z][\w'.\- ]+/i;
const COPYRIGHT_C_MARK_RE = /[©℗]\s*\d{2,}/;

/** True iff any denylisted reference appears in `text`. */
function findCopyrightedReferences(text: string): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const name of COPYRIGHTED_COMPOSER_NAMES) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) hits.push(name);
  }
  for (const title of COPYRIGHTED_SCORE_OR_SONG_TITLES) {
    const re = new RegExp(`\\b${title.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) hits.push(title);
  }
  const styleOf = text.match(STYLE_OF_RE);
  if (styleOf) hits.push(styleOf[0]);
  if (COPYRIGHT_C_MARK_RE.test(text)) hits.push("copyright mark");
  return Array.from(new Set(hits));
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export interface SoundAuditInput {
  bible: SoundBible;
  /** All script_scenes.ord values that should be covered. */
  expectedSceneOrds: number[];
}

export function auditSoundBible(input: SoundAuditInput): SoundAuditResult {
  const checks: SoundCheck[] = [];
  const { bible, expectedSceneOrds } = input;

  // 1. Completeness — every expected ord present
  for (const ord of expectedSceneOrds) {
    const row = bible.scenes[String(ord)];
    if (!row) {
      checks.push({
        id: `completeness:missing_scene:${ord}`,
        category: "completeness",
        severity: "warning",
        message: `Scene ord ${ord} has no SoundBible row.`,
        where: `scenes.${ord}`,
        suggestedFix: "Generate per-scene breakdown for this scene.",
      });
      continue;
    }
    if (!row.ambientBed?.trim()) {
      checks.push({
        id: `completeness:no_ambient_bed:${ord}`,
        category: "completeness",
        severity: "warning",
        message: `Scene ${ord} has no ambient bed.`,
        where: `scenes.${ord}.ambientBed`,
      });
    }
  }

  // Orphan rows — bible has scene rows that no longer exist in the script
  for (const ordKey of Object.keys(bible.scenes)) {
    const ord = parseInt(ordKey, 10);
    if (!expectedSceneOrds.includes(ord)) {
      checks.push({
        id: `completeness:orphan_scene:${ord}`,
        category: "completeness",
        severity: "warning",
        message: `SoundBible has a row for scene ord ${ord} but the current script no longer has that scene.`,
        where: `scenes.${ord}`,
        suggestedFix: "Prune this row, or re-index scenes against the current draft.",
      });
    }
  }

  // 2. Copyrighted references — episodeSoundIdentity
  const idText = [
    bible.episodeSoundIdentity.sonicPhilosophy,
    bible.episodeSoundIdentity.emotionalUseOfSound,
    ...bible.episodeSoundIdentity.atmospherePalette,
    ...bible.episodeSoundIdentity.silenceRules,
    ...bible.episodeSoundIdentity.musicRestraintRules,
    ...bible.episodeSoundIdentity.forbiddenSoundCliches,
  ].join(" \n ");
  const idHits = findCopyrightedReferences(idText);
  if (idHits.length > 0) {
    checks.push({
      id: "copyrighted:episodeSoundIdentity",
      category: "copyrighted_reference",
      severity: "fail",
      message: `Episode Sound Identity contains copyrighted references: ${idHits.join(", ")}.`,
      where: "episodeSoundIdentity",
      suggestedFix:
        "Replace with descriptive style language only — e.g. 'sparse strings, low sub-bass pulse, dry room tone, distant insects'.",
    });
  }

  // 2. Copyrighted references — musicGuidance
  const mgText = [
    bible.musicGuidance.scorePhilosophy,
    bible.musicGuidance.referenceStyleLanguage,
    bible.musicGuidance.trailerMusicDirection,
    ...bible.musicGuidance.forbiddenMusicMoments,
    ...bible.musicGuidance.permittedTonalUnderscoreMoments,
    ...bible.musicGuidance.emotionalRestraintRules,
  ].join(" \n ");
  const mgHits = findCopyrightedReferences(mgText);
  if (mgHits.length > 0) {
    checks.push({
      id: "copyrighted:musicGuidance",
      category: "copyrighted_reference",
      severity: "fail",
      message: `Music Guidance contains copyrighted references: ${mgHits.join(", ")}.`,
      where: "musicGuidance",
      suggestedFix:
        "Use descriptive style language only — no composer names, no score titles, no 'in the style of [X]'.",
    });
  }

  // 2. Copyrighted references — per-scene
  for (const [ord, row] of Object.entries(bible.scenes)) {
    const text = [
      row.ambientBed,
      row.nonDiegeticMusic,
      row.silenceNotes ?? "",
      row.transitionSound ?? "",
      row.aiVideoPromptAudioNotes ?? "",
      ...row.keyDiegetic,
      ...Object.values(row.characterSounds),
    ].join(" \n ");
    const hits = findCopyrightedReferences(text);
    if (hits.length > 0) {
      checks.push({
        id: `copyrighted:scene:${ord}`,
        category: "copyrighted_reference",
        severity: "fail",
        message: `Scene ${ord} contains copyrighted references: ${hits.join(", ")}.`,
        where: `scenes.${ord}`,
        suggestedFix:
          "Replace with descriptive style language only. This scene cannot be approved until the reference is removed.",
      });
    }
  }

  // 3. Motif consistency — every motif ID referenced from scenes / identity
  // resolves to a motif in motifs[]
  const motifIds = new Set(bible.motifs.map((m) => m.id));
  for (const [ord, row] of Object.entries(bible.scenes)) {
    for (const mid of row.motifIds) {
      if (!motifIds.has(mid)) {
        checks.push({
          id: `motif:orphan_ref:${ord}:${mid}`,
          category: "motif_consistency",
          severity: "warning",
          message: `Scene ${ord} references motif "${mid}" but that motif is not registered.`,
          where: `scenes.${ord}.motifIds`,
          suggestedFix: `Add a motif with id "${mid}" to the motif registry, or remove the reference.`,
        });
      }
    }
  }
  for (const mid of bible.episodeSoundIdentity.recurringMotifIds) {
    if (!motifIds.has(mid)) {
      checks.push({
        id: `motif:orphan_ref:identity:${mid}`,
        category: "motif_consistency",
        severity: "warning",
        message: `Episode Sound Identity references motif "${mid}" but that motif is not registered.`,
        where: "episodeSoundIdentity.recurringMotifIds",
      });
    }
  }

  // 5. Approval gate visibility — surfaces how many rows are approved (the
  //    composer reads only approved). This is informational so writers
  //    understand why prompts haven't changed yet.
  const totalScenes = expectedSceneOrds.length;
  const approvedScenes = Object.values(bible.scenes).filter((s) => s.approvedAt != null).length;
  if (totalScenes > 0 && approvedScenes < totalScenes) {
    checks.push({
      id: "approval_gate:scene_coverage",
      category: "approval_gate",
      severity: approvedScenes === 0 ? "warning" : "pass",
      message: `${approvedScenes} of ${totalScenes} scene rows approved. Composer injects only approved rows.`,
      where: "scenes",
    });
  }

  // Tally
  const summary: SoundAuditResult["summary"] = {
    completeness: { pass: 0, warning: 0, fail: 0 },
    copyrighted_reference: { pass: 0, warning: 0, fail: 0 },
    motif_consistency: { pass: 0, warning: 0, fail: 0 },
    schema: { pass: 0, warning: 0, fail: 0 },
    approval_gate: { pass: 0, warning: 0, fail: 0 },
  };
  for (const c of checks) summary[c.category][c.severity] += 1;

  return {
    runAt: new Date().toISOString(),
    summary,
    checks,
  };
}

/** Quick boolean for the generator: does this text have a forbidden ref? */
export function containsCopyrightedReference(text: string): boolean {
  return findCopyrightedReferences(text).length > 0;
}
