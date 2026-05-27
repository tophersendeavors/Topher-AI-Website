import { supabase } from "../db/client.js";
import { embed } from "./embeddings.js";
import type {
  MemoryEntry,
  MemoryHit,
  MemoryKind,
  MemoryScope,
} from "@toburt/shared";

export interface MemoryWrite {
  projectId: string;
  scope: MemoryScope;
  scopeRef?: string | null;
  kind: MemoryKind;
  body: unknown;
  text: string;
  approved?: boolean;
  authoredBy?: string | null;
  authoredRole?: string | null;
  supersedesId?: string | null;
}

export interface MemorySearch {
  projectId: string;
  query: string;
  scope?: MemoryScope | MemoryScope[];
  scopeRef?: string;
  kind?: MemoryKind | MemoryKind[];
  approvedOnly?: boolean;
  k?: number;
}

/** Write a memory row with its embedding. */
export async function writeMemory(input: MemoryWrite): Promise<MemoryEntry> {
  const [vec] = await embed([input.text]);
  const version = input.supersedesId
    ? await nextVersion(input.supersedesId)
    : 1;

  const { data, error } = await supabase
    .from("memory_entries")
    .insert({
      project_id: input.projectId,
      scope: input.scope,
      scope_ref: input.scopeRef ?? null,
      kind: input.kind,
      body: input.body,
      text: input.text,
      embedding: vec as unknown as string, // pgvector accepts JSON array
      approved: input.approved ?? false,
      version,
      supersedes_id: input.supersedesId ?? null,
      authored_by: input.authoredBy ?? null,
      authored_role: input.authoredRole ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as MemoryEntry;
}

async function nextVersion(predecessorId: string): Promise<number> {
  const { data, error } = await supabase
    .from("memory_entries")
    .select("version")
    .eq("id", predecessorId)
    .single();
  if (error) throw error;
  return (data?.version ?? 1) + 1;
}

/** Approve a memory row (Showrunner or human action). */
export async function approveMemory(id: string, by?: string) {
  const { error } = await supabase
    .from("memory_entries")
    .update({ approved: true })
    .eq("id", id);
  if (error) throw error;
  void by; // recorded via room_messages elsewhere
}

/** Semantic search across project memory. */
export async function searchMemory(opts: MemorySearch): Promise<MemoryHit[]> {
  const [vec] = await embed([opts.query]);

  const { data, error } = await supabase.rpc("memory_search", {
    p_project_id: opts.projectId,
    p_query_vec: vec as unknown as string,
    p_scope: Array.isArray(opts.scope) ? opts.scope : opts.scope ? [opts.scope] : null,
    p_scope_ref: opts.scopeRef ?? null,
    p_kind: Array.isArray(opts.kind) ? opts.kind : opts.kind ? [opts.kind] : null,
    p_approved_only: opts.approvedOnly ?? false,
    p_k: opts.k ?? 12,
  });

  if (error) {
    // RPC missing? Fall back to an in-memory cosine scan (dev-friendly).
    return await fallbackSearch(opts, vec);
  }
  return (data ?? []) as MemoryHit[];
}

async function fallbackSearch(
  opts: MemorySearch,
  query: number[]
): Promise<MemoryHit[]> {
  const q = supabase
    .from("memory_entries")
    .select("*")
    .eq("project_id", opts.projectId)
    .is("supersedes_id", null)
    .limit(500);

  if (opts.approvedOnly) q.eq("approved", true);
  if (opts.scope) q.in("scope", Array.isArray(opts.scope) ? opts.scope : [opts.scope]);
  if (opts.scopeRef) q.eq("scope_ref", opts.scopeRef);
  if (opts.kind) q.in("kind", Array.isArray(opts.kind) ? opts.kind : [opts.kind]);

  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as Array<MemoryEntry & { embedding: number[] | null }>;
  const scored: MemoryHit[] = rows.map((r) => ({
    ...r,
    similarity: r.embedding ? cosine(query, r.embedding) : 0,
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, opts.k ?? 12);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
