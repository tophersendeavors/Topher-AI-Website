// Auto-patch the 10 EP02 brief eyelines flagged by the continuity pass.
// Story-appropriate eyelines derived from the screenplay action lines +
// the Hero Image / Shot Priority metadata already written. No prompt
// regen (LLM cost is the user's call). Re-runs the continuity pass to
// confirm 0/0.

import { supabase } from "../src/db/client.js";
import { runContinuityPass } from "../src/continuity/validator.js";

const EP02_SCRIPT_ID = "dc5cf7d7-7a4f-47cf-b4e2-0cabcb36f7ce";
const SCENE_ORD = 1;

const EYELINES: Record<number, string> = {
  2: "Maya's eyeline tracks her own fingertip along the urn crack; she does not register the camera.",
  3: "Maya looks down into the open drawer as her hands lift the certificate out; lens is off-axis.",
  4: "Maya's eyeline slides down the certificate to the funeral director's name; the page holds her gaze.",
  5: "Maya's gaze lingers on the P.O. box address line; she never looks up at the lens.",
  6: "Maya stares at the urn, unblinking; the camera observes from slightly off-axis. She does not look into the lens.",
  7: "Maya's eyeline is fixed on the urn lid as her hands pry it off; the lens stays beside her.",
  8: "Maya looks down into the open urn as her hand plunges into the gravel; eyeline buried in the vessel.",
  9: "Maya's eyeline tracks the phone rising from her own palm; the lens observes from her side.",
  10: "Maya looks down at the phone as she turns it over in her hands; her gaze stays on the screen, never on the lens.",
  13: "Maya's eyeline starts down on the phone screen, then snaps up toward the hallway off-frame; never crosses the lens.",
};

async function main() {
  console.log("═══ EP02 eyeline auto-patch ═══\n");
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP02_SCRIPT_ID)
    .single();
  if (!scriptRow) throw new Error("EP02 script not found");
  const meta = (scriptRow.metadata as Record<string, unknown>) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown>) ?? {};
  for (const [shotStr, eyeline] of Object.entries(EYELINES)) {
    const shot = Number(shotStr);
    const b = sceneBriefs[shot] as Record<string, unknown> | undefined;
    if (!b) {
      console.log(`  (skip) SH${shot} missing`);
      continue;
    }
    b.eyeline = eyeline;
    b.cameraAwareness = b.cameraAwareness ?? "observational_default";
    const ue = Array.isArray(b.userEditedFields)
      ? (b.userEditedFields as string[])
      : [];
    for (const f of ["eyeline", "cameraAwareness"]) {
      if (!ue.includes(f)) ue.push(f);
    }
    b.userEditedFields = ue;
    b.updatedAt = new Date().toISOString();
    console.log(`  SH${String(shot).padStart(2, "0")}: ${eyeline}`);
  }
  briefs[SCENE_ORD] = sceneBriefs;
  ai.briefs = briefs;
  meta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP02_SCRIPT_ID);

  console.log("\nRe-running continuity pass…");
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
  console.log(`\nFinal: ${fails} fail / ${warns} warning`);
  if (fails + warns > 0) {
    for (const i of result.issues) {
      const w = i.where;
      const loc = [
        w.sceneOrd != null ? `SC${String(w.sceneOrd).padStart(2, "0")}` : null,
        w.shotIndex != null ? `SH${String(w.shotIndex).padStart(2, "0")}` : null,
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`  [${i.severity}] [${i.category}] ${loc} — ${i.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
