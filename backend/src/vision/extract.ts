// Vision Extraction — describes uploaded reference images and proposes
// editable canon text for a specific canon field.
//
// User journey: a Live Person uploads a bedroom photo, picks
// "MAYA'S BEDROOM → Architecture → Wall Color" in the Canon Target
// Picker, and clicks Extract. We run Claude vision on the image with the
// target field's label/description as context, and return a short
// production-ready canon description that the user can edit before
// approving.

import Anthropic from "@anthropic-ai/sdk";
import { config, hasAnthropic } from "../config.js";

export interface VisionExtractArgs {
  imageUrl: string;
  /** Human-readable label of the canon field being filled — e.g.
   *  "Wall Color" or "Comforter". */
  targetLabel: string;
  /** Short description of what kind of value the field expects. */
  targetDescription?: string;
  /** Optional location/subject context — e.g. "MAYA'S BEDROOM". Helps
   *  the model focus on the relevant part of the image. */
  subjectContext?: string;
  /** Optional Visual World Rules so the description stays on-style. */
  worldRulesAesthetic?: string[];
  worldRulesForbidden?: string[];
}

export interface VisionExtractResult {
  /** Suggested canon text — short, concrete, production-ready. */
  suggestedValue: string;
  /** What the model saw in the image overall — for confidence /
   *  debugging. Shown to the user as small print. */
  observed: string;
}

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY! });
  }
  return anthropic;
}

export async function extractCanonFromImage(
  args: VisionExtractArgs
): Promise<VisionExtractResult> {
  if (!hasAnthropic) {
    return {
      suggestedValue: "(vision unavailable — no Anthropic key configured)",
      observed: "(no vision)",
    };
  }
  const client = getAnthropic();

  const systemPrompt = [
    "You are a production designer studying a reference image and",
    "writing ONE specific canonical value for a single visual decision",
    "on a micro-drama set. Output must be short, concrete, filmable, and",
    "consistent shot-to-shot. No headers, no markdown, no bullet lists.",
    args.worldRulesAesthetic?.length
      ? `Visual aesthetic anchors:\n  • ${args.worldRulesAesthetic.join("\n  • ")}`
      : "",
    args.worldRulesForbidden?.length
      ? `Visual forbidden moves:\n  • ${args.worldRulesForbidden.join("\n  • ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const userText = [
    args.subjectContext ? `Subject in scope: ${args.subjectContext}` : "",
    `Field to describe: ${args.targetLabel}`,
    args.targetDescription ? `Field meaning: ${args.targetDescription}` : "",
    "",
    'Return a JSON object with exactly two keys: { "observed": string, "suggestedValue": string }.',
    '"observed" — one short sentence describing what you actually see in the image (for the user to sanity-check).',
    '"suggestedValue" — a short, concrete production-ready value for the field, derived from the image. No fluff.',
  ]
    .filter(Boolean)
    .join("\n");

  // Use Sonnet for vision. Returns content blocks; we parse JSON from text.
  const res = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "url", url: args.imageUrl },
          } as unknown as Anthropic.ImageBlockParam,
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const parsed = tryParseJson(text);
  if (parsed) {
    return {
      suggestedValue: String(parsed.suggestedValue ?? "").trim(),
      observed: String(parsed.observed ?? "").trim(),
    };
  }
  // Fallback: return the raw text as both fields.
  return { suggestedValue: text.trim(), observed: text.trim() };
}

function tryParseJson(s: string): { observed?: string; suggestedValue?: string } | null {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
