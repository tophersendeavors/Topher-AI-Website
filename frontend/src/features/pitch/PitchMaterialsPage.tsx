// Pitch Materials page — buyer-facing deck builder.
//
// Separate from the 95% Script Quality Protocol. Source-data only — the
// generator never invents major story details. Missing data is surfaced
// per-slide and per-deck so the writer fills it before approving.

import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  Presentation,
  RefreshCcw,
  Trash2,
  FileText,
  Check,
  Lock,
  Unlock,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import {
  api,
  DECK_KIND_LABEL,
  DECK_STATUS_LABEL,
  SOURCE_FIELD_LABEL,
  type DeckKind,
  type DeckSlide,
  type DeckStatus,
  type FieldDetail,
  type PitchDeck,
  type SourceCheckResult,
  type SourceField,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { RecommendedNextStep } from "@/components/ui/RecommendedNextStep";

const ALL_KINDS: DeckKind[] = [
  "series_pitch_deck",
  "film_pitch_deck",
  "lookbook",
  "one_sheet",
  "buyer_treatment",
  "internal_production_deck",
];

const STATUS_COLOR: Record<DeckStatus, string> = {
  not_started: "border-white/10 bg-white/[0.02] text-bone-500",
  draft_generated: "border-sky-700/40 bg-sky-900/20 text-sky-200",
  needs_review: "border-amber-700/40 bg-amber-900/20 text-amber-200",
  notes_applied: "border-sky-700/40 bg-sky-900/20 text-sky-200",
  approved: "border-emerald-700/40 bg-emerald-900/20 text-emerald-200",
  final_exported: "border-emerald-700/60 bg-emerald-900/40 text-emerald-100",
};

export function PitchMaterialsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const [search] = useSearchParams();
  const kindFilter = (search.get("kind") as DeckKind | null) ?? null;
  const qc = useQueryClient();
  const decks = useQuery({
    queryKey: ["pitch-decks", projectId],
    queryFn: () => api.listPitchDecks(projectId),
  });
  const sources = useQuery({
    queryKey: ["pitch-sources", projectId],
    queryFn: () => api.getPitchSources(projectId),
  });
  const [openDeck, setOpenDeck] = useState<string | null>(null);

  const visibleDecks = useMemo(() => {
    const list = decks.data ?? [];
    return kindFilter ? list.filter((d) => d.kind === kindFilter) : list;
  }, [decks.data, kindFilter]);

  const create = useMutation({
    mutationFn: (kind: DeckKind) => api.createPitchDeck(projectId, kind),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] });
      setOpenDeck(d.id);
    },
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Pitch Materials"
        title={kindFilter ? DECK_KIND_LABEL[kindFilter] : "Pitch Materials"}
        description="Buyer-facing decks, treatments and one-sheets built from your approved bibles. AI never invents story details — missing source data is flagged and you fill it before approving."
        actions={
          <div className="flex flex-wrap gap-2">
            {(kindFilter ? [kindFilter] : ALL_KINDS).map((k) => (
              <Button
                key={k}
                variant={kindFilter ? "outline" : "ghost"}
                onClick={() => create.mutate(k)}
                disabled={create.isPending}
              >
                {create.isPending && create.variables === k ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                New {DECK_KIND_LABEL[k]}
              </Button>
            ))}
          </div>
        }
      />

      <div className="px-8">
        <RecommendedNextStep projectId={projectId} />
      </div>

      <div className="grid gap-6 px-8 xl:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {decks.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : visibleDecks.length === 0 ? (
            <Panel eyebrow={kindFilter ? DECK_KIND_LABEL[kindFilter] : "Pitch Materials"} title="No deck yet">
              <p className="text-xs text-bone-400">
                Start a deck from the buttons above. Decks read your approved bibles + tone + comps;
                they don't invent. Missing data is flagged before you can approve.
              </p>
            </Panel>
          ) : (
            visibleDecks.map((d) => (
              <DeckCard
                key={d.id}
                deck={d}
                expanded={openDeck === d.id}
                onToggle={() => setOpenDeck((cur) => (cur === d.id ? null : d.id))}
                projectId={projectId}
              />
            ))
          )}
        </div>
        <SourcePanel projectId={projectId} sources={sources.data} />
      </div>
    </div>
  );
}

function DeckCard({
  deck,
  expanded,
  onToggle,
  projectId,
}: {
  deck: PitchDeck;
  expanded: boolean;
  onToggle: () => void;
  projectId: string;
}) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => api.deletePitchDeck(projectId, deck.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });
  const totalMissing = deck.slides.reduce((n, s) => n + s.missingSources.length, 0);
  return (
    <Panel
      eyebrow={DECK_KIND_LABEL[deck.kind]}
      title={deck.title}
      actions={
        <div className="flex items-center gap-2">
          <span className={"chip " + STATUS_COLOR[deck.status]}>
            {DECK_STATUS_LABEL[deck.status]}
          </span>
          <span className="chip border-white/10 bg-white/[0.02] text-bone-400">
            {deck.slides.length} slides
          </span>
          <Button variant="ghost" onClick={onToggle}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? "Close" : "Open"}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-bone-400">
        <span className="font-mono text-bone-500">{deck.currentVersionLabel}</span>
        {totalMissing > 0 && (
          <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
            {totalMissing} missing source flag{totalMissing === 1 ? "" : "s"}
          </span>
        )}
        <button
          onClick={() => del.mutate()}
          className="ml-auto flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-400 hover:bg-white/[0.04]"
        >
          <Trash2 className="h-3 w-3" /> Delete deck
        </button>
      </div>
      {expanded && <DeckEditor deck={deck} projectId={projectId} />}
    </Panel>
  );
}

function DeckEditor({ deck, projectId }: { deck: PitchDeck; projectId: string }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const regenAll = useMutation({
    mutationFn: () => api.generatePitchDeck(projectId, deck.id, notes || undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });
  const setStatus = useMutation({
    mutationFn: (status: DeckStatus) => api.patchPitchDeck(projectId, deck.id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });
  const download = async (fmt: "pdf" | "markdown" | "html" | "text") => {
    setBusy(fmt);
    setError(null);
    try {
      const ext = fmt === "markdown" ? "md" : fmt === "text" ? "txt" : fmt;
      await api.downloadPitchExport(projectId, deck.id, fmt, `${deck.currentVersionLabel}.${ext}`);
      qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="optional: steer this regeneration (tone push, audience tweak, etc.)"
            className="input min-w-[200px] flex-1 py-1 text-xs"
          />
          <Button onClick={() => regenAll.mutate()} disabled={regenAll.isPending}>
            {regenAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            {deck.slides.some((s) => s.copy.trim()) ? "Regenerate full deck" : "Generate deck"}
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-bone-400">
          <span className="text-bone-500">Status:</span>
          {(
            ["draft_generated", "needs_review", "notes_applied", "approved"] as DeckStatus[]
          ).map((s) => (
            <button
              key={s}
              onClick={() => setStatus.mutate(s)}
              className={
                "rounded border px-2 py-0.5 " +
                (deck.status === s
                  ? STATUS_COLOR[s]
                  : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
              }
            >
              {DECK_STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["pdf", "markdown", "html", "text"] as const).map((f) => (
            <Button key={f} variant="outline" onClick={() => download(f)} disabled={busy !== null}>
              {busy === f ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Export {f.toUpperCase()}
            </Button>
          ))}
          <span
            className="text-[10px] text-bone-500"
            title="PPTX needs a dedicated library and will ship separately."
          >
            PPTX — coming soon
          </span>
        </div>
        {error && <div className="mt-2 text-xs text-red-300">{error}</div>}
        {regenAll.error && (
          <div className="mt-2 text-xs text-red-300">{(regenAll.error as Error).message}</div>
        )}
      </div>

      <ul className="space-y-2">
        {deck.slides.map((s, i) => (
          <SlideRow
            key={s.id}
            slide={s}
            index={i}
            total={deck.slides.length}
            projectId={projectId}
            deckId={deck.id}
          />
        ))}
      </ul>
      <AddSlideButton projectId={projectId} deckId={deck.id} />
    </div>
  );
}

function SlideRow({
  slide,
  index,
  total,
  projectId,
  deckId,
}: {
  slide: DeckSlide;
  index: number;
  total: number;
  projectId: string;
  deckId: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: slide.title,
    copy: slide.copy,
    speakerNotes: slide.speakerNotes ?? "",
    visualDirection: slide.visualDirection ?? "",
    imagePrompt: slide.imagePrompt ?? "",
  });
  const patch = useMutation({
    mutationFn: (p: Partial<DeckSlide>) => api.patchPitchSlide(projectId, deckId, slide.id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });
  const regen = useMutation({
    mutationFn: (steering?: string) => api.regeneratePitchSlide(projectId, deckId, slide.id, steering),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });
  const del = useMutation({
    mutationFn: () => api.deletePitchSlide(projectId, deckId, slide.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });
  const move = useMutation({
    mutationFn: (newIdx: number) => {
      // Build the next id-order list from the current deck.
      return api
        .getPitchDeck(projectId, deckId)
        .then((d) => {
          const ids = d.slides.map((s) => s.id);
          const cur = ids.indexOf(slide.id);
          if (cur < 0) return d;
          ids.splice(cur, 1);
          ids.splice(Math.max(0, Math.min(ids.length, newIdx)), 0, slide.id);
          return api.reorderPitchSlides(projectId, deckId, ids);
        });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] }),
  });

  const onSave = () => {
    patch.mutate({
      title: form.title.trim(),
      copy: form.copy,
      speakerNotes: form.speakerNotes.trim() || undefined,
      visualDirection: form.visualDirection.trim() || undefined,
      imagePrompt: form.imagePrompt.trim() || undefined,
    });
    setEditing(false);
  };

  return (
    <li className="rounded-md border border-white/8 bg-black/20 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-bone-500">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="font-serif text-base text-bone-50">{slide.title}</h3>
          {slide.custom && <span className="chip border-white/12 bg-white/[0.04] text-bone-300">custom</span>}
          {slide.locked && <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">locked</span>}
          {slide.approved && (
            <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">approved</span>
          )}
          {slide.needsRevision && !slide.approved && (
            <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">needs revision</span>
          )}
          {slide.edited && (
            <span className="chip border-sky-700/40 bg-sky-900/20 text-sky-200">edited</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => move.mutate(index - 1)}
            disabled={index === 0 || move.isPending}
            className="rounded border border-white/10 px-1 py-0.5 text-[10px] text-bone-400 hover:bg-white/[0.04] disabled:opacity-30"
            title="Move up"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            onClick={() => move.mutate(index + 1)}
            disabled={index === total - 1 || move.isPending}
            className="rounded border border-white/10 px-1 py-0.5 text-[10px] text-bone-400 hover:bg-white/[0.04] disabled:opacity-30"
            title="Move down"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
          <button
            onClick={() => patch.mutate({ locked: !slide.locked })}
            className="rounded border border-white/10 px-1 py-0.5 text-[10px] text-bone-400 hover:bg-white/[0.04]"
            title={slide.locked ? "Unlock" : "Lock"}
          >
            {slide.locked ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          </button>
          <button
            onClick={() => patch.mutate({ approved: !slide.approved })}
            className={
              "rounded border px-2 py-0.5 text-[10px] " +
              (slide.approved
                ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
                : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
            }
          >
            <Check className="mr-1 inline h-3 w-3" />
            {slide.approved ? "Approved" : "Approve"}
          </button>
          {!slide.custom && (
            <button
              onClick={() => regen.mutate(undefined)}
              disabled={regen.isPending || slide.locked}
              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
              title={slide.locked ? "Slide is locked." : "Regenerate this slide"}
            >
              {regen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
            </button>
          )}
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={() => del.mutate()}
            className="rounded border border-red-800/40 bg-red-950/20 px-1 py-0.5 text-[10px] text-red-200 hover:bg-red-950/40"
            title="Delete slide"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {!editing ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm text-bone-200">{slide.copy || <em className="text-bone-500">No copy yet — click Generate.</em>}</p>
          {slide.visualDirection && (
            <div className="mt-2 text-[11px] text-bone-400">
              <span className="text-bone-500">Visual:</span> {slide.visualDirection}
            </div>
          )}
          {slide.imagePrompt && (
            <div className="mt-1 text-[11px] text-bone-400">
              <span className="text-bone-500">Image prompt:</span>{" "}
              <code className="text-bone-300">{slide.imagePrompt}</code>
            </div>
          )}
          {slide.speakerNotes && (
            <div className="mt-1 text-[11px] text-bone-400">
              <span className="text-bone-500">Speaker notes:</span> {slide.speakerNotes}
            </div>
          )}
          {slide.sourcesUsed.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-bone-500">
              <span>uses:</span>
              {slide.sourcesUsed.map((s) => (
                <span key={s} className="chip border-white/10 bg-white/[0.02]">{SOURCE_FIELD_LABEL[s]}</span>
              ))}
            </div>
          )}
          {slide.missingSources.length > 0 && (
            <div className="mt-2 rounded border border-amber-700/40 bg-amber-900/15 p-2 text-[11px] text-amber-200">
              <strong>Missing source data:</strong>{" "}
              {slide.missingSources.map((s) => SOURCE_FIELD_LABEL[s]).join(", ")}.
              Fill these in the bibles or in the Source Inputs panel on the right before approving.
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 space-y-2">
          <input
            className="input w-full"
            value={form.title}
            onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))}
          />
          <textarea
            className="input w-full min-h-[120px] text-sm"
            value={form.copy}
            onChange={(e) => setForm((s) => ({ ...s, copy: e.target.value }))}
            placeholder="Slide copy…"
          />
          <input
            className="input w-full text-xs"
            value={form.speakerNotes}
            onChange={(e) => setForm((s) => ({ ...s, speakerNotes: e.target.value }))}
            placeholder="Speaker notes (optional)"
          />
          <input
            className="input w-full text-xs"
            value={form.visualDirection}
            onChange={(e) => setForm((s) => ({ ...s, visualDirection: e.target.value }))}
            placeholder="Visual direction (optional)"
          />
          <input
            className="input w-full text-xs"
            value={form.imagePrompt}
            onChange={(e) => setForm((s) => ({ ...s, imagePrompt: e.target.value }))}
            placeholder="Mood-board image prompt (optional)"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={onSave} disabled={patch.isPending}>
              {patch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function AddSlideButton({ projectId, deckId }: { projectId: string; deckId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const add = useMutation({
    mutationFn: () => api.addPitchSlide(projectId, deckId, title.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] });
      setOpen(false);
      setTitle("");
    },
  });
  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-white/10 px-2 py-2 text-xs text-bone-500 hover:bg-white/[0.04]"
      >
        <Plus className="h-3 w-3" /> Add custom slide
      </button>
    );
  return (
    <div className="rounded border border-white/8 bg-white/[0.02] p-2">
      <input
        className="input w-full"
        placeholder="Slide title…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        autoFocus
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button onClick={() => add.mutate()} disabled={!title.trim() || add.isPending}>
          {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add slide
        </Button>
      </div>
    </div>
  );
}

// --- Source inputs sidebar -------------------------------------------------

function SourcePanel({
  projectId,
  sources,
}: {
  projectId: string;
  sources?: SourceCheckResult;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    audience: ((sources?.manifest as Record<string, unknown> | undefined)?.audience as string) ?? "",
    creatorStatement:
      ((sources?.manifest as Record<string, unknown> | undefined)?.creatorStatement as string) ?? "",
    productionApproach:
      ((sources?.manifest as Record<string, unknown> | undefined)?.productionApproach as string) ?? "",
    comps: ((sources?.manifest as Record<string, unknown> | undefined)?.comps as string[])?.join(", ") ?? "",
  });
  const [hydrated, setHydrated] = useState(false);
  if (sources && !hydrated) {
    setHydrated(true);
    const m = sources.manifest as Record<string, unknown>;
    setForm({
      audience: (m.audience as string) ?? "",
      creatorStatement: (m.creatorStatement as string) ?? "",
      productionApproach: (m.productionApproach as string) ?? "",
      comps: ((m.comps as string[]) ?? []).join(", "),
    });
  }
  const save = useMutation({
    mutationFn: () =>
      api.patchPitchSources(projectId, {
        audience: form.audience.trim() || undefined,
        creatorStatement: form.creatorStatement.trim() || undefined,
        productionApproach: form.productionApproach.trim() || undefined,
        comps: form.comps
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pitch-sources", projectId] });
      qc.invalidateQueries({ queryKey: ["pitch-decks", projectId] });
    },
  });

  const missing = sources?.missing ?? [];

  return (
    <div className="space-y-3">
      <Panel eyebrow="Sources" title="Source inputs">
        <p className="text-xs text-bone-400">
          The deck generator only uses approved bible data. Fill anything missing here — the
          generator will pick it up on the next regeneration. <strong>Nothing is invented.</strong>
        </p>
        <div className="mt-3 space-y-2">
          <label className="block">
            <div className="label-eyebrow mb-1">Comparable titles (comma-separated)</div>
            <input
              className="input w-full text-xs"
              value={form.comps}
              onChange={(e) => setForm((s) => ({ ...s, comps: e.target.value }))}
            />
          </label>
          <label className="block">
            <div className="label-eyebrow mb-1">Target audience</div>
            <input
              className="input w-full text-xs"
              value={form.audience}
              onChange={(e) => setForm((s) => ({ ...s, audience: e.target.value }))}
            />
          </label>
          <label className="block">
            <div className="label-eyebrow mb-1">Creator statement</div>
            <textarea
              className="input min-h-[64px] w-full text-xs"
              value={form.creatorStatement}
              onChange={(e) => setForm((s) => ({ ...s, creatorStatement: e.target.value }))}
            />
          </label>
          <label className="block">
            <div className="label-eyebrow mb-1">Production approach</div>
            <textarea
              className="input min-h-[64px] w-full text-xs"
              value={form.productionApproach}
              onChange={(e) => setForm((s) => ({ ...s, productionApproach: e.target.value }))}
            />
          </label>
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save sources
            </Button>
          </div>
        </div>
      </Panel>

      <Panel eyebrow="Status" title="Source coverage">
        {sources ? (
          <div className="space-y-2 text-xs">
            <div className="text-bone-400">
              {sources.present.length} of {sources.present.length + sources.missing.length} approved
              source fields are present.
            </div>
            {missing.length > 0 ? (
              <ul className="space-y-2">
                {missing.map((m) => (
                  <MissingFieldCard
                    key={m}
                    field={m as SourceField}
                    detail={(sources.details ?? {})[m as SourceField]}
                    projectId={projectId}
                  />
                ))}
              </ul>
            ) : (
              <div className="rounded border border-emerald-700/40 bg-emerald-900/15 p-2 text-emerald-200">
                Every source field is in place. Generate or regenerate the deck.
              </div>
            )}
          </div>
        ) : (
          <div className="h-16 animate-pulse-soft rounded bg-white/[0.03]" />
        )}
      </Panel>
    </div>
  );
}

// --- Missing-field guidance --------------------------------------------------
// Every missing source field maps to "where it lives" + a CTA. The writer
// never sees a missing field without knowing how to fill it in.

interface FieldGuide {
  helper: string;
  /** Path under /projects/:projectId/… */
  toRel: string;
  ctaLabel: string;
  /** When true, the source lives in the Pitch Source Inputs sidebar — no nav. */
  inline?: boolean;
}

const FIELD_GUIDE: Record<SourceField, FieldGuide> = {
  title: {
    helper:
      "Project title comes from the project record. Set or rename it on the Project Overview header.",
    toRel: "",
    ctaLabel: "Open Project Overview",
  },
  genre: {
    helper:
      "Genre lives on the project. Set it from the Project Overview, or refine it inside the Treatment stage.",
    toRel: "",
    ctaLabel: "Open Project Overview",
  },
  format: {
    helper:
      "Format reflects the project kind (feature / pilot / miniseries / series). Set it from the Project Overview.",
    toRel: "",
    ctaLabel: "Open Project Overview",
  },
  logline: {
    helper:
      "Logline is pulled from the project or your approved Treatment. Set it from the Writers Room → Treatment.",
    toRel: "/writers-room",
    ctaLabel: "Open Writers Room",
  },
  synopsis: {
    helper:
      "Synopsis comes from the approved Treatment. Run or refine the Treatment stage in the Writers Room.",
    toRel: "/writers-room",
    ctaLabel: "Open Writers Room",
  },
  tone: {
    helper:
      "Tone tags live on the project. Use Load protocol on the Project Overview, or edit tone there.",
    toRel: "",
    ctaLabel: "Open Project Overview",
  },
  themes: {
    helper:
      "Themes are set in the Treatment. Approve a treatment with themes filled in to feed the deck.",
    toRel: "/writers-room",
    ctaLabel: "Open Writers Room",
  },
  world: {
    helper:
      "World statement comes from the Treatment. Make sure the Treatment's world statement is filled in.",
    toRel: "/writers-room",
    ctaLabel: "Open Writers Room",
  },
  characters: {
    helper:
      "Character bios are pulled from Bibles → Character Bible. Add bios and wants/needs/flaw there before generating.",
    toRel: "/character-bible",
    ctaLabel: "Open Character Bible",
  },
  relationships: {
    helper:
      "Relationship dynamics live on Bibles → Character Bible → Relationships. Add or approve pairings (what each character wants, withholds, the core tension, and a buyer-facing summary) before they show up in the deck.",
    toRel: "/character-bible?tab=relationships",
    ctaLabel: "Open Relationships",
  },
  season_arc: {
    helper:
      "Season arc is generated in the Writers Room workflow. Run the Season Arc stage to feed the deck.",
    toRel: "/writers-room",
    ctaLabel: "Open Writers Room",
  },
  episodes: {
    helper:
      "Episode summaries are pulled from Bibles → Episodes. Add or approve episode summaries there before generating a complete series pitch deck.",
    toRel: "/episodes",
    ctaLabel: "Open Episodes",
  },
  visual_language: {
    helper:
      "Visual language comes from the Treatment's Visual Tone field. Approve a treatment with visual tone written.",
    toRel: "/writers-room",
    ctaLabel: "Open Writers Room",
  },
  comps: {
    helper:
      "Add comparable titles in the Source Inputs panel above. Avoid generic comps — buyers spot them.",
    toRel: "",
    ctaLabel: "Use the Source Inputs panel",
    inline: true,
  },
  audience: {
    helper:
      "Add a buyer-credible audience statement in the Source Inputs panel above (demographic + psychographic).",
    toRel: "",
    ctaLabel: "Use the Source Inputs panel",
    inline: true,
  },
  creator_statement: {
    helper:
      "Add a first-person creator statement in the Source Inputs panel above. Restraint over biography.",
    toRel: "",
    ctaLabel: "Use the Source Inputs panel",
    inline: true,
  },
  production_approach: {
    helper:
      "Add the production methodology in the Source Inputs panel above (locations, schedule shape, AI-assisted pipeline).",
    toRel: "",
    ctaLabel: "Use the Source Inputs panel",
    inline: true,
  },
};

/**
 * Per-field state line. Episodes get a three-state message:
 *  • no records  → "No episode summaries found."
 *  • records but no usable loglines → "Episode records exist but none have a logline / summary yet."
 *  • records with loglines but titles unapproved → "Episode summaries exist but are not approved yet."
 *  • records present + approved → field is no longer on `missing` (no card rendered).
 */
function stateLine(field: SourceField, detail?: FieldDetail): string | null {
  if (!detail) return null;
  if (field === "episodes") {
    if (!detail.hasRecords) return "No episode summaries found.";
    if ((detail.usableCount ?? 0) === 0)
      return `Episode records exist (${detail.totalCount ?? 0}) but none have a logline / summary yet.`;
    if ((detail.approvedCount ?? 0) === 0)
      return `Episode summaries exist (${detail.usableCount ?? 0}) but are not approved yet.`;
    return null;
  }
  if (field === "characters") {
    if (!detail.hasRecords) return "No characters in the bible yet.";
    if ((detail.usableCount ?? 0) === 0)
      return `Characters exist (${detail.totalCount ?? 0}) but none have a bio / want yet.`;
    return null;
  }
  if (field === "relationships") {
    if (!detail.hasRecords) return "No relationship records exist yet.";
    if ((detail.usableCount ?? 0) === 0)
      return `Relationship pairings exist (${detail.totalCount ?? 0}) but need generated content.`;
    if ((detail.approvedCount ?? 0) === 0)
      return `Relationship dynamics generated but not approved (${detail.usableCount ?? 0} drafted).`;
    return null;
  }
  return detail.reason ?? null;
}

function MissingFieldCard({
  field,
  detail,
  projectId,
}: {
  field: SourceField;
  detail?: FieldDetail;
  projectId: string;
}) {
  const qc = useQueryClient();
  const guide = FIELD_GUIDE[field];
  const state = stateLine(field, detail);
  // Relationships get an inline "Generate Relationship Map" action so the
  // writer can fix the missing source without leaving the Pitch page.
  const relMap = useMutation({
    mutationFn: () => api.generateRelationshipMap(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pitch-sources", projectId] });
      qc.invalidateQueries({ queryKey: ["relationships", projectId] });
    },
  });
  const isRelationships = field === "relationships";
  return (
    <li className="rounded border border-amber-700/40 bg-amber-900/10 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium text-amber-100">{SOURCE_FIELD_LABEL[field]}</div>
        {detail?.hasRecords && (
          <span className="text-[10px] text-bone-500">
            {detail.totalCount ?? 0} record{detail.totalCount === 1 ? "" : "s"}
            {detail.usableCount != null && ` · ${detail.usableCount} usable`}
            {detail.approvedCount != null && ` · ${detail.approvedCount} approved`}
          </span>
        )}
      </div>
      {state && <div className="mt-0.5 text-[11px] text-amber-200">{state}</div>}
      <p className="mt-1 text-[11px] text-bone-300">{guide.helper}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isRelationships && (
          <Button
            onClick={() => relMap.mutate()}
            disabled={relMap.isPending}
            title="Reads your approved story + character bibles and writes the relationship dynamics."
          >
            {relMap.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {detail?.hasRecords && (detail?.usableCount ?? 0) === 0
              ? "Generate missing relationship dynamics"
              : "Generate Relationship Map"}
          </Button>
        )}
        {guide.inline ? (
          <span className="chip border-white/10 bg-white/[0.02] text-bone-400">
            {guide.ctaLabel}
          </span>
        ) : (
          <Link to={`/projects/${projectId}${guide.toRel}`}>
            <Button variant={isRelationships ? "ghost" : "outline"}>{guide.ctaLabel}</Button>
          </Link>
        )}
      </div>
      {relMap.error && (
        <div className="mt-1 text-[11px] text-red-300">{(relMap.error as Error).message}</div>
      )}
      {relMap.data && (
        <div className="mt-1 text-[11px] text-bone-400">
          Generated {relMap.data.generated ?? 0} relationship{relMap.data.generated === 1 ? "" : "s"}.
          Open <strong>Bibles → Relationships</strong> to review and approve.
        </div>
      )}
    </li>
  );
}

// Default export — used by App.tsx route.
export default PitchMaterialsPage;
