// Restore SELVAJE EP01 Draft 5 in place from the R9 source-of-truth.
// Source: projects.metadata.redevelopmentPasses[].r9FinalPolish.polishedDraftText
//
// This script is the LEGITIMATE caller of the `allowLocked` opt-in on
// `indexScenes`. It does NOT run the scene drafter, does NOT regenerate
// any creative content, does NOT create Draft 6, and does NOT demote
// Draft 5. It only writes the verified R9 prose back into Draft 5.

import "dotenv/config";
import { supabase } from "../src/db/client.js";
import { indexScenes } from "../src/screenplay/sceneIndex.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const DRAFT_5 = "f197cbed-5c81-4301-a283-d05a2657277b";

async function main() {
  // 1. Pull the source-of-truth from the redev pass.
  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", SELVAJE_PROJECT)
    .single();
  if (projErr) throw projErr;
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const passes = Array.isArray(meta.redevelopmentPasses)
    ? (meta.redevelopmentPasses as Array<Record<string, unknown>>)
    : [];
  const r9 = passes
    .map((p) => p.r9FinalPolish as Record<string, unknown> | undefined)
    .find((x) => x && x.promotedScriptId === DRAFT_5);
  if (!r9) throw new Error("R9 record for Draft 5 not found on this project");
  const polishedDraftText = (r9.polishedDraftText as string) ?? "";
  if (polishedDraftText.length < 30000) {
    throw new Error(
      `Sanity check failed: r9.polishedDraftText is only ${polishedDraftText.length} chars (expected ~37k). Aborting.`
    );
  }

  console.log("Source-of-truth length:", polishedDraftText.length, "chars");
  console.log("Source-of-truth first 120 chars:", polishedDraftText.slice(0, 120).replace(/\n/g, " "));
  console.log("Source-of-truth last  120 chars:", polishedDraftText.slice(-120).replace(/\n/g, " "));

  // 2. Confirm Draft 5 exists and is still the target we expect.
  const { data: d5, error: d5Err } = await supabase
    .from("scripts")
    .select("id, draft_number, current, metadata, fountain")
    .eq("id", DRAFT_5)
    .single();
  if (d5Err) throw d5Err;
  if (!d5) throw new Error("Draft 5 row not found");
  const d5meta = (d5.metadata ?? {}) as Record<string, unknown>;
  if (d5meta.lockedWritingDraft !== true) {
    throw new Error(`Draft 5 is not locked (lockedWritingDraft=${d5meta.lockedWritingDraft}). Refusing to restore — investigate first.`);
  }
  if (d5.current !== true) {
    throw new Error(`Draft 5 is not current (current=${d5.current}). Refusing to restore — investigate first.`);
  }
  console.log("Draft 5 OK to restore:");
  console.log("  draft_number:", d5.draft_number);
  console.log("  current:     ", d5.current);
  console.log("  locked:      ", d5meta.lockedWritingDraft);
  console.log("  pre-restore fountain length:", (d5.fountain as string)?.length ?? 0);

  // 3. Write the R9 polished text back into scripts.fountain. Preserve
  //    id, draft_number, current, and metadata.lockedWritingDraft.
  //    Update metadata to record the restore for the audit trail.
  const restoredAt = new Date().toISOString();
  const newMetadata = {
    ...d5meta,
    lockedWritingDraft: true,
    source: "r9_pass2_final_polish",
    restoredFromR9SourceAt: restoredAt,
    restoredReason:
      "Scene drafter mutated Draft 5 in place between 18:17–18:24 on 2026-06-08; restored from r9FinalPolish.polishedDraftText (verified source-of-truth).",
  };
  const { error: upErr } = await supabase
    .from("scripts")
    .update({
      fountain: polishedDraftText,
      metadata: newMetadata,
      updated_at: restoredAt,
    })
    .eq("id", DRAFT_5);
  if (upErr) throw upErr;
  console.log("scripts.fountain restored.");

  // 4. Re-index scene rows from the R9 prose. allowLocked so the guard
  //    permits this call; lockResultRows so the new rows come back with
  //    status='locked' (so the gated drafter never picks them up as
  //    "pending" again — and the bottom-of-stack guard would block it
  //    anyway).
  const { count } = await indexScenes(DRAFT_5, polishedDraftText, {
    allowLocked: true,
    lockResultRows: true,
  });
  console.log("script_scenes re-indexed. Locked rows inserted:", count);

  // 5. Final sanity readback.
  const { data: after } = await supabase
    .from("scripts")
    .select("fountain, metadata, current, draft_number")
    .eq("id", DRAFT_5)
    .single();
  const afterLen = (after?.fountain as string)?.length ?? 0;
  console.log("\n===== POST-RESTORE READBACK =====");
  console.log("Draft 5 fountain length:    ", afterLen);
  console.log("Matches R9 polishedDraftText:", afterLen === polishedDraftText.length ? "YES" : "NO");
  console.log("draft_number:                ", after?.draft_number);
  console.log("current:                     ", after?.current);
  const afterMeta = (after?.metadata ?? {}) as Record<string, unknown>;
  console.log("lockedWritingDraft:          ", afterMeta.lockedWritingDraft);
  console.log("source:                      ", afterMeta.source);
  console.log("restoredFromR9SourceAt:      ", afterMeta.restoredFromR9SourceAt);

  if (afterLen !== polishedDraftText.length) {
    throw new Error("Restore readback failed — fountain length differs from R9 source.");
  }
  if (after?.current !== true) throw new Error("Draft 5 is not current after restore.");
  if (afterMeta.lockedWritingDraft !== true)
    throw new Error("Draft 5 lockedWritingDraft was lost during restore.");

  // Verify scene rows
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, status, slugline, fountain")
    .eq("script_id", DRAFT_5)
    .order("ord", { ascending: true });
  console.log("\nscript_scenes count:", scenes?.length ?? 0);
  const statusCounts: Record<string, number> = {};
  for (const s of scenes ?? []) {
    statusCounts[(s.status as string) ?? "?"] = (statusCounts[(s.status as string) ?? "?"] ?? 0) + 1;
  }
  console.log("scene status counts:", statusCounts);

  console.log("\nRESTORE OK.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("RESTORE FAILED:", err);
    process.exit(1);
  });
