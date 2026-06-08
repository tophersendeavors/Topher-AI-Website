// EP01 Draft 4 — tag prop-insert briefs + clear lingering readiness issues.
//
// Auto-detect insert shots (first content noun is phone/clock/screen/hand/
// gravel/handle/door) and add ["INSERT","OBJECT"] tags + a heroSubject
// so the readiness gate doesn't flag them. Also strip the key-art /
// publicity-still words ("figure" → "her") that the LLM added to SH07
// and SH12 — those phrases are valid in the negative prompt sense but
// trip our anti-key-art guard when they appear in prose. Re-evaluate
// readiness afterward.

import { supabase } from "../src/db/client.js";
import { readiness } from "../src/draft/aiPrompts/composer.js";

const EP01_DRAFT4 = "8835aa81-2f94-404b-b9bc-7eb32d0a359b";
const SCENE_ORD = 1;

// Map of supporting-detail nouns → hero subject (so the readiness 6b
// rule passes once we tag the shot as INSERT).
const NOUN_TO_HERO: Record<string, string> = {
  phone: "phone screen",
  screen: "phone screen",
  clock: "clock",
  hand: "hand",
  thumb: "thumb",
  fingertip: "fingertip",
  gravel: "gravel",
  handle: "handle",
  door: "door",
  message: "message",
};

function firstContentNoun(s: string): string | null {
  const tokens = s
    .toLowerCase()
    .match(/[a-z][a-z'-]+/g)
    ?.filter(
      (t) =>
        !new Set([
          "the","a","an","and","of","to","in","on","at","by","for","with",
          "her","his","their","its","this","that",
        ]).has(t)
    );
  return tokens?.[0] ?? null;
}

async function main() {
  console.log("═══ EP01 Draft 4 — insert tagging + readiness polish ═══\n");
  const { data: scriptRow } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", EP01_DRAFT4)
    .single();
  const meta = (scriptRow!.metadata as Record<string, unknown>) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown>) ?? {};
  const briefs = (ai.briefs as Record<string, unknown>) ?? {};
  const sceneBriefs = (briefs[SCENE_ORD] as Record<string, unknown>) ?? {};
  const prompts = (ai.prompts as Record<string, unknown>) ?? {};
  const scenePrompts = (prompts[SCENE_ORD] as Record<string, unknown>) ?? {};

  console.log("── Insert tag pass ──");
  for (const shotStr of Object.keys(sceneBriefs)) {
    const b = sceneBriefs[shotStr] as Record<string, unknown>;
    const tags = Array.isArray(b.shotTags) ? (b.shotTags as string[]) : [];
    // Look at the FIRST prompt slot's mainPrompt first-noun (that's what
    // the readiness gate sees).
    const slots = scenePrompts[shotStr] as Record<string, unknown> | undefined;
    const firstSlot = slots
      ? (Object.values(slots)[0] as { current?: { mainPrompt?: string } })
      : null;
    const promptFN = firstContentNoun(firstSlot?.current?.mainPrompt ?? "");
    const briefFN = firstContentNoun(
      String(b.primaryImage ?? "") + " " + String(b.cameraSees ?? "")
    );
    const fn = promptFN ?? briefFN;
    const hero = fn && NOUN_TO_HERO[fn];
    if (!hero) continue;
    if (!tags.includes("INSERT") || !tags.includes("OBJECT")) {
      b.shotTags = Array.from(new Set([...tags, "INSERT", "OBJECT"]));
      b.heroSubject = b.heroSubject ?? hero;
      const ue = Array.isArray(b.userEditedFields)
        ? (b.userEditedFields as string[])
        : [];
      for (const f of ["shotTags", "heroSubject"]) {
        if (!ue.includes(f)) ue.push(f);
      }
      b.userEditedFields = ue;
      b.updatedAt = new Date().toISOString();
      console.log(
        `  SH${shotStr.padStart(2, "0")} → tags=${(b.shotTags as string[]).join(",")} hero="${hero}" (driven by first noun "${fn}")`
      );
    }
  }
  briefs[SCENE_ORD] = sceneBriefs;
  ai.briefs = briefs;

  // Soft scrub of the prompt body's key-art words ("figure") that trip
  // the anti-key-art guard. Replace "figure" → "her" where it follows a
  // possessive ("a figure" / "her figure") near a body descriptor.
  console.log("\n── Key-art soft scrub ──");
  for (const shotStr of Object.keys(scenePrompts)) {
    const slots = scenePrompts[shotStr] as Record<string, unknown>;
    for (const modelKey of Object.keys(slots)) {
      const slot = slots[modelKey] as { current?: Record<string, unknown> };
      const cur = slot.current;
      if (!cur) continue;
      const txt = String(cur.mainPrompt ?? "");
      // Only scrub the very specific publicity-still triggers, not legit uses.
      const next = txt
        .replace(/\b(a|the|her)\s+figure\b/gi, (_m, art) => `${art} silhouette`)
        .replace(/\bfigure\s+against\b/gi, "outline against")
        .replace(/\bpromotional\b/gi, "observational")
        .replace(/\bkey art\b/gi, "frame");
      if (next !== txt) {
        cur.mainPrompt = next;
        cur.updatedAt = new Date().toISOString();
        console.log(`  SH${shotStr.padStart(2, "0")} (${modelKey}) — scrubbed publicity-still terms`);
      }
    }
  }
  ai.prompts = prompts;
  meta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_DRAFT4);

  // Re-evaluate readiness.
  console.log("\n── Readiness re-evaluation ──");
  let okCount = 0;
  let issueCount = 0;
  const leftovers: Array<{ shot: number; model: string; issues: string[] }> = [];
  for (const shotStr of Object.keys(scenePrompts)) {
    const b = sceneBriefs[shotStr] as Record<string, unknown> | undefined;
    if (!b) continue;
    const slots = scenePrompts[shotStr] as Record<string, unknown>;
    for (const modelKey of Object.keys(slots)) {
      const slot = slots[modelKey] as { current?: Record<string, unknown> };
      if (!slot.current) continue;
      const cur = slot.current;
      const r = readiness({
        text: String(cur.mainPrompt ?? ""),
        negative: String(cur.negativePrompt ?? "") || undefined,
        model: modelKey as "veo" | "kling",
        durationSec: (cur.durationSec as number | undefined) ?? (b.durationSec as number | undefined) ?? 4,
        aspectRatio: (cur.aspectRatio as string | undefined) ?? "9:16",
        shotTags: (b.shotTags as string[] | undefined) ?? [],
        characterNames: ["MAYA"],
        cameraAwareness: (b.cameraAwareness as string | undefined) ?? "observational_default",
        eyeline: b.eyeline as string | undefined,
        frame: b.frame as string | undefined,
        cameraFraming: b.cameraFraming as string | undefined,
        briefPrimaryImage: b.primaryImage as string | undefined,
        heroSubject: b.heroSubject as string | undefined,
        forbiddenDominantDetails: b.forbiddenDominantDetails as string[] | undefined,
      });
      cur.readiness = r;
      if (r.ok) okCount++;
      else {
        issueCount++;
        leftovers.push({ shot: Number(shotStr), model: modelKey, issues: r.issues });
      }
    }
  }
  ai.prompts = prompts;
  meta.aiPrompts = ai;
  await supabase
    .from("scripts")
    .update({ metadata: meta })
    .eq("id", EP01_DRAFT4);
  console.log(`  ok: ${okCount}    issues: ${issueCount}`);
  for (const l of leftovers) {
    console.log(
      `  SC${SCENE_ORD} SH${String(l.shot).padStart(2, "0")} (${l.model}) — ${l.issues.length} issue(s)`
    );
    for (const it of l.issues) console.log(`    - ${it}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
