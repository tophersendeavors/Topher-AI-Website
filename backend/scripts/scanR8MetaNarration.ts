// Scan the SELVAJE R8 voice plan for subtext_moment items whose
// fixDirection contains meta-narration phrases the audit flags
// (the "Subtext fixes don't add meta-narration" check).
//
// Prints each offender with its index, location, diagnosis, current
// fixDirection, and the phrases that triggered the audit, so a
// follow-up script can apply targeted rewrites.

import { supabase } from "../src/db/client.js";

const META_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "the audience [feels/knows/sees/understands/reads]", re: /\bthe\s+audience\s+(feels?|knows?|sees?|understands?|reads?)/i },
  { name: "the room knows/understands", re: /\bthe\s+room\s+(knows?|understands?)/i },
  { name: "the body knows/understands", re: /\bthe\s+body\s+(knows?|understands?)/i },
  { name: "the wound is/sits/lives/remains/stays", re: /\bthe\s+wound\s+(is|sits|lives|remains|stays)/i },
  { name: "the avoidance strategies", re: /\bthe\s+avoidance\s+strategies?\b/i },
  { name: "the system is/was/remains …ing", re: /\bthe\s+system\s+(is|was|remains|stays)\s+\w+ing\b/i },
  { name: "what this means is", re: /\bwhat\s+this\s+means\s+is\b/i },
  { name: "we realize", re: /\bwe\s+realize\b/i },
  { name: "we feel/know/see/understand", re: /\bwe\s+(feel|know|see|understand)/i },
];

interface R8Item {
  existingSceneOrd: number | null;
  existingSlugline?: string;
  character?: string;
  category: string;
  diagnosis: string;
  fixDirection: string;
  severity?: string;
  scope?: string;
}

interface RedevPass {
  id: string;
  title: string;
  r8VoicePolish?: {
    priorScriptId: string;
    approachSummary: string;
    items: R8Item[];
    planApprovedAt?: string | null;
  } | null;
}

async function main() {
  console.log("═══ R8 meta-narration scan ═══\n");

  // Find the SELVAJE project (any project whose title contains "SELVAJE").
  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .ilike("title", "%SELVAJE%");
  if (projErr) throw projErr;
  if (!projects || projects.length === 0) {
    console.error("No SELVAJE project found.");
    process.exit(1);
  }
  if (projects.length > 1) {
    console.log(`Found ${projects.length} SELVAJE projects:`);
    for (const p of projects) console.log(`  ${p.id} — ${p.title}`);
  }
  const project = projects[0] as { id: string; title: string; metadata: Record<string, unknown> | null };
  console.log(`Project: ${project.title} (${project.id})\n`);

  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const passes = (meta.redevelopmentPasses as RedevPass[] | undefined) ?? [];
  if (passes.length === 0) {
    console.error("No redevelopment passes on this project.");
    process.exit(1);
  }

  // Find the pass with an R8 plan.
  const pass = passes.find((p) => p.r8VoicePolish && Array.isArray(p.r8VoicePolish.items) && p.r8VoicePolish.items.length > 0);
  if (!pass || !pass.r8VoicePolish) {
    console.error("No pass has an R8 voice plan.");
    process.exit(1);
  }
  console.log(`Pass: ${pass.title} (${pass.id})`);
  console.log(`R8 plan: ${pass.r8VoicePolish.items.length} items`);
  console.log(`Approach: ${pass.r8VoicePolish.approachSummary}\n`);

  // Find offending subtext_moment items.
  const offenders: Array<{ index: number; item: R8Item; hits: string[] }> = [];
  pass.r8VoicePolish.items.forEach((item, i) => {
    if (item.category !== "subtext_moment") return;
    const hits: string[] = [];
    for (const p of META_PATTERNS) {
      if (p.re.test(item.fixDirection)) hits.push(p.name);
    }
    if (hits.length > 0) offenders.push({ index: i, item, hits });
  });

  if (offenders.length === 0) {
    console.log("✓ No subtext_moment items contain meta-narration phrases.");
    console.log("If the audit is still failing, the trigger may be in a non-subtext item; re-check audit output.");
    process.exit(0);
  }

  console.log(`Found ${offenders.length} offending subtext_moment item(s):\n`);
  for (const { index, item, hits } of offenders) {
    console.log(`─── Item #${index} ───`);
    console.log(`  Scene ord:    ${item.existingSceneOrd ?? "(pilot-level)"}`);
    console.log(`  Slugline:     ${item.existingSlugline ?? "—"}`);
    console.log(`  Character:    ${item.character ?? "—"}`);
    console.log(`  Severity:     ${item.severity ?? "—"} / Scope: ${item.scope ?? "—"}`);
    console.log(`  Diagnosis:    ${item.diagnosis}`);
    console.log(`  fixDirection: ${item.fixDirection}`);
    console.log(`  ⚠ Meta hits:  ${hits.join(", ")}`);
    console.log();
  }

  // Also list ALL subtext items for context (in case there are
  // additional candidates the audit's regex doesn't catch but the
  // user wants tightened).
  const allSubtext = pass.r8VoicePolish.items
    .map((it, i) => ({ i, it }))
    .filter(({ it }) => it.category === "subtext_moment");
  console.log(`(For reference — all ${allSubtext.length} subtext_moment items in the plan):`);
  for (const { i, it } of allSubtext) {
    const flag = offenders.find((o) => o.index === i) ? " ⚠" : "";
    console.log(`  #${i}${flag} — ${it.existingSlugline ?? `(pilot-level)`}: ${it.fixDirection.slice(0, 100)}${it.fixDirection.length > 100 ? "…" : ""}`);
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
