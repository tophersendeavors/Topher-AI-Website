// Wayfinder — persistent "Next Step" system.
//
// Two scopes:
//   • "general"    — full ladder including dev-phase (characters,
//                    treatment, season arc, episodes, relationships,
//                    pitch, draft 1). Used on Project Overview.
//   • "production" — skips dev-phase. Walks the production ladder only
//                    (screenplay → sound → shots → prompts → queue →
//                    review → trailer → exports). Used on Production
//                    Hub, Episodes, Sound Bible, Shot List, Trailer
//                    Builder, Generation Queue, Export Center.
//
// Production scope still surfaces stale dev-phase findings, but as a
// secondary `nonProductionWarnings` list, not the primary step.

export type WayfinderScope = "general" | "production";

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

/** Production path stepper — the 7-stage production journey. */
export type ProductionPathState =
  | "complete"
  | "current"
  | "missing"
  | "blocked";

export interface ProductionPathStep {
  key:
    | "screenplay"
    | "sound_bible"
    | "shot_list"
    | "ai_prompts"
    | "generation_queue"
    | "trailer"
    | "exports";
  label: string;
  state: ProductionPathState;
  /** Short status line — e.g. "Draft 5 locked", "v0 — not generated". */
  status: string;
  /** Page to open for this step. Relative to /projects/:projectId. */
  toRel: string;
}

export interface WayfinderResponse {
  projectId: string;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scope: WayfinderScope;
  step: WayfinderStep;
  /** Present on production scope — the 7-step production journey state. */
  productionPath?: ProductionPathStep[];
  /** Present on production scope — dev-phase warnings that exist but are
   *  not blocking production. Displayed as a secondary panel. */
  nonProductionWarnings?: string[];
}
