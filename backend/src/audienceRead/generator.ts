// Audience Read generator. Reads the locked draft as a first-time bingeing
// viewer and scores it against the comps-grounded rubric. Read-only — it
// produces an analysis, never a rewrite.

import { callLLM, extractJSON } from "../llm/provider.js";
import { AUDIENCE_READ_RUBRIC } from "./rubric.js";
import type {
  AudienceReadDimension,
  AudienceReadNote,
  AudienceSceneBeat,
  AudienceVerdict,
} from "@toburt/shared";

export interface AudienceReadGenInput {
  /** Full screenplay text of the locked draft. */
  fountain: string;
  /** Ordered scene headings, for aligning the engagement curve. */
  scenes: Array<{ ord: number; heading: string }>;
}

/** The analytical fields the LLM produces. Provenance + approval stamps are
 *  added by the store, not the model. */
export interface AudienceReadAnalysis {
  bingeScore: number;
  bingeVerdict: string;
  hookVerdict: string;
  endingVerdict: string;
  engagementCurve: AudienceSceneBeat[];
  dimensions: AudienceReadDimension[];
  topNotes: AudienceReadNote[];
}

const VERDICTS: AudienceVerdict[] = ["strong", "solid", "at_risk"];

export async function generateAudienceRead(
  input: AudienceReadGenInput
): Promise<AudienceReadAnalysis> {
  const { fountain, scenes } = input;
  if (!fountain.trim()) throw new Error("No draft text to read.");

  const rubric = AUDIENCE_READ_RUBRIC;
  const leverLines = rubric.levers
    .map((l) => `- ${l.key} — ${l.label}: ${l.bingeLooksLike} (comp: ${l.compSignal})`)
    .join("\n");
  const sceneList = scenes.map((s) => `${s.ord}. ${s.heading}`).join("\n");

  const sys = [
    "You are an experienced development executive and an honest first-time",
    "bingeing viewer. Read the screenplay below as an audience member deciding",
    "whether to keep watching — NOT as a craft note-giver. Be specific and",
    "honest; flattery is useless. You score the draft against a rubric",
    `distilled from real reviews of comparable shows (${rubric.comps.join(", ")}).`,
    "",
    "RUBRIC LEVERS:",
    leverLines,
    "",
    "KNOWN FAILURE MODES of this genre (watch for them):",
    ...rubric.failureModes.map((f) => `- ${f}`),
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "bingeScore": number,            // 0-100, honest overall bingeability',
    '  "bingeVerdict": string,          // 2-4 sentences: would an audience binge this? where does it grip, where does it risk drift?',
    '  "hookVerdict": string,           // 1-2 sentences on the opening contract',
    '  "endingVerdict": string,         // 1-2 sentences on the episode-end pull',
    '  "engagementCurve": [             // ONE entry per scene, in order',
    '    { "ord": number, "grip": number /*0-5*/, "note": string /*short, why it grips or sags*/ }',
    "  ],",
    '  "dimensions": [                  // ONE entry per rubric lever (use the lever keys)',
    '    { "key": string, "verdict": "strong"|"solid"|"at_risk", "note": string /*1-3 sentences, anchor to scene numbers*/ }',
    "  ],",
    '  "topNotes": [                    // 3-6 actionable notes to raise bingeability',
    '    { "title": string, "detail": string, "sceneRefs": number[] }',
    "  ]",
    "}",
    "",
    "Anchor every claim to scene numbers. Do not rewrite the script.",
  ].join("\n");

  const user = [
    "SCENES (ord. heading):",
    sceneList,
    "",
    "SCREENPLAY:",
    fountain,
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 6000,
  });

  const parsed = extractJSON<Record<string, unknown>>(res.text);
  return coerce(parsed, scenes, rubric.levers);
}

function num(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function intList(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

function coerce(
  raw: Record<string, unknown>,
  scenes: Array<{ ord: number; heading: string }>,
  levers: typeof AUDIENCE_READ_RUBRIC.levers
): AudienceReadAnalysis {
  const headingByOrd = new Map(scenes.map((s) => [s.ord, s.heading]));

  const curveRaw = Array.isArray(raw.engagementCurve) ? raw.engagementCurve : [];
  const curveByOrd = new Map<number, AudienceSceneBeat>();
  for (const r of curveRaw) {
    const m = (r ?? {}) as Record<string, unknown>;
    const ord = Number(m.ord);
    if (!Number.isFinite(ord)) continue;
    curveByOrd.set(ord, {
      ord,
      heading: headingByOrd.get(ord) ?? str(m.heading),
      grip: num(m.grip, 0, 5, 0),
      note: str(m.note),
    });
  }
  // Guarantee one entry per real scene, in order — never silently drop coverage.
  const engagementCurve: AudienceSceneBeat[] = scenes.map(
    (s) =>
      curveByOrd.get(s.ord) ?? {
        ord: s.ord,
        heading: s.heading,
        grip: 0,
        note: "(not scored)",
      }
  );

  const dimsRaw = Array.isArray(raw.dimensions) ? raw.dimensions : [];
  const dimByKey = new Map<string, Record<string, unknown>>();
  for (const r of dimsRaw) {
    const m = (r ?? {}) as Record<string, unknown>;
    const key = str(m.key);
    if (key) dimByKey.set(key, m);
  }
  const dimensions: AudienceReadDimension[] = levers.map((lever) => {
    const m = dimByKey.get(lever.key) ?? {};
    const verdict = VERDICTS.includes(m.verdict as AudienceVerdict)
      ? (m.verdict as AudienceVerdict)
      : "at_risk";
    return { key: lever.key, label: lever.label, verdict, note: str(m.note) };
  });

  const topNotes: AudienceReadNote[] = (Array.isArray(raw.topNotes) ? raw.topNotes : [])
    .map((r) => {
      const m = (r ?? {}) as Record<string, unknown>;
      return { title: str(m.title), detail: str(m.detail), sceneRefs: intList(m.sceneRefs) };
    })
    .filter((n) => n.title || n.detail);

  return {
    bingeScore: Math.round(num(raw.bingeScore, 0, 100, 0)),
    bingeVerdict: str(raw.bingeVerdict),
    hookVerdict: str(raw.hookVerdict),
    endingVerdict: str(raw.endingVerdict),
    engagementCurve,
    dimensions,
    topNotes,
  };
}
