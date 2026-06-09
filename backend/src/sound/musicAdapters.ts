// Tool adapters for the music prompt pack. Each adapter is a pure
// function that renders the canonical MusicPrompt into a text string
// suitable for one tool. Add new adapters without changing the canon.
//
// Suno: short comma-separated style + intent. Suno accepts a long prose
//   field as well; we emit both inside one string so the writer can
//   paste either.
// Udio: similar; we surface tempo + key fields explicitly.
// Composer Brief: human-readable prose for a real human composer.

import { containsCopyrightedReference } from "./validator.js";
import type { MusicMotifFragment, MusicPrompt, TrailerMusicPrompts } from "./musicTypes.js";

/** Last-line safety: every adapter run sanitises the output so no
 *  copyrighted reference can ever leak into a copy-paste. */
function safe(text: string): string {
  if (!containsCopyrightedReference(text)) return text;
  // Replace any forbidden hit with a neutral marker. Validator's own
  // findCopyrightedReferences would be ideal here; we keep it simple:
  // truncate to the first half and append a warning so the writer sees
  // it before pasting.
  return `[COPY BLOCKED — copyrighted reference detected; regenerate with descriptive language only]`;
}

// ---------------------------------------------------------------------------
// Suno
// ---------------------------------------------------------------------------

export function renderSunoPrompt(p: MusicPrompt): string {
  if (p.noMusic) {
    return safe(`[NO MUSIC] ${p.intent}`.trim());
  }
  // Suno style line — comma-joined keywords. Then a prose blurb.
  const styleTokens = [
    p.isInstrumental ? "instrumental" : "",
    ...p.mood,
    p.tempoRange ?? "",
    ...p.instrumentation,
    ...p.texture,
    p.intensity ? `intensity ${p.intensity}` : "",
  ]
    .map((t) => t.trim())
    .filter(Boolean);
  const styleLine = styleTokens.join(", ");
  const blurb = p.description;
  const constraint = p.isInstrumental
    ? "Instrumental only. No vocals."
    : p.includesVocals
    ? "Vocals permitted."
    : "Instrumental only.";
  const duration = p.durationTargetSec ? `~${p.durationTargetSec}s` : "";
  const loop = p.loopability === "loopable" ? "Loopable." : p.loopability === "one-shot" ? "One-shot." : "";
  return safe(
    [styleLine, blurb, constraint, duration, loop].filter(Boolean).join(" — ").trim()
  );
}

export function renderSunoMotif(f: MusicMotifFragment): string {
  if (containsCopyrightedReference(f.prompt)) return safe(f.prompt);
  const style = [
    "instrumental",
    ...f.mood,
    ...f.instrumentation,
    ...f.texture,
  ]
    .filter(Boolean)
    .join(", ");
  return safe(`${style} — ${f.prompt} — Instrumental only.`);
}

// ---------------------------------------------------------------------------
// Udio
// ---------------------------------------------------------------------------

export function renderUdioPrompt(p: MusicPrompt): string {
  if (p.noMusic) {
    return safe(`[NO MUSIC] ${p.intent}`.trim());
  }
  // Udio prefers explicit BPM + key phrasing. We surface them as
  // structured lines, which Udio handles well.
  const lines: string[] = [];
  if (p.tempoRange) lines.push(`Tempo: ${p.tempoRange}`);
  if (p.mood.length) lines.push(`Mood: ${p.mood.join(", ")}`);
  if (p.instrumentation.length)
    lines.push(`Instrumentation: ${p.instrumentation.join(", ")}`);
  if (p.texture.length) lines.push(`Texture: ${p.texture.join(", ")}`);
  if (p.intensity) lines.push(`Intensity: ${p.intensity}`);
  if (p.durationTargetSec) lines.push(`Target duration: ~${p.durationTargetSec}s`);
  if (p.loopability) lines.push(`Form: ${p.loopability}`);
  lines.push(p.isInstrumental ? "Instrumental only. No vocals." : "Vocals permitted.");
  lines.push("");
  lines.push(p.description);
  return safe(lines.join("\n").trim());
}

// ---------------------------------------------------------------------------
// Composer Brief (human-readable for an actual composer / sound designer)
// ---------------------------------------------------------------------------

export function renderComposerBrief(p: MusicPrompt): string {
  if (p.noMusic) {
    return safe(
      `**No music.** ${p.intent}\n\nThe canon explicitly forbids score here. ` +
        `Carry the moment with diegetic sound and silence only.`
    );
  }
  const lines: string[] = [];
  lines.push(`**Intent.** ${p.intent}`);
  if (p.mood.length) lines.push(`**Mood.** ${p.mood.join(", ")}.`);
  if (p.tempoRange) lines.push(`**Tempo.** ${p.tempoRange}.`);
  if (p.instrumentation.length)
    lines.push(`**Instrumentation.** ${p.instrumentation.join(", ")}.`);
  if (p.texture.length) lines.push(`**Texture.** ${p.texture.join(", ")}.`);
  if (p.intensity) lines.push(`**Intensity.** ${p.intensity}.`);
  if (p.durationTargetSec) lines.push(`**Target duration.** ~${p.durationTargetSec}s.`);
  if (p.loopability) lines.push(`**Form.** ${p.loopability}.`);
  lines.push(
    p.isInstrumental
      ? "**Vocals.** None — instrumental only."
      : p.includesVocals
      ? "**Vocals.** Permitted."
      : "**Vocals.** None — instrumental only."
  );
  lines.push("");
  lines.push(p.description);
  if (p.approvedAt) {
    lines.push("");
    lines.push(`*Approved canon — composer may treat this as final brief.*`);
  } else {
    lines.push("");
    lines.push(`*DRAFT — not yet approved. Treat as guidance, not final.*`);
  }
  return safe(lines.join("\n").trim());
}

// ---------------------------------------------------------------------------
// Trailer renderers (variant-specific)
// ---------------------------------------------------------------------------

export function renderTrailerSuno(t: TrailerMusicPrompts, variant: "15" | "30" | "60"): string {
  const p =
    variant === "15" ? t.variant15 : variant === "30" ? t.variant30 : t.variant60;
  const base = renderSunoPrompt(p);
  const build = [
    `[BUILD]`,
    `Start: ${t.buildStructure.start}`,
    `Rise: ${t.buildStructure.rise}`,
    `Break: ${t.buildStructure.break}`,
    `Final hit: ${t.buildStructure.finalHit}`,
  ].join(" / ");
  return safe(`${base}\n${build}`);
}

export function renderTrailerComposerBrief(t: TrailerMusicPrompts): string {
  const lines: string[] = [];
  lines.push(`## Trailer cue — build structure`);
  lines.push(`- **Start.** ${t.buildStructure.start}`);
  lines.push(`- **Rise.** ${t.buildStructure.rise}`);
  lines.push(`- **Break.** ${t.buildStructure.break}`);
  lines.push(`- **Final hit.** ${t.buildStructure.finalHit}`);
  lines.push("");
  lines.push(`### 15-second variant`);
  lines.push(renderComposerBrief(t.variant15));
  lines.push("");
  lines.push(`### 30-second variant`);
  lines.push(renderComposerBrief(t.variant30));
  lines.push("");
  lines.push(`### 60-second variant`);
  lines.push(renderComposerBrief(t.variant60));
  return safe(lines.join("\n"));
}
