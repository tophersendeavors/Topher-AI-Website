import { z } from "zod";
import { supabase } from "../db/client.js";
import { searchMemory, writeMemory } from "../memory/index.js";
import type { ToolDefinition } from "./types.js";

export const retrieveCanon: ToolDefinition<
  { query: string; k?: number; scope?: string },
  { hits: Array<{ id: string; scope: string; kind: string; text: string; similarity: number }> }
> = {
  name: "retrieveCanon",
  description: "Semantic search over the project's approved canon.",
  inputSchema: z.object({
    query: z.string(),
    k: z.number().int().positive().optional(),
    scope: z.string().optional(),
  }),
  async execute(input, ctx) {
    const hits = await searchMemory({
      projectId: ctx.projectId,
      query: input.query,
      approvedOnly: true,
      k: input.k ?? 8,
    });
    return {
      hits: hits.map((h) => ({
        id: h.id,
        scope: h.scope,
        kind: h.kind,
        text: h.text,
        similarity: h.similarity,
      })),
    };
  },
};

export const retrieveDrafts: ToolDefinition<
  { query: string; k?: number },
  { hits: Array<{ id: string; scope: string; kind: string; text: string; similarity: number }> }
> = {
  name: "retrieveDrafts",
  description: "Semantic search over working drafts (not yet canonical).",
  inputSchema: z.object({
    query: z.string(),
    k: z.number().int().positive().optional(),
  }),
  async execute(input, ctx) {
    const hits = await searchMemory({
      projectId: ctx.projectId,
      query: input.query,
      approvedOnly: false,
      k: input.k ?? 8,
    });
    return {
      hits: hits.map((h) => ({
        id: h.id,
        scope: h.scope,
        kind: h.kind,
        text: h.text,
        similarity: h.similarity,
      })),
    };
  },
};

export const proposeCanonChange: ToolDefinition<
  {
    scope: "project" | "season" | "episode" | "scene" | "character" | "location" | "relationship";
    scopeRef?: string;
    kind: "fact" | "rule" | "arc" | "voice" | "wardrobe" | "beat" | "note" | "draft";
    text: string;
    body?: Record<string, unknown>;
  },
  { id: string; awaitingApproval: true }
> = {
  name: "proposeCanonChange",
  description:
    "Persist a draft memory row and request Showrunner/human approval. Only approved rows become canon.",
  inputSchema: z.object({
    scope: z.enum([
      "project",
      "season",
      "episode",
      "scene",
      "character",
      "location",
      "relationship",
    ]),
    scopeRef: z.string().uuid().optional(),
    kind: z.enum([
      "fact",
      "rule",
      "arc",
      "voice",
      "wardrobe",
      "beat",
      "note",
      "draft",
    ]),
    text: z.string().min(1),
    body: z.record(z.unknown()).optional(),
  }),
  async execute(input, ctx) {
    const row = await writeMemory({
      projectId: ctx.projectId,
      scope: input.scope,
      scopeRef: input.scopeRef ?? null,
      kind: input.kind,
      text: input.text,
      body: input.body ?? { text: input.text },
      approved: false,
      authoredBy: ctx.user?.id ?? null,
      authoredRole: ctx.collaborators[0],
    });

    // Always file an approval request for canon-promotable kinds.
    await supabase.from("approvals").insert({
      project_id: ctx.projectId,
      workflow_id: ctx.workflowId ?? null,
      stage_id: ctx.stage ?? null,
      target_kind: "canon_change",
      target_id: row.id,
      payload: { kind: input.kind, scope: input.scope, text: input.text },
      requested_by: "agent",
    });

    return { id: row.id, awaitingApproval: true as const };
  },
};

export const getCharacter: ToolDefinition<
  { id?: string; name?: string },
  { character: Record<string, unknown> | null }
> = {
  name: "getCharacter",
  description: "Look up a character bible by id or name.",
  inputSchema: z.object({
    id: z.string().uuid().optional(),
    name: z.string().optional(),
  }),
  async execute(input, ctx) {
    const q = supabase
      .from("characters")
      .select("*")
      .eq("project_id", ctx.projectId)
      .limit(1);

    if (input.id) q.eq("id", input.id);
    else if (input.name) q.ilike("name", input.name);
    else return { character: null };

    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return { character: data };
  },
};

export const getRelationship: ToolDefinition<
  { a: string; b: string },
  { relationship: Record<string, unknown> | null }
> = {
  name: "getRelationship",
  description: "Get the relationship between two characters by id.",
  inputSchema: z.object({ a: z.string().uuid(), b: z.string().uuid() }),
  async execute(input, ctx) {
    const { data, error } = await supabase
      .from("relationships")
      .select("*")
      .eq("project_id", ctx.projectId)
      .or(`and(a_id.eq.${input.a},b_id.eq.${input.b}),and(a_id.eq.${input.b},b_id.eq.${input.a})`)
      .maybeSingle();
    if (error) throw error;
    return { relationship: data };
  },
};

export const getTimeline: ToolDefinition<
  { from?: string; to?: string },
  { events: Array<{ when?: string; body: string }> }
> = {
  name: "getTimeline",
  description: "Pull approved timeline facts ordered chronologically.",
  inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
  async execute(_input, ctx) {
    const { data, error } = await supabase
      .from("memory_entries")
      .select("body, text")
      .eq("project_id", ctx.projectId)
      .eq("kind", "fact")
      .eq("approved", true)
      .is("supersedes_id", null)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    return {
      events: (data ?? []).map((row) => ({
        when: (row.body as Record<string, unknown> | null)?.["when"] as
          | string
          | undefined,
        body: row.text,
      })),
    };
  },
};

export const tagSceneEntities: ToolDefinition<
  { sceneId: string },
  {
    characters: string[];
    locations: string[];
    props: string[];
  }
> = {
  name: "tagSceneEntities",
  description: "Return the characters, locations and props tagged on a scene.",
  inputSchema: z.object({ sceneId: z.string().uuid() }),
  async execute(input) {
    const { data, error } = await supabase
      .from("script_scenes")
      .select("characters, slugline, tags")
      .eq("id", input.sceneId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { characters: [], locations: [], props: [] };
    return {
      characters: data.characters ?? [],
      locations: [],
      props: (data.tags ?? []).filter((t: string) => t.startsWith("prop:")),
    };
  },
};

export const voiceFingerprint: ToolDefinition<
  { characterId: string; sample: string },
  { score: number; tells: string[] }
> = {
  name: "voiceFingerprint",
  description:
    "Score a dialogue sample against a character's canonical voice fingerprint (0..1).",
  inputSchema: z.object({ characterId: z.string().uuid(), sample: z.string() }),
  async execute(input, ctx) {
    const { data: fp } = await supabase
      .from("character_voice_fingerprints")
      .select("fingerprint, sample_count")
      .eq("character_id", input.characterId)
      .maybeSingle();

    const { data: ch } = await supabase
      .from("characters")
      .select("voice_notes, name")
      .eq("id", input.characterId)
      .maybeSingle();

    void fp;
    void ctx;

    // Heuristic score: lexical overlap with voice_notes. Replaceable with a
    // real classifier later (the schema is ready for true vector fingerprints).
    const notes = (ch?.voice_notes ?? "").toLowerCase();
    const tokens = notes.match(/[a-z']+/g) ?? [];
    const sample = input.sample.toLowerCase();
    const hits = tokens.filter((t: string) => sample.includes(t)).length;
    const score = Math.min(1, hits / Math.max(1, tokens.length || 8));
    return { score, tells: tokens.slice(0, 5) };
  },
};

export const requestApproval: ToolDefinition<
  { targetKind: "artifact" | "canon_change" | "tool_call"; targetId?: string; rationale: string; payload?: Record<string, unknown> },
  { approvalId: string }
> = {
  name: "requestApproval",
  description: "Open a human-in-the-loop approval card for a sensitive action.",
  inputSchema: z.object({
    targetKind: z.enum(["artifact", "canon_change", "tool_call"]),
    targetId: z.string().uuid().optional(),
    rationale: z.string(),
    payload: z.record(z.unknown()).optional(),
  }),
  async execute(input, ctx) {
    const { data, error } = await supabase
      .from("approvals")
      .insert({
        project_id: ctx.projectId,
        workflow_id: ctx.workflowId ?? null,
        stage_id: ctx.stage ?? null,
        target_kind: input.targetKind,
        target_id: input.targetId ?? null,
        payload: { ...(input.payload ?? {}), rationale: input.rationale },
        requested_by: "agent",
      })
      .select("id")
      .single();
    if (error) throw error;
    return { approvalId: data.id };
  },
};

export const vetoOutput: ToolDefinition<
  { rationale: string; target?: string },
  { vetoed: true; rationale: string }
> = {
  name: "vetoOutput",
  description:
    "Showrunner-only: veto another agent's output. Forces the orchestrator to loop back with the rationale.",
  inputSchema: z.object({ rationale: z.string(), target: z.string().optional() }),
  allowedRoles: ["showrunner"],
  async execute(input) {
    return { vetoed: true as const, rationale: input.rationale };
  },
};

export const TOOLBELT: Record<string, ToolDefinition<any, any>> = {
  retrieveCanon,
  retrieveDrafts,
  proposeCanonChange,
  getCharacter,
  getRelationship,
  getTimeline,
  tagSceneEntities,
  voiceFingerprint,
  requestApproval,
  vetoOutput,
};
