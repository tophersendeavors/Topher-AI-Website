// Production Result tracking — one record per generated clip the writer
// has rendered (or wants to render). Stored under
// script.metadata.aiPrompts.results[]. Keyed by id so updates patch in
// place; new generations append.

import { supabase } from "../../db/client.js";
import type { ProductionResult } from "./types.js";

type Meta = Record<string, unknown>;
const safeMeta = (m: unknown): Meta => ((m ?? {}) as Meta);

function readResults(meta: Meta): ProductionResult[] {
  const ai = safeMeta(meta.aiPrompts);
  return Array.isArray(ai.results) ? (ai.results as ProductionResult[]) : [];
}

async function loadScriptMeta(
  scriptId: string
): Promise<{ projectId: string; meta: Meta }> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("project_id, metadata")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  return {
    projectId: script.project_id as string,
    meta: safeMeta(script.metadata),
  };
}

async function persistMeta(scriptId: string, meta: Meta): Promise<void> {
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);
}

/** Append a new production result. The id is provided by the caller. */
export async function createProductionResult(
  scriptId: string,
  result: Omit<ProductionResult, "createdAt" | "updatedAt">
): Promise<ProductionResult> {
  const { meta } = await loadScriptMeta(scriptId);
  const now = new Date().toISOString();
  const full: ProductionResult = { ...result, createdAt: now, updatedAt: now };
  const ai = safeMeta(meta.aiPrompts);
  const results = readResults(meta);
  results.push(full);
  ai.results = results;
  meta.aiPrompts = ai;
  await persistMeta(scriptId, meta);
  return full;
}

/** Patch an existing result by id. */
export async function updateProductionResult(
  scriptId: string,
  id: string,
  patch: Partial<ProductionResult>
): Promise<ProductionResult> {
  const { meta } = await loadScriptMeta(scriptId);
  const results = readResults(meta);
  const idx = results.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error("Production result not found");
  const updated: ProductionResult = {
    ...results[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  results[idx] = updated;
  const ai = safeMeta(meta.aiPrompts);
  ai.results = results;
  meta.aiPrompts = ai;
  await persistMeta(scriptId, meta);
  return updated;
}

/** List all results for the script (newest first). */
export async function listProductionResults(scriptId: string): Promise<ProductionResult[]> {
  const { meta } = await loadScriptMeta(scriptId);
  return readResults(meta).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
}

/** Remove a result (writer cleanup). */
export async function deleteProductionResult(
  scriptId: string,
  id: string
): Promise<void> {
  const { meta } = await loadScriptMeta(scriptId);
  const results = readResults(meta).filter((r) => r.id !== id);
  const ai = safeMeta(meta.aiPrompts);
  ai.results = results;
  meta.aiPrompts = ai;
  await persistMeta(scriptId, meta);
}
