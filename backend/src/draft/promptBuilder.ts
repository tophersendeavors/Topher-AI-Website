// Structured Scene-Generation Prompt Builder.
//
// Assembles a 9-section brief that the Scene agent consumes via the
// canonical-context channel. The format is deliberately rigid so the LLM
// can't drift into a generic "write episode one" prompt — every section is
// named and every section has the rules attached.
//
// Sections (in this order):
//   [SCENE CONTEXT]
//   [CHARACTER STATES]    ← injects Character DNA (wound, mask, fear, cadence)
//   [STORY FUNCTION]
//   [SUBTEXT RULES]
//   [POWER DYNAMIC]
//   [REQUIRED TURN]
//   [TONE / PACING]       ← injects project.tone[] + showrunner_notes
//   [CONTINUITY LOCKS]
//   [FORMAT RULES]        ← always the same restraint contract
//
// The FORMAT RULES section is non-negotiable. It is the same block on every
// generation so a model that doesn't honour them is the model's fault, not
// the prompt's.

import type { CharacterDNA } from "./sceneAudit.js";

export interface PromptSceneContext {
  episode?: number;
  act?: number;
  ord: number;
  slugline: string;
  timeOfDay?: string | null;
  location?: string | null;
}

export interface PromptCharacterState {
  name: string;
  dna?: CharacterDNA | null;
  /** Optional one-liner about what they want at the top of THIS scene. */
  wants?: string | null;
  /** What they refuse to say in this scene. */
  refusesToSay?: string | null;
  /** Entering emotional state. */
  enteringState?: string | null;
}

export interface PromptBriefInput {
  sceneContext: PromptSceneContext;
  characters: PromptCharacterState[];
  /** Required story function (beat purpose). No empty strings. */
  storyFunction: string;
  /** What the scene is REALLY about (the subtext) — optional but recommended. */
  subtextGoal?: string;
  /** Who has leverage / control / emotional advantage and how it shifts. */
  powerDynamic?: string;
  /** Required ending shift or turn. */
  requiredTurn?: string;
  /** Project tone + showrunner_notes — sticky vision. */
  tonePacing: { tone: string[]; showrunnerNotes?: string | null };
  /** Canonical facts that must hold (timeline, locations, relationship state). */
  continuityLocks?: string[];
  /** Props or objects in play (carry emotional weight in restraint cinema). */
  keyProps?: string[];
  /** What happened in the prior scene (concise consequence). */
  previousConsequence?: string;
}

const FORMAT_RULES = [
  "[FORMAT RULES]",
  "These rules are non-negotiable for every scene:",
  "• Do not explain emotions directly.",
  "• Show emotion through behavior, silence, objects, and misdirection.",
  "• Keep dialogue sparse and specific.",
  "• No generic therapy language.",
  "• No melodrama.",
  "• No over-explaining backstory.",
  "• Action lines should usually be three lines or fewer.",
  "• If uncertain, choose restraint over exposition.",
  "• Slugline format: INT./EXT. <LOCATION> - <TIME OF DAY>.",
  "• Character cues in UPPERCASE. Parentheticals minimal — trust the actor.",
].join("\n");

function bullet(items: Array<string | null | undefined>): string {
  return items
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean)
    .map((s) => `• ${s}`)
    .join("\n");
}

function describeCharacter(c: PromptCharacterState): string {
  const lines: string[] = [c.name.toUpperCase()];
  const d = c.dna;
  if (c.enteringState) lines.push(`  entering: ${c.enteringState}`);
  if (c.wants) lines.push(`  wants here: ${c.wants}`);
  if (c.refusesToSay) lines.push(`  refuses to say: ${c.refusesToSay}`);
  if (d?.core_wound) lines.push(`  wound: ${d.core_wound}`);
  if (d?.public_mask) lines.push(`  mask: ${d.public_mask}`);
  if (d?.private_fear) lines.push(`  private fear: ${d.private_fear}`);
  if (d?.speech_cadence) lines.push(`  cadence: ${d.speech_cadence}`);
  if (d?.behavioral_tics?.length) lines.push(`  tics: ${d.behavioral_tics.join(", ")}`);
  if (d?.defensive_strategies?.length)
    lines.push(`  defenses: ${d.defensive_strategies.join(", ")}`);
  if (d?.avoids_saying?.length) lines.push(`  avoids saying: ${d.avoids_saying.join(", ")}`);
  if (d?.how_lies) lines.push(`  how they lie: ${d.how_lies}`);
  if (d?.shows_vulnerability) lines.push(`  vulnerability shows as: ${d.shows_vulnerability}`);
  return lines.join("\n");
}

/**
 * Build the 9-section structured brief that the Scene agent reads alongside
 * the existing brief. Every section is present so a missing section is an
 * explicit "(not specified)" rather than a hole the model fills with cliché.
 */
export function buildSceneBrief(input: PromptBriefInput): string {
  const { sceneContext: s, characters, tonePacing } = input;
  const sceneCtx = bullet([
    s.episode != null ? `Episode ${s.episode}` : null,
    s.act != null ? `Act ${s.act}` : null,
    `Scene #${s.ord}`,
    `Slugline: ${s.slugline}`,
    s.location ? `Location: ${s.location}` : null,
    s.timeOfDay ? `Time of day: ${s.timeOfDay}` : null,
    input.previousConsequence ? `Previous scene consequence: ${input.previousConsequence}` : null,
  ]);

  const charBlock = characters.length
    ? characters.map(describeCharacter).join("\n\n")
    : "(no characters declared — restraint, but the scene must still land)";

  const tone = bullet([
    tonePacing.tone.length ? `Tone tags: ${tonePacing.tone.join(", ")}` : null,
    tonePacing.showrunnerNotes ? `Showrunner notes:\n${tonePacing.showrunnerNotes}` : null,
  ]);

  const continuity = (input.continuityLocks ?? []).length
    ? bullet(input.continuityLocks)
    : "(no carried-in facts)";

  const props = (input.keyProps ?? []).length
    ? `Key props in play: ${(input.keyProps ?? []).join(", ")}`
    : null;

  return [
    "[SCENE CONTEXT]",
    sceneCtx,
    props ? "" : null,
    props,
    "",
    "[CHARACTER STATES]",
    charBlock,
    "",
    "[STORY FUNCTION]",
    input.storyFunction || "(not specified — fill with one sentence and HOLD it)",
    "",
    "[SUBTEXT RULES]",
    input.subtextGoal || "(no explicit subtext given — default: do not say it, show it)",
    "",
    "[POWER DYNAMIC]",
    input.powerDynamic || "(undeclared — one character must end with more leverage than they had)",
    "",
    "[REQUIRED TURN]",
    input.requiredTurn || "(unspecified — at least one axis must shift: decision, secret, leverage, relationship, new problem)",
    "",
    "[TONE / PACING]",
    tone || "(no tone declared)",
    "",
    "[CONTINUITY LOCKS]",
    continuity,
    "",
    FORMAT_RULES,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
}
