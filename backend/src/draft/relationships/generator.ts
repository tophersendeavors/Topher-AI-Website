// AI Relationship Dynamics agent. Source-grounded (treatment + season arc
// + episodes + character bibles + DNA + wounds + showrunner notes +
// production rules) and tone-aware. Generates the 11 buyer-grade fields
// per pairing — never invents major story turns; flags missing source.
//
// Used by:
//   • Relationships tab → Generate / Regenerate / Regenerate with notes
//   • Field-level regenerate (only fills the requested fields)
//   • Bulk generation for empty core / secondary / all drafts

import { callLLM, extractJSON } from "../../llm/provider.js";
import { config } from "../../config.js";
import { supabase } from "../../db/client.js";

export type Importance = "core" | "secondary" | "optional" | "background";

/** The 11 generated fields. Edited copy preserves the same keys. */
export interface RelationshipDraft {
  nature?: string;
  aWants?: string;
  bWants?: string;
  aWithholds?: string;
  bWithholds?: string;
  coreTension?: string;
  powerDynamic?: string;
  emotionalCost?: string;
  dramaticFunction?: string;
  buyerSummary?: string;
  internalNotes?: string;
  /** Set when a slot is missing source data — UI badges this. */
  missingSourceWarnings?: string[];
}

export const ALL_GEN_FIELDS: (keyof RelationshipDraft)[] = [
  "nature",
  "aWants",
  "bWants",
  "aWithholds",
  "bWithholds",
  "coreTension",
  "powerDynamic",
  "emotionalCost",
  "dramaticFunction",
  "buyerSummary",
  "internalNotes",
];

interface CharacterCtx {
  id: string;
  name: string;
  role?: string | null;
  bio?: string | null;
  wants?: string | null;
  needs?: string | null;
  flaw?: string | null;
  dna?: Record<string, unknown> | null;
  wound?: Record<string, unknown> | null;
}

export interface GeneratorContext {
  projectTitle: string;
  logline?: string | null;
  synopsis?: string | null;
  tone: string[];
  toneStatement?: string | null;
  themes?: string[];
  worldStatement?: string | null;
  seasonArc?: string | null;
  episodes: Array<{ number: number; title?: string; logline?: string }>;
  showrunnerNotes?: string | null;
  productionRules?: { prefer: string[]; avoid: string[] };
  characters: CharacterCtx[];
}

export interface GenerateArgs {
  /** The two characters this pairing covers. */
  a: CharacterCtx;
  b: CharacterCtx;
  /** Existing values — passed to the LLM as "what we already have". Skipped
   *  in source-strict mode so the model can't preserve prior invention. */
  existing?: RelationshipDraft;
  /** Subset of fields to regenerate; when omitted, all fields are written. */
  fields?: (keyof RelationshipDraft)[];
  /** Writer steering for this regen ("make it more adversarial", etc.). */
  notes?: string;
  /** Source context, assembled by the caller. */
  ctx: GeneratorContext;
  /** Strict mode — forbid invented specifics; only use approved source. */
  sourceStrict?: boolean;
}

/** Compact, LLM-readable source manifest. */
function manifestText(ctx: GeneratorContext): string {
  const lines: string[] = [];
  lines.push(`SERIES: ${ctx.projectTitle}`);
  if (ctx.logline) lines.push(`LOGLINE: ${ctx.logline}`);
  if (ctx.synopsis) lines.push(`SYNOPSIS:\n${ctx.synopsis.slice(0, 1400)}`);
  if (ctx.tone.length || ctx.toneStatement) {
    lines.push(
      `TONE: ${ctx.tone.join(", ")}${ctx.toneStatement ? ` — ${ctx.toneStatement}` : ""}`
    );
  }
  if (ctx.themes?.length) lines.push(`THEMES: ${ctx.themes.join("; ")}`);
  if (ctx.worldStatement) lines.push(`WORLD: ${ctx.worldStatement.slice(0, 400)}`);
  if (ctx.seasonArc) lines.push(`SEASON ARC: ${ctx.seasonArc.slice(0, 800)}`);
  if (ctx.episodes.length) {
    lines.push(
      `EPISODES:\n${ctx.episodes
        .slice(0, 10)
        .map((e) => `  ${String(e.number).padStart(2, "0")}: ${e.title ?? "—"} — ${e.logline ?? ""}`)
        .join("\n")}`
    );
  }
  if (ctx.showrunnerNotes)
    lines.push(`SHOWRUNNER NOTES:\n${ctx.showrunnerNotes.slice(0, 700)}`);
  if (ctx.productionRules?.prefer.length)
    lines.push(`PRODUCTION PREFER: ${ctx.productionRules.prefer.join("; ")}.`);
  if (ctx.productionRules?.avoid.length)
    lines.push(`PRODUCTION AVOID: ${ctx.productionRules.avoid.join("; ")}.`);
  return lines.join("\n\n");
}

function characterBlock(c: CharacterCtx): string {
  const lines: string[] = [`${c.name.toUpperCase()}${c.role ? ` (${c.role})` : ""}`];
  if (c.bio) lines.push(`  bio: ${c.bio.slice(0, 400)}`);
  if (c.wants) lines.push(`  wants: ${c.wants}`);
  if (c.needs) lines.push(`  needs: ${c.needs}`);
  if (c.flaw) lines.push(`  flaw: ${c.flaw}`);
  if (c.dna) {
    const d = c.dna as Record<string, unknown>;
    if (d.core_wound) lines.push(`  core wound: ${d.core_wound}`);
    if (d.public_mask) lines.push(`  mask: ${d.public_mask}`);
    if (d.private_fear) lines.push(`  private fear: ${d.private_fear}`);
    if (d.speech_cadence) lines.push(`  cadence: ${d.speech_cadence}`);
    if (Array.isArray(d.behavioral_tics))
      lines.push(`  tics: ${(d.behavioral_tics as string[]).join(", ")}`);
    if (Array.isArray(d.avoids_saying))
      lines.push(`  avoids saying: ${(d.avoids_saying as string[]).join(", ")}`);
    if (d.how_lies) lines.push(`  how they lie: ${d.how_lies}`);
    if (d.shows_vulnerability)
      lines.push(`  vulnerability shows as: ${d.shows_vulnerability}`);
  }
  if (c.wound) {
    const w = c.wound as Record<string, unknown>;
    if (w.wound) lines.push(`  wound: ${w.wound}`);
    if (w.fear) lines.push(`  fear: ${w.fear}`);
    if (w.unmetNeed || w.unmet_need)
      lines.push(`  unmet need: ${w.unmetNeed ?? w.unmet_need}`);
    if (w.shameTrigger || w.shame_trigger)
      lines.push(`  shame trigger: ${w.shameTrigger ?? w.shame_trigger}`);
  }
  return lines.join("\n");
}

const VOICE_RULES = [
  "VOICE: prestige psychological thriller — restrained, not melodramatic.",
  "Subtext over exposition. Power dynamics matter. No generic therapy language.",
  "No cartoon villains. Antagonists must read sincere, not evil. Protagonists",
  "must stay defended, intelligent, and controlled. Every relationship clarifies",
  "what each person WANTS, WITHHOLDS, and RISKS — concrete and specific.",
  "Keep field copy short and specific (1–3 sentences). The buyer-facing summary",
  "is one taut paragraph a network reader can grasp in fifteen seconds.",
].join("\n");

// Source-strict mode is engaged when the writer says "remove unsourced
// specifics" or otherwise wants near-approval-ready output. The strict
// rules forbid common LLM tells for invention.
const STRICT_RULES = [
  "SOURCE-STRICT MODE — non-negotiable:",
  "• Use ONLY the approved source manifest below. Do NOT invent past events,",
  "  off-screen conversations, pseudonyms, episode beats, discovery",
  "  consequences, backstory wounds, specific scene outcomes, or emotional",
  "  turning points tied to unscripted events.",
  "• Write at the level of EMOTIONAL TRUTH, not specific scene canon. Example:",
  "    ❌ \"Claire withholds the specific thing she said to Paul the night before booking SELVAJE.\"",
  "    ✅ \"Claire withholds the depth of her resentment, fear, and exhaustion inside her marriage.\"",
  "• Forbidden phrases (must NOT appear): \"the night before\", \"the specific",
  "  thing\", \"under a pseudonym\", \"already in her notes\", \"source killed\",",
  "  \"recorder discovery\", \"discovery in Ep\", \"in episode N\", \"scene where\",",
  "  \"episode placement\", \"should (not) end the relationship\", \"will reveal\",",
  "  \"will eventually confess\", \"turning point in episode/act/the season\".",
  "• Do NOT name a specific past event unless it appears verbatim in the",
  "  approved source manifest.",
  "• Do NOT name a specific future scene unless the writer's note explicitly",
  "  asks you to.",
  "• If you're tempted to write a specific invented detail and flag it,",
  "  DON'T. Write a general source-grounded version instead.",
].join("\n");

const FIELD_HINTS: Record<keyof RelationshipDraft, string> = {
  nature:
    "Relationship type — one short phrase. Use the writer's vocabulary: attraction, rivalry, marriage, mirror, adversarial, investigative, emotional foil, mentor-practitioner, etc.",
  aWants:
    "What A actively wants FROM B in this story. Concrete and pursuable, not abstract.",
  bWants:
    "What B actively wants FROM A in this story. Different from A's want, ideally.",
  aWithholds:
    "What A refuses to say or show to B. A specific concealment.",
  bWithholds:
    "What B refuses to say or show to A. A specific concealment.",
  coreTension:
    "The engine of the relationship — the contradiction that won't resolve quickly. One sentence.",
  powerDynamic:
    "Who has leverage, where, and how it shifts. Name the leverage explicitly.",
  emotionalCost:
    "What this relationship COSTS each character emotionally as the season progresses.",
  dramaticFunction:
    "Why this relationship belongs in the show — what story job it does for the season arc.",
  buyerSummary:
    "Buyer-facing paragraph (3–4 sentences) for the deck. Restrained, premium, no clichés. Names the engine and the cost — no spoilers in the closing line.",
  internalNotes:
    "Writers'-room-only notes — instincts, traps, things to test in the room. Never shown to buyers.",
  missingSourceWarnings:
    "Array of short strings — anything the source manifest was missing that you had to skirt around.",
};

/**
 * Run the relationship agent. Returns a partial draft with the requested
 * fields written; fields the caller did NOT request come back unset so the
 * store can preserve any existing edit.
 */
export async function generateRelationship(args: GenerateArgs): Promise<RelationshipDraft> {
  const targets = (args.fields && args.fields.length > 0
    ? args.fields
    : ALL_GEN_FIELDS) as (keyof RelationshipDraft)[];
  const isPartial = targets.length < ALL_GEN_FIELDS.length;

  // In source-strict mode we deliberately DO NOT show the existing copy to
  // the model — that was preserving invented specifics across NotesPass
  // regenerations. The writer's note carries the intent; the source
  // manifest carries the canon.
  const existing = args.sourceStrict ? {} : args.existing ?? {};
  const existingDump = ALL_GEN_FIELDS.map((k) => {
    const v = (existing as Record<string, unknown>)[k];
    return v ? `  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}` : null;
  })
    .filter(Boolean)
    .join("\n");

  const system = [
    "You are the RELATIONSHIP DYNAMICS agent for an AI-assisted prestige TV",
    "writers' room. You write SHORT, SPECIFIC, BUYER-GRADE relationship copy",
    "from APPROVED source material. You never invent major story turns.",
    args.sourceStrict
      ? "When you can't infer a field from the source, write a CONSERVATIVE, GENERAL line — do NOT invent a specific detail and flag it."
      : "If a field would require story turns you can't infer from the source, write a conservative DRAFT line and add the field name to `missingSourceWarnings` so the writer knows to revise.",
    "",
    VOICE_RULES,
    args.sourceStrict ? "\n" + STRICT_RULES : "",
    "",
    `PAIRING: ${args.a.name} ↔ ${args.b.name}`,
    args.notes ? `\nWRITER STEERING (weight above defaults): """${args.notes.trim()}"""\n` : "",
    isPartial
      ? `Only write these fields: ${targets.join(", ")}. Keep the other fields' existing values — do NOT echo them back.`
      : "Write all 11 fields.",
    "",
    "Per-field guidance:",
    ...targets.map((t) => `• ${t} — ${FIELD_HINTS[t]}`),
    "",
    "Return ONLY JSON: { " +
      targets.map((t) => `"${t}": "<value>"`).join(", ") +
      `, "missingSourceWarnings": ["<field name>", ...] }`,
  ]
    .filter(Boolean)
    .join("\n");

  const userMsg = [
    "APPROVED SOURCE MANIFEST:",
    manifestText(args.ctx),
    "",
    "CHARACTER A:",
    characterBlock(args.a),
    "",
    "CHARACTER B:",
    characterBlock(args.b),
    "",
    existingDump
      ? `EXISTING RELATIONSHIP COPY (revise / preserve as instructed):\n${existingDump}`
      : args.sourceStrict
      ? "Start fresh — do not assume any prior copy. The source manifest is your only canon."
      : "NO PRIOR COPY — generate a fresh draft.",
  ].join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    // Strict mode pulls temperature down to discourage invention.
    temperature: args.sourceStrict ? 0.2 : args.notes ? 0.55 : 0.45,
    maxTokens: 1500,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    throw new Error("Relationship agent did not return usable JSON.");
  }
  const out: RelationshipDraft = {};
  for (const k of targets) {
    const v = parsed[k];
    if (typeof v === "string" && v.trim()) {
      (out as Record<string, unknown>)[k] = v.trim();
    }
  }
  if (Array.isArray(parsed.missingSourceWarnings)) {
    out.missingSourceWarnings = (parsed.missingSourceWarnings as unknown[]).filter(
      (x): x is string => typeof x === "string"
    );
  }
  return out;
}

// ----- Source assembly ------------------------------------------------------

/**
 * Pull the AI-relevant source manifest for a project. Pulls the same data
 * the Pitch Materials generator uses plus character DNA + wounds.
 */
export async function assembleGeneratorContext(
  projectId: string
): Promise<GeneratorContext> {
  const { data: proj } = await supabase
    .from("projects")
    .select("title, logline, tone, showrunner_notes, metadata")
    .eq("id", projectId)
    .maybeSingle();
  const projectTitle = (proj?.title as string) ?? "Untitled";

  // Treatment (project workflow's latest revision).
  const { data: wfs } = await supabase
    .from("workflows")
    .select("id, episode_id")
    .eq("project_id", projectId);
  const projectWf = (wfs ?? []).find((w) => !w.episode_id) ?? (wfs ?? [])[0];
  let treatment: Record<string, unknown> | null = null;
  if (projectWf) {
    const { data: art } = await supabase
      .from("workflow_stage_artifacts")
      .select("body")
      .eq("workflow_id", projectWf.id)
      .eq("stage_id", "treatment")
      .order("revision", { ascending: false })
      .limit(1);
    treatment = (art?.[0]?.body as Record<string, unknown>) ?? null;
  }

  // Season arc + episodes.
  const { data: season } = await supabase
    .from("seasons")
    .select("arc")
    .eq("project_id", projectId)
    .order("number", { ascending: true })
    .limit(1);
  const arc = (season?.[0]?.arc as Record<string, unknown> | null) ?? null;
  const { data: eps } = await supabase
    .from("episodes")
    .select("number, title, logline, title_status")
    .eq("project_id", projectId)
    .order("number", { ascending: true });
  const episodes = (eps ?? []).map((e) => ({
    number: e.number as number,
    title:
      (e.title_status as string) === "approved" ? ((e.title as string) ?? undefined) : undefined,
    logline: (e.logline as string) ?? undefined,
  }));

  // Characters + DNA + wounds.
  const { data: chars } = await supabase
    .from("characters")
    .select("id, name, role, biography, wants, needs, flaw, metadata")
    .eq("project_id", projectId);
  // wounds are by character_id — fetch once, key by id.
  const { data: woundsAll } = await supabase
    .from("character_wounds")
    .select("character_id, wound, fear, unmet_need, shame_trigger, defenses, kind");
  const woundsByChar = new Map<string, Record<string, unknown>>();
  for (const w of woundsAll ?? []) {
    woundsByChar.set(w.character_id as string, w as Record<string, unknown>);
  }

  const characters: CharacterCtx[] = (chars ?? []).map((c) => {
    const meta = ((c.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    return {
      id: c.id as string,
      name: c.name as string,
      role: (c.role as string) ?? null,
      bio: (c.biography as string) ?? null,
      wants: (c.wants as string) ?? null,
      needs: (c.needs as string) ?? null,
      flaw: (c.flaw as string) ?? null,
      dna: (meta.dna as Record<string, unknown>) ?? null,
      wound: woundsByChar.get(c.id as string) ?? null,
    };
  });

  // Production rules from project metadata.
  const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
  const rules =
    (projMeta.productionRules as { prefer?: string[]; avoid?: string[] } | null) ?? null;

  // Treatment fields → manifest.
  const t = treatment ?? {};
  return {
    projectTitle,
    logline: (proj?.logline as string) || (t.logline as string) || null,
    synopsis: (t.treatmentProse as string) || (t.shortSynopsis as string) || null,
    tone: (proj?.tone as string[] | null) ?? [],
    toneStatement: (t.tone as string) || null,
    themes: Array.isArray(t.themes) ? (t.themes as string[]) : [],
    worldStatement: (t.worldStatement as string) || null,
    seasonArc: arc
      ? ((arc.throughline as string) || (arc.premise as string) || null)
      : null,
    episodes,
    showrunnerNotes: (proj?.showrunner_notes as string) ?? null,
    productionRules: rules
      ? { prefer: rules.prefer ?? [], avoid: rules.avoid ?? [] }
      : undefined,
    characters,
  };
}
