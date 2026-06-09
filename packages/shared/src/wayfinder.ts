// Wayfinder — persistent "Next Step" system.
//
// One endpoint, one response shape, surfaced as a banner on every major
// page. Extends the development-phase recommendedStep engine with a
// production-phase resolver (sound bible → shot list → prompts → queue
// → review → exports). The resolver is order-sensitive: it returns the
// first unfinished step and never overwhelms the user with parallel
// "do these eight things" lists.

export type WayfinderPhase =
  | "development"
  | "screenplay"
  | "sound_bible"
  | "shot_list"
  | "ai_prompts"
  | "generation_queue"
  | "review"
  | "trailer"
  | "exports"
  | "complete";

export type WayfinderTone = "primary" | "warning" | "info" | "success";

export interface WayfinderButton {
  label: string;
  /** Relative to /projects/:projectId — empty string means the project root. */
  toRel: string;
}

export interface WayfinderStep {
  phase: WayfinderPhase;
  phaseLabel: string;
  /** Short status, e.g. "Not generated" or "12 / 20 approved". */
  status: string;
  /** One-line headline action — what to do next. */
  title: string;
  /** Why it matters — one short paragraph. */
  why: string;
  primary: WayfinderButton;
  secondary?: WayfinderButton;
  /** Human-readable prereqs that aren't met. Empty when nothing blocks. */
  blockers?: string[];
  tone: WayfinderTone;
}

export interface WayfinderResponse {
  projectId: string;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  step: WayfinderStep;
}
