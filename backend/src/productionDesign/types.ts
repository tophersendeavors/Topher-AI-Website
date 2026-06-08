// Production Designer types.
//
// Conceptually the Production Designer owns the PHYSICAL WORLD of the
// scene before the shot list is created. The Continuity Department
// validates after the fact. Both consume the same underlying bibles
// (LocationBible, PropBible) — Production Design adds:
//
//   • VisualWorldRules — project-level aesthetic anchors (grounded
//     realism, phone-era thriller, no glam lighting, etc.)
//   • Per-scene ProductionDesignSceneResult — aggregates the relevant
//     location bible + matched prop bibles + VWR into a single
//     production-design block the composer injects into every prompt
//     for that scene.
//
// Storage:
//   • VisualWorldRules                 → projects.metadata.visualWorldRules
//   • PD pass cache (per script/scene) → scripts.metadata.productionDesign.scenes
//
// No DB migration.

import type { LocationBible, PropBible } from "../continuity/types.js";

export interface VisualWorldRules {
  /** Aesthetic anchors (positive directions). */
  aesthetic: string[];
  /** Forbidden / out-of-bounds aesthetic moves. */
  forbidden: string[];
  /** Specific practical light sources the project owns. */
  lighting: string[];
  /** Visual texture / palette anchors. */
  texture: string[];
  notes?: string;
  approved?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PDWarning {
  severity: "info" | "warning" | "fail";
  message: string;
}

export interface ProductionDesignSceneResult {
  sceneOrd: number;
  slugline: string;
  /** Location bible matched by slugline. */
  location: LocationBible | null;
  /** Prop bibles relevant to this scene — matched by name in fountain. */
  props: PropBible[];
  /** Project-level visual world rules (snapshot at pass time). */
  visualWorldRules: VisualWorldRules | null;
  /** Plain-English design summary the writer reads. */
  designSummary: string;
  /** Layout + furniture positions, formatted. */
  spatialMap: string;
  /** Prop name + position + handler + do-not-change. */
  propMap: string;
  /** Practical light sources + intensity / color. */
  lightingMap: string;
  /** Texture / materials / palette / set dressing. */
  setDressing: string;
  /**
   * The verbatim block that gets concatenated into the composer's system
   * prompt for every shot in this scene. Production Design = world; this
   * is the unified "world block."
   */
  continuityPrompt: string;
  /** Pre-production warnings (missing bible, missing world rules, etc.). */
  warnings: PDWarning[];
}

export interface ProductionDesignPassResult {
  runAt: string;
  scriptId: string;
  /** Per-scene PD output. Keyed by sceneOrd. */
  scenes: Record<number, ProductionDesignSceneResult>;
  /** Roll-up: how many scenes are PD-ready vs missing bibles, etc. */
  summary: {
    scenesTotal: number;
    scenesReady: number;
    scenesWarning: number;
    scenesFail: number;
  };
}
