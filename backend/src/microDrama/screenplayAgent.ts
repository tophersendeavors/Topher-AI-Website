// Micro Drama Screenplay Agent.
//
// Takes the writer's APPROVED chain beats verbatim from
// episodes.metadata.microDrama and dramatizes them into a 30–60 second
// vertical-drama screenplay (Fountain format). The chain is the contract —
// the agent may NOT invent new plot, change the twist, change the
// cliffhanger, or reveal anything from WITHHELD.
//
// One LLM call. Pure dramatization, no multi-stage prestige pipeline.

import { config } from "../config.js";
import { callLLM } from "../llm/provider.js";
import type {
  MicroDramaBible,
  MicroDramaEpisodePlan,
} from "@toburt/shared";

export interface GenerateScreenplayInput {
  /** Chain beats from episodes.metadata.microDrama for this episode. */
  chain: Pick<
    MicroDramaEpisodePlan,
    | "episodeNumber"
    | "title"
    | "hook"
    | "setup"
    | "twist"
    | "cliffhanger"
    | "revealedToAudience"
    | "withheldFromAudience"
    | "falseAssumptionReinforcedOrBroken"
  >;
  /** Project-level bible — supplies audience emotion + episode-length target. */
  bible: Pick<
    MicroDramaBible,
    | "hook"
    | "audienceEmotion"
    | "episodeLengthSec"
    | "cliffhangerEngine"
    | "curiosityGap"
  >;
  /** Principal cast (names only) so the agent uses approved cast not invented ones. */
  castNames: string[];
  /**
   * Writer notes for the agent to honor. Optional in "fresh" mode (just
   * influences the new generation), REQUIRED in "patch" mode (the agent
   * needs a directive about what to change).
   */
  notes?: string;
  /**
   * Mode of operation:
   *   "fresh" — generate a new screenplay from the chain. Notes (if any)
   *             steer the new draft. This is the default and matches the
   *             original Generate Screenplay action.
   *   "patch" — start from the writer's existing screenplay and edit ONLY
   *             what the notes call out. Everything else is preserved
   *             verbatim. Closest thing to surgical line-level changes
   *             without building a diff UI.
   */
  mode?: "fresh" | "patch";
  /**
   * The screenplay to patch. Required when mode === "patch". Ignored when
   * mode === "fresh".
   */
  priorFountain?: string;
}

export interface GenerateScreenplayOutput {
  fountain: string;
  rawResponse: string;
  usage?: { input?: number; output?: number };
}

export async function generateMicroDramaScreenplay(
  input: GenerateScreenplayInput
): Promise<GenerateScreenplayOutput> {
  const mode = input.mode ?? "fresh";
  if (mode === "patch" && !input.priorFountain?.trim()) {
    throw new Error(
      "Patch mode requires a prior screenplay (priorFountain). Use mode 'fresh' to generate from scratch."
    );
  }
  const system = buildSystemPrompt(mode);
  const user = buildUserPrompt(input, mode);

  const r = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // Vertical drama is structurally tight — a low temperature keeps the
    // agent inside the chain beats instead of inventing new ones.
    temperature: 0.4,
    // A 30-60s screenplay is ~80-200 words of Fountain. 1500 tokens is
    // generous headroom for the model's preamble drift + the final output.
    maxTokens: 1500,
  });

  const fountain = extractFountain(r.text);
  return { fountain, rawResponse: r.text, usage: r.usage };
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildSystemPrompt(mode: "fresh" | "patch"): string {
  if (mode === "patch") {
    return [
      "You are the Micro Drama Screenplay Agent for TOBURT Studios, in",
      "PATCH MODE. The writer has already approved most of the screenplay.",
      "You receive their existing draft + their notes. Your job is to make",
      "the SMALLEST possible change that satisfies the notes — and to leave",
      "every other line of the screenplay EXACTLY as written.",
      "",
      "PATCH RULES (failure = rejected output):",
      "  • Keep slug lines, character names, and unmentioned action / dialogue",
      "    lines BYTE-FOR-BYTE identical to the writer's draft.",
      "  • Only modify the lines the notes specifically call out.",
      "  • If a note says 'change X to Y', make that change and nothing else.",
      "  • If a note is general (e.g. 'make Maya colder'), modify only the",
      "    lines that carry her voice — never the slug or the cliffhanger.",
      "  • Do NOT change the HOOK opening image. Do NOT change the",
      "    CLIFFHANGER ending image. Those are locked.",
      "  • Do NOT reveal anything from the WITHHELD list — same contract as",
      "    fresh generation.",
      "",
      "FORMAT: Same Fountain rules as fresh generation. Return the FULL",
      "revised screenplay (every line, modified or not) as Fountain text",
      "ONLY. No preamble, no markdown fences, no commentary, no diff",
      "annotations — just the screenplay.",
    ].join("\n");
  }
  return [
    "You are the Micro Drama Screenplay Agent for TOBURT Studios.",
    "You dramatize APPROVED chain beats into a 30–60 second vertical-drama",
    "screenplay for TikTok / Reels.",
    "",
    "THE CHAIN IS A CONTRACT. You MUST:",
    "  • Open on the HOOK as the literal first action / image on screen.",
    "  • Dramatize the SETUP through visible action, not dialogue exposition.",
    "  • Stage the TWIST as a visible on-screen reversal mid-episode.",
    "  • End the screenplay EXACTLY on the CLIFFHANGER. The final line of",
    "    action OR dialogue is the cliffhanger image.",
    "",
    "YOU MAY NOT:",
    "  • Invent a new plot beyond the four beats.",
    "  • Change the twist.",
    "  • Change the cliffhanger.",
    "  • Reveal anything from the WITHHELD list — that information belongs",
    "    to a future episode.",
    "  • Add new characters beyond the approved cast names provided.",
    "  • Write narration, voice-over, or omniscient text.",
    "  • Write monologues longer than 2 lines per character turn.",
    "  • Use parentheticals to explain feelings — show the action instead.",
    "",
    "FORMAT (Fountain):",
    "  • Slug lines in ALL CAPS, e.g. INT. MAYA'S BEDROOM - NIGHT",
    "  • Character names in ALL CAPS above their dialogue.",
    "  • Action lines in sentence case.",
    "  • Keep dialogue under 12 words per line where possible.",
    "  • No scene numbers. No CONTINUED. No page breaks.",
    "  • Cap the entire screenplay at ~15 beats total (action + dialogue lines).",
    "",
    "TONE:",
    "  • Present tense. On-screen action over reported action.",
    "  • Minimal exposition. The audience learns through what they SEE.",
    "  • If the chain says something is shown on a phone screen, write that",
    "    moment as visible action: \"The screen reads: '...'\"",
    "",
    "Return Fountain text ONLY. No preamble. No markdown fences. No commentary.",
  ].join("\n");
}

function buildUserPrompt(
  input: GenerateScreenplayInput,
  mode: "fresh" | "patch"
): string {
  const { chain, bible, castNames, notes, priorFountain } = input;
  const ep = chain.episodeNumber;
  const lines: string[] = [
    mode === "patch"
      ? `Patch Episode ${ep} — "${chain.title}" per the writer's notes below.`
      : `Dramatize Episode ${ep} — "${chain.title}" into a ${bible.episodeLengthSec}-second vertical-drama screenplay.`,
    "",
    "APPROVED CAST (use these names only; do not invent new characters):",
    castNames.length > 0 ? `  ${castNames.join(", ")}` : "  (no cast in bible — use names from the chain beats)",
    "",
    "SERIES BIBLE CONTEXT (for tone — do not paraphrase into dialogue):",
    `  Series hook: ${bible.hook}`,
    `  Audience emotion: ${bible.audienceEmotion}`,
    `  Cliffhanger engine: ${bible.cliffhangerEngine}`,
    bible.curiosityGap ? `  Project curiosity gap: ${bible.curiosityGap}` : "",
    "",
    "═══ THE CHAIN — LOCKED CONTRACT ═══",
    "",
    `HOOK (must open the screenplay): ${chain.hook}`,
    "",
    `SETUP (dramatize through visible action): ${chain.setup}`,
    "",
    `TWIST (must happen on-screen, mid-episode): ${chain.twist}`,
    "",
    `CLIFFHANGER (the screenplay MUST end here): ${chain.cliffhanger}`,
    "",
    "═══ AUDIENCE STATE ═══",
    "",
    chain.revealedToAudience
      ? `Allowed to be shown (this episode): ${chain.revealedToAudience}`
      : "",
    chain.withheldFromAudience
      ? `FORBIDDEN — DO NOT reveal this episode (saved for later): ${chain.withheldFromAudience}`
      : "",
    chain.falseAssumptionReinforcedOrBroken
      ? `False assumption to engage with: ${chain.falseAssumptionReinforcedOrBroken}`
      : "",
  ];

  if (notes && notes.trim()) {
    lines.push(
      "",
      mode === "patch"
        ? "═══ WRITER NOTES — APPLY THESE PRECISELY ═══"
        : "═══ WRITER NOTES — HONOR THESE THIS PASS ═══",
      "",
      notes.trim()
    );
  }

  if (mode === "patch" && priorFountain) {
    lines.push(
      "",
      "═══ EXISTING SCREENPLAY — PRESERVE UNLESS NOTES CALL FOR CHANGE ═══",
      "",
      priorFountain.trim(),
      "",
      "Return the FULL revised screenplay. Every line that the notes did not",
      "ask you to change must be byte-for-byte identical. Fountain format only."
    );
  } else {
    lines.push(
      "",
      `Write the screenplay now. ${bible.episodeLengthSec}-second target. Open on the hook, end on the cliffhanger. Fountain format only.`
    );
  }

  return lines.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// Output cleanup
// ---------------------------------------------------------------------------

/**
 * Strip any preamble (`Here is the screenplay:` etc.), markdown fences, and
 * leading/trailing whitespace from the LLM response. We do NOT modify the
 * Fountain content itself — only the wrapping.
 */
function extractFountain(raw: string): string {
  let s = raw.trim();
  // Strip markdown code fences if present.
  const fence = /^```(?:fountain|fdx|text|markdown)?\s*\n?([\s\S]*?)\n?```$/i.exec(
    s
  );
  if (fence) s = fence[1].trim();
  // Strip a leading "Here is..." style preamble line if present.
  s = s.replace(
    /^(here(?:'?s| is)|below is|the screenplay is|screenplay:?)[^\n]*\n+/i,
    ""
  );
  return s.trim();
}
