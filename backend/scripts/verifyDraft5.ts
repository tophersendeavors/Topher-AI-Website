// READ-ONLY verification of SELVAJE Episode 1 Draft 5.
// This script performs NO writes. It only SELECTs.

import "dotenv/config";
import { supabase } from "../src/db/client.js";

function head(s: string | null | undefined, n = 220): string {
  if (!s) return "(empty)";
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length > n ? cleaned.slice(0, n) + "…" : cleaned;
}
function tail(s: string | null | undefined, n = 220): string {
  if (!s) return "(empty)";
  const cleaned = s.replace(/\s+/g, " ").trim();
  return cleaned.length > n ? "…" + cleaned.slice(-n) : cleaned;
}

async function main() {
  // 1. Find SELVAJE project
  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, title, metadata, kind")
    .ilike("title", "%selvaje%");
  if (projErr) throw projErr;
  if (!projects || projects.length === 0) {
    console.log("NO SELVAJE PROJECT FOUND");
    return;
  }
  const project = projects[0];
  console.log("PROJECT:", project.id, "—", project.title);

  // 2. Find EP01
  const { data: episodes, error: epErr } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("project_id", project.id)
    .order("number", { ascending: true });
  if (epErr) throw epErr;
  const ep01 = episodes?.find((e) => e.number === 1);
  if (!ep01) {
    console.log("NO EP01 FOUND for", project.id);
    return;
  }
  console.log("EP01:", ep01.id, "—", ep01.title);

  // 3. List ALL scripts for EP01, in draft_number order
  const { data: scripts, error: scErr } = await supabase
    .from("scripts")
    .select("id, draft_number, title, current, fountain, metadata, created_at, updated_at")
    .eq("project_id", project.id)
    .eq("episode_id", ep01.id)
    .order("draft_number", { ascending: true });
  if (scErr) throw scErr;
  console.log("\n========== ALL EP01 SCRIPTS ==========");
  for (const s of scripts ?? []) {
    const meta = (s.metadata ?? {}) as Record<string, unknown>;
    console.log(
      `  Draft ${s.draft_number} | id=${s.id} | current=${s.current} | source=${meta.source ?? "?"} | locked=${meta.lockedWritingDraft ?? false} | updated=${s.updated_at}`
    );
    console.log(`     title: ${s.title}`);
  }

  // 4. Find Draft 5 specifically
  const d5 = scripts?.find((s) => s.draft_number === 5);
  console.log("\n========== DRAFT 5 STATUS ==========");
  if (!d5) {
    console.log("DRAFT 5: NOT PRESENT");
    return;
  }
  const d5meta = (d5.metadata ?? {}) as Record<string, unknown>;
  console.log("DRAFT 5 PRESENT:           YES");
  console.log("DRAFT 5 current=true:      ", d5.current === true ? "YES" : `NO (current=${d5.current})`);
  console.log("DRAFT 5 lockedWritingDraft:", d5meta.lockedWritingDraft === true ? "YES" : `NO (=${d5meta.lockedWritingDraft})`);
  console.log("DRAFT 5 source:            ", d5meta.source ?? "(missing)");
  console.log("DRAFT 5 updated_at:        ", d5.updated_at);
  console.log("DRAFT 5 created_at:        ", d5.created_at);
  console.log("\nDRAFT 5 fountain length:", (d5.fountain ?? "").length);
  console.log("DRAFT 5 OPENING (first 220 chars):");
  console.log("  ", head(d5.fountain));
  console.log("DRAFT 5 ENDING (last 220 chars):");
  console.log("  ", tail(d5.fountain));

  // 5. Check Draft 6 / later drafts
  const later = scripts?.filter((s) => s.draft_number > 5) ?? [];
  console.log("\n========== POST-DRAFT-5 SCRIPTS ==========");
  if (later.length === 0) {
    console.log("NONE — no Draft 6+ exists for EP01");
  } else {
    for (const s of later) {
      const meta = (s.metadata ?? {}) as Record<string, unknown>;
      console.log(`  Draft ${s.draft_number} | id=${s.id} | current=${s.current} | source=${meta.source ?? "?"} | created=${s.created_at}`);
    }
  }

  // 6. Check script_scenes for Draft 5 — any recent updates?
  // Probe columns first — schema varies between projects, so don't assume.
  const probe = await supabase.from("script_scenes").select("*").eq("script_id", d5.id).limit(1);
  if (probe.error) throw probe.error;
  const sampleCols = probe.data && probe.data[0] ? Object.keys(probe.data[0]) : [];
  const hasUpdated = sampleCols.includes("updated_at");
  const hasCreated = sampleCols.includes("created_at");

  const cols = ["id", "ord", "slugline", "status"];
  if (hasCreated) cols.push("created_at");
  if (hasUpdated) cols.push("updated_at");

  const { data: scenes, error: snErr } = await supabase
    .from("script_scenes")
    .select(cols.join(", "))
    .eq("script_id", d5.id)
    .order("ord", { ascending: true });
  if (snErr) throw snErr;
  console.log("\n========== DRAFT 5 SCENES ==========");
  console.log("script_scenes columns sample:", sampleCols.join(", "));
  console.log("Scene count:", scenes?.length ?? 0);
  if (scenes && scenes.length > 0) {
    if (hasUpdated || hasCreated) {
      const field = hasUpdated ? "updated_at" : "created_at";
      const stamps = scenes
        .map((s: any) => new Date(s[field] as string).getTime())
        .filter((t: number) => !isNaN(t));
      const maxStamp = stamps.length ? new Date(Math.max(...stamps)).toISOString() : "(unknown)";
      const minStamp = stamps.length ? new Date(Math.min(...stamps)).toISOString() : "(unknown)";
      console.log(`Earliest scene ${field}:`, minStamp);
      console.log(`Latest   scene ${field}:`, maxStamp);
      console.log("Draft 5 row updated_at:    ", d5.updated_at);
      const d5Time = new Date(d5.updated_at as string).getTime();
      const drift = stamps.filter((t: number) => t > d5Time + 1000);
      if (drift.length > 0) {
        console.log(
          `WARNING: ${drift.length} script_scenes rows have ${field} AFTER Draft 5 row's updated_at. Possible mutation post-promotion.`
        );
      } else {
        console.log(`OK: no script_scenes rows have ${field} after Draft 5's own updated_at.`);
      }
    } else {
      console.log("(no created_at / updated_at column — can't compare timestamps)");
    }
    const generating = scenes.filter((s: any) => (s.status as string) === "generating");
    if (generating.length > 0) {
      console.log(`WARNING: ${generating.length} scenes have status="generating" — in-flight write?`);
      for (const g of generating.slice(0, 5)) {
        console.log("   ord", (g as any).ord, (g as any).slugline);
      }
    } else {
      console.log("OK: no scenes are currently in status=generating.");
    }
    const byStatus: Record<string, number> = {};
    for (const s of scenes) {
      const st = ((s as any).status as string) ?? "(null)";
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }
    console.log("Scene status counts:", byStatus);
    console.log("\nFirst 3 scene sluglines (ord ASC):");
    for (const s of scenes.slice(0, 3)) {
      console.log(`  ord ${(s as any).ord} [${(s as any).status}] ${(s as any).slugline}`);
    }
  }

  // 7. Check the redev pass for R9 polishedDraftText vs current Draft 5 fountain
  console.log("\n========== R9 POLISH SANITY CHECK ==========");
  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const passes = Array.isArray(meta.redevelopmentPasses)
    ? (meta.redevelopmentPasses as Array<Record<string, unknown>>)
    : [];
  console.log("Total redev passes on project:", passes.length);
  const r9passes = passes
    .filter((p) => p && p.r9FinalPolish)
    .map((p) => p.r9FinalPolish as Record<string, unknown>);
  console.log("Passes with r9FinalPolish block:", r9passes.length);
  for (const r9 of r9passes) {
    const polished = (r9.polishedDraftText as string) ?? "";
    console.log("  ---");
    console.log("  promotedScriptId:    ", r9.promotedScriptId);
    console.log("  promotedDraftNumber: ", r9.promotedDraftNumber);
    console.log("  approvedAt:          ", r9.approvedAt);
    console.log("  polished length:     ", polished.length);
    console.log("  polished OPENING:    ", head(polished));
    if (r9.promotedScriptId === d5.id) {
      const match =
        polished.replace(/\s+/g, " ").trim() ===
        ((d5.fountain ?? "") as string).replace(/\s+/g, " ").trim();
      console.log("  ===> matches Draft 5 fountain?", match ? "YES (identical)" : "NO (DIFFERENT)");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("VERIFY FAILED:", err);
    process.exit(1);
  });
