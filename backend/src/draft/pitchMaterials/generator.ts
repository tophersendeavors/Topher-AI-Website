// Deck generator. One LLM call per full-deck regeneration so the slides
// read as a coherent document. A second small call per-slide regeneration.
//
// HARD RULE: do not invent major story details, comps, audience claims, or
// production claims. When the source manifest lacks a field a slide needs,
// the generator emits a short placeholder + records the missing field on
// the slide's missingSources list. The writer fills it before approving.

import { callLLM, extractJSON } from "../../llm/provider.js";
import { config } from "../../config.js";
import { DECK_TEMPLATES } from "./templates.js";
import type {
  DeckKind,
  DeckSlide,
  SlideTemplate,
  SourceCheckResult,
  SourceField,
  SourceManifest,
} from "./types.js";

interface RawSlide {
  id?: string;
  title?: string;
  copy?: string;
  speakerNotes?: string;
  visualDirection?: string;
  imagePrompt?: string;
  sourcesUsed?: string[];
  missingSources?: string[];
}

function pickSourcesForSlide(
  template: SlideTemplate,
  available: SourceField[]
): { used: SourceField[]; missing: SourceField[] } {
  const used: SourceField[] = [];
  const missing: SourceField[] = [];
  for (const f of template.sources) {
    if (available.includes(f)) used.push(f);
    else missing.push(f);
  }
  return { used, missing };
}

function trimSlide(s: RawSlide, template: SlideTemplate): {
  title: string;
  copy: string;
  speakerNotes?: string;
  visualDirection?: string;
  imagePrompt?: string;
} {
  return {
    title: (typeof s.title === "string" && s.title.trim()) || template.title,
    copy: typeof s.copy === "string" ? s.copy.trim() : "",
    speakerNotes:
      typeof s.speakerNotes === "string" && s.speakerNotes.trim()
        ? s.speakerNotes.trim()
        : undefined,
    visualDirection:
      typeof s.visualDirection === "string" && s.visualDirection.trim()
        ? s.visualDirection.trim()
        : undefined,
    imagePrompt:
      typeof s.imagePrompt === "string" && s.imagePrompt.trim()
        ? s.imagePrompt.trim()
        : undefined,
  };
}

function manifestSummary(m: SourceManifest): string {
  // Compact, readable manifest the LLM can ingest in one shot.
  const lines: string[] = [];
  if (m.title) lines.push(`TITLE: ${m.title}`);
  if (m.genre?.length) lines.push(`GENRE: ${m.genre.join(", ")}`);
  if (m.format) lines.push(`FORMAT: ${m.format}`);
  if (m.logline) lines.push(`LOGLINE: ${m.logline}`);
  if (m.synopsis) lines.push(`SYNOPSIS:\n${m.synopsis.slice(0, 1600)}`);
  if (m.tone?.length || m.toneStatement) {
    lines.push(
      `TONE: ${(m.tone ?? []).join(", ")}${
        m.toneStatement ? ` — ${m.toneStatement}` : ""
      }`
    );
  }
  if (m.themes?.length) lines.push(`THEMES: ${m.themes.join("; ")}`);
  if (m.world) lines.push(`WORLD: ${m.world}`);
  if (m.visualLanguage) lines.push(`VISUAL LANGUAGE: ${m.visualLanguage}`);
  if (m.comps?.length) lines.push(`COMPS (writer-approved only): ${m.comps.join(", ")}`);
  if (m.audience) lines.push(`AUDIENCE: ${m.audience}`);
  if (m.creatorStatement) lines.push(`CREATOR STATEMENT: ${m.creatorStatement}`);
  if (m.productionApproach) lines.push(`PRODUCTION APPROACH: ${m.productionApproach}`);
  if (m.seasonArc) lines.push(`SEASON ARC: ${m.seasonArc}`);
  if (m.episodes?.length) {
    lines.push(
      `EPISODES:\n${m.episodes
        .slice(0, 12)
        .map((e) => `  ${String(e.number).padStart(2, "0")}: ${e.title ?? "Untitled"} — ${e.logline ?? "(no logline)"}`)
        .join("\n")}`
    );
  }
  if (m.characters?.length) {
    lines.push(
      `CHARACTERS:\n${m.characters
        .slice(0, 10)
        .map((c) => `  ${c.name}${c.role ? ` (${c.role})` : ""}: ${c.bio ?? "(no bio)"}`)
        .join("\n")}`
    );
  }
  if (m.relationships?.length) {
    lines.push(
      `RELATIONSHIPS:\n${m.relationships
        .slice(0, 6)
        .map((r) => `  ${r.a} ↔ ${r.b}: ${r.nature ?? ""}${r.tension ? ` — ${r.tension}` : ""}`)
        .join("\n")}`
    );
  }
  if (m.showrunnerNotes) lines.push(`SHOWRUNNER NOTES:\n${m.showrunnerNotes.slice(0, 600)}`);
  return lines.join("\n\n");
}

function templateInstructions(template: SlideTemplate[]): string {
  return template
    .map(
      (t, i) =>
        `[${String(i + 1).padStart(2, "0")}] id="${t.id}" title="${t.title}"\n    intent: ${t.intent}\n    requires: ${t.sources.join(", ") || "(none)"}`
    )
    .join("\n");
}

const BUYER_VOICE_RULES = [
  "Buyer-facing language is PREMIUM and RESTRAINED: short sentences, concrete imagery,",
  "no clichés ('a rollercoaster ride', 'gripping', 'epic'), no marketing copy, no exclamation marks.",
  "Never invent comps, audience claims, character details, episode beats, themes, or production",
  "claims that aren't in the source manifest. When the manifest lacks a field a slide needs,",
  "emit a SHORT placeholder paragraph in `copy` that names what's missing (e.g.",
  "\"[Comparable titles to be approved by the creator before this deck ships.]\") and list",
  "the missing source field(s) in `missingSources`. Do NOT fabricate to fill space.",
].join("\n");

/**
 * Generate every slide of a deck in one structured call. Returns
 * DeckSlide objects keyed to the templates (preserved order).
 */
export async function generateDeck(args: {
  kind: DeckKind;
  source: SourceCheckResult;
  writerNotes?: string;
}): Promise<DeckSlide[]> {
  const templates = DECK_TEMPLATES[args.kind];
  const manifest = manifestSummary(args.source.manifest);
  const presentList = args.source.present.join(", ") || "(none)";
  const missingList = args.source.missing.join(", ") || "(none)";

  const system = [
    "You are the PITCH MATERIALS generator for an AI-assisted cinematic studio.",
    "You produce buyer-facing decks (or treatments / lookbooks / one-sheets) from",
    "an APPROVED source manifest. You never invent major story content; if a",
    "slide depends on a missing field, you flag it and place a clear placeholder.",
    "",
    BUYER_VOICE_RULES,
    "",
    `DECK KIND: ${args.kind}`,
    `SOURCE FIELDS PRESENT: ${presentList}`,
    `SOURCE FIELDS MISSING: ${missingList}`,
    args.writerNotes
      ? `WRITER STEERING (weight above defaults): """${args.writerNotes.trim()}"""`
      : "",
    "",
    "FOLLOW THE TEMPLATE EXACTLY. For each slide, write:",
    "  - title (use the template title unless the writer steered otherwise)",
    "  - copy (the buyer-facing body — 1 short paragraph or a tight bullet list",
    "    where the template intent calls for one)",
    "  - speakerNotes (optional — 1–2 sentences a writer would say in the room)",
    "  - visualDirection (optional — image / framing direction)",
    "  - imagePrompt (a single Midjourney-style image prompt for the moodboard",
    "    that aligns with the project's visual language; do not name real",
    "    actors or specific real people)",
    "  - sourcesUsed (array of source-field keys you actually drew on)",
    "  - missingSources (array of source-field keys you NEEDED but were absent)",
    "",
    "TEMPLATE:",
    templateInstructions(templates),
    "",
    "Return ONLY JSON: { \"slides\": [ { id, title, copy, speakerNotes, visualDirection, imagePrompt, sourcesUsed, missingSources }, ... ] }",
  ]
    .filter(Boolean)
    .join("\n");

  const user = ["APPROVED SOURCE MANIFEST:", "", manifest || "(empty)"].join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    maxTokens: 6000,
  });

  let parsed: { slides?: RawSlide[] } = {};
  try {
    parsed = extractJSON(res.text) as { slides?: RawSlide[] };
  } catch {
    throw new Error("Pitch generator did not return usable JSON. Try again.");
  }
  const rawSlides = Array.isArray(parsed.slides) ? parsed.slides : [];

  // Map by template id; fall back to template defaults for any slide the
  // model dropped. Sources actually present are intersected with the
  // template's required sources — that's the honest "used" list.
  const byId = new Map<string, RawSlide>();
  for (const s of rawSlides) {
    if (s && typeof s.id === "string") byId.set(s.id, s);
  }

  return templates.map((tpl): DeckSlide => {
    const raw = byId.get(tpl.id) ?? {};
    const trimmed = trimSlide(raw, tpl);
    const { used, missing } = pickSourcesForSlide(tpl, args.source.present);
    // Pull model-reported missing fields too (it sometimes spots gaps we
    // can't infer from presence/absence alone — e.g. "comps too generic").
    const modelMissing = Array.isArray(raw.missingSources)
      ? (raw.missingSources as string[]).filter((x): x is SourceField =>
          (
            [
              "title",
              "genre",
              "format",
              "logline",
              "synopsis",
              "tone",
              "themes",
              "world",
              "characters",
              "relationships",
              "season_arc",
              "episodes",
              "visual_language",
              "comps",
              "audience",
              "creator_statement",
              "production_approach",
            ] as string[]
          ).includes(x)
        )
      : [];
    const missingSet = new Set<SourceField>([...missing, ...modelMissing]);
    return {
      id: tpl.id,
      title: trimmed.title,
      copy: trimmed.copy || `(missing copy for "${tpl.title}")`,
      speakerNotes: trimmed.speakerNotes,
      visualDirection: trimmed.visualDirection,
      imagePrompt: trimmed.imagePrompt,
      sourcesUsed: used,
      missingSources: [...missingSet],
      locked: false,
      needsRevision: missingSet.size > 0,
      approved: false,
      edited: false,
      custom: false,
    };
  });
}

/**
 * Regenerate ONE slide. Used by the per-slide "Regenerate" button.
 * The whole-deck context is preserved so the slide stays coherent with
 * the rest.
 */
export async function regenerateSlide(args: {
  kind: DeckKind;
  source: SourceCheckResult;
  template: SlideTemplate;
  /** The full current deck (slide titles + short hint) for coherence. */
  contextSlides: Array<{ title: string; copySnippet: string }>;
  writerNotes?: string;
}): Promise<DeckSlide> {
  const manifest = manifestSummary(args.source.manifest);
  const ctx = args.contextSlides
    .map((s, i) => `[${i + 1}] ${s.title}: ${s.copySnippet.slice(0, 140)}…`)
    .join("\n");

  const system = [
    "You regenerate ONE slide for a pitch deck. The rest of the deck is shown",
    "as context — your slide must read coherently next to the others.",
    "",
    BUYER_VOICE_RULES,
    "",
    `TARGET SLIDE: ${args.template.title}`,
    `INTENT: ${args.template.intent}`,
    `REQUIRES: ${args.template.sources.join(", ") || "(none)"}`,
    args.writerNotes ? `WRITER STEERING: """${args.writerNotes.trim()}"""` : "",
    "",
    "Return ONLY JSON: { \"slide\": { id, title, copy, speakerNotes, visualDirection, imagePrompt, sourcesUsed, missingSources } }",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    "SOURCE MANIFEST:",
    manifest || "(empty)",
    "",
    "EXISTING DECK CONTEXT:",
    ctx || "(empty)",
  ].join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.55,
    maxTokens: 1500,
  });

  let parsed: { slide?: RawSlide } = {};
  try {
    parsed = extractJSON(res.text) as { slide?: RawSlide };
  } catch {
    throw new Error("Slide generator did not return usable JSON.");
  }
  const raw = parsed.slide ?? {};
  const trimmed = trimSlide(raw, args.template);
  const { used, missing } = pickSourcesForSlide(args.template, args.source.present);
  return {
    id: args.template.id,
    title: trimmed.title,
    copy: trimmed.copy || `(missing copy for "${args.template.title}")`,
    speakerNotes: trimmed.speakerNotes,
    visualDirection: trimmed.visualDirection,
    imagePrompt: trimmed.imagePrompt,
    sourcesUsed: used,
    missingSources: missing,
    locked: false,
    needsRevision: missing.length > 0,
    approved: false,
    edited: false,
    custom: false,
  };
}
