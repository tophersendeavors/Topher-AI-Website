// Storage for Pitch Materials. Lives under project.metadata.pitch.decks[id].
// Each deck record holds the current slides + a version history snapshot.
// Versioning labels mirror the user's convention:
//   SELVAJE_PitchDeck_v1
//   SELVAJE_PitchDeck_v1.1_NotesPass
//   SELVAJE_Lookbook_v1

import { supabase } from "../../db/client.js";
import { DECK_TEMPLATES } from "./templates.js";
import {
  assembleSources,
  setPitchSources,
} from "./sources.js";
import { generateDeck, regenerateSlide } from "./generator.js";
import type {
  DeckKind,
  DeckSlide,
  DeckStatus,
  DeckVersion,
  PitchDeck,
  SourceCheckResult,
} from "./types.js";
import { DECK_KIND_LABEL } from "./types.js";

type Meta = Record<string, unknown>;
const safeMeta = (m: unknown): Meta => ((m ?? {}) as Meta);

function readPitchDecks(meta: Meta): Record<string, PitchDeck> {
  const p = safeMeta(meta.pitch);
  return ((p.decks as Record<string, PitchDeck>) ?? {}) as Record<string, PitchDeck>;
}

async function loadProjMeta(projectId: string): Promise<{ title: string; meta: Meta }> {
  const { data: proj, error } = await supabase
    .from("projects")
    .select("title, metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return { title: (proj.title as string) ?? "Untitled", meta: safeMeta(proj.metadata) };
}

async function persistMeta(projectId: string, meta: Meta): Promise<void> {
  await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
}

function slugSeries(title: string): string {
  return title
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase() || "UNTITLED";
}

const KIND_SLUG: Record<DeckKind, string> = {
  series_pitch_deck: "PitchDeck",
  film_pitch_deck: "FilmPitchDeck",
  lookbook: "Lookbook",
  one_sheet: "OneSheet",
  buyer_treatment: "BuyerTreatment",
  internal_production_deck: "InternalProductionDeck",
};

function nextVersionLabel(deck: PitchDeck, passType?: string): string {
  // Major label is incremented on full regen; decimal-label is used for
  // edit-pass snapshots ("v1.1_NotesPass"). The caller picks which.
  const series = slugSeries(deck.title.replace(/ — .*$/, ""));
  const stem = `${series}_${KIND_SLUG[deck.kind]}`;
  if (passType) {
    // Find the latest major; bump the decimal.
    const matches = [deck.currentVersionLabel, ...deck.history.map((h) => h.versionLabel)]
      .filter(Boolean)
      .map((l) => l.match(/_v(\d+)\.(\d+)(_(\w+))?$/));
    const minors = matches
      .map((m) => m && parseInt(m[2], 10))
      .filter((n): n is number => typeof n === "number");
    const major = (() => {
      const m = deck.currentVersionLabel.match(/_v(\d+)\./);
      return m ? parseInt(m[1], 10) : 1;
    })();
    const nextMinor = (minors.length ? Math.max(...minors) : 0) + 1;
    return `${stem}_v${major}.${nextMinor}_${passType}`;
  }
  // Major bump.
  const majorNums = [deck.currentVersionLabel, ...deck.history.map((h) => h.versionLabel)]
    .map((l) => {
      const m = l.match(/_v(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter((n): n is number => typeof n === "number");
  const next = (majorNums.length ? Math.max(...majorNums) : 0) + 1;
  return `${stem}_v${next}.0_Generated`;
}

function snapshotVersion(deck: PitchDeck, label: string, summary?: string): DeckVersion {
  return {
    versionId: label.split("_").pop() ?? "v1",
    versionLabel: label,
    slides: deck.slides.map((s) => ({ ...s })),
    sourceManifest: { ...deck.sourceManifest },
    changeSummary: summary,
    approval: {
      approvedSlides: deck.slides.filter((s) => s.approved).length,
      total: deck.slides.length,
    },
    exported: deck.status === "final_exported",
    createdAt: new Date().toISOString(),
  };
}

// --- Public surface ----------------------------------------------------------

export async function listDecks(projectId: string): Promise<PitchDeck[]> {
  const { meta } = await loadProjMeta(projectId);
  return Object.values(readPitchDecks(meta)).sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}

export async function getDeck(projectId: string, deckId: string): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[deckId];
  if (!deck) throw new Error("Deck not found.");
  return deck;
}

/**
 * Create a new deck. Slides start empty (templates only — buyer-facing copy
 * gets written on the first Generate call).
 */
export async function createDeck(args: {
  projectId: string;
  kind: DeckKind;
  title?: string;
}): Promise<PitchDeck> {
  const { title: projectTitle, meta } = await loadProjMeta(args.projectId);
  const templates = DECK_TEMPLATES[args.kind];
  const id = `${args.kind}_${Date.now()}`;
  const deckTitle = args.title ?? `${projectTitle} — ${DECK_KIND_LABEL[args.kind]}`;
  const versionLabel = `${slugSeries(projectTitle)}_${KIND_SLUG[args.kind]}_v0.0_Empty`;
  const slides: DeckSlide[] = templates.map((tpl) => ({
    id: tpl.id,
    title: tpl.title,
    copy: "",
    sourcesUsed: [],
    missingSources: [...tpl.sources],
    locked: false,
    needsRevision: true,
    approved: false,
    edited: false,
    custom: false,
  }));
  const now = new Date().toISOString();
  const deck: PitchDeck = {
    id,
    projectId: args.projectId,
    kind: args.kind,
    title: deckTitle,
    status: "not_started",
    slides,
    sourceManifest: {},
    history: [],
    currentVersionLabel: versionLabel,
    createdAt: now,
    updatedAt: now,
  };

  const pitch = safeMeta(meta.pitch);
  const decks = readPitchDecks(meta);
  decks[id] = deck;
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

export async function deleteDeck(projectId: string, deckId: string): Promise<void> {
  const { meta } = await loadProjMeta(projectId);
  const pitch = safeMeta(meta.pitch);
  const decks = readPitchDecks(meta);
  delete decks[deckId];
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(projectId, meta);
}

/** Re-assemble source data + regenerate every slide. Snapshots prior version. */
export async function generateFullDeck(args: {
  projectId: string;
  deckId: string;
  writerNotes?: string;
}): Promise<{ deck: PitchDeck; sources: SourceCheckResult }> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");

  const sources = await assembleSources(args.projectId);
  const slides = await generateDeck({
    kind: deck.kind,
    source: sources,
    writerNotes: args.writerNotes,
  });

  // Snapshot the prior version before overwriting (skip the very first
  // generation when there's nothing meaningful to keep).
  const hasMeaningfulPrior = deck.slides.some((s) => s.copy.trim().length > 0);
  if (hasMeaningfulPrior) {
    deck.history.unshift(snapshotVersion(deck, deck.currentVersionLabel));
    deck.history = deck.history.slice(0, 12);
  }

  deck.slides = slides;
  deck.sourceManifest = sources.manifest;
  deck.status = "draft_generated";
  deck.currentVersionLabel = nextVersionLabel(deck);
  deck.updatedAt = new Date().toISOString();
  decks[args.deckId] = deck;

  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return { deck, sources };
}

/** Regenerate ONE slide. Snapshots a decimal version. */
export async function regenerateOneSlide(args: {
  projectId: string;
  deckId: string;
  slideId: string;
  writerNotes?: string;
}): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");
  const template = DECK_TEMPLATES[deck.kind].find((t) => t.id === args.slideId);
  if (!template) {
    // Custom slide — caller should edit, not LLM-regen.
    throw new Error("Custom slides don't have a template — edit them by hand.");
  }
  const idx = deck.slides.findIndex((s) => s.id === args.slideId);
  if (idx < 0) throw new Error("Slide not found in deck.");
  if (deck.slides[idx].locked) {
    throw new Error("This slide is locked. Unlock it before regenerating.");
  }

  const sources = await assembleSources(args.projectId);
  const slide = await regenerateSlide({
    kind: deck.kind,
    source: sources,
    template,
    contextSlides: deck.slides.map((s) => ({
      title: s.title,
      copySnippet: s.copy,
    })),
    writerNotes: args.writerNotes,
  });

  // Snapshot a decimal version before overwriting the single slide.
  deck.history.unshift(
    snapshotVersion(deck, nextVersionLabel(deck, "SlidePass"), `Regenerated slide: ${slide.title}`)
  );
  deck.history = deck.history.slice(0, 12);

  deck.slides[idx] = slide;
  deck.sourceManifest = sources.manifest;
  deck.status = deck.status === "approved" ? "needs_review" : deck.status === "not_started" ? "draft_generated" : "needs_review";
  deck.updatedAt = new Date().toISOString();
  decks[args.deckId] = deck;

  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

/** Patch deck title / status / slide-flags / per-slide copy. */
export async function patchDeck(args: {
  projectId: string;
  deckId: string;
  patch: Partial<Pick<PitchDeck, "title" | "status">>;
}): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");
  if (args.patch.title !== undefined) deck.title = args.patch.title;
  if (args.patch.status !== undefined) deck.status = args.patch.status;
  deck.updatedAt = new Date().toISOString();
  decks[args.deckId] = deck;
  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

/** Patch one slide in place. Writer edits flip edited=true. */
export async function patchSlide(args: {
  projectId: string;
  deckId: string;
  slideId: string;
  patch: Partial<DeckSlide>;
}): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");
  const idx = deck.slides.findIndex((s) => s.id === args.slideId);
  if (idx < 0) throw new Error("Slide not found.");
  // Detect content edit (copy / title / notes / visual / image).
  const contentEdited =
    args.patch.copy !== undefined ||
    args.patch.title !== undefined ||
    args.patch.speakerNotes !== undefined ||
    args.patch.visualDirection !== undefined ||
    args.patch.imagePrompt !== undefined;
  deck.slides[idx] = {
    ...deck.slides[idx],
    ...args.patch,
    edited: contentEdited ? true : deck.slides[idx].edited,
  };
  deck.updatedAt = new Date().toISOString();
  // Editing any slide on an approved deck drops it back to "needs review".
  if (contentEdited && deck.status === "approved") deck.status = "needs_review";
  decks[args.deckId] = deck;
  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

/** Append a custom slide at the end. */
export async function addCustomSlide(args: {
  projectId: string;
  deckId: string;
  title: string;
  copy?: string;
}): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");
  const id = `custom_${Date.now()}`;
  deck.slides.push({
    id,
    title: args.title.trim() || "Custom slide",
    copy: args.copy ?? "",
    sourcesUsed: [],
    missingSources: [],
    locked: false,
    needsRevision: false,
    approved: false,
    edited: true,
    custom: true,
  });
  deck.updatedAt = new Date().toISOString();
  decks[args.deckId] = deck;
  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

/** Remove a slide by id. */
export async function deleteSlide(args: {
  projectId: string;
  deckId: string;
  slideId: string;
}): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");
  deck.slides = deck.slides.filter((s) => s.id !== args.slideId);
  deck.updatedAt = new Date().toISOString();
  decks[args.deckId] = deck;
  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

/** Reorder slides to the given id sequence (must be a permutation). */
export async function reorderSlides(args: {
  projectId: string;
  deckId: string;
  order: string[];
}): Promise<PitchDeck> {
  const { meta } = await loadProjMeta(args.projectId);
  const decks = readPitchDecks(meta);
  const deck = decks[args.deckId];
  if (!deck) throw new Error("Deck not found.");
  const byId = new Map(deck.slides.map((s) => [s.id, s]));
  const next: DeckSlide[] = [];
  for (const id of args.order) {
    const s = byId.get(id);
    if (s) {
      next.push(s);
      byId.delete(id);
    }
  }
  // Append any slides the caller forgot, preserving original order.
  for (const s of deck.slides) {
    if (byId.has(s.id)) next.push(s);
  }
  deck.slides = next;
  deck.updatedAt = new Date().toISOString();
  decks[args.deckId] = deck;
  const pitch = safeMeta(meta.pitch);
  pitch.decks = decks;
  meta.pitch = pitch;
  await persistMeta(args.projectId, meta);
  return deck;
}

/** Mark exported (called after a successful export download). */
export async function markExported(projectId: string, deckId: string): Promise<PitchDeck> {
  return patchDeck({ projectId, deckId, patch: { status: "final_exported" } });
}

export { setPitchSources };
