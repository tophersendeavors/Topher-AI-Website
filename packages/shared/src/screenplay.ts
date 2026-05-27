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
