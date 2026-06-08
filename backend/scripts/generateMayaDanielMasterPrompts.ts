// Runs the new Master Image Prompt agent against Maya + Daniel only,
// persists results into characters.metadata.visualBible, and stamps the
// V3 status fields (profileStatus, referenceImageStatus, episodeWardrobe
// Notes, manualEdits map seeded from existing data).
//
// Idempotent: re-running regenerates the master prompts but leaves all
// other Visual Bible fields untouched. Maya's hand-typed canon stays
// intact (it's preserved across the merge).

import { generateMasterImagePrompt } from "../src/microDrama/masterImagePromptAgent.js";
import { supabase } from "../src/db/client.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";

async function main() {
  console.log("═══ Visual Bible v3 — Maya + Daniel ═══\n");

  for (const targetName of ["Maya", "DANIEL"]) {
    const { data: ch } = await supabase
      .from("characters")
      .select("id, name, role, metadata")
      .eq("project_id", PROJECT_ID)
      .eq("name", targetName)
      .maybeSingle();
    if (!ch) {
      console.log(`(skip) ${targetName} not found`);
      continue;
    }
    const meta = (ch.metadata as Record<string, unknown>) ?? {};
    const vb = ((meta.visualBible as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    const presence: "principal" | "voice_or_text" =
      ch.role === "voice / text" ? "voice_or_text" : "principal";
    const visualCanonObj = (vb.visualCanon as Record<string, unknown>) ?? {};

    console.log(`─── ${ch.name} (${presence}) ───`);

    // Generate the Master Image Prompt.
    const result = await generateMasterImagePrompt({
      characterName: ch.name as string,
      presence,
      visualCanon: (visualCanonObj.description as string) ?? "",
      wardrobe: (vb.wardrobe as string) ?? "",
      doNotChangeTraits: ((vb.doNotChangeTraits as string[]) ?? []).filter(Boolean),
      movementCanon: ((vb.movementCanon as string[]) ?? []).filter(Boolean),
      negativeContinuity: (vb.negativeContinuity as string) ?? "",
      episodeNumber: 1,
    });

    // Seed manualEdits from the EXISTING populated fields — anything the
    // writer or a previous pass already filled is treated as user-protected
    // going forward. Future auto-extractor passes skip these.
    const isEmpty = (v: unknown): boolean =>
      v == null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
    const seedFields = [
      "visualCanon",
      "movementCanon",
      "wardrobe",
      "characterConsistencyPrompt",
      "doNotChangeTraits",
      "negativeContinuity",
    ];
    const manualEdits: Record<string, boolean> = (vb.manualEdits as Record<
      string,
      boolean
    >) ?? {};
    for (const f of seedFields) {
      if (!isEmpty((vb as Record<string, unknown>)[f])) manualEdits[f] = true;
    }

    const profileStatus: "incomplete" | "needs_review" | "production_ready" =
      presence === "voice_or_text"
        ? // Daniel has no actor face — voice/text setup is the whole asset.
          // Production-ready as soon as the master text-presence prompt is in.
          "production_ready"
        : // Maya is needs_review until the writer approves a reference image.
          "needs_review";

    const referenceImageStatus: "missing" | "pending_approval" | "approved" | "not_applicable" =
      presence === "voice_or_text"
        ? "not_applicable"
        : ((vb.referenceImageStatus as string) ?? "missing") as
            | "missing"
            | "pending_approval"
            | "approved";

    const nextVb: Record<string, unknown> = {
      ...vb,
      masterCharacterImagePrompt: result.prompt,
      masterCharacterImageNegative: result.negativePrompt,
      masterCharacterImageAspectRatio: result.aspectRatio,
      masterImagePromptGeneratedAt: new Date().toISOString(),
      profileStatus,
      referenceImageStatus,
      // Keep referenceImageUrl as-is (already null/undefined for both).
      // Per-episode wardrobe notes — empty record for now, writer fills.
      episodeWardrobeNotes: (vb.episodeWardrobeNotes as Record<string, string>) ?? {},
      manualEdits,
    };
    meta.visualBible = nextVb;
    await supabase
      .from("characters")
      .update({ metadata: meta })
      .eq("id", ch.id);

    console.log(`  master image prompt: ${result.prompt.length} chars`);
    console.log(`  negative prompt:     ${result.negativePrompt.length} chars`);
    console.log(`  aspect ratio:        ${result.aspectRatio}`);
    console.log(`  profile status:      ${profileStatus}`);
    console.log(`  ref image status:    ${referenceImageStatus}`);
    console.log(`  manualEdits marked:  ${Object.keys(manualEdits).join(", ")}`);
    console.log("");
    console.log("PROMPT:");
    console.log(`  ${result.prompt.split("\n").join("\n  ")}`);
    console.log("");
    console.log("NEGATIVE:");
    console.log(`  ${result.negativePrompt.split("\n").join("\n  ")}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
