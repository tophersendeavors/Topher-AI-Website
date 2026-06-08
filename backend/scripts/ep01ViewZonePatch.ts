// EP01 Draft 4 — Production Design v2 patch.
//
// Three steps:
//   1. Update / add prop bibles per user spec:
//        - Closet door (corrected start state + ends with 6" open)
//        - Nightstand digital clock (new fields + do-not-change rules)
//        - Blood smear (relocated to inside closet handle)
//        - Maya's phone (tightened start/end + do-not-change)
//   2. Tag every Draft 4 brief with view-zone metadata (cameraViewZone,
//      visibleSetElements, forbiddenSetElements, etc.) so the composer
//      can scope the directive to what's in frame for THIS shot only.
//   3. Re-run the Production Design pass for EP01 Draft 4.

import { supabase } from "../src/db/client.js";
import { runProductionDesignPass } from "../src/productionDesign/designer.js";
import { normalizeKey, type PropBible } from "../src/continuity/types.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const EP01_DRAFT4 = "8835aa81-2f94-404b-b9bc-7eb32d0a359b";
const MAYA_BEDROOM_NAME = "INT. MAYA BEDROOM - NIGHT";

// =============================================================
// 1. PROP BIBLE PATCHES
// =============================================================

const updatedProps: PropBible[] = [
  {
    name: "Closet door",
    homeLocation: MAYA_BEDROOM_NAME,
    startsAt: "Closed.",
    endsAt:
      "Opens six inches on its own at the EP01 cliffhanger. The closet interior remains black. No figure visible.",
    orientation: "Door opens inward into the closet (away from Maya's bed).",
    handledBy: [],
    visualDetails:
      "Wooden interior door, dark stain. Closed for the entire episode until the final cliffhanger beat. When it opens six inches, only deeper darkness is visible inside — no figure, no clothing rack detail, no silhouette.",
    episodesPresent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    doNotChange: [
      "Closet door starts CLOSED, not ajar.",
      "Door opens inward.",
      "Only opens six inches on its own at the final cliffhanger beat — never wider.",
      "Closet interior reads as black; no figure visible inside.",
      "Closet is across the room from the bed; do not relocate.",
    ],
    approved: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    name: "Nightstand digital clock",
    homeLocation: MAYA_BEDROOM_NAME,
    startsAt: "On nightstand, reading 3:17 AM.",
    endsAt: "Same position.",
    orientation:
      "On Maya's right-side nightstand, display facing Maya's pillow.",
    handledBy: [],
    visualDetails:
      "Digital alarm clock with red LED / digital display. Reads 3:17 AM whenever visible. Not analog, not retro flip-clock — modern digital. Display angled toward Maya so she can read it from her pillow.",
    episodesPresent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    doNotChange: [
      "Must read 3:17 AM when visible",
      "Red LED / digital display",
      "Not analog",
      "Not moved to the wrong side of the bed",
      "Not facing away from Maya",
      "Phone remains secondary when clock is hero",
    ],
    approved: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    name: "Blood smear",
    homeLocation: MAYA_BEDROOM_NAME,
    startsAt: "Hidden / not visible.",
    endsAt:
      "Visible as a wet red smear on the inside handle of Maya's closet door, only after the closet opens at the EP01 cliffhanger.",
    orientation:
      "Wet red smear on the INSIDE handle of the closet door — visible only when the door opens six inches and reveals the handle.",
    handledBy: [],
    visualDetails:
      "Wet red blood, glistening on the metal handle. Small smear — not splatter — with a drag direction. Reads as fresh blood, not rust, dirt, or paint.",
    episodesPresent: [1],
    doNotChange: [
      "Wet red blood (not rust, dirt, or paint).",
      "No hand visible.",
      "No person visible.",
      "Not visible before the final cliffhanger shot.",
      "On the INSIDE handle of the closet door, not the outside.",
    ],
    approved: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    name: "Maya's phone",
    homeLocation: MAYA_BEDROOM_NAME,
    startsAt:
      "On Maya's right-side nightstand, face-up, screen dark until it buzzes / lights.",
    endsAt:
      "In Maya's hand after she reads the message and the attached photo.",
    orientation:
      "Screen face-up on the nightstand initially. Then cradled in Maya's hand at eye / chest level.",
    handledBy: ["MAYA"],
    visualDetails:
      "iPhone in muted dark case. iPhone dark mode UI. Lock screen / message bubbles render exactly: contact name DANIEL in all caps; verbatim text where specified.",
    episodesPresent: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    doNotChange: [
      "iPhone, not Android.",
      "DANIEL in all caps when name appears.",
      "No fake apps.",
      "No unrelated notifications.",
      "Screen stays dark until the buzz / message lights it.",
    ],
    approved: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// =============================================================
// 2. VIEW-ZONE METADATA per EP01 Draft 4 brief.
//
// Inferred from each brief's primaryImage / frame / action and the user's
// example matrix (clock insert, phone insert, bed CU, bed-to-closet, etc.)
// =============================================================

interface ViewZone {
  cameraViewZone: string;
  visibleSetElements: string[];
  forbiddenSetElements: string[];
  characterStartPosition?: string;
  characterEndPosition?: string;
  movementPath?: string;
  eyelineTarget?: string;
  propPositions?: string;
  lightingContinuity?: string;
}

// Helper: classify a brief into one of the example shot archetypes.
function classifyShot(brief: Record<string, unknown>): ViewZone {
  const text = (
    String(brief.primaryImage ?? "") +
    " " +
    String(brief.frame ?? "") +
    " " +
    String(brief.cameraFraming ?? "") +
    " " +
    String(brief.action ?? "") +
    " " +
    String(brief.cameraSees ?? "")
  ).toLowerCase();

  // Clock insert
  if (/clock|3:17|red led|red glow/.test(text) && /insert|macro|ecu|extreme close/.test(text)) {
    return {
      cameraViewZone: "clock insert / Maya POV to right-side nightstand",
      visibleSetElements: [
        "red LED clock",
        "right-side nightstand surface",
        "phone (secondary, partial)",
      ],
      forbiddenSetElements: [
        "Maya",
        "closet",
        "full room",
        "extra objects",
        "warm lamp",
        "Daniel",
      ],
      eyelineTarget: "(no character in frame — insert)",
      propPositions:
        "Clock on Maya's right-side nightstand, display facing her pillow; phone face-up beside it, secondary.",
      lightingContinuity:
        "Faint red clock glow dominant; phone glow absent or minimal.",
    };
  }

  // Phone insert (verbatim screen text shots)
  if (/phone screen|message|"where are you|notification|3:17 am|don'?t open/.test(text) && /insert|macro|ecu|extreme close|9:16/.test(text)) {
    return {
      cameraViewZone: "phone insert / Maya POV to phone screen",
      visibleSetElements: [
        "phone screen",
        "Maya's thumb / hand (partial only)",
        "wedding band on left ring finger if visible",
      ],
      forbiddenSetElements: [
        "full bedroom",
        "closet",
        "Daniel physically",
        "Maya's face",
        "fake apps",
        "extra notifications",
      ],
      eyelineTarget: "(no character face in frame — insert)",
      propPositions:
        "Phone face-up — either still on nightstand or held in Maya's palm; screen-text verbatim.",
      lightingContinuity:
        "Cold blue-white phone glow dominant; red clock glow absent.",
    };
  }

  // Bed close-up (Maya's face / shoulders / chest)
  if (/(maya|woman)/.test(text) && /close[- ]?up|cu\b|eye[- ]?level|face|pillow|chest|jolt|wake/.test(text)) {
    return {
      cameraViewZone: "bed CU / observational on Maya",
      visibleSetElements: [
        "Maya",
        "bedding",
        "faint edge of nightstand if needed",
      ],
      forbiddenSetElements: [
        "closet interior",
        "blood",
        "phone in hand",
        "phone screen visible",
        "Daniel",
        "full room",
      ],
      characterStartPosition: "Lying or sitting up on the pillow, center-left of frame",
      eyelineTarget: "Off-camera right toward the nightstand (phone / clock direction)",
      lightingContinuity:
        "Cool ambient wash; faint red clock glow may catch the eye but not dominate.",
    };
  }

  // Bed-to-closet angle (Maya foreground, closet across room)
  if (/closet door|closet across|opens six inches|swings/.test(text) && !/inside closet/.test(text)) {
    return {
      cameraViewZone: "bed-to-closet angle — over Maya / past Maya toward closet door",
      visibleSetElements: [
        "Maya or bed foreground",
        "closet door across the room",
        "negative space between bed and closet",
      ],
      forbiddenSetElements: [
        "blood (until final reveal shot)",
        "figure inside closet",
        "Daniel",
        "wide establishing of full house",
      ],
      eyelineTarget: "Closet door across the room",
      propPositions:
        "Closet door starts closed; on the cliffhanger beat, opens six inches on its own.",
      lightingContinuity:
        "Cold blue-white phone glow rakes Maya's side; closet falls into deep shadow.",
    };
  }

  // Inside-closet POV (looking outward at Maya)
  if (/inside.*closet|from inside the closet|closet pov/.test(text)) {
    return {
      cameraViewZone: "inside-closet POV looking outward at Maya's bed",
      visibleSetElements: [
        "dark closet interior (foreground)",
        "Maya's bed beyond",
        "Maya partially silhouetted",
      ],
      forbiddenSetElements: [
        "visible person inside closet",
        "blood (until final reveal shot)",
        "Daniel",
        "clothing rack detail",
        "any face inside the closet",
      ],
      eyelineTarget:
        "(POV — no character in this side of frame; Maya is the subject across the room)",
      propPositions:
        "Closet door slightly ajar from this side, framing the bed in the gap.",
      lightingContinuity:
        "Total black inside closet; only the phone-glow rim on Maya across the room is lit.",
    };
  }

  // Blood handle macro (cliffhanger)
  if (/blood|smear|handle|wet red/.test(text)) {
    return {
      cameraViewZone: "blood handle macro — inside closet door handle ECU",
      visibleSetElements: [
        "inside closet handle",
        "wet red blood smear",
        "door surface",
      ],
      forbiddenSetElements: [
        "Maya",
        "Daniel",
        "full room",
        "phone",
        "clock",
        "any hand",
        "any figure",
      ],
      eyelineTarget: "(no character in frame — macro insert)",
      propPositions:
        "Blood smear on the INSIDE handle, glistening; door opened six inches.",
      lightingContinuity:
        "Faint cool ambient catches only the handle; everything else falls into shadow.",
    };
  }

  // Default fallback — generic bedroom shot.
  return {
    cameraViewZone: "bedroom observational — generic",
    visibleSetElements: ["Maya", "bedding", "nightstand area"],
    forbiddenSetElements: [
      "closet interior",
      "blood (until final reveal)",
      "Daniel",
      "warm lamp light",
      "full house establishing",
    ],
    eyelineTarget: "Off-camera right toward the nightstand",
    lightingContinuity:
      "Cool ambient wash; practicals (phone / clock) per scene's beat.",
  };
}

async function main() {
  console.log("═══ EP01 Production Design v2 patch ═══\n");

  // ---- 1. Prop bible updates ----
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", PROJECT_ID)
    .single();
  const projMeta = (proj?.metadata as Record<string, unknown>) ?? {};
  const propBibles =
    (projMeta.propBibles as Record<string, PropBible>) ?? {};

  // Soft-delete the obsolete clock and blood-smear entries that lived
  // under different names, then write the canonical names.
  const obsolete = [
    "NIGHTSTAND_CLOCK", // old key, replaced by NIGHTSTAND_DIGITAL_CLOCK
    "BLOOD_SMEAR_OLD_PLACEHOLDER", // (no-op if absent)
  ];
  for (const k of obsolete) delete propBibles[k];

  for (const p of updatedProps) {
    const key = normalizeKey(p.name);
    const existing = propBibles[key];
    propBibles[key] = {
      ...p,
      createdAt: existing?.createdAt ?? p.createdAt,
      updatedAt: new Date().toISOString(),
    };
    console.log(`  prop ${existing ? "UPDATED" : "ADDED"}: ${p.name}`);
  }
  projMeta.propBibles = propBibles;
  await supabase
    .from("projects")
    .update({ metadata: projMeta })
    .eq("id", PROJECT_ID);

  // ---- 2. Brief view-zone tagging ----
  console.log("\n── View-zone tagging ──");
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const meta = (scriptRow!.metadata as Record<string, unknown>) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[1] as Record<string, unknown>) ?? {};
  for (const shotStr of Object.keys(sceneBriefs)) {
    const b = sceneBriefs[shotStr] as Record<string, unknown>;
    const v = classifyShot(b);
    for (const [k, val] of Object.entries(v)) (b as Record<string, unknown>)[k] = val;
    const ue = Array.isArray(b.userEditedFields)
      ? (b.userEditedFields as string[])
      : [];
    for (const f of Object.keys(v)) if (!ue.includes(f)) ue.push(f);
    b.userEditedFields = ue;
    b.updatedAt = new Date().toISOString();
    console.log(`  SH${shotStr.padStart(2, "0")} → ${v.cameraViewZone}`);
  }
  briefs[1] = sceneBriefs;
  ai.briefs = briefs;
  meta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_DRAFT4);

  // ---- 3. Re-run PD pass ----
  console.log("\n── Re-running PD pass ──");
  const result = await runProductionDesignPass(EP01_DRAFT4);
  const { data: scriptRow2 } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const m2 = (scriptRow2!.metadata as Record<string, unknown>) ?? {};
  m2.productionDesign = result;
  await supabase.from("scripts").update({ metadata: m2 }).eq("id", EP01_DRAFT4);
  console.log(
    `  ${result.summary.scenesTotal} scene(s): ${result.summary.scenesReady} ready, ${result.summary.scenesWarning} warning, ${result.summary.scenesFail} fail`
  );

  // Print SC01 prop list + warnings for verification.
  const sc1 = result.scenes[1];
  if (sc1) {
    console.log(`\n── SC01 ${sc1.slugline} — PD pass output ──`);
    console.log(`Summary: ${sc1.designSummary}`);
    if (sc1.warnings.length > 0) {
      console.log("Warnings:");
      for (const w of sc1.warnings) console.log(`  [${w.severity}] ${w.message}`);
    }
    console.log("\nPROP MAP:");
    console.log(sc1.propMap || "(none)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
