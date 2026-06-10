import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ContinuityTab } from "./ContinuityTab";
import { ProductionDesignTab } from "./ProductionDesignTab";
import {
  AlertTriangle,
  Check,
  Heart,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import type { Character } from "@toburt/shared";
import { api, REL_GEN_FIELDS } from "@/lib/api";
import { Explainer } from "@/components/ui/Explainer";
import { useUIMode } from "@/lib/uiMode";
import type {
  EntityType,
  RelationshipApproval,
  RelationshipFields,
  RelationshipImportance,
  RelationshipRow,
  RelGenField,
  RelationshipSuggestion,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

type Tab = "characters" | "relationships" | "continuity" | "production-design";

export function CharacterBiblePage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const [search, setSearch] = useSearchParams();
  const tab: Tab =
    search.get("tab") === "relationships"
      ? "relationships"
      : search.get("tab") === "continuity"
      ? "continuity"
      : search.get("tab") === "production-design"
      ? "production-design"
      : "characters";
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(search);
    if (t === "characters") next.delete("tab");
    else next.set("tab", t);
    setSearch(next);
  };
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.listCharacters(projectId),
  });

  // We hold only the selected ID — the actual Character object is derived
  // from list.data on every render. Holding the full object would mean
  // every mutation refetch lands in the cache while the panel keeps
  // showing the stale snapshot from the time of click (the multi-angle
  // delete looks broken under that pattern because the list refreshes
  // but the displayed object doesn't).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected: Character | null =
    (list.data ?? []).find((c) => c.id === selectedId) ?? null;
  const setSelected = (c: Character | null) => setSelectedId(c?.id ?? null);
  const [showNew, setShowNew] = useState(false);

  // Soft cleanup helper — flags compound-name characters ("Claire and Paul
  // Beaumont") so the writer knows they should split them for the
  // relationship workflow. We don't auto-split (destructive).
  const compoundNames = (list.data ?? []).filter((c) => / and | & /i.test(c.name));

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Character Bible"
        title="Cast & relationships"
        description="Characters, voices, arcs — plus the relationship pairings that drive the show. Approved entries become canon and feed the Pitch Materials Relationship Dynamics slide."
        actions={
          tab === "characters" ? (
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> New character
            </Button>
          ) : null
        }
      />

      <div className="px-8">
        <ExecutiveSummaryPanel projectId={projectId} />
      </div>

      <div className="px-8">
        <nav className="mb-4 flex gap-1 border-b border-white/8">
          <TabButton active={tab === "characters"} onClick={() => setTab("characters")}>
            <Users className="h-3.5 w-3.5" /> Characters
          </TabButton>
          {/* Explainer sits BESIDE the TabButton, not inside it — nested
              <button> nodes are invalid HTML and the warning matters
              because clicks on the "?" otherwise bubble to switch tabs. */}
          <span className="inline-flex items-center">
            <TabButton active={tab === "relationships"} onClick={() => setTab("relationships")}>
              <Heart className="h-3.5 w-3.5" /> Relationships
            </TabButton>
            <Explainer id="relationship_dynamics" inlineTerm="Relationships" />
          </span>
          <TabButton active={tab === "continuity"} onClick={() => setTab("continuity")}>
            <AlertTriangle className="h-3.5 w-3.5" /> Continuity
          </TabButton>
          <TabButton
            active={tab === "production-design"}
            onClick={() => setTab("production-design")}
          >
            <Sparkles className="h-3.5 w-3.5" /> Production Design
          </TabButton>
        </nav>

        {compoundNames.length > 0 && tab === "relationships" && (
          <CompoundNamesNotice
            chars={compoundNames}
            onMarked={() => qc.invalidateQueries({ queryKey: ["characters", projectId] })}
          />
        )}

        {tab === "characters" ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <Panel eyebrow="Roster" title="Characters">
              {list.isLoading ? (
                <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
              ) : (list.data ?? []).length === 0 ? (
                <EmptyState
                  Icon={Users}
                  title="No characters yet"
                  description="Create your protagonist to get started."
                  action={
                    <Button onClick={() => setShowNew(true)}>
                      <Plus className="h-4 w-4" /> Create
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-1.5">
                  {list.data!.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelected(c)}
                        className={`flex w-full items-start gap-2 rounded-md border border-white/8 p-2.5 text-left transition-colors ${
                          selected?.id === c.id ? "bg-white/[0.06]" : "bg-white/[0.02] hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="grid h-8 w-8 place-items-center rounded-md bg-white/[0.04] text-xs font-semibold text-bone-100">
                          {c.name.slice(0, 1)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm text-bone-50">{c.name}</div>
                          <div className="truncate text-xs text-bone-400">
                            {c.archetype ?? "—"} • {c.role ?? "—"}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel eyebrow="Detail" title={selected?.name ?? "Select a character"}>
              {selected ? (
                <CharacterDetail character={selected} />
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 p-8 text-center text-sm text-bone-400">
                  Pick a character to view their bible.
                </div>
              )}
            </Panel>
          </div>
        ) : tab === "relationships" ? (
          <RelationshipsTab projectId={projectId} cast={list.data ?? []} />
        ) : tab === "continuity" ? (
          <ContinuityTab projectId={projectId} />
        ) : (
          <ProductionDesignTab projectId={projectId} />
        )}
      </div>

      {showNew && (
        <NewCharacterDialog
          projectId={projectId}
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            qc.invalidateQueries({ queryKey: ["characters", projectId] });
            setSelected(c);
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

// Entity-type editor — only "individual" entries are eligible for
// relationship auto-suggest. Groups + relationship-notes are excluded.
function EntityTypeRow({ character }: { character: Character }) {
  const qc = useQueryClient();
  const meta = (character as unknown as { metadata?: { entityType?: EntityType } }).metadata ?? {};
  const current: EntityType = meta.entityType ?? "individual";
  const set = useMutation({
    mutationFn: (t: EntityType) => api.patchCharacterEntityType(character.id, t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-bone-500">Entity type:</span>
        {(["individual", "group", "relationship_note"] as EntityType[]).map((t) => (
          <button
            key={t}
            onClick={() => set.mutate(t)}
            disabled={set.isPending && set.variables === t}
            className={
              "rounded border px-2 py-0.5 " +
              (current === t
                ? "border-sky-700/60 bg-sky-900/30 text-sky-100"
                : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
            }
          >
            {t === "individual" ? "individual" : t === "group" ? "group / duo" : "relationship note"}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-bone-500">
          Only individuals are eligible for relationship auto-suggest.
        </span>
      </div>
    </div>
  );
}

// Soft cleanup helper: characters whose names look like duos / groups
// ("Claire and Paul Beaumont") shouldn't drive pair generation. The
// writer can either (a) split into two individual records or (b) flip the
// entity type to "group", which excludes them from auto-suggest.
function CompoundNamesNotice({
  chars,
  onMarked,
}: {
  chars: Character[];
  onMarked: () => void;
}) {
  const mark = useMutation({
    mutationFn: (id: string) => api.patchCharacterEntityType(id, "group"),
    onSuccess: onMarked,
  });
  return (
    <div className="mb-4 rounded-md border border-amber-700/40 bg-amber-900/15 p-3 text-xs text-amber-100">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">Combined characters detected</div>
          <div className="mt-1 text-bone-300">
            These records read like multiple people in one entry. For relationship dynamics,
            either split each into two individual characters (e.g. <em>Claire Beaumont</em> and
            <em> Paul Beaumont</em>) — then add the marriage as a separate pairing — or mark the
            record as a group so it's excluded from auto-suggest.
          </div>
          <ul className="mt-2 space-y-1">
            {chars.map((c) => {
              const meta = (c as unknown as { metadata?: { entityType?: EntityType } }).metadata ?? {};
              const isGroup = meta.entityType === "group";
              return (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-bone-200">“{c.name}”</span>
                  <div className="flex items-center gap-1">
                    {isGroup ? (
                      <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                        marked as group
                      </span>
                    ) : (
                      <button
                        onClick={() => mark.mutate(c.id)}
                        disabled={mark.isPending && mark.variables === c.id}
                        className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
                      >
                        {mark.isPending && mark.variables === c.id ? "…" : "Mark as group"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 -mb-px border-b-2 px-3 py-2 text-sm " +
        (active
          ? "border-ember-500 text-bone-50"
          : "border-transparent text-bone-400 hover:text-bone-200")
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Executive summary — project-level, 2-3 sentence pitch blurb of the cast.
// AI-generated, then showrunner-editable + approvable. Sits above the tabs.
// ---------------------------------------------------------------------------

function ExecutiveSummaryPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["character-bible-summary", projectId],
    queryFn: () => api.getCharacterBibleSummary(projectId),
  });
  const summary = q.data?.summary ?? null;

  const [draft, setDraft] = useState("");
  // Refresh the editor whenever the server text changes (keyed on updatedAt
  // so a generate/save/approve re-seeds it, but typing doesn't clobber).
  useEffect(() => {
    setDraft(summary?.text ?? "");
  }, [summary?.updatedAt, summary?.text]);

  const seed = (r: { summary: typeof summary }) =>
    qc.setQueryData(["character-bible-summary", projectId], r);
  const generate = useMutation({
    mutationFn: () => api.generateCharacterBibleSummary(projectId),
    onSuccess: seed,
  });
  const save = useMutation({
    mutationFn: () => api.saveCharacterBibleSummary(projectId, draft.trim()),
    onSuccess: seed,
  });
  const approve = useMutation({
    mutationFn: () => api.approveCharacterBibleSummary(projectId),
    onSuccess: seed,
  });

  const busy = generate.isPending || save.isPending || approve.isPending;
  const savedText = (summary?.text ?? "").trim();
  const dirty = draft.trim() !== savedText;
  const hasText = draft.trim().length > 0;
  const approved = !!summary?.approvedAt && !dirty;
  const err =
    (generate.error as Error | null)?.message ??
    (save.error as Error | null)?.message ??
    (approve.error as Error | null)?.message ??
    null;

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="font-serif text-bone-50">Executive summary</div>
          {summary &&
            (approved ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-700/40 bg-emerald-900/20 px-2 py-0.5 text-[10.5px] text-emerald-100">
                <Check className="h-3 w-3" /> Approved
              </span>
            ) : (
              <span className="inline-flex items-center rounded-md border border-amber-700/40 bg-amber-900/15 px-2 py-0.5 text-[10.5px] text-amber-100">
                Draft
              </span>
            ))}
        </div>
        <Button
          variant="outline"
          onClick={() => generate.mutate()}
          disabled={busy}
          title="Write a 2-3 sentence summary from your cast and approved relationships"
        >
          {generate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {savedText ? "Regenerate" : "Generate"}
        </Button>
      </div>

      <p className="mt-1 text-[11.5px] text-bone-400">
        A 2-3 sentence pitch-ready blurb of the ensemble, drawn from your cast and approved
        relationships. AI proposes — you edit and approve.
      </p>

      {q.isLoading ? (
        <div className="mt-3 text-[12.5px] text-bone-400">Loading…</div>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="No executive summary yet. Generate one from your cast, or write it here."
            className="mt-3 w-full resize-y rounded-md border border-white/10 bg-black/20 px-3 py-2 text-[13.5px] leading-relaxed text-bone-100 placeholder:text-bone-500 focus:border-ember-500/60 focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button onClick={() => save.mutate()} disabled={busy || !dirty || !hasText}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save edits
            </Button>
            <Button
              variant="outline"
              onClick={() => approve.mutate()}
              disabled={busy || !hasText || dirty || approved}
              title={dirty ? "Save your edits before approving" : "Approve this summary as canon"}
            >
              {approve.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {approved ? "Approved" : "Approve"}
            </Button>
            {dirty && hasText && (
              <span className="text-[11px] text-amber-200">Unsaved edits</span>
            )}
            {summary?.generatedAt && !dirty && (
              <span className="text-[11px] text-bone-500">
                Generated {new Date(summary.generatedAt).toLocaleDateString()}
              </span>
            )}
            {err && <span className="text-[11px] text-red-300">{err.slice(0, 80)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function CharacterDetail({ character }: { character: Character }) {
  const wound = useQuery({
    queryKey: ["wound", character.id],
    queryFn: () => api.getCharacterWound(character.id),
  });
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <EntityTypeRow character={character} />
      </div>
      <Field label="Archetype" value={character.archetype} />
      <Field label="Role" value={character.role} />
      <Field label="Want" value={character.wants} wide />
      <Field label="Need" value={character.needs} wide />
      <Field label="Flaw" value={character.flaw} wide />
      <Field label="Voice notes" value={character.voice_notes} wide pre />
      <Field label="Biography" value={character.biography} wide pre />
      {character.arc && (
        <div className="md:col-span-2">
          <div className="label-eyebrow mb-1">Arc</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {(["act1", "act2", "act3"] as const).map((k) => (
              <div
                key={k}
                className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm text-bone-200"
              >
                <div className="label-eyebrow mb-1">{k.toUpperCase()}</div>
                {(character.arc as Record<string, string>)?.[k] ?? "—"}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="md:col-span-2">
        <CharacterDNAEditor character={character} />
      </div>

      <div className="md:col-span-2">
        <VisualBibleCard character={character} />
      </div>

      <div className="md:col-span-2">
        <div className="label-eyebrow mb-1 flex items-center gap-2">
          Core wound
          <Explainer id="character_wound" />
          {wound.data && (
            <span className="chip">{wound.data.kind ?? "custom"}</span>
          )}
        </div>
        {!wound.data ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
            No wound tracked yet. Invoke the <strong>Wound</strong> agent in the
            Writers Room with this character's name to generate one.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Field label="Wound" value={wound.data.wound} />
            <Field label="Fear" value={wound.data.fear} />
            <Field label="Unmet need" value={wound.data.unmetNeed} />
            <Field label="Shame trigger" value={wound.data.shameTrigger} />
            <div className="md:col-span-2">
              <div className="label-eyebrow mb-1">Defenses</div>
              <div className="flex flex-wrap gap-1.5">
                {(wound.data.defenses ?? []).map((d: string) => (
                  <span key={d} className="chip">{d}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  wide,
  pre,
}: {
  label: string;
  value?: string | null;
  wide?: boolean;
  pre?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="label-eyebrow mb-1">{label}</div>
      <div
        className={`rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm text-bone-200 ${
          pre ? "whitespace-pre-wrap" : ""
        }`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

// Character DNA sheet — stored in characters.metadata.dna (no schema migration).
// The audit's Character Voice check reads cadence + bible names; the prompt
// builder injects DNA into every scene generation so AI never collapses voices.
// AI never writes DNA — only the user does.
function CharacterDNAEditor({ character }: { character: Character }) {
  const qc = useQueryClient();
  const dna: Partial<{
    core_wound: string;
    public_mask: string;
    private_fear: string;
    speech_cadence: string;
    behavioral_tics: string[];
    emotional_triggers: string[];
    defensive_strategies: string[];
    avoids_saying: string[];
    how_lies: string;
    shows_vulnerability: string;
  }> = ((character as unknown as { metadata?: { dna?: Record<string, unknown> } }).metadata?.dna ?? {}) as Record<
    string,
    never
  >;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    core_wound: (dna.core_wound as string) ?? "",
    public_mask: (dna.public_mask as string) ?? "",
    private_fear: (dna.private_fear as string) ?? "",
    speech_cadence: (dna.speech_cadence as string) ?? "",
    behavioral_tics: ((dna.behavioral_tics as string[]) ?? []).join(", "),
    emotional_triggers: ((dna.emotional_triggers as string[]) ?? []).join(", "),
    defensive_strategies: ((dna.defensive_strategies as string[]) ?? []).join(", "),
    avoids_saying: ((dna.avoids_saying as string[]) ?? []).join(", "),
    how_lies: (dna.how_lies as string) ?? "",
    shows_vulnerability: (dna.shows_vulnerability as string) ?? "",
  });
  const save = useMutation({
    mutationFn: () =>
      api.patchCharacterDna(character.id, {
        core_wound: form.core_wound.trim() || undefined,
        public_mask: form.public_mask.trim() || undefined,
        private_fear: form.private_fear.trim() || undefined,
        speech_cadence: form.speech_cadence.trim() || undefined,
        behavioral_tics: splitTags(form.behavioral_tics),
        emotional_triggers: splitTags(form.emotional_triggers),
        defensive_strategies: splitTags(form.defensive_strategies),
        avoids_saying: splitTags(form.avoids_saying),
        how_lies: form.how_lies.trim() || undefined,
        shows_vulnerability: form.shows_vulnerability.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters"] });
      setOpen(false);
    },
  });

  const hasDna = Object.keys(dna).length > 0;

  return (
    <div>
      <div className="label-eyebrow mb-1 flex items-center justify-between">
        <span>
          Character DNA
          <Explainer id="character_dna" />
        </span>
        <button
          onClick={() => setOpen((x) => !x)}
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
        >
          {open ? "Close" : hasDna ? "Edit DNA" : "Add DNA"}
        </button>
      </div>
      {!open && !hasDna && (
        <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
          No DNA yet. Add core wound, mask, fear, cadence, tics, triggers, defenses, what they avoid
          saying, how they lie, how they show vulnerability — the audit + prompt builder use these.
        </div>
      )}
      {!open && hasDna && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {dna.core_wound && <Field label="Core wound" value={dna.core_wound as string} />}
          {dna.public_mask && <Field label="Public mask" value={dna.public_mask as string} />}
          {dna.private_fear && <Field label="Private fear" value={dna.private_fear as string} />}
          {dna.speech_cadence && <Field label="Speech cadence" value={dna.speech_cadence as string} />}
          {dna.how_lies && <Field label="How they lie" value={dna.how_lies as string} />}
          {dna.shows_vulnerability && (
            <Field label="Shows vulnerability" value={dna.shows_vulnerability as string} />
          )}
          {(dna.behavioral_tics ?? []).length > 0 && (
            <ChipList label="Behavioral tics" items={dna.behavioral_tics as string[]} />
          )}
          {(dna.emotional_triggers ?? []).length > 0 && (
            <ChipList label="Emotional triggers" items={dna.emotional_triggers as string[]} />
          )}
          {(dna.defensive_strategies ?? []).length > 0 && (
            <ChipList label="Defensive strategies" items={dna.defensive_strategies as string[]} />
          )}
          {(dna.avoids_saying ?? []).length > 0 && (
            <ChipList label="Avoids saying" items={dna.avoids_saying as string[]} />
          )}
        </div>
      )}
      {open && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {(
            [
              ["core_wound", "Core wound"],
              ["public_mask", "Public mask"],
              ["private_fear", "Private fear"],
              ["speech_cadence", "Speech cadence"],
              ["how_lies", "How they lie"],
              ["shows_vulnerability", "Shows vulnerability"],
            ] as const
          ).map(([k, label]) => (
            <DnaInput
              key={k}
              label={label}
              value={form[k]}
              onChange={(v) => setForm((s) => ({ ...s, [k]: v }))}
            />
          ))}
          {(
            [
              ["behavioral_tics", "Behavioral tics (comma-separated)"],
              ["emotional_triggers", "Emotional triggers"],
              ["defensive_strategies", "Defensive strategies"],
              ["avoids_saying", "Avoids saying"],
            ] as const
          ).map(([k, label]) => (
            <DnaInput
              key={k}
              label={label}
              value={form[k]}
              onChange={(v) => setForm((s) => ({ ...s, [k]: v }))}
            />
          ))}
          {save.error && (
            <div className="md:col-span-2 text-xs text-red-300">{(save.error as Error).message}</div>
          )}
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save DNA"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Visual Bible card — the photographable counterpart to Character DNA.
// Lives at characters.metadata.visualBible. The composer reads
// characterConsistencyPrompt + referenceImageUrl off this object for every
// shot a character appears in.
//
// V3 adds: masterCharacterImagePrompt (separate from consistencyPrompt —
// used ONCE to generate the canonical reference image), profileStatus +
// referenceImageStatus pills, and a manualEdits map that protects writer-
// typed fields from future auto-extractor overwrite.
type ProfileStatus = "incomplete" | "needs_review" | "production_ready";
// V3.1 — widened to cover the Midjourney → Kling lifecycle: missing →
// generated → uploaded → bound_to_element → approved. pending_approval
// stays for the simple Midjourney flow; not_applicable is voice/text.
type ReferenceImageStatus =
  | "missing"
  | "generated"
  | "uploaded"
  | "pending_approval"
  | "approved"
  | "bound_to_element"
  | "not_applicable";
// V3.1 — the image-gen target the writer is using for THIS character.
// Drives which fields surface (Kling shows Element ID + multi-angle list;
// Midjourney shows --cref URL only).
type ReferencePlatform =
  | "midjourney"
  | "kling_image"
  | "kling_element"
  | "runway"
  | "generic";
const PLATFORM_LABEL: Record<ReferencePlatform, string> = {
  midjourney: "Midjourney",
  kling_image: "Kling Image",
  kling_element: "Kling Element / Character Reference",
  runway: "Runway",
  generic: "Generic image URL",
};
type KlingRefImage = { url: string; angle?: string; label?: string };
function VisualBibleCard({ character }: { character: Character }) {
  const qc = useQueryClient();
  const root = ((character as unknown as { metadata?: { visualBible?: Record<string, unknown> } })
    .metadata?.visualBible ?? {}) as Record<string, unknown>;
  // V2 shape lives flat on the visualBible object; V1 was nested under .fields.
  const v2VisualCanon = root.visualCanon as Record<string, unknown> | undefined;
  const v2MovementCanon = root.movementCanon as string[] | undefined;
  const v1Fields = root.fields as Record<string, unknown> | undefined;
  const isV2 = !!v2VisualCanon || Array.isArray(v2MovementCanon);
  const vb = (v2VisualCanon ?? v1Fields ?? {}) as Record<string, unknown>;
  const hasVisualBible = Object.keys(vb).length > 0 || (Array.isArray(v2MovementCanon) && v2MovementCanon.length > 0);
  const refUrl = typeof root.referenceImageUrl === "string"
    ? root.referenceImageUrl
    : typeof v1Fields?.referenceImageUrl === "string"
    ? (v1Fields.referenceImageUrl as string)
    : "";
  const consistencyPrompt = typeof root.characterConsistencyPrompt === "string"
    ? root.characterConsistencyPrompt
    : typeof v1Fields?.consistencyPrompt === "string"
    ? (v1Fields.consistencyPrompt as string)
    : "";
  // V3: master prompt is on root.masterCharacterImagePrompt. Legacy fallbacks
  // remain for older projects that wrote it under root.masterImagePrompt or
  // v1Fields.masterCharacterImagePrompt.
  const masterImagePrompt =
    typeof root.masterCharacterImagePrompt === "string"
      ? (root.masterCharacterImagePrompt as string)
      : typeof root.masterImagePrompt === "string"
      ? (root.masterImagePrompt as string)
      : typeof v1Fields?.masterCharacterImagePrompt === "string"
      ? (v1Fields.masterCharacterImagePrompt as string)
      : "";
  const masterImageNegative =
    typeof root.masterCharacterImageNegative === "string"
      ? (root.masterCharacterImageNegative as string)
      : "";
  const masterImageAspectRatio =
    typeof root.masterCharacterImageAspectRatio === "string"
      ? (root.masterCharacterImageAspectRatio as string)
      : "";
  const profileStatus =
    (root.profileStatus as ProfileStatus | undefined) ?? "incomplete";
  const referenceImageStatus =
    (root.referenceImageStatus as ReferenceImageStatus | undefined) ?? "missing";
  const manualEdits =
    (root.manualEdits as Record<string, boolean> | undefined) ?? {};
  // V3.1 — Kling / multi-platform reference fields. Default platform is
  // midjourney for principals, kling_element for any character that
  // already has a Kling Element ID. Voice/text characters bypass.
  const approvedReferenceImageUrl =
    typeof root.approvedReferenceImageUrl === "string"
      ? (root.approvedReferenceImageUrl as string)
      : "";
  const klingElementId =
    typeof root.klingElementId === "string" ? (root.klingElementId as string) : "";
  const klingElementName =
    typeof root.klingElementName === "string"
      ? (root.klingElementName as string)
      : "";
  const klingReferenceImages: KlingRefImage[] = Array.isArray(root.klingReferenceImages)
    ? (root.klingReferenceImages as KlingRefImage[]).filter(
        (r) => r && typeof r.url === "string" && r.url.trim().length > 0
      )
    : [];
  const referencePlatform =
    (root.referencePlatform as ReferencePlatform | undefined) ??
    (klingElementId ? "kling_element" : "midjourney");
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(refUrl);
  const [copied, setCopied] = useState<"" | "master" | "consistency" | "negative" | "kling-id">("");
  // V3.1 form drafts (local, not React Query state — saved via mutation).
  // Keyed by character.id so switching characters in the roster gives
  // each its own draft; the useEffect resyncs when the persisted value
  // changes (after a successful save the cached character is replaced).
  const [approvedUrlDraft, setApprovedUrlDraft] = useState(approvedReferenceImageUrl);
  const [klingIdDraft, setKlingIdDraft] = useState(klingElementId);
  const [klingNameDraft, setKlingNameDraft] = useState(klingElementName);
  const [newAngleUrl, setNewAngleUrl] = useState("");
  const [newAngleLabel, setNewAngleLabel] = useState("");
  useEffect(() => {
    setApprovedUrlDraft(approvedReferenceImageUrl);
    setKlingIdDraft(klingElementId);
    setKlingNameDraft(klingElementName);
    setUrlDraft(refUrl);
    // Intentionally re-syncing draft state on character switch / refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.id, approvedReferenceImageUrl, klingElementId, klingElementName, refUrl]);
  const saveUrl = useMutation({
    mutationFn: () =>
      api.patchCharacterReferenceImage(character.id, {
        referenceImageUrl: urlDraft.trim() || null,
        // Pasting a URL puts the image into pending_approval until the
        // writer explicitly approves it. Clearing a URL drops back to
        // missing (unless this character is voice/text — leave that alone).
        referenceImageStatus: urlDraft.trim()
          ? "pending_approval"
          : referenceImageStatus === "not_applicable"
          ? "not_applicable"
          : "missing",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["characters"] });
      setEditingUrl(false);
    },
  });
  const genMaster = useMutation({
    mutationFn: () =>
      api.generateMasterImagePrompt(character.id, { episodeNumber: 1 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  const setProfile = useMutation({
    mutationFn: (s: ProfileStatus) =>
      api.patchCharacterProfileStatus(character.id, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  const setRefStatus = useMutation({
    mutationFn: (s: ReferenceImageStatus) =>
      api.patchCharacterReferenceImage(character.id, { referenceImageStatus: s }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  // V3.1 mutations.
  const setPlatform = useMutation({
    mutationFn: (p: ReferencePlatform) =>
      api.patchCharacterReferenceImage(character.id, { referencePlatform: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  // Mutations take an explicit value so Clear / Unbind don't fall victim
  // to the stale-state closure (setState is async; if we read the draft
  // inside the mutationFn we get the value from BEFORE the click cleared
  // it).
  const saveApprovedUrl = useMutation({
    mutationFn: (url: string | null) =>
      api.patchCharacterReferenceImage(character.id, {
        approvedReferenceImageUrl: url && url.trim() ? url.trim() : null,
        referenceImageStatus:
          url && url.trim()
            ? "approved"
            : referenceImageStatus === "approved"
            ? "pending_approval"
            : referenceImageStatus,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  const saveKlingElement = useMutation({
    mutationFn: (v: { id: string | null; name: string | null }) =>
      api.patchCharacterReferenceImage(character.id, {
        klingElementId: v.id && v.id.trim() ? v.id.trim() : null,
        klingElementName: v.name && v.name.trim() ? v.name.trim() : null,
        referenceImageStatus:
          v.id && v.id.trim()
            ? "bound_to_element"
            : referenceImageStatus === "bound_to_element"
            ? "uploaded"
            : referenceImageStatus,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  const addAngle = useMutation({
    mutationFn: () =>
      api.patchCharacterReferenceImage(character.id, {
        klingReferenceImages: [
          ...klingReferenceImages,
          {
            url: newAngleUrl.trim(),
            label: newAngleLabel.trim() || undefined,
          },
        ],
      }),
    onSuccess: () => {
      setNewAngleUrl("");
      setNewAngleLabel("");
      qc.invalidateQueries({ queryKey: ["characters"] });
    },
  });
  const removeAngle = useMutation({
    mutationFn: (next: KlingRefImage[]) =>
      api.patchCharacterReferenceImage(character.id, {
        klingReferenceImages: next,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["characters"] }),
  });
  const productionReady = useQuery({
    queryKey: ["characterProductionReady", character.id, JSON.stringify(root)],
    queryFn: () => api.getCharacterProductionReady(character.id),
  });
  const copy = async (text: string, kind: "master" | "consistency" | "negative" | "kling-id") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked — silent. */
    }
  };

  if (!hasVisualBible) {
    return (
      <div>
        <div className="label-eyebrow mb-1">Visual Bible</div>
        <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
          No Visual Bible yet. The Visual Bible carries the photographable
          identity used by every AI-video and image generator — wardrobe,
          movement, casting reference, master image prompt.
        </div>
      </div>
    );
  }

  const str = (k: string) => (typeof vb[k] === "string" ? (vb[k] as string) : "");
  const profilePill = (() => {
    switch (profileStatus) {
      case "production_ready":
        return "border-emerald-700/40 bg-emerald-900/20 text-emerald-200";
      case "needs_review":
        return "border-amber-700/40 bg-amber-900/20 text-amber-100";
      default:
        return "border-white/10 bg-white/[0.04] text-bone-300";
    }
  })();
  const refPill = (() => {
    switch (referenceImageStatus) {
      case "approved":
      case "bound_to_element":
        return "border-emerald-700/40 bg-emerald-900/20 text-emerald-200";
      case "pending_approval":
      case "uploaded":
        return "border-amber-700/40 bg-amber-900/20 text-amber-100";
      case "generated":
        return "border-sky-700/40 bg-sky-900/20 text-sky-200";
      case "not_applicable":
        return "border-sky-700/40 bg-sky-900/20 text-sky-200";
      default:
        return "border-red-800/40 bg-red-950/20 text-red-200";
    }
  })();
  const profileLabel = profileStatus.replace("_", " ");
  const refLabel = referenceImageStatus.replace("_", " ");
  const isVoiceOrText = referenceImageStatus === "not_applicable";

  return (
    <div>
      <div className="label-eyebrow mb-2 flex flex-wrap items-center gap-2">
        Visual Bible
        <span className="chip border-ember-700/40 bg-ember-900/15 text-ember-200">
          v{(character as unknown as { metadata?: { visualBible?: { version?: number } } })
            .metadata?.visualBible?.version ?? 3}
        </span>
        <span className={"chip " + profilePill} title="Profile status">
          {profileLabel}
        </span>
        <span className={"chip " + refPill} title="Reference image status">
          ref: {refLabel}
        </span>
        {Object.keys(manualEdits).length > 0 && (
          <span
            className="chip border-white/10 bg-white/[0.04] text-bone-400"
            title={`Writer-protected fields: ${Object.keys(manualEdits).join(", ")}`}
          >
            {Object.keys(manualEdits).length} writer-protected
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <select
            className="input py-0.5 text-[10px]"
            // Optimistic display — same pattern as the platform select.
            value={
              setProfile.isPending && setProfile.variables
                ? (setProfile.variables as ProfileStatus)
                : profileStatus
            }
            onChange={(e) => setProfile.mutate(e.target.value as ProfileStatus)}
            disabled={setProfile.isPending}
            title="Profile status — production_ready unlocks shot generation."
          >
            <option value="incomplete">incomplete</option>
            <option value="needs_review">needs review</option>
            <option value="production_ready">production ready</option>
          </select>
        </div>
      </div>

      {/* Master reference image — the digital actor.
          Voice/text-only characters (Daniel in EP01) don't get an actor
          photo; the master asset is the text-thread screenshot prompt
          instead, surfaced as the Master Image Prompt below. */}
      {!isVoiceOrText ? (
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <div className="aspect-[2/3] overflow-hidden rounded-md border border-white/8 bg-white/[0.02]">
            {refUrl ? (
              <img
                src={refUrl}
                alt={`${character.name} reference`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full place-items-center p-2 text-center text-[10px] text-bone-500">
                No reference image yet
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <div className="label-eyebrow flex items-center justify-between gap-2">
              <span>Master reference image</span>
              {referenceImageStatus === "pending_approval" && refUrl && (
                <button
                  onClick={() => setRefStatus.mutate("approved")}
                  disabled={setRefStatus.isPending}
                  className="rounded border border-emerald-700/40 bg-emerald-900/20 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-40"
                  title="Mark this reference image as approved — unlocks Maya for shot generation."
                >
                  <Check className="mr-1 inline h-3 w-3" /> Approve image
                </button>
              )}
              {referenceImageStatus === "approved" && (
                <button
                  onClick={() => setRefStatus.mutate("pending_approval")}
                  disabled={setRefStatus.isPending}
                  className="rounded border border-amber-700/40 bg-amber-900/20 px-2 py-0.5 text-[10px] text-amber-100 hover:bg-amber-900/40 disabled:opacity-40"
                  title="Unapprove this reference image — moves it back to pending review."
                >
                  Unapprove
                </button>
              )}
            </div>
            {!editingUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-[11px] text-bone-400">
                  {refUrl ||
                    "Run the Master Character Image Prompt through Midjourney / Luma, then paste the URL here. Every future shot of this character will use it as a reference."}
                </div>
                <button
                  onClick={() => {
                    setUrlDraft(refUrl);
                    setEditingUrl(true);
                  }}
                  className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                >
                  {refUrl ? "Edit URL" : "Paste URL"}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://…"
                  className="input flex-1 py-1 text-xs"
                />
                <Button variant="ghost" onClick={() => setEditingUrl(false)}>
                  Cancel
                </Button>
                <Button onClick={() => saveUrl.mutate()} disabled={saveUrl.isPending}>
                  {saveUrl.isPending ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
            {saveUrl.error && (
              <div className="text-[10px] text-red-300">
                {(saveUrl.error as Error).message}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-md border border-sky-700/40 bg-sky-900/15 p-3 text-[11px] text-sky-100">
          Voice / text-only character — no actor photo. The Master Image Prompt
          below renders the messaging-app screenshot used wherever this
          character appears on a phone screen. No face, body, or silhouette
          will be generated.
        </div>
      )}

      {/* V3.1 — Reference-platform workflow (Kling / Midjourney / Runway /
          Generic). Hidden for voice-or-text characters. The platform
          selector chooses which fields the writer fills; the composer
          reads the resolved fields and threads them as structured
          reference metadata into every shot prompt for this character. */}
      {!isVoiceOrText && (
        <div className="mb-3 rounded-md border border-white/8 bg-black/20 p-3 text-xs">
          <div className="label-eyebrow mb-2 flex flex-wrap items-center gap-2">
            <span>Reference workflow</span>
            <span className="chip border-white/10 bg-white/[0.04] text-bone-400">
              {PLATFORM_LABEL[referencePlatform]}
            </span>
            <div className="ml-auto">
              <select
                className="input py-0.5 text-[10px]"
                // Optimistic display: while a platform mutation is in flight,
                // show the value the user just picked instead of the stale
                // server value. Without this the controlled select snaps
                // back to the old value mid-flight and looks broken.
                value={
                  setPlatform.isPending && setPlatform.variables
                    ? (setPlatform.variables as ReferencePlatform)
                    : referencePlatform
                }
                onChange={(e) =>
                  setPlatform.mutate(e.target.value as ReferencePlatform)
                }
                disabled={setPlatform.isPending}
                title="Which image-gen platform this character's reference lives on."
              >
                {(Object.keys(PLATFORM_LABEL) as ReferencePlatform[]).map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
              {setPlatform.isPending && (
                <div className="text-right text-[10px] text-bone-500">Saving…</div>
              )}
              {setPlatform.isSuccess && !setPlatform.isPending && (
                <div className="text-right text-[10px] text-emerald-300">Saved.</div>
              )}
              {setPlatform.error && (
                <div className="text-right text-[10px] text-red-300">
                  {(setPlatform.error as Error).message}
                </div>
              )}
            </div>
          </div>

          {/* Approved reference image URL — preferred over the in-flight
              referenceImageUrl. Future Maya shot prompts include this. */}
          <div className="mb-2 grid grid-cols-1 gap-1.5">
            <label className="label-eyebrow flex items-center justify-between gap-2">
              <span>Approved reference image URL</span>
              {approvedReferenceImageUrl && (
                <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                  approved
                </span>
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                value={approvedUrlDraft}
                onChange={(e) => setApprovedUrlDraft(e.target.value)}
                placeholder="https://… (paste the canonical, approved image URL)"
                className="input flex-1 py-1 text-xs"
              />
              <Button
                onClick={() => saveApprovedUrl.mutate(approvedUrlDraft)}
                disabled={
                  saveApprovedUrl.isPending ||
                  approvedUrlDraft.trim() === approvedReferenceImageUrl.trim()
                }
              >
                {saveApprovedUrl.isPending ? "Saving…" : "Save & approve"}
              </Button>
              {approvedReferenceImageUrl && (
                <button
                  onClick={() => {
                    setApprovedUrlDraft("");
                    saveApprovedUrl.mutate(null);
                  }}
                  disabled={saveApprovedUrl.isPending}
                  className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
                  title="Clear the approved URL (drops back to pending_approval)."
                >
                  Clear
                </button>
              )}
            </div>
            {saveApprovedUrl.error && (
              <div className="text-[10px] text-red-300">
                {(saveApprovedUrl.error as Error).message}
              </div>
            )}
            {saveApprovedUrl.isSuccess && !saveApprovedUrl.error && (
              <div className="text-[10px] text-emerald-300">Saved.</div>
            )}
            {approvedReferenceImageUrl && (
              <a
                href={approvedReferenceImageUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-[10px] text-sky-300 hover:underline"
              >
                {approvedReferenceImageUrl}
              </a>
            )}
            <div className="text-[10px] text-bone-500">
              This URL is threaded into every shot prompt for {character.name}{" "}
              as structured metadata. Midjourney <code>--cref</code>, Kling
              image-to-video, Runway reference all read it.
            </div>
          </div>

          {/* Kling Element — only meaningful on the Kling Element platform,
              but we surface the fields for kling_image too so the writer
              can upgrade later without losing data. */}
          {(referencePlatform === "kling_element" ||
            referencePlatform === "kling_image") && (
            <div className="mt-2 grid grid-cols-1 gap-1.5">
              <label className="label-eyebrow flex items-center justify-between gap-2">
                <span>Kling Element</span>
                {klingElementId && (
                  <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                    bound
                  </span>
                )}
              </label>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <input
                  value={klingIdDraft}
                  onChange={(e) => setKlingIdDraft(e.target.value)}
                  placeholder="Kling Element ID (e.g. ele_abc123)"
                  className="input py-1 text-xs"
                />
                <input
                  value={klingNameDraft}
                  onChange={(e) => setKlingNameDraft(e.target.value)}
                  placeholder={`Display name (e.g. "${character.name} — EP01")`}
                  className="input py-1 text-xs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() =>
                    saveKlingElement.mutate({
                      id: klingIdDraft,
                      name: klingNameDraft,
                    })
                  }
                  disabled={
                    saveKlingElement.isPending ||
                    (klingIdDraft.trim() === klingElementId.trim() &&
                      klingNameDraft.trim() === klingElementName.trim())
                  }
                >
                  {saveKlingElement.isPending
                    ? "Saving…"
                    : klingElementId
                    ? "Update binding"
                    : "Bind to Kling Element"}
                </Button>
                {klingElementId && (
                  <>
                    <button
                      onClick={() => copy(klingElementId, "kling-id")}
                      className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                    >
                      {copied === "kling-id" ? "Copied" : "Copy Element ID"}
                    </button>
                    <button
                      onClick={() => {
                        setKlingIdDraft("");
                        setKlingNameDraft("");
                        saveKlingElement.mutate({ id: null, name: null });
                      }}
                      disabled={saveKlingElement.isPending}
                      className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
                    >
                      Unbind
                    </button>
                  </>
                )}
              </div>
              {saveKlingElement.error && (
                <div className="text-[10px] text-red-300">
                  {(saveKlingElement.error as Error).message}
                </div>
              )}
              <div className="text-[10px] text-bone-500">
                Kling Element / Character Reference IDs let you reuse a single
                identity across every shot. The composer emits the ID as
                structured metadata so the AI Video Prompts panel surfaces a
                Copy-to-Kling button on every shot containing {character.name}.
              </div>
            </div>
          )}

          {/* Multi-angle reference images (face / 3/4 / full body / etc.). */}
          <div className="mt-2 grid grid-cols-1 gap-1.5">
            <div className="label-eyebrow flex items-center justify-between gap-2">
              <span>Multi-angle reference images ({klingReferenceImages.length})</span>
            </div>
            {klingReferenceImages.length > 0 ? (
              <ul className="space-y-1">
                {klingReferenceImages.map((r, i) => (
                  <li
                    key={`${r.url}-${i}`}
                    className="flex items-center gap-2 rounded border border-white/8 bg-white/[0.02] px-2 py-1 text-[11px]"
                  >
                    <div className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded bg-white/[0.04]">
                      <img src={r.url} alt="" className="h-full w-full object-cover" />
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 flex-1 truncate text-sky-300 hover:underline"
                    >
                      {r.label || r.angle || r.url}
                    </a>
                    <button
                      onClick={() =>
                        removeAngle.mutate(
                          klingReferenceImages.filter((_, j) => j !== i)
                        )
                      }
                      disabled={removeAngle.isPending}
                      className="rounded border border-red-800/40 bg-red-950/20 px-1 py-0.5 text-[10px] text-red-200 hover:bg-red-950/40 disabled:opacity-40"
                      title="Remove this reference image"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded border border-dashed border-white/10 bg-white/[0.02] p-2 text-[10px] text-bone-400">
                No additional angles yet. For Kling Element bindings, adding
                face / 3/4 / full-body references improves multi-shot identity
                lock.
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input
                value={newAngleUrl}
                onChange={(e) => setNewAngleUrl(e.target.value)}
                placeholder="https://… additional angle URL"
                className="input flex-1 py-1 text-xs"
              />
              <input
                value={newAngleLabel}
                onChange={(e) => setNewAngleLabel(e.target.value)}
                placeholder='Label (e.g. "face", "3/4", "full body")'
                className="input flex-1 py-1 text-xs"
              />
              <Button
                onClick={() => addAngle.mutate()}
                disabled={addAngle.isPending || !newAngleUrl.trim()}
              >
                {addAngle.isPending ? "Adding…" : "Add angle"}
              </Button>
            </div>
            {addAngle.error && (
              <div className="text-[10px] text-red-300">
                {(addAngle.error as Error).message}
              </div>
            )}
            {removeAngle.error && (
              <div className="text-[10px] text-red-300">
                {(removeAngle.error as Error).message}
              </div>
            )}
            {setPlatform.error && (
              <div className="text-[10px] text-red-300">
                Platform change failed: {(setPlatform.error as Error).message}
              </div>
            )}
            {setRefStatus.error && (
              <div className="text-[10px] text-red-300">
                Lifecycle change failed: {(setRefStatus.error as Error).message}
              </div>
            )}
          </div>

          {/* Lifecycle override — lets the writer manually mark generated /
              uploaded if they're tracking through the Kling pipeline. */}
          <div className="mt-3 flex flex-wrap items-center gap-1 text-[10px] text-bone-500">
            <span>Lifecycle:</span>
            {(
              [
                "missing",
                "generated",
                "uploaded",
                "pending_approval",
                "approved",
                "bound_to_element",
              ] as ReferenceImageStatus[]
            ).map((s) => (
              <button
                key={s}
                onClick={() => setRefStatus.mutate(s)}
                disabled={setRefStatus.isPending || referenceImageStatus === s}
                className={
                  "rounded border px-1.5 py-0.5 " +
                  (referenceImageStatus === s
                    ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
                    : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
                }
                title={`Mark as ${s.replace("_", " ")}`}
              >
                {s.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* V3.1 — Production-Ready validator. A visible character is ready
          for video only when ALL the bible gates pass AND a reference
          (approved URL or Kling Element ID) is present. */}
      {productionReady.data && (
        <div
          className={
            "mb-3 rounded-md border p-3 text-[11px] " +
            (productionReady.data.ready
              ? "border-emerald-700/40 bg-emerald-900/15 text-emerald-100"
              : "border-amber-700/40 bg-amber-900/15 text-amber-100")
          }
        >
          <div className="flex items-center gap-2">
            {productionReady.data.ready ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5" />
            )}
            <span className="font-medium">
              {productionReady.data.ready
                ? `${character.name} is Production Ready for video.`
                : `${character.name} is NOT yet Production Ready for video.`}
            </span>
          </div>
          {!productionReady.data.ready && productionReady.data.blockers.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-bone-300">
              {productionReady.data.blockers.map((b) => (
                <li key={b.field}>
                  <span className="font-mono text-[10px] text-amber-200">{b.field}</span>
                  : {b.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Visual Canon — immutable physical facts. */}
      <div className="mb-2 label-eyebrow">Visual Canon</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {/* V2 field names first; V1 names as fallback (during migration). */}
        {!isV2 && str("physicalDescription") && (
          <Field label="Physical description" value={str("physicalDescription")} wide />
        )}
        {vb.age != null && <Field label="Age" value={String(vb.age)} />}
        {str("height") && <Field label="Height" value={str("height")} />}
        {str("build") && <Field label="Build" value={str("build")} />}
        {str("face") && <Field label="Face" value={str("face")} wide />}
        {str("hair") && <Field label="Hair" value={str("hair")} />}
        {str("eyes") && <Field label="Eyes" value={str("eyes")} />}
        {str("skinTone") && <Field label="Skin tone" value={str("skinTone")} />}
        {str("distinguishingFeatures") && (
          <Field label="Distinguishing features" value={str("distinguishingFeatures")} wide />
        )}
        {/* V2 explicit fields. */}
        {str("defaultWardrobe") && (
          <Field label="Default wardrobe" value={str("defaultWardrobe")} wide />
        )}
        {str("jewelry") && <Field label="Jewelry" value={str("jewelry")} wide />}
        {str("physicalIdentifiers") && (
          <Field label="Physical identifiers" value={str("physicalIdentifiers")} wide />
        )}
        {/* V1 legacy fields (rendered only when V2 fields absent). */}
        {!isV2 && str("wardrobeLanguage") && (
          <Field label="Wardrobe language" value={str("wardrobeLanguage")} wide pre />
        )}
        {!isV2 && str("movementLanguage") && (
          <Field label="Movement language" value={str("movementLanguage")} wide pre />
        )}
        {!isV2 && str("visualMotifs") && (
          <Field label="Visual motifs" value={str("visualMotifs")} wide pre />
        )}
        {!isV2 && str("castingNotes") && (
          <Field label="Casting notes" value={str("castingNotes")} wide pre />
        )}
      </div>

      {/* Movement Canon — observable, photographable behaviors only. */}
      {Array.isArray(v2MovementCanon) && v2MovementCanon.length > 0 && (
        <div className="mt-3">
          <div className="label-eyebrow mb-1">Movement Canon</div>
          <ul className="list-disc space-y-0.5 rounded-md border border-white/8 bg-white/[0.02] p-3 pl-7 text-sm text-bone-200">
            {v2MovementCanon.map((m: string, i: number) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Character Consistency Prompt — locked block, auto-injected into
          every shot prompt that includes this character. */}
      {consistencyPrompt && (
        <div className="mt-3">
          <div className="label-eyebrow mb-1 flex items-center justify-between gap-2">
            <span>Character Consistency Prompt</span>
            <button
              onClick={() => copy(consistencyPrompt, "consistency")}
              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
            >
              {copied === "consistency" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap rounded-md border border-ember-700/40 bg-ember-900/10 p-3 text-xs text-bone-100">
            {consistencyPrompt}
          </pre>
          <div className="mt-1 text-[10px] text-bone-500">
            Auto-injected into every shot prompt that includes this character. AI Video Prompts will use this verbatim.
          </div>
        </div>
      )}

      {/* Master Character Image Prompt — the ONE-shot reference image asset.
          Separate from the consistency prompt: this builds the canonical
          reference photo; the consistency prompt locks identity inside
          every subsequent shot. */}
      <div className="mt-3">
        <div className="label-eyebrow mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            Master Character Image Prompt
            {masterImageAspectRatio && (
              <span className="chip border-white/10 bg-white/[0.04] text-bone-400">
                {masterImageAspectRatio}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1">
            {masterImagePrompt && (
              <button
                onClick={() => copy(masterImagePrompt, "master")}
                className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
              >
                {copied === "master" ? "Copied" : "Copy"}
              </button>
            )}
            <button
              onClick={() => genMaster.mutate()}
              disabled={genMaster.isPending}
              className="flex items-center gap-1 rounded border border-sky-700/40 bg-sky-900/30 px-2 py-0.5 text-[10px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-40"
              title={
                masterImagePrompt
                  ? "Regenerate the Master Image Prompt from the current Visual Canon, wardrobe, and locked traits."
                  : "Generate a Master Image Prompt from the current Visual Canon, wardrobe, and locked traits."
              }
            >
              {genMaster.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {masterImagePrompt ? "Regenerate" : "Generate"}
            </button>
          </div>
        </div>
        {!masterImagePrompt ? (
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
            No Master Image Prompt yet. Generating produces a single prompt
            you can paste into Midjourney / Luma to render the canonical
            reference image for {character.name}.
          </div>
        ) : (
          <>
            <pre className="whitespace-pre-wrap rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs text-bone-200">
              {masterImagePrompt}
            </pre>
            <div className="mt-1 text-[10px] text-bone-500">
              {isVoiceOrText
                ? "Renders the messaging-app screenshot used in EP01 — no person depicted."
                : "Copy this into Midjourney / Luma to generate the master reference image, then paste the URL above."}
            </div>
          </>
        )}
        {genMaster.error && (
          <div className="mt-1 text-[10px] text-red-300">
            {(genMaster.error as Error).message}
          </div>
        )}
      </div>

      {/* Master Image Negative Prompt — companion of the master prompt. */}
      {masterImageNegative && (
        <div className="mt-3">
          <div className="label-eyebrow mb-1 flex items-center justify-between gap-2">
            <span>Master Image Negative Prompt</span>
            <button
              onClick={() => copy(masterImageNegative, "negative")}
              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
            >
              {copied === "negative" ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="whitespace-pre-wrap rounded-md border border-white/8 bg-black/30 p-3 text-xs text-bone-400">
            {masterImageNegative}
          </pre>
          <div className="mt-1 text-[10px] text-bone-500">
            Paste alongside the prompt above. Locks out the failure modes the
            generator should never produce for this character.
          </div>
        </div>
      )}
    </div>
  );
}

function splitTags(s: string): string[] | undefined {
  const items = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function ChipList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="md:col-span-2">
      <div className="label-eyebrow mb-1">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span key={i} className="chip">{i}</span>
        ))}
      </div>
    </div>
  );
}

function DnaInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <div className="label-eyebrow mb-1">{label}</div>
      <input
        className="input w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NewCharacterDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: (c: Character) => void;
}) {
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState("");
  const [role, setRole] = useState("protagonist");
  const m = useMutation({
    mutationFn: () =>
      api.createCharacter({
        projectId,
        name,
        archetype: archetype || undefined,
        role,
      }),
    onSuccess: onCreated,
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">New character</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="label-eyebrow mb-1 block">Name</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Archetype</label>
            <input className="input" value={archetype} onChange={(e) => setArchetype(e.target.value)} />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="protagonist">Protagonist</option>
              <option value="antagonist">Antagonist</option>
              <option value="supporting">Supporting</option>
              <option value="ensemble">Ensemble</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => m.mutate()} disabled={!name || m.isPending}>Create</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Relationships tab -------------------------------------------------------
// First-class bible source. Each pairing carries rich descriptive fields +
// an approval state; the Pitch Materials generator only sees approved
// relationships with content.

function RelationshipsTab({
  projectId,
  cast,
}: {
  projectId: string;
  cast: Character[];
}) {
  const qc = useQueryClient();
  const rels = useQuery({
    queryKey: ["relationships", projectId],
    queryFn: () => api.listRelationships(projectId),
  });
  const cleanup = useMutation({
    mutationFn: () => api.cleanupAutoRelationships(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  const bulkGen = useMutation({
    mutationFn: (scope: "empty_core" | "empty_secondary" | "all_drafts") =>
      api.generateBulkRelationships(projectId, scope),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  // One-click: suggest → persist → generate full content.
  const genMap = useMutation({
    mutationFn: () => api.generateRelationshipMap(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  const [creating, setCreating] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [suggestModal, setSuggestModal] = useState(false);

  const charById = new Map(cast.map((c) => [c.id, c]));
  const rows = (rels.data ?? []).slice().sort((a, b) => {
    const sa = a.metadata?.fields?.approvalStatus ?? "draft";
    const sb = b.metadata?.fields?.approvalStatus ?? "draft";
    if (sa !== sb) return sa === "approved" ? -1 : sb === "approved" ? 1 : 0;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="Pairings"
        title={`Relationships (${rows.length})`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => genMap.mutate()}
              disabled={genMap.isPending || cast.length < 2}
              title={
                cast.length < 2
                  ? "Add at least two characters first."
                  : "AI reads your approved story materials, picks the core + secondary pairings, and generates full dynamics for each. You review + approve."
              }
            >
              {genMap.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate Relationship Map
            </Button>
            <Button
              variant="outline"
              onClick={() => setSuggestModal(true)}
              disabled={cast.length < 2}
              title="Pick specific pairings yourself before generating."
            >
              <Wand2 className="h-4 w-4" /> Pick &amp; generate
            </Button>
            <Button variant="ghost" onClick={() => setCreating(true)} disabled={cast.length < 2}>
              <Plus className="h-4 w-4" /> Add manually
            </Button>
          </div>
        }
      >
        {rels.isLoading ? (
          <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
        ) : rows.length === 0 ? (
          <EmptyState
            Icon={Heart}
            title="No relationships yet"
            description="Add a pairing manually or let the system suggest one for every unique pair in your cast."
            action={
              <Button onClick={() => setCreating(true)} disabled={cast.length < 2}>
                <Plus className="h-4 w-4" /> Add Relationship
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <RelationshipCard
                key={r.id}
                rel={r}
                aName={charById.get(r.a_id)?.name ?? "Unknown"}
                bName={charById.get(r.b_id)?.name ?? "Unknown"}
                projectId={projectId}
              />
            ))}
          </ul>
        )}
        {genMap.error && (
          <div className="mt-2 text-xs text-red-200">{(genMap.error as Error).message}</div>
        )}
        {genMap.data && (
          <div className="mt-2 text-xs text-bone-300">
            <Sparkles className="inline h-3 w-3 text-sky-300" />{" "}
            Generated {genMap.data.generated ?? 0} relationship{genMap.data.generated === 1 ? "" : "s"} from your approved story
            ({genMap.data.inserted ?? 0} newly created).
            {genMap.data.message ? ` ${genMap.data.message}` : ""}
            {genMap.data.errors && genMap.data.errors.length > 0 && (
              <div className="mt-1 text-red-300">First error: {genMap.data.errors[0]}</div>
            )}
            <div className="mt-1 text-bone-500">Review each card below; approve when ready.</div>
          </div>
        )}
        {cleanup.error && (
          <div className="mt-2 text-xs text-red-200">{(cleanup.error as Error).message}</div>
        )}
        {cleanup.data && (
          <div className="mt-2 text-xs text-bone-400">
            Removed {cleanup.data.deleted} irrelevant pairing{cleanup.data.deleted === 1 ? "" : "s"}.
          </div>
        )}
        {bulkGen.error && (
          <div className="mt-2 text-xs text-red-200">{(bulkGen.error as Error).message}</div>
        )}
        {bulkGen.data && (
          <div className="mt-2 text-xs text-bone-400">
            Generated {bulkGen.data.generated} of {bulkGen.data.requested} relationship draft{bulkGen.data.requested === 1 ? "" : "s"}.
            {bulkGen.data.errors.length > 0 && ` ${bulkGen.data.errors.length} error(s) — first: ${bulkGen.data.errors[0]}`}
          </div>
        )}

        {rows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-white/8 bg-black/20 p-2 text-[11px]">
            <span className="text-bone-500">Bulk AI actions:</span>
            <button
              onClick={() => bulkGen.mutate("empty_core")}
              disabled={bulkGen.isPending}
              className="flex items-center gap-1 rounded border border-sky-700/40 bg-sky-900/20 px-2 py-0.5 text-sky-100 hover:bg-sky-900/40 disabled:opacity-40"
            >
              {bulkGen.isPending && bulkGen.variables === "empty_core" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Generate empty core
            </button>
            <button
              onClick={() => bulkGen.mutate("empty_secondary")}
              disabled={bulkGen.isPending}
              className="flex items-center gap-1 rounded border border-sky-700/40 bg-sky-900/20 px-2 py-0.5 text-sky-100 hover:bg-sky-900/40 disabled:opacity-40"
            >
              {bulkGen.isPending && bulkGen.variables === "empty_secondary" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Generate empty secondary
            </button>
            <button
              onClick={() => bulkGen.mutate("all_drafts")}
              disabled={bulkGen.isPending}
              className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
            >
              {bulkGen.isPending && bulkGen.variables === "all_drafts" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw className="h-3 w-3" />
              )}
              Regenerate all drafts
            </button>
            <span className="mx-1 h-3 w-px bg-white/10" />
            <button
              onClick={() => setConfirmCleanup(true)}
              disabled={cleanup.isPending}
              className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
              title="Remove unapproved auto-suggested pairings with no descriptive content."
            >
              {cleanup.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Remove irrelevant auto-suggested
            </button>
          </div>
        )}
      </Panel>

      {confirmCleanup && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirmCleanup(false)}
        >
          <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">Remove auto-suggested noise?</h2>
            <p className="mt-2 text-sm text-bone-300">
              This will remove unapproved auto-suggested relationships with no descriptive
              content. <strong className="text-bone-100">Approved or edited relationships will not be deleted.</strong>
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmCleanup(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  cleanup.mutate();
                  setConfirmCleanup(false);
                }}
                disabled={cleanup.isPending}
              >
                Remove noise
              </Button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <NewRelationshipDialog
          projectId={projectId}
          cast={cast}
          existing={(rels.data ?? []).map((r) => ({ a: r.a_id, b: r.b_id }))}
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["relationships", projectId] });
            setCreating(false);
          }}
        />
      )}
      {suggestModal && (
        <SuggestRelationshipsModal
          projectId={projectId}
          onClose={() => setSuggestModal(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["relationships", projectId] });
            setSuggestModal(false);
          }}
        />
      )}
    </div>
  );
}

function RelationshipCard({
  rel,
  aName,
  bName,
  projectId,
}: {
  rel: RelationshipRow;
  aName: string;
  bName: string;
  projectId: string;
}) {
  const qc = useQueryClient();
  const { isAdvanced } = useUIMode();
  const f = rel.metadata?.fields ?? {};
  const status = (f.approvalStatus ?? "draft") as RelationshipApproval;
  const importance: RelationshipImportance = f.importance ?? "secondary";
  const hasContent =
    Boolean((f.buyerSummary ?? "").trim()) ||
    Boolean((f.coreTension ?? rel.tension ?? "").trim());
  const [editing, setEditing] = useState(false);
  const [notesModal, setNotesModal] = useState(false);
  const [form, setForm] = useState<RelationshipFields>({
    pairingName: f.pairingName ?? `${aName} ↔ ${bName}`,
    nature: f.nature ?? rel.nature ?? "",
    aWants: f.aWants ?? "",
    bWants: f.bWants ?? "",
    aWithholds: f.aWithholds ?? "",
    bWithholds: f.bWithholds ?? "",
    coreTension: f.coreTension ?? rel.tension ?? "",
    powerDynamic: f.powerDynamic ?? "",
    emotionalCost: f.emotionalCost ?? "",
    dramaticFunction: f.dramaticFunction ?? "",
    buyerSummary: f.buyerSummary ?? "",
    internalNotes: f.internalNotes ?? "",
  });

  const save = useMutation({
    mutationFn: (patch: RelationshipFields) => api.patchRelationship(rel.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  const del = useMutation({
    mutationFn: () => api.deleteRelationship(rel.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  const approve = useMutation({
    mutationFn: (next: boolean) => api.approveRelationship(rel.id, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  const generate = useMutation({
    mutationFn: (opts: { fields?: RelGenField[]; notes?: string; force?: boolean }) =>
      api.generateRelationship(rel.id, opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["relationships", projectId] }),
  });
  const onSave = () => {
    save.mutate(form);
    setEditing(false);
  };

  const Importance: RelationshipImportance[] = ["core", "secondary", "optional", "background"];

  return (
    <li className="rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="font-serif text-base text-bone-50">
            {form.pairingName || `${aName} ↔ ${bName}`}
          </h3>
          <ImportanceBadge importance={importance} />
          {form.nature && (
            <span className="chip border-white/10 bg-white/[0.04] text-bone-300">{form.nature}</span>
          )}
          <ApprovalChip status={status} />
          {f.generatedByAI && (
            <span className="chip border-sky-700/40 bg-sky-900/20 text-sky-200" title="Drafted by AI">
              <Sparkles className="mr-1 inline h-3 w-3" /> AI draft
            </span>
          )}
          {f.userEdited && (
            <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200" title="Edited by you">
              edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <select
            className="input py-0.5 text-[10px]"
            value={importance}
            onChange={(e) => save.mutate({ importance: e.target.value as RelationshipImportance })}
            title="Importance level — only approved Core + Secondary records feed the Pitch Materials slide."
          >
            {Importance.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <button
            onClick={() => approve.mutate(status !== "approved")}
            disabled={approve.isPending}
            className={
              "rounded border px-2 py-0.5 text-[10px] " +
              (status === "approved"
                ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
                : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
            }
            title={status === "approved" ? "Reset to draft" : "Approve relationship"}
          >
            <Check className="mr-1 inline h-3 w-3" />
            {status === "approved" ? "Approved" : "Approve"}
          </button>
          <button
            onClick={() => setEditing((e) => !e)}
            className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
          <button
            onClick={() => del.mutate()}
            className="rounded border border-red-800/40 bg-red-950/20 px-1 py-0.5 text-[10px] text-red-200 hover:bg-red-950/40"
            title="Delete pairing"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* AI action row — drafts and regenerates relationship copy. */}
      <div className="mt-2 flex flex-wrap items-center gap-1 rounded border border-white/8 bg-black/20 p-1.5 text-[10px]">
        <button
          onClick={() => generate.mutate({})}
          disabled={generate.isPending}
          className="flex items-center gap-1 rounded border border-sky-700/40 bg-sky-900/30 px-2 py-0.5 text-sky-100 hover:bg-sky-900/50 disabled:opacity-40"
        >
          {generate.isPending && !generate.variables?.notes && !generate.variables?.sourceStrict ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {hasContent ? "Regenerate" : "Generate"}
        </button>
        <button
          onClick={() => setNotesModal(true)}
          disabled={generate.isPending}
          className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
          title="Regenerate with writer steering (toggle Strict inside)"
        >
          <MessageSquare className="h-3 w-3" /> Regenerate with notes
        </button>
        <button
          onClick={() => generate.mutate({ sourceStrict: true })}
          disabled={generate.isPending}
          className="flex items-center gap-1 rounded border border-emerald-700/40 bg-emerald-900/20 px-2 py-0.5 text-emerald-100 hover:bg-emerald-900/40 disabled:opacity-40"
          title="Strict source mode — forbid invented specifics + quarantine non-canon ideas into Internal Notes."
        >
          {generate.isPending && generate.variables?.sourceStrict && !generate.variables?.notes ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          Regenerate source-strict
        </button>
        {f.sourceStrictApplied && (
          <span
            className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
            title="The most recent pass used Source-strict mode."
          >
            strict
          </span>
        )}
        {f.currentVersionLabel && isAdvanced && (
          <span className="ml-auto font-mono text-[10px] text-bone-500">
            {f.currentVersionLabel}
          </span>
        )}
      </div>
      {generate.error && (
        <div className="mt-1 text-[11px] text-red-300">{(generate.error as Error).message}</div>
      )}
      {f.sourceStrictApplied && f.fieldConfidence && isAdvanced && (
        (() => {
          const counts = Object.values(f.fieldConfidence as Record<string, string>).reduce(
            (acc, v) => {
              acc[v] = (acc[v] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );
          return (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
              <span className="text-bone-500">Canon audit:</span>
              {counts.source_confirmed && (
                <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                  {counts.source_confirmed} source-confirmed
                </span>
              )}
              {counts.conservative_inference && (
                <span className="chip border-sky-700/40 bg-sky-900/20 text-sky-200">
                  {counts.conservative_inference} conservative inference
                </span>
              )}
            </div>
          );
        })()
      )}
      {f.lastStrictRemoved && f.lastStrictRemoved.length > 0 && (
        <div className="mt-1 rounded border border-emerald-700/40 bg-emerald-900/10 p-1.5 text-[10px] text-emerald-200">
          <div className="font-medium">
            Removed unsupported details ({f.lastStrictRemoved.length})
          </div>
          <ul className="mt-1 list-disc pl-4 text-bone-300">
            {Array.from(new Set(f.lastStrictRemoved.map((r) => r.reason))).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="mt-1 text-bone-500">
            Removed sentences are quarantined under "Possible future story idea — not canon"
            in Internal Notes.
          </div>
        </div>
      )}
      {f.missingSourceWarnings && f.missingSourceWarnings.length > 0 && (
        <div className="mt-1 rounded border border-amber-700/40 bg-amber-900/15 p-1.5 text-[10px] text-amber-200">
          AI flagged missing source for: {f.missingSourceWarnings.join(", ")}.
        </div>
      )}

      {!editing ? (
        <RelationshipDisplay aName={aName} bName={bName} fields={form} />
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
          <RelField label="Pairing name" value={form.pairingName} on={(v) => setForm((s) => ({ ...s, pairingName: v }))} wide />
          <FieldWithRegen
            label="Relationship type (attraction, rivalry, marriage, mirror, adversarial, …)"
            wide
            onRegen={() => generate.mutate({ fields: ["nature"] })}
            busy={generate.isPending}
          >
            <input className="input w-full" value={form.nature ?? ""} onChange={(e) => setForm((s) => ({ ...s, nature: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label={`What ${aName} wants from ${bName}`} onRegen={() => generate.mutate({ fields: ["aWants"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.aWants ?? ""} onChange={(e) => setForm((s) => ({ ...s, aWants: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label={`What ${bName} wants from ${aName}`} onRegen={() => generate.mutate({ fields: ["bWants"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.bWants ?? ""} onChange={(e) => setForm((s) => ({ ...s, bWants: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label={`What ${aName} withholds`} onRegen={() => generate.mutate({ fields: ["aWithholds"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.aWithholds ?? ""} onChange={(e) => setForm((s) => ({ ...s, aWithholds: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label={`What ${bName} withholds`} onRegen={() => generate.mutate({ fields: ["bWithholds"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.bWithholds ?? ""} onChange={(e) => setForm((s) => ({ ...s, bWithholds: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label="Core tension" onRegen={() => generate.mutate({ fields: ["coreTension"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.coreTension ?? ""} onChange={(e) => setForm((s) => ({ ...s, coreTension: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label="Power dynamic" onRegen={() => generate.mutate({ fields: ["powerDynamic"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.powerDynamic ?? ""} onChange={(e) => setForm((s) => ({ ...s, powerDynamic: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label="Emotional cost" onRegen={() => generate.mutate({ fields: ["emotionalCost"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.emotionalCost ?? ""} onChange={(e) => setForm((s) => ({ ...s, emotionalCost: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen label="Dramatic function in the series" onRegen={() => generate.mutate({ fields: ["dramaticFunction"] })} busy={generate.isPending}>
            <textarea className="input min-h-[60px] w-full text-sm" value={form.dramaticFunction ?? ""} onChange={(e) => setForm((s) => ({ ...s, dramaticFunction: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen
            label="Buyer-facing relationship summary (this is what shows in the deck)"
            wide
            onRegen={() => generate.mutate({ fields: ["buyerSummary"] })}
            busy={generate.isPending}
          >
            <textarea className="input min-h-[80px] w-full text-sm" value={form.buyerSummary ?? ""} onChange={(e) => setForm((s) => ({ ...s, buyerSummary: e.target.value }))} />
          </FieldWithRegen>
          <FieldWithRegen
            label="Internal notes (never shown in the deck)"
            wide
            onRegen={() => generate.mutate({ fields: ["internalNotes"] })}
            busy={generate.isPending}
          >
            <textarea className="input min-h-[60px] w-full text-sm" value={form.internalNotes ?? ""} onChange={(e) => setForm((s) => ({ ...s, internalNotes: e.target.value }))} />
          </FieldWithRegen>
          {save.error && (
            <div className="md:col-span-2 text-xs text-red-200">{(save.error as Error).message}</div>
          )}
          <div className="md:col-span-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={onSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      )}

      {notesModal && (
        <RegenerateNotesModal
          onClose={() => setNotesModal(false)}
          onSubmit={(notes, sourceStrict) => {
            generate.mutate({ notes, sourceStrict });
            setNotesModal(false);
          }}
          submitting={generate.isPending}
        />
      )}
    </li>
  );
}

function ImportanceBadge({ importance }: { importance: RelationshipImportance }) {
  const cls =
    importance === "core"
      ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
      : importance === "secondary"
      ? "border-sky-700/40 bg-sky-900/20 text-sky-200"
      : importance === "optional"
      ? "border-white/12 bg-white/[0.04] text-bone-300"
      : "border-white/10 bg-white/[0.02] text-bone-500";
  return <span className={"chip " + cls}>{importance}</span>;
}

function FieldWithRegen({
  label,
  wide,
  busy,
  onRegen,
  children,
}: {
  label: string;
  wide?: boolean;
  busy: boolean;
  onRegen: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="mb-1 flex items-center justify-between">
        <span className="label-eyebrow">{label}</span>
        <button
          onClick={onRegen}
          disabled={busy}
          title="Regenerate this field only"
          className="flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-bone-400 hover:bg-white/[0.04] disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Regen
        </button>
      </div>
      {children}
    </div>
  );
}

function RegenerateNotesModal({
  onClose,
  onSubmit,
  submitting,
}: {
  onClose: () => void;
  onSubmit: (notes: string, sourceStrict: boolean) => void;
  submitting: boolean;
}) {
  const [notes, setNotes] = useState("");
  const [strict, setStrict] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">Regenerate with notes</h2>
        <p className="mt-1 text-xs text-bone-400">Tell the AI what to change.</p>
        <ul className="mt-2 list-disc pl-5 text-[10px] text-bone-500">
          <li>Make this more adversarial / more seductive but less obvious</li>
          <li>Make Solano less villainous · Make Margot more defended</li>
          <li>Keep it shorter · Emphasize power shift · Emphasize emotional cost</li>
          <li>Add more subtext · Make it less melodramatic · Make it more buyer-facing</li>
          <li>Remove unsourced specifics · Stick to approved facts only</li>
        </ul>
        <textarea
          className="input mt-3 min-h-[100px] w-full text-sm"
          placeholder="Your steering…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          autoFocus
        />
        <label className="mt-3 flex items-start gap-2 text-xs text-bone-200">
          <input
            type="checkbox"
            checked={strict}
            onChange={(e) => setStrict(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-emerald-500"
          />
          <span>
            <span className="font-medium">Source-strict</span> — forbid invented
            specifics (pseudonyms, off-screen conversations, scripted episode beats,
            future-scene canon). Anything that slips through gets removed from main fields
            and quarantined under "Possible future story idea — not canon" in Internal Notes.
          </span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSubmit(notes.trim(), strict)}
            disabled={!notes.trim() || submitting}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {strict ? "Regenerate source-strict" : "Regenerate"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Suggest preview + confirm: returns candidate pairings (importance + type),
// writer picks which to create. Selected pairings are persisted as drafts;
// the writer then generates dynamics via the per-card AI actions or the
// bulk "Generate empty core" button.
function SuggestRelationshipsModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  // Two toggles:
  //   • showOptional — display optional/background candidates (off by default)
  //   • includeDeleted — also re-surface pairings the writer has previously
  //     deleted. When on, sends ?includeDeleted=true to the backend.
  const [showOptional, setShowOptional] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const preview = useQuery({
    queryKey: ["rel-suggest-preview", projectId, includeDeleted],
    queryFn: () => api.suggestRelationshipsPreview(projectId, { includeDeleted }),
  });
  const candidates = preview.data?.candidates ?? [];
  // Default-select cores on first load (only once).
  const [defaultsApplied, setDefaultsApplied] = useState(false);
  if (preview.data && !defaultsApplied) {
    setDefaultsApplied(true);
    const next = new Set<string>();
    for (const c of candidates) if (c.importance === "core") next.add(`${c.aId}|${c.bId}`);
    setPicked(next);
  }

  const [steeringNotes, setSteeringNotes] = useState("");
  const create = useMutation({
    mutationFn: (args: { selected: RelationshipSuggestion[]; generate: boolean }) =>
      api.createSelectedRelationships(projectId, args.selected, {
        generate: args.generate,
        notes: args.generate && steeringNotes.trim() ? steeringNotes.trim() : undefined,
      }),
    onSuccess: onCreated,
  });
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const selectedRows = () =>
    candidates.filter((c) => picked.has(`${c.aId}|${c.bId}`));
  const submitGenerate = () => {
    const selected = selectedRows();
    if (selected.length === 0) return;
    create.mutate({ selected, generate: true });
  };
  const submitEmpty = () => {
    const selected = selectedRows();
    if (selected.length === 0) return;
    create.mutate({ selected, generate: false });
  };

  // Filter by display importance. By default we hide optional + background.
  const visible = candidates.filter(
    (c) =>
      c.importance === "core" ||
      c.importance === "secondary" ||
      (showOptional && (c.importance === "optional" || c.importance === "background"))
  );
  // Group for the list view.
  const groups: Array<{ label: string; importance: RelationshipImportance; rows: typeof candidates }> =
    [
      { label: "Core", importance: "core", rows: visible.filter((c) => c.importance === "core") },
      { label: "Secondary", importance: "secondary", rows: visible.filter((c) => c.importance === "secondary") },
      { label: "Optional", importance: "optional", rows: visible.filter((c) => c.importance === "optional") },
      { label: "Background", importance: "background", rows: visible.filter((c) => c.importance === "background") },
    ].filter((g) => g.rows.length > 0);

  const hiddenLowImportance =
    !showOptional &&
    candidates.filter((c) => c.importance === "optional" || c.importance === "background").length;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="panel-strong w-full max-w-xl p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">Suggested relationship pairings</h2>
        <p className="mt-1 text-xs text-bone-400">
          Pick which pairings to create as drafts. Importance is driven by your story spine —
          the protagonist's relationships, marriages, and pairings the treatment / season arc /
          episode summaries actually name. Role labels alone don't make a pair "core."
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-bone-300">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showOptional}
              onChange={(e) => setShowOptional(e.target.checked)}
              className="h-3.5 w-3.5 accent-sky-500"
            />
            Show optional/background suggestions
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDeleted}
              onChange={(e) => {
                setIncludeDeleted(e.target.checked);
                setDefaultsApplied(false); // re-default cores on refetch
              }}
              className="h-3.5 w-3.5 accent-sky-500"
            />
            Show all possible pairings (incl. previously deleted)
          </label>
        </div>
        {preview.isLoading ? (
          <div className="mt-3 h-24 animate-pulse-soft rounded bg-white/[0.03]" />
        ) : visible.length === 0 ? (
          <div className="mt-3 rounded border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
            {candidates.length === 0
              ? "No suggestions. Make sure characters have roles set (protagonist, antagonist, supporting, …) and aren't marked as groups."
              : "No core or secondary suggestions match your story spine yet. Toggle 'Show optional/background suggestions' to see the rest."}
          </div>
        ) : (
          <ul className="mt-3 max-h-[420px] space-y-3 overflow-y-auto">
            {groups.map((g) => (
              <li key={g.label}>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-bone-500">
                    {g.label}
                  </span>
                  <span className="text-[10px] text-bone-600">{g.rows.length}</span>
                </div>
                <ul className="space-y-1">
                  {g.rows.map((c) => {
                    const id = `${c.aId}|${c.bId}`;
                    const on = picked.has(id);
                    return (
                      <li key={id}>
                        <label
                          className={
                            "flex items-center gap-2 rounded border p-2 text-xs cursor-pointer " +
                            (on
                              ? "border-sky-700/50 bg-sky-900/20"
                              : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(id)}
                            className="h-3.5 w-3.5 accent-sky-500"
                          />
                          <span className="flex-1">{c.pairingName}</span>
                          <ImportanceBadge importance={c.importance} />
                          <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                            {c.nature}
                          </span>
                        </label>
                        <div className="ml-7 mt-0.5 text-[10px] text-bone-500">{c.reason}</div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {!!hiddenLowImportance && (
          <div className="mt-2 text-[10px] text-bone-500">
            {hiddenLowImportance} optional/background suggestion{hiddenLowImportance === 1 ? "" : "s"} hidden.
          </div>
        )}
        {preview.data?.skippedNonIndividuals ? (
          <div className="mt-1 text-[10px] text-bone-500">
            Skipped {preview.data.skippedNonIndividuals} non-individual entries.
          </div>
        ) : null}
        {create.error && (
          <div className="mt-2 text-xs text-red-200">{(create.error as Error).message}</div>
        )}
        {visible.length > 0 && (
          <div className="mt-3 rounded border border-white/8 bg-black/20 p-2">
            <div className="text-[10px] uppercase tracking-wide text-bone-500">
              Optional steering (applied to the generation pass)
            </div>
            <input
              className="input mt-1 w-full text-xs"
              value={steeringNotes}
              onChange={(e) => setSteeringNotes(e.target.value)}
              placeholder="e.g. emphasize restraint and subtext, keep antagonist sincere…"
            />
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-bone-400">{picked.size} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              variant="outline"
              onClick={submitEmpty}
              disabled={picked.size === 0 || create.isPending}
              title="Create the rows but don't generate content yet."
            >
              Create empty drafts
            </Button>
            <Button onClick={submitGenerate} disabled={picked.size === 0 || create.isPending}>
              {create.isPending && create.variables?.generate ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Create + Generate {picked.size}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalChip({ status }: { status: RelationshipApproval }) {
  if (status === "approved")
    return <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">approved</span>;
  if (status === "needs_review")
    return <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">needs review</span>;
  return <span className="chip border-white/10 bg-white/[0.02] text-bone-500">draft</span>;
}

function RelationshipDisplay({
  aName,
  bName,
  fields,
}: {
  aName: string;
  bName: string;
  fields: RelationshipFields;
}) {
  const line = (label: string, val?: string) =>
    val && val.trim() ? (
      <div className="flex gap-2 text-[12px]">
        <span className="w-44 shrink-0 text-bone-500">{label}</span>
        <span className="whitespace-pre-wrap text-bone-200">{val}</span>
      </div>
    ) : null;
  const empty =
    !fields.aWants &&
    !fields.bWants &&
    !fields.coreTension &&
    !fields.buyerSummary &&
    !fields.powerDynamic;
  if (empty) {
    return (
      <p className="mt-2 text-xs text-bone-500">
        No descriptive content yet — click <strong>Edit</strong> to fill in what each character
        wants, withholds, the core tension, and the buyer-facing summary.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-0.5">
      {line(`${aName} wants from ${bName}`, fields.aWants)}
      {line(`${bName} wants from ${aName}`, fields.bWants)}
      {line(`${aName} withholds`, fields.aWithholds)}
      {line(`${bName} withholds`, fields.bWithholds)}
      {line("Core tension", fields.coreTension)}
      {line("Power dynamic", fields.powerDynamic)}
      {line("Emotional cost", fields.emotionalCost)}
      {line("Dramatic function", fields.dramaticFunction)}
      {fields.buyerSummary && (
        <div className="mt-2 rounded border border-white/8 bg-black/30 p-2 text-[12px] text-bone-100">
          <div className="text-[10px] uppercase tracking-wide text-bone-500">Buyer-facing summary</div>
          <div className="mt-1 whitespace-pre-wrap">{fields.buyerSummary}</div>
        </div>
      )}
      {fields.internalNotes && (
        <div className="mt-1 text-[11px] text-bone-500">
          <span className="text-bone-600">Internal:</span> {fields.internalNotes}
        </div>
      )}
    </div>
  );
}

function RelField({
  label,
  value,
  on,
  wide,
}: {
  label: string;
  value?: string;
  on: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={"block " + (wide ? "md:col-span-2" : "")}>
      <div className="label-eyebrow mb-1">{label}</div>
      <input className="input w-full" value={value ?? ""} onChange={(e) => on(e.target.value)} />
    </label>
  );
}

function RelArea({
  label,
  value,
  on,
  wide,
}: {
  label: string;
  value?: string;
  on: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={"block " + (wide ? "md:col-span-2" : "")}>
      <div className="label-eyebrow mb-1">{label}</div>
      <textarea
        className="input min-h-[60px] w-full text-sm"
        value={value ?? ""}
        onChange={(e) => on(e.target.value)}
      />
    </label>
  );
}

function NewRelationshipDialog({
  projectId,
  cast,
  existing,
  onClose,
  onCreated,
}: {
  projectId: string;
  cast: Character[];
  existing: Array<{ a: string; b: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [aId, setAId] = useState(cast[0]?.id ?? "");
  const [bId, setBId] = useState(cast[1]?.id ?? "");
  const [pairingName, setPairingName] = useState("");
  const [nature, setNature] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.createRelationship(projectId, aId, bId, {
        pairingName: pairingName.trim() || undefined,
        nature: nature.trim() || undefined,
        approvalStatus: "draft",
      }),
    onSuccess: onCreated,
  });
  // Detect duplicate (order-insensitive).
  const duplicate = existing.some(
    (p) =>
      (p.a === aId && p.b === bId) || (p.a === bId && p.b === aId)
  );
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">New relationship pairing</h2>
        <div className="mt-3 space-y-2">
          <label className="block">
            <div className="label-eyebrow mb-1">Character A</div>
            <select className="input w-full" value={aId} onChange={(e) => setAId(e.target.value)}>
              {cast.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="label-eyebrow mb-1">Character B</div>
            <select className="input w-full" value={bId} onChange={(e) => setBId(e.target.value)}>
              {cast.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="label-eyebrow mb-1">Pairing name (optional)</div>
            <input
              className="input w-full"
              value={pairingName}
              onChange={(e) => setPairingName(e.target.value)}
              placeholder="e.g. Margot Ellison ↔ Dean Palter"
            />
          </label>
          <label className="block">
            <div className="label-eyebrow mb-1">Relationship type (optional)</div>
            <input
              className="input w-full"
              value={nature}
              onChange={(e) => setNature(e.target.value)}
              placeholder="attraction · rivalry · marriage · mirror · adversarial · investigative · emotional foil"
            />
          </label>
          {aId === bId && (
            <div className="text-xs text-red-200">Pick two different characters.</div>
          )}
          {duplicate && (
            <div className="text-xs text-amber-200">
              That pairing already exists — open it from the list to edit.
            </div>
          )}
          {create.error && (
            <div className="text-xs text-red-200">{(create.error as Error).message}</div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!aId || !bId || aId === bId || duplicate || create.isPending}
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
