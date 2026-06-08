// READ-ONLY: characterize the difference between the R9 polishedDraftText
// (source-of-truth) and the current Draft 5 state. NO writes.

import "dotenv/config";
import { supabase } from "../src/db/client.js";

const SELVAJE_PROJECT = "6cd65896-9649-4438-b29a-079b3dfa07b4";
const DRAFT_5 = "f197cbed-5c81-4301-a283-d05a2657277b";

async function main() {
  // Load R9 source-of-truth
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", SELVAJE_PROJECT)
    .single();
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const passes = Array.isArray(meta.redevelopmentPasses)
    ? (meta.redevelopmentPasses as Array<Record<string, unknown>>)
    : [];
  const r9 = passes
    .map((p) => p.r9FinalPolish as Record<string, unknown> | undefined)
    .find((x) => x && x.promotedScriptId === DRAFT_5);
  if (!r9) throw new Error("R9 record for Draft 5 not found");
  const r9text = (r9.polishedDraftText as string) ?? "";

  // Load current Draft 5 fountain
  const { data: d5 } = await supabase
    .from("scripts")
    .select("fountain, updated_at, created_at, metadata")
    .eq("id", DRAFT_5)
    .single();
  const d5fountain = (d5?.fountain as string) ?? "";

  console.log("===== LENGTHS =====");
  console.log("R9 polishedDraftText:", r9text.length, "chars");
  console.log("Draft 5 fountain:    ", d5fountain.length, "chars");
  console.log("Difference:          ", r9text.length - d5fountain.length, "chars MISSING from Draft 5");

  console.log("\n===== R9 polishedDraftText OPENING (1200 chars) =====");
  console.log(r9text.slice(0, 1200));
  console.log("\n===== Draft 5 fountain OPENING (1200 chars) =====");
  console.log(d5fountain.slice(0, 1200));

  // Count sluglines in each
  const sluglineRe = /^\s*(INT|EXT|EXT\/INT|INT\/EXT)[\.\s]/gm;
  const r9Slugs = r9text.match(sluglineRe) ?? [];
  const d5Slugs = d5fountain.match(sluglineRe) ?? [];
  console.log("\n===== SLUGLINE COUNT =====");
  console.log("R9 polishedDraftText sluglines:", r9Slugs.length);
  console.log("Draft 5 fountain sluglines:   ", d5Slugs.length);

  // Scene-row details
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline, status, fountain, summary, story_purpose, generated_at, locked_at, last_pass, created_at")
    .eq("script_id", DRAFT_5)
    .order("ord", { ascending: true });

  console.log("\n===== script_scenes ROWS (per ord) =====");
  for (const s of scenes ?? []) {
    const f = (s as any).fountain as string | null;
    const fLen = f ? f.length : 0;
    console.log(
      `ord ${(s as any).ord} [${(s as any).status}] len=${fLen} | lastPass=${(s as any).last_pass ?? "-"} | generatedAt=${(s as any).generated_at ?? "-"} | lockedAt=${(s as any).locked_at ?? "-"}`
    );
    console.log(`     slug: ${(s as any).slugline}`);
  }

  // For each generated scene, check whether its fountain is a SUBSTRING of R9 text
  // (i.e. it still holds the original R9 prose vs. has been regenerated).
  console.log("\n===== ORIGIN CHECK on 'generated' scenes =====");
  for (const s of scenes ?? []) {
    if ((s as any).status !== "generated") continue;
    const f = ((s as any).fountain as string) ?? "";
    const fNorm = f.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!fNorm) {
      console.log(`ord ${(s as any).ord}: empty fountain`);
      continue;
    }
    const isInR9 = r9text.replace(/\s+/g, " ").includes(fNorm);
    console.log(`ord ${(s as any).ord}: prose ${isInR9 ? "MATCHES R9 (original)" : "DIFFERS from R9 (regenerated/edited)"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
