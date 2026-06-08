// EP01 Draft 4 — Stage 3 approved canon patch.
//
// Overwrites Stage-2 fields with the user-approved compact descriptors
// for Maya's Bedroom architecture / furnitureDesign / setDressing,
// updated prop bibles (clock / phone / closet door / blood smear),
// Maya's wardrobeByEpisode["1"] + hmuByEpisode["1"], and adds "wall"
// to visibleSetElements on the bed-CU + bed-to-closet briefs so the
// loader injects wall paint when the wall is actually in frame.
//
// Brand / paint-code anchors live in the bible's `notes` field as
// writer reference — NOT injected into prompts. Composer only sees
// the compact descriptors (e.g. "matte cool grey-blue painted drywall"
// in the prompt body; "Benjamin Moore Templeton Gray HC-161" in
// notes for the writer's records).
//
// Idempotent — re-running overwrites only these Stage-3 fields.
// Does NOT touch: screenplay, episode chain, other episodes, prompts.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

for (const l of fs.readFileSync("backend/.env", "utf8").split("\n")) {
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

// ---------- Architecture (compact descriptors) -----------------------------

const ARCHITECTURE = {
  locationIdentity:
    "Maya's bedroom — modest 1-bedroom Los Angeles apartment, ~150 sq ft, lived-in but not messy. Quiet, emotionally restrained, slightly grief-tinted. Not a luxury loft, not a rundown apartment.",
  wallColor: "matte cool grey-blue painted drywall",
  wallMaterial: "flat-painted drywall, no orange-peel, no exposed brick, no wood paneling, no wallpaper",
  floorColor: "dark walnut hardwood",
  floorMaterial: "engineered hardwood plank, hand-scraped, ~5-inch planks, low sheen",
  ceiling: "plain flat 8-foot painted ceiling, no recessed lights, no fan, no skylight",
  trim: "3-inch flat baseboard, painted white, mostly absorbed by floor shadow",
  doorStyle: "standard flat-panel interior door (bedroom entry off-frame in EP01)",
  closetDoorStyle:
    "flat-panel painted dark charcoal closet door, brushed nickel lever handle, hinged on the left, swings inward",
};

const FURNITURE_DESIGN = {
  bedDesign:
    "queen platform bed, dark walnut, low profile (~10 inches off floor), no skirting, no canopy",
  headboardDesign:
    "low dark-walnut slatted headboard, six plain horizontal slats, no padding, no fabric, no tufting",
  nightstandDesign:
    "small two-drawer dark walnut MCM-style nightstand on Maya's right side, brushed brass round drawer knobs (one per drawer), faint vertical wood grain visible, tapered legs",
  closetDesign:
    "single reach-in closet (not walk-in), flat-panel painted dark charcoal door, interior reads pure black when open, no clothing rack detail visible",
};

const SET_DRESSING = {
  bedding: {
    comforterColor: "deep charcoal-grey",
    sheetColor: "cream off-white",
    pillowCount: 2,
    pillowColors:
      "two standard pillows, visibly mismatched — one charcoal-grey, one cream off-white; both compressed from sleep",
    condition:
      "lived-in — one corner of comforter pulled aside, both pillows compressed and not fluffed, sheets rumpled near where Maya was lying. Heavyweight cotton-percale duvet, no quilting pattern.",
  },
  wallDecor:
    "EP01 — no visible wall art. No framed photos, posters, mirrors, shelves, plants, or decorative lights.",
  personalObjects:
    "EP01 — only the digital clock and Maya's iPhone on the nightstand. No books, no candles, no plants, no skincare bottles, no glass of water.",
  clutterLevel:
    "minimal — no clothing piles on the floor, no clutter on the nightstand beyond the clock and phone",
  lamps:
    "none visible — the clock LED and the phone screen are the only artificial light sources in EP01",
  curtains:
    "rear-facing window is off-frame in every EP01 shot; window contributes NO visible light in EP01 and must not be shown unless explicitly approved",
  mirrors: "none — no wall mirror, no full-length mirror, no mirrored closet door",
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
    "window light",
    "moonlight through window",
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
    "satin sheets",
    "silk sheets",
  ],
};

// Brand / paint-code reference for the WRITER. NOT injected into prompts.
// Stored in the bible's `notes` field so the audit trail survives.
const WRITER_CANON_REFERENCE = [
  "Wall paint canon: Benjamin Moore Templeton Gray HC-161, matte finish.",
  "Closet door paint canon: Benjamin Moore Wrought Iron 2124-10, matte finish.",
  "Floor canon: dark walnut engineered hardwood, 5-inch hand-scraped plank, low sheen.",
  "Trim canon: 3-inch flat baseboard, Benjamin Moore Decorator's White OC-149.",
  "Clock canon: small black rectangular plastic alarm clock with red 7-segment LED display (reference: RCA RCD20A-style — keep generic in the prompt body).",
  "Phone canon: iPhone-class device with a muted dark silicone case. Composer prompts use the compact 'iPhone in muted dark case' form.",
  "Sleep shirt canon: heather-grey 100% cotton crew-neck short-sleeve sleep shirt, mid-weight, ribbed crew collar, loose fit.",
  "Wedding band canon: thin polished 14k gold band, ~2mm wide, no engraving.",
];

// ---------- PropBible updates ---------------------------------------------

const CLOCK_BIBLE_PATCH = {
  name: "Nightstand digital clock",
  homeLocation: "INT. MAYA'S BEDROOM - NIGHT",
  startsAt:
    "On Maya's right-side nightstand, display angled toward her pillow, reads 3:17 AM",
  endsAt:
    "Same position throughout EP01 — clock never moves; display continues to read 3:17 AM",
  orientation: "rectangular, horizontal, display facing Maya's pillow",
  handledBy: [],
  visualDetails:
    "small black rectangular red LED digital clock reading 3:17 AM, display angled toward Maya's pillow",
  episodesPresent: [1],
  doNotChange: [
    "red LED",
    "rectangular shape",
    "small size",
    "display reads 3:17 AM",
    "display angled toward pillow",
    "stays on Maya's right-side nightstand",
    "NOT analog",
    "NOT round",
    "NOT oversized except in macro insert",
  ],
  approved: true,
};

const PHONE_BIBLE_PATCH = {
  name: "Maya's phone",
  homeLocation: "INT. MAYA'S BEDROOM - NIGHT",
  startsAt:
    "On Maya's right-side nightstand, face-up, dark screen, beside the digital clock",
  endsAt: "In Maya's lap, face-up, dark screen — moved from nightstand during EP01",
  orientation: "face-up at start; face-up in hand / lap later",
  handledBy: ["Maya"],
  visualDetails:
    "iPhone in muted dark case. When face-up, the screen/glass is visible (dark by default until buzz/glow). When face-down, the muted dark case and triple-lens camera module may be visible. Do not describe the back camera module when the phone is face-up.",
  episodesPresent: [1],
  doNotChange: [
    "iPhone (not Android)",
    "muted dark case",
    "face-up shows screen/glass — NOT the back camera",
    "face-down may show case + lens module",
    "screen is dark by default until buzz / glow",
    "no popsocket, no charm, no strap",
    "screen renderings must look like real iOS messaging — no fake apps, no extra notifications",
  ],
  approved: true,
};

const CLOSET_BIBLE_PATCH = {
  name: "Closet door",
  homeLocation: "INT. MAYA'S BEDROOM - NIGHT",
  startsAt: "Fully closed.",
  endsAt: "Opens inward six inches on its own at the EP01 cliffhanger.",
  orientation: "single flat-panel door, ~32in wide, hinged on the left, swings inward",
  handledBy: [],
  visualDetails:
    "flat-panel painted dark charcoal closet door, brushed nickel lever handle on the outside. When closed: reads as a flush dark surface across the room from the bed. When open six inches: interior reads pure black — NO person, NO clothing rack detail, NO monster, NO figure visible inside.",
  episodesPresent: [1],
  doNotChange: [
    "starts fully closed and remains closed until the EP01 cliffhanger",
    "opens inward (not outward)",
    "opens exactly six inches at the cliffhanger — no further",
    "interior pure black when open — no person, no figure, no clothing rack, no monster",
    "across the room from the bed, NOT adjacent",
    "no mirror, no louver, no double door, no sliding door",
  ],
  approved: true,
};

const BLOOD_SMEAR_PATCH = {
  name: "Blood smear",
  homeLocation: "INT. MAYA'S BEDROOM - NIGHT",
  startsAt:
    "Not visible until SH13 — the closet door must open six inches first (SH12) to reveal the inside handle",
  endsAt: "Visible on the inside handle in SH13 — final reveal of EP01",
  orientation: "single smear on the inside handle of the closet door",
  handledBy: [],
  visualDetails:
    "single dark crimson wet smear on the inside handle of the closet door — ~3 inches across, glistening (wet, fresh), no spatter, no drips on the floor or doorframe yet",
  episodesPresent: [1],
  doNotChange: [
    "wet and fresh — NOT dried",
    "dark crimson — NOT bright red, NOT brown",
    "on the inside handle only — NOT the outside, NOT the door panel",
    "no spatter, no drips on floor or doorframe in EP01",
    "first reveal is SH13 — must NOT appear in earlier shots",
  ],
  approved: true,
};

// ---------- Maya — wardrobe + HMU EP01 -------------------------------------

const MAYA_EP01_WARDROBE = {
  top:
    "plain heather-grey cotton crew-neck short-sleeve sleep shirt, ribbed crew collar, mid-weight, loose fit",
  bottom:
    "dark heather-charcoal cotton drawstring sleep pants, mostly hidden by the bedding (only visible if a shot specifically requires it)",
  accessories:
    "thin polished gold wedding band on left ring finger (~2mm wide, plain, no engraving); small round gold stud earrings (one in each lobe)",
  footwear:
    "No footwear visible in EP01 unless a later shot explicitly shows her feet. Maya remains in or beside the bed area for this episode.",
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
    "V-neck",
    "scoop neck",
    "henley",
    "long sleeves",
    "graphic / logo on shirt",
  ],
};

const MAYA_EP01_HMU = {
  hairCondition:
    "natural shoulder-length dark brown hair, straight texture with a slight wave from sleep, center-parted, slightly tousled with one piece falling across the right side of forehead, no styling product, no shine",
  makeupState: "bare face, no makeup — no foundation, concealer, mascara, eyeliner, or lipstick",
  faceMarks:
    "subtle under-eye darkness (tired / grief-state), faint pillow crease on the right cheek, natural skin texture",
  forbidden: [
    "glam makeup",
    "styled hair",
    "wet hair",
    "blonde hair",
    "heavy eyeliner",
    "lipstick",
    "beauty lighting",
    "smokey eye",
    "bronzer",
    "shimmer",
  ],
};

// ---------- Briefs that should declare "wall" visible ----------------------
//
// Bed CU shots (Maya seated, walls visible behind her) and bed-to-closet
// shots (walls + closet door both in negative space) get "wall" added so
// the loader injects the wall paint descriptor.

const BRIEFS_WITH_WALL_VISIBLE = new Set([1, 3, 6, 8, 11, 12, 13]);

// ---------- Execution ------------------------------------------------------

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
  // Append writer canon to bible notes (preserve existing notes if any).
  const existingNotes = String(bedroom.notes ?? "").trim();
  const canonBlock = WRITER_CANON_REFERENCE.join("\n");
  bedroom.notes = existingNotes
    ? `${existingNotes}\n\nWRITER CANON REFERENCE (NOT injected into prompts):\n${canonBlock}`.trim()
    : `WRITER CANON REFERENCE (NOT injected into prompts):\n${canonBlock}`;
  bedroom.updatedAt = new Date().toISOString();
  meta.locationBibles = bibles;
  const { error } = await sb
    .from("projects")
    .update({ metadata: meta })
    .eq("id", PROJECT_ID);
  if (error) throw error;
  console.log("✓ Maya's Bedroom — architecture / furnitureDesign / setDressing rewritten");
  console.log("  + writer canon block appended to notes");
}

async function patchPropBibles(): Promise<void> {
  const { data: proj } = await sb
    .from("projects")
    .select("metadata")
    .eq("id", PROJECT_ID)
    .single();
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const props = (meta.propBibles ?? {}) as Record<string, Record<string, unknown>>;
  const now = new Date().toISOString();
  const patches: Array<[string, Record<string, unknown>]> = [
    ["NIGHTSTAND_DIGITAL_CLOCK", CLOCK_BIBLE_PATCH],
    ["MAYA_S_PHONE", PHONE_BIBLE_PATCH],
    ["CLOSET_DOOR", CLOSET_BIBLE_PATCH],
    ["BLOOD_SMEAR", BLOOD_SMEAR_PATCH],
  ];
  for (const [key, patch] of patches) {
    const existing = props[key] ?? { createdAt: now };
    props[key] = { ...existing, ...patch, updatedAt: now };
  }
  meta.propBibles = props;
  const { error } = await sb
    .from("projects")
    .update({ metadata: meta })
    .eq("id", PROJECT_ID);
  if (error) throw error;
  console.log("✓ 4 PropBibles patched (clock / phone / closet / blood smear)");
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
  const vb = (meta.visualBible ?? {}) as Record<string, unknown>;
  const wbe = (vb.wardrobeByEpisode ?? {}) as Record<string, unknown>;
  const hbe = (vb.hmuByEpisode ?? {}) as Record<string, unknown>;
  wbe[EP01_NUMBER] = MAYA_EP01_WARDROBE;
  hbe[EP01_NUMBER] = MAYA_EP01_HMU;
  vb.wardrobeByEpisode = wbe;
  vb.hmuByEpisode = hbe;
  meta.visualBible = vb;
  const { error } = await sb
    .from("characters")
    .update({ metadata: meta })
    .eq("id", maya.id);
  if (error) throw error;
  console.log("✓ Maya — wardrobeByEpisode['1'] + hmuByEpisode['1'] rewritten");
}

async function patchBriefsAddWallVisibility(): Promise<void> {
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
    if (!BRIEFS_WITH_WALL_VISIBLE.has(n)) continue;
    const b = briefs[idx];
    const visible = Array.isArray(b.visibleSetElements)
      ? (b.visibleSetElements as string[])
      : [];
    if (!visible.some((v) => /\bwall\b/i.test(v))) {
      visible.push("background walls (negative space)");
      b.visibleSetElements = visible;
      b.updatedAt = new Date().toISOString();
      patched++;
    }
  }
  const { error } = await sb
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", SCRIPT_ID);
  if (error) throw error;
  console.log(
    `✓ ${patched} EP01 brief(s) — added "background walls (negative space)" to visibleSetElements`
  );
}

async function main(): Promise<void> {
  console.log("EP01 Draft 4 — Stage 3 approved canon patch");
  console.log("===========================================");
  await patchBedroom();
  await patchPropBibles();
  await patchMaya();
  await patchBriefsAddWallVisibility();
  console.log();
  console.log("All Stage-3 data written. Rerun preflight to verify.");
}

await main();
