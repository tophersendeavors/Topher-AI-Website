// Shared naming helpers — one source of truth for the three label flavors:
//
//   • Display:  "SELVAJE — Episode 1: Arrival — Draft 1"
//   • File:     "SELVAJE_EP1_Arrival_Draft_1"
//   • Version:  "SELVAJE_EP1_Arrival_v1.1_SubtextPass"
//
// Episode-title rules:
//   • If title_status !== 'approved', we treat the episode as "Untitled".
//     AI-suggested titles are NOT shown in display/export labels until the
//     writer approves them.
//   • If no episode at all (project-scoped legacy script), Episode/EP segments
//     are simply omitted.
//
// Pass labels (decimal versions) are written as v{major}.{minor}_{type}, e.g.
// v1.1_SubtextPass. The major number = scripts.draft_number; the minor +
// pass type live in scripts.metadata.versioning.

export interface NamingInput {
  /** Series / project title. */
  seriesTitle: string;
  episode?: {
    number: number;
    /** Raw title — may be a suggestion or undefined. */
    title?: string | null;
    /** When 'approved' we trust the title; otherwise we render "Untitled". */
    titleStatus?: "untitled" | "suggested" | "approved" | null;
  } | null;
  draftNumber: number;
  /** Decimal pass count under THIS draft (0 = the base draft, 1 = first pass…). */
  passMinor?: number | null;
  /** Named pass type (e.g. "AIBase", "SubtextPass", "SpecReady"). */
  passType?: string | null;
}

const UNTITLED = "Untitled";

function effectiveEpisodeTitle(ep: NamingInput["episode"]): string {
  if (!ep) return "";
  if (ep.titleStatus === "approved" && ep.title && ep.title.trim()) return ep.title.trim();
  return UNTITLED;
}

/** Strip everything but [A-Za-z0-9_] and collapse runs of underscores. */
function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['"]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

/** Display name shown in headers, dashboard rows, dropdowns. */
export function displayLabel(input: NamingInput): string {
  const parts: string[] = [input.seriesTitle.trim() || UNTITLED];
  if (input.episode) {
    const epTitle = effectiveEpisodeTitle(input.episode);
    parts.push(`Episode ${input.episode.number}: ${epTitle}`);
  }
  parts.push(`Draft ${input.draftNumber}`);
  return parts.join(" — ");
}

/** Stable filename stem, no extension. Use for export files / archives. */
export function fileLabel(input: NamingInput): string {
  const parts: string[] = [slug(input.seriesTitle)];
  if (input.episode) {
    parts.push(`EP${input.episode.number}`);
    parts.push(slug(effectiveEpisodeTitle(input.episode)));
  }
  parts.push(`Draft_${input.draftNumber}`);
  return parts.filter(Boolean).join("_");
}

/**
 * Internal version label used to tag every snapshot (pass) of a draft.
 * v{draft}.{minor}_{passType}. Minor 0 = the AIBase / starting draft.
 */
export function versionLabel(input: NamingInput): string {
  const major = input.draftNumber;
  const minor = input.passMinor ?? 0;
  const pass = input.passType?.trim() || (minor === 0 ? "AIBase" : "Pass");
  const parts: string[] = [slug(input.seriesTitle)];
  if (input.episode) {
    parts.push(`EP${input.episode.number}`);
    parts.push(slug(effectiveEpisodeTitle(input.episode)));
  }
  parts.push(`v${major}.${minor}_${slug(pass)}`);
  return parts.filter(Boolean).join("_");
}

/**
 * Convenience: when the writer marks a draft Spec Ready, this is the version
 * label that should be written to scripts.metadata.versioning.
 */
export function specReadyLabel(input: NamingInput): string {
  return versionLabel({ ...input, passType: "SpecReady" });
}

/** Just the "Untitled" fallback so the UI can show it consistently. */
export const UNTITLED_EPISODE = UNTITLED;
