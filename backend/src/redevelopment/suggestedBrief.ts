// Suggested Strategy Brief — deterministic composer.
//
// Reads approved R1-R4 + the existing EP01 context and renders a
// pre-filled "Suggested Strategy Brief" as Markdown. The user can
// accept it as their steering note, regenerate it, edit it manually,
// or clear it. The composer is intentionally deterministic — no LLM
// call, no cost, no truncation risk. It just lays out what the
// showrunner already approved into a steering message the agent can
// use verbatim.
//
// Goal: the user shouldn't have to retype context that already exists
// in their approved redevelopment architecture.

import type { ExistingPilotContext } from "./pilotStrategyAgent.js";
import type {
  RedevBrief,
  RedevCharacterBible,
  RedevProtocolModule,
  RedevSeasonArcEpisode,
} from "./types.js";

export interface SuggestedBriefArgs {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: RedevSeasonArcEpisode[];
  existingPilot: ExistingPilotContext;
}

/** Pick the Protocol module that drives the pilot.
 *
 *  Source-of-truth order:
 *    1. R4 `seasonArc[0].protocolModule` — the approved EP01 anchor. This
 *       is the showrunner's locked decision and we must honor it.
 *    2. Fallback to a `possibleEpisodePlacement` hint on approved R3
 *       modules (older heuristic — only used when R4 EP01 is blank).
 *    3. Final fallback: first approved module alphabetically.
 *
 *  Returns both the matched module (when found) and the raw name from
 *  R4 so callers can report a clean error if the R4 name doesn't match
 *  any approved R3 module (e.g. a typo, or the module was renamed).
 */
function pickPilotModule(
  modules: RedevProtocolModule[],
  seasonArc: RedevSeasonArcEpisode[]
): {
  module: RedevProtocolModule | null;
  /** Name(s) extracted from R4 EP01 (in author order). */
  ep1RequestedNames: string[];
  /** True iff the R4 EP01 name did NOT match any approved R3 module. */
  mismatchedR4Name: boolean;
} {
  const approved = modules.filter((m) => !!m.approvedAt);
  const ep1 = seasonArc.find((e) => e.number === 1);
  const requestedNames = (() => {
    if (!ep1 || !ep1.protocolModule) return [];
    // The R4 system prompt allows "two names if applicable", so the
    // field can be "Surrender", "Surrender, Observation", "Surrender /
    // Observation", "Surrender and Observation", etc. Split conservatively.
    return ep1.protocolModule
      .split(/\s*(?:[,;/]|\sand\s|\s&\s)\s*/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  })();

  if (approved.length === 0) {
    return { module: null, ep1RequestedNames: requestedNames, mismatchedR4Name: false };
  }

  // Step 1: try to match the FIRST R4 EP01 name. The first slot is the
  // primary anchor; any second name is a secondary / supporting module.
  for (const requested of requestedNames) {
    const reqLower = requested.toLowerCase();
    // Exact (case-insensitive) match wins outright.
    const exact = approved.find((m) => m.name.toLowerCase() === reqLower);
    if (exact) {
      return { module: exact, ep1RequestedNames: requestedNames, mismatchedR4Name: false };
    }
    // Partial match (one contains the other) — handles "Surrender" vs
    // "Surrender Protocol" naming drift.
    const partial = approved.find((m) => {
      const mn = m.name.toLowerCase();
      return mn.includes(reqLower) || reqLower.includes(mn);
    });
    if (partial) {
      return { module: partial, ep1RequestedNames: requestedNames, mismatchedR4Name: false };
    }
  }

  // Step 2: R4 named a module but nothing matched in approved R3. Flag
  // this as a mismatch so the brief can warn the showrunner — they may
  // need to approve the R3 module first, or fix the spelling in R4.
  if (requestedNames.length > 0) {
    return { module: null, ep1RequestedNames: requestedNames, mismatchedR4Name: true };
  }

  // Step 3: R4 EP01 didn't name a module. Fall back to a possibleEpisodePlacement
  // hint, then the first approved module alphabetically. This path
  // should be rare in a healthy redevelopment pass.
  const hinted = approved.find((m) =>
    /\b(ep(isode)?\s*0?1|pilot)\b/i.test(m.possibleEpisodePlacement ?? "")
  );
  if (hinted) {
    return { module: hinted, ep1RequestedNames: requestedNames, mismatchedR4Name: false };
  }
  return { module: approved[0], ep1RequestedNames: requestedNames, mismatchedR4Name: false };
}

/** Compose the suggested brief as a single Markdown document the user
 *  can paste into the steering note field (or use as-is). Sections
 *  follow the user-spec ordering: engine → pilot priorities → character
 *  plants → module focus → final-hook direction → risks to avoid →
 *  scope reminder. */
export function composeSuggestedBrief(args: SuggestedBriefArgs): string {
  const lines: string[] = [];

  // --- Engine -------------------------------------------------------------
  lines.push("## Current Redevelopment Engine");
  if (args.brief.newCorePrinciple) {
    lines.push(`**Core principle.** ${args.brief.newCorePrinciple}`);
  }
  if (args.brief.protocolPhilosophy) {
    lines.push(`**Protocol philosophy.** ${args.brief.protocolPhilosophy}`);
  }
  if (args.brief.newSeasonQuestion) {
    lines.push(`**Season question.** ${args.brief.newSeasonQuestion}`);
  }
  if (args.brief.audiencePromise) {
    lines.push(`**Audience promise.** ${args.brief.audiencePromise}`);
  }
  lines.push("");

  // --- Major pilot rewrite priorities ------------------------------------
  //
  // Derived from R4 episode1Plants — every load-bearing plant the pilot
  // must establish.
  lines.push("## Major Pilot Rewrite Priorities");
  const plants = args.seasonArc
    .filter((e) => e.episode1Plant && e.episode1Plant.trim().length > 0)
    .map((e) => ({
      ep: e.number,
      title: e.title,
      plant: e.episode1Plant.trim(),
    }));
  if (plants.length === 0) {
    lines.push(
      "_(No episode1Plants yet. Approve the R4 season arc first so the pilot has specific plants to land.)_"
    );
  } else {
    for (const p of plants) {
      lines.push(`- **For EP${String(p.ep).padStart(2, "0")} ${p.title}:** ${p.plant}`);
    }
  }
  lines.push("");

  // --- Character plants required in EP01 ---------------------------------
  //
  // For each approved bible: what the pilot must PLANT (avoidance —
  // behavior the camera can see) versus what is INTERNAL ARCHITECTURE
  // for the showrunner (core wound — never explained in the pilot).
  //
  // R5 is plant-avoidance-not-wound: the pilot plants behavior. The wound
  // surfaces later when the Protocol pressures the avoidance strategy.
  // The brief surfaces core wounds for context only, behind an
  // unambiguous label so the showrunner doesn't accidentally treat them
  // as pilot exposition.
  lines.push("## Character Plants Required in Episode 1");
  lines.push(
    "_Plant avoidance behavior. Do NOT expose wounds — the wound surfaces later when the Protocol pressures the avoidance._"
  );
  const approvedBibles = args.characterBibles.filter((b) => !!b.approvedAt);
  if (approvedBibles.length === 0) {
    lines.push("_(No approved character bibles yet. Approve R2 first.)_");
  } else {
    for (const b of approvedBibles) {
      const wound = b.proposed.coreWound?.trim() || "—";
      const avoid = b.proposed.avoidanceStrategy?.trim() || "—";
      const rev = b.proposed.seasonRevelation?.trim() || "";
      const firstName = b.characterName.split(/\s+/)[0];
      const lines2: string[] = [];
      lines2.push(`- **${b.characterName}.**`);
      // Avoidance is what the pilot plants — first because it's the
      // most useful to the showrunner reading this section.
      lines2.push(`  **Plant in pilot — avoidance behavior:** ${avoid}`);
      // Wound is context only. Labeled so it can't be confused with
      // pilot exposition.
      lines2.push(
        `  **Internal architecture — do not expose in pilot:** ${wound}`
      );
      if (rev) {
        lines2.push(
          `  **Season-arc destination (context only):** ${firstName}'s eventual arc toward: ${rev}`
        );
      }
      lines.push(lines2.join("\n"));
    }
  }
  lines.push("");

  // --- Protocol module focus ---------------------------------------------
  //
  // Drive this from R4 `seasonArc[0].protocolModule` — that's the
  // approved EP01 anchor. Look the matched module up in approved R3,
  // surface its full approved content so the showrunner doesn't have to
  // cross-reference. If the R4 name doesn't match any approved R3
  // module, flag the mismatch instead of silently picking a different
  // module (the earlier heuristic-based picker did this and caused the
  // "Pairing drives the pilot" bug).
  lines.push("## Protocol Module Focus");
  const pick = pickPilotModule(args.protocolModules, args.seasonArc);
  if (pick.module && pick.ep1RequestedNames.length > 0) {
    const m = pick.module;
    lines.push(
      `**${m.name}** drives the pilot's Protocol on-screen presence (from R4 EP01).`
    );
    if (
      pick.ep1RequestedNames.length > 1 &&
      pick.ep1RequestedNames.findIndex(
        (n) => n.toLowerCase() === m.name.toLowerCase()
      ) === 0
    ) {
      const secondary = pick.ep1RequestedNames.slice(1).join(", ");
      lines.push(
        `R4 also names a secondary module on EP01 (${secondary}) — keep it as a supporting beat, not a co-driver.`
      );
    }
    if (m.purpose) lines.push(`- **Purpose.** ${m.purpose}`);
    if (m.psychologicalTarget)
      lines.push(`- **Psychological target.** ${m.psychologicalTarget}`);
    if (m.avoidanceBehaviorStripped)
      lines.push(`- **Avoidance stripped.** ${m.avoidanceBehaviorStripped}`);
    if (m.physicalSomaticExercise)
      lines.push(`- **Physical / somatic exercise.** ${m.physicalSomaticExercise}`);
    if (m.visualExecution)
      lines.push(`- **Visual execution on screen.** ${m.visualExecution}`);
    if (m.truthPressured)
      lines.push(`- **Truth pressured.** ${m.truthPressured}`);
    if (m.dramaticRisks)
      lines.push(`- **Dramatic risks to watch for.** ${m.dramaticRisks}`);
    lines.push("");
    lines.push(
      `**Scope reminder.** The pilot does NOT need to run the full ${m.name} module or explain it to the audience. Demonstrate it through behavior — surrendered objects, empty hands, aborted reaches, visible withdrawal — not through exposition.`
    );
  } else if (pick.mismatchedR4Name) {
    lines.push(
      `_R4 names **${pick.ep1RequestedNames.join(" / ")}** as EP01's protocol module, but no matching approved R3 module was found. Approve the named R3 module (or correct the spelling in R4 EP01.protocolModule) so the pilot has a locked Protocol anchor._`
    );
  } else if (pick.module && pick.ep1RequestedNames.length === 0) {
    // R4 EP01 left protocolModule blank but the heuristic picked one.
    // Flag the upstream gap so the showrunner can fix R4.
    const m = pick.module;
    lines.push(
      `_R4 EP01.protocolModule is blank, so the brief fell back to **${m.name}** based on R3 placement hints. Set R4 EP01.protocolModule explicitly to lock the pilot anchor._`
    );
    if (m.purpose) lines.push(`- **Purpose.** ${m.purpose}`);
    if (m.psychologicalTarget)
      lines.push(`- **Psychological target.** ${m.psychologicalTarget}`);
  } else {
    lines.push(
      "_No approved protocol modules yet. Approve R3 first so the pilot's foundational module is locked._"
    );
  }
  lines.push("");

  // --- Final hook direction ---------------------------------------------
  lines.push("## Final Hook Direction");
  if (args.brief.audiencePromise) {
    lines.push(
      `End the pilot in a way that makes the AudiencePromise legible: _${args.brief.audiencePromise.trim()}_`
    );
  }
  lines.push(
    "Offer at least 2-3 distinct ending candidates. Each should bait EP02 by deepening one mystery, not resolving it."
  );
  lines.push("");

  // --- Risks to avoid ----------------------------------------------------
  lines.push("## Risks to Avoid");
  if (args.brief.solanoRule) {
    lines.push(`- **Solano framing.** ${args.brief.solanoRule}`);
  }
  if (args.brief.forbiddenTones) {
    lines.push(`- **Forbidden tones.** ${args.brief.forbiddenTones}`);
  }
  if (args.brief.mustNotChange) {
    lines.push(`- **Must not change.** ${args.brief.mustNotChange}`);
  }
  // Late-season-reveal protection — derived from approved bibles.
  const paulBible = approvedBibles.find((b) => /paul/i.test(b.characterName));
  if (paulBible && paulBible.proposed.seasonRevelation) {
    lines.push(
      `- **Paul reveal protection.** Plant unease only. Do NOT expose Paul's late-season revelation in the pilot.`
    );
  }
  // Sister-relationship protection — derived from approved bibles.
  const nadiaBible = approvedBibles.find((b) => /nadia/i.test(b.characterName));
  if (nadiaBible) {
    lines.push(
      `- **Elena protection.** Plant Elena as an absence / object / fact. Do NOT reveal the sister relationship in the pilot.`
    );
  }
  lines.push("");

  // --- Pilot draft context ---------------------------------------------
  if (args.existingPilot.scriptId !== null && args.existingPilot.scenes.length > 0) {
    lines.push("## Pilot Draft In Scope");
    lines.push(
      `Strategy is anchored to EP01${
        args.existingPilot.draftNumber != null
          ? ` Draft ${args.existingPilot.draftNumber}`
          : ""
      } — ${args.existingPilot.scenes.length} scene${args.existingPilot.scenes.length === 1 ? "" : "s"} read. Cite scene slugs when recommending changes / preserves / removes.`
    );
    lines.push("");
  }

  // --- Scope reminder ----------------------------------------------------
  lines.push("## Scope Reminder");
  lines.push(
    "R5 produces STRATEGY only — nine prioritized lists. Do not generate screenplay pages, dialogue, scene headings, or action paragraphs. R6 (next phase) will execute these lists as the actual rewrite."
  );

  return lines.join("\n").trim() + "\n";
}
