// Active AI writing collaboration. A seated AI Writer / AI Creative develops the
// creator's concept into an approved outline, then drafts from it. "Start From
// Concept" never opens a blank editor — it runs this guided flow.

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { supabase } from "../db/client.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import { indexScenes } from "../screenplay/sceneIndex.js";
import type {
  ConceptBrief,
  OutlineBeat,
  WriteFlowCollaborator,
  WritersRoomState,
} from "@toburt/shared";
import { STUDIO_AI_WRITER, WRITING_CREATIVES } from "./profiles.js";
import { getWritersRoomState, saveWriteFlow } from "./store.js";

/** Build a concept brief from the project when the creator hasn't filled one. */
export async function conceptDefaults(projectId: string): Promise<ConceptBrief> {
  const { data } = await supabase
    .from("projects")
    .select("title, logline, genre, tone, kind, metadata")
    .eq("id", projectId)
    .maybeSingle();
  const p = (data ?? {}) as { title?: string; logline?: string; genre?: string[] | null; tone?: string[] | null; kind?: string; metadata?: Record<string, unknown> | null };
  const projectType = (p.metadata?.projectType as string | undefined) ?? p.kind ?? "";
  return {
    title: p.title ?? "",
    format: projectType,
    genre: (p.genre ?? []).join(", "),
    tone: (p.tone ?? []).join(", "),
    logline: p.logline ?? "",
    premise: "",
    targetLength: "",
  };
}

export async function saveConcept(projectId: string, concept: ConceptBrief): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  return saveWriteFlow(projectId, { ...state.writeFlow, concept, status: state.writeFlow.outline ? state.writeFlow.status : "concept" });
}

/** Find the seated AI collaborator (prefer an AI Creative). */
export function resolveCollaborator(state: WritersRoomState, seatId?: string): { ref: WriteFlowCollaborator; creativeIdx: number } | null {
  const seats = state.seats.filter((s) => s.kind === "ai_creative" || s.kind === "ai_writer");
  const seat = seatId
    ? seats.find((s) => s.seatId === seatId)
    : seats.find((s) => s.kind === "ai_creative") ?? seats.find((s) => s.kind === "ai_writer");
  if (!seat) return null;
  if (seat.kind === "ai_creative") {
    const idx = WRITING_CREATIVES.findIndex((c) => c.id === seat.ref.id);
    const c = WRITING_CREATIVES[idx];
    return {
      ref: { kind: "ai_creative", id: seat.ref.id, seatId: seat.seatId, name: seat.name, lens: c ? `${c.style} — ${c.tasteProfile}` : null },
      creativeIdx: idx,
    };
  }
  return { ref: { kind: "ai_writer", id: seat.ref.id, seatId: seat.seatId, name: seat.name, lens: null }, creativeIdx: -1 };
}

export function collaboratorSystem(collab: WriteFlowCollaborator, creativeIdx: number): string {
  if (collab.kind === "ai_creative" && creativeIdx >= 0) {
    const c = WRITING_CREATIVES[creativeIdx];
    return [
      `You are ${c.name}, a ${c.role} on a studio writing staff. Write through YOUR specific lens.`,
      `Style: ${c.style}`,
      `Taste: ${c.tasteProfile}`,
      `Strengths: ${c.strengths.join(", ")}`,
      `Boundaries: ${c.boundaries.join(", ")}`,
      `Your voice sounds like: ${c.sampleVoice}`,
    ].join("\n");
  }
  return `You are the ${STUDIO_AI_WRITER.name}. Write using the project's creative foundation and the creator's intent. ${STUDIO_AI_WRITER.description}`;
}

function conceptText(concept: ConceptBrief): string {
  return [
    `Title: ${concept.title || "(untitled)"}`,
    `Format: ${concept.format || "(unspecified)"}`,
    `Genre: ${concept.genre || "(unspecified)"}`,
    `Tone: ${concept.tone || "(unspecified)"}`,
    `Logline: ${concept.logline || "(none yet)"}`,
    `Premise: ${concept.premise || "(none yet)"}`,
    `Target length: ${concept.targetLength || "(unspecified)"}`,
  ].join("\n");
}

const OUTLINE_SCHEMA = {
  name: "outline",
  schema: {
    type: "object",
    properties: {
      beats: {
        type: "array",
        items: {
          type: "object",
          properties: { heading: { type: "string" }, summary: { type: "string" } },
          required: ["heading", "summary"],
        },
      },
    },
    required: ["beats"],
  },
} as const;

export async function generateOutline(projectId: string, seatId?: string, notes?: string): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  const resolved = resolveCollaborator(state, seatId);
  if (!resolved) throw new Error("Seat an AI Writer or AI Creative first — they develop the outline with you.");
  const concept = state.writeFlow.concept ?? (await conceptDefaults(projectId));
  const steer = notes?.trim()
    ? `\n\nThe creator gave steering notes for this outline — follow them closely:\n${notes.trim()}`
    : "";

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: `${collaboratorSystem(resolved.ref, resolved.creativeIdx)}\n\nDevelop the creator's concept into a beat OUTLINE (not prose). 8–12 beats, in order, each with a short heading and a 1–2 sentence summary. Return JSON only.` },
      { role: "user", content: `Concept:\n${conceptText(concept)}${steer}\n\nReturn { "beats": [{ "heading", "summary" }] }.` },
    ],
    jsonSchema: OUTLINE_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    temperature: 0.7,
    maxTokens: 1600,
  });
  const parsed = extractJSON<{ beats?: Array<{ heading?: string; summary?: string }> }>(res.text);
  const beats: OutlineBeat[] = (parsed.beats ?? []).slice(0, 16).map((b) => ({
    id: randomUUID(),
    heading: (b.heading ?? "Beat").trim(),
    summary: (b.summary ?? "").trim(),
  }));

  return saveWriteFlow(projectId, {
    ...state.writeFlow,
    concept,
    status: "outline",
    outline: { beats, collaborator: resolved.ref, approved: false, generatedAt: new Date().toISOString(), approvedAt: null },
  });
}

export async function approveOutline(projectId: string): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  if (!state.writeFlow.outline) throw new Error("There's no outline to approve yet.");
  return saveWriteFlow(projectId, {
    ...state.writeFlow,
    outline: { ...state.writeFlow.outline, approved: true, approvedAt: new Date().toISOString() },
  });
}

export async function generateDraftFromOutline(projectId: string, notes?: string): Promise<{ state: WritersRoomState; scriptId: string }> {
  const state = await getWritersRoomState(projectId);
  const outline = state.writeFlow.outline;
  if (!outline || !outline.approved) throw new Error("Approve the outline before drafting.");
  const concept = state.writeFlow.concept ?? (await conceptDefaults(projectId));
  const resolved = resolveCollaborator(state, outline.collaborator?.seatId);
  const sys = resolved ? collaboratorSystem(resolved.ref, resolved.creativeIdx) : collaboratorSystem({ kind: "ai_writer", id: "studio_ai_writer", seatId: "", name: STUDIO_AI_WRITER.name, lens: null }, -1);
  const steer = notes?.trim() ? `\n\nThe creator gave steering notes for the draft — follow them closely:\n${notes.trim()}` : "";

  const beatList = outline.beats.map((b, i) => `${i + 1}. ${b.heading} — ${b.summary}`).join("\n");
  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: `${sys}\n\nWrite the actual screenplay in FOUNTAIN format from the approved outline, honoring your lens. Use scene headings in CAPS (INT./EXT. — LOCATION — TIME). Cover every beat in order. Producible, filmable, no camera directions. Return ONLY the Fountain screenplay text.` },
      { role: "user", content: `Concept:\n${conceptText(concept)}\n\nApproved outline:\n${beatList}${steer}\n\nWrite the first draft now.` },
    ],
    temperature: 0.8,
    maxTokens: 6000,
  });
  const fountain = res.text.trim();

  const title = `${concept.title || "Untitled"} — Draft`;
  const { data, error } = await supabase
    .from("scripts")
    .insert({ project_id: projectId, title, fountain })
    .select("id")
    .single();
  if (error) throw error;
  const scriptId = (data as { id: string }).id;
  await indexScenes(scriptId, fountain);

  const next = await saveWriteFlow(projectId, { ...state.writeFlow, status: "drafted", draftScriptId: scriptId });
  return { state: next, scriptId };
}
