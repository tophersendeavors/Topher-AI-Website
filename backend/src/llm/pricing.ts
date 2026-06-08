/**
 * Approximate USD pricing per 1M tokens, used to estimate LLM cost for budget
 * caps. These are estimates for in-app guidance, not billing — the real charge
 * is on the provider invoice. Adjust here if rates change.
 */
type Rate = { input: number; output: number };

const RATES: Record<string, Rate> = {
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

function rateFor(model: string): Rate {
  if (RATES[model]) return RATES[model];
  // Prefix match (model ids carry suffixes/dates).
  for (const key of Object.keys(RATES)) {
    if (model.startsWith(key)) return RATES[key];
  }
  // Unknown → assume Sonnet-tier so estimates stay conservative-ish.
  return RATES["claude-sonnet-4-6"];
}

/** Estimated USD cost of a single call given token usage. */
export function estimateCost(
  model: string,
  inputTokens = 0,
  outputTokens = 0
): number {
  const r = rateFor(model);
  return (inputTokens / 1_000_000) * r.input + (outputTokens / 1_000_000) * r.output;
}
