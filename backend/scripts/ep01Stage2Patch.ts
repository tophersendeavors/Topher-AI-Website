// EP01 Draft 4 — Stage 2 data patch.
//
// Writes structured Art Department fields to Maya's Bedroom Location
// Bible, per-episode wardrobe + HMU to Maya's character Visual Bible,
// and fills the blocking gaps on all 13 EP01 Draft 4 briefs.
//
// Idempotent — re-running overwrites only the Stage-2 fields.
//
// Does NOT touch: approved character DNA elsewhere, the screenplay,
// the episode chain, other episodes, or any prompts.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

for (const l of fs
  .readFileSync("backend/.env", "utf8")
  .split("\n")) {
  const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const SCRIPT_ID = "8835aa81-2f94-404b-b9bc-7eb32d0a359b";
const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP01_NUMBER = "1";
const BEDROOM_KEY = "INT_MAYA_BEDROOM_NIGHT";

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ---------------------------------------------------------------------------
// 1. Maya's Bedroom — structured Art Department fields
// ---------------------------------------------------------------------------

const ARCHITECTURE = {
  locationIdentity:
    "Maya's bedroom — modest, lived-in Los Angeles apartment bedroom. Not a luxury loft, not a rundown apartment. Realistic, quiet, emotionally restrained, slightly neglected from grief. Functional, minimal, personal, but not heavily decorated.",
  wallColor: "matte cool grey-blue",
  wallMaterial: "painted drywall, no exposed brick, no peeling paint",
  floorColor: "dark wood or dark laminate",
  floorMaterial: "dark wood / dark laminate, mostly hidden by bed shadows",
  ceiling: "low, plain, no skylight, no exposed beams",
  trim: "simple flat baseboards, barely visible in the darkness",
  doorStyle:
    "plain interior door — bedroom entry off-frame; no industrial slider, no luxury double door",
  closetDoorStyle:
    "flat-panel dark painted wood closet door, simple metal handle on inside; no mirrored closet, no louvered slats",
};

const FURNITURE_DESIGN = {
  bedDesign:
    "full or queen bed, center-left of room; simple low platform; no four-poster, no luxury upholstered headboard",
  headboardDesign:
    "low dark-wood headboard against the back wall, plain horizontal slats, no padding, no luxury button-tuft",
  nightstandDesign:
    "small simple dark walnut nightstand on Maya's right side, minimal and uncluttered; no luxury lacquer, no painted finish",
  closetDesign:
    "single-door reach-in closet across from the bed; flat-panel dark painted wood door; pure-black interior; no walk-in, no mirrored door",
};

const SET_DRESSING = {
  bedding: {
    comforterColor: "dark charcoal-grey",
    sheetColor: "muted off-white / pale grey",
    pillowCount: 2,
    pillowColors: "muted grey and off-white (slightly mismatched)",
    condition:
      "rumpled, lived-in, not hotel-perfect; one corner of comforter pulled aside from Maya's movement",
  },
  wallDecor:
    "EP01 — no visible wall art. No framed photos, posters, mirrors, shelves, plants, or decorative lights visible in the dark.",
  personalObjects:
    "EP01 — only the digital clock and Maya's iPhone on the nightstand. No books, no candles, no plants, no jewelry tray.",
  clutterLevel: "minimal — lived-in but not messy; no clothing piles",
  lamps: "none — there are no lamps visible in EP01",
  curtains: "none visible — no window in this view zone",
  mirrors: "none — no wall mirror, no mirrored closet door",
  books: "none visible in EP01",
  forbiddenDressing: [
    "luxury loft",
    "exposed brick",
    "industrial loft windows",
    "hotel room",
    "rundown apartment",
    "dorm room",
    "hospital room",
    "mansion bedroom",
    "generic horror set",
    "big windows",
    "neon lights",
    "fairy lights",
    "string lights",
    "candles",
    "lamp",
    "table lamp",
    "floor lamp",
    "warm lamp glow",
    "warm orange light",
    "ring light",
    "studio fill",
    "posters",
    "plants",
    "houseplants",
    "fern",
    "succulent",
    "clothing piles",
    "decorative art",
    "wall art",
    "framed photos",
    "framed photographs",
    "framed pictures",
    "mirror",
    "wall mirror",
    "white luxury bedding",
    "floral bedding",
    "white sheets",
    "satin sheets",
    "silk sheets",
  ],
};

// ---------------------------------------------------------------------------
// 2. Maya — EP01 wardrobe + HMU
// ---------------------------------------------------------------------------

const MAYA_EP01_WARDROBE = {
  top: "plain pale grey short-sleeve sleep shirt",
  bottom:
    "dark sleep shorts or dark sleep pants — mostly hidden by bedding; only visible if the shot requires it",
  accessories:
    "thin gold wedding band on left ring finger; small gold stud earrings",
  footwear: "none visible",
  forbidden: [
    "robe",
    "tank top",
    "dress",
    "hoodie",
    "glam outfit",
    "exposed bare shoulders",
    "extra jewelry",
    "necklace",
    "glasses",
  ],
};

const MAYA_EP01_HMU = {
  hairCondition: "shoulder-length dark brown hair, slightly tousled from sleep",
  makeupState: "bare face, no makeup",
  faceMarks: "subtle under-eye tiredness, natural skin texture",
  forbidden: [
    "glam makeup",
    "styled hair",
    "wet hair",
    "blonde hair",
    "heavy eyeliner",
    "lipstick",
    "beauty lighting",
  ],
};

// ---------------------------------------------------------------------------
// 3. EP01 Draft 4 blocking — all 13 briefs
// ---------------------------------------------------------------------------

interface ShotBlocking {
  characterStartPosition: string;
  characterEndPosition: string;
  movementPath: string;
  eyelineTarget: string;
  propPositions: string;
}

const BLOCKING: Record<number, ShotBlocking> = {
  1: {
    characterStartPosition:
      "Maya lying flat on the pillow, center-left of frame, head turned slightly toward the nightstand",
    characterEndPosition:
      "Maya sitting upright on the pillow, center-left of frame, torso vertical",
    movementPath:
      "torso snaps from horizontal to vertical in a single sharp movement; hands grip the sheet edge as the body rises; head turns sharply toward the nightstand",
    eyelineTarget:
      "off-camera right toward the nightstand (phone / clock direction); subject does NOT look into lens",
    propPositions:
      "Clock on Maya's right-side nightstand, display facing her pillow, reads 3:17 AM in red LED; phone face-up beside the clock, dark screen, untouched",
  },
  2: {
    characterStartPosition:
      "Maya off-frame (continues sitting upright center-left of room from SH01)",
    characterEndPosition:
      "Maya off-frame (unchanged — only the phone vibrates)",
    movementPath:
      "static frame — no character movement; phone screen activates and pulses with a single buzz vibration against the nightstand surface",
    eyelineTarget: "(no character in frame — insert shot on the nightstand)",
    propPositions:
      "Clock on Maya's right-side nightstand reads 3:17 AM, display facing her pillow; phone face-up beside the clock, screen blazing white from buzz; phone has NOT moved",
  },
  3: {
    characterStartPosition:
      "Maya sitting upright on the pillow, center-left of frame, phone now in her right hand at lap level",
    characterEndPosition:
      "Maya sitting upright center-left of frame, eyes finished scanning across the screen, jaw dropped slightly",
    movementPath:
      "static torso; eyes scan downward across the phone screen; jaw drops slightly; no other movement",
    eyelineTarget:
      "down toward the phone screen in her lap (off-camera right-low); subject does NOT look into lens",
    propPositions:
      "Phone in Maya's right hand at lap level, face-up, screen visible to her — light from the screen falls on her face",
  },
  4: {
    characterStartPosition:
      "Maya's hand and thumb only in frame, the rest of her body off-camera; she is sitting upright center-left",
    characterEndPosition:
      "same — hand and thumb stationary on the phone",
    movementPath:
      "static; the screen-text sits motionless on the display; thumb resting at the bottom edge of the phone, not interacting",
    eyelineTarget: "(no character face in frame — phone-screen insert)",
    propPositions:
      "Phone face-up, held in Maya's palm; screen displays the contact-name DANIEL in glow on a dark background; thumb visible at lower edge; wedding band on left ring finger may be partially visible",
  },
  5: {
    characterStartPosition:
      "Maya's hand and thumb only in frame; thumb resting at the lower portion of the phone screen",
    characterEndPosition:
      "thumb at the upper portion of the phone screen after three swipes",
    movementPath:
      "thumb swipes upward three times across the phone screen; the thread remains empty above the single message",
    eyelineTarget: "(no character face in frame — phone-screen insert)",
    propPositions:
      "Phone face-up, held in Maya's palm; screen shows an otherwise-empty message thread above the single existing message",
  },
  6: {
    characterStartPosition:
      "Maya sitting upright on the pillow, center-left of frame, phone moving from lap toward her right ear",
    characterEndPosition:
      "Maya sitting upright center-left, phone pressed to her right ear, eyes fixed forward, body still",
    movementPath:
      "right arm raises the phone from lap to right ear in a slow arc; head holds level; once the phone reaches the ear, the body stops moving",
    eyelineTarget:
      "straight forward into the middle distance; subject does NOT look into lens",
    propPositions:
      "Phone pressed to Maya's right ear, screen against her cheek; nightstand on her right still holds the digital clock",
  },
  7: {
    characterStartPosition:
      "Maya's hand visible holding the phone in her lap (the rest of her off-camera); face not in frame",
    characterEndPosition:
      "same — phone screen and hand stationary",
    movementPath:
      "static — the screen text 'This number has been disconnected' remains static on the display; no interaction",
    eyelineTarget: "(no character face in frame — phone-screen insert)",
    propPositions:
      "Phone face-up in Maya's palm at lap level; screen displays the disconnected-line message verbatim in white text on dark background",
  },
  8: {
    characterStartPosition:
      "Maya sitting upright on the pillow, center-left of frame, phone still pressed to her right ear from SH06–SH07",
    characterEndPosition:
      "Maya sitting upright center-left, phone now lowered to her lap, head turned slightly LEFT toward the closet door across the room",
    movementPath:
      "right arm lowers the phone from ear to lap in a slow arc; head turns left ~45 degrees toward the closet door; torso remains still",
    eyelineTarget:
      "off-camera LEFT toward the closet door across the room; subject does NOT look into lens",
    propPositions:
      "Phone now in Maya's lap, face-up, dark screen; closet door visible across the room in negative space, still CLOSED",
  },
  9: {
    characterStartPosition:
      "Maya's hand visible in her lap holding the phone (rest of her off-camera); phone face-up, dark screen",
    characterEndPosition:
      "same — phone screen now lit with an attachment thumbnail loading",
    movementPath:
      "phone vibrates once in her lap; the screen activates; an attachment thumbnail loads and fills the screen",
    eyelineTarget: "(no character face in frame — phone-screen insert)",
    propPositions:
      "Phone face-up in Maya's lap, screen pulses with vibration then resolves into a loading attachment thumbnail",
  },
  10: {
    characterStartPosition:
      "Maya's hand visible holding the phone in her lap (rest of her off-camera); attachment thumbnail now resolved into the full image on screen",
    characterEndPosition:
      "same — image holds full-frame on the phone screen, no interaction",
    movementPath:
      "static — the photo fills the screen completely and does not animate or change",
    eyelineTarget: "(no character face in frame — phone-screen insert)",
    propPositions:
      "Phone face-up in Maya's lap; full-screen photo of a sleeping woman in a bed, shot from inside a closet, fills the display",
  },
  11: {
    characterStartPosition:
      "Maya sitting upright center-left of frame, phone in her lap, eyes wide and fixed on the phone screen",
    characterEndPosition:
      "Maya sitting upright center-left, head pulled back ~6 inches from the phone screen, mouth fallen open",
    movementPath:
      "eyes widen further; mouth opens; head pulls back slightly from the phone screen — no other body movement",
    eyelineTarget:
      "down toward the phone screen in her lap (off-camera right-low); subject does NOT look into lens",
    propPositions:
      "Phone face-up in Maya's lap, photo of the sleeping woman still on screen",
  },
  12: {
    characterStartPosition:
      "Maya sitting upright center-left in the foreground of the frame, phone in her lap, body still; closet door across the room CLOSED",
    characterEndPosition:
      "Maya unchanged in foreground; closet door across the room now OPEN six inches inward; a black gap visible in the doorway",
    movementPath:
      "Maya holds still; the closet door swings slowly six inches inward on its own and stops; darkness visible in the gap; no other movement in frame",
    eyelineTarget:
      "across the room toward the closet door (Maya's POV or over-Maya angle); subject does NOT look into lens",
    propPositions:
      "Closet door across the room starts closed; on the cliffhanger beat, opens six inches inward on its own; interior reads pure black",
  },
  13: {
    characterStartPosition:
      "Maya unchanged in soft foreground (or out of frame for the macro); closet door open six inches as it ended in SH12",
    characterEndPosition:
      "same — Maya unchanged; closet door still six inches open; camera focused on the inside handle",
    movementPath:
      "static — neither the handle nor the smear moves; the wet surface catches the faint clock-glow ambient",
    eyelineTarget:
      "the inside handle of the closet door (Maya's POV or insert); subject does NOT look into lens",
    propPositions:
      "Closet door open six inches; dark smear of wet blood glistens on the inside handle, catching the faint ambient light",
  },
};

// ---------------------------------------------------------------------------
// Execute writes
// ---------------------------------------------------------------------------

async function patchBedroom(): Promise<void> {
  const { data: proj } = await sb
    .from("projects")
    .select("metadata")
    .eq("id", PROJECT_ID)
    .single();
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const bibles = (meta.locationBibles ?? {}) as Record<string, Record<string, unknown>>;
  const bedroom = bibles[BEDROOM_KEY];
  if (!bedroom) throw new Error(`Bedroom bible ${BEDROOM_KEY} not found`);
  bedroom.architecture = ARCHITECTURE;
  bedroom.furnitureDesign = FURNITURE_DESIGN;
  bedroom.setDressing = SET_DRESSING;
  bedroom.updatedAt = new Date().toISOString();
  meta.locationBibles = bibles;
  const { error } = await sb
    .from("projects")
    .update({ metadata: meta })
    .eq("id", PROJECT_ID);
  if (error) throw error;
  console.log("✓ Maya's Bedroom — architecture + furnitureDesign + setDressing written");
}

async function patchMaya(): Promise<void> {
  const { data: maya } = await sb
    .from("characters")
    .select("id, metadata")
    .eq("project_id", PROJECT_ID)
    .eq("name", "Maya")
    .single();
  if (!maya) throw new Error("Maya not found");
  const meta = (maya.metadata ?? {}) as Record<string, unknown>;
  const vb = ((meta.visualBible ?? {}) as Record<string, unknown>);
  const wardrobeByEp = (vb.wardrobeByEpisode ?? {}) as Record<string, unknown>;
  const hmuByEp = (vb.hmuByEpisode ?? {}) as Record<string, unknown>;
  wardrobeByEp[EP01_NUMBER] = MAYA_EP01_WARDROBE;
  hmuByEp[EP01_NUMBER] = MAYA_EP01_HMU;
  vb.wardrobeByEpisode = wardrobeByEp;
  vb.hmuByEpisode = hmuByEp;
  meta.visualBible = vb;
  const { error } = await sb
    .from("characters")
    .update({ metadata: meta })
    .eq("id", maya.id);
  if (error) throw error;
  console.log("✓ Maya — wardrobeByEpisode['1'] + hmuByEpisode['1'] written");
}

async function patchBriefs(): Promise<void> {
  const { data: script } = await sb
    .from("scripts")
    .select("metadata")
    .eq("id", SCRIPT_ID)
    .single();
  const meta = (script?.metadata ?? {}) as Record<string, unknown>;
  const ai = (meta.aiPrompts ?? {}) as Record<string, unknown>;
  const briefs = (ai.briefs as Record<string, Record<string, Record<string, unknown>>>)?.[1] ?? {};
  let patched = 0;
  for (const idx of Object.keys(briefs)) {
    const n = Number(idx);
    const block = BLOCKING[n];
    if (!block) continue;
    const b = briefs[idx];
    b.characterStartPosition = block.characterStartPosition;
    b.characterEndPosition = block.characterEndPosition;
    b.movementPath = block.movementPath;
    b.eyelineTarget = block.eyelineTarget;
    b.propPositions = block.propPositions;
    b.updatedAt = new Date().toISOString();
    patched++;
  }
  const { error } = await sb
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", SCRIPT_ID);
  if (error) throw error;
  console.log(`✓ ${patched} EP01 Draft 4 briefs — blocking metadata patched`);
}

async function main(): Promise<void> {
  console.log("EP01 Draft 4 — Stage 2 data patch");
  console.log("==================================");
  await patchBedroom();
  await patchMaya();
  await patchBriefs();
  console.log();
  console.log("All Stage-2 data written. Rerun preflight to verify.");
}

await main();
