// EP02 "Ashes" — Production Department step.
//
// This driver does the NON-LLM portion of the EP02 pipeline that was
// missing: seed Maya's Living Room location bible, seed six prop bibles
// (mantle, ceramic urn, fake ashes / aquarium gravel, Daniel's phone,
// death certificate, drawer beneath mantle, hallway, bedroom wall),
// patch the 15 existing briefs with Hero Image / Shot Priority metadata
// for the prop-insert shots, re-classify their fieldConfidence against
// the V3.6 widened source corpus, and run the heuristic continuity pass.
//
// What this does NOT do:
//   • Does not re-run any LLM extractor (cast / location / brief gen).
//     Maya + Daniel are reused as-is per the user's instruction.
//   • Does not regenerate any prompt. The existing 15 prompts stand.
//   • Does not touch EP01, EP03, or any other episode.
//
// Idempotent. Safe to re-run.

import { supabase } from "../src/db/client.js";
import { normalizeKey, type LocationBible, type PropBible } from "../src/continuity/types.js";
import { runContinuityPass } from "../src/continuity/validator.js";
import { classifyBriefFields } from "../src/draft/aiPrompts/briefStrict.js";
import {
  buildProjectBiblesCorpus,
  joinSourceCorpus,
} from "../src/draft/aiPrompts/sourceCorpus.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP02_SCRIPT_ID = "dc5cf7d7-7a4f-47cf-b4e2-0cabcb36f7ce";

// ===========================================================================
// 1. LOCATION BIBLE — INT. MAYA'S LIVING ROOM
// ===========================================================================

const LIVING_ROOM: LocationBible = {
  name: "INT. MAYA'S LIVING ROOM - 3:14 AM",
  layout:
    "Maya's living room at 3:14 AM. A mantle dominates one wall. The ceramic urn sits center-mantle, cracked at its base. A drawer is built into the wall beneath the mantle, holding paperwork including the death certificate. A short hallway leads from the living room toward the bedroom; only its mouth is visible from this room. The room is dark, lit primarily by stray ambient and, later, the cold blue-white glow of a phone screen rising from the urn.",
  furniture: [
    {
      name: "Mantle",
      position: "back wall of the living room, center-frame",
      orientation: "fireplace mantle, shelf depth, edge facing camera",
      locked: true,
    },
    {
      name: "Drawer beneath mantle",
      position: "directly below the mantle shelf, built into the wall",
      orientation: "opens outward toward Maya",
      locked: true,
    },
    {
      name: "Hallway entrance",
      position: "off to the side of the living room, leading toward the bedroom",
      orientation:
        "dark opening; the audience sees down it from Maya's POV, never the other direction",
      locked: true,
    },
    {
      name: "Bedroom wall (shared with living room)",
      position: "wall between living room and bedroom — knock source",
      orientation: "vertical wall surface; knocks come from INSIDE the wall",
      locked: true,
    },
  ],
  props: [
    {
      name: "Ceramic urn",
      position: "center of the mantle",
      orientation: "upright, cracked seam visible at base, lid still seated",
      locked: true,
    },
    {
      name: "Death certificate",
      position: "inside the drawer beneath the mantle",
      orientation: "flat, single page; folded once",
      locked: false,
    },
    {
      name: "Aquarium gravel (fake ashes)",
      position: "inside the urn, beneath the lid",
      orientation: "loose pebbles; reads as ashes only at glance",
      locked: true,
    },
    {
      name: "Daniel's phone",
      position: "buried inside the aquarium gravel in the urn",
      orientation: "screen-up under the gravel, warm to the touch",
      locked: true,
    },
  ],
  doors: [],
  windows: [],
  cameraSafeAngles: [
    {
      label: "low-angle macro on the urn",
      description:
        "Camera at mantle-height looking up at the cracked urn against the dark wall.",
    },
    {
      label: "over-the-shoulder from behind Maya at the mantle",
      description:
        "Camera behind Maya as she stands at the mantle; we see her hands and the urn.",
    },
    {
      label: "drawer-level macro",
      description:
        "Camera low and tight on the drawer beneath the mantle as it opens or as the certificate emerges.",
    },
    {
      label: "from inside the urn looking up",
      description:
        "Macro POV from inside the urn as the lid lifts and a hand enters — extreme low.",
    },
    {
      label: "from Maya's POV down the hallway",
      description:
        "Camera at Maya's eye height looking down the dark hallway toward the bedroom — empty.",
    },
    {
      label: "on the wall surface, ECU",
      description:
        "Extreme close-up of the bedroom wall as knocks arrive; dust falls.",
    },
  ],
  forbiddenAngles: [
    {
      label: "from inside the bedroom looking out toward Maya",
      description:
        "Reversed hallway POV — looking from inside the bedroom out toward the living room. The story stays on Maya's side; the bedroom is unseen this episode.",
    },
    {
      label: "wide establishing of the whole house",
      description: "Top-down or wide establishing of the floor plan. Not in EP02's vocabulary.",
    },
    {
      label: "mantle flipped to the opposite wall",
      description:
        "Mantle on the right wall instead of the back wall. Locked: back wall only.",
    },
  ],
  eyelineRules: [
    "Maya never looks into the camera lens.",
    "Maya's eyeline tracks the urn, the drawer, the certificate, the gravel, the phone in her palm, or the hallway mouth — always motivated.",
    "When the phone screen lights from her palm, Maya looks down at the screen, never up at the lens.",
    "When the knocks arrive from the wall, Maya looks toward the hallway / wall, never at camera.",
    "Daniel is not visually present anywhere in EP02. No body, no face, no silhouette, no reflection.",
  ],
  lightingSources: [
    {
      name: "Ambient living room",
      color: "deep desaturated near-black with cool blue undertone",
      direction: "fill from off-screen window, very low intensity",
      intensity: "minimal; gives shape without legibility",
    },
    {
      name: "Phone glow",
      color: "cold blue-white",
      direction:
        "rises from the urn / Maya's palm once the screen ignites; uplight",
      intensity: "dominant once active; underlights Maya's face from below",
    },
  ],
  continuityAnchors: [
    "mantle on back wall",
    "ceramic urn at center of mantle",
    "drawer directly beneath mantle",
    "hallway off-room leading to bedroom",
    "Daniel's phone buried in aquarium gravel inside the urn",
    "no visible bedroom interior",
    "Maya does not look into camera",
  ],
  doNotFlip: true,
  continuityPrompt: [
    "MAYA'S LIVING ROOM — LOCKED GEOMETRY (do not invent variations):",
    "Mantle on the back wall, center-frame. Cracked ceramic urn at center.",
    "Drawer built into the wall directly beneath the mantle. Hallway leads",
    "off to the bedroom but its interior is never shown. Only practical",
    "light is the cold blue-white phone glow once Daniel's phone ignites.",
    "Do not flip the room. Maya never looks into the lens.",
  ].join(" "),
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ===========================================================================
// 2. PROP BIBLES
// ===========================================================================

const PROP_MANTLE: PropBible = {
  name: "Mantle",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Center of the back wall, ceramic urn sitting on it.",
  endsAt: "Unchanged across EP02; the urn and ashes are disturbed but the mantle is not moved.",
  orientation: "Shelf edge faces camera; back wall behind.",
  handledBy: [],
  visualDetails:
    "Dark wood / painted wood mantle, mid-depth shelf, faint dust along the edge. Practical-only finish, not stylised.",
  episodesPresent: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Mantle is on the back wall, not a side wall.",
    "Mantle holds the urn at center; not a side of the shelf.",
    "Mantle is one practical piece; no symmetrical-decoration props added (no candles, no photos).",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_URN: PropBible = {
  name: "Ceramic urn",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Center mantle, cracked at base, lid seated.",
  endsAt: "Lid removed by Maya; cracked base remains.",
  orientation: "Upright; cracked seam visible at base, runs vertically.",
  handledBy: ["MAYA"],
  visualDetails:
    "Pale ceramic urn with a dark, hairline crack running up from the base. Lid is matched ceramic. Surface dust visible. The crack reads as old, not fresh.",
  episodesPresent: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Crack stays at the base, vertical seam — not at the lid.",
    "Urn is ceramic (matte), not glass / metal.",
    "Urn must read as a funeral urn, not a generic decorative vessel.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_GRAVEL: PropBible = {
  name: "Aquarium gravel (fake ashes)",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Filling the inside of the urn beneath the lid.",
  endsAt: "Disturbed by Maya's hand; phone pulled from beneath.",
  orientation: "Loose pebbles; multi-grey, sized as small aquarium gravel.",
  handledBy: ["MAYA"],
  visualDetails:
    "Polished multi-grey pebbles approximately 3-6mm. At a glance reads as cremated ashes (it isn't — that's the reveal). Slight glassy sheen on individual pebbles when light hits them directly.",
  episodesPresent: [2],
  doNotChange: [
    "Reads as ashes at the macro establishing shot.",
    "Once disturbed, the polish on individual pebbles betrays it as gravel — not ash dust.",
    "Color stays grey-grey-black; never warm brown.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_DANIELS_PHONE: PropBible = {
  name: "Daniel's phone",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Buried inside the aquarium gravel, inside the cracked urn.",
  endsAt:
    "In Maya's palm; screen ignites showing 3:17 AM and the verbatim message: \"Don't open the closet again.\"",
  orientation:
    "Screen-up when buried; when lifted, lock-screen orientation matches Maya's palm.",
  handledBy: ["MAYA"],
  visualDetails:
    "Modern iPhone in a dark case, slightly warm to the touch (per the screenplay). Cold blue-white screen glow on ignite. Lock-screen UI is iPhone dark mode. Verbatim screen text MUST render exactly: top line clock 3:17 AM; notification banner reads 'Don't open the closet again.' No fake apps, no extra notifications.",
  episodesPresent: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Phone is iPhone, dark mode UI.",
    "Verbatim notification text: \"Don't open the closet again.\" — render exactly.",
    "Timestamp on the screen reads 3:17 AM.",
    "Phone reads as Daniel's — not Maya's everyday phone.",
    "No fake apps, no other notifications visible.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_DEATH_CERTIFICATE: PropBible = {
  name: "Death certificate",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Inside the drawer beneath the mantle.",
  endsAt: "Set down by Maya after she reads the funeral-director name + P.O. box address.",
  orientation: "Single sheet, folded once; opens horizontally.",
  handledBy: ["MAYA"],
  visualDetails:
    "Standard death certificate paper — pale grey, official letterhead. Funeral-director NAME visible at the bottom (legible). Address line reads ONLY 'P.O. Box ###' — no street, no city detail.",
  episodesPresent: [2],
  doNotChange: [
    "Address line is a P.O. box number only — never a street address.",
    "Funeral-director name is legible at the bottom.",
    "Paper is plain, not theatrical / heavily stamped.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_DRAWER: PropBible = {
  name: "Drawer beneath mantle",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Closed, in the wall directly below the mantle.",
  endsAt: "Open; certificate removed.",
  orientation: "Opens outward toward Maya; pull is at the top center.",
  handledBy: ["MAYA"],
  visualDetails:
    "Wooden drawer built into the wall under the mantle. Inside: the folded death certificate is the only legible item.",
  episodesPresent: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Drawer is built into the wall — not a freestanding piece.",
    "Drawer is directly beneath the mantle.",
    "Contents at this scene are: the death certificate. Other contents stay non-specific.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_HALLWAY: PropBible = {
  name: "Bedroom hallway",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Empty mouth visible from the living room.",
  endsAt:
    "Still empty. The closet/bedroom interior is NEVER visible in EP02.",
  orientation:
    "Hallway runs perpendicular to the back wall; Maya looks down it, never the reverse.",
  handledBy: [],
  visualDetails:
    "Short dark hallway with one open wall on the left. The end is unlit; depth drops to total black. No figure, no movement, no door silhouette.",
  episodesPresent: [2, 3, 4, 5],
  doNotChange: [
    "Hallway is shown from the living-room side only — never the bedroom side.",
    "Hallway end stays unlit / black — no detail visible.",
    "Closet door, bed, or any bedroom prop is NOT visible from this angle.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_WALL_KNOCK: PropBible = {
  name: "Bedroom wall knock",
  homeLocation: LIVING_ROOM.name,
  startsAt: "Silent wall surface.",
  endsAt:
    "Three slow knocks from inside the wall; visible only as faint vibration + dust falling from the wall surface.",
  orientation:
    "Knocks originate INSIDE the bedroom wall; vibration travels through the shared surface.",
  handledBy: [],
  visualDetails:
    "Plain painted wall, slight texture. Knock visuals: a faint vibration shimmer at the surface + a few specks of dust falling. NO visible fist, NO visible hand, NO figure on either side of the wall.",
  episodesPresent: [2, 4, 6, 8],
  doNotChange: [
    "Knocks come from INSIDE the bedroom wall.",
    "No fist, no hand, no figure visible on either side.",
    "Visible cue is vibration + falling dust only.",
    "Sound design implies three slow knocks; visual matches that cadence.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ===========================================================================
// 3. Hero Image / Shot Priority — per-shot prop-insert metadata for EP02
// ===========================================================================

interface ShotPriorityPatch {
  shot: number;
  heroSubject: string;
  forbiddenDominantDetails: string[];
  addProps: string[];
}
const SHOT_PRIORITY: ShotPriorityPatch[] = [
  // SH1  — establishing cracked urn
  {
    shot: 1,
    heroSubject: "urn",
    forbiddenDominantDetails: ["mantle", "wall", "shelf", "room"],
    addProps: ["urn", "mantle"],
  },
  // SH2  — fingertips on the urn crack
  {
    shot: 2,
    heroSubject: "crack",
    forbiddenDominantDetails: ["mantle", "wall", "shelf"],
    addProps: ["urn"],
  },
  // SH3  — death certificate from drawer
  {
    shot: 3,
    heroSubject: "certificate",
    forbiddenDominantDetails: ["drawer", "mantle", "room"],
    addProps: ["death certificate", "drawer"],
  },
  // SH4  — fingertip on the funeral-director name
  {
    shot: 4,
    heroSubject: "name",
    forbiddenDominantDetails: ["certificate", "paper", "drawer"],
    addProps: ["death certificate"],
  },
  // SH5  — P.O. box address line
  {
    shot: 5,
    heroSubject: "address",
    forbiddenDominantDetails: ["certificate", "paper", "drawer"],
    addProps: ["death certificate"],
  },
  // SH6  — Maya's face, staring at urn (character shot, no hero override)
  // SH7  — prying lid off the urn
  {
    shot: 7,
    heroSubject: "lid",
    forbiddenDominantDetails: ["urn", "mantle", "shelf"],
    addProps: ["urn"],
  },
  // SH8  — hand into aquarium gravel
  {
    shot: 8,
    heroSubject: "gravel",
    forbiddenDominantDetails: ["urn", "hand", "mantle"],
    addProps: ["gravel", "urn"],
  },
  // SH9  — phone rising out of gravel
  {
    shot: 9,
    heroSubject: "phone",
    forbiddenDominantDetails: ["gravel", "hand", "urn"],
    addProps: ["phone", "gravel"],
  },
  // SH10 — Maya's face turning phone (character shot)
  // SH11 — phone screen ignites, 3:17 AM
  {
    shot: 11,
    heroSubject: "screen",
    forbiddenDominantDetails: ["phone", "hand", "room"],
    addProps: ["phone"],
  },
  // SH12 — notification text "Don't open the closet again."
  {
    shot: 12,
    heroSubject: "message",
    forbiddenDominantDetails: ["phone", "screen", "hand"],
    addProps: ["phone"],
  },
  // SH13 — Maya's face lit from below (character shot)
  // SH14 — hallway POV
  {
    shot: 14,
    heroSubject: "hallway",
    forbiddenDominantDetails: ["wall", "doorway", "room"],
    addProps: ["hallway"],
  },
  // SH15 — three knocks on the wall, dust falling
  {
    shot: 15,
    heroSubject: "wall",
    forbiddenDominantDetails: ["hallway", "room", "shadow"],
    addProps: ["wall"],
  },
];

// ===========================================================================
// Driver
// ===========================================================================

async function main() {
  console.log("═══ EP02 \"Ashes\" — Production Department step ═══\n");

  // ---- 1. Seed bibles ----
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", PROJECT_ID)
    .single();
  const projMeta = (proj?.metadata as Record<string, unknown>) ?? {};
  const locationBibles =
    (projMeta.locationBibles as Record<string, LocationBible>) ?? {};
  const propBibles = (projMeta.propBibles as Record<string, PropBible>) ?? {};
  locationBibles[normalizeKey(LIVING_ROOM.name)] = LIVING_ROOM;
  const allProps = [
    PROP_MANTLE,
    PROP_URN,
    PROP_GRAVEL,
    PROP_DANIELS_PHONE,
    PROP_DEATH_CERTIFICATE,
    PROP_DRAWER,
    PROP_HALLWAY,
    PROP_WALL_KNOCK,
  ];
  for (const p of allProps) propBibles[normalizeKey(p.name)] = p;
  projMeta.locationBibles = locationBibles;
  projMeta.propBibles = propBibles;
  await supabase
    .from("projects")
    .update({ metadata: projMeta })
    .eq("id", PROJECT_ID);
  console.log(
    `1. Bibles seeded — locations: ${Object.keys(locationBibles).length}, props: ${Object.keys(propBibles).length}`
  );
  console.log(`   • NEW LOCATION: ${LIVING_ROOM.name}`);
  console.log(`   • NEW PROPS: ${allProps.map((p) => p.name).join(", ")}`);

  // ---- 2. Patch EP02 briefs with Hero Image / Shot Priority + props ----
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP02_SCRIPT_ID)
    .single();
  if (!scriptRow) throw new Error("EP02 script not found");
  const sMeta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const ai = (sMeta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[1] as Record<string, unknown>) ?? {};
  for (const patch of SHOT_PRIORITY) {
    const b = sceneBriefs[patch.shot] as Record<string, unknown> | undefined;
    if (!b) {
      console.log(`   (skip) SH${patch.shot} not in briefs`);
      continue;
    }
    b.heroSubject = patch.heroSubject;
    b.forbiddenDominantDetails = patch.forbiddenDominantDetails;
    const existingProps = Array.isArray(b.props) ? (b.props as string[]) : [];
    b.props = Array.from(new Set([...existingProps, ...patch.addProps]));
    if (!Array.isArray(b.shotTags) || (b.shotTags as string[]).length === 0) {
      b.shotTags = ["INSERT", "OBJECT"];
    }
    if (!b.cameraAwareness) b.cameraAwareness = "observational_default";
    const ue = Array.isArray(b.userEditedFields)
      ? (b.userEditedFields as string[])
      : [];
    for (const f of [
      "heroSubject",
      "forbiddenDominantDetails",
      "props",
      "shotTags",
      "cameraAwareness",
    ]) {
      if (!ue.includes(f)) ue.push(f);
    }
    b.userEditedFields = ue;
    b.updatedAt = new Date().toISOString();
  }
  // ---- 3. Re-classify EVERY brief in EP02 against widened corpus -------
  const { data: scene } = await supabase
    .from("script_scenes")
    .select("slugline, fountain")
    .eq("script_id", EP02_SCRIPT_ID)
    .eq("ord", 1)
    .single();
  const { data: projRow } = await supabase
    .from("projects")
    .select("title, tone, showrunner_notes")
    .eq("id", PROJECT_ID)
    .single();
  const bibles = await buildProjectBiblesCorpus(PROJECT_ID);
  const screenplayBase = [
    (scene?.fountain as string) ?? "",
    (scene?.slugline as string) ?? "",
    ((projRow?.tone as string[] | null) ?? []).join(" "),
    (projRow?.showrunner_notes as string | null) ?? "",
  ].join("\n");
  const corpus = joinSourceCorpus(screenplayBase, bibles);
  let totalBefore = 0;
  let totalAfter = 0;
  const perShotReclassify: Array<{ shot: number; before: number; after: number }> = [];
  for (const shotKey of Object.keys(sceneBriefs)) {
    const b = sceneBriefs[shotKey] as Record<string, unknown>;
    const beforeFc = (b.fieldConfidence as Record<string, string> | undefined) ?? {};
    const beforeFlagged = Object.values(beforeFc).filter(
      (v) => v === "conservative_inference" || v === "speculative"
    ).length;
    const { fieldConfidence } = classifyBriefFields(
      b as Parameters<typeof classifyBriefFields>[0],
      corpus
    );
    b.fieldConfidence = fieldConfidence;
    const afterFlagged = Object.values(fieldConfidence as Record<string, string>).filter(
      (v) => v === "conservative_inference" || v === "speculative"
    ).length;
    totalBefore += beforeFlagged;
    totalAfter += afterFlagged;
    perShotReclassify.push({
      shot: Number(shotKey),
      before: beforeFlagged,
      after: afterFlagged,
    });
  }
  briefs[1] = sceneBriefs;
  ai.briefs = briefs;
  sMeta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: sMeta })
    .eq("id", EP02_SCRIPT_ID);
  console.log(
    `2. Briefs patched with Hero Image metadata on ${SHOT_PRIORITY.length} insert shots.`
  );
  console.log(
    `3. Re-classified all 15 briefs against widened corpus — fields flagged: ${totalBefore} → ${totalAfter}`
  );

  // ---- 4. Continuity pass ----
  const result = await runContinuityPass(EP02_SCRIPT_ID);
  const { data: scriptRow2 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP02_SCRIPT_ID)
    .single();
  const m2 = (scriptRow2!.metadata as Record<string, unknown>) ?? {};
  m2.continuity = result;
  await supabase.from("scripts").update({ metadata: m2 }).eq("id", EP02_SCRIPT_ID);

  const fails = result.issues.filter((i) => i.severity === "fail").length;
  const warns = result.issues.filter((i) => i.severity === "warning").length;
  console.log(`4. Continuity pass — ${fails} fail / ${warns} warning`);
  if (fails + warns > 0) {
    for (const i of result.issues.slice(0, 40)) {
      const w = i.where;
      const loc = [
        w.sceneOrd != null ? `SC${String(w.sceneOrd).padStart(2, "0")}` : null,
        w.shotIndex != null ? `SH${String(w.shotIndex).padStart(2, "0")}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`   [${i.severity}] [${i.category}] ${loc} — ${i.message}`);
    }
  }

  console.log("\n═══ Done. ═══");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
