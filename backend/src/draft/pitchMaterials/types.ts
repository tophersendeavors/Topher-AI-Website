// Pitch Materials types. Separate from the 95% Script Quality Protocol —
// this module is buyer-facing, sourced only from APPROVED project bibles.
// The generator never invents major story details; missing source data is
// surfaced on the slide and on the deck-level manifest.

export type DeckKind =
  | "series_pitch_deck"
  | "film_pitch_deck"
  | "lookbook"
  | "one_sheet"
  | "buyer_treatment"
  | "internal_production_deck";

export const DECK_KIND_LABEL: Record<DeckKind, string> = {
  series_pitch_deck: "Series Pitch Deck",
  film_pitch_deck: "Film Pitch Deck",
  lookbook: "Lookbook",
  one_sheet: "One-Sheet",
  buyer_treatment: "Buyer Treatment",
  internal_production_deck: "Internal Production Deck",
};

export type DeckStatus =
  | "not_started"
  | "draft_generated"
  | "needs_review"
  | "notes_applied"
  | "approved"
  | "final_exported";

export const DECK_STATUS_LABEL: Record<DeckStatus, string> = {
  not_started: "Not Started",
  draft_generated: "Draft Generated",
  needs_review: "Needs Review",
  notes_applied: "Notes Applied",
  approved: "Approved",
  final_exported: "Final Exported",
};

/** Which source-data fields a slide depends on. Used for missing-data flagging. */
export type SourceField =
  | "title"
  | "genre"
  | "format"
  | "logline"
  | "synopsis"
  | "tone"
  | "themes"
  | "world"
  | "characters"
  | "relationships"
  | "season_arc"
  | "episodes"
  | "visual_language"
  | "comps"
  | "audience"
  | "creator_statement"
  | "production_approach";

export const SOURCE_FIELD_LABEL: Record<SourceField, string> = {
  title: "Project title",
  genre: "Genre",
  format: "Format",
  logline: "Logline",
  synopsis: "Synopsis",
  tone: "Tone statement",
  themes: "Themes",
  world: "World / setting",
  characters: "Character bios",
  relationships: "Relationship dynamics",
  season_arc: "Season arc / story arc",
  episodes: "Episode summaries",
  visual_language: "Visual language",
  comps: "Comparable titles",
  audience: "Target audience",
  creator_statement: "Creator statement",
  production_approach: "Production approach",
};

export interface SlideTemplate {
  id: string;                  // stable across regens for diffing
  title: string;
  /** Source fields this slide needs to be fully renderable. */
  sources: SourceField[];
  /** Free-text guidance the LLM sees verbatim when drafting this slide. */
  intent: string;
}

export interface DeckSlide {
  id: string;
  title: string;
  copy: string;
  speakerNotes?: string;
  visualDirection?: string;
  /** Mood-board / key art prompt the writer can feed Midjourney / etc. */
  imagePrompt?: string;
  /** Source fields the generator actually used. */
  sourcesUsed: SourceField[];
  /** Fields the slide WANTED but were missing — the writer must approve / fill. */
  missingSources: SourceField[];
  /** Writer flags. */
  locked?: boolean;
  needsRevision?: boolean;
  approved?: boolean;
  /** True when the writer typed over the generator's copy. */
  edited?: boolean;
  /** True when this slide was added by the writer (not from template). */
  custom?: boolean;
}

export interface DeckVersion {
  /** "v1", "v1.1_NotesPass", "v2" — major-or-decimal. */
  versionId: string;
  versionLabel: string;  // e.g. SELVAJE_PitchDeck_v1.1_NotesPass
  slides: DeckSlide[];
  /** Snapshot of the source manifest used for THIS version. */
  sourceManifest: SourceManifest;
  changeSummary?: string;
  approval: { approvedSlides: number; total: number };
  exported: boolean;
  createdAt: string;
}

export interface PitchDeck {
  id: string;
  projectId: string;
  kind: DeckKind;
  /** Display title (e.g. "SELVAJE — Series Pitch Deck"). */
  title: string;
  status: DeckStatus;
  /** Editable slide list — what the UI shows. */
  slides: DeckSlide[];
  /** Snapshot of the source manifest at the most recent generation. */
  sourceManifest: SourceManifest;
  history: DeckVersion[];
  currentVersionLabel: string;
  createdAt: string;
  updatedAt: string;
}

// --- Source manifest ----------------------------------------------------------

/** Snapshot of what we know from the project — fed verbatim to the generator. */
export interface SourceManifest {
  title?: string;
  genre?: string[];
  format?: string;
  logline?: string;
  synopsis?: string;
  tone?: string[];
  toneStatement?: string;
  themes?: string[];
  world?: string;
  characters?: Array<{
    name: string;
    role?: string;
    bio?: string;
    wants?: string;
    needs?: string;
    flaw?: string;
  }>;
  relationships?: Array<{ a: string; b: string; nature?: string; tension?: string }>;
  seasonArc?: string;
  episodes?: Array<{ number: number; title?: string; logline?: string }>;
  visualLanguage?: string;
  comps?: string[];
  audience?: string;
  creatorStatement?: string;
  productionApproach?: string;
  /** Anything else the writer noted that's not slotted yet. */
  showrunnerNotes?: string;
}

/**
 * Per-field state when the field isn't fully present. Lets the UI
 * distinguish "no records at all" from "records exist but aren't approved"
 * — which need different writer guidance.
 */
export interface FieldDetail {
  /** True when at least one underlying record exists. */
  hasRecords?: boolean;
  /** Total record count when applicable (episodes, characters, …). */
  totalCount?: number;
  /** Records marked approved when applicable (only some entities have approval state). */
  approvedCount?: number;
  /** Records that contributed usable content (loglines / bios / wardrobe). */
  usableCount?: number;
  /** Short reason the field is on the missing list. */
  reason?: string;
}

export interface SourceCheckResult {
  manifest: SourceManifest;
  /** Fields the project has approved data for. */
  present: SourceField[];
  /** Fields with no usable data — generator will emit warnings on dependent slides. */
  missing: SourceField[];
  /** Optional per-field detail the UI uses for richer guidance. */
  details?: Partial<Record<SourceField, FieldDetail>>;
}
