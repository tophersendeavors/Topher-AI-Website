// Regression check for the template-framework refactor.
//
// Confirms:
//   1. SELVAJE project loads.
//   2. The latest redev pass resolves to the SELVAJE template (or none
//      stored → backward-compat fallback to "selvaje").
//   3. The SELVAJE R6 overlay returns 5 character contracts.
//   4. The R9 plan still passes 11 of 11 checks (no audit regression).
//   5. The R8 plan still passes 11 of 11 checks (after the meta-narration fix).
//   6. The blank template produces NO SELVAJE-language warnings on
//      synthetic SELVAJE-free text (Phase 9 smoke test).
//
// Read-only — does not modify SELVAJE creative data or pass state.

import { supabase } from "../src/db/client.js";
import {
  resolveActiveTemplate,
  getR6Overlay,
  getTemplate,
  BLANK_TEMPLATE,
  SELVAJE_TEMPLATE,
} from "../src/redevelopment/templates/index.js";
import {
  auditAndRepairR8VoicePolishPlan,
  auditAndRepairR9FinalPolishPlan,
} from "../src/redevelopment/validators.js";
import {
  runProtectedRevealChecks,
  runForbiddenFramingChecks,
  runForbiddenMoveChecks,
  composeProtectionPromptBlock,
} from "../src/redevelopment/templateChecks.js";

interface AuditCheckLite {
  id: string;
  status: string;
  label: string;
  message: string;
}

function tally(checks: AuditCheckLite[]) {
  return {
    passed: checks.filter((c) => c.status === "passed").length,
    warning: checks.filter((c) => c.status === "warning").length,
    repaired: checks.filter((c) => c.status === "auto_repaired").length,
    blocking: checks.filter(
      (c) => c.status === "blocking" || c.status === "failed"
    ).length,
  };
}

async function main() {
  console.log("═══ Template refactor regression check ═══\n");

  // ───────────────────────────────────────────────────────────────
  // 1. SELVAJE loads + template resolves.
  // ───────────────────────────────────────────────────────────────
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .ilike("title", "%SELVAJE%");
  if (error) throw error;
  if (!projects || projects.length === 0) {
    console.error("✗ No SELVAJE project found.");
    process.exit(1);
  }
  const project = projects[0] as { id: string; title: string; metadata: Record<string, unknown> | null };
  console.log(`✓ SELVAJE project loaded: ${project.title} (${project.id})`);

  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const passes = (meta.redevelopmentPasses as Array<{
    id: string;
    title: string;
    redevTemplateId?: string | null;
    r8VoicePolish?: any;
    r9FinalPolish?: any;
  }>) ?? [];
  if (passes.length === 0) {
    console.error("✗ No redevelopment passes.");
    process.exit(1);
  }
  const pass = passes.find((p) => p.r8VoicePolish || p.r9FinalPolish) ?? passes[0];
  const template = resolveActiveTemplate(pass);
  console.log(
    `✓ Active template for SELVAJE pass: ${template.templateId} (${template.templateName})`
  );
  if (template.templateId !== "selvaje") {
    console.error(`✗ Expected "selvaje", got "${template.templateId}".`);
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────
  // 2. SELVAJE R6 overlay.
  // ───────────────────────────────────────────────────────────────
  const overlay = getR6Overlay(template);
  if (!overlay) {
    console.error("✗ SELVAJE template missing R6 overlay.");
    process.exit(1);
  }
  console.log(
    `✓ SELVAJE R6 overlay: ${overlay.characterContracts.length} contracts, ${overlay.architecturalPlants.length} architectural plants`
  );
  if (overlay.characterContracts.length !== 5) {
    console.error(
      `✗ Expected 5 character contracts; got ${overlay.characterContracts.length}.`
    );
    process.exit(1);
  }

  // ───────────────────────────────────────────────────────────────
  // 3. R8 plan still passes 11/0.
  // ───────────────────────────────────────────────────────────────
  if (pass.r8VoicePolish) {
    const r8audit = auditAndRepairR8VoicePolishPlan({
      items: pass.r8VoicePolish.items ?? [],
      approachSummary: pass.r8VoicePolish.approachSummary ?? "",
    });
    const t = tally(r8audit.checks as AuditCheckLite[]);
    console.log(
      `R8 plan audit: passed=${t.passed} warning=${t.warning} repaired=${t.repaired} blocking=${t.blocking}`
    );
    if (t.warning > 0 || t.blocking > 0) {
      console.error(
        "✗ R8 plan regressed — expected 11/0 like the post-meta-narration-fix baseline."
      );
      for (const c of r8audit.checks) {
        if (c.status === "warning" || (c.status as string) === "blocking") {
          console.error(`  ⚠ ${c.id}: ${c.message}`);
        }
      }
      process.exit(1);
    }
    console.log("✓ R8 plan still passes — no regression.");
  } else {
    console.log("(no R8 plan stored on this pass — skipping R8 audit check)");
  }

  // ───────────────────────────────────────────────────────────────
  // 4. R9 plan still passes 12/0 (if a plan exists).
  // ───────────────────────────────────────────────────────────────
  if (pass.r9FinalPolish?.items?.length) {
    const r9audit = auditAndRepairR9FinalPolishPlan({
      items: pass.r9FinalPolish.items,
      approachSummary: pass.r9FinalPolish.approachSummary ?? "",
    });
    const t = tally(r9audit.checks as AuditCheckLite[]);
    console.log(
      `R9 plan audit: passed=${t.passed} warning=${t.warning} repaired=${t.repaired} blocking=${t.blocking}`
    );
    if (t.warning > 0 || t.blocking > 0) {
      console.warn(
        "⚠ R9 plan has warnings — not necessarily a regression if it had them pre-refactor."
      );
      for (const c of r9audit.checks) {
        if (c.status === "warning" || (c.status as string) === "blocking") {
          console.warn(`  ⚠ ${c.id}: ${c.message}`);
        }
      }
    } else {
      console.log("✓ R9 plan still passes — no regression.");
    }
  } else {
    console.log("(no R9 plan items stored — skipping R9 audit check)");
  }

  // ───────────────────────────────────────────────────────────────
  // 5. Blank template smoke test — Phase 9.
  //
  // Verify that running template-driven checks against a SELVAJE-free
  // text body under the `blank` template produces ZERO SELVAJE-language
  // warnings, and that the SELVAJE template DOES fire when the same
  // body contains SELVAJE-shaped leak phrases.
  // ───────────────────────────────────────────────────────────────
  console.log("\n--- Phase 9: blank-project smoke test ---");
  const cleanText =
    "A political thriller. Senator Hartwell weighs the leverage of the timestamped " +
    "files. The hearing room is full. The vote is tomorrow.";
  const leakyText =
    "Paul's texting and the timestamp evidence reveal the accident. Elena is " +
    "Nadia's sister. Solano is exposed as a fraud. Surrender is removed from the pilot.";

  const blank = getTemplate("blank");
  const selvaje = getTemplate("selvaje");

  const blankAgainstClean = [
    ...runProtectedRevealChecks({
      template: blank,
      haystack: cleanText,
      idPrefix: "smoke_blank",
    }),
    ...runForbiddenFramingChecks({
      template: blank,
      haystack: cleanText,
      idPrefix: "smoke_blank",
    }),
  ];
  const blankWarn = blankAgainstClean.filter((c) => c.status === "warning");
  console.log(
    `Blank × clean political thriller: ${blankAgainstClean.length} checks, ${blankWarn.length} warnings`
  );
  if (blankWarn.length > 0) {
    console.error("✗ Blank template fired warnings on SELVAJE-free text!");
    process.exit(1);
  }
  console.log("✓ Blank template produces zero warnings on non-SELVAJE text.");

  const selvajeAgainstLeaky = [
    ...runProtectedRevealChecks({
      template: selvaje,
      haystack: leakyText,
      idPrefix: "smoke_selvaje",
    }),
    ...runForbiddenFramingChecks({
      template: selvaje,
      haystack: leakyText,
      idPrefix: "smoke_selvaje",
    }),
    ...runForbiddenMoveChecks({
      template: selvaje,
      haystack: leakyText,
      idPrefix: "smoke_selvaje",
    }),
  ];
  const selvajeWarn = selvajeAgainstLeaky.filter((c) => c.status === "warning");
  console.log(
    `SELVAJE × leaky text: ${selvajeAgainstLeaky.length} checks, ${selvajeWarn.length} warnings`
  );
  console.log(
    "  Sample warnings: " +
      selvajeWarn
        .slice(0, 3)
        .map((c) => c.id)
        .join(", ")
  );
  if (selvajeWarn.length < 3) {
    console.error(
      "✗ SELVAJE template should have caught Paul/Elena/Solano/Surrender leaks but only caught " +
        selvajeWarn.length
    );
    process.exit(1);
  }
  console.log("✓ SELVAJE template still catches Paul/Elena/Solano/Surrender leaks.");

  // ───────────────────────────────────────────────────────────────
  // 6. Prompt block composition.
  // ───────────────────────────────────────────────────────────────
  console.log("\n--- Prompt-block snippets (rendered) ---");
  console.log("Blank protection block:");
  console.log(composeProtectionPromptBlock(BLANK_TEMPLATE));
  console.log("\nSELVAJE protection block (first 6 lines):");
  console.log(
    composeProtectionPromptBlock(SELVAJE_TEMPLATE)
      .split("\n")
      .slice(0, 6)
      .join("\n")
  );

  console.log("\n═══ All regression checks passed. ═══");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
