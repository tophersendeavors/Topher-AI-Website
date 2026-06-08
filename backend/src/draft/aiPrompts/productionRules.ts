// Project-level production rules (prefer / avoid). These come from the
// loaded protocol preset (e.g. SELVAJE) but are stored on the project so
// the writer can edit them. The router penalises models whose strengths
// match items on the AVOID list; adapters inject prefer / avoid lines
// into the prompt body so the model is steered before generation.

import { supabase } from "../../db/client.js";

export interface ProductionRules {
  prefer: string[];
  avoid: string[];
}

const EMPTY: ProductionRules = { prefer: [], avoid: [] };

/** Read the project's effective production rules (or empty when none set). */
export async function getProductionRules(projectId: string): Promise<ProductionRules> {
  // Defensive — projects.metadata is added by migration 0012; tolerate its
  // absence so the rest of the system still works.
  try {
    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .maybeSingle();
    const meta = (proj?.metadata as Record<string, unknown> | null) ?? {};
    const rules = (meta.productionRules as ProductionRules | null) ?? EMPTY;
    return {
      prefer: rules.prefer ?? [],
      avoid: rules.avoid ?? [],
    };
  } catch {
    return EMPTY;
  }
}

/** Per-project save (merge). */
export async function setProductionRules(
  projectId: string,
  patch: Partial<ProductionRules>
): Promise<ProductionRules> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = ((proj?.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const prev = (meta.productionRules as ProductionRules | null) ?? EMPTY;
  const next: ProductionRules = {
    prefer: patch.prefer ?? prev.prefer,
    avoid: patch.avoid ?? prev.avoid,
  };
  meta.productionRules = next;
  await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
  return next;
}

/**
 * Heuristic penalty: given a model's free-text fields, how much do its
 * STRENGTHS overlap with what the project wants to AVOID? Returns 0..1.
 * Used by the router to soft-penalise models whose strong suits the
 * showrunner has explicitly forbidden.
 */
export function avoidOverlapPenalty(
  modelStrengths: string[],
  avoid: string[]
): { score: number; matched: string[] } {
  if (!avoid.length || !modelStrengths.length) return { score: 0, matched: [] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  const tokens = (s: string) => norm(s).split(/\s+/).filter((t) => t.length > 3);
  const avoidTokens = new Set(avoid.flatMap(tokens));
  const matched: string[] = [];
  for (const strength of modelStrengths) {
    const sTokens = tokens(strength);
    if (sTokens.some((t) => avoidTokens.has(t))) matched.push(strength);
  }
  return { score: Math.min(1, matched.length * 0.25), matched };
}
