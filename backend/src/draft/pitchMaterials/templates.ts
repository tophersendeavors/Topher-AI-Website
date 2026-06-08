// Default slide templates per deck kind. These are STARTING POINTS — the
// writer can reorder, add custom slides, or delete any slide. The generator
// uses each template's `intent` + `sources` to draft buyer-facing copy.
//
// The 17-slide Series Pitch Deck order matches the user's spec verbatim.

import type { DeckKind, SlideTemplate } from "./types.js";

const SERIES_PITCH_DECK: SlideTemplate[] = [
  {
    id: "title",
    title: "Title",
    sources: ["title", "genre", "format"],
    intent:
      "Cover slide. Series title, format ('limited series', 'half-hour drama', etc.), and the genre — restrained, premium, no taglines.",
  },
  {
    id: "logline",
    title: "Logline",
    sources: ["logline"],
    intent:
      "One sentence. Active, specific, irreversible — what changes and why we can't look away.",
  },
  {
    id: "hook",
    title: "The Hook",
    sources: ["logline", "themes", "world"],
    intent:
      "A buyer-facing paragraph that names the unique ANGLE — the question the show is built to answer. No melodrama.",
  },
  {
    id: "synopsis",
    title: "Synopsis",
    sources: ["synopsis", "season_arc"],
    intent:
      "2–3 paragraphs. Lay out the story without spoilers. End on a turn that implies the season's stakes.",
  },
  {
    id: "why_now",
    title: "Why Now",
    sources: ["themes", "audience"],
    intent:
      "Cultural / market context. Why this conversation, this moment. Concrete, not abstract.",
  },
  {
    id: "tone_genre",
    title: "Tone & Genre",
    sources: ["tone", "comps", "genre"],
    intent:
      "Tonal coordinates + reference language. Comp shorthand allowed (use approved comps only).",
  },
  {
    id: "world",
    title: "World",
    sources: ["world", "visual_language"],
    intent:
      "Where the show lives. Texture and rules of the world. One image-led paragraph.",
  },
  {
    id: "characters",
    title: "Main Characters",
    sources: ["characters"],
    intent:
      "3–6 lead characters. One short paragraph each. Lead with want / wound / contradiction.",
  },
  {
    id: "relationships",
    title: "Relationship Dynamics",
    sources: ["relationships", "characters"],
    intent:
      "The 2–3 relationships the show LIVES on. Name the tension and the engine — not a Wikipedia entry.",
  },
  {
    id: "season_arc",
    title: "Season / Story Arc",
    sources: ["season_arc"],
    intent:
      "Where we start vs where we end. One paragraph. Hit the central reversal without revealing the ending.",
  },
  {
    id: "episodes",
    title: "Episode Breakdown",
    sources: ["episodes"],
    intent:
      "1-line logline per episode (up to 8 shown). No spoilers in the last two beyond a directional tease.",
  },
  {
    id: "visual_language",
    title: "Visual Language",
    sources: ["visual_language", "tone"],
    intent:
      "Lensing, color, blocking, motifs. Short sentences. Image-led, restraint-led.",
  },
  {
    id: "comps",
    title: "Comparable Titles",
    sources: ["comps"],
    intent:
      "3–5 comps. Each with ONE sentence on what we share and one on how we differ. Use the writer's approved list — do not invent comps.",
  },
  {
    id: "audience",
    title: "Audience",
    sources: ["audience"],
    intent:
      "Who this is FOR. Demographic + psychographic. Buyer-credible, not aspirational marketing copy.",
  },
  {
    id: "production",
    title: "Production Approach",
    sources: ["production_approach"],
    intent:
      "Production methodology — locations, schedule shape, AI-assisted pipeline if relevant. Honest about scale.",
  },
  {
    id: "creator",
    title: "Creator Statement",
    sources: ["creator_statement"],
    intent:
      "First-person paragraph from the creator. Why YOU, why NOW. Restraint over biography.",
  },
  {
    id: "closing",
    title: "Closing Slide",
    sources: ["title"],
    intent:
      "One image, one line. Returns to the title. No 'thank you' or 'contact for more' — that's a sales-team page, not a closing beat.",
  },
];

const FILM_PITCH_DECK: SlideTemplate[] = [
  { id: "title", title: "Title", sources: ["title", "genre"], intent: "Cover slide — title, genre, format (feature, limited series film, short)." },
  { id: "logline", title: "Logline", sources: ["logline"], intent: "One sentence. Specific, irreversible." },
  { id: "hook", title: "The Hook", sources: ["logline", "themes"], intent: "What's the unique angle? Buyer-facing." },
  { id: "synopsis", title: "Synopsis", sources: ["synopsis"], intent: "3-act prose summary — beginning, middle, end. Spoilers acceptable for film pitches." },
  { id: "why_now", title: "Why Now", sources: ["themes", "audience"], intent: "Cultural relevance + market window." },
  { id: "tone_genre", title: "Tone & Genre", sources: ["tone", "comps"], intent: "Comp shorthand, tonal coordinates." },
  { id: "world", title: "World", sources: ["world", "visual_language"], intent: "Setting + texture." },
  { id: "characters", title: "Main Characters", sources: ["characters"], intent: "Protagonist + 3–4 leads, 1 short paragraph each." },
  { id: "visual_language", title: "Visual Language", sources: ["visual_language"], intent: "Image-led. Restraint over excess." },
  { id: "comps", title: "Comparable Titles", sources: ["comps"], intent: "3–5 comps, what we share / how we differ." },
  { id: "audience", title: "Audience", sources: ["audience"], intent: "Who this is FOR." },
  { id: "production", title: "Production Approach", sources: ["production_approach"], intent: "Locations, budget shape, methodology." },
  { id: "creator", title: "Creator Statement", sources: ["creator_statement"], intent: "First-person, restrained." },
  { id: "closing", title: "Closing Slide", sources: ["title"], intent: "One image, one line." },
];

const LOOKBOOK: SlideTemplate[] = [
  { id: "title", title: "Title", sources: ["title", "tone"], intent: "Title card, tonal cue only." },
  { id: "world_intro", title: "The World", sources: ["world"], intent: "Image-first description of the world." },
  { id: "color_script", title: "Color Script", sources: ["visual_language"], intent: "Palette across acts / episodes. Short labels per panel." },
  { id: "lighting", title: "Lighting & Lensing", sources: ["visual_language"], intent: "Quality of light + lens choices that define the show." },
  { id: "blocking", title: "Blocking & Frame", sources: ["visual_language"], intent: "Spatial logic, negative space, restraint cues." },
  { id: "characters_in_frame", title: "Characters in Frame", sources: ["characters", "visual_language"], intent: "How each lead is shot — wardrobe, framing, behavioural cues." },
  { id: "motifs", title: "Visual Motifs", sources: ["visual_language", "themes"], intent: "Recurring images: hands, objects, weather, textures." },
  { id: "wardrobe_design", title: "Wardrobe & Design", sources: ["visual_language", "world"], intent: "Costume + production design language." },
  { id: "comp_grid", title: "Reference Grid", sources: ["comps", "visual_language"], intent: "Tonal references — name what we borrow and what we leave." },
  { id: "closing", title: "Closing Image", sources: ["title", "visual_language"], intent: "Single image that says everything." },
];

const ONE_SHEET: SlideTemplate[] = [
  { id: "header", title: "Header", sources: ["title", "genre", "format"], intent: "Title bar + genre + format." },
  { id: "logline", title: "Logline", sources: ["logline"], intent: "One sentence. Active." },
  { id: "synopsis", title: "Synopsis", sources: ["synopsis"], intent: "2–3 short paragraphs. Buyer-readable in 30 seconds." },
  { id: "tone_comps", title: "Tone & Comps", sources: ["tone", "comps"], intent: "1 line of tonal coordinates + comp shorthand." },
  { id: "audience", title: "Audience", sources: ["audience"], intent: "One short sentence." },
  { id: "creator", title: "Creator", sources: ["creator_statement"], intent: "One short line — credentials + posture." },
];

const BUYER_TREATMENT: SlideTemplate[] = [
  { id: "header", title: "Title & Logline", sources: ["title", "logline", "genre", "format"], intent: "Header block." },
  { id: "synopsis_long", title: "Series Synopsis", sources: ["synopsis", "season_arc"], intent: "3–5 paragraphs of prose synopsis — buyer-grade." },
  { id: "tone_world", title: "Tone & World", sources: ["tone", "world", "visual_language"], intent: "Prose: where the show lives + how it feels." },
  { id: "characters_prose", title: "Characters", sources: ["characters", "relationships"], intent: "One paragraph per lead. Then a paragraph on the engine relationships." },
  { id: "season_arc_prose", title: "Season Arc", sources: ["season_arc"], intent: "Long-form arc — where we begin, the middle turn, where we end." },
  { id: "episodes_prose", title: "Episode Map", sources: ["episodes"], intent: "Episode-by-episode logline with one craft sentence each." },
  { id: "themes_prose", title: "Themes & Why Now", sources: ["themes", "audience"], intent: "Prose, restrained." },
  { id: "creator_long", title: "Creator Statement", sources: ["creator_statement"], intent: "Half-page in the writer's voice." },
];

const INTERNAL_PRODUCTION_DECK: SlideTemplate[] = [
  { id: "title", title: "Title — Internal", sources: ["title"], intent: "Internal team header — not for buyer eyes." },
  { id: "production_summary", title: "Production Summary", sources: ["production_approach"], intent: "Scope, methodology, AI-assisted pipeline notes (if relevant)." },
  { id: "world_logistics", title: "World & Locations", sources: ["world"], intent: "Where we shoot / build, with practical considerations." },
  { id: "cast_logistics", title: "Cast & Performance", sources: ["characters"], intent: "Casting profile per lead, performance pillars." },
  { id: "visual_pipeline", title: "Visual Pipeline", sources: ["visual_language"], intent: "Camera + lighting language, asset pipeline." },
  { id: "schedule_shape", title: "Schedule Shape", sources: ["episodes", "season_arc"], intent: "Episode lengths, sequencing, dependencies." },
  { id: "risks", title: "Risks & Mitigations", sources: ["production_approach"], intent: "Honest assessment — what could fail and how we cover." },
  { id: "team", title: "Team", sources: ["creator_statement"], intent: "Key personnel, departments, partners." },
];

export const DECK_TEMPLATES: Record<DeckKind, SlideTemplate[]> = {
  series_pitch_deck: SERIES_PITCH_DECK,
  film_pitch_deck: FILM_PITCH_DECK,
  lookbook: LOOKBOOK,
  one_sheet: ONE_SHEET,
  buyer_treatment: BUYER_TREATMENT,
  internal_production_deck: INTERNAL_PRODUCTION_DECK,
};
