// One-shot seed for EP01 continuity infrastructure.
//
// Writes:
//   • Maya's Bedroom Location Bible (per the user-supplied spec)
//   • Prop bibles: phone, clock, closet door, blood smear
//   • Maya: presenceType=visible, cameraGazeAllowed=false
//   • Daniel: presenceType=text_only, cameraGazeAllowed=false
//
// Idempotent. Doesn't touch DNA. Doesn't run the pass — that's a separate
// step the writer triggers (or the runEp01ContinuityPass.ts driver).

import { supabase } from "../src/db/client.js";
import { normalizeKey, type LocationBible, type PropBible } from "../src/continuity/types.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";

const MAYA_BEDROOM: LocationBible = {
  name: "INT. MAYA BEDROOM - NIGHT",
  layout: [
    "Maya's bedroom at 3:17 AM. The bed sits center-left of the frame with",
    "its headboard against the back wall. The nightstand is on Maya's right",
    "side, holding the phone and the digital clock — both facing Maya so",
    "she can see them from the pillow. The closet is across the room from",
    "the bed, directly visible from Maya's sleeping position. The room is",
    "lit only by the cold blue-white glow from the phone and the faint red",
    "glow of the clock.",
  ].join(" "),
  furniture: [
    {
      name: "Bed",
      position: "center-left of the room",
      orientation: "headboard against the back wall, foot toward camera-right",
      locked: true,
    },
    {
      name: "Nightstand",
      position: "Maya's right side, adjacent to bed",
      orientation: "top surface visible to Maya when lying down",
      locked: true,
    },
    {
      name: "Closet",
      position: "across the room from the bed",
      orientation: "doors open inward, directly visible from Maya's bed",
      locked: true,
    },
  ],
  props: [
    {
      name: "Phone",
      position: "on the nightstand, Maya's right side",
      orientation: "screen facing Maya / facing up so she sees it",
      locked: true,
    },
    {
      name: "Digital clock",
      position: "on the nightstand, Maya's right side",
      orientation: "display facing Maya",
      locked: true,
    },
  ],
  doors: [
    {
      name: "Closet door",
      position: "across the room from the bed",
      orientation: "opens inward (into the closet)",
      locked: true,
    },
  ],
  windows: [],
  cameraSafeAngles: [
    {
      label: "from foot of bed",
      description:
        "Camera at the foot of the bed looking up toward the headboard.",
    },
    {
      label: "side-observational from Maya's left",
      description:
        "Camera on Maya's left side at bed-height, observing without facing the lens.",
    },
    {
      label: "over-the-shoulder from beside nightstand",
      description:
        "Camera just behind Maya's right shoulder, looking past her toward the phone / clock.",
    },
    {
      label: "from doorway looking in",
      description:
        "Camera at the bedroom doorway looking in toward the bed.",
    },
    {
      label: "inside-closet POV looking out toward the bed",
      description:
        "Camera placed inside the closet looking outward at Maya in bed across the room.",
    },
  ],
  forbiddenAngles: [
    {
      label: "from behind the closet looking at the back of the closet",
      description:
        "Reversed closet POV — looking AT the back wall of the closet instead of out into the room. Closet POV must look outward.",
    },
    {
      label: "from Maya's right side flipped",
      description:
        "Camera placed where the nightstand should be (Maya's right) facing left as if the bed were on the right side of the room. Bed is center-left; do not flip.",
    },
    {
      label: "ceiling top-down",
      description:
        "Top-down ceiling shot of Maya. Not in EP01's vocabulary.",
    },
  ],
  eyelineRules: [
    "Maya never looks into the camera lens.",
    "Maya's eyeline tracks toward the phone or clock on the nightstand, or toward the closet door across the room.",
    "When the camera is inside the closet, Maya looks toward the closet door (toward camera) without registering it as a camera.",
    "Daniel is not visually present — no face, no body, no silhouette anywhere in the bedroom.",
  ],
  lightingSources: [
    {
      name: "Phone glow",
      color: "cold blue-white",
      direction: "from the nightstand, low and bouncing across Maya's right side",
      intensity: "dominant; the brightest source in the room",
    },
    {
      name: "Clock glow",
      color: "faint red",
      direction: "from the nightstand digital display",
      intensity: "low ambient; reads as red-pinpoint at the clock face",
    },
    {
      name: "Ambient room",
      color: "deep desaturated near-black",
      direction: "none — fills the gaps where phone/clock don't reach",
      intensity: "minimal; everything outside the glow falls into shadow",
    },
  ],
  continuityAnchors: [
    "bed center-left of frame",
    "headboard against back wall",
    "nightstand on Maya's right",
    "phone and clock on the nightstand both facing Maya",
    "closet across the room from the bed",
    "closet visible from Maya's bed",
    "cold blue-white phone glow",
    "faint red clock glow",
  ],
  doNotFlip: true,
  continuityPrompt: [
    "MAYA'S BEDROOM — LOCKED GEOMETRY (do not invent variations):",
    "Bed center-left, headboard against the back wall. Nightstand on Maya's",
    "right with phone (screen facing Maya) and digital clock (display facing",
    "Maya) on top. Closet across the room from the bed, doors visible from",
    "Maya's bed. Only two practical lights: cold blue-white phone glow,",
    "faint red clock glow. Everything outside those falls into shadow. Do",
    "not flip the room. Maya never looks into the lens.",
  ].join(" "),
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_PHONE: PropBible = {
  name: "Maya's phone",
  homeLocation: MAYA_BEDROOM.name,
  startsAt: "On the nightstand, screen-down or face-up, dark.",
  endsAt: "In Maya's hand at the end of EP01 cliffhangers.",
  orientation: "Screen facing Maya when on the nightstand.",
  handledBy: ["MAYA"],
  visualDetails:
    "iPhone in muted dark case. Dark home screen. The only thing the audience reads on it is verbatim text from Daniel's thread (DANIEL · 3:17 AM).",
  episodesPresent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Daniel's name in the thread must render exactly 'DANIEL' in caps.",
    "Timestamp '3:17 AM' must render verbatim.",
    "Phone is iPhone, not Android.",
    "No fake notifications from other apps.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_CLOCK: PropBible = {
  name: "Nightstand clock",
  homeLocation: MAYA_BEDROOM.name,
  startsAt: "On the nightstand, faint red display showing the time.",
  endsAt: "Unchanged.",
  orientation: "Display facing Maya so she can read it from the pillow.",
  handledBy: [],
  visualDetails:
    "Digital alarm clock. Faint red 7-segment LED. Reads 3:17 AM at the inciting moment.",
  episodesPresent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Display faces Maya (and therefore the camera when shot from her POV).",
    "Red glow only — never blue, white, or green.",
    "Reads 3:17 in the inciting beat.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_CLOSET_DOOR: PropBible = {
  name: "Closet door",
  homeLocation: MAYA_BEDROOM.name,
  startsAt: "Ajar by a few inches at start of EP01.",
  endsAt:
    "Slowly opening / opening wider at the EP01 cliffhanger — but no figure visible yet.",
  orientation: "Door opens inward into the closet (away from Maya's bed).",
  handledBy: [],
  visualDetails:
    "Wooden interior door, dark stain. Visible from Maya's bed across the room. When ajar, only deeper darkness is visible inside; no figure, no clothing rack detail.",
  episodesPresent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  doNotChange: [
    "Door opens inward.",
    "When ajar, the inside reads as darker shadow than the room — no figure visible until reveal episode.",
    "Closet is across the room from the bed; do not relocate.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const PROP_BLOOD_SMEAR: PropBible = {
  name: "Blood smear",
  homeLocation: MAYA_BEDROOM.name,
  startsAt:
    "Not visible until the brief explicitly introduces it in EP01 (e.g. on a sheet edge or doorframe).",
  endsAt:
    "Remains visible across shots that include its surface until the next scene/scrub.",
  orientation: "Smear, not splatter — drag direction matters.",
  handledBy: [],
  visualDetails:
    "Small dark-red smear. Should never look like a horror-movie wound; subtle, almost ambiguous in the dim light. Reads dark-red, not bright.",
  episodesPresent: [1],
  doNotChange: [
    "Color stays dark red — never bright crimson.",
    "Smear direction stays consistent across shots within a scene.",
    "Do not introduce the smear before the brief flags it as present.",
  ],
  approved: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function main() {
  console.log("═══ Seeding EP01 continuity bibles ═══\n");

  // 1. Location + Prop bibles → projects.metadata.
  const { data: proj, error: pErr } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", PROJECT_ID)
    .single();
  if (pErr || !proj) {
    console.error("Project load failed:", pErr);
    process.exit(1);
  }
  const meta = (proj.metadata as Record<string, unknown> | null) ?? {};
  const locationBibles =
    (meta.locationBibles as Record<string, LocationBible>) ?? {};
  const propBibles = (meta.propBibles as Record<string, PropBible>) ?? {};
  locationBibles[normalizeKey(MAYA_BEDROOM.name)] = MAYA_BEDROOM;
  for (const p of [PROP_PHONE, PROP_CLOCK, PROP_CLOSET_DOOR, PROP_BLOOD_SMEAR]) {
    propBibles[normalizeKey(p.name)] = p;
  }
  meta.locationBibles = locationBibles;
  meta.propBibles = propBibles;
  await supabase.from("projects").update({ metadata: meta }).eq("id", PROJECT_ID);
  console.log(
    `  locations seeded: ${Object.keys(locationBibles).length} ` +
      `(${Object.keys(locationBibles).join(", ")})`
  );
  console.log(
    `  props seeded    : ${Object.keys(propBibles).length} ` +
      `(${Object.keys(propBibles).join(", ")})`
  );

  // 2. Set Maya + Daniel presence + camera-gaze flags.
  for (const [name, patch] of [
    ["Maya", { presenceType: "visible", cameraGazeAllowed: false }],
    ["DANIEL", { presenceType: "text_only", cameraGazeAllowed: false }],
  ] as const) {
    const { data: ch } = await supabase
      .from("characters")
      .select("id, metadata")
      .eq("project_id", PROJECT_ID)
      .eq("name", name)
      .maybeSingle();
    if (!ch) {
      console.log(`  (skip) ${name} not found`);
      continue;
    }
    const cMeta = (ch.metadata as Record<string, unknown>) ?? {};
    const vb = (cMeta.visualBible as Record<string, unknown>) ?? {};
    vb.presenceType = patch.presenceType;
    vb.cameraGazeAllowed = patch.cameraGazeAllowed;
    cMeta.visualBible = vb;
    await supabase.from("characters").update({ metadata: cMeta }).eq("id", ch.id);
    console.log(
      `  ${name.padEnd(7)} → presenceType=${patch.presenceType}, cameraGazeAllowed=${patch.cameraGazeAllowed}`
    );
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
