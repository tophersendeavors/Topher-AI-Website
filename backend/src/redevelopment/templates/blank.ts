// The `blank` template — a clean slate for any new project.
//
// No characters. No locked reveals. No required plants. The pipeline
// still works (every audit / agent reads from the template), it just
// has no project-specific opinions to enforce. Used when a writer
// starts a fresh project before any SELVAJE-style architecture is
// locked.
//
// Templates can be replaced/edited later — `blank` is the starting
// point, not the destination.

import type { RedevProjectTemplate } from "./types.js";
import { re } from "./shared.js";

export const BLANK_TEMPLATE: RedevProjectTemplate = {
  templateId: "blank",
  templateName: "Blank project",
  templateTagline: "Start clean — no characters, plants, or locked reveals.",
  projectFormat: "series",

  brief: {
    defaults: {
      whatChanged: "",
      audiencePromise: "",
      newCorePrinciple: "",
      systemPhilosophy: "",
      newSeasonQuestion: "",
      primaryMystery: "",
      secondaryMystery: "",
      characterAnchorRule: "",
      forbiddenTones: "",
      mustNotChange: "",
      targetsForRedevelopment: "",
    },
  },

  cast: {
    seeds: [],
    requiredInModules: [],
  },

  storyEngine: {
    engineName: "the show's central mechanism",
    engineDescription:
      "Whatever drives the pilot's primary forward momentum — write what your show actually does to characters under pressure.",
    moduleNoun: "story engine module",
    moduleNounPlural: "story engine modules",
  },

  protectedReveals: [],
  forbiddenFramings: [],
  requiredPlants: [],

  /** Even a blank project inherits the universally-bad executional
   *  moves. These apply to every prestige-shape project regardless of
   *  show specifics. */
  forbiddenMoves: [
    {
      id: "flashbacks",
      label: "Flashbacks",
      promptLine: "Do NOT introduce flashbacks.",
      forbiddenPatterns: [
        re("\\bFLASHBACK\\b"),
        re("\\b\\(FLASHBACK\\)"),
        re("\\bINT\\.\\s+[A-Z][^\\n]*?\\b-\\s*FLASHBACK\\b"),
        re("\\bEXT\\.\\s+[A-Z][^\\n]*?\\b-\\s*FLASHBACK\\b"),
      ],
    },
    {
      id: "therapy_exposition",
      label: "Therapy-style exposition",
      promptLine: "Do NOT introduce therapy-style exposition dialogue.",
      forbiddenPatterns: [
        re("\\btell\\s+me\\s+about\\s+your\\s+(childhood|mother|father|family)\\b"),
        re("\\bhow\\s+does\\s+that\\s+make\\s+you\\s+feel\\b"),
        re("\\band\\s+how\\s+do\\s+you\\s+feel\\s+about\\b"),
      ],
    },
  ],

  hookStrategy: {
    label: "Closing hook",
    anchors: [],
    requiredAnchorCount: 0,
    scanLocation: "tail",
  },

  /** Meta-narration rules apply to every project — the audience must
   *  infer feeling from behavior, not be told what to feel. */
  metaNarrationPatterns: [
    re("\\bthe\\s+audience\\s+(feels?|knows?|sees?|understands?|reads?)"),
    re("\\bthe\\s+room\\s+(knows?|understands?)"),
    re("\\bthe\\s+body\\s+(knows?|understands?)"),
    re("\\bwhat\\s+this\\s+means\\s+is\\b"),
    re("\\bwe\\s+realize\\b"),
    re("\\bwe\\s+(feel|know|see|understand)\\b"),
  ],
};
