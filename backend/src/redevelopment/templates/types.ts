// RedevProjectTemplate — the contract every redev pass runs against.
//
// SELVAJE used to be hard-coded across validators, prompts, and frontend
// defaults. After this refactor, SELVAJE is just one template entry; new
// projects can pick a `blank` template (no characters, no locked
// reveals) or a future genre-specific template (prestige series, feature,
// micro-drama, anthology, political thriller, etc.).
//
// Every R-stage agent + validator reads the active template instead of
// inlined constants. Adding a new project means: (1) pick or write a
// template, (2) optionally edit it from the UI, (3) start R1.

import type { RegexSource, ProtectionTone } from "./shared.js";

export type RedevProjectFormat =
  | "series"        // prestige TV (SELVAJE shape)
  | "mini_series"
  | "feature"
  | "micro_drama"
  | "anthology";

export interface RedevProjectTemplate {
  /** Stable id — used as `pass.redevTemplateId` and the registry key. */
  templateId: string;
  /** Human-facing template name shown in the project-create UI. */
  templateName: string;
  /** Short one-line description shown next to templateName. */
  templateTagline: string;
  /** What shape of project this template targets. Some downstream
   *  systems branch on this (e.g. micro-drama uses ChainAgent + 9:16
   *  composer; series uses the full R1-R9 pipeline). */
  projectFormat: RedevProjectFormat;

  // -----------------------------------------------------------------
  // R1 — Redevelopment Brief
  // -----------------------------------------------------------------
  brief: {
    /** Optional pre-fill defaults the UI uses for a brand-new pass.
     *  Each is a suggestion — the writer can edit before approving. */
    defaults?: {
      whatChanged?: string;
      audiencePromise?: string;
      newCorePrinciple?: string;
      systemPhilosophy?: string;        // generic name for "protocolPhilosophy"
      newSeasonQuestion?: string;
      primaryMystery?: string;
      secondaryMystery?: string;
      characterAnchorRule?: string;     // generic name for "solanoRule"
      forbiddenTones?: string;
      mustNotChange?: string;
      targetsForRedevelopment?: string;
    };
  };

  // -----------------------------------------------------------------
  // R2 — Character Bibles
  // -----------------------------------------------------------------
  cast: {
    /** Seeds the UI uses to pre-create the R2 character rows. Empty
     *  for `blank`; full for SELVAJE. Each name + a one-paragraph
     *  showrunnerSeed the LLM uses to generate the ten-field bible. */
    seeds: Array<{ name: string; seed: string }>;
    /** Which character names MUST appear in the R3 protocol modules
     *  (used by `enforceCharacterInclusion` in protocolModuleAgent.ts).
     *  Empty array on `blank` = no enforcement. */
    requiredInModules: string[];
  };

  // -----------------------------------------------------------------
  // R3 / story-engine terminology
  // -----------------------------------------------------------------
  storyEngine: {
    /** What the show's mechanism is called. SELVAJE: "Surrender".
     *  Feature: "the central choice". Political thriller: "leverage". */
    engineName: string;
    /** One-sentence definition the LLM uses in prompts. */
    engineDescription: string;
    /** What the per-module unit is called. SELVAJE: "Protocol Modules".
     *  Other templates: "Pressure Mechanisms" / "Episode Engines" /
     *  "Investigation Beats" / "Political Leverage Points". */
    moduleNoun: string;        // singular (e.g. "Protocol Module")
    moduleNounPlural: string;  // plural (e.g. "Protocol Modules")
  };

  // -----------------------------------------------------------------
  // R5 → R9 — locked reveals + protections
  // -----------------------------------------------------------------
  /** Reveals that must NOT surface in the pilot. Each one becomes
   *  (a) a "Do NOT reveal …" line injected into every relevant system
   *  prompt and (b) a regex check in the audit. Generic across templates;
   *  blank has [] and audits skip the protection checks. */
  protectedReveals: Array<{
    id: string;                        // "paul_accident", "elena_sister", "margot_cass"
    label: string;                     // "Paul's accident responsibility"
    promptLine: string;                // full sentence injected into LLM prompts
    /** Regex strings — compiled at runtime. unnegatedHit() applied. */
    forbiddenPatterns: RegexSource[];
    /** Audit tone when the pattern fires. Default "warning". */
    tone?: ProtectionTone;
  }>;

  /** Framings the show must NOT drift into (SELVAJE: "Solano as fraud /
   *  cult / con / manipulator"). Generic across templates. */
  forbiddenFramings: Array<{
    id: string;                        // "solano_fraud"
    label: string;                     // "Authority-figure-as-fraud framing"
    promptLine: string;
    forbiddenPatterns: RegexSource[];
  }>;

  /** Plants / beats / props the pilot MUST contain. SELVAJE: archive
   *  room, transparent case, photograph wall, common room. Used by R6
   *  + R7 audits to ensure the architecture survived the rewrite. */
  requiredPlants: Array<{
    id: string;                        // "transparent_case", "archive_room"
    label: string;                     // "Transparent case in the closing block"
    /** Regex(es) that, if matched anywhere in the pilot, satisfy the
     *  required-plant audit. */
    presencePatterns: RegexSource[];
    /** Optional location hint (e.g. "tail of pilot"). */
    location?: "anywhere" | "tail" | "opening" | "closing";
  }>;

  /** Executional moves the agents must NOT make (SELVAJE: flashbacks,
   *  confession circles, therapy exposition). Generic — every template
   *  inherits a small "no flashbacks / no therapy-style dialogue" set
   *  and can add their own. */
  forbiddenMoves: Array<{
    id: string;                        // "flashbacks", "confession_circles"
    label: string;                     // "Flashbacks introduced"
    promptLine: string;
    forbiddenPatterns: RegexSource[];
  }>;

  /** Pilot's closing hook strategy. SELVAJE: transparent case + Paul
   *  chime. R7 / R8 / R9 audits check that the hook anchors survive
   *  every rewrite. Blank = empty (no hook protection). */
  hookStrategy: {
    /** Human label shown in audit messages. */
    label: string;
    /** Each anchor is a noun or phrase the audit looks for in the
     *  tail of the pilot. ≥ N anchors required (see `requiredAnchorCount`). */
    anchors: Array<{
      id: string;                      // "transparent_case", "paul_chime"
      label: string;
      patterns: RegexSource[];
    }>;
    /** How many anchors must be present in the tail. Default 2. */
    requiredAnchorCount?: number;
    /** Where to scan. Default `tail` (last 3000-3500 chars). */
    scanLocation?: "tail" | "anywhere";
  };

  // -----------------------------------------------------------------
  // Showrunner-note / meta-narration rules
  // -----------------------------------------------------------------
  /** Patterns that the audit flags as meta-narration in agent output
   *  ("the audience feels", "we realize", etc.). Generic across all
   *  templates — every show should avoid these. Per-template additions
   *  allowed. */
  metaNarrationPatterns: RegexSource[];

  // -----------------------------------------------------------------
  // UI label overrides
  // -----------------------------------------------------------------
  /** Per-stage label overrides. SELVAJE uses "Protocol Modules";
   *  political thriller might use "Pressure Mechanisms". The redev page
   *  reads STAGE_LABEL ?? template.uiLabels[stage] ?? default. */
  uiLabels?: {
    r3_protocol_modules?: string;       // R3 stage label
    r4_season_arc?: string;
    [key: string]: string | undefined;
  };
}

/** A per-character contract the SELVAJE-shape R6 guardrails agent uses
 *  as an overlay. Templates can declare these to make R6 pre-fill the
 *  guardrails bundle with locked per-character text the writer can
 *  edit. */
export interface RedevTemplateCharacterContract {
  characterName: string;
  plants: string[];
  doNotReveal: string[];
  doNotDo: string[];
  executionRule: string;
  /** Regex(es) that confirm this character's plant survived a rewrite
   *  (used by R6 Pass 2 audit + repair). */
  plantDetectionPatterns: RegexSource[];
}

/** Optional R6 overlay data — only the SELVAJE template currently
 *  populates this; future templates can opt in. */
export interface RedevTemplateR6Overlay {
  /** Per-character contracts merged with whatever R6 generates. */
  characterContracts: RedevTemplateCharacterContract[];
  /** Global rule string injected into R6's locked global rule. */
  globalRule: string;
  /** Pilot-level architectural plants (archive room, common room, …)
   *  added to the bundle's globalPlants[]. */
  architecturalPlants: string[];
}
