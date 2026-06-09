// Production Package Export — orchestrator.
//
// Read-only. Pulls from EVERY existing approved-canon source and
// bundles them into a single ZIP + manifest. Never invokes a creative
// generator. Never writes scripts.fountain or script_scenes.
//
// Sources:
//   • Screenplay     → screenplay/{fountain,pdf,fdx,markdown}
//   • Redev passes   → projects.metadata.redevelopmentPasses[]
//   • Characters     → characters table (+ visualBible metadata)
//   • Bibles         → projects.metadata.{locationBibles,propBibles}
//   • Sound Bible    → projects.metadata.soundBibles[ep] (+ music pack)
//   • Shot List      → scripts.metadata.aiPrompts.{briefs,shotListApproval}
//   • Trailer Pack   → projects.metadata.trailerBuilder[ep]
//   • Pitch deck     → projects.metadata.pitch
//
// Approval / warnings:
//   • screenplay missing  → BLOCKS export
//   • everything else     → included if present, listed in `warnings`
//     when missing or unapproved

import { supabase } from "../db/client.js";
import { parseFountain } from "../screenplay/fountain.js";
import { exportFDX } from "../screenplay/fdx.js";
import { exportPDF } from "../screenplay/pdf.js";
import { exportMarkdown } from "../screenplay/markdown.js";
import { getSoundBible } from "../sound/store.js";
import {
  exportSoundBibleJSON,
  exportSoundBibleMarkdown,
} from "../sound/exporter.js";
import { getShotList } from "../shotList/store.js";
import {
  exportShotListCSV,
  exportShotListJSON,
  exportShotListMarkdown,
} from "../shotList/store.js";
import { getTrailerPack } from "../trailer/store.js";
import {
  exportTrailerPackJSON,
  exportTrailerPackMarkdown,
} from "../trailer/exporter.js";
import { buildZip } from "./zip.js";
import { routeEpisodeBriefs } from "../brief/router.js";
import {
  exportRoleBriefsJson,
  exportRoleBriefsMarkdown,
} from "../brief/exporters.js";
import { loadTeamState } from "../team/store.js";
import type {
  ProductionPackageManifest,
  ProductionPackageScope,
  ProductionPackageWarning,
} from "./manifest.js";

interface BuildArgs {
  projectId: string;
  /** When set, scopes the package to one episode. Null = whole project. */
  episodeId: string | null;
  /** When the episodeId resolves to a current script, this is its id. */
  scriptId?: string | null;
  /** Optional override — force a specific script id when there's no
   *  episode (e.g. legacy single-episode projects). */
  preferScriptId?: string | null;
}

export interface BuildResult {
  zip: Buffer;
  manifest: ProductionPackageManifest;
  filename: string;
}

export async function buildProductionPackage(args: BuildArgs): Promise<BuildResult> {
  const files: Array<{ name: string; data: Buffer }> = [];
  const warnings: ProductionPackageWarning[] = [];
  const includedSections: string[] = [];
  // Phase D — role-routed briefs tallies surfaced on the manifest.
  let roleBriefsIncluded = false;
  let roleAssignmentCount = 0;
  let roleSkippedCount = 0;

  // ---- Project + episode + script resolution ----
  const { data: project } = await supabase
    .from("projects")
    .select("title, tone, metadata, kind, created_at")
    .eq("id", args.projectId)
    .single();
  if (!project) throw new Error("project not found");
  const projectMeta = (project.metadata as Record<string, unknown> | null) ?? {};

  let episode: { id: string; number: number; title: string | null } | null = null;
  if (args.episodeId) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, number, title")
      .eq("id", args.episodeId)
      .maybeSingle();
    if (ep) {
      episode = {
        id: ep.id as string,
        number: ep.number as number,
        title: (ep.title as string | null) ?? null,
      };
    }
  }

  // Current script for the episode (or the project's only script if
  // episode_id is null).
  let scriptQ = supabase
    .from("scripts")
    .select("id, title, draft_number, fountain, metadata, current")
    .eq("project_id", args.projectId);
  scriptQ = episode
    ? scriptQ.eq("episode_id", episode.id)
    : scriptQ.is("episode_id", null);
  const { data: scriptRows } = await scriptQ
    .order("draft_number", { ascending: false })
    .order("current", { ascending: false });
  // Prefer current=true, then highest draft_number.
  const script = scriptRows?.find((r) => r.current === true) ?? scriptRows?.[0] ?? null;
  if (!script) {
    throw new Error("No screenplay found for this scope. Production package needs an approved screenplay.");
  }
  const scriptMeta = (script.metadata as Record<string, unknown> | null) ?? {};
  const scriptIsLocked = scriptMeta.lockedWritingDraft === true;
  const fountain = (script.fountain as string) ?? "";

  // ---- 1. Screenplay (Fountain + Markdown + FDX + PDF) ----
  files.push({
    name: "screenplay/screenplay.fountain",
    data: Buffer.from(fountain, "utf8"),
  });
  includedSections.push("screenplay.fountain");
  try {
    const parsed = parseFountain(fountain);
    files.push({
      name: "screenplay/screenplay.md",
      data: Buffer.from(exportMarkdown(parsed), "utf8"),
    });
    includedSections.push("screenplay.markdown");
    files.push({
      name: "screenplay/screenplay.fdx",
      data: Buffer.from(exportFDX(parsed), "utf8"),
    });
    includedSections.push("screenplay.fdx");
    files.push({
      name: "screenplay/screenplay.pdf",
      data: Buffer.from(exportPDF(parsed)),
    });
    includedSections.push("screenplay.pdf");
  } catch (e) {
    warnings.push({
      section: "screenplay",
      level: "warning",
      message: `Screenplay parse/render partial: ${(e as Error).message}`,
    });
  }

  // ---- 2. Redev passes (R1 brief / R2-R9 final polish metadata) ----
  const passes = Array.isArray(projectMeta.redevelopmentPasses)
    ? (projectMeta.redevelopmentPasses as Array<Record<string, unknown>>)
    : [];
  if (passes.length === 0) {
    warnings.push({
      section: "redevelopment",
      level: "info",
      message: "No redevelopment passes found — skipping R1-R9 canon.",
    });
  } else {
    files.push({
      name: "redevelopment/redevelopment-passes.json",
      data: Buffer.from(JSON.stringify(passes, null, 2), "utf8"),
    });
    includedSections.push("redevelopment.json");
    // Also surface human-readable summaries of each pass.
    files.push({
      name: "redevelopment/README.md",
      data: Buffer.from(renderRedevSummary(passes), "utf8"),
    });
    includedSections.push("redevelopment.summary");
  }

  // ---- 3. Production canon (characters + locations + props + sound) ----
  const { data: characters } = await supabase
    .from("characters")
    .select("name, biography, voice_notes, metadata")
    .eq("project_id", args.projectId);
  if (characters && characters.length > 0) {
    files.push({
      name: "production-canon/characters.json",
      data: Buffer.from(JSON.stringify(characters, null, 2), "utf8"),
    });
    includedSections.push("characters.json");
    files.push({
      name: "production-canon/characters.md",
      data: Buffer.from(renderCharacterBibles(characters), "utf8"),
    });
    includedSections.push("characters.markdown");
  } else {
    warnings.push({
      section: "characters",
      level: "info",
      message: "No characters defined.",
    });
  }
  const locationBibles =
    (projectMeta.locationBibles as Record<string, Record<string, unknown>> | undefined) ?? {};
  if (Object.keys(locationBibles).length > 0) {
    files.push({
      name: "production-canon/location-bibles.json",
      data: Buffer.from(JSON.stringify(locationBibles, null, 2), "utf8"),
    });
    includedSections.push("locationBibles.json");
  } else {
    warnings.push({
      section: "locationBibles",
      level: "info",
      message: "No location bibles defined.",
    });
  }
  const propBibles =
    (projectMeta.propBibles as Record<string, Record<string, unknown>> | undefined) ?? {};
  if (Object.keys(propBibles).length > 0) {
    files.push({
      name: "production-canon/prop-bibles.json",
      data: Buffer.from(JSON.stringify(propBibles, null, 2), "utf8"),
    });
    includedSections.push("propBibles.json");
  } else {
    warnings.push({
      section: "propBibles",
      level: "info",
      message: "No prop bibles defined.",
    });
  }

  // Sound Bible (per-episode only — reads
  // projects.metadata.soundBibles[ep] when an episode is present).
  if (episode) {
    const bible = await getSoundBible(args.projectId, episode.id);
    if (bible.version > 0) {
      const epLabel = `Episode ${episode.number}${episode.title ? `: ${episode.title}` : ""}`;
      files.push({
        name: "production-canon/sound-bible.json",
        data: Buffer.from(exportSoundBibleJSON(bible), "utf8"),
      });
      files.push({
        name: "production-canon/sound-bible.md",
        data: Buffer.from(exportSoundBibleMarkdown(bible, epLabel), "utf8"),
      });
      includedSections.push("soundBible.json", "soundBible.markdown");
      if (!bible.approvedAt) {
        warnings.push({
          section: "soundBible",
          level: "warning",
          message: "Sound Bible unapproved — included as DRAFT.",
        });
      }
      // Music pack (lives on the bible carrier).
      const musicPack = (bible as unknown as { musicPack?: unknown }).musicPack;
      if (musicPack) {
        files.push({
          name: "production-canon/music-pack.json",
          data: Buffer.from(JSON.stringify(musicPack, null, 2), "utf8"),
        });
        includedSections.push("musicPack.json");
      } else {
        warnings.push({
          section: "musicPack",
          level: "info",
          message: "No music prompt pack generated yet.",
        });
      }
    } else {
      warnings.push({
        section: "soundBible",
        level: "info",
        message: "No Sound Bible generated for this episode.",
      });
    }
  }

  // ---- 4. Shot list (per-script) ----
  try {
    const shotList = await getShotList(script.id as string);
    if (shotList.scenes.length > 0) {
      files.push({
        name: "shot-list/shot-list.json",
        data: Buffer.from(exportShotListJSON(shotList), "utf8"),
      });
      files.push({
        name: "shot-list/shot-list.csv",
        data: Buffer.from(exportShotListCSV(shotList), "utf8"),
      });
      files.push({
        name: "shot-list/shot-list.md",
        data: Buffer.from(exportShotListMarkdown(shotList), "utf8"),
      });
      includedSections.push("shotList.json", "shotList.csv", "shotList.markdown");
      if (
        shotList.approval.episodeApprovedAt == null &&
        shotList.approval.shotApprovedCount === 0
      ) {
        warnings.push({
          section: "shotList",
          level: "warning",
          message: `Shot List unapproved — ${shotList.approval.shotTotalCount} shots, 0 approved.`,
        });
      } else if (
        shotList.approval.episodeApprovedAt == null &&
        shotList.approval.shotApprovedCount < shotList.approval.shotTotalCount
      ) {
        warnings.push({
          section: "shotList",
          level: "info",
          message: `Shot List partially approved (${shotList.approval.shotApprovedCount}/${shotList.approval.shotTotalCount} shots).`,
        });
      }
      // AI Video Prompts — raw aiPrompts.prompts map.
      const aiPromptsRaw =
        ((scriptMeta.aiPrompts as Record<string, unknown> | undefined)?.prompts as
          | Record<string, unknown>
          | undefined) ?? null;
      if (aiPromptsRaw) {
        files.push({
          name: "shot-list/ai-video-prompts.json",
          data: Buffer.from(JSON.stringify(aiPromptsRaw, null, 2), "utf8"),
        });
        includedSections.push("aiVideoPrompts.json");
      }
    } else {
      warnings.push({
        section: "shotList",
        level: "info",
        message: "No shot briefs in aiPrompts.briefs — nothing to export.",
      });
    }
  } catch (e) {
    warnings.push({
      section: "shotList",
      level: "warning",
      message: `Shot list export failed: ${(e as Error).message}`,
    });
  }

  // ---- 5. Trailer pack ----
  if (episode) {
    const pack = await getTrailerPack(args.projectId, episode.id);
    if (pack.version > 0) {
      const epLabel = `Episode ${episode.number}${episode.title ? `: ${episode.title}` : ""}`;
      files.push({
        name: "trailer/trailer-pack.json",
        data: Buffer.from(exportTrailerPackJSON(pack), "utf8"),
      });
      files.push({
        name: "trailer/trailer-pack.md",
        data: Buffer.from(exportTrailerPackMarkdown(pack, epLabel), "utf8"),
      });
      includedSections.push("trailerPack.json", "trailerPack.markdown");
      if (!pack.approvedAt) {
        warnings.push({
          section: "trailerPack",
          level: "warning",
          message: "Trailer pack unapproved — included as DRAFT.",
        });
      }
      if (!pack.derivedFromApprovedShots) {
        warnings.push({
          section: "trailerPack",
          level: "warning",
          message: "Trailer pack was generated from unapproved shot briefs.",
        });
      }
    } else {
      warnings.push({
        section: "trailerPack",
        level: "info",
        message: "Trailer Plan missing — no trailer pack generated yet.",
      });
    }
  }

  // ---- 5b. Role-routed briefs (Phase D) ----
  // Per-episode only — the brief router walks the episode's shot list.
  // Writes role-briefs/role-briefs.{json,md} and surfaces three manifest
  // counters: roleBriefsIncluded, roleAssignmentCount, roleSkippedCount.
  if (episode) {
    try {
      const team = await loadTeamState(args.projectId);
      roleAssignmentCount = team ? Object.keys(team.assignments).length : 0;
      if (roleAssignmentCount === 0) {
        warnings.push({
          section: "roleBriefs",
          level: "warning",
          message:
            "Role briefs not included — creative roles are not assigned.",
        });
      } else {
        const resp = await routeEpisodeBriefs(args.projectId, episode.id, {});
        if (!resp) {
          warnings.push({
            section: "roleBriefs",
            level: "info",
            message: "Role briefs unavailable — router returned no response.",
          });
        } else {
          // Count distinct unassigned role keys across all shots.
          const skippedKeys = new Set<string>();
          for (const s of resp.shots) {
            for (const sk of s.skipped) skippedKeys.add(sk.roleKey);
          }
          roleSkippedCount = skippedKeys.size;

          files.push({
            name: "role-briefs/role-briefs.json",
            data: Buffer.from(exportRoleBriefsJson(resp), "utf8"),
          });
          files.push({
            name: "role-briefs/role-briefs.md",
            data: Buffer.from(exportRoleBriefsMarkdown(resp), "utf8"),
          });
          includedSections.push("roleBriefs.json", "roleBriefs.markdown");
          roleBriefsIncluded = true;

          // Useful info-level signals so the writer knows what's in the bundle.
          const totalArtifacts = resp.shots.reduce(
            (n, s) => n + s.artifacts.length,
            0
          );
          if (totalArtifacts === 0) {
            warnings.push({
              section: "roleBriefs",
              level: "info",
              message:
                "Role briefs included but contain no artifacts — no shots match assigned roles yet.",
            });
          }
          if (roleSkippedCount > 0) {
            warnings.push({
              section: "roleBriefs",
              level: "info",
              message: `Role briefs reference ${roleSkippedCount} unassigned role${roleSkippedCount === 1 ? "" : "s"} — assign on Creative Team to fill the gaps.`,
            });
          }
        }
      }
    } catch (e) {
      warnings.push({
        section: "roleBriefs",
        level: "warning",
        message: `Role briefs export failed: ${(e as Error).message}`,
      });
    }
  } else {
    warnings.push({
      section: "roleBriefs",
      level: "info",
      message: "Role briefs are per-episode — included only on episode-scoped bundles.",
    });
  }

  // ---- 6. Pitch materials ----
  const pitch = projectMeta.pitch as Record<string, unknown> | undefined;
  if (pitch && Object.keys(pitch).length > 0) {
    files.push({
      name: "pitch/pitch.json",
      data: Buffer.from(JSON.stringify(pitch, null, 2), "utf8"),
    });
    includedSections.push("pitch.json");
    files.push({
      name: "pitch/pitch.md",
      data: Buffer.from(renderPitchMarkdown(pitch, project.title as string), "utf8"),
    });
    includedSections.push("pitch.markdown");
    // Heuristic completeness check — decks have decks[].
    const decks = pitch.decks as Array<Record<string, unknown>> | undefined;
    if (!decks || decks.length === 0) {
      warnings.push({
        section: "pitch",
        level: "info",
        message: "Pitch deck has no slides yet — Pitch Deck incomplete.",
      });
    }
  } else {
    warnings.push({
      section: "pitch",
      level: "info",
      message: "No pitch materials found.",
    });
  }

  // ---- 7. Master Production Bible (markdown) ----
  const masterBible = renderMasterBible({
    projectTitle: (project.title as string) ?? "Untitled",
    project,
    episode,
    script,
    scriptIsLocked,
    includedSections,
    warnings,
  });
  files.push({
    name: "PRODUCTION-BIBLE.md",
    data: Buffer.from(masterBible, "utf8"),
  });
  includedSections.push("productionBible.markdown");

  // ---- 8. Manifest ----
  const manifest: ProductionPackageManifest = {
    schemaVersion: 1,
    projectId: args.projectId,
    projectTitle: (project.title as string) ?? null,
    episodeId: episode?.id ?? null,
    episodeNumber: episode?.number ?? null,
    episodeTitle: episode?.title ?? null,
    scriptId: script.id as string,
    draftNumber: (script.draft_number as number) ?? null,
    lockedWritingDraft: scriptIsLocked,
    exportedAt: new Date().toISOString(),
    scope: episode ? ("episode" as ProductionPackageScope) : ("project" as ProductionPackageScope),
    includedSections,
    warnings,
    sourceCommitHash: process.env.GIT_COMMIT_HASH ?? null,
    roleBriefsIncluded,
    roleAssignmentCount,
    roleSkippedCount,
  };
  files.push({
    name: "manifest.json",
    data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
  });

  const zip = buildZip(
    files.map((f) => ({ name: f.name, data: f.data, mtime: new Date() }))
  );

  const safeTitle = (project.title as string | null)?.replace(/[^A-Za-z0-9_-]+/g, "_") ?? "untitled";
  const epPart = episode ? `_EP${String(episode.number).padStart(2, "0")}` : "";
  const filename = `${safeTitle}${epPart}_production-package_draft${script.draft_number ?? "?"}.zip`;

  return { zip, manifest, filename };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderMasterBible(args: {
  projectTitle: string;
  project: { metadata: unknown; tone: unknown };
  episode: { number: number; title: string | null } | null;
  script: { title: string | null; draft_number: number };
  scriptIsLocked: boolean;
  includedSections: string[];
  warnings: ProductionPackageWarning[];
}): string {
  const lines: string[] = [];
  lines.push(`# Production Bible — ${args.projectTitle}`);
  lines.push("");
  if (args.episode) {
    lines.push(`**Episode.** ${args.episode.number}${args.episode.title ? `: ${args.episode.title}` : ""}`);
  }
  lines.push(`**Source draft.** ${args.script.title ?? "Untitled"} (Draft ${args.script.draft_number})${args.scriptIsLocked ? " · LOCKED creative source" : ""}`);
  lines.push("");
  lines.push("This package is a snapshot of every approved canon source for the production.");
  lines.push("See the per-folder JSON / Markdown files for the raw data.");
  lines.push("");
  lines.push("## Contents");
  for (const s of args.includedSections) lines.push(`- ${s}`);
  lines.push("");
  if (args.warnings.length > 0) {
    lines.push("## Warnings");
    for (const w of args.warnings) {
      lines.push(`- **${w.level}** · ${w.section} — ${w.message}`);
    }
    lines.push("");
  }
  lines.push("## Folder map");
  lines.push("- `screenplay/` — Fountain, Markdown, FDX, PDF");
  lines.push("- `redevelopment/` — R1-R9 pass data + summary");
  lines.push("- `production-canon/` — characters, location/prop bibles, Sound Bible, music pack");
  lines.push("- `shot-list/` — curated shot list + AI video prompts");
  lines.push("- `trailer/` — 15s/30s/60s trailer plans");
  lines.push("- `pitch/` — buyer-facing materials");
  lines.push("- `PRODUCTION-BIBLE.md` — this file");
  lines.push("- `manifest.json` — schema + provenance");
  return lines.join("\n");
}

function renderRedevSummary(passes: Array<Record<string, unknown>>): string {
  const lines: string[] = [];
  lines.push("# Redevelopment Passes");
  lines.push("");
  for (let i = 0; i < passes.length; i++) {
    const p = passes[i];
    lines.push(`## Pass ${i + 1}`);
    lines.push("");
    const brief = p.brief as { engine?: string; pilotPromise?: string; audiencePromise?: string } | undefined;
    if (brief) {
      lines.push("### R1 Brief");
      if (brief.engine) lines.push(`- Engine: ${brief.engine}`);
      if (brief.pilotPromise) lines.push(`- Pilot promise: ${brief.pilotPromise}`);
      if (brief.audiencePromise) lines.push(`- Audience promise: ${brief.audiencePromise}`);
      lines.push("");
    }
    if (p.characterBibles) {
      const bibles = p.characterBibles as Array<Record<string, unknown>>;
      lines.push(`### R2 Character bibles (${bibles?.length ?? 0})`);
      lines.push("");
    }
    if (p.protocolModules) {
      lines.push("### R3 Protocol modules");
      lines.push("(see redevelopment-passes.json)");
      lines.push("");
    }
    if (p.seasonArc) {
      lines.push("### R4 Season arc");
      lines.push("(see redevelopment-passes.json)");
      lines.push("");
    }
    if (p.pilotStrategy) {
      lines.push("### R5 Pilot strategy");
      lines.push("(see redevelopment-passes.json)");
      lines.push("");
    }
    if (p.r6Guardrails) {
      lines.push("### R6 Guardrails");
      const guards = p.r6Guardrails as { characterContracts?: Array<unknown>; globalRule?: string };
      if (guards.globalRule) lines.push(`- Global rule: ${guards.globalRule}`);
      lines.push(`- Character contracts: ${guards.characterContracts?.length ?? 0}`);
      lines.push("");
    }
    const r9 = p.r9FinalPolish as
      | { promotedDraftNumber?: number; approvedAt?: string; promotedScriptId?: string }
      | undefined;
    if (r9) {
      lines.push("### R9 Final polish");
      if (r9.promotedDraftNumber) lines.push(`- Promoted to Draft ${r9.promotedDraftNumber}`);
      if (r9.approvedAt) lines.push(`- Approved at ${r9.approvedAt}`);
      if (r9.promotedScriptId) lines.push(`- Script id: ${r9.promotedScriptId}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function renderCharacterBibles(
  characters: Array<{ name: string; biography: string | null; voice_notes: string | null; metadata: unknown }>
): string {
  const lines: string[] = [];
  lines.push("# Character Bibles");
  lines.push("");
  for (const c of characters) {
    lines.push(`## ${c.name}`);
    if (c.biography) {
      lines.push("");
      lines.push(c.biography);
    }
    if (c.voice_notes) {
      lines.push("");
      lines.push(`**Voice.** ${c.voice_notes}`);
    }
    const meta = (c.metadata as Record<string, unknown> | null) ?? {};
    const dna = meta.dna as Record<string, unknown> | undefined;
    const vb = meta.visualBible as Record<string, unknown> | undefined;
    if (dna) {
      lines.push("");
      lines.push("### DNA");
      for (const [k, v] of Object.entries(dna)) {
        const s = Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";
        if (s) lines.push(`- **${k}.** ${s}`);
      }
    }
    if (vb) {
      lines.push("");
      lines.push("### Visual Bible");
      if (typeof vb.wardrobe === "string") lines.push(`- Wardrobe: ${vb.wardrobe}`);
      const consistency = vb.characterConsistencyPrompt ?? vb.consistencyPrompt;
      if (typeof consistency === "string") lines.push(`- Consistency prompt: ${consistency}`);
      const wByEp = vb.wardrobeByEpisode as Record<string, Record<string, string>> | undefined;
      if (wByEp) {
        lines.push("- Wardrobe by episode:");
        for (const [ep, fields] of Object.entries(wByEp)) {
          lines.push(`  - Episode ${ep}: ${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("; ")}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderPitchMarkdown(pitch: Record<string, unknown>, projectTitle: string): string {
  const lines: string[] = [];
  lines.push(`# Pitch — ${projectTitle}`);
  lines.push("");
  for (const [key, value] of Object.entries(pitch)) {
    lines.push(`## ${key}`);
    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`- ${typeof item === "string" ? item : JSON.stringify(item)}`);
      }
    } else if (typeof value === "string") {
      lines.push(value);
    } else if (typeof value === "object" && value) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`- **${k}.** ${typeof v === "string" ? v : JSON.stringify(v)}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
