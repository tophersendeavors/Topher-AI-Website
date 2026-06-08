import { runAgent } from "../agents/runner.js";
import { producerAgent } from "../agents/producer.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { supabase } from "../db/client.js";
import type { ProducerReport } from "@toburt/shared";

export type ProductionResult = ProducerReport & {
  scriptId: string;
  ranAt: string;
};

/**
 * Run the Producer agent against a saved script. Returns a budget-tier
 * estimate, per-scene production flags (vfx/stunt/location/cast/ai_gen/
 * weather), and AI-gen suitability. Persisted as a memory note for
 * downstream reference.
 */
export async function runProductionPass(
  scriptId: string,
  user?: { id: string; name?: string }
): Promise<ProductionResult> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("id, project_id, title, fountain")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  if (!script.fountain || script.fountain.trim().length < 50) {
    throw new Error(
      "Script is empty. Generate at least one scene before running the Production pass."
    );
  }

  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline, tags, status")
    .eq("script_id", scriptId)
    .in("status", ["generated", "revised", "locked"])
    .order("ord", { ascending: true });
  const sceneIndex = (scenes ?? []).map((s) => ({
    ord: s.ord as number,
    slugline: s.slugline as string,
    characters: (s.tags as string[]) ?? [],
  }));

  const aCtx = await hydrateContext({
    projectId: script.project_id,
    stage: "production_draft",
    collaborators: ["producer", "showrunner"],
    query: script.title,
    user,
  });

  // Analyze the provided draft only — strip stale retrieved snapshots.
  aCtx.retrievedDrafts = [];
  aCtx.retrievedCanon = [];

  const { output } = await runAgent(
    producerAgent,
    { scriptId, draftFountain: script.fountain, sceneIndex },
    aCtx,
    { maxTokens: 6000, maxToolRounds: 1 }
  );

  const report = normalize(output);

  await supabase.from("memory_entries").insert({
    project_id: script.project_id,
    scope: "project" as const,
    scope_ref: scriptId,
    kind: "note" as const,
    body: { kind: "producer_report", ...report },
    approved: false,
  });

  return { ...report, scriptId, ranAt: new Date().toISOString() };
}

function normalize(output: ProducerReport | unknown): ProducerReport {
  const o = (output ?? {}) as Record<string, unknown>;
  const tiers = new Set(["indie", "mid", "studio", "tentpole"]);
  const est = (o.estimate ?? {}) as Record<string, unknown>;
  const tierRaw = String(est.tier ?? "mid").toLowerCase();
  const estimate = {
    tier: (tiers.has(tierRaw) ? tierRaw : "mid") as ProducerReport["estimate"]["tier"],
    reasoning:
      typeof est.reasoning === "string"
        ? est.reasoning
        : typeof o.reasoning === "string"
        ? (o.reasoning as string)
        : "",
  };

  const flagKinds = new Set(["vfx", "stunt", "location", "cast", "ai_gen", "weather"]);
  const rawFlags = Array.isArray(o.flags) ? o.flags : [];
  const flags = rawFlags
    .map((raw) => {
      const f = (raw ?? {}) as Record<string, unknown>;
      const kindRaw = String(f.kind ?? "").toLowerCase();
      if (!flagKinds.has(kindRaw)) return null;
      const note = typeof f.note === "string" ? f.note : "";
      if (!note) return null;
      const sceneIds = Array.isArray(f.sceneIds)
        ? (f.sceneIds as unknown[]).map((s) => String(s))
        : [];
      return {
        kind: kindRaw as "vfx" | "stunt" | "location" | "cast" | "ai_gen" | "weather",
        sceneIds,
        note,
        mitigation: typeof f.mitigation === "string" ? f.mitigation : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const rawAi = Array.isArray(o.aiGen) ? o.aiGen : [];
  const aiGen = rawAi
    .map((raw) => {
      const a = (raw ?? {}) as Record<string, unknown>;
      const sceneId =
        a.sceneId != null
          ? String(a.sceneId)
          : a.scene != null
          ? String(a.scene)
          : "";
      if (!sceneId) return null;
      return {
        sceneId,
        suitable: a.suitable === true,
        notes: typeof a.notes === "string" ? a.notes : "",
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return { estimate, flags, aiGen };
}
