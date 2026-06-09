// Sound Bible exporters — markdown + JSON.

import type { SoundBible } from "./types.js";

export function exportSoundBibleMarkdown(bible: SoundBible, episodeLabel: string): string {
  const lines: string[] = [];
  const approval = bible.approvedAt ? ` · APPROVED ${bible.approvedAt}` : " · DRAFT";
  lines.push(`# Sound / Music / Atmosphere Bible — ${episodeLabel}${approval}`);
  lines.push("");
  lines.push(`*Version ${bible.version} · Updated ${bible.updatedAt}*`);
  if (bible.sourceDraftNumber) {
    lines.push(
      `*Source: Draft ${bible.sourceDraftNumber}${bible.sourceWasLocked ? " (locked)" : ""}*`
    );
  }
  lines.push("");
  lines.push("---");

  // §1
  lines.push("## 1. Episode Sound Identity");
  lines.push(
    bible.episodeSoundIdentity.sectionApprovedAt
      ? `*Approved ${bible.episodeSoundIdentity.sectionApprovedAt}*`
      : "*Draft — not yet approved*"
  );
  lines.push("");
  lines.push("**Sonic philosophy.** " + (bible.episodeSoundIdentity.sonicPhilosophy || "_pending_"));
  pushList(lines, "Silence rules", bible.episodeSoundIdentity.silenceRules);
  pushList(lines, "Music restraint rules", bible.episodeSoundIdentity.musicRestraintRules);
  pushList(lines, "Atmosphere palette", bible.episodeSoundIdentity.atmospherePalette);
  pushList(lines, "Recurring motifs", bible.episodeSoundIdentity.recurringMotifIds);
  lines.push("");
  lines.push("**Emotional use of sound.** " + (bible.episodeSoundIdentity.emotionalUseOfSound || "_pending_"));
  pushList(lines, "Forbidden sound clichés", bible.episodeSoundIdentity.forbiddenSoundCliches);
  lines.push("");

  // §6 — present before §2 because score philosophy frames per-scene reads
  lines.push("## 2. Music Guidance");
  lines.push(
    bible.musicGuidance.sectionApprovedAt
      ? `*Approved ${bible.musicGuidance.sectionApprovedAt}*`
      : "*Draft — not yet approved*"
  );
  lines.push("");
  lines.push("**Score philosophy.** " + (bible.musicGuidance.scorePhilosophy || "_pending_"));
  pushList(lines, "Forbidden music moments", bible.musicGuidance.forbiddenMusicMoments);
  pushList(lines, "Permitted tonal underscore moments", bible.musicGuidance.permittedTonalUnderscoreMoments);
  lines.push("**Trailer music direction.** " + (bible.musicGuidance.trailerMusicDirection || "_pending_"));
  lines.push("**Reference style language** (descriptive only — no copyrighted titles). " +
    (bible.musicGuidance.referenceStyleLanguage || "_pending_"));
  pushList(lines, "Emotional restraint rules", bible.musicGuidance.emotionalRestraintRules);
  lines.push("");

  // §3
  lines.push("## 3. Motifs");
  if (bible.motifs.length === 0) {
    lines.push("_(none yet)_");
  } else {
    for (const m of bible.motifs) {
      lines.push(`### ${m.label} (\`${m.id}\`)`);
      lines.push(m.description || "_no description_");
      lines.push(
        `*Introduced at scene ${m.introducedAtSceneOrd ?? "?"} · Recurs at scenes ${m.recurringAtSceneOrds.join(", ") || "—"}*`
      );
      lines.push("**Emotional function.** " + (m.emotionalFunction || "_pending_"));
      if (m.rules.length > 0) {
        lines.push("Rules:");
        for (const r of m.rules) lines.push(`- ${r}`);
      }
      lines.push("");
    }
  }

  // §4
  lines.push("## 4. Character Sound Signatures");
  const charKeys = Object.keys(bible.characterSignatures);
  if (charKeys.length === 0) {
    lines.push("_(none yet)_");
  } else {
    for (const name of charKeys) {
      const s = bible.characterSignatures[name];
      lines.push(`### ${s.characterName}`);
      lines.push(
        s.sectionApprovedAt ? `*Approved ${s.sectionApprovedAt}*` : "*Draft*"
      );
      pushList(lines, "Associated sounds", s.associatedSounds);
      lines.push("**Silence pattern.** " + (s.silencePattern || "_pending_"));
      pushList(lines, "Object sounds", s.objectSounds);
      lines.push("**Sound disappearance.** " + (s.soundDisappearance || "_pending_"));
      pushList(lines, "Avoidance signals", s.avoidanceSignals);
      lines.push("");
    }
  }

  // §5
  lines.push("## 5. Location Sound Signatures");
  const locKeys = Object.keys(bible.locationSignatures);
  if (locKeys.length === 0) {
    lines.push("_(none yet)_");
  } else {
    for (const k of locKeys) {
      const s = bible.locationSignatures[k];
      lines.push(`### ${s.locationName} (\`${s.locationKey}\`)`);
      lines.push(s.sectionApprovedAt ? `*Approved ${s.sectionApprovedAt}*` : "*Draft*");
      lines.push("**Ambient bed.** " + (s.ambientBed || "_pending_"));
      pushList(lines, "Key diegetic present", s.keyDiegeticPresent);
      lines.push(`**Music prohibited.** ${s.musicProhibited ? "Yes" : "No"}`);
      pushList(lines, "Anchored motifs", s.anchoredMotifIds);
      if (s.notes) lines.push("*" + s.notes + "*");
      lines.push("");
    }
  }

  // §2 — per-scene last (longest section)
  lines.push("## 6. Per-Scene Breakdown");
  const ords = Object.keys(bible.scenes)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);
  if (ords.length === 0) {
    lines.push("_(no scenes yet)_");
  } else {
    for (const ord of ords) {
      const s = bible.scenes[String(ord)];
      lines.push(`### Scene ${ord} — ${s.sceneHeading}`);
      lines.push(
        s.approvedAt
          ? `*Approved ${s.approvedAt} · composer reads this row*`
          : "*Draft — composer does NOT read this row*"
      );
      lines.push("- Ambient bed: " + (s.ambientBed || "_—_"));
      lines.push("- Key diegetic: " + (s.keyDiegetic.join(", ") || "_—_"));
      lines.push("- Non-diegetic music: " + (s.nonDiegeticMusic || "_—_"));
      if (s.silenceNotes) lines.push("- Silence notes: " + s.silenceNotes);
      if (s.motifIds.length > 0) lines.push("- Motifs: " + s.motifIds.join(", "));
      if (Object.keys(s.characterSounds).length > 0) {
        lines.push("- Character sounds:");
        for (const [name, sound] of Object.entries(s.characterSounds)) {
          lines.push(`  - ${name}: ${sound}`);
        }
      }
      if (s.transitionSound) lines.push("- Transition: " + s.transitionSound);
      if (s.aiVideoPromptAudioNotes) {
        lines.push("- AI-video audio notes: " + s.aiVideoPromptAudioNotes);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function exportSoundBibleJSON(bible: SoundBible): string {
  return JSON.stringify(bible, null, 2);
}

function pushList(lines: string[], label: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push(`**${label}.**`);
  for (const item of items) lines.push(`- ${item}`);
}
