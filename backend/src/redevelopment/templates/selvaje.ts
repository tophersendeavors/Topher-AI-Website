// The SELVAJE template — the canonical instance of the framework.
//
// Every SELVAJE-specific constant that used to live inline in
// validators.ts / r6GuardrailsAgent.ts / RedevelopmentPage.tsx is
// re-homed here. The existing inline constants stay in place as a
// transition aid; validators and agents read from this template going
// forward, and the inline copies can be removed once every call site
// migrates.
//
// IMPORTANT: behavior here MUST match the pre-refactor SELVAJE
// behavior bit-for-bit. The R8 plan currently sits at 11/0 and the R9
// pipeline is in production — neither can regress from this refactor.

import type {
  RedevProjectTemplate,
  RedevTemplateR6Overlay,
} from "./types.js";
import { re } from "./shared.js";

export const SELVAJE_TEMPLATE: RedevProjectTemplate = {
  templateId: "selvaje",
  templateName: "SELVAJE",
  templateTagline:
    "Prestige series — Surrender engine, Protocol modules, locked Paul/Elena/Solano reveals.",
  projectFormat: "series",

  brief: {
    defaults: {
      whatChanged:
        "The series engine has changed. SELVAJE is no longer 'broken people attend an unconventional healing retreat.' It is now: 'People arrive at Selvaje with avoidance strategies, and the Protocol systematically removes every place they have left to hide.' Every scene should put pressure on a character's avoidance strategy until truth becomes unavoidable. The body reveals what the mind avoids.",
      audiencePromise:
        "There is something you don't understand yet, and when you finally understand it, everything changes. The audience should constantly reassess what they believe about each character and about Selvaje itself.",
      newCorePrinciple:
        "The Protocol does not uncover secrets. The Protocol destroys avoidance.",
      systemPhilosophy:
        "The body reveals what the mind avoids. People do not lie primarily in speech — they lie in behavior. The Protocol does not ask 'How do you feel?' It asks, 'What do you do?' The Protocol attacks the strategy, not the wound. Cliffhangers come from what the exercises reveal, not from the exercises themselves.",
      newSeasonQuestion:
        "What if the danger of telling the truth is not exposure, but accountability?",
      primaryMystery: "What is Selvaje really doing to people?",
      secondaryMystery:
        "What happened to Nadia's sister Elena? (Move this into the pilot's DNA — not a late subplot. The eventual possibility: Elena may not have been taken. Elena may have chosen Selvaje. Elena may have stayed voluntarily.)",
      characterAnchorRule:
        "Solano is not a fraud. Solano is not a cult leader. The Protocol actually works. The danger is not deception — the danger is truth. Solano is unsettling because she is certain, not because she is evil. She may be the only person at Selvaje who is not lying.",
      forbiddenTones:
        "No hypnosis. No magic. No supernatural visions. No generic therapy conversations. No cheap thriller twist. No Solano-as-fraud framing. No therapy-circle exposition.",
      mustNotChange:
        "Solano is not a fraud and not a cult leader. The Protocol actually works. Do not turn this into a thriller about exposing a con. The danger is truth, not deception.",
      targetsForRedevelopment:
        "Character bibles for Margot, Dean, Nadia, Claire, Paul, Dr. Izel Solano. Protocol module engine (10 modules). Season One arc (8 episodes). Pilot Episode 1 rewrite strategy (last).",
    },
  },

  cast: {
    seeds: [
      {
        name: "Margot Ellison",
        seed:
          "Hides in analysis. Must learn to feel. Her daughter knew she was loved — the person who cannot forgive Margot is Margot.",
      },
      {
        name: "Dean Carrera",
        seed:
          "Hides in usefulness. Performed success. Must learn to be still without performing.",
      },
      {
        name: "Nadia Reyes",
        seed:
          "The missing woman is her sister Elena. Investigation is personal and embodied, not procedural. Hides obsession behind professionalism. Has hidden Elena even from the audience until late.",
      },
      {
        name: "Claire Beaumont",
        seed:
          "Hides in caretaking — orients toward distress before it shows. Likable, never suspicious. Ritualized private grief over Marcus that the room never names.",
      },
      {
        name: "Paul Beaumont",
        seed:
          "Half-says things. Avoids notification chimes. Avoidance has cost him visibly. The texting / accident reveal lands LATE — pilot plants unease only.",
      },
      {
        name: "Dr. Izel Solano",
        seed:
          "Hides nothing. That is why she is dangerous. May be the only person at Selvaje who is not lying. Unsettling because she is certain, not because she is evil.",
      },
    ],
    requiredInModules: [
      "Margot Ellison",
      "Dean Carrera",
      "Nadia Reyes",
      "Claire Beaumont",
      "Paul Beaumont",
    ],
  },

  storyEngine: {
    engineName: "Surrender",
    engineDescription:
      "Surrender is the pilot's foundational Protocol module — participants give up their personal tools (phones, recorders, notebooks, jewelry, photographs) into a transparent case. The engine removes the places characters have left to hide. After Surrender, every behavior must come from the body, not the props.",
    moduleNoun: "Protocol Module",
    moduleNounPlural: "Protocol Modules",
  },

  // -----------------------------------------------------------------
  // Locked reveals — facts the pilot must NOT surface.
  // -----------------------------------------------------------------
  protectedReveals: [
    {
      id: "paul_accident",
      label: "Paul's accident responsibility / texting / timestamp / guilt",
      promptLine:
        "Do NOT reveal Paul's texting / accident responsibility / timestamp evidence / guilt. The reveal lands LATE in the season; the pilot plants UNEASE only — avoidance of phone chimes, half-said sentences, a body that flinches when no one is speaking.",
      forbiddenPatterns: [
        re("\\bpaul\\b[^.]{0,80}\\b(texting|texts|texted)\\b"),
        re("\\b(reveal|expose|admit|confess)\\b[^.]{0,40}\\b(accident|timestamp|guilt)"),
        re("\\bpaul'?s?\\s+guilt\\b"),
        re("\\btimestamp\\s+evidence\\b"),
        re("\\bpaul\\b[^.]{0,40}\\b(killed|caused|responsible)\\b"),
        re("\\bshow\\s+the\\s+message\\b"),
      ],
      tone: "warning",
    },
    {
      id: "elena_sister",
      label: "Elena is Nadia's sister",
      promptLine:
        "Do NOT reveal that Elena is Nadia's sister. Elena may be planted in the pilot — but only as an absence, an unlabeled file, a name on a staff board, a photograph the camera lingers on. The sister relationship lands later in the season.",
      forbiddenPatterns: [
        re("\\belena\\b[^.]{0,60}\\b(is|was)\\b[^.]{0,40}\\b(nadia'?s?\\s+)?sister\\b"),
        re("\\bnadia'?s?\\s+sister\\b"),
        re("\\b(reveal|name|expose)\\b[^.]{0,40}\\bsister\\b[^.]{0,30}\\belena\\b"),
        re("\\bmy\\s+sister\\b[^.]{0,30}\\belena\\b"),
        re("\\bphoto\\s+of\\s+elena\\b"),
      ],
      tone: "warning",
    },
    {
      id: "margot_cass",
      label: "Cass / Margot's loss",
      promptLine:
        "Do NOT name Cass. Do NOT name Margot's loss in dialogue or action lines. The emotional anchor is filmable behavior only — a hand that hesitates over the unlabeled file, fingertips that smooth a corner, breath caught for one beat. No grief speech.",
      forbiddenPatterns: [
        re("\\bcass\\b"),
        re("\\bmargot'?s?\\s+(son|daughter|child|kid|baby)\\b"),
        re("\\bthe\\s+(son|daughter|child)\\s+she\\s+lost\\b"),
        re("\\bgrief\\s+speech\\b"),
        re("\\bmonologue\\s+about\\s+(her\\s+)?loss\\b"),
      ],
      tone: "warning",
    },
  ],

  forbiddenFramings: [
    {
      id: "solano_fraud",
      label: "Solano-as-fraud / cult / con / manipulator",
      promptLine:
        "Do NOT frame Solano as fraud / cult / con / liar / manipulator. The Protocol works. Solano is unsettling because she is certain, not because she is evil. The danger is truth, not deception.",
      forbiddenPatterns: [
        re("\\bsolano\\b[^.]{0,80}\\b(fraud|liar|fake|con\\b|cult|deceiv|manipulat|lying)"),
        re("\\bframe\\s+solano\\b"),
        re("\\b(reveal|expose|prove)\\b[^.]{0,40}\\bsolano\\b[^.]{0,40}\\bnot\\b"),
      ],
    },
    {
      id: "archive_younger_version",
      label: "Archive 'younger version of someone' resemblance clue",
      promptLine:
        "The archive room's visual mystery must rely on photos, files, removed frames, or covered shelving — NEVER on a 'younger version of someone' resemblance clue.",
      forbiddenPatterns: [
        re("\\byounger\\s+version\\s+of\\b"),
        re("\\blooks?\\s+like\\s+a\\s+younger\\b"),
        re("\\bresemblance\\s+to\\s+\\w+\\b"),
        re("\\b(could\\s+be|might\\s+be)\\s+her\\s+(sister|mother|daughter)\\b"),
      ],
    },
  ],

  requiredPlants: [
    {
      id: "transparent_case",
      label: "Transparent case (closing block)",
      presencePatterns: [re("\\btransparent\\s+case\\b")],
      location: "tail",
    },
    {
      id: "archive_room",
      label: "Archive room",
      presencePatterns: [re("\\barchive\\s+room\\b"), re("\\barchive\\s+wall\\b")],
      location: "anywhere",
    },
    {
      id: "photograph_wall",
      label: "Photograph wall",
      presencePatterns: [
        re("\\bphotograph\\s+wall\\b"),
        re("\\bwall\\s+of\\s+(participant\\s+)?photos?\\b"),
      ],
      location: "anywhere",
    },
    {
      id: "common_room",
      label: "Common room",
      presencePatterns: [re("\\bcommon\\s+room\\b")],
      location: "anywhere",
    },
  ],

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
      id: "confession_circles",
      label: "Confession circles",
      promptLine: "Do NOT introduce confession circles.",
      forbiddenPatterns: [re("\\bconfession\\s+circle\\b")],
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
    label: "Transparent case + Paul chime hook",
    anchors: [
      {
        id: "bodies_after_surrender",
        label: "Bodies after Surrender",
        patterns: [re("\\bbodies\\b"), re("\\bafter\\s+surrender\\b")],
      },
      {
        id: "transparent_case",
        label: "Transparent case",
        patterns: [re("\\btransparent\\s+case\\b")],
      },
      {
        id: "paul_chime",
        label: "Paul + chime / notification",
        patterns: [
          re("\\b(chime|notification|phone)\\b.{0,80}\\bpaul\\b"),
          re("\\bpaul\\b.{0,80}\\b(chime|notification|phone)\\b"),
        ],
      },
    ],
    requiredAnchorCount: 2,
    scanLocation: "tail",
  },

  metaNarrationPatterns: [
    re("\\bthe\\s+audience\\s+(feels?|knows?|sees?|understands?|reads?)"),
    re("\\bthe\\s+room\\s+(knows?|understands?)"),
    re("\\bthe\\s+body\\s+(knows?|understands?)"),
    re("\\bthe\\s+wound\\s+(is|sits|lives|remains|stays)"),
    re("\\bthe\\s+avoidance\\s+strategies?\\b"),
    re("\\bthe\\s+system\\s+(is|was|remains|stays)\\s+\\w+ing\\b"),
    re("\\bthe\\s+system\\s+is\\s+running\\b"),
    re("\\bwhat\\s+this\\s+means\\s+is\\b"),
    re("\\bwe\\s+realize\\b"),
    re("\\bwe\\s+(feel|know|see|understand)\\b"),
  ],

  uiLabels: {
    r3_protocol_modules: "Protocol Modules",
  },
};

/** SELVAJE R6 overlay — the per-character contracts + global rule the
 *  R6 guardrails agent applies when the brief reads as SELVAJE. Lifted
 *  out of `r6GuardrailsAgent.ts` so future templates can declare their
 *  own. */
export const SELVAJE_R6_OVERLAY: RedevTemplateR6Overlay = {
  globalRule:
    "No flashbacks, no confession circles, no therapy exposition, no cheap " +
    "thriller twist, no Solano-as-fraud framing, no Paul accident reveal, " +
    "no Elena-sister reveal. The pilot's engine is Surrender. End with the " +
    "blended Option A + C hook: bodies after Surrender, then the transparent " +
    "case, then Paul's body responding to the notification chime.",
  architecturalPlants: [
    "Archive room with the photograph wall and labeled participant files",
    "Common room with the transparent case (where surrendered items live)",
    "Photograph wall (participant photos in identical frames, one removed frame leaving a brighter rectangle)",
    "Transparent case in the closing block (camera lingers on the case before the chime)",
    "Notification chime as the closing sound cue (no shown message, no shown phone screen detail)",
    "Casitas (private quarters) where private rituals happen out of group view",
    "Thermal pools (dusk) — a public-but-quiet space for restrained character beats",
    "Canopy walk — a public space for observation-only beats; no exposition allowed",
  ],
  characterContracts: [
    {
      characterName: "Paul Beaumont",
      plants: [
        "Body responds to notification chimes (flinch / pause / breath caught)",
        "Half-says sentences and lets them trail off",
        "Avoidance of phones / chimes is visible BUT the cause is not named",
      ],
      doNotReveal: [
        "Paul was texting at the time of the accident",
        "Paul's timestamp evidence",
        "Paul's accident responsibility",
        "Paul's guilt",
      ],
      doNotDo: [
        "have anyone confront Paul about the accident",
        "make Paul visibly suspicious",
        "name what Paul is hiding in dialogue",
        "show a phone screen revealing the message",
      ],
      executionRule:
        "Execute UNEASE only. Paul's body knows; the audience suspects; the dialogue never lands the fact.",
      plantDetectionPatterns: [
        re(
          "\\bpaul\\b[^.]{0,200}\\b(chime|notification|phone|flinch|trail|half|silence|caretaking)"
        ),
      ],
    },
    {
      characterName: "Margot Ellison",
      plants: [
        "Recorder, notebook, files — diagnostic observation",
        "Analyzes before feeling",
        "Reads the room professionally; clinical / forensic posture",
      ],
      doNotReveal: [
        "Cass (Margot's daughter's name)",
        "The daughter's death (only Margot's avoidance shows)",
        "Margot's specific guilt or self-narrative about her daughter",
      ],
      doNotDo: [
        "have anyone ask Margot about her daughter",
        "let Margot articulate her wound in dialogue",
        "let any character name Margot's loss",
      ],
      executionRule:
        "Margot's wound is INTERNAL ARCHITECTURE. The pilot shows her professional armor; the loss surfaces only via avoidance, never via speech.",
      plantDetectionPatterns: [
        re(
          "\\bmargot\\b[^.]{0,200}\\b(analy|diagnos|profess|read(s|ing)?\\s+the\\s+room|clinic|forensic|recorder|notebook|notes\\b|chart|field\\s*note)"
        ),
      ],
    },
    {
      characterName: "Nadia Reyes",
      plants: [
        "Scans rooms, studies staff boards, notices photograph wall, tracks Solano",
        "Investigation is personal AND embodied — no procedural exposition",
        "Notices Elena (as absence / file / photograph) without naming the relationship",
      ],
      doNotReveal: [
        "That Elena is Nadia's sister",
        "Why Nadia came to Selvaje",
      ],
      doNotDo: [
        "make Nadia explicitly question staff about Elena",
        "let any character name Nadia's relationship to Elena",
        "have Nadia confess her purpose in dialogue",
      ],
      executionRule:
        "Nadia's investigation reads as personal before the audience understands why. Body language and attention patterns do the work, not dialogue.",
      plantDetectionPatterns: [
        re(
          "\\bnadia\\b[^.]{0,300}\\b(archive|records|elena|photograph|staff\\s+board|search|scan|notice|attentive|tracking|tracks|investigat|looking)"
        ),
      ],
    },
    {
      characterName: "Claire Beaumont",
      plants: [
        "Ritualized private grief over Marcus that the room never names",
        "Orients toward distress before it shows — caretaking instinct toward Paul especially",
        "An instinctive caretaking gesture toward Paul (the kind that wears them both down)",
      ],
      doNotReveal: [
        "What happened to Marcus directly in dialogue",
        "The exact nature of Claire's grief",
      ],
      doNotDo: [
        "have Claire speak about Marcus in the pilot",
        "make the grief explicit; show only the ritual",
      ],
      executionRule:
        "Claire's grief is ritual and silence. She is the likable one — never suspicious, never explanatory.",
      plantDetectionPatterns: [
        re(
          "\\bclaire\\b[^.]{0,200}\\b(fold|careful|ritual|paul|caretaking|orient|distress|gentle|private|grief|marcus)"
        ),
      ],
    },
    {
      characterName: "Dean Carrera",
      plants: [
        "Orients toward distress before it shows; performs usefulness",
        "Refills drinks, manages the room with charm",
        "Likable; never suspicious; performed success",
      ],
      doNotReveal: [
        "The full extent of Dean's avoidance strategy in dialogue",
      ],
      doNotDo: [
        "have Dean explain his performance",
        "let Dean's strategy be named by another character",
      ],
      executionRule:
        "Dean is the charming usefulness machine. The cost of the performance shows only at the edges.",
      plantDetectionPatterns: [
        re(
          "\\bdean\\b[^.]{0,200}\\b(refill|orient|charm|usef|perform|distress|manag|host|drinks?|attentive)"
        ),
      ],
    },
  ],
};
