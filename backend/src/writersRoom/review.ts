// Review Bench engine. Each quality agent runs against the project's current
// draft and produces a structured finding: diagnosis + notes, and — when its
// authority allows — a concrete rewrite option (before → after). Applying a
// rewrite is gated on creator approval (the apply endpoint).

import { config } from "../config.js";
import { supabase } from "../db/client.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import {
  reviewAuthorityOf,
  type ReviewAuthority,
  type ReviewFinding,
  type ReviewRun,
  type WritersRoomState,
} from "@toburt/shared";
import { QUALITY_STAFF } from "./profiles.js";
import { getWritersRoomState, saveReviewRun, setReviewBench } from "./store.js";

const MAX_DRAFT_CHARS = 24_000;

/** The draft being worked on (pinned working draft, else current, else latest). */
async function loadProjectDraft(projectId: string, preferredId?: string | null): Promise<{ scriptId: string | null; label: string | null; text: string }> {
  const { data } = await supabase
    .from("scripts")
    .select("id, fountain, draft_number, current, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []) as Array<{ id: string; fountain: string | null; draft_number: number | null; current: boolean | null }>;
  const script = (preferredId ? rows.find((r) => r.id === preferredId) : null) ?? rows.find((r) => r.current) ?? rows[0];
  if (!script) return { scriptId: null, label: null, text: "" };
  return {
    scriptId: script.id,
    label: `Draft ${script.draft_number ?? 1}`,
    text: (script.fountain ?? "").slice(0, MAX_DRAFT_CHARS),
  };
}

// Per-agent focus. Keyed by the QUALITY_STAFF id.
const AGENT_FOCUS: Record<string, string> = {
  character: "Whether on-page behavior matches each character's wound, desire, fear, contradiction and relationship history. Flag any action that betrays who the character is.",
  character_wound: "Whether the wound each character is avoiding is dramatized (not stated), and what it costs them in this draft.",
  dialogue: "On-the-nose lines, flat voice, and dialogue that all sounds the same. Sharpen voice and rhythm; make stated emotion indirect.",
  subtext: "Lines that say the feeling out loud. Replace with behavior/indirection that carries the same meaning underneath.",
  emotional_truth: "Whether each emotional beat is earned and motivated by what came before. Flag unearned turns.",
  relationship_tension: "Power shifts and what goes unsaid between characters. Flag where the unspoken is missing or over-explained.",
  continuity: "Timeline, prop, location and behavioral inconsistencies; scene-order and fact contradictions.",
  script_doctor: "Structure, pacing, weak/soft scenes, and momentum. Diagnose the biggest structural problem and fix the worst offender.",
  audience: "Whether a binge viewer cares, anticipates, worries, or wants more — hook strength, attachment, and drift/drop-off risk.",
};

function authorityClause(authority: ReviewAuthority): string {
  switch (authority) {
    case "observe":
      return "You may ONLY observe. Return diagnosis + notes. Set rewriteOption to null.";
    case "recommend":
      return "You may recommend. Return diagnosis + notes describing the change you'd make. Set rewriteOption to null (you don't write the fix yourself).";
    case "rewrite":
    case "rewrite_requires_approval":
      return "If you can safely fix the single worst offending moment, you MUST return a concrete rewriteOption with the exact before text (verbatim from the draft, or null if adding) and the after text. Otherwise set rewriteOption to null.";
  }
}

const FINDING_SCHEMA = {
  name: "review_finding",
  schema: {
    type: "object",
    properties: {
      diagnosis: { type: "string" },
      notes: { type: "array", items: { type: "string" } },
      rewriteOption: {
        type: ["object", "null"],
        properties: {
          targetLabel: { type: "string" },
          before: { type: ["string", "null"] },
          after: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["targetLabel", "after", "rationale"],
      },
      confidence: { type: "number" },
    },
    required: ["diagnosis", "notes", "confidence"],
  },
} as const;

export async function runReviewAgent(projectId: string, agentId: string): Promise<WritersRoomState> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown review agent.");
  const authority = reviewAuthorityOf(agent.rewriteAuthority);
  const state = await getWritersRoomState(projectId);
  const draft = await loadProjectDraft(projectId, state.writeFlow.draftScriptId);

  let finding: ReviewFinding;
  if (!draft.text.trim()) {
    finding = {
      diagnosis: "There's no draft to review yet. Start or upload a draft, then run this pass.",
      notes: [],
      rewriteOption: null,
      confidence: 1,
    };
  } else {
    const system = [
      `You are the ${agent.name} — ${agent.role} — on a film/TV studio's script staff.`,
      `Focus: ${AGENT_FOCUS[agentId] ?? agent.specialty}`,
      authorityClause(authority),
      "Be specific and reference scenes/lines. Confidence is 0..1. Return JSON only.",
    ].join("\n");
    const res = await callLLM({
      model: config.SCENE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Review this draft (${draft.label}). Return your finding as JSON.\n\n--- DRAFT ---\n${draft.text}` },
      ],
      jsonSchema: FINDING_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
      temperature: 0.4,
      maxTokens: 1200,
    });
    const parsed = extractJSON<Partial<ReviewFinding>>(res.text);
    finding = {
      diagnosis: parsed.diagnosis?.trim() || "No diagnosis returned.",
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 8) : [],
      rewriteOption:
        authority === "observe" || authority === "recommend" || !parsed.rewriteOption
          ? null
          : {
              targetLabel: parsed.rewriteOption.targetLabel ?? "Suggested fix",
              before: parsed.rewriteOption.before ?? null,
              after: parsed.rewriteOption.after ?? "",
              rationale: parsed.rewriteOption.rationale ?? "",
            },
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    };
  }

  const run: ReviewRun = {
    agentId,
    status: "done",
    authority,
    finding,
    applied: false,
    ranAt: new Date().toISOString(),
    appliedAt: null,
  };
  return saveReviewRun(projectId, run);
}

export async function skipReviewAgent(projectId: string, agentId: string): Promise<WritersRoomState> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown review agent.");
  const existing = (await getWritersRoomState(projectId)).reviewBench.find((r) => r.agentId === agentId);
  return saveReviewRun(projectId, {
    agentId,
    status: "skipped",
    authority: reviewAuthorityOf(agent.rewriteAuthority),
    finding: existing?.finding ?? null,
    applied: existing?.applied ?? false,
    ranAt: existing?.ranAt ?? null,
    appliedAt: existing?.appliedAt ?? null,
  });
}

export async function resetReviewAgent(projectId: string, agentId: string): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  return setReviewBench(projectId, state.reviewBench.filter((r) => r.agentId !== agentId));
}

/** Re-generate the fix for a finding, steered by the creator's notes. Updates
 *  the stored rewrite option (and un-applies it, since it's a new version). */
export async function rewriteFinding(projectId: string, agentId: string, notes?: string): Promise<WritersRoomState> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown review agent.");
  const state = await getWritersRoomState(projectId);
  const run = state.reviewBench.find((r) => r.agentId === agentId);
  if (!run?.finding) throw new Error("Run this pass first, then rewrite.");
  const draft = await loadProjectDraft(projectId, state.writeFlow.draftScriptId);
  const before = run.finding.rewriteOption?.before ?? null;
  const targetLabel = run.finding.rewriteOption?.targetLabel ?? agent.role;

  const system = `You are the ${agent.name} — ${agent.role} — on a studio script staff. You flagged this: ${run.finding.diagnosis}\nRewrite the passage to fix it, honoring your craft. Return ONLY the rewritten passage in Fountain — no preamble, no commentary.`;
  const user = [
    `Draft (for context):\n${draft.text.slice(-8000)}`,
    before ? `Passage to rewrite (verbatim from the draft):\n${before}` : `Rewrite the specific moment your diagnosis refers to (${targetLabel}).`,
    notes?.trim() ? `The creator's steering notes — follow them closely:\n${notes.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0.7,
    maxTokens: 1200,
  });
  const after = res.text.trim();
  return saveReviewRun(projectId, {
    ...run,
    status: "done",
    applied: false,
    finding: { ...run.finding, rewriteOption: { targetLabel, before, after, rationale: notes?.trim() || run.finding.rewriteOption?.rationale || "" } },
  });
}

/** Creator approves + applies the agent's rewrite option. */
export async function applyReviewRewrite(projectId: string, agentId: string): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  const run = state.reviewBench.find((r) => r.agentId === agentId);
  if (!run || !run.finding?.rewriteOption) throw new Error("No rewrite option to apply.");
  return saveReviewRun(projectId, {
    ...run,
    applied: true,
    status: "done",
    appliedAt: new Date().toISOString(),
  });
}
