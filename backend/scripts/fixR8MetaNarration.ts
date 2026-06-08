// Fix the two R8 subtext_moment items whose `fixDirection` contains
// the audit-flagged phrase "the audience sees/reads".
//
// Both items (indices 8 and 19) are about Dean's gaze direction in
// arrival + thermal-pools scenes. Their DIAGNOSES are correct (they
// flag meta-narration in the original action lines). Only the
// fixDirection prose itself needs to lose its trailing meta sentence
// and lean entirely on filmable directives: physical action, eyeline,
// timing.
//
// After applying, re-runs auditAndRepairR8VoicePolishPlan and prints
// the new pass/warning counts. Target: 11 passed / 0 review.

import { supabase } from "../src/db/client.js";
import { auditAndRepairR8VoicePolishPlan } from "../src/redevelopment/validators.js";
import type { RedevR8VoicePolishItem } from "../src/redevelopment/types.js";

interface R8Item extends RedevR8VoicePolishItem {}

interface RedevPass {
  id: string;
  title: string;
  r8VoicePolish?: {
    priorScriptId: string;
    approachSummary: string;
    items: R8Item[];
    planApprovedAt?: string | null;
    polishedDraftText?: string | null;
    polishedDraftAt?: string | null;
    approvedAt?: string | null;
    promotedScriptId?: string | null;
    promotedDraftNumber?: number | null;
  } | null;
}

// Targeted rewrites — each replaces the offending fixDirection with
// filmable execution only. Original intent preserved.
const REWRITES: Record<number, { match: string; replace: string }> = {
  8: {
    match: "Cut both sentences. Replace with a single observable behavior: after Ruth laughs, Dean turns slightly — not toward her, toward the jungle — and the attention moves off him without him having to engineer it. The audience sees the pivot; they don't need to be told it was intentional.",
    replace:
      "Cut both sentences. Replace with a single observable behavior: after Ruth laughs, Dean turns a quarter step — not toward her, toward the jungle — and scans the treeline. Hold three beats; the next action line begins with whoever speaks next, not with a comment on Dean.",
  },
  19: {
    match: "Cut 'He does not look at her while she laughs.' Replace with a simple observable: after she laughs, Dean's gaze stays on the ridge. That is the full description. The audience reads the quality of the non-look; the script doesn't need to flag it.",
    replace:
      "Cut 'He does not look at her while she laughs.' Replace with: after she laughs, Dean's gaze stays on the ridge. Three-beat hold, then he lifts his glass. No commentary line follows.",
  },
};

async function main() {
  console.log("═══ R8 meta-narration fix ═══\n");

  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .ilike("title", "%SELVAJE%");
  if (projErr) throw projErr;
  if (!projects || projects.length === 0) {
    console.error("No SELVAJE project found.");
    process.exit(1);
  }
  const project = projects[0] as { id: string; title: string; metadata: Record<string, unknown> | null };
  console.log(`Project: ${project.title} (${project.id})`);

  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const passes = (meta.redevelopmentPasses as RedevPass[] | undefined) ?? [];
  const passIx = passes.findIndex((p) => p.r8VoicePolish && Array.isArray(p.r8VoicePolish.items) && p.r8VoicePolish.items.length > 0);
  if (passIx < 0) {
    console.error("No pass has an R8 voice plan.");
    process.exit(1);
  }
  const pass = passes[passIx];
  const plan = pass.r8VoicePolish!;
  console.log(`Pass: ${pass.title}`);
  console.log(`R8 plan: ${plan.items.length} items\n`);

  // Apply rewrites and verify each match string is present.
  const applied: Array<{ index: number; before: string; after: string }> = [];
  const newItems = plan.items.map((it, i): R8Item => {
    const rw = REWRITES[i];
    if (!rw) return it;
    if (it.fixDirection.trim() !== rw.match.trim()) {
      console.error(`\n✗ Item #${i} fixDirection does not match expected string.`);
      console.error(`  Expected: ${rw.match.slice(0, 80)}…`);
      console.error(`  Actual:   ${it.fixDirection.slice(0, 80)}…`);
      throw new Error(`fixDirection mismatch on item #${i} — aborting without changes.`);
    }
    applied.push({ index: i, before: it.fixDirection, after: rw.replace });
    return { ...it, fixDirection: rw.replace };
  });

  console.log(`Applying ${applied.length} rewrite(s):\n`);
  for (const a of applied) {
    console.log(`─── Item #${a.index} ───`);
    console.log(`  BEFORE: ${a.before}`);
    console.log(`  AFTER:  ${a.after}`);
    console.log();
  }

  // Write back. Preserve every other field on the plan + pass.
  const newPlan = { ...plan, items: newItems };
  // Plan approval was not yet locked (user said "Do not approve yet"),
  // so planApprovedAt should remain null. Don't touch it.
  passes[passIx] = { ...pass, r8VoicePolish: newPlan };
  const newMeta = { ...meta, redevelopmentPasses: passes };

  const { error: updateErr } = await supabase
    .from("projects")
    .update({ metadata: newMeta })
    .eq("id", project.id);
  if (updateErr) {
    console.error("✗ Database write failed:", updateErr);
    process.exit(1);
  }
  console.log("✓ Plan saved.\n");

  // Re-audit.
  const audit = auditAndRepairR8VoicePolishPlan({
    items: newItems,
    approachSummary: plan.approachSummary,
  });
  const passed = audit.checks.filter((c) => c.status === "passed").length;
  const warning = audit.checks.filter((c) => c.status === "warning").length;
  const blocking = audit.checks.filter((c) => (c.status as string) === "blocking" || (c.status as string) === "failed").length;
  const repaired = audit.checks.filter((c) => c.status === "auto_repaired").length;

  console.log("═══ Re-audit result ═══");
  console.log(`  Passed:   ${passed}`);
  console.log(`  Review:   ${warning}`);
  console.log(`  Repaired: ${repaired}`);
  console.log(`  Blocking: ${blocking}`);
  console.log();

  if (warning > 0 || blocking > 0) {
    console.log("Remaining non-passed checks:");
    for (const c of audit.checks) {
      if (c.status === "passed" || c.status === "auto_repaired") continue;
      console.log(`  ⚠ [${c.status}] ${c.id} — ${c.label}`);
      console.log(`     ${c.message}`);
    }
  } else {
    console.log("✓ Target reached: 11 passed / 0 review. R8 plan is clean to approve.");
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
