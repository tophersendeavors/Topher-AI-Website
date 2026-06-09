import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ListTree,
  Plus,
  Briefcase,
  Wand2,
  Loader2,
  ArrowRight,
  Flame,
  Save,
  AlertTriangle,
  TrendingDown,
  Copy,
  Check,
  AudioLines,
  Film,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

function readProjectType(p: { metadata?: unknown } | undefined | null): string {
  const meta = (p?.metadata ?? null) as { projectType?: unknown } | null;
  const t = meta?.projectType;
  return typeof t === "string" && t.length > 0 ? t : "prestige_series";
}

/** Plain-language label for the episode's `status` column — hides db
 *  enum values (outline_pending, draft_v1_ready, etc.) from normal users. */
function humanizeScreenplayState(s: string | null | undefined): string {
  if (!s) return "Not started";
  const map: Record<string, string> = {
    untitled: "Untitled",
    outline_pending: "Outline pending",
    outline_in_progress: "Outline in progress",
    outline_approved: "Outline approved",
    beat_pending: "Beats pending",
    beat_in_progress: "Beats in progress",
    beat_approved: "Beats approved",
    scene_list_pending: "Scene list pending",
    scene_list_approved: "Scene list approved",
    draft_v1_pending: "Draft pending",
    draft_v1_in_progress: "Drafting in progress",
    draft_v1_ready: "Draft ready",
    locked: "Draft locked",
    approved: "Approved",
  };
  if (map[s]) return map[s];
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function projectTypeDisplayLabel(p: unknown): string {
  // Permissive typing — at runtime the API returns the metadata jsonb,
  // even though the shared Project type doesn't surface it.
  const obj = (p ?? {}) as { metadata?: unknown; kind?: string | null };
  const pt = readProjectType(obj);
  if (pt === "micro_drama") return "Micro Drama";
  if (pt === "mini_series") return "Mini Series";
  if (pt === "prestige_series") {
    const kind = obj.kind ?? null;
    if (kind === "pilot") return "Pilot";
    if (kind === "feature") return "Feature";
    if (kind === "miniseries") return "Mini Series";
    if (kind === "short") return "Short";
    return "Prestige Series";
  }
  return "Series";
}

export function EpisodesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const seasons = useQuery({
    queryKey: ["seasons", projectId],
    queryFn: () => api.listSeasons(projectId),
  });
  const episodes = useQuery({
    queryKey: ["episodes", projectId],
    queryFn: () => api.listEpisodes(projectId),
  });
  const workflows = useQuery({
    queryKey: ["workflows", projectId],
    queryFn: () => api.listWorkflows(projectId),
  });

  const isMicroDrama = readProjectType(project.data) === "micro_drama";

  const [showNew, setShowNew] = useState(false);

  const create = useMutation({
    mutationFn: (body: { number: number; title: string; logline: string; seasonId?: string }) =>
      api.createEpisode({
        projectId,
        number: body.number,
        title: body.title,
        logline: body.logline,
        seasonId: body.seasonId,
      } as Parameters<typeof api.createEpisode>[0]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["episodes", projectId] });
      setShowNew(false);
    },
  });

  // Fallback: build episode records from the project's approved Season Arc.
  const fromArc = useMutation({
    mutationFn: () => api.materializeEpisodesFromArc(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["episodes", projectId] }),
  });

  // Start an episode-scoped workflow for one episode, then go to the overview.
  const develop = useMutation({
    mutationFn: (episodeId: string) => api.developEpisode(episodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows", projectId] });
      navigate(`/projects/${projectId}`);
    },
  });

  // Map episode_id → its workflow (if one has been started).
  const wfByEpisode = new Map(
    (workflows.data ?? [])
      .filter((w) => (w as { episode_id?: string | null }).episode_id)
      .map((w) => [(w as { episode_id: string }).episode_id, w])
  );

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Episodes"
        title="Season structure"
        description="Episodes group beat sheets, scene lists and drafts. Tentpole episodes anchor the season."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => fromArc.mutate()} disabled={fromArc.isPending}>
              {fromArc.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate from Season Arc
            </Button>
            <Button onClick={() => setShowNew(true)}>
              <Plus className="h-4 w-4" /> New episode
            </Button>
          </div>
        }
      />
      {fromArc.error && (
        <div className="px-8 text-sm text-red-300">{(fromArc.error as Error).message}</div>
      )}

      <div className="grid grid-cols-1 gap-6 px-8">
        <Panel eyebrow="Seasons" title={`${(seasons.data ?? []).length || 0} season(s)`}>
          {(seasons.data ?? []).length === 0 ? (
            <div className="text-sm text-bone-400">
              Run a workflow through the Season Arc stage and the Showrunner will create seasons here.
            </div>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {seasons.data!.map((s) => (
                <li key={s.id} className="chip">
                  S{String(s.number).padStart(2, "0")} {s.title ?? ""}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {isMicroDrama && (episodes.data ?? []).length > 0 && (
          <SeasonRetentionMap episodes={episodes.data ?? []} />
        )}

        <Panel eyebrow="Episodes" title="All episodes">
          {episodes.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (episodes.data ?? []).length === 0 ? (
            <EmptyState
              Icon={ListTree}
              title="No episodes"
              description="Add your pilot or first episode to start outlining."
              action={
                <Button onClick={() => setShowNew(true)}>
                  <Plus className="h-4 w-4" /> Add episode
                </Button>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {episodes.data!.map((e) => (
                <EpisodeCard
                  key={e.id}
                  episode={e}
                  projectId={projectId}
                  projectTypeLabel={projectTypeDisplayLabel(project.data)}
                  isMicroDrama={isMicroDrama}
                  hasWorkflow={wfByEpisode.has(e.id)}
                  developing={develop.isPending && develop.variables === e.id}
                  onDevelop={() => develop.mutate(e.id)}
                  onOpen={() => navigate(`/projects/${projectId}`)}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {showNew && (
        <NewEpisodeDialog
          onClose={() => setShowNew(false)}
          onSubmit={(v) => create.mutate(v)}
          pending={create.isPending}
        />
      )}
    </div>
  );
}

// Episode card with title-approval workflow.
//
// Title rules:
// - title_status='untitled'  → shows "Untitled", offers "Suggest title".
// - title_status='suggested' → shows AI's suggestion + reason + alternates,
//   with Approve / Reject / Type your own controls. Until approved, the
//   suggested title NEVER reaches the title page, exports, or file names.
// - title_status='approved'  → shows the approved title, with "Reset" if the
//   writer wants to start over.
function EpisodeCard({
  episode,
  projectId,
  projectTypeLabel,
  isMicroDrama,
  hasWorkflow,
  developing,
  onDevelop,
  onOpen,
}: {
  episode: {
    id: string;
    number: number;
    title?: string | null;
    logline?: string | null;
    status: string;
    title_status?: string | null;
    title_suggestion?: {
      suggested?: string;
      reason?: string;
      alternates?: string[];
    } | null;
    metadata?: Record<string, unknown> | null;
  };
  projectId: string;
  projectTypeLabel: string;
  isMicroDrama: boolean;
  hasWorkflow: boolean;
  developing: boolean;
  onDevelop: () => void;
  onOpen: () => void;
}) {
  const qc = useQueryClient();
  const status = (episode.title_status ?? "untitled") as "untitled" | "suggested" | "approved";
  const suggest = useMutation({
    mutationFn: () => api.suggestEpisodeTitle(episode.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["episodes"] }),
  });
  const approve = useMutation({
    mutationFn: (title: string) => api.approveEpisodeTitle(episode.id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["episodes"] }),
  });
  const reset = useMutation({
    mutationFn: () => api.resetEpisodeTitle(episode.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["episodes"] }),
  });
  const [custom, setCustom] = useState("");

  // Plain-language production status strip — gives the writer/showrunner
  // a one-glance read of where this episode is in the pipeline.
  const screenplayState = humanizeScreenplayState(episode.status);
  const productionState = hasWorkflow
    ? "Workflow open"
    : isMicroDrama
      ? "Workflow ready"
      : "Not yet started";
  const productionTone: "ready" | "active" | "idle" = hasWorkflow ? "active" : "idle";

  return (
    <li className="os-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="os-eyebrow os-eyebrow-gold">
            EP {String(episode.number).padStart(2, "0")}
          </span>
          <span className="chip">{projectTypeLabel}</span>
        </div>
        <TitleStatusChip status={status} />
      </div>

      <div className="mt-3">
        {isMicroDrama ? (
          <Link
            to={`/projects/${projectId}/episodes/${episode.id}/workflow`}
            className="os-display block text-xl text-bone-50 hover:text-ember-300"
            style={{ fontFamily: "var(--os-display)", lineHeight: 1.15 }}
          >
            {status === "approved" && episode.title ? episode.title : "Untitled"}
          </Link>
        ) : (
          <div
            className="os-display text-xl text-bone-50"
            style={{ fontFamily: "var(--os-display)", lineHeight: 1.15 }}
          >
            {status === "approved" && episode.title ? episode.title : "Untitled"}
          </div>
        )}
      </div>
      {episode.logline && (
        <p className="mt-2 text-sm text-bone-300 leading-relaxed">{episode.logline}</p>
      )}

      {/* Status strip — screenplay + production at a glance. */}
      <dl className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5">
          <dt className="text-bone-500 uppercase tracking-wide">Screenplay</dt>
          <dd className="text-bone-100 mt-0.5">{screenplayState}</dd>
        </div>
        <div
          className={
            "rounded border px-2.5 py-1.5 " +
            (productionTone === "active"
              ? "border-emerald-700/30 bg-emerald-900/10"
              : "border-white/8 bg-white/[0.02]")
          }
        >
          <dt className="text-bone-500 uppercase tracking-wide">Production workflow</dt>
          <dd className={"mt-0.5 " + (productionTone === "active" ? "text-emerald-200" : "text-bone-100")}>
            {productionState}
          </dd>
        </div>
      </dl>

      {status === "untitled" && (
        <>
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => suggest.mutate()}
              disabled={suggest.isPending}
            >
              {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Suggest title
            </Button>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="or type a title…"
              className="input flex-1 py-1 text-xs"
            />
            <Button
              onClick={() => custom.trim() && approve.mutate(custom.trim())}
              disabled={!custom.trim() || approve.isPending}
            >
              Approve
            </Button>
          </div>
          {(suggest.error || approve.error) && (
            <div className="mt-2 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
              {(suggest.error as Error | undefined)?.message ?? (approve.error as Error | undefined)?.message}
            </div>
          )}
        </>
      )}

      {status === "suggested" && episode.title_suggestion && (
        <div className="mt-3 rounded-md border border-amber-700/40 bg-amber-900/10 p-2 text-xs">
          <div className="text-amber-200">
            AI suggests: <strong>{episode.title_suggestion.suggested}</strong>
          </div>
          {episode.title_suggestion.reason && (
            <div className="mt-1 text-bone-400">{episode.title_suggestion.reason}</div>
          )}
          {!!episode.title_suggestion.alternates?.length && (
            <div className="mt-1 flex flex-wrap gap-1">
              {episode.title_suggestion.alternates.map((alt) => (
                <button
                  key={alt}
                  onClick={() => approve.mutate(alt)}
                  disabled={approve.isPending}
                  className="chip border-white/12 bg-white/[0.04] text-bone-200 hover:bg-white/[0.08]"
                >
                  Approve "{alt}"
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-1">
            <Button
              onClick={() => approve.mutate(episode.title_suggestion!.suggested!)}
              disabled={approve.isPending}
            >
              Approve suggestion
            </Button>
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="or your own…"
              className="input flex-1 py-1 text-xs"
            />
            <Button
              onClick={() => custom.trim() && approve.mutate(custom.trim())}
              disabled={!custom.trim() || approve.isPending}
            >
              Approve
            </Button>
            <Button variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
              Reject
            </Button>
          </div>
          {(approve.error || reset.error) && (
            <div className="mt-2 text-xs text-red-200">
              {(approve.error as Error | undefined)?.message ?? (reset.error as Error | undefined)?.message}
            </div>
          )}
        </div>
      )}

      {status === "approved" && (
        <div className="mt-2">
          <Button variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
            Reset to Untitled
          </Button>
        </div>
      )}

      {isMicroDrama && (
        <MicroDramaRetentionPanel
          episodeId={episode.id}
          metadata={episode.metadata ?? null}
        />
      )}

      {/* Production Workflow — universal entry point for the guided
       *  12-stage workflow. Available for every project type, not just
       *  micro-drama. See docs/PROJECT_TYPE_ADAPTERS.md — the workflow
       *  is shared; Stage 1 reads the right approval signal per type. */}
      <div className="mt-4 border-t border-white/8 pt-4 space-y-2">
        <Link
          to={`/projects/${projectId}/episodes/${episode.id}/workflow`}
          className="os-btn os-btn-primary w-full justify-center"
          style={{ width: "100%", justifyContent: "center" }}
        >
          <Briefcase className="h-4 w-4" />
          Open Production Workflow
          <ArrowRight className="h-4 w-4" />
        </Link>
        <Link
          to={`/projects/${projectId}/episodes/${episode.id}/sound-bible`}
          className="os-btn os-btn-outline w-full justify-center"
          style={{ width: "100%", justifyContent: "center" }}
          title="Sound / Music / Atmosphere Bible — feeds approved sound canon into AI video prompt audio"
        >
          <AudioLines className="h-4 w-4" />
          Sound Bible
        </Link>
        <Link
          to={`/projects/${projectId}/episodes/${episode.id}/shot-list`}
          className="os-btn os-btn-outline w-full justify-center"
          style={{ width: "100%", justifyContent: "center" }}
          title="Curated Shot List — group, edit, approve shot briefs that feed the AI Video Prompts panel"
        >
          <ListTree className="h-4 w-4" />
          Shot List
        </Link>
        <Link
          to={`/projects/${projectId}/episodes/${episode.id}/trailer-builder`}
          className="os-btn os-btn-outline w-full justify-center"
          style={{ width: "100%", justifyContent: "center" }}
          title="Trailer / Teaser Builder — 15s / 30s / 60s plans grounded in approved shots, sound, and chain"
        >
          <Film className="h-4 w-4" />
          Trailer Builder
        </Link>
        <p className="mt-2 text-[11px] text-bone-500 text-center">
          The 12-stage guided workflow — script → canon → blocking → DP → continuity → prompts → final.
        </p>
      </div>

      {/* The prestige "Develop this episode" pipeline (episode_outline →
          beat_sheet → scene_list → draft_v1) requires an approved Season
          Arc artifact. Micro-drama projects bypass that pipeline entirely
          and use the per-episode Micro-Drama Chain + Screenplay block
          rendered above. Hide the prestige develop button on micro-drama
          to prevent the "No episodes in season arc" 500. */}
      {!isMicroDrama && (
        <div className="mt-3">
          {hasWorkflow ? (
            <Button variant="outline" onClick={onOpen}>
              Open in development <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={onDevelop} disabled={developing}>
              {developing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              Develop this episode
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

// Retention engine — only rendered when the project is a Micro Drama.
// Writers edit HOOK / SETUP / TWIST / CLIFFHANGER per-episode and see a
// live Binge Momentum Score (deterministic, computed server-side) and the
// Viral Test verdict + recommendation.
function MicroDramaRetentionPanel({
  episodeId,
  metadata,
}: {
  episodeId: string;
  metadata: Record<string, unknown> | null;
}) {
  const qc = useQueryClient();
  const stored = (metadata?.microDrama ?? {}) as {
    hook?: string;
    setup?: string;
    twist?: string;
    cliffhanger?: string;
  };
  const [hook, setHook] = useState(stored.hook ?? "");
  const [setup, setSetup] = useState(stored.setup ?? "");
  const [twist, setTwist] = useState(stored.twist ?? "");
  const [cliffhanger, setCliffhanger] = useState(stored.cliffhanger ?? "");
  const [open, setOpen] = useState(false);

  // If a refetch brings in newer stored values (e.g. after Save invalidation
  // on a different tab), reflect them into the local editor — but only when
  // the writer isn't currently typing (panel collapsed).
  useEffect(() => {
    if (open) return;
    setHook(stored.hook ?? "");
    setSetup(stored.setup ?? "");
    setTwist(stored.twist ?? "");
    setCliffhanger(stored.cliffhanger ?? "");
  }, [stored.hook, stored.setup, stored.twist, stored.cliffhanger, open]);

  const dirty =
    hook !== (stored.hook ?? "") ||
    setup !== (stored.setup ?? "") ||
    twist !== (stored.twist ?? "") ||
    cliffhanger !== (stored.cliffhanger ?? "");

  const viral = useQuery({
    queryKey: ["episode-viral", episodeId],
    queryFn: () => api.getEpisodeViralTest(episodeId),
  });

  const save = useMutation({
    mutationFn: () =>
      api.patchEpisodeMicroDrama(episodeId, { hook, setup, twist, cliffhanger }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["episodes"] });
      qc.invalidateQueries({ queryKey: ["episode-viral", episodeId] });
    },
  });

  const total = viral.data?.score.total ?? null;
  const verdict = viral.data?.test.verdict ?? null;
  const recommendation = viral.data?.test.recommendation ?? null;
  const components = viral.data?.score.components;

  return (
    <div className="mt-3 rounded-md border border-white/8 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-ember-300" />
          <span className="label-eyebrow">Retention engine</span>
        </div>
        <div className="flex items-center gap-1">
          <BingeScoreChip total={total} loading={viral.isLoading} />
          <ViralVerdictChip verdict={verdict} />
        </div>
      </div>

      {verdict && verdict !== "yes" && (
        <ScrollWarning verdict={verdict} />
      )}

      {recommendation && (
        <p className="mt-2 text-xs text-bone-400">{recommendation}</p>
      )}

      {open && components && (
        <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-bone-500">
          <ComponentChip label="Hook" value={components.hookStrength} />
          <ComponentChip label="Gap" value={components.curiosityGap} />
          <ComponentChip label="Twist" value={components.twistStrength} />
          <ComponentChip label="Cliff" value={components.cliffhangerStrength} />
        </div>
      )}

      <div className="mt-2">
        {!open ? (
          <Button variant="ghost" onClick={() => setOpen(true)}>
            Edit HOOK / SETUP / TWIST / CLIFFHANGER
          </Button>
        ) : (
          <div className="space-y-2">
            <RetentionField
              label="HOOK"
              hint="First 3 seconds — the visual or line that stops the scroll."
              value={hook}
              onChange={setHook}
            />
            <RetentionField
              label="SETUP"
              hint="What the audience is told (and what's deliberately withheld)."
              value={setup}
              onChange={setSetup}
            />
            <RetentionField
              label="TWIST"
              hint="The reversal — what we thought was true, isn't."
              value={twist}
              onChange={setTwist}
            />
            <RetentionField
              label="CLIFFHANGER"
              hint="End on a question. The viewer must tap next."
              value={cliffhanger}
              onChange={setCliffhanger}
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => {
                  setHook(stored.hook ?? "");
                  setSetup(stored.setup ?? "");
                  setTwist(stored.twist ?? "");
                  setCliffhanger(stored.cliffhanger ?? "");
                  setOpen(false);
                }}
                disabled={save.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save retention engine
              </Button>
            </div>

            {save.error && (
              <div className="text-xs text-red-300">
                {(save.error as Error).message}
              </div>
            )}
          </div>
        )}
      </div>

      <MicroDramaScreenplayAction
        episodeId={episodeId}
        chainReady={Boolean(
          (stored.hook ?? "").trim() &&
            (stored.setup ?? "").trim() &&
            (stored.twist ?? "").trim() &&
            (stored.cliffhanger ?? "").trim()
        )}
        dirty={dirty}
      />
      <MicroDramaProductionPipeline episodeId={episodeId} />
    </div>
  );
}

// Generate Screenplay from Micro-Drama Chain — with approval workflow
// ----------------------------------------------------------------------------
// Loads the episode's current screenplay (if any) on mount so the writer
// always sees what's there + its approval status. Below the screenplay, the
// writer gets four actions:
//   • Approve / Approve with notes  → lock this draft as the canonical cut
//   • Regenerate with notes         → fresh pass, writer notes steer it
//   • Patch with notes              → agent edits THIS screenplay using
//                                     notes as surgical instructions
//   • Reset to pending              → undo approval / send back for changes
//
// All approval state lives on scripts.metadata.microDramaApproval. Notes are
// captured in scripts.metadata.writerNotes per draft. No schema change.
type Screenplay = {
  id: string;
  title: string;
  draftNumber: number;
  fountain: string;
  approval: {
    status: "pending" | "approved" | "needs_changes";
    notes: string | null;
    approvedAt: string | null;
  };
  validation: {
    passes: boolean;
    checks: Record<string, { passes: boolean; message: string }>;
    notes: string[];
  } | null;
  generationMode: "fresh" | "patch" | null;
  writerNotes: string | null;
};

function readScreenplay(
  s: {
    id: string;
    title: string;
    draft_number: number;
    fountain: string;
    metadata: Record<string, unknown>;
  } | null
): Screenplay | null {
  if (!s) return null;
  const meta = (s.metadata ?? {}) as Record<string, unknown>;
  const ap = (meta.microDramaApproval ?? {}) as Record<string, unknown>;
  return {
    id: s.id,
    title: s.title,
    draftNumber: s.draft_number,
    fountain: s.fountain,
    approval: {
      status: (ap.status as "pending" | "approved" | "needs_changes") ?? "pending",
      notes: (ap.notes as string | null) ?? null,
      approvedAt: (ap.approvedAt as string | null) ?? null,
    },
    validation: (meta.validation as Screenplay["validation"]) ?? null,
    generationMode: (meta.generationMode as "fresh" | "patch" | null) ?? null,
    writerNotes: (meta.writerNotes as string | null) ?? null,
  };
}

function MicroDramaScreenplayAction({
  episodeId,
  chainReady,
  dirty,
}: {
  episodeId: string;
  chainReady: boolean;
  dirty: boolean;
}) {
  const qc = useQueryClient();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesMode, setNotesMode] = useState<"fresh" | "patch">("patch");
  const [notes, setNotes] = useState("");
  const [approveNotesOpen, setApproveNotesOpen] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");
  // Which draft is being viewed in the panel. Null means "follow current" —
  // the panel automatically tracks whichever draft is current (the just-
  // generated one, or a restored older draft). Clicking a draft chip pins
  // the view to that specific draft id.
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const drafts = useQuery({
    queryKey: ["episode-screenplay-drafts", episodeId],
    queryFn: () => api.listEpisodeScreenplayDrafts(episodeId),
  });
  const allDrafts = drafts.data?.drafts ?? [];
  const currentDraft = allDrafts.find((d) => d.current) ?? allDrafts[0] ?? null;
  const viewedDraft =
    (selectedDraftId
      ? allDrafts.find((d) => d.id === selectedDraftId)
      : null) ?? currentDraft;
  const screenplay = readScreenplay(viewedDraft ?? null);
  const viewingCurrent = !!viewedDraft && viewedDraft.id === currentDraft?.id;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["episode-screenplay", episodeId] });
    qc.invalidateQueries({
      queryKey: ["episode-screenplay-drafts", episodeId],
    });
    qc.invalidateQueries({ queryKey: ["scripts"] });
  };

  const restore = useMutation({
    mutationFn: (scriptId: string) => api.restoreScreenplayAsCurrent(scriptId),
    onSuccess: () => {
      invalidate();
      setSelectedDraftId(null); // snap back to "follow current"
    },
  });

  const generate = useMutation({
    mutationFn: (opts: { notes?: string; mode?: "fresh" | "patch" }) =>
      api.generateMicroDramaScreenplay(episodeId, opts),
    onSuccess: () => {
      invalidate();
      setNotesOpen(false);
      setNotes("");
    },
  });

  const approve = useMutation({
    mutationFn: (body: {
      status: "pending" | "approved" | "needs_changes";
      notes?: string;
    }) => {
      if (!screenplay) {
        throw new Error("No screenplay to update — generate one first.");
      }
      return api.setMicroDramaApproval(screenplay.id, body);
    },
    onSuccess: () => {
      invalidate();
      setApproveNotesOpen(false);
      setApproveNotes("");
    },
  });

  const generatePending = generate.isPending;
  const approvePending = approve.isPending;
  const blockedMessage = !chainReady
    ? "Fill in HOOK / SETUP / TWIST / CLIFFHANGER above and save before generating."
    : dirty
    ? "Save the retention engine before generating — the agent reads the saved chain, not your in-progress edits."
    : null;

  return (
    <div className="mt-3 rounded-md border border-emerald-700/30 bg-emerald-900/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="label-eyebrow text-emerald-300">Screenplay</span>
            {screenplay && (
              <ApprovalStatusChip status={screenplay.approval.status} />
            )}
          </div>
          <div className="mt-1 text-sm text-bone-200">
            Generate a 30–60 second vertical-drama screenplay from this
            episode's approved chain.
          </div>
          <div className="mt-1 text-[11px] text-bone-400">
            The agent dramatizes hook → setup → twist → cliffhanger verbatim.
            It cannot invent plot, change the twist, or reveal withheld
            information.
          </div>
        </div>
        <Tooltip
          help={
            screenplay
              ? "Create a new draft from scratch using the approved chain. Creates Draft N+1, demotes the current draft (you can restore it from history)."
              : "Run the agent on the approved chain to produce the first 30–60 sec vertical-drama screenplay. Creates Draft 1."
          }
        >
          <Button
            variant="outline"
            onClick={() => generate.mutate({ mode: "fresh" })}
            disabled={!chainReady || dirty || generatePending}
          >
            {generatePending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            {generatePending
              ? "Generating…"
              : screenplay
              ? "Regenerate (fresh)"
              : "Generate Screenplay from Micro-Drama Chain"}
          </Button>
        </Tooltip>
      </div>

      {blockedMessage && (
        <div className="mt-2 text-[11px] text-amber-200">{blockedMessage}</div>
      )}
      {generatePending && (
        <div className="mt-2 text-[11px] text-bone-400">
          One LLM pass · 30–60s of vertical-drama screenplay · don't refresh.
        </div>
      )}
      {generate.error && (
        <div className="mt-2 rounded-sm border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
          {(generate.error as Error).message}
        </div>
      )}
      {approve.error && (
        <div className="mt-2 rounded-sm border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
          {(approve.error as Error).message}
        </div>
      )}

      {drafts.isLoading && !screenplay && (
        <div className="mt-3 h-12 animate-pulse-soft rounded-md bg-white/[0.03]" />
      )}

      {screenplay && allDrafts.length > 1 && (
        <ScreenplayDraftHistory
          drafts={allDrafts}
          viewedId={viewedDraft?.id ?? null}
          currentId={currentDraft?.id ?? null}
          onSelect={(id) => setSelectedDraftId(id === currentDraft?.id ? null : id)}
        />
      )}

      {screenplay && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="chip border-white/10 text-bone-300">
              {screenplay.title} · Draft {screenplay.draftNumber}
              {viewingCurrent ? "" : " (history)"}
            </span>
            {screenplay.generationMode === "patch" && (
              <span className="chip border-amber-700/40 bg-amber-900/15 text-amber-200">
                patched with notes
              </span>
            )}
            {screenplay.validation && (
              <ChainContractChip passes={screenplay.validation.passes} />
            )}
            {screenplay.approval.approvedAt && (
              <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                Approved {new Date(screenplay.approval.approvedAt).toLocaleString()}
              </span>
            )}
          </div>

          {screenplay.writerNotes && (
            <div className="rounded-sm border border-amber-700/30 bg-amber-900/10 p-2 text-[11px] text-amber-100">
              <span className="font-medium">This draft used writer notes:</span>{" "}
              {screenplay.writerNotes}
            </div>
          )}
          {screenplay.approval.notes && (
            <div className="rounded-sm border border-white/10 bg-white/[0.02] p-2 text-[11px] text-bone-300">
              <span className="font-medium">Approval notes:</span>{" "}
              {screenplay.approval.notes}
            </div>
          )}

          {screenplay.validation && (
            <ChainContractChecks checks={screenplay.validation.checks} />
          )}

          <div className="rounded-md border border-white/8 bg-black/30 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-bone-400">
                Screenplay (Fountain)
              </span>
              <CopyScreenplayButton fountain={screenplay.fountain} />
            </div>
            <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap font-mono text-[11px] text-bone-200">
              {screenplay.fountain}
            </pre>
          </div>

          {/* Approval + revision controls */}
          {!viewingCurrent ? (
            // Viewing a historical draft — only offer "Restore" + a back link.
            // All mutations should target the CURRENT draft, so we hide
            // Approve/Patch/Regenerate while history is open.
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Tooltip help="Promote this older draft back to current. The agent won't run — this draft becomes live exactly as you see it. Approval status resets to whatever it was when this draft was saved.">
                <Button
                  onClick={() => restore.mutate(screenplay.id)}
                  disabled={restore.isPending}
                >
                  {restore.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Restore this draft
                </Button>
              </Tooltip>
              <Tooltip help="Stop viewing this older draft and return to the current one.">
                <Button
                  variant="ghost"
                  onClick={() => setSelectedDraftId(null)}
                  disabled={restore.isPending}
                >
                  Back to current
                </Button>
              </Tooltip>
              {restore.error && (
                <span className="text-xs text-red-300">
                  {(restore.error as Error).message}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {screenplay.approval.status !== "approved" ? (
                <>
                  <Tooltip help="Lock this draft as the canonical Season 1 cut for this episode. You can still unlock later via Reset to pending.">
                    <Button
                      onClick={() => approve.mutate({ status: "approved" })}
                      disabled={approvePending}
                    >
                      {approvePending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Approve
                    </Button>
                  </Tooltip>
                  <Tooltip help="Approve and attach a note that travels with the script (e.g. 'approved for S1 cut, polish in S1.5'). Visible in this panel forever.">
                    <Button
                      variant="outline"
                      onClick={() => setApproveNotesOpen((v) => !v)}
                      disabled={approvePending}
                    >
                      Approve with notes
                    </Button>
                  </Tooltip>
                </>
              ) : (
                <Tooltip help="Unlock the approval. Doesn't delete anything; just changes status back to pending so you can revise.">
                  <Button
                    variant="ghost"
                    onClick={() => approve.mutate({ status: "pending" })}
                    disabled={approvePending}
                  >
                    Reset to pending
                  </Button>
                </Tooltip>
              )}
              <Tooltip help="Surgical edit: agent keeps every line of THIS draft byte-for-byte unchanged EXCEPT what your notes call out. Hook and cliffhanger are locked. Creates a new draft.">
                <Button
                  variant="outline"
                  onClick={() => {
                    setNotesOpen((v) => !v);
                    setNotesMode("patch");
                  }}
                  disabled={generatePending}
                >
                  Patch with notes
                </Button>
              </Tooltip>
              <Tooltip help="Full restage: agent rewrites the entire screenplay from the chain, biased by your notes. Best for big tonal/setting changes. Creates a new draft.">
                <Button
                  variant="outline"
                  onClick={() => {
                    setNotesOpen((v) => !v);
                    setNotesMode("fresh");
                  }}
                  disabled={generatePending}
                >
                  Regenerate with notes
                </Button>
              </Tooltip>
              <Tooltip help="Flag this draft as 'needs changes' without deleting it. Useful when a producer or collaborator wants you to revise before final approval.">
                <Button
                  variant="ghost"
                  onClick={() =>
                    approve.mutate({
                      status: "needs_changes",
                      notes: approveNotes.trim() || undefined,
                    })
                  }
                  disabled={approvePending}
                >
                  Mark needs changes
                </Button>
              </Tooltip>
            </div>
          )}

          {approveNotesOpen && (
            <div className="rounded-md border border-emerald-700/30 bg-emerald-900/10 p-2">
              <label className="label-eyebrow mb-1 block text-emerald-300">
                Approval notes (saved with the approval)
              </label>
              <textarea
                className="input min-h-[60px] text-xs"
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="e.g. Approved for Season 1 cut, but rewrite Maya's line in the second beat if a polish pass is run later."
              />
              <div className="mt-1 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setApproveNotesOpen(false);
                    setApproveNotes("");
                  }}
                  disabled={approvePending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    approve.mutate({
                      status: "approved",
                      notes: approveNotes.trim() || undefined,
                    })
                  }
                  disabled={approvePending}
                >
                  {approvePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Approve with notes
                </Button>
              </div>
            </div>
          )}

          {notesOpen && (
            <div className="rounded-md border border-amber-700/30 bg-amber-900/10 p-2">
              <div className="mb-1 flex items-center justify-between">
                <label className="label-eyebrow text-amber-300">
                  {notesMode === "patch"
                    ? "Patch this screenplay (agent edits only what your notes call out)"
                    : "Regenerate (fresh pass guided by your notes)"}
                </label>
                <div className="flex items-center gap-1 text-[10px] text-bone-400">
                  <button
                    onClick={() => setNotesMode("patch")}
                    className={
                      "rounded-full border px-2 py-0.5 transition-colors " +
                      (notesMode === "patch"
                        ? "border-ember-700/60 bg-ember-900/30 text-ember-100"
                        : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
                    }
                  >
                    Patch
                  </button>
                  <button
                    onClick={() => setNotesMode("fresh")}
                    className={
                      "rounded-full border px-2 py-0.5 transition-colors " +
                      (notesMode === "fresh"
                        ? "border-ember-700/60 bg-ember-900/30 text-ember-100"
                        : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
                    }
                  >
                    Fresh
                  </button>
                </div>
              </div>
              <textarea
                className="input min-h-[80px] text-xs"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  notesMode === "patch"
                    ? "e.g. Change Maya's first line to a whisper instead of a scream. Make the closet door creak slowly. Don't touch the cliffhanger."
                    : "e.g. Re-stage the whole episode so Maya is in a car instead of a bedroom. Keep the same beats."
                }
              />
              <div className="mt-1 text-[10px] text-bone-500">
                {notesMode === "patch"
                  ? "Patch mode: keeps every line of the existing screenplay unchanged EXCEPT what your notes call out. Hook and cliffhanger are locked."
                  : "Fresh mode: rewrites the whole screenplay from the chain, biased by your notes. Use for big restages."}
              </div>
              <div className="mt-1 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setNotesOpen(false);
                    setNotes("");
                  }}
                  disabled={generatePending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    generate.mutate({
                      notes: notes.trim() || undefined,
                      mode: notesMode,
                    })
                  }
                  disabled={!notes.trim() || generatePending}
                >
                  {generatePending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {notesMode === "patch" ? "Apply patch" : "Regenerate"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Tiny tooltip primitive — wrap any button (or element) and provide a
// `help` string. Pure CSS hover, no JS. Shows above the trigger so it
// doesn't get clipped by the panel scroll container. Uses group-hover so
// the wrapping element triggers the tooltip even when the child button
// is disabled (a disabled button doesn't fire :hover on itself in some
// browsers).
function Tooltip({
  help,
  children,
  side = "top",
}: {
  help: string;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        className={
          "pointer-events-none absolute left-1/2 z-50 hidden -translate-x-1/2 whitespace-pre-line rounded-md border border-white/12 bg-black/95 px-2 py-1.5 text-[11px] leading-snug text-bone-100 shadow-lg group-hover:block " +
          (side === "top"
            ? "bottom-full mb-1.5"
            : "top-full mt-1.5")
        }
        style={{ maxWidth: 280, width: "max-content" }}
        role="tooltip"
      >
        {help}
      </span>
    </span>
  );
}

// Per-episode Production Pipeline action — runs the 5-stage backend
// orchestrator (cast extract → location extract → autoBuildBriefs →
// micro-drama 9:16 prompt composer per shot). Surfaces a status row with
// 6 indicators so the writer can see progress at a glance, and a confirm
// dialog before re-running an already-complete episode.
function MicroDramaProductionPipeline({ episodeId }: { episodeId: string }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["episode-production-status", episodeId],
    queryFn: () => api.getEpisodeProductionStatus(episodeId),
  });
  const [confirmingRerun, setConfirmingRerun] = useState(false);
  const run = useMutation({
    mutationFn: (force: boolean) =>
      api.runEpisodeProductionPipeline(episodeId, force ? { force: true } : undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["episode-production-status", episodeId] });
      qc.invalidateQueries({ queryKey: ["episodes"] });
      setConfirmingRerun(false);
    },
  });

  const s = status.data;
  const blocked = !s?.screenplayApproved;
  const complete = s?.pipelineComplete ?? false;

  return (
    <div className="mt-3 rounded-md border border-violet-700/30 bg-violet-900/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="label-eyebrow text-violet-300">Production pipeline</div>
          <div className="mt-1 text-sm text-bone-200">
            Extract cast + location continuity, build shot briefs, generate
            9:16 vertical-drama AI video prompts.
          </div>
          <div className="mt-1 text-[11px] text-bone-400">
            Manual Character Bible edits are merge-protected. Approved
            screenplays are never overwritten. Run only on demand — no batch.
          </div>
        </div>
        <Tooltip
          help={
            blocked
              ? "Approve the screenplay first — the pipeline needs an approved current draft to extract from."
              : complete
              ? "All five stages have produced output for this episode. Click to re-run (will require confirmation)."
              : "Run the full 5-stage pipeline on this episode. Takes 1–3 minutes."
          }
        >
          <Button
            variant="outline"
            disabled={blocked || run.isPending || status.isLoading}
            onClick={() => {
              if (complete) setConfirmingRerun(true);
              else run.mutate(false);
            }}
          >
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {run.isPending
              ? "Running…"
              : complete
              ? "Re-run Production Pipeline"
              : "Run Production Pipeline"}
          </Button>
        </Tooltip>
      </div>

      <PipelineStatusRow status={s ?? null} loading={status.isLoading} />

      {blocked && !status.isLoading && (
        <div className="mt-2 text-[11px] text-amber-200">
          Approve the screenplay above before running the pipeline.
        </div>
      )}
      {run.error && (
        <div className="mt-2 rounded-sm border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
          {(run.error as Error).message}
        </div>
      )}
      {run.data && (
        <div className="mt-2 rounded-sm border border-emerald-700/40 bg-emerald-900/15 p-2 text-[11px] text-emerald-100">
          <div className="font-medium">Pipeline complete.</div>
          <div className="mt-0.5">
            Characters: {run.data.stages.charactersWritten.length} ·
            Locations: {run.data.stages.locationsWritten.length} ·
            Briefs: {run.data.stages.briefsGenerated} ·
            Prompts: {run.data.stages.promptsGenerated}
          </div>
        </div>
      )}

      {confirmingRerun && (
        <div className="mt-2 rounded-md border border-amber-700/40 bg-amber-900/15 p-2 text-[11px] text-amber-100">
          <div className="font-medium">This episode already has production assets.</div>
          <div className="mt-1">
            Re-running will: (a) overwrite the existing shot briefs and prompts;
            (b) merge new agent output into the Character Bible AND existing
            Locations — empty slots only, your manual edits stay intact;
            (c) never touch the approved screenplay.
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmingRerun(false)} disabled={run.isPending}>
              Cancel
            </Button>
            <Button onClick={() => run.mutate(true)} disabled={run.isPending}>
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Yes, re-run
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineStatusRow({
  status,
  loading,
}: {
  status: {
    screenplayApproved: boolean;
    scenesIndexed: number;
    charactersInProject: number;
    locationsInProject: number;
    briefsForEpisode: number;
    promptsForEpisode: number;
  } | null;
  loading: boolean;
}) {
  const items = [
    {
      label: "Screenplay approved",
      done: status?.screenplayApproved ?? false,
      detail: status?.screenplayApproved ? "✓" : "approve first",
    },
    {
      label: "Scenes indexed",
      done: (status?.scenesIndexed ?? 0) > 0,
      detail: status ? `${status.scenesIndexed}` : "",
    },
    {
      label: "Characters",
      done: (status?.charactersInProject ?? 0) > 0,
      detail: status ? `${status.charactersInProject} in project` : "",
    },
    {
      label: "Locations",
      done: (status?.locationsInProject ?? 0) > 0,
      detail: status ? `${status.locationsInProject} in project` : "",
    },
    {
      label: "Shot briefs",
      done: (status?.briefsForEpisode ?? 0) > 0,
      detail: status ? `${status.briefsForEpisode} shots` : "",
    },
    {
      label: "AI video prompts",
      done: (status?.promptsForEpisode ?? 0) > 0,
      detail: status ? `${status.promptsForEpisode} prompts` : "",
    },
  ];
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5 md:grid-cols-3">
      {items.map((it) => (
        <div
          key={it.label}
          className={
            "flex items-center justify-between rounded-sm border px-2 py-1 text-[10px] " +
            (it.done
              ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
              : "border-white/10 bg-white/[0.02] text-bone-400")
          }
        >
          <span>
            {it.done ? "✓" : "·"} {it.label}
          </span>
          <span className="font-mono text-[10px] text-bone-500">
            {loading && !status ? "…" : it.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

// Tiny clipboard button for the Fountain screenplay. Falls back to a
// hidden <textarea> + execCommand for browsers that block the async
// clipboard API (older Safari, non-HTTPS dev contexts). Confirmation
// state clears after 2s so the writer can copy multiple times in a row.
function CopyScreenplayButton({ fountain }: { fountain: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fountain);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = fountain;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* ignore — the user can manually select-and-copy from the pre */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Tooltip help="Copy the screenplay to your clipboard. Fountain is plain text — paste into Final Draft, Google Docs, a note, or anywhere else.">
      <button
        type="button"
        onClick={handleCopy}
        className={
          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors " +
          (copied
            ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
            : "border-white/12 bg-white/[0.02] text-bone-300 hover:bg-white/[0.06]")
        }
      >
        {copied ? (
          <Check className="h-3 w-3" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </Tooltip>
  );
}

function ScreenplayDraftHistory({
  drafts,
  viewedId,
  currentId,
  onSelect,
}: {
  drafts: Array<{
    id: string;
    draft_number: number;
    current: boolean;
    metadata: Record<string, unknown>;
  }>;
  viewedId: string | null;
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1">
      <span className="label-eyebrow text-bone-500">Drafts</span>
      {drafts.map((d) => {
        const isCurrent = d.id === currentId;
        const isViewed = d.id === viewedId;
        const ap = (d.metadata?.microDramaApproval ?? {}) as {
          status?: string;
        };
        const status = ap.status ?? "pending";
        const statusGlyph =
          status === "approved" ? "✓" : status === "needs_changes" ? "!" : "·";
        const help = `${isCurrent ? "Current draft. " : "Older draft. "}${
          status === "approved"
            ? "Approved."
            : status === "needs_changes"
            ? "Marked needs changes."
            : "Pending approval."
        } Click to view. The current draft is what Approve / Patch / Regenerate act on; older drafts are read-only until you Restore them.`;
        return (
          <Tooltip key={d.id} help={help}>
            <button
              type="button"
              onClick={() => onSelect(d.id)}
              className={
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors " +
                (isViewed
                  ? "border-ember-700/60 bg-ember-900/30 text-ember-100"
                  : isCurrent
                  ? "border-emerald-700/40 bg-emerald-900/15 text-emerald-200 hover:bg-emerald-900/25"
                  : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
              }
            >
              {statusGlyph} Draft {d.draft_number}
              {isCurrent ? " · current" : ""}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function ApprovalStatusChip({
  status,
}: {
  status: "pending" | "approved" | "needs_changes";
}) {
  if (status === "approved") {
    return (
      <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
        Approved
      </span>
    );
  }
  if (status === "needs_changes") {
    return (
      <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
        Needs changes
      </span>
    );
  }
  return (
    <span className="chip border-white/12 bg-white/[0.02] text-bone-400">
      Pending approval
    </span>
  );
}

function ChainContractChip({ passes }: { passes: boolean }) {
  return (
    <span
      className={
        "chip " +
        (passes
          ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
          : "border-amber-700/40 bg-amber-900/20 text-amber-200")
      }
    >
      {passes ? "Chain contract: ✓ all 5 checks" : "Chain contract: review"}
    </span>
  );
}

function ChainContractChecks({
  checks,
}: {
  checks: Record<string, { passes: boolean; message: string }>;
}) {
  const LABELS: Record<string, string> = {
    hookPresent: "Hook in opening",
    setupDramatized: "Setup dramatized",
    twistPresent: "Twist present",
    endsOnCliffhanger: "Ends on cliffhanger",
    withheldNotExposed: "Withheld stays withheld",
  };
  const order = [
    "hookPresent",
    "setupDramatized",
    "twistPresent",
    "endsOnCliffhanger",
    "withheldNotExposed",
  ];
  return (
    <ul className="rounded-sm border border-white/8 bg-white/[0.02] p-2 text-[11px]">
      {order.map((k) => {
        const c = checks[k];
        if (!c) return null;
        return (
          <li
            key={k}
            className={
              "flex items-start gap-2 py-0.5 " +
              (c.passes ? "text-bone-300" : "text-amber-200")
            }
          >
            <span className="font-mono text-[10px]">
              {c.passes ? "✓" : "!"}
            </span>
            <span>
              <span className="font-medium">{LABELS[k] ?? k}:</span> {c.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RetentionField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="label-eyebrow mb-1 block">{label}</label>
      <textarea
        className="input min-h-[56px] text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
      />
    </div>
  );
}

function BingeScoreChip({
  total,
  loading,
}: {
  total: number | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="chip border-white/12 bg-white/[0.02] text-bone-500">
        Binge …
      </span>
    );
  }
  if (total == null) {
    return (
      <span className="chip border-white/12 bg-white/[0.02] text-bone-500">
        Binge —
      </span>
    );
  }
  const cls =
    total >= 65
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : total >= 50
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : "border-red-800/50 bg-red-950/30 text-red-200";
  return <span className={`chip ${cls}`}>Binge {total}/100</span>;
}

function ViralVerdictChip({ verdict }: { verdict: "yes" | "no" | "weak" | null }) {
  if (!verdict) return null;
  if (verdict === "yes")
    return (
      <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
        Viral: yes
      </span>
    );
  if (verdict === "weak")
    return (
      <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
        Viral: weak
      </span>
    );
  return (
    <span className="chip border-red-800/50 bg-red-950/30 text-red-200">
      Viral: no
    </span>
  );
}

function ComponentChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/[0.02] px-1.5 py-1 text-center">
      <div className="text-bone-500">{label}</div>
      <div className="font-mono text-bone-200">{value}/25</div>
    </div>
  );
}

// Visible "viewer would scroll" warning. Shown wherever a micro-drama
// episode's viralTest.passes === false. Amber for "weak" (almost there),
// red for "no" (revise hook or cliffhanger now).
function ScrollWarning({ verdict }: { verdict: "no" | "weak" }) {
  const cls =
    verdict === "no"
      ? "border-red-800/50 bg-red-950/30 text-red-200"
      : "border-amber-700/40 bg-amber-900/20 text-amber-200";
  return (
    <div
      className={`mt-2 flex items-start gap-2 rounded-sm border px-2 py-1.5 text-xs ${cls}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 flex-none translate-y-[1px]" />
      <span>Viewer would scroll — revise hook or cliffhanger.</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season Retention Map
// ---------------------------------------------------------------------------
// Lists every episode in order with its Binge Score, Viral verdict and the
// four component bars (Hook / Gap / Twist / Cliff, each 0-25). Highlights
// weak middle episodes — the "saggy middle" risk in vertical drama where the
// audience has invested but the curiosity gap collapses before the climax.
// Surfaces the season average so the writer sees retention at a glance.
//
// Read-only — no writes, no rewrites. The writer fixes weak rows by editing
// the episode's HOOK / SETUP / TWIST / CLIFFHANGER inline (existing panel).

type EpisodeForMap = {
  id: string;
  number: number;
  title?: string | null;
};

function SeasonRetentionMap({ episodes }: { episodes: EpisodeForMap[] }) {
  const ordered = [...episodes].sort((a, b) => a.number - b.number);

  const results = useQueries({
    queries: ordered.map((e) => ({
      queryKey: ["episode-viral", e.id],
      queryFn: () => api.getEpisodeViralTest(e.id),
    })),
  });

  const rows = ordered.map((ep, i) => {
    const r = results[i];
    return {
      episode: ep,
      loading: r.isLoading,
      data: r.data ?? null,
    };
  });

  const loadedScores = rows
    .map((r) => r.data?.score.total)
    .filter((n): n is number => typeof n === "number");
  const avg =
    loadedScores.length > 0
      ? Math.round(loadedScores.reduce((s, n) => s + n, 0) / loadedScores.length)
      : null;

  // Middle slice = inner third of the season.
  const n = rows.length;
  const midStart = Math.floor(n / 3);
  const midEnd = Math.ceil((2 * n) / 3); // exclusive
  const weakMiddle = rows
    .map((r, idx) => ({ r, idx }))
    .filter(
      ({ r, idx }) =>
        idx >= midStart &&
        idx < midEnd &&
        r.data != null &&
        r.data.score.total < 50
    );

  const failingCount = rows.filter(
    (r) => r.data?.test.passes === false
  ).length;

  return (
    <Panel eyebrow="Retention" title="Season Retention Map">
      <p className="mb-2 text-xs text-bone-400">
        Binge Momentum + Viral Test across the season. Weak middle episodes
        are the highest churn risk in vertical drama.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SeasonAverageChip avg={avg} />
        {failingCount > 0 && (
          <span className="chip border-red-800/50 bg-red-950/30 text-red-200">
            <AlertTriangle className="h-3 w-3" />
            {failingCount} episode{failingCount === 1 ? "" : "s"} would lose viewers
          </span>
        )}
        {weakMiddle.length > 0 && (
          <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
            <TrendingDown className="h-3 w-3" />
            Weak middle: {weakMiddle.map(({ r }) => `EP${r.episode.number}`).join(", ")}
          </span>
        )}
      </div>

      <ul className="space-y-1.5">
        {rows.map((r, idx) => {
          const inMiddle = idx >= midStart && idx < midEnd;
          const total = r.data?.score.total ?? null;
          const verdict = r.data?.test.verdict ?? null;
          const isWeakMiddle =
            inMiddle && total != null && total < 50;
          const failing = r.data?.test.passes === false;

          const rowCls = isWeakMiddle
            ? "border-amber-700/40 bg-amber-900/10"
            : failing
            ? "border-red-800/40 bg-red-950/10"
            : "border-white/8 bg-white/[0.02]";

          return (
            <li
              key={r.episode.id}
              className={`grid grid-cols-12 items-center gap-2 rounded-md border p-2 text-xs ${rowCls}`}
            >
              <div className="col-span-3 min-w-0">
                <div className="font-mono text-[10px] text-ember-300">
                  EP {String(r.episode.number).padStart(2, "0")}
                </div>
                <div className="truncate text-bone-200">
                  {r.episode.title ?? "Untitled"}
                </div>
              </div>

              <div className="col-span-2 flex items-center gap-1">
                <BingeScoreChip total={total} loading={r.loading} />
              </div>

              <div className="col-span-2 flex items-center gap-1">
                <ViralVerdictChip verdict={verdict} />
              </div>

              <div className="col-span-5">
                {r.data ? (
                  <ComponentBars components={r.data.score.components} />
                ) : (
                  <div className="h-3 animate-pulse-soft rounded-sm bg-white/[0.04]" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function SeasonAverageChip({ avg }: { avg: number | null }) {
  if (avg == null) {
    return (
      <span className="chip border-white/12 bg-white/[0.02] text-bone-500">
        Avg binge: —
      </span>
    );
  }
  const cls =
    avg >= 65
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : avg >= 50
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : "border-red-800/50 bg-red-950/30 text-red-200";
  return <span className={`chip ${cls}`}>Avg binge: {avg}/100</span>;
}

function ComponentBars({
  components,
}: {
  components: {
    hookStrength: number;
    curiosityGap: number;
    twistStrength: number;
    cliffhangerStrength: number;
  };
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      <Bar label="Hook" value={components.hookStrength} />
      <Bar label="Gap" value={components.curiosityGap} />
      <Bar label="Twist" value={components.twistStrength} />
      <Bar label="Cliff" value={components.cliffhangerStrength} />
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 25) * 100));
  // Bar fills mirror the binge thresholds (≥65 emerald, ≥50 amber, else red),
  // applied to the 0-25 component scale: 16+/12+/else.
  const fill =
    value >= 16
      ? "bg-emerald-500/70"
      : value >= 12
      ? "bg-amber-500/70"
      : "bg-red-500/70";
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] text-bone-500">
        <span>{label}</span>
        <span className="font-mono text-bone-300">{value}/25</span>
      </div>
      <div className="mt-0.5 h-1.5 rounded-sm bg-white/[0.04]">
        <div
          className={`h-full rounded-sm ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TitleStatusChip({ status }: { status: "untitled" | "suggested" | "approved" }) {
  if (status === "approved")
    return <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">Title: approved</span>;
  if (status === "suggested")
    return <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">Title: suggested</span>;
  return <span className="chip border-white/12 bg-white/[0.02] text-bone-500">Title: untitled</span>;
}

function NewEpisodeDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (v: { number: number; title: string; logline: string }) => void;
  pending: boolean;
}) {
  const [num, setNum] = useState(1);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">New episode</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="label-eyebrow mb-1 block">Number</label>
            <input className="input" type="number" min={1} value={num} onChange={(e) => setNum(Number(e.target.value))} />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Logline</label>
            <textarea className="input min-h-[72px]" value={logline} onChange={(e) => setLogline(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSubmit({ number: num, title, logline })} disabled={pending}>
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
