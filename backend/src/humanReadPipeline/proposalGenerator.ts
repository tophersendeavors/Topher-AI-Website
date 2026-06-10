// Change Proposal generator. Converts a Human Read (Audience Read) report
// into discrete, creator-approvable Change Proposals. It NEVER rewrites —
// it only proposes. Reusable across projects: all show-specific canon is
// passed in via `canonContext`, nothing is hard-coded.

import { callLLM, extractJSON } from "../llm/provider.js";
import type { AudienceReadReport, ProposalRisk } from "@toburt/shared";

export interface ProposalDraft {
  title: string;
  problem: string;
  evidence: string;
  proposedSolution: string;
  scenesAffected: number[];
  rewriteScope: string;
  protectedElements: string[];
  riskLevel: ProposalRisk;
}

export interface ProposalGenInput {
  report: AudienceReadReport;
  scenes: Array<{ ord: number; heading: string }>;
  /** Generic canon/guardrail blob assembled from whatever the project has
   *  (premise, must-not-change rules, forbidden tones, …). May be empty. */
  canonContext: string;
}

const RISKS: ProposalRisk[] = ["low", "medium", "high"];

export async function generateChangeProposals(input: ProposalGenInput): Promise<ProposalDraft[]> {
  const { report, scenes, canonContext } = input;

  const sceneList = scenes.map((s) => `${s.ord}. ${s.heading}`).join("\n");
  const notesBlock = report.topNotes
    .map((n, i) => `${i + 1}. ${n.title} — ${n.detail} [scenes ${n.sceneRefs.join(", ") || "—"}]`)
    .join("\n");
  const atRisk = report.dimensions
    .filter((d) => d.verdict === "at_risk")
    .map((d) => `- ${d.label}: ${d.note}`)
    .join("\n");

  const sys = [
    "You are a careful story editor building an APPROVAL BOARD. You convert a",
    "Human Read report into discrete Change Proposals for the creator to",
    "approve or reject. You DO NOT rewrite anything. You only propose.",
    "",
    "Rules for good proposals:",
    "- One proposal per actionable note. Do not invent issues the report did not raise.",
    "- Keep rewrite scope as SMALL as possible — name the specific scenes.",
    "- Be conservative. Prefer the lightest intervention that addresses the note.",
    "- Fill protectedElements with what must NOT change while applying this fix —",
    "  draw from the provided canon and the script's evident discipline (e.g.",
    "  restraint, no exposition, established character rules). These are guardrails",
    "  that keep a rewrite from over-correcting.",
    "- riskLevel reflects how easily the fix could damage the work if overplayed.",
    "",
    "Return JSON shaped EXACTLY as:",
    '{ "proposals": [',
    "  {",
    '    "title": string,               // short imperative, e.g. "Surface the archive-room mystery"',
    '    "problem": string,             // the issue, 1-2 sentences',
    '    "evidence": string,            // what the Human Read observed (paraphrase the note)',
    '    "proposedSolution": string,    // the smallest change that addresses it',
    '    "scenesAffected": number[],    // scene ords',
    '    "rewriteScope": string,        // explicit boundary, e.g. "Scenes 4-5 only; optional echo later"',
    '    "protectedElements": string[], // what must not change',
    '    "riskLevel": "low"|"medium"|"high"',
    "  }",
    "] }",
  ].join("\n");

  const user = [
    "HUMAN READ REPORT",
    `Binge score: ${report.bingeScore}`,
    `Overall: ${report.bingeVerdict}`,
    `Opening hook: ${report.hookVerdict}`,
    `Ending: ${report.endingVerdict}`,
    "",
    "ACTIONABLE NOTES (make one proposal per note):",
    notesBlock || "(none)",
    "",
    atRisk ? `AT-RISK RUBRIC DIMENSIONS (use as supporting evidence):\n${atRisk}` : "",
    "",
    "SCENES (ord. heading):",
    sceneList,
    "",
    canonContext
      ? `SHOW CANON / GUARDRAILS (source of protectedElements — do not propose anything that violates these):\n${canonContext}`
      : "SHOW CANON: (none provided — derive protectedElements from the script's evident discipline)",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 4000,
  });

  const parsed = extractJSON<{ proposals?: unknown[] }>(res.text);
  const out: ProposalDraft[] = [];
  for (const raw of parsed.proposals ?? []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const title = str(m.title);
    if (!title) continue;
    out.push({
      title,
      problem: str(m.problem),
      evidence: str(m.evidence),
      proposedSolution: str(m.proposedSolution),
      scenesAffected: intList(m.scenesAffected),
      rewriteScope: str(m.rewriteScope),
      protectedElements: strList(m.protectedElements),
      riskLevel: RISKS.includes(m.riskLevel as ProposalRisk) ? (m.riskLevel as ProposalRisk) : "medium",
    });
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter(Boolean);
}
function intList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}
