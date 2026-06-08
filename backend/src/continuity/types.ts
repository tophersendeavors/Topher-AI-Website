// Continuity Department types.
//
// Storage:
//   • Location bibles  → projects.metadata.locationBibles[normalizedName]
//   • Prop bibles      → projects.metadata.propBibles[normalizedName]
//   • Pass results     → scripts.metadata.continuity
//
// No DB migration — everything sits in existing jsonb columns. Names are
// normalized via normalizeKey() before storage so "INT. MAYA BEDROOM -
// NIGHT" and "int maya bedroom - night" collide on the same record.

export type ContinuitySeverity = "pass" | "warning" | "fail";

export type ContinuityCategory =
  | "character"
  | "location"
  | "prop"
  | "eyeline"
  | "reference"
  | "story_containment";

export interface ContinuityWhere {
  episodeNumber?: number | null;
  sceneOrd?: number | null;
  shotIndex?: number | null;
  characterName?: string | null;
  locationName?: string | null;
  propName?: string | null;
}

export interface ContinuityIssue {
  /** Stable id so the UI can dismiss / track. */
  id: string;
  category: ContinuityCategory;
  severity: ContinuitySeverity;
  where: ContinuityWhere;
  message: string;
  /** One-line writer-facing remediation when known. */
  suggestedFix?: string;
}

// ---------------------------------------------------------------------------
//  Location Spatial Bible
// ---------------------------------------------------------------------------

export interface FurniturePosition {
  name: string;
  /** Free-text spatial anchor: "center-left of room", "against back wall". */
  position: string;
  /** Optional orientation: "headboard against back wall", "facing Maya". */
  orientation?: string;
  /** True when this piece must not move between shots. */
  locked?: boolean;
}

export interface CameraRule {
  /** Short label so writers can refer to it ("from foot of bed"). */
  label: string;
  /** Brief description so the validator can regex-match. */
  description: string;
}

// Stage-2 — structured Art Department fields. Optional on every bible
// (existing bibles keep working). When set, the composer's continuity
// directive scopes architecture / set-dressing details to the shot's
// view zone instead of dumping every field.

export interface ArchitectureFields {
  /** One-line "what kind of room this is" — surfaced at top of every
   *  prompt for this location. */
  locationIdentity?: string;
  wallColor?: string;
  wallMaterial?: string;
  floorColor?: string;
  floorMaterial?: string;
  ceiling?: string;
  trim?: string;
  doorStyle?: string;
  closetDoorStyle?: string;
}

export interface FurnitureDesignFields {
  bedDesign?: string;
  headboardDesign?: string;
  nightstandDesign?: string;
  closetDesign?: string;
}

export interface BeddingFields {
  comforterColor?: string;
  sheetColor?: string;
  pillowCount?: number;
  pillowColors?: string;
  condition?: string;
}

export interface SetDressingFields {
  bedding?: BeddingFields;
  wallDecor?: string;
  personalObjects?: string;
  clutterLevel?: string;
  lamps?: string;
  curtains?: string;
  mirrors?: string;
  books?: string;
  /** Phrases the prompt MUST NOT introduce. Composer checks against these. */
  forbiddenDressing?: string[];
}

export interface LocationBible {
  /** Display name as written in screenplay sluglines. */
  name: string;
  /** Plain-English overview the LLM consumes verbatim. */
  layout: string;
  furniture: FurniturePosition[];
  props: FurniturePosition[];
  doors: FurniturePosition[];
  windows: FurniturePosition[];
  cameraSafeAngles: CameraRule[];
  forbiddenAngles: CameraRule[];
  eyelineRules: string[];
  lightingSources: Array<{
    name: string;
    color: string;
    direction?: string;
    intensity?: string;
  }>;
  /** Stage-2 structured fields (all optional). */
  architecture?: ArchitectureFields;
  furnitureDesign?: FurnitureDesignFields;
  setDressing?: SetDressingFields;
  /** Anchors the validator looks for in briefs / prompts to confirm
   *  the writer hasn't accidentally flipped the room. */
  continuityAnchors: string[];
  /** True = the room must never be mirrored. */
  doNotFlip: boolean;
  /** Block injected verbatim into every shot prompt that uses this
   *  location. The composer reads this through the upcoming
   *  locationContinuity loader. */
  continuityPrompt: string;
  /** Free-text writer notes. */
  notes?: string;
  /** Whether the writer has marked this bible as production-ready. */
  approved?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
//  Prop Continuity Bible
// ---------------------------------------------------------------------------

export interface PropBible {
  name: string;
  /** Location bible name where the prop lives. */
  homeLocation?: string;
  /** Where on screen the prop sits at scene start. */
  startsAt: string;
  endsAt: string;
  orientation?: string;
  /** Character names allowed to touch it (capitalised, matches script tags). */
  handledBy: string[];
  visualDetails: string;
  /** Episodes the prop appears in — informs the validator. */
  episodesPresent: number[];
  /** Phrases the prop must never be described as. */
  doNotChange: string[];
  notes?: string;
  approved?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
//  Persisted pass result
// ---------------------------------------------------------------------------

export interface ContinuityPassResult {
  runAt: string;
  runner: "heuristic" | "heuristic+llm";
  summary: Record<ContinuityCategory, {
    pass: number;
    warning: number;
    fail: number;
  }>;
  issues: ContinuityIssue[];
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise location / prop names so "INT. MAYA BEDROOM - NIGHT" and
 * "int maya bedroom - night" collide on the same record. We strip
 * everything except letters and numbers and uppercase.
 */
export function normalizeKey(s: string): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
