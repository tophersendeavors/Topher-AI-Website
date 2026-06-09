// Trailer pack exporters — markdown + JSON. Also renders per-beat
// prompt packs (video + image + title + music + editing note) for one
// variant's worth of beats.

import type { TrailerPack, TrailerPlan, TrailerVariantKey } from "./types.js";

function variantLabel(v: TrailerVariantKey): string {
  return v === "teaser15"
    ? "15-second teaser"
    : v === "teaser30"
    ? "30-second teaser"
    : v === "trailer60"
    ? "60-second trailer"
    : "Social cutdown";
}

export function exportTrailerPackMarkdown(pack: TrailerPack, episodeLabel: string): string {
  const lines: string[] = [];
  const approvalTag = pack.approvedAt ? ` · APPROVED ${pack.approvedAt}` : " · DRAFT";
  lines.push(`# Trailer Pack — ${episodeLabel}${approvalTag}`);
  lines.push("");
  lines.push(`*Version ${pack.version} · Updated ${pack.updatedAt}*`);
  if (!pack.derivedFromApprovedShots) {
    lines.push(`*⚠ Using unapproved shot briefs — approve the shot list before production handoff.*`);
  }
  if (!pack.derivedFromApprovedMusic) {
    lines.push(`*⚠ Sound Bible music guidance was not approved at generation time.*`);
  }
  lines.push("");
  lines.push("---");
  for (const variant of ["teaser15", "teaser30", "trailer60", "social"] as TrailerVariantKey[]) {
    const plan = pack.variants[variant];
    if (!plan) continue;
    lines.push("");
    lines.push(
      `## ${variantLabel(variant)} (${plan.durationSec}s)${plan.approvedAt ? " · APPROVED" : " · draft"}`
    );
    lines.push(renderPlanMarkdown(plan));
  }
  return lines.join("\n");
}

export function exportTrailerPackJSON(pack: TrailerPack): string {
  return JSON.stringify(pack, null, 2);
}

export function exportTrailerVariantMarkdown(plan: TrailerPlan): string {
  return renderPlanMarkdown(plan);
}

export function exportTrailerVariantVideoPrompts(plan: TrailerPlan): string {
  const lines: string[] = [];
  for (const beat of plan.beats) {
    lines.push(`# Beat ${beat.index} · ${beat.durationSec}s`);
    if (beat.sourceSceneOrd != null && beat.sourceShotIndex != null) {
      lines.push(
        `*Source: Scene ${beat.sourceSceneOrd} · Shot ${beat.sourceShotIndex}${beat.sourceApprovedAt ? " (approved)" : " (UNAPPROVED)"}*`
      );
    }
    lines.push("");
    lines.push(beat.videoPrompt || "(no video prompt)");
    if (beat.imagePrompt) {
      lines.push("");
      lines.push(`Image prompt: ${beat.imagePrompt}`);
    }
    if (beat.textOverlay) {
      lines.push(`Title-card overlay: "${beat.textOverlay}"`);
    }
    lines.push(`Music cue: ${beat.musicFragment}`);
    lines.push(`Editing note: ${beat.editingNote}`);
    if (!beat.isWithheldSafe) {
      lines.push(`⚠ This beat may reveal a withheld item — review before approval.`);
    }
    lines.push("");
    lines.push("---");
  }
  return lines.join("\n");
}

export function exportTrailerVariantMusicPrompt(plan: TrailerPlan): string {
  const lines: string[] = [];
  lines.push(`# Music brief — ${variantLabel(plan.variantKey)} (${plan.durationSec}s)`);
  lines.push("");
  lines.push(plan.musicGuidance);
  lines.push("");
  lines.push("## Per-beat music fragments");
  for (const beat of plan.beats) {
    lines.push(`- Beat ${beat.index} (${beat.durationSec}s): ${beat.musicFragment}`);
  }
  return lines.join("\n");
}

function renderPlanMarkdown(plan: TrailerPlan): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("### Structure");
  lines.push(`- **Opening image.** ${plan.structure.openingImage}`);
  lines.push(`- **Escalation.** ${plan.structure.escalation}`);
  lines.push(`- **Reveal-withheld.** ${plan.structure.revealWithheld}`);
  lines.push(`- **Final hook.** ${plan.structure.finalHook}`);
  lines.push("");
  if (plan.whatNotToReveal.length > 0) {
    lines.push("### What NOT to reveal");
    for (const r of plan.whatNotToReveal) lines.push(`- ${r}`);
    lines.push("");
  }
  if (plan.titleCardBeats.length > 0) {
    lines.push("### Title cards");
    for (const tc of plan.titleCardBeats) {
      lines.push(`- (${tc.position}, ${tc.durationSec}s) **"${tc.text}"** — ${tc.imagePrompt}`);
    }
    lines.push("");
  }
  lines.push("### Beats");
  for (const beat of plan.beats) {
    const src =
      beat.sourceSceneOrd != null && beat.sourceShotIndex != null
        ? `Scene ${beat.sourceSceneOrd} · Shot ${beat.sourceShotIndex}${beat.sourceApprovedAt ? "" : " (UNAPPROVED)"}`
        : "(standalone)";
    lines.push(
      `**${beat.index}.** _${beat.durationSec}s_ — ${src}${beat.isWithheldSafe ? "" : " ⚠ reveals withheld"}`
    );
    lines.push(`  - Video: ${beat.videoPrompt}`);
    if (beat.imagePrompt) lines.push(`  - Image: ${beat.imagePrompt}`);
    if (beat.textOverlay) lines.push(`  - Overlay: "${beat.textOverlay}"`);
    lines.push(`  - Music: ${beat.musicFragment}`);
    lines.push(`  - Edit: ${beat.editingNote}`);
  }
  lines.push("");
  if (plan.voDirection) lines.push(`**VO direction.** ${plan.voDirection}`);
  lines.push(`**Ending button.** ${plan.endingButton}`);
  lines.push(`**Ending image.** ${plan.endingImage}`);
  lines.push("");
  lines.push(`### Music guidance`);
  lines.push(plan.musicGuidance);
  return lines.join("\n");
}
