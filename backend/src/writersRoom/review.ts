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
import { indexScenes } from "../screenplay/sceneIndex.js";

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
      resolved: { type: "boolean" },
    },
    required: ["diagnosis", "notes", "confidence", "resolved"],
  },
} as const;

/** One LLM pass: read the draft text and produce a finding for this agent. */
async function generateFinding(agentId: string, authority: ReviewAuthority, draftLabel: string | null, draftText: string): Promise<ReviewFinding> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId)!;
  if (!draftText.trim()) {
    return { diagnosis: "There's no draft to review yet. Start or upload a draft, then run this pass.", notes: [], rewriteOption: null, confidence: 1, resolved: false };
  }
  const system = [
    `You are the ${agent.name} — ${agent.role} — on a film/TV studio's script staff.`,
    `Focus: ${AGENT_FOCUS[agentId] ?? agent.specialty}`,
    authorityClause(authority),
    "If the draft is already CLEAN on YOUR dimension (no meaningful issue worth a fix), set resolved=true and rewriteOption=null. Otherwise resolved=false.",
    "Be specific and reference scenes/lines. Confidence is 0..1. Return JSON only.",
  ].join("\n");
  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Review this draft (${draftLabel ?? "draft"}). Return your finding as JSON.\n\n--- DRAFT ---\n${draftText}` },
    ],
    jsonSchema: FINDING_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
    temperature: 0.4,
    maxTokens: 1200,
  });
  const parsed = extractJSON<Partial<ReviewFinding>>(res.text);
  const resolved = parsed.resolved === true;
  return {
    diagnosis: parsed.diagnosis?.trim() || "No diagnosis returned.",
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 8) : [],
    rewriteOption:
      resolved || authority === "observe" || authority === "recommend" || !parsed.rewriteOption
        ? null
        : {
            targetLabel: parsed.rewriteOption.targetLabel ?? "Suggested fix",
            before: parsed.rewriteOption.before ?? null,
            after: parsed.rewriteOption.after ?? "",
            rationale: parsed.rewriteOption.rationale ?? "",
          },
    confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    resolved,
  };
}

async function saveRun(projectId: string, agentId: string, authority: ReviewAuthority, finding: ReviewFinding): Promise<WritersRoomState> {
  return saveReviewRun(projectId, { agentId, status: "done", authority, finding, applied: false, ranAt: new Date().toISOString(), appliedAt: null });
}

export async function runReviewAgent(projectId: string, agentId: string): Promise<WritersRoomState> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown review agent.");
  const authority = reviewAuthorityOf(agent.rewriteAuthority);
  const state = await getWritersRoomState(projectId);
  const draft = await loadProjectDraft(projectId, state.writeFlow.draftScriptId);
  const finding = await generateFinding(agentId, authority, draft.label, draft.text);
  return saveRun(projectId, agentId, authority, finding);
}

export type AutoResolveStatus = "resolved" | "stuck" | "needs_manual" | "maxed" | "no_draft";
export interface AutoResolveResult {
  state: WritersRoomState;
  status: AutoResolveStatus;
  rounds: number;
  changed: boolean;
  fountain: string; // full draft text after the loop (for the editor)
}

/** Fix-and-check loop: run → if not clean, apply the fix → re-run on the updated
 *  draft → repeat until the agent reports resolved, can't apply, or the cap. */
export async function autoResolveFinding(projectId: string, agentId: string, maxRounds = 4): Promise<AutoResolveResult> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown review agent.");
  const authority = reviewAuthorityOf(agent.rewriteAuthority);

  let lastState = await getWritersRoomState(projectId);
  let changed = false;
  let lastFountain = "";
  let status: AutoResolveStatus = "maxed";
  let rounds = 0;

  for (rounds = 1; rounds <= maxRounds; rounds++) {
    const state = await getWritersRoomState(projectId);
    const draft = await loadProjectDraft(projectId, state.writeFlow.draftScriptId);
    if (!draft.text.trim()) { status = "no_draft"; lastState = await runReviewAgent(projectId, agentId); break; }

    const finding = await generateFinding(agentId, authority, draft.label, draft.text);
    lastState = await saveRun(projectId, agentId, authority, finding);

    if (finding.resolved) { status = "resolved"; break; }
    if (!finding.rewriteOption) { status = "needs_manual"; break; } // observe/recommend or no concrete fix

    const applyRes = await applyReviewRewrite(projectId, agentId);
    lastState = applyRes.state;
    if (applyRes.changed) { changed = true; lastFountain = applyRes.fountain; }
    else { status = "stuck"; break; } // couldn't locate the passage — stop honestly
  }

  // Full draft text for the editor (loadProjectDraft slices for the LLM).
  if (changed && !lastFountain) lastFountain = (await loadFullDraft(projectId)) ?? "";
  return { state: lastState, status, rounds, changed, fountain: changed ? lastFountain : "" };
}

async function loadFullDraft(projectId: string): Promise<string | null> {
  const state = await getWritersRoomState(projectId);
  const { data } = await supabase.from("scripts").select("id, fountain, current, updated_at").eq("project_id", projectId).order("updated_at", { ascending: false });
  const rows = (data ?? []) as Array<{ id: string; fountain: string | null; current: boolean | null }>;
  const s = (state.writeFlow.draftScriptId ? rows.find((r) => r.id === state.writeFlow.draftScriptId) : null) ?? rows.find((r) => r.current) ?? rows[0];
  return s?.fountain ?? null;
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
export async function rewriteFinding(projectId: string, agentId: string, notes?: string, regenerate?: boolean): Promise<WritersRoomState> {
  const agent = QUALITY_STAFF.find((a) => a.id === agentId);
  if (!agent) throw new Error("Unknown review agent.");
  const state = await getWritersRoomState(projectId);
  const run = state.reviewBench.find((r) => r.agentId === agentId);
  if (!run?.finding) throw new Error("Run this pass first, then rewrite.");
  const draft = await loadProjectDraft(projectId, state.writeFlow.draftScriptId);
  const before = run.finding.rewriteOption?.before ?? null;
  const targetLabel = run.finding.rewriteOption?.targetLabel ?? agent.role;
  const current = run.finding.rewriteOption?.after?.trim() || "";
  const hasNotes = !!notes?.trim();

  let system: string;
  let user: string;
  if (current && hasNotes && !regenerate) {
    // SURGICAL: edit only what the note asks for; keep the rest identical.
    // (This is what stops the "every rewrite brings new changes" loop.)
    system = `You are the ${agent.name} — ${agent.role}. Make a SMALL, TARGETED edit to an existing passage. Change ONLY what the creator's note asks for and keep EVERYTHING else word-for-word identical — do not re-style, re-order, or introduce any other change. Return ONLY the full edited passage in Fountain, no commentary.`;
    user = `Current passage:\n${current}\n\nThe creator's note — apply ONLY this change, nothing else:\n${notes!.trim()}`;
  } else {
    // First fix (or no notes): write a fix for the flagged passage.
    system = `You are the ${agent.name} — ${agent.role}. You flagged this: ${run.finding.diagnosis}\nWrite a focused fix for ONLY that passage, honoring your craft — do not touch the rest of the script. Return ONLY the rewritten passage in Fountain, no commentary.`;
    user = [
      before ? `Passage to fix (verbatim from the draft):\n${before}` : `The specific moment your diagnosis refers to (${targetLabel}).`,
      hasNotes ? `The creator's notes — follow them closely:\n${notes!.trim()}` : "",
      `Draft (for context only — do not rewrite it):\n${draft.text.slice(-6000)}`,
    ].filter(Boolean).join("\n\n");
  }

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: current && hasNotes && !regenerate ? 0.3 : 0.85,
    maxTokens: 1200,
  });
  const after = res.text.trim();
  return saveReviewRun(projectId, {
    ...run,
    status: "done",
    applied: false,
    finding: { ...run.finding, resolved: false, rewriteOption: { targetLabel, before, after, rationale: notes?.trim() || run.finding.rewriteOption?.rationale || "" } },
  });
}

/** Replace `before` with `after` in the draft. Exact first, then whitespace-
 *  flexible. Returns whether it actually matched (so we never pretend). */
function applyReplacement(fountain: string, before: string | null, after: string): { text: string; matched: boolean } {
  if (before && before.trim()) {
    const i = fountain.indexOf(before);
    if (i >= 0) return { text: fountain.slice(0, i) + after + fountain.slice(i + before.length), matched: true };
    // whitespace-flexible: the agent's `before` may differ only in spacing/newlines.
    const escaped = before.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    try {
      const re = new RegExp(escaped);
      if (re.test(fountain)) return { text: fountain.replace(re, () => after), matched: true };
    } catch {
      /* bad regex — fall through */
    }
  }
  return { text: fountain, matched: false };
}

export interface ApplyResult {
  state: WritersRoomState;
  matched: boolean;
  changed: boolean;
  before: string | null;
  after: string;
  fountain: string; // the draft text after apply (unchanged if !matched)
}

/** Creator approves + APPLIES the rewrite into the actual draft text, saves it,
 *  and re-indexes scenes. Only marks the item applied if the text really changed. */
export async function applyReviewRewrite(projectId: string, agentId: string): Promise<ApplyResult> {
  const state = await getWritersRoomState(projectId);
  const run = state.reviewBench.find((r) => r.agentId === agentId);
  const opt = run?.finding?.rewriteOption;
  if (!run || !opt) throw new Error("Run the pass first, then apply.");

  // Resolve the working draft row (pinned, else current, else latest).
  const { data } = await supabase
    .from("scripts")
    .select("id, fountain, current, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []) as Array<{ id: string; fountain: string | null; current: boolean | null }>;
  const script = (state.writeFlow.draftScriptId ? rows.find((r) => r.id === state.writeFlow.draftScriptId) : null) ?? rows.find((r) => r.current) ?? rows[0];
  if (!script) throw new Error("There's no draft to apply to.");

  const fountain = script.fountain ?? "";
  const { text: next, matched } = applyReplacement(fountain, opt.before, opt.after);
  const changed = matched && next !== fountain;

  if (changed) {
    await supabase.from("scripts").update({ fountain: next }).eq("id", script.id);
    try { await indexScenes(script.id, next); } catch { /* keep going; index is best-effort */ }
  }

  const newState = await saveReviewRun(projectId, {
    ...run,
    applied: changed, // "applied" ONLY when the draft text actually changed
    status: "done",
    appliedAt: changed ? new Date().toISOString() : run.appliedAt,
  });

  return { state: newState, matched, changed, before: opt.before, after: opt.after, fountain: changed ? next : fountain };
}
