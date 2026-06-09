// Brief Router — export formats.

import type {
  AICreativeBrief,
  AIModelBrief,
  AnyBrief,
  EpisodeRoleBriefsResponse,
  LivePersonBrief,
  RoleBriefArtifact,
  ShotRoleBriefs,
} from "@toburt/shared";

export function exportRoleBriefsJson(resp: EpisodeRoleBriefsResponse): string {
  return JSON.stringify(resp, null, 2);
}

export function exportRoleBriefsMarkdown(resp: EpisodeRoleBriefsResponse): string {
  const epLabel =
    resp.episodeNumber !== null
      ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
      : resp.episodeId.slice(0, 6);
  const lines: string[] = [];
  lines.push(`# Role-routed briefs — ${epLabel}${resp.episodeTitle ? ` · ${resp.episodeTitle}` : ""}`);
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");
  if (!resp.hasAssignments) {
    lines.push(
      "_No role assignments exist yet for this project. Visit Creative Team to begin._"
    );
    lines.push("");
  }
  for (const shot of resp.shots) {
    lines.push(`## ${shotHeading(shot)}`);
    if (shot.characters.length > 0) {
      lines.push(`Characters: ${shot.characters.join(", ")}`);
    }
    if (shot.artifacts.length === 0 && shot.skipped.length === 0) {
      lines.push("_No applicable roles for this shot._");
      lines.push("");
      continue;
    }
    for (const artifact of shot.artifacts) {
      lines.push("");
      lines.push(`### ${artifact.roleLabel} · ${prettyKind(artifact.roleKind)}`);
      lines.push("");
      lines.push(renderBrief(artifact.brief));
    }
    if (shot.skipped.length > 0) {
      lines.push("");
      lines.push("#### Roles to assign");
      for (const sk of shot.skipped) {
        lines.push(`- ${sk.roleLabel}: ${sk.reason}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function shotHeading(shot: ShotRoleBriefs): string {
  const sc = `SC${String(shot.sceneOrd).padStart(2, "0")}_SH${String(shot.shotIndex + 1).padStart(2, "0")}`;
  return `${sc} — ${shot.shotDescription}`;
}

function prettyKind(k: RoleBriefArtifact["roleKind"]): string {
  if (k === "ai") return "AI";
  if (k === "ai_creative") return "AI Creative";
  return "Live Person";
}

function renderBrief(brief: AnyBrief): string {
  if (brief.kind === "ai_model") return renderAIModel(brief);
  if (brief.kind === "ai_creative") return renderAICreative(brief);
  return renderLivePerson(brief);
}

function renderAIModel(b: AIModelBrief): string {
  const lines: string[] = [];
  lines.push(`**Model target:** ${b.modelTarget}`);
  lines.push(`**Aspect / duration:** ${b.aspectRatio} · ${b.durationSec}s`);
  lines.push("");
  lines.push("**Prompt**");
  lines.push("```");
  lines.push(b.promptText);
  lines.push("```");
  if (b.characterRefs.length) {
    lines.push("**Character references**");
    for (const r of b.characterRefs) {
      lines.push(`- ${r.label}${r.referenceUrl ? ` — ${r.referenceUrl}` : ""}${r.description ? `\n   ${r.description}` : ""}`);
    }
  }
  if (b.locationRef) {
    lines.push("");
    lines.push(`**Location:** ${b.locationRef.label} — ${b.locationRef.description}`);
  }
  if (b.propRefs.length) {
    lines.push("");
    lines.push("**Prop continuity**");
    for (const r of b.propRefs) lines.push(`- ${r.label}: ${r.description}`);
  }
  if (b.continuityLocks.length) {
    lines.push("");
    lines.push("**Continuity locks**");
    for (const l of b.continuityLocks) lines.push(`- ${l}`);
  }
  if (b.soundNotes) {
    lines.push("");
    lines.push("**Sound**");
    if (b.soundNotes.audioField) lines.push(`- Audio: ${b.soundNotes.audioField}`);
    if (b.soundNotes.ambientBed) lines.push(`- Ambient: ${b.soundNotes.ambientBed}`);
    if (b.soundNotes.nonDiegeticMusic) lines.push(`- Music: ${b.soundNotes.nonDiegeticMusic}`);
  }
  if (b.avoidList.length) {
    lines.push("");
    lines.push(`**Avoid:** ${b.avoidList.join(", ")}`);
  }
  if (b.adapterHints.length) {
    lines.push("");
    lines.push(`**Adapter hints:** ${b.adapterHints.join(", ")}`);
  }
  return lines.join("\n");
}

function renderAICreative(b: AICreativeBrief): string {
  const lines: string[] = [];
  lines.push(`*Style:* ${b.style.replace(/_/g, " ")}`);
  lines.push("");
  lines.push(`**Shot intent**: ${b.shotIntent}`);
  lines.push(`**Emotional beat**: ${b.emotionalBeat}`);
  lines.push(`**Visual strategy**: ${b.visualStrategy}`);
  if (b.alternateApproaches.length) {
    lines.push("");
    lines.push("**Alternate approaches**");
    for (const a of b.alternateApproaches) lines.push(`- ${a}`);
  }
  if (b.reviewCriteria.length) {
    lines.push("");
    lines.push("**Review criteria**");
    for (const r of b.reviewCriteria) lines.push(`- ${r}`);
  }
  if (b.promptStrategy) {
    lines.push("");
    lines.push("**Prompt strategy**");
    lines.push("```");
    lines.push(b.promptStrategy);
    lines.push("```");
  }
  if (b.riskNotes.length) {
    lines.push("");
    lines.push("**Risk notes**");
    for (const r of b.riskNotes) lines.push(`- ${r}`);
  }
  if (b.continuityConcerns.length) {
    lines.push("");
    lines.push("**Continuity concerns**");
    for (const c of b.continuityConcerns) lines.push(`- ${c}`);
  }
  return lines.join("\n");
}

function renderLivePerson(b: LivePersonBrief): string {
  const lines: string[] = [];
  lines.push(`*Format:* ${b.format.replace(/_/g, " ")}`);
  if (b.recipient) lines.push(`*To:* ${b.recipient}${b.email ? ` <${b.email}>` : ""}`);
  lines.push("");
  lines.push(`**Task**: ${b.taskHeadline}`);
  lines.push("");
  lines.push("**Context**");
  lines.push("```");
  lines.push(b.context);
  lines.push("```");
  lines.push(`**Deliverable**: ${b.deliverable}`);
  if (b.references.length) {
    lines.push("");
    lines.push("**References**");
    for (const r of b.references) lines.push(`- ${r}`);
  }
  if (b.departmentNotes.length) {
    lines.push("");
    lines.push("**Department notes**");
    for (const n of b.departmentNotes) lines.push(`- ${n}`);
  }
  if (b.checklist.length) {
    lines.push("");
    lines.push("**Checklist**");
    for (const c of b.checklist) lines.push(`- [ ] ${c}`);
  }
  return lines.join("\n");
}
