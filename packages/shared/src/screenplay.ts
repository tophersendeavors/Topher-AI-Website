// Lightweight screenplay types used by both the editor (frontend) and the
// Fountain parser / exporters (backend).

export type ScreenplayElementKind =
  | "scene_heading"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition"
  | "shot"
  | "centered"
  | "section"
  | "synopsis"
  | "lyrics"
  | "page_break"
  | "title_page"
  | "boneyard";

export interface ScreenplayElement {
  kind: ScreenplayElementKind;
  text: string;
  // Optional metadata (e.g. dual dialogue, scene number, character extension)
  meta?: Record<string, string | boolean | number>;
}

export interface ParsedScene {
  order: number;
  slugline: string;
  intExt: "INT" | "EXT" | "INT/EXT" | null;
  location: string;
  timeOfDay: string;
  characters: string[];
  startLine: number;
  endLine: number;
  fountain: string;
  elements: ScreenplayElement[];
}

export interface ParsedScreenplay {
  title?: string;
  authors?: string[];
  scenes: ParsedScene[];
  elements: ScreenplayElement[];
  /** Full title-page metadata for exports (Fountain title block, PDF, FDX). */
  titlePage?: TitlePageMeta;
}

/**
 * Title page block for a TV script. Drives the Fountain `Title:` / `Credit:`
 * / `Author:` / `Source:` / `Draft date:` / `Contact:` metadata at the top
 * of exports, the centered title page on PDF, and the Final Draft xml.
 *
 * The fields are deliberately separate from `ParsedScreenplay.title` so the
 * UI's Title Page Settings panel can edit them without forcing a re-parse.
 */
export interface TitlePageMeta {
  /** Series / project title, e.g. "SELVAJE". */
  seriesTitle: string;
  /** "Episode 1: \"Arrival\"" — empty for non-episodic scripts. */
  episodeCredit?: string;
  /** Writer credit lines. AI never fills this. */
  writers?: string[];
  /** "Created by …" — separate from writers. */
  creators?: string[];
  /** "Based on …" attribution. */
  basedOn?: string;
  /** "Draft 1", "Draft 2", … */
  draftLabel?: string;
  /** Human date, e.g. "May 30, 2026". */
  draftDate?: string;
  /** Optional contact block (e.g. "Toburt Studios — contact@…"). */
  contact?: string;
  /** Studio / company line, rendered above contact. */
  studio?: string;
  /** Copyright string, rendered at the bottom of the title page. */
  copyright?: string;
  /** If false, the contact block is suppressed on export. */
  includeContact?: boolean;
}

export interface ExportFormatInfo {
  id: "pdf" | "fdx" | "fountain" | "markdown";
  label: string;
  contentType: string;
  extension: string;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: "pdf", label: "PDF", contentType: "application/pdf", extension: "pdf" },
  {
    id: "fdx",
    label: "Final Draft (.fdx)",
    contentType: "application/vnd.finaldraft+xml",
    extension: "fdx",
  },
  {
    id: "fountain",
    label: "Fountain",
    contentType: "text/x-fountain",
    extension: "fountain",
  },
  {
    id: "markdown",
    label: "Markdown",
    contentType: "text/markdown",
    extension: "md",
  },
];
