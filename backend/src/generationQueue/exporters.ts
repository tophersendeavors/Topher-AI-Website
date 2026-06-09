// AI Production Queue — export formats.
//
// All read-only. Each exporter consumes the assembled response and emits
// a string body the route streams back as a download.

import type {
  GenerationQueueItem,
  GenerationQueueResponse,
  ModelTarget,
} from "@toburt/shared";

// ---------------------------------------------------------------------------
// Queue CSV — one row per queue item.
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/\r?\n/g, " ").trim();
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportQueueCsv(resp: GenerationQueueResponse): string {
  const headers = [
    "episode",
    "scene_ord",
    "shot_index",
    "shot_description",
    "characters",
    "location",
    "props",
    "time_of_day",
    "aspect_ratio",
    "duration_sec",
    "model_target",
    "status",
    "ready",
    "brief_approved_at",
    "outputs_count",
    "approved_output_id",
    "review_notes",
    "retry_instruction",
    "blockers",
  ];
  const lines = [headers.join(",")];
  const epLabel = resp.episodeNumber !== null
    ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
    : resp.episodeId;
  for (const it of resp.queue.items) {
    lines.push(
      [
        csvCell(epLabel),
        csvCell(it.sceneOrd),
        csvCell(it.shotIndex),
        csvCell(it.shotDescription),
        csvCell(it.characters.join("|")),
        csvCell(it.location),
        csvCell(it.props.join("|")),
        csvCell(it.timeOfDay),
        csvCell(it.aspectRatio),
        csvCell(it.durationSec),
        csvCell(it.modelTarget),
        csvCell(it.status),
        csvCell(it.readiness.blockers.length === 0 ? "yes" : "no"),
        csvCell(it.briefApprovedAt),
        csvCell(it.outputs.length),
        csvCell(it.approvedOutputId ?? ""),
        csvCell(it.reviewNotes ?? ""),
        csvCell(it.retryInstruction ?? ""),
        csvCell(it.readiness.blockers.join(" | ")),
      ].join(",")
    );
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Approved shot manifest JSON — final, locked-in outputs.
// ---------------------------------------------------------------------------

export function exportApprovedManifestJson(resp: GenerationQueueResponse): string {
  const approved = resp.queue.items
    .filter((it) => (it.status === "approved" || it.status === "final") && it.approvedOutputId)
    .map((it) => {
      const out = it.outputs.find((o) => o.id === it.approvedOutputId);
      return {
        episodeId: it.episodeId,
        episodeNumber: resp.episodeNumber,
        sceneOrd: it.sceneOrd,
        shotIndex: it.shotIndex,
        shotDescription: it.shotDescription,
        characters: it.characters,
        location: it.location,
        aspectRatio: it.aspectRatio,
        durationSec: it.durationSec,
        modelTarget: it.modelTarget,
        outputUrl: out?.url ?? null,
        versionLabel: out?.versionLabel ?? null,
        approvedAt: out?.uploadedAt ?? null,
        status: it.status,
      };
    });
  const manifest = {
    schemaVersion: 1,
    projectId: resp.projectId,
    episodeId: resp.episodeId,
    episodeNumber: resp.episodeNumber,
    episodeTitle: resp.episodeTitle,
    scriptId: resp.scriptId,
    scriptDraftNumber: resp.scriptDraftNumber,
    generatedAt: new Date().toISOString(),
    totalApproved: approved.length,
    shots: approved,
  };
  return JSON.stringify(manifest, null, 2);
}

// ---------------------------------------------------------------------------
// Scene assembly checklist (Markdown) — for the editor or VFX op.
// ---------------------------------------------------------------------------

export function exportSceneAssemblyChecklistMarkdown(
  resp: GenerationQueueResponse
): string {
  const lines: string[] = [];
  lines.push(
    `# Scene Assembly Checklist — ${resp.projectTitle ?? "Project"} EP${
      resp.episodeNumber !== null ? String(resp.episodeNumber).padStart(2, "0") : "??"
    }`
  );
  if (resp.episodeTitle) lines.push(`*${resp.episodeTitle}*`);
  lines.push("");
  lines.push(`Overall completion: ${resp.summary.overallCompletionPct}%`);
  lines.push("");
  // Group items by scene from the queue itself.
  const byOrd = new Map<number, GenerationQueueItem[]>();
  for (const it of resp.queue.items) {
    const list = byOrd.get(it.sceneOrd) ?? [];
    list.push(it);
    byOrd.set(it.sceneOrd, list);
  }
  for (const sc of resp.summary.scenes) {
    const its = (byOrd.get(sc.sceneOrd) ?? []).sort((a, b) => a.shotIndex - b.shotIndex);
    lines.push(`## Scene ${sc.sceneOrd} — ${sc.slugline}`);
    lines.push(
      `${sc.completionPct}% complete · ${sc.approvedShots}/${sc.totalShots} approved · ${sc.missingShots} missing · ${sc.rejectedShots} rejected`
    );
    if (its.length === 0) {
      lines.push("- (no shots in queue)");
    } else {
      for (const it of its) {
        const out =
          it.approvedOutputId &&
          it.outputs.find((o) => o.id === it.approvedOutputId)?.url;
        const stamp =
          it.status === "approved" || it.status === "final" ? "x" : " ";
        lines.push(
          `- [${stamp}] SH${String(it.shotIndex + 1).padStart(2, "0")} (${it.modelTarget}) — ${it.shotDescription}`
        );
        if (out) lines.push(`    ↳ ${out}`);
        if (it.reviewNotes) lines.push(`    *Notes:* ${it.reviewNotes}`);
        if (it.readiness.blockers.length) {
          lines.push(`    *Blocked by:* ${it.readiness.blockers.join("; ")}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Model-specific prompt batch (plain text)
// ---------------------------------------------------------------------------

export function exportModelBatchText(
  resp: GenerationQueueResponse,
  model: ModelTarget
): string {
  const lines: string[] = [];
  const epLabel =
    resp.episodeNumber !== null
      ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
      : resp.episodeId;
  lines.push(
    `# ${model.toUpperCase()} batch — ${resp.projectTitle ?? "Project"} ${epLabel}`
  );
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");
  const items = resp.queue.items.filter((it) => it.modelTarget === model);
  if (items.length === 0) {
    lines.push(`(No shots assigned to ${model}.)`);
    return lines.join("\n") + "\n";
  }
  for (const it of items.sort((a, b) => a.sceneOrd - b.sceneOrd || a.shotIndex - b.shotIndex)) {
    lines.push(
      `## SC${String(it.sceneOrd).padStart(2, "0")}_SH${String(it.shotIndex + 1).padStart(2, "0")}`
    );
    lines.push(`Description: ${it.shotDescription}`);
    lines.push(`Aspect ratio: ${it.aspectRatio} · Duration: ${it.durationSec}s`);
    if (it.characters.length) lines.push(`Characters: ${it.characters.join(", ")}`);
    if (it.location) lines.push(`Location: ${it.location}`);
    if (it.props.length) lines.push(`Props: ${it.props.join(", ")}`);
    if (it.timeOfDay) lines.push(`Time of day: ${it.timeOfDay}`);
    if (it.soundNotes?.audioField) lines.push(`Audio: ${it.soundNotes.audioField}`);
    if (it.soundNotes?.nonDiegeticMusic) lines.push(`Music: ${it.soundNotes.nonDiegeticMusic}`);
    lines.push("");
    lines.push("Prompt:");
    lines.push(it.promptText || "(no prompt text — generate via Shot List page)");
    if (it.retryInstruction) {
      lines.push("");
      lines.push(`Retry instruction: ${it.retryInstruction}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Trailer shot batch — items whose shots are referenced by the trailer
// pack approval. We surface them as a flat list (trailer-build itself
// composes the per-variant prompts).
// ---------------------------------------------------------------------------

export function exportTrailerBatchText(resp: GenerationQueueResponse): string {
  const lines: string[] = [];
  const epLabel =
    resp.episodeNumber !== null
      ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
      : resp.episodeId;
  lines.push(`# Trailer batch — ${resp.projectTitle ?? "Project"} ${epLabel}`);
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "Approved shots only — flat list of model-ready prompts for trailer cut downstream."
  );
  lines.push("");
  const items = resp.queue.items
    .filter((it) => it.status === "approved" || it.status === "final")
    .sort((a, b) => a.sceneOrd - b.sceneOrd || a.shotIndex - b.shotIndex);
  if (items.length === 0) {
    lines.push("(No approved shots yet.)");
    return lines.join("\n") + "\n";
  }
  for (const it of items) {
    lines.push(
      `## SC${String(it.sceneOrd).padStart(2, "0")}_SH${String(it.shotIndex + 1).padStart(2, "0")} (${it.modelTarget})`
    );
    lines.push(it.shotDescription);
    if (it.approvedOutputId) {
      const out = it.outputs.find((o) => o.id === it.approvedOutputId);
      if (out?.url) lines.push(`Approved output: ${out.url}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function exportQueue(
  resp: GenerationQueueResponse,
  format: string,
  modelHint?: ModelTarget
): { body: string; contentType: string; filename: string } {
  const epSlug =
    resp.episodeNumber !== null
      ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
      : resp.episodeId.slice(0, 6);
  const base =
    (resp.projectTitle ?? "project")
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase() + `_${epSlug}`;
  switch (format) {
    case "queue_csv":
      return {
        body: exportQueueCsv(resp),
        contentType: "text/csv; charset=utf-8",
        filename: `${base}_generation_queue.csv`,
      };
    case "approved_manifest_json":
      return {
        body: exportApprovedManifestJson(resp),
        contentType: "application/json; charset=utf-8",
        filename: `${base}_approved_manifest.json`,
      };
    case "scene_assembly_checklist_markdown":
      return {
        body: exportSceneAssemblyChecklistMarkdown(resp),
        contentType: "text/markdown; charset=utf-8",
        filename: `${base}_scene_assembly_checklist.md`,
      };
    case "model_batch_text":
      return {
        body: exportModelBatchText(resp, modelHint ?? "veo"),
        contentType: "text/plain; charset=utf-8",
        filename: `${base}_${modelHint ?? "veo"}_batch.txt`,
      };
    case "trailer_batch_text":
      return {
        body: exportTrailerBatchText(resp),
        contentType: "text/plain; charset=utf-8",
        filename: `${base}_trailer_batch.txt`,
      };
    default:
      throw new Error(`unknown export format: ${format}`);
  }
}
