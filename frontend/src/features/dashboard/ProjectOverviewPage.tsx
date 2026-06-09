import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Compass,
  Hammer,
  Loader2,
  Pencil,
  PlayCircle,
  Save,
  Sparkles,
  Wand2,
} from "lucide-react";
import {
  STAGE_GROUPS,
  STAGE_LABELS,
  WORKFLOW_STAGES,
  type Approval,
  type WorkflowStageId,
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
  MICRO_DRAMA_EMOTIONS,
  MICRO_DRAMA_EPISODE_LENGTHS_SEC,
  MICRO_DRAMA_SEASON_LENGTHS,
  MICRO_DRAMA_SEASON_LENGTH_MAX,
  MICRO_DRAMA_SEASON_LENGTH_MIN,
  type ProjectType,
  type MicroDramaEmotion,
  type MicroDramaCohesion,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { WayfinderPanel } from "@/components/ui/WayfinderPanel";
import { RecommendedNextStep } from "@/components/ui/RecommendedNextStep";
import { Button } from "@/components/ui/Button";
import { BusyBar } from "@/components/ui/BusyBar";

// Load a named protocol (e.g. SELVAJE prestige restraint defaults) into the
// project. The preset MERGES into existing tone + showrunner_notes — it never
// overwrites — and reloading the same preset is a no-op.
function LoadProtocolButton({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const protocols = useQuery({
    queryKey: ["protocols"],
    queryFn: () => api.listProtocols(),
    enabled: open,
  });
  const load = useMutation({
    mutationFn: (key: string) => api.loadProtocol(projectId, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setOpen(false);
    },
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Load protocol
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="panel-strong w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">Load protocol defaults</h2>
            <p className="mt-1 text-xs text-bone-400">
              Adopt a named restraint protocol — tone tags and showrunner notes are MERGED into your
              existing project bible. The 95% Audit and prompt builder read these.
            </p>
            <ul className="mt-3 space-y-2">
              {(protocols.data ?? []).map((p) => (
                <li key={p.key} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm uppercase tracking-wide text-bone-100">{p.key}</div>
                    <Button
                      onClick={() => load.mutate(p.key)}
                      disabled={load.isPending && load.variables === p.key}
                    >
                      {load.isPending && load.variables === p.key ? "Applying…" : "Apply"}
                    </Button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {p.tone.map((t) => (
                      <span key={t} className="chip">{t}</span>
                    ))}
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-[11px] text-bone-400">
                    {p.preview}
                  </div>
                </li>
              ))}
              {protocols.data && protocols.data.length === 0 && (
                <li className="text-xs text-bone-400">No presets registered.</li>
              )}
            </ul>
            {load.error && (
              <div className="mt-2 text-xs text-red-300">{(load.error as Error).message}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Series Redevelopment entry point. Only renders for Prestige Series
 *  / Mini Series projects — micro-drama redevelopment will need a
 *  different flow (chain regen) and isn't part of Phase 1. */
function RedevelopmentButton({
  projectId,
  project,
}: {
  projectId: string;
  project: { metadata?: unknown; kind?: string | null } | null | undefined;
}) {
  const obj = (project ?? {}) as { metadata?: unknown; kind?: string | null };
  const meta = (obj.metadata ?? {}) as { projectType?: unknown };
  const pt = typeof meta.projectType === "string" ? meta.projectType : "";
  // Show on prestige_series / mini_series, and on long-form kinds that
  // didn't declare projectType (legacy fallback).
  const isPrestigeOrMini =
    pt === "prestige_series" ||
    pt === "mini_series" ||
    (!pt && (obj.kind === "miniseries" || obj.kind === "series" || obj.kind === "pilot"));
  if (!isPrestigeOrMini) return null;
  return (
    <Link to={`/projects/${projectId}/redevelopment`}>
      <Button variant="outline" title="Open the Series Redevelopment workspace — revise series engine without overwriting drafts.">
        <Compass className="h-4 w-4" />
        Start Redevelopment Pass
      </Button>
    </Link>
  );
}

function RenameProjectButton({
  projectId,
  currentTitle,
}: {
  projectId: string;
  currentTitle: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentTitle);
  const rename = useMutation({
    mutationFn: (title: string) => api.updateProject(projectId, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setOpen(false);
    },
  });
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setValue(currentTitle);
          setOpen(true);
        }}
      >
        <Pencil className="h-4 w-4" /> Rename
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">Rename project</h2>
            <p className="mt-1 text-xs text-bone-400">
              Changes the project (series) title everywhere it's shown.
            </p>
            <input
              className="input mt-3 w-full"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) rename.mutate(value.trim());
              }}
              placeholder="e.g. SELVAJE"
            />
            {rename.error && (
              <div className="mt-2 text-xs text-red-300">{(rename.error as Error).message}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => rename.mutate(value.trim())}
                disabled={!value.trim() || value.trim() === currentTitle || rename.isPending}
              >
                {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ProjectOverviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const workflows = useQuery({
    queryKey: ["workflows", projectId],
    queryFn: () => api.listWorkflows(projectId),
  });
  const approvals = useQuery({
    queryKey: ["approvals", projectId],
    queryFn: () => api.listApprovals(projectId),
  });

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow={project.data?.kind ?? "Project"}
        title={project.data?.title ?? "—"}
        description={project.data?.logline ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <RenameProjectButton
              projectId={projectId}
              currentTitle={project.data?.title ?? ""}
            />
            <LoadProtocolButton projectId={projectId} />
            <RedevelopmentButton
              projectId={projectId}
              project={project.data}
            />
            <Link to={`/projects/${projectId}/writers-room`}>
              <Button>
                <Sparkles className="h-4 w-4" />
                Open Writers Room
              </Button>
            </Link>
          </div>
        }
      />

      {/* AI-derived next step — most-impactful action given current state. */}
      <div className="px-8">
        <RecommendedNextStep projectId={projectId} />
      </div>

      <div className="px-8">
        <WayfinderPanel projectId={projectId} />
      </div>

      {/* Project Type chip + Micro Drama Bible (when applicable). */}
      <div className="space-y-3 px-8">
        <ProjectTypeRow projectId={projectId} project={project.data} />
        <MicroDramaBibleSection projectId={projectId} project={project.data} />
      </div>

      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-3">
        <Panel
          eyebrow="Pipeline"
          title="Workflow status"
          className="xl:col-span-2"
          actions={<NewWorkflowButton projectId={projectId} />}
        >
          {workflows.isLoading ? (
            <div className="h-20 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (workflows.data ?? []).length === 0 ? (
            <div className="text-sm text-bone-300">
              No workflows yet. Start one to take your idea through its story
              foundation, scene plan and a full first draft.
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.data!.map((w) => (
                <WorkflowRow
                  key={w.id}
                  id={w.id}
                  title={w.title}
                  current={w.current_stage as WorkflowStageId}
                  status={w.status}
                />
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Awaiting" title="Pending approvals">
          {approvals.isLoading ? (
            <div className="h-20 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (approvals.data ?? []).length === 0 ? (
            <div className="text-sm text-bone-400">All caught up.</div>
          ) : (
            <ul className="space-y-3">
              {approvals.data!.slice(0, 6).map((a) => (
                <ApprovalItem key={a.id} approval={a} projectId={projectId} />
              ))}
            </ul>
          )}
        </Panel>

        <QuickLinks projectId={projectId} />

        {workflows.data && workflows.data.length > 0 && (
          <div className="xl:col-span-3">
            <CompletedArtifactsPanel workflowId={workflows.data[0].id} />
          </div>
        )}
      </div>
    </div>
  );
}

function CompletedArtifactsPanel({ workflowId }: { workflowId: string }) {
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});
  const artifacts = useQuery({
    queryKey: ["workflow-artifacts", workflowId],
    queryFn: () => api.workflowArtifacts(workflowId),
  });
  // One row per stage_id (the latest revision per stage).
  const latestByStage = new Map<
    string,
    { id: string; stage_id: WorkflowStageId; revision: number; body: unknown }
  >();
  for (const a of artifacts.data ?? []) {
    const existing = latestByStage.get(a.stage_id);
    if (!existing || existing.revision < a.revision) {
      latestByStage.set(a.stage_id, a);
    }
  }
  const rows = WORKFLOW_STAGES.map((s) => latestByStage.get(s)).filter(Boolean) as {
    id: string;
    stage_id: WorkflowStageId;
    revision: number;
    body: unknown;
  }[];
  return (
    <Panel eyebrow="Browse" title="Completed stages">
      {artifacts.isLoading ? (
        <div className="h-20 animate-pulse-soft rounded-lg bg-white/[0.03]" />
      ) : rows.length === 0 ? (
        <div className="text-sm text-bone-400">No artifacts yet.</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const open = openStages[r.stage_id] ?? false;
            return (
              <li
                key={r.id}
                className="rounded-md border border-white/8 bg-white/[0.02]"
              >
                <button
                  className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/[0.02]"
                  onClick={() =>
                    setOpenStages((s) => ({ ...s, [r.stage_id]: !open }))
                  }
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-bone-100">
                      {STAGE_LABELS[r.stage_id] ?? r.stage_id}
                    </span>
                    <span className="text-xs text-bone-500">
                      rev {r.revision}
                    </span>
                  </div>
                  <span className="text-xs text-bone-400">
                    {open ? "Hide" : "View"}
                  </span>
                </button>
                {open && (
                  <div className="border-t border-white/5 p-3">
                    <ArtifactPreview
                      stageId={r.stage_id}
                      body={r.body}
                      workflowId={workflowId}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function ApprovalItem({ approval, projectId }: { approval: Approval; projectId: string }) {
  const artifacts = useQuery({
    queryKey: ["workflow-artifacts", approval.workflow_id],
    queryFn: () => api.workflowArtifacts(approval.workflow_id as string),
    enabled: !!approval.workflow_id && approval.target_kind === "artifact",
  });
  const artifact = artifacts.data?.find((x) => x.id === approval.target_id);

  return (
    <li className="rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm text-bone-100">
            {approval.target_kind === "artifact"
              ? `Approve ${STAGE_LABELS[approval.stage_id as WorkflowStageId] ?? approval.stage_id}`
              : `Approve ${approval.target_kind}`}
          </div>
          <div className="mt-0.5 text-xs text-bone-400">
            Requested by {approval.requested_by ?? "system"} •{" "}
            {new Date(approval.created_at).toLocaleString()}
          </div>
        </div>
        <ApprovalButtons id={approval.id} projectId={projectId} />
      </div>
      {approval.target_kind === "artifact" && (
        <div className="mt-3 border-t border-white/5 pt-3">
          {artifacts.isLoading ? (
            <div className="h-12 animate-pulse-soft rounded bg-white/[0.03]" />
          ) : artifact ? (
            <ArtifactPreview
              stageId={approval.stage_id as WorkflowStageId}
              body={artifact.body}
              workflowId={approval.workflow_id ?? undefined}
            />
          ) : (
            <div className="text-xs text-bone-500">No preview available.</div>
          )}
        </div>
      )}
    </li>
  );
}

function ArtifactPreview({
  stageId,
  body,
  workflowId,
}: {
  stageId: WorkflowStageId;
  body: unknown;
  workflowId?: string;
}) {
  if (stageId === "logline") {
    const pack = body as {
      loglines?: { text: string; hook: string; theme: string }[];
      premise?: string;
      themes?: string[];
    };
    return (
      <div className="space-y-3 text-sm">
        {pack.loglines && pack.loglines.length > 0 && (
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-bone-500">
              Loglines
            </div>
            <ul className="space-y-2">
              {pack.loglines.map((l, i) => (
                <li key={i} className="rounded border border-white/5 bg-white/[0.02] p-2">
                  <div className="text-bone-100">{l.text}</div>
                  {l.hook && (
                    <div className="mt-1 text-xs text-bone-400">
                      <span className="text-bone-500">Hook:</span> {l.hook}
                    </div>
                  )}
                  {l.theme && (
                    <div className="text-xs text-bone-400">
                      <span className="text-bone-500">Theme:</span> {l.theme}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pack.premise && (
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-bone-500">
              Premise
            </div>
            <div className="text-bone-200">{pack.premise}</div>
          </div>
        )}
        {pack.themes && pack.themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pack.themes.map((t) => (
              <span key={t} className="chip">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (stageId === "synopsis") {
    const s = body as { synopsis?: string };
    return (
      <div className="space-y-1 text-sm">
        <div className="text-xs uppercase tracking-wide text-bone-500">Synopsis</div>
        <div className="whitespace-pre-wrap text-bone-100">{s.synopsis ?? ""}</div>
      </div>
    );
  }

  if (stageId === "scene_list") {
    return <SceneListPreview body={body} workflowId={workflowId} />;
  }

  if (stageId === "draft_v1") {
    const d = body as { fountain?: string };
    const fountain = d.fountain ?? "";
    return <FountainPreview fountain={fountain} />;
  }

  if (stageId === "production_draft") {
    return <ProductionPreview body={body} />;
  }

  if (stageId === "rewrite") {
    return <ScriptDoctorPreview body={body} />;
  }

  if (stageId === "continuity_pass") {
    return <ContinuityPreview body={body} />;
  }

  if (stageId === "episode_outline") {
    const ep = body as {
      episodeNumber?: number;
      title?: string;
      logline?: string;
      cold_open?: string;
      acts?: { number: number; summary: string; turn: string }[];
      tag?: string;
    };
    return (
      <div className="space-y-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-bone-500">
            Episode {ep.episodeNumber ?? 1}
          </div>
          <div className="text-lg text-bone-50">{ep.title ?? "Untitled episode"}</div>
        </div>
        {ep.logline && (
          <Section label="Logline">
            <Prose text={ep.logline} />
          </Section>
        )}
        {ep.cold_open && (
          <Section label="Cold open">
            <Prose text={ep.cold_open} />
          </Section>
        )}
        {ep.acts && ep.acts.length > 0 && (
          <Section label="Acts">
            <ol className="space-y-2">
              {ep.acts.map((a) => (
                <li key={a.number} className="rounded border border-white/5 bg-white/[0.02] p-2">
                  <div className="text-bone-100">Act {a.number}</div>
                  {a.summary && (
                    <div className="mt-1 text-xs text-bone-300">{a.summary}</div>
                  )}
                  {a.turn && (
                    <div className="mt-1 text-xs text-bone-400">
                      <span className="text-bone-500">Turn:</span> {a.turn}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        )}
        {ep.tag && (
          <Section label="Tag">
            <Prose text={ep.tag} />
          </Section>
        )}
      </div>
    );
  }

  if (stageId === "beat_sheet") {
    const bs = body as {
      episodeNumber?: number;
      beats?: { id?: string; order: number; type: string; body: string }[];
    };
    const beats = (bs.beats ?? []).slice().sort((a, b) => a.order - b.order);
    return (
      <div className="space-y-3 text-sm">
        <div className="text-xs uppercase tracking-wide text-bone-500">
          Beat sheet · Episode {bs.episodeNumber ?? 1} · {beats.length} beats
        </div>
        <ol className="space-y-2">
          {beats.map((b, i) => (
            <li
              key={b.id ?? `${b.order}-${i}`}
              className="rounded border border-white/5 bg-white/[0.02] p-2"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-bone-500">{b.order}</span>
                <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                  {b.type.replace(/_/g, " ")}
                </span>
              </div>
              <div className="mt-1 text-bone-200">{b.body}</div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (stageId === "season_arc") {
    const sa = body as {
      seasonNumber?: number;
      title?: string;
      premise?: string;
      throughline?: string;
      episodes?: {
        number: number;
        title: string;
        logline: string;
        tentpole?: boolean;
      }[];
    };
    return (
      <div className="space-y-4 text-sm">
        <div>
          <div className="text-xs uppercase tracking-wide text-bone-500">
            Season {sa.seasonNumber ?? 1}
          </div>
          <div className="text-lg text-bone-50">{sa.title ?? "Untitled season"}</div>
        </div>
        {sa.premise && (
          <Section label="Premise">
            <Prose text={sa.premise} />
          </Section>
        )}
        {sa.throughline && (
          <Section label="Throughline">
            <Prose text={sa.throughline} />
          </Section>
        )}
        {sa.episodes && sa.episodes.length > 0 && (
          <Section label={`Episodes (${sa.episodes.length})`}>
            <ol className="space-y-2">
              {sa.episodes.map((e) => (
                <li
                  key={e.number}
                  className="rounded border border-white/5 bg-white/[0.02] p-2"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-bone-500">Ep {e.number}</span>
                    <span className="text-bone-100">{e.title}</span>
                    {e.tentpole && (
                      <span className="chip border-ember-700/50 bg-ember-900/30 text-ember-100">
                        tentpole
                      </span>
                    )}
                  </div>
                  {e.logline && (
                    <div className="mt-1 text-xs text-bone-300">{e.logline}</div>
                  )}
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-bone-500">
              Approving the Season Arc creates these episode records automatically.
              Open the <span className="text-bone-300">Episodes</span> tab to develop
              each one in its own workflow.
            </p>
          </Section>
        )}
      </div>
    );
  }

  if (stageId === "treatment") {
    const t = body as {
      title?: string;
      titleOptions?: string[];
      logline?: string;
      format?: string;
      genre?: string;
      tone?: string;
      premise?: string;
      shortSynopsis?: string;
      treatmentProse?: string;
      worldStatement?: string;
      centralConflict?: string;
      emotionalEngine?: string;
      endingHook?: string;
      visualTone?: string;
      seriesEngine?: string;
      themes?: string[];
      protagonists?: { name: string; role?: string; summary?: string }[];
      acts?: { number: number; goal?: string; turn?: string; summary?: string }[];
    };
    const metaChips = [
      t.format && { k: "Format", v: t.format },
      t.genre && { k: "Genre", v: t.genre },
      t.tone && { k: "Tone", v: t.tone },
    ].filter(Boolean) as { k: string; v: string }[];
    return (
      <div className="space-y-4 text-sm">
        {t.title && (
          <div>
            <div className="text-xs uppercase tracking-wide text-bone-500">Working title</div>
            <div className="text-lg text-bone-50">{t.title}</div>
            {t.titleOptions && t.titleOptions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {t.titleOptions
                  .filter((o) => o && o !== t.title)
                  .map((o, i) => (
                    <span key={i} className="chip text-xs">
                      {o}
                    </span>
                  ))}
              </div>
            )}
          </div>
        )}
        {t.logline && (
          <Section label="Logline">
            <div className="text-bone-100 italic">{t.logline}</div>
          </Section>
        )}
        {metaChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {metaChips.map((c) => (
              <span key={c.k} className="chip text-xs">
                <span className="text-bone-500">{c.k}:</span>&nbsp;{c.v}
              </span>
            ))}
          </div>
        )}
        {t.premise && (
          <Section label="Premise">
            <Prose text={t.premise} />
          </Section>
        )}
        {t.shortSynopsis && (
          <Section label="Synopsis">
            <Prose text={t.shortSynopsis} />
          </Section>
        )}
        {t.treatmentProse && (
          <Section label="Treatment">
            <Prose text={t.treatmentProse} />
          </Section>
        )}
        {t.worldStatement && (
          <Section label="World">
            <Prose text={t.worldStatement} />
          </Section>
        )}
        {t.centralConflict && (
          <Section label="Central conflict">
            <Prose text={t.centralConflict} />
          </Section>
        )}
        {t.emotionalEngine && (
          <Section label="Emotional engine">
            <Prose text={t.emotionalEngine} />
          </Section>
        )}
        {t.protagonists && t.protagonists.length > 0 && (
          <Section label="Protagonists">
            <ul className="space-y-2">
              {t.protagonists.map((p, i) => (
                <li key={i} className="rounded border border-white/5 bg-white/[0.02] p-2">
                  <div className="text-bone-100">
                    {p.name}
                    {p.role && <span className="ml-2 text-xs text-bone-400">— {p.role}</span>}
                  </div>
                  {p.summary && (
                    <div className="mt-0.5 text-xs text-bone-300">{p.summary}</div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}
        {t.acts && t.acts.length > 0 && (
          <Section label="Acts">
            <ol className="space-y-2">
              {t.acts.map((a) => (
                <li key={a.number} className="rounded border border-white/5 bg-white/[0.02] p-2">
                  <div className="text-bone-100">Act {a.number}</div>
                  {a.goal && (
                    <div className="mt-0.5 text-xs text-bone-300">
                      <span className="text-bone-500">Goal:</span> {a.goal}
                    </div>
                  )}
                  {a.turn && (
                    <div className="text-xs text-bone-300">
                      <span className="text-bone-500">Turn:</span> {a.turn}
                    </div>
                  )}
                  {a.summary && (
                    <div className="mt-1 text-xs text-bone-400">{a.summary}</div>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        )}
        {t.endingHook && (
          <Section label="Ending / hook">
            <Prose text={t.endingHook} />
          </Section>
        )}
        {t.visualTone && (
          <Section label="Visual tone">
            <Prose text={t.visualTone} />
          </Section>
        )}
        {t.seriesEngine && (
          <Section label="Series engine">
            <Prose text={t.seriesEngine} />
          </Section>
        )}
        {t.themes && t.themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {t.themes.map((th) => (
              <span key={th} className="chip">
                {th}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-xs text-bone-300">
      {JSON.stringify(body, null, 2)}
    </pre>
  );
}

/**
 * Lightweight prose renderer: turns **bold** into <strong> and lines beginning
 * with `- ` into a bullet list. Keeps paragraph breaks. No external dep.
 */
function Prose({ text }: { text: string }) {
  if (!text) return null;
  const paragraphs = text.split(/\n{2,}/);
  return (
    <div className="space-y-2 whitespace-pre-wrap text-bone-200">
      {paragraphs.map((para, pi) => {
        const lines = para.split("\n");
        const isBulletBlock = lines.every((l) => l.trim().startsWith("- "));
        if (isBulletBlock) {
          return (
            <ul key={pi} className="list-disc space-y-0.5 pl-5">
              {lines.map((l, li) => (
                <li key={li}>{inlineBold(l.replace(/^\s*-\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return <p key={pi}>{inlineBold(para)}</p>;
      })}
    </div>
  );
}

function inlineBold(s: string): ReactNode {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="text-bone-50">
        {p}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

interface SceneRow {
  order: number;
  slugline?: string;
  intExt?: "INT" | "EXT" | "INT/EXT";
  location?: string;
  timeOfDay?: string;
  goal?: string;
  conflict?: string;
  turn?: string;
  characters?: string[];
  continuityNotes?: string;
  visualMotif?: string;
}
interface SceneListBody {
  scenes?: SceneRow[];
  ready_for_draft?: boolean;
  enriched_from_revision?: number | null;
  enriched_at?: string;
}

function SceneListPreview({
  body,
  workflowId,
}: {
  body: unknown;
  workflowId?: string;
}) {
  const qc = useQueryClient();
  const sl = (body ?? {}) as SceneListBody;
  const scenes = sl.scenes ?? [];
  const placeholderCount = scenes.filter(
    (s) => s.location === "PLACEHOLDER" || s.slugline?.includes("PLACEHOLDER")
  ).length;
  const isReady = sl.ready_for_draft === true;

  // Fetch all revisions so we can compare against the prior version when enriched.
  const allRevs = useQuery({
    queryKey: ["workflow-artifacts", workflowId],
    queryFn: () => api.workflowArtifacts(workflowId as string),
    enabled: !!workflowId,
  });
  const sceneListRevisions = (allRevs.data ?? [])
    .filter((a) => a.stage_id === "scene_list")
    .sort((a, b) => b.revision - a.revision);
  const priorRevision =
    isReady && sl.enriched_from_revision != null
      ? sceneListRevisions.find((r) => r.revision === sl.enriched_from_revision)
      : undefined;
  const priorScenes =
    (priorRevision?.body as SceneListBody | undefined)?.scenes ?? [];
  const priorByOrder = new Map<number, SceneRow>();
  for (const s of priorScenes) priorByOrder.set(s.order, s);

  const [showOriginal, setShowOriginal] = useState(false);
  const enrich = useMutation({
    mutationFn: () => api.enrichScenes(workflowId as string),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow-artifacts", workflowId] });
    },
  });

  const displayScenes = showOriginal && priorScenes.length > 0 ? priorScenes : scenes;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs uppercase tracking-wide text-bone-500">
          Scene list · {displayScenes.length} scenes
        </div>
        {isReady && (
          <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-200">
            ready for draft
          </span>
        )}
        {!isReady && placeholderCount > 0 && (
          <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">
            {placeholderCount} placeholders
          </span>
        )}
        {priorScenes.length > 0 && (
          <button
            className="ml-auto rounded-md border border-white/10 px-2 py-1 text-xs text-bone-300 hover:bg-white/[0.04]"
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? "Show enriched" : "Show original"}
          </button>
        )}
        {workflowId && !isReady && placeholderCount > 0 && (
          <button
            className="flex items-center gap-2 rounded-md border border-ember-700/60 bg-ember-900/30 px-3 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-60"
            onClick={() => enrich.mutate()}
            disabled={enrich.isPending}
          >
            {enrich.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {enrich.isPending ? "Enriching…" : "Enrich scene list"}
          </button>
        )}
      </div>

      {enrich.isPending && <BusyBar label="Enriching scene list" subtext="One Scene-agent LLM call. Typically 30-60 seconds. Don't refresh — the result will appear here." />}
      {enrich.error && (
        <div className="rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(enrich.error as Error).message}
        </div>
      )}
      {enrich.data && (
        <div className="rounded border border-emerald-800/50 bg-emerald-950/30 p-2 text-xs text-emerald-200">
          Enriched {enrich.data.sceneCount} scenes — revision {enrich.data.revision}
          {enrich.data.previousRevision != null && (
            <> (kept revision {enrich.data.previousRevision} for rollback)</>
          )}.
        </div>
      )}

      <ol className="space-y-2">
        {displayScenes.map((s, i) => {
          const prior = priorByOrder.get(s.order);
          const changed = !showOriginal && isReady && prior;
          const sluglineChanged = changed && prior!.slugline !== s.slugline;
          const charsChanged =
            changed &&
            JSON.stringify(prior!.characters ?? []) !==
              JSON.stringify(s.characters ?? []);
          return (
            <li
              key={`${s.order}-${i}`}
              className="rounded border border-white/5 bg-white/[0.02] p-2"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-bone-500">#{s.order}</span>
                <span
                  className={`font-mono text-xs ${
                    sluglineChanged ? "text-emerald-200" : "text-bone-200"
                  }`}
                >
                  {s.slugline ?? "—"}
                </span>
                {sluglineChanged && (
                  <span className="text-[10px] text-bone-500">
                    was: <span className="font-mono">{prior!.slugline}</span>
                  </span>
                )}
              </div>
              {s.goal && (
                <div className="mt-1 text-xs text-bone-300">
                  <span className="text-bone-500">Goal:</span> {s.goal}
                </div>
              )}
              {s.conflict && s.conflict !== "TBD" && (
                <div className="text-xs text-bone-300">
                  <span className="text-bone-500">Conflict:</span> {s.conflict}
                </div>
              )}
              {s.turn && s.turn !== "TBD" && (
                <div className="text-xs text-bone-300">
                  <span className="text-bone-500">Turn:</span> {s.turn}
                </div>
              )}
              {s.continuityNotes && (
                <div className="text-xs text-bone-400">
                  <span className="text-bone-500">Continuity:</span> {s.continuityNotes}
                </div>
              )}
              {s.visualMotif && (
                <div className="text-xs text-bone-400">
                  <span className="text-bone-500">Visual motif:</span> {s.visualMotif}
                </div>
              )}
              {s.characters && s.characters.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.characters.map((c) => (
                    <span
                      key={c}
                      className={`chip ${charsChanged ? "border-emerald-700/40 text-emerald-200" : ""}`}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * "Write Draft 1" — the showrunner-facing entry into the writing room. Turns
 * the approved scene plan into a fresh script with pending scenes (no batch
 * draft), then opens Hollywood Draft Mode where the AI writes scene by scene
 * with continuity gating. Idempotent: reuses an in-progress draft shell.
 */
function WriteDraft1Button({ id }: { id: string }) {
  const navigate = useNavigate();
  const prepare = useMutation({
    mutationFn: () => api.prepareDraft(id),
    onSuccess: (data) => {
      navigate(`/projects/${data.projectId}/drafts/${data.scriptId}`);
    },
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <Button onClick={() => prepare.mutate()} disabled={prepare.isPending}>
        {prepare.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        {prepare.isPending ? "Opening…" : "Write Draft 1 into New Draft"}
      </Button>
      <div className="max-w-xs text-right text-xs text-amber-300">
        Reads from the workflow's <strong>scene plan / beat sheet</strong>, not
        from any existing draft's prose. Output is a brand-new draft — locked
        drafts are not touched.
      </div>
      {prepare.error && (
        <div className="max-w-xs text-right text-xs text-red-300">
          {(prepare.error as Error).message}
        </div>
      )}
    </div>
  );
}

/**
 * Render a Fountain string as a readable screenplay. Not a full Fountain
 * parser — just enough heuristics to color sluglines, transitions, character
 * cues, and dialogue distinctly so the page doesn't look like a wall of text.
 */
function FountainPreview({ fountain }: { fountain: string }) {
  const [copied, setCopied] = useState(false);
  if (!fountain || !fountain.trim()) {
    return <div className="text-sm text-bone-400">(empty draft)</div>;
  }

  const lines = fountain.split("\n");
  const stats = {
    scenes: lines.filter((l) => /^(INT|EXT|INT\/EXT)\b/i.test(l.trim())).length,
    pages: Math.max(1, Math.round(fountain.length / 1500)),
    words: fountain.split(/\s+/).filter(Boolean).length,
  };

  type RowKind =
    | "slugline"
    | "transition"
    | "character"
    | "parenthetical"
    | "dialogue"
    | "title"
    | "blank"
    | "action";
  const rows: { kind: RowKind; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) {
      rows.push({ kind: "blank", text: "" });
      continue;
    }
    if (/^(INT|EXT|INT\/EXT)\b/i.test(t) || /^FADE (IN|OUT|TO)/i.test(t)) {
      rows.push({ kind: "slugline", text: t });
      continue;
    }
    if (/^(CUT TO|SMASH CUT|MATCH CUT|FADE TO|DISSOLVE TO|TITLE CARD)/i.test(t)) {
      rows.push({ kind: "transition", text: t });
      continue;
    }
    if (/^[A-Z][A-Z0-9 .\-_'()]+$/.test(t) && t.length < 60 && !t.endsWith(".")) {
      // Character cue — uppercase line followed by dialogue (or parenthetical).
      const next = (lines[i + 1] ?? "").trim();
      if (next && !/^(INT|EXT|FADE|CUT|SMASH|MATCH|DISSOLVE)/i.test(next)) {
        rows.push({ kind: "character", text: t });
        continue;
      }
    }
    if (/^\(.*\)$/.test(t)) {
      rows.push({ kind: "parenthetical", text: t });
      continue;
    }
    // If the previous non-blank row was a character or parenthetical, this is dialogue.
    const lastNonBlank = [...rows].reverse().find((r) => r.kind !== "blank");
    if (lastNonBlank && (lastNonBlank.kind === "character" || lastNonBlank.kind === "parenthetical" || lastNonBlank.kind === "dialogue")) {
      rows.push({ kind: "dialogue", text: t });
      continue;
    }
    rows.push({ kind: "action", text: t });
  }

  const placeholderCount = (fountain.match(/\(DIALOGUE AGENT\)|\[TODO\]/gi) ?? []).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-bone-500">Draft</span>
        <span className="chip">{stats.scenes} scenes</span>
        <span className="chip">~{stats.pages} pages</span>
        <span className="chip">{stats.words.toLocaleString()} words</span>
        {placeholderCount > 0 && (
          <span className="chip border-amber-700/60 bg-amber-900/30 text-amber-200">
            {placeholderCount} unresolved placeholder{placeholderCount === 1 ? "" : "s"}
          </span>
        )}
        <button
          className="ml-auto rounded-md border border-white/10 px-2 py-1 text-xs text-bone-300 hover:bg-white/[0.04]"
          onClick={() => {
            navigator.clipboard.writeText(fountain).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy fountain"}
        </button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto rounded border border-white/8 bg-black/40 px-6 py-5 font-mono text-[13px] leading-relaxed">
        {rows.map((r, i) => {
          if (r.kind === "blank") return <div key={i} className="h-3" />;
          if (r.kind === "slugline") {
            return (
              <div key={i} className="mt-2 font-bold uppercase text-ember-200">
                {r.text}
              </div>
            );
          }
          if (r.kind === "transition") {
            return (
              <div key={i} className="mt-2 text-right uppercase text-ember-300">
                {r.text}
              </div>
            );
          }
          if (r.kind === "character") {
            return (
              <div key={i} className="ml-[35%] mt-2 uppercase text-bone-100">
                {r.text}
              </div>
            );
          }
          if (r.kind === "parenthetical") {
            return (
              <div
                key={i}
                className={`ml-[25%] italic ${
                  /\(DIALOGUE AGENT\)|\[TODO\]/i.test(r.text)
                    ? "rounded bg-amber-900/30 px-1 text-amber-200"
                    : "text-bone-400"
                }`}
              >
                {r.text}
              </div>
            );
          }
          if (r.kind === "dialogue") {
            return (
              <div key={i} className="ml-[15%] mr-[15%] text-bone-100">
                {r.text}
              </div>
            );
          }
          return (
            <div key={i} className="text-bone-200">
              {r.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProductionPreview({ body }: { body: unknown }) {
  const r = (body ?? {}) as {
    estimate?: { tier?: string; reasoning?: string };
    flags?: Array<{
      kind?: string;
      sceneIds?: string[];
      note?: string;
      mitigation?: string;
    }>;
    aiGen?: Array<{ sceneId?: string; suitable?: boolean; notes?: string }>;
  };
  const tier = r.estimate?.tier ?? "—";
  const flags = r.flags ?? [];
  const tierColor: Record<string, string> = {
    indie: "border-emerald-700/50 bg-emerald-900/30 text-emerald-200",
    mid: "border-sky-700/50 bg-sky-900/30 text-sky-200",
    studio: "border-amber-700/50 bg-amber-900/30 text-amber-200",
    tentpole: "border-red-700/60 bg-red-950/40 text-red-200",
  };
  const flagIcon = (k?: string) =>
    ({
      vfx: "✨",
      stunt: "🤸",
      location: "📍",
      cast: "🎭",
      ai_gen: "🤖",
      weather: "🌧️",
    } as Record<string, string>)[k ?? ""] ?? "•";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-bone-500">Budget tier:</span>
        <span className={`chip ${tierColor[tier] ?? ""}`}>{tier}</span>
        {r.estimate?.reasoning && (
          <span className="text-bone-400">{r.estimate.reasoning}</span>
        )}
      </div>
      {flags.length === 0 ? (
        <div className="text-xs text-bone-400">No production flags.</div>
      ) : (
        <ul className="space-y-2">
          {flags.map((f, i) => (
            <li key={i} className="rounded-md border border-white/8 bg-white/[0.02] p-2">
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-mono text-bone-500">
                  {flagIcon(f.kind)} {f.kind}
                </span>
                {f.sceneIds && f.sceneIds.length > 0 && (
                  <span className="ml-auto text-[10px] text-bone-500">
                    scenes {f.sceneIds.map((s) => `#${s}`).join(", ")}
                  </span>
                )}
              </div>
              <div className="mt-1 text-bone-100">{f.note}</div>
              {f.mitigation && (
                <div className="mt-1 text-xs text-bone-300">
                  <span className="text-bone-500">Mitigation:</span> {f.mitigation}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContinuityPreview({ body }: { body: unknown }) {
  const r = (body ?? {}) as {
    issues?: Array<{
      kind?: string;
      severity?: "info" | "warn" | "critical";
      sceneIds?: string[];
      note?: string;
      suggestedFix?: string;
    }>;
  };
  const issues = r.issues ?? [];
  const counts = {
    critical: issues.filter((i) => i.severity === "critical").length,
    warn: issues.filter((i) => i.severity === "warn").length,
    info: issues.filter((i) => i.severity === "info").length,
  };
  const kindIcon = (k?: string) =>
    ({
      wardrobe: "👕",
      location: "📍",
      timeline: "🕒",
      relationship: "👥",
      prop: "🎯",
    } as Record<string, string>)[k ?? ""] ?? "•";
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-bone-500">Continuity issues:</span>
        <span className="chip border-red-700/50 bg-red-950/40 text-red-200">
          {counts.critical} critical
        </span>
        <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">
          {counts.warn} warn
        </span>
        <span className="chip border-sky-700/50 bg-sky-900/30 text-sky-200">
          {counts.info} info
        </span>
      </div>
      {issues.length === 0 ? (
        <div className="text-xs text-bone-400">No continuity issues found.</div>
      ) : (
        <ul className="space-y-2">
          {issues.map((d, i) => {
            const sev = d.severity ?? "info";
            const border =
              sev === "critical"
                ? "border-red-800/60 bg-red-950/20"
                : sev === "warn"
                ? "border-amber-800/60 bg-amber-950/20"
                : "border-white/8 bg-white/[0.02]";
            return (
              <li key={i} className={`rounded-md border p-2 ${border}`}>
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-mono text-bone-500">
                    {kindIcon(d.kind)} {d.kind}
                  </span>
                  <span
                    className={`chip ${
                      sev === "critical"
                        ? "border-red-700/60 bg-red-950/40 text-red-200"
                        : sev === "warn"
                        ? "border-amber-700/50 bg-amber-900/30 text-amber-200"
                        : "border-sky-700/50 bg-sky-900/30 text-sky-200"
                    }`}
                  >
                    {sev}
                  </span>
                  {d.sceneIds && d.sceneIds.length > 0 && (
                    <span className="ml-auto text-[10px] text-bone-500">
                      scenes {d.sceneIds.map((s) => `#${s}`).join(", ")}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-bone-100">{d.note}</div>
                {d.suggestedFix && (
                  <div className="mt-1 text-xs text-bone-300">
                    <span className="text-bone-500">Suggested fix:</span>{" "}
                    {d.suggestedFix}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ScriptDoctorPreview({ body }: { body: unknown }) {
  const r = (body ?? {}) as {
    diagnoses?: Array<{
      sceneId?: string;
      sceneRef?: string;
      severity?: "info" | "warn" | "critical";
      kind?: string;
      note?: string;
      suggestion?: string;
    }>;
    emotionalArcScore?: number;
  };
  const diagnoses = r.diagnoses ?? [];
  const score = typeof r.emotionalArcScore === "number" ? r.emotionalArcScore : 0;
  const scorePct = Math.round(score * 100);
  const counts = {
    critical: diagnoses.filter((d) => d.severity === "critical").length,
    warn: diagnoses.filter((d) => d.severity === "warn").length,
    info: diagnoses.filter((d) => d.severity === "info").length,
  };
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-bone-500">Emotional arc score</span>
        <span className="rounded bg-white/[0.04] px-2 py-0.5 text-bone-100">
          {scorePct}/100
        </span>
        <span className="chip border-red-700/50 bg-red-950/40 text-red-200">
          {counts.critical} critical
        </span>
        <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">
          {counts.warn} warn
        </span>
        <span className="chip border-sky-700/50 bg-sky-900/30 text-sky-200">
          {counts.info} info
        </span>
      </div>
      {diagnoses.length === 0 ? (
        <div className="text-xs text-bone-400">No diagnoses returned.</div>
      ) : (
        <ul className="space-y-2">
          {diagnoses.map((d, i) => {
            const sev = d.severity ?? "info";
            const border =
              sev === "critical"
                ? "border-red-800/60 bg-red-950/20"
                : sev === "warn"
                ? "border-amber-800/60 bg-amber-950/20"
                : "border-white/8 bg-white/[0.02]";
            return (
              <li key={i} className={`rounded-md border p-2 ${border}`}>
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <span className="font-mono text-bone-500">
                    {d.sceneRef ?? d.sceneId ?? "—"}
                  </span>
                  {d.kind && (
                    <span className="chip">{String(d.kind).replace(/_/g, " ")}</span>
                  )}
                  <span
                    className={`chip ${
                      sev === "critical"
                        ? "border-red-700/60 bg-red-950/40 text-red-200"
                        : sev === "warn"
                        ? "border-amber-700/50 bg-amber-900/30 text-amber-200"
                        : "border-sky-700/50 bg-sky-900/30 text-sky-200"
                    }`}
                  >
                    {sev}
                  </span>
                </div>
                <div className="mt-1 text-bone-100">{d.note}</div>
                {d.suggestion && (
                  <div className="mt-1 text-xs text-bone-300">
                    <span className="text-bone-500">Suggested fix:</span>{" "}
                    {d.suggestion}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wide text-bone-500">{label}</div>
      {children}
    </div>
  );
}

function ApprovalButtons({ id, projectId }: { id: string; projectId: string }) {
  const qc = useQueryClient();
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["approvals", projectId] });
    qc.invalidateQueries({ queryKey: ["workflows", projectId] });
    qc.invalidateQueries({ queryKey: ["workflow-artifacts"] });
  };
  const approve = useMutation({
    mutationFn: () => api.decideApproval(id, "approved"),
    onSuccess: invalidate,
  });
  const revise = useMutation({
    mutationFn: () => api.reviseApproval(id, notes.trim()),
    onSuccess: () => {
      setNotes("");
      setNotesOpen(false);
      invalidate();
    },
  });
  const busy = approve.isPending || revise.isPending;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-1">
        <button
          className="flex items-center gap-1 rounded-md border border-emerald-700/50 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-60"
          onClick={() => approve.mutate()}
          disabled={busy}
        >
          {approve.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Approve
        </button>
        <button
          className="flex items-center gap-1 rounded-md border border-amber-700/50 px-2 py-1 text-xs text-amber-300 hover:bg-amber-950/40 disabled:opacity-60"
          onClick={() => setNotesOpen((v) => !v)}
          disabled={busy}
        >
          Request changes
        </button>
      </div>
      {notesOpen && (
        <div className="w-full max-w-sm space-y-2 rounded-md border border-white/10 bg-white/[0.03] p-2">
          <textarea
            className="input min-h-[72px] text-xs"
            placeholder="Tell the AI what to change — e.g. 'Make the tone darker, drop the voiceover, keep the second logline.'"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <button
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-400 hover:bg-white/[0.04]"
              onClick={() => {
                setNotesOpen(false);
                setNotes("");
              }}
              disabled={revise.isPending}
            >
              Cancel
            </button>
            <button
              className="flex items-center gap-1 rounded-md border border-amber-600/60 bg-amber-950/30 px-2 py-1 text-xs text-amber-200 hover:bg-amber-950/50 disabled:opacity-60"
              onClick={() => revise.mutate()}
              disabled={revise.isPending || notes.trim().length === 0}
            >
              {revise.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              {revise.isPending ? "Regenerating…" : "Send notes & regenerate"}
            </button>
          </div>
          {revise.error && (
            <div className="text-xs text-red-300">
              {(revise.error as Error).message}
            </div>
          )}
        </div>
      )}
      {approve.error && (
        <div className="text-xs text-red-300">{(approve.error as Error).message}</div>
      )}
    </div>
  );
}

function NewWorkflowButton({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("New workflow");
  const [prompt, setPrompt] = useState("");
  const create = useMutation({
    mutationFn: () => api.createWorkflow({ projectId, title, prompt: prompt || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows", projectId] });
      setOpen(false);
      setPrompt("");
    },
  });

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <PlayCircle className="h-4 w-4" />
        New workflow
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input
        className="input sm:w-48"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Workflow title"
      />
      <input
        className="input sm:w-80"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Seed idea (optional)"
      />
      <Button onClick={() => create.mutate()} disabled={!title || create.isPending}>
        {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {create.isPending ? "Starting…" : "Start"}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function WorkflowRow({
  id,
  title,
  current,
  status,
}: {
  id: string;
  title: string;
  current: WorkflowStageId;
  status: string;
}) {
  const idx = WORKFLOW_STAGES.indexOf(current);
  const pct = Math.max(
    4,
    Math.round(((idx + (status === "completed" ? 1 : 0.5)) / WORKFLOW_STAGES.length) * 100)
  );

  // If the next stage will be draft_v1, check that the latest scene_list is
  // marked ready_for_draft. If not, lock the Advance button so we never burn
  // the draft budget on placeholder scenes.
  const artifacts = useQuery({
    queryKey: ["workflow-artifacts", id],
    queryFn: () => api.workflowArtifacts(id),
  });
  const nextStageId =
    idx >= 0 && idx + 1 < WORKFLOW_STAGES.length
      ? status === "completed"
        ? WORKFLOW_STAGES[idx + 1]
        : current
      : null;
  const latestSceneList = (artifacts.data ?? [])
    .filter((a) => a.stage_id === "scene_list")
    .sort((a, b) => b.revision - a.revision)[0];
  const sceneListReady =
    (latestSceneList?.body as { ready_for_draft?: boolean } | undefined)
      ?.ready_for_draft === true;
  const draftLocked = nextStageId === "draft_v1" && !sceneListReady;

  const currentGroup = STAGE_GROUPS.find((g) => g.stages.includes(current));
  const statusBlurb =
    status === "running"
      ? "The AI is working on this step…"
      : status === "awaiting_approval"
      ? "Ready for your review."
      : status === "completed"
      ? "Step complete — ready to move on."
      : status === "approved"
      ? "Approved."
      : "In progress.";

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-bone-50">{title}</div>
          <div className="mt-0.5 text-xs text-bone-400">
            You're on{" "}
            <span className="text-bone-200">
              {currentGroup?.label ?? STAGE_LABELS[current] ?? current}
            </span>
            {currentGroup && currentGroup.stages.length > 1 && (
              <span className="text-bone-400">
                {" "}· {STAGE_LABELS[current] ?? current}
              </span>
            )}{" "}
            — <span className="text-bone-300">{statusBlurb}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draftLocked ? (
            <div className="flex flex-col items-end gap-1">
              <Button variant="outline" disabled>
                <ArrowRight className="h-4 w-4" />
                Finish the scene plan first
              </Button>
              <div className="max-w-xs text-right text-xs text-amber-300">
                Open the Scene Plan below and build it out before writing
                Draft 1.
              </div>
            </div>
          ) : nextStageId === "draft_v1" ? (
            <WriteDraft1Button id={id} />
          ) : (
            <AdvanceButton id={id} />
          )}
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ember-500 to-ember-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <StageJourney current={current} status={status} idx={idx} />
    </div>
  );
}

/**
 * Showrunner-facing roadmap. Renders the 8 STAGE_GROUPS as a vertical stepper.
 * The "Develop Story Foundation" group collapses its 6 engine stages into one
 * step with sub-progress. State is derived from the workflow's current stage
 * index so it always matches the real pipeline.
 */
function StageJourney({
  current,
  status,
  idx,
}: {
  current: WorkflowStageId;
  status: string;
  idx: number;
}) {
  const stageState = (stageId: WorkflowStageId): "done" | "current" | "upcoming" => {
    const i = WORKFLOW_STAGES.indexOf(stageId);
    if (i < idx || (i === idx && status === "completed")) return "done";
    if (i === idx) return "current";
    return "upcoming";
  };
  // Resolve the index of the group containing the CURRENT (non-optional)
  // stage — drives whether optional groups read "current" or "upcoming".
  const currentGroupIndex = (() => {
    for (let g = 0; g < STAGE_GROUPS.length; g++) {
      if (STAGE_GROUPS[g].stages.includes(current)) return g;
    }
    return 0;
  })();
  const { projectId } = useParams<{ projectId: string }>();

  return (
    <ol className="mt-4 space-y-1">
      {STAGE_GROUPS.map((group, gi) => {
        const states = group.stages.map(stageState);
        // Optional groups (Pitch Materials) aren't gated by the orchestrator —
        // they render as a step the writer can take anytime. We show them as
        // "current" while the foundation is in flight, then "done" once the
        // surrounding workflow has moved past their slot.
        const groupState = group.optional
          ? gi <= currentGroupIndex + 1
            ? "current"
            : "upcoming"
          : states.every((s) => s === "done")
          ? "done"
          : states.every((s) => s === "upcoming")
          ? "upcoming"
          : "current";
        const doneCount = states.filter((s) => s === "done").length;
        const multi = group.stages.length > 1;
        const isRunningHere = groupState === "current" && status === "running";

        return (
          <li key={group.id} className="flex gap-3">
            {/* status badge + connector rail */}
            <div className="flex flex-col items-center">
              <span
                className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-full border text-[11px] ${
                  groupState === "done"
                    ? "border-ember-600/60 bg-ember-900/40 text-ember-100"
                    : groupState === "current"
                    ? "border-ember-500 bg-transparent text-ember-200"
                    : "border-white/10 bg-transparent text-bone-600"
                }`}
              >
                {groupState === "done" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : isRunningHere ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  gi + 1
                )}
              </span>
              {gi < STAGE_GROUPS.length - 1 && (
                <span
                  className={`mt-1 w-px flex-1 ${
                    groupState === "done" ? "bg-ember-700/40" : "bg-white/8"
                  }`}
                />
              )}
            </div>

            {/* label + blurb + sub-progress */}
            <div className="pb-3">
              <div className="flex items-baseline gap-2">
                <span
                  className={
                    groupState === "upcoming"
                      ? "text-sm text-bone-500"
                      : "text-sm text-bone-50"
                  }
                >
                  {group.label}
                </span>
                {multi && groupState !== "upcoming" && (
                  <span className="text-xs text-bone-500">
                    {doneCount} of {group.stages.length}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xs text-bone-500">{group.blurb}</div>

              {group.optional && projectId && group.href && (
                <div className="mt-2">
                  <Link to={group.href(projectId)}>
                    <Button variant="outline">
                      {group.ctaLabel ?? "Open"}
                    </Button>
                  </Link>
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-bone-500">
                    Optional · recommended
                  </span>
                </div>
              )}

              {multi && groupState === "current" && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.stages.map((s) => {
                    const st = stageState(s);
                    const cls =
                      st === "done"
                        ? "border-ember-700/50 bg-ember-900/30 text-ember-100"
                        : st === "current"
                        ? "border-ember-600/70 bg-transparent text-ember-200"
                        : "opacity-50";
                    return (
                      <span key={s} className={`chip ${cls}`}>
                        {st === "current" && status === "running" && (
                          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                        )}
                        {STAGE_LABELS[s]}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AdvanceButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const advance = useMutation({
    mutationFn: () => api.advanceWorkflow(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["workflow-artifacts"] });
    },
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="outline"
        onClick={() => advance.mutate()}
        disabled={advance.isPending}
      >
        {advance.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <ArrowRight className="h-4 w-4" />
        )}
        {advance.isPending ? "Running…" : "Continue"}
      </Button>
      {advance.isPending && (
        <div className="w-full max-w-sm">
          <BusyBar
            label="Working on the next step"
            subtext="The writers' room is developing your story. Bigger steps can take a minute or two. The page updates when it's ready."
          />
        </div>
      )}
      {advance.error && (
        <div className="max-w-xs text-right text-xs text-red-300">
          {(advance.error as Error).message}
        </div>
      )}
    </div>
  );
}

function QuickLinks({ projectId }: { projectId: string }) {
  const links = [
    { to: `/projects/${projectId}/writers-room`, label: "Writers Room", Icon: Bot },
    { to: `/projects/${projectId}/character-bible`, label: "Character Bible", Icon: Sparkles },
    { to: `/projects/${projectId}/episodes`, label: "Episodes", Icon: PlayCircle },
    { to: `/projects/${projectId}/drafts`, label: "Drafts", Icon: Hammer },
    { to: `/projects/${projectId}/continuity`, label: "Continuity", Icon: CheckCircle2 },
    { to: `/projects/${projectId}/exports`, label: "Export Center", Icon: ArrowRight },
  ];
  return (
    <Panel eyebrow="Quick links" title="Jump in">
      <ul className="grid grid-cols-2 gap-2">
        {links.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              className="flex items-center gap-2 rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm text-bone-100 transition-colors hover:bg-white/[0.04]"
            >
              <l.Icon className="h-4 w-4 text-ember-400" />
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Project Type — content tier (Prestige Series / Mini Series / Micro Drama).
// Stored at projects.metadata.projectType. Legacy projects without it default
// to prestige_series. Switching tiers only affects downstream behavior from
// that point forward; existing artifacts are untouched.
// ---------------------------------------------------------------------------

function readProjectType(p: unknown): ProjectType {
  const meta = (p as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  const raw = meta?.projectType;
  if (typeof raw === "string" && (PROJECT_TYPES as readonly string[]).includes(raw)) {
    return raw as ProjectType;
  }
  return "prestige_series";
}

function ProjectTypeRow({ projectId, project }: { projectId: string; project: unknown }) {
  const qc = useQueryClient();
  const current = readProjectType(project);
  const [editing, setEditing] = useState(false);
  const setType = useMutation({
    mutationFn: (t: ProjectType) => api.setProjectType(projectId, t),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setEditing(false);
    },
  });
  const chipClass =
    current === "micro_drama"
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : current === "mini_series"
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : "border-white/10 bg-white/[0.04] text-bone-200";

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="label-eyebrow">Project Type</span>
      <span className={"chip " + chipClass}>{PROJECT_TYPE_LABEL[current]}</span>
      {!editing ? (
        <button
          onClick={() => setEditing(true)}
          className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
        >
          Change tier
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {(PROJECT_TYPES as readonly ProjectType[]).map((t) => (
            <button
              key={t}
              disabled={setType.isPending}
              onClick={() => setType.mutate(t)}
              className={
                "rounded border px-2 py-0.5 text-[10px] " +
                (current === t
                  ? "border-ember-700/60 bg-ember-900/30 text-ember-100"
                  : "border-white/10 text-bone-300 hover:bg-white/[0.04]") +
                " disabled:opacity-40"
              }
            >
              {PROJECT_TYPE_LABEL[t]}
            </button>
          ))}
          <button
            onClick={() => setEditing(false)}
            className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-400 hover:bg-white/[0.04]"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Micro Drama Bible — required when projectType === "micro_drama".
// Stored at projects.metadata.microDramaBible. Visible across development.
// ---------------------------------------------------------------------------

function readMicroDramaBible(p: unknown): MicroDramaBibleData {
  const meta = (p as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  return (meta?.microDramaBible as MicroDramaBibleData | undefined) ?? {};
}

interface MicroDramaBibleData {
  hook?: string;
  audienceEmotion?: MicroDramaEmotion;
  episodeLengthSec?: number;
  seasonLength?: number;
  cliffhangerEngine?: string;
  curiosityGap?: string;
}

function MicroDramaBibleSection({ projectId, project }: { projectId: string; project: unknown }) {
  // IMPORTANT: every hook below must run on every render of this component,
  // even when projectType is not micro_drama. The early return that gates
  // rendering MUST stay at the bottom of this block, otherwise React will
  // see a different hook count between the loading render (project=undefined
  // → type defaults to prestige_series → would early-return) and the
  // settled render (type === "micro_drama" → all the useState calls fire),
  // and throw the "change in the order of Hooks called" warning. That
  // mismatch can also double-mount the section and fire the chain-preview
  // mutation twice — which is exactly what shows up in the network panel.
  const qc = useQueryClient();
  const type = readProjectType(project);
  const bible = readMicroDramaBible(project) as MicroDramaBibleData;
  const [hook, setHook] = useState(bible.hook ?? "");
  const [emotion, setEmotion] = useState<MicroDramaEmotion | "">((bible.audienceEmotion as MicroDramaEmotion) ?? "");
  const [epLen, setEpLen] = useState<number | "">(bible.episodeLengthSec ?? "");
  const [seasonLen, setSeasonLen] = useState<number | "">(bible.seasonLength ?? "");
  const [cliff, setCliff] = useState(bible.cliffhangerEngine ?? "");
  const [curiosity, setCuriosity] = useState(bible.curiosityGap ?? "");

  // When the project query first returns `undefined`, our initial useState
  // values are all "". When the query resolves, sync the local form state
  // from the saved bible — but only on the very first time the section
  // sees a populated bible, so we don't trample edits the writer is making.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    if (type !== "micro_drama") return;
    const hasAnyField =
      Boolean(bible.hook) ||
      Boolean(bible.audienceEmotion) ||
      typeof bible.episodeLengthSec === "number" ||
      typeof bible.seasonLength === "number" ||
      Boolean(bible.cliffhangerEngine) ||
      Boolean(bible.curiosityGap);
    if (!hasAnyField) return;
    setHook(bible.hook ?? "");
    setEmotion((bible.audienceEmotion as MicroDramaEmotion) ?? "");
    setEpLen(bible.episodeLengthSec ?? "");
    setSeasonLen(bible.seasonLength ?? "");
    setCliff(bible.cliffhangerEngine ?? "");
    setCuriosity(bible.curiosityGap ?? "");
    setHydrated(true);
  }, [
    hydrated,
    type,
    bible.hook,
    bible.audienceEmotion,
    bible.episodeLengthSec,
    bible.seasonLength,
    bible.cliffhangerEngine,
    bible.curiosityGap,
  ]);

  const save = useMutation({
    mutationFn: () =>
      api.patchMicroDramaBible(projectId, {
        hook: hook.trim() || undefined,
        audienceEmotion: emotion || undefined,
        episodeLengthSec: typeof epLen === "number" ? epLen : undefined,
        seasonLength: typeof seasonLen === "number" ? seasonLen : undefined,
        cliffhangerEngine: cliff.trim() || undefined,
        curiosityGap: curiosity.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  // Gate the visible UI AFTER every hook has been called so the hook count
  // is identical on every render.
  if (type !== "micro_drama") return null;

  return (
    <Panel
      eyebrow="Micro Drama"
      title="Micro Drama Bible"
      description="Concept, audience emotion, episode length, season length, and the cliffhanger engine driving viewer continuation."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="label-eyebrow mb-1 block">Hook (one sentence)</label>
          <textarea
            className="input min-h-[60px]"
            value={hook}
            onChange={(e) => setHook(e.target.value)}
            placeholder="Every morning she wakes up married to a different version of the same man."
          />
        </div>
        <div>
          <label className="label-eyebrow mb-1 block">Audience emotion</label>
          <select
            className="input"
            value={emotion}
            onChange={(e) => setEmotion(e.target.value as MicroDramaEmotion | "")}
          >
            <option value="">Select…</option>
            {(MICRO_DRAMA_EMOTIONS as readonly string[]).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-eyebrow mb-1 block">Episode length</label>
          <select
            className="input"
            value={String(epLen)}
            onChange={(e) => setEpLen(e.target.value ? Number(e.target.value) : "")}
          >
            <option value="">Select…</option>
            {MICRO_DRAMA_EPISODE_LENGTHS_SEC.map((n) => (
              <option key={n} value={n}>
                {n} sec
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label-eyebrow mb-1 block">
            Season length (episodes)
          </label>
          <input
            className="input"
            type="number"
            inputMode="numeric"
            min={MICRO_DRAMA_SEASON_LENGTH_MIN}
            max={MICRO_DRAMA_SEASON_LENGTH_MAX}
            step={1}
            value={seasonLen === "" ? "" : seasonLen}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") {
                setSeasonLen("");
                return;
              }
              const n = Number(v);
              if (Number.isFinite(n)) {
                // Clamp to the same bounds the backend enforces.
                const clamped = Math.max(
                  MICRO_DRAMA_SEASON_LENGTH_MIN,
                  Math.min(MICRO_DRAMA_SEASON_LENGTH_MAX, Math.trunc(n))
                );
                setSeasonLen(clamped);
              }
            }}
            placeholder={`Any integer from ${MICRO_DRAMA_SEASON_LENGTH_MIN}–${MICRO_DRAMA_SEASON_LENGTH_MAX}`}
          />
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-bone-500">Quick:</span>
            {MICRO_DRAMA_SEASON_LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSeasonLen(n)}
                className={
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors " +
                  (seasonLen === n
                    ? "border-ember-700/60 bg-ember-900/30 text-ember-100"
                    : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
                }
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label-eyebrow mb-1 block">Estimated runtime</label>
          <div className="input flex items-center bg-white/[0.02] text-bone-400">
            {typeof epLen === "number" && typeof seasonLen === "number"
              ? `~${Math.round((epLen * seasonLen) / 60)} minutes total · ${epLen}s × ${seasonLen} eps`
              : "—"}
          </div>
        </div>
        <div className="md:col-span-2">
          <label className="label-eyebrow mb-1 block">
            Cliffhanger engine — what unresolved question forces the viewer to watch the next episode?
          </label>
          <textarea
            className="input min-h-[60px]"
            value={cliff}
            onChange={(e) => setCliff(e.target.value)}
            placeholder="Who is posting from the missing girl's account?"
          />
        </div>
        <div className="md:col-span-2">
          <label className="label-eyebrow mb-1 block">
            Curiosity gap — what information is intentionally withheld from the audience?
          </label>
          <textarea
            className="input min-h-[60px]"
            value={curiosity}
            onChange={(e) => setCuriosity(e.target.value)}
            placeholder="The audience never sees the husband's face until episode 7."
          />
          <div className="mt-1 text-[10px] text-bone-500">
            Visible across the entire micro-drama workflow. Feeds into every episode's Binge Momentum Score.
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {save.error && (
          <span className="text-xs text-red-300">{(save.error as Error).message}</span>
        )}
        {save.isSuccess && !save.isPending && (
          <span className="text-xs text-emerald-300">Saved.</span>
        )}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save Micro Drama Bible"}
        </Button>
      </div>

      <EpisodeChainGenerator
        projectId={projectId}
        seasonLength={typeof bible.seasonLength === "number" ? bible.seasonLength : 0}
        projectCuriosityGap={bible.curiosityGap ?? ""}
        canGenerate={Boolean(
          (bible.hook ?? "").trim() &&
            (bible.cliffhangerEngine ?? "").trim() &&
            typeof bible.seasonLength === "number" &&
            bible.seasonLength > 0
        )}
        // True when the local form has edits the writer hasn't saved yet —
        // the backend reads the SAVED bible, so generating with dirty edits
        // would silently send the prior values. Block until they save.
        dirty={
          hook !== (bible.hook ?? "") ||
          (emotion || undefined) !== bible.audienceEmotion ||
          (epLen || undefined) !== bible.episodeLengthSec ||
          (seasonLen || undefined) !== bible.seasonLength ||
          cliff !== (bible.cliffhangerEngine ?? "") ||
          curiosity !== (bible.curiosityGap ?? "")
        }
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Episode Chain Generator — preview-first, Accept All persists.
// ---------------------------------------------------------------------------
//
// PLANNING LAYER ONLY. The button generates a chain of HOOK / SETUP / TWIST /
// CLIFFHANGER planning rows from the Micro Drama Bible. Until the writer
// clicks "Accept All", nothing is persisted. Accept All writes per-episode
// planning into episodes.metadata.microDrama and creates EP rows up to
// seasonLength if any are missing.
//
// No drafts, scripts, shot briefs, prompts, or production data are ever
// touched. Tier-guarded to micro_drama by the backend.
type ChainPlan = {
  episodeNumber: number;
  title: string;
  hook: string;
  setup: string;
  twist: string;
  cliffhanger: string;
  revealedToAudience: string;
  withheldFromAudience: string;
  falseAssumptionReinforcedOrBroken: string;
};
type ChainEntry = {
  plan: ChainPlan;
  binge: {
    total: number;
    components: {
      hookStrength: number;
      curiosityGap: number;
      twistStrength: number;
      cliffhangerStrength: number;
    };
    notes: string[];
  };
  viral: {
    passes: boolean;
    verdict: "yes" | "no" | "weak";
    recommendation: string;
  };
};

function EpisodeChainGenerator({
  projectId,
  seasonLength,
  projectCuriosityGap,
  canGenerate,
  dirty,
}: {
  projectId: string;
  seasonLength: number;
  projectCuriosityGap: string;
  canGenerate: boolean;
  dirty: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [preview, setPreview] = useState<{
    entries: ChainEntry[];
    averageBinge: number;
    originalAverageBinge: number;
    failingEpisodes: number[];
    weakMiddle: number[];
    revisionTrail: Array<{
      pass: number;
      averageBinge: number;
      reason: string;
      mode: "full" | "weak";
      targetedEpisodes: number[];
    }>;
    cohesion: MicroDramaCohesion;
    originalCohesion: MicroDramaCohesion;
  } | null>(null);

  const generate = useMutation({
    mutationFn: () => api.previewEpisodeChain(projectId),
    onSuccess: (data) => {
      setPreview(data);
      setOpen(true);
    },
  });

  const accept = useMutation({
    mutationFn: (entries: ChainEntry[]) =>
      api.acceptEpisodeChain(
        projectId,
        entries.map((e) => e.plan)
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["episodes", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      // The Season Retention Map reads viral tests per episode; invalidate
      // every cached `episode-viral` so the map repopulates immediately.
      qc.invalidateQueries({ queryKey: ["episode-viral"] });
      setOpen(false);
      setPreview(null);
    },
  });

  return (
    <div className="mt-4 rounded-md border border-amber-700/30 bg-amber-900/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="label-eyebrow text-amber-300">Episode Chain</div>
          <div className="mt-1 text-sm text-bone-200">
            Turn the bible into a full HOOK / SETUP / TWIST / CLIFFHANGER plan
            across the season.
          </div>
          <div className="mt-1 text-[11px] text-bone-400">
            Planning only — no screenplay, scenes, dialogue, or shot briefs.
            Preview first; nothing persists until you click Accept All.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setPasteOpen(true)}
            disabled={!canGenerate || dirty}
          >
            Paste Episode Chain
          </Button>
          <Button
            onClick={() => generate.mutate()}
            disabled={!canGenerate || dirty || generate.isPending}
          >
            {generate.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {generate.isPending ? "Generating…" : "Generate Episode Chain"}
          </Button>
        </div>
      </div>
      {dirty && canGenerate && (
        <div className="mt-2 text-[11px] text-amber-200">
          Save the bible above before generating — the generator reads the
          saved bible, not your in-progress edits.
        </div>
      )}
      {!canGenerate && (
        <div className="mt-2 text-[11px] text-amber-200">
          Fill in Hook, Cliffhanger Engine, and Season length above, then
          click Save Micro Drama Bible.
        </div>
      )}
      {generate.isPending && (
        <div className="mt-2 text-[11px] text-bone-400">
          The Story Engine runs up to 3 self-revision passes to lift average
          binge score ≥ 70. This can take 1–3 minutes for larger seasons —
          don't refresh.
        </div>
      )}
      {generate.error && (
        <div className="mt-2 rounded-sm border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
          <div className="font-medium">Episode Chain generation failed.</div>
          <div className="mt-0.5 text-bone-300">
            {(generate.error as Error).message}
          </div>
          <div className="mt-1 text-[10px] text-bone-400">
            If the server was just restarted or you edited backend files
            during generation, try again now.
          </div>
        </div>
      )}

      {open && preview && (
        <EpisodeChainPreviewDialog
          preview={preview}
          onCancel={() => {
            setOpen(false);
            setPreview(null);
          }}
          onAcceptAll={() => accept.mutate(preview.entries)}
          accepting={accept.isPending}
          acceptError={(accept.error as Error | undefined)?.message}
        />
      )}

      {pasteOpen && (
        <PasteEpisodeChainDialog
          projectId={projectId}
          seasonLength={seasonLength}
          projectCuriosityGap={projectCuriosityGap}
          onClose={() => setPasteOpen(false)}
        />
      )}
    </div>
  );
}

function EpisodeChainPreviewDialog({
  preview,
  onCancel,
  onAcceptAll,
  accepting,
  acceptError,
}: {
  preview: {
    entries: ChainEntry[];
    averageBinge: number;
    originalAverageBinge: number;
    failingEpisodes: number[];
    weakMiddle: number[];
    revisionTrail: Array<{
      pass: number;
      averageBinge: number;
      reason: string;
      mode: "full" | "weak";
      targetedEpisodes: number[];
    }>;
    cohesion: MicroDramaCohesion;
    originalCohesion: MicroDramaCohesion;
  };
  onCancel: () => void;
  onAcceptAll: () => void;
  accepting: boolean;
  acceptError?: string;
}) {
  const {
    entries,
    averageBinge,
    originalAverageBinge,
    failingEpisodes,
    weakMiddle,
    revisionTrail,
    cohesion,
    originalCohesion,
  } = preview;
  const revised = revisionTrail.length > 0;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="panel-strong flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-white/8 p-5">
          <h2 className="font-serif text-xl text-bone-50">
            Episode Chain — Preview
          </h2>
          <p className="mt-1 text-xs text-bone-400">
            Planning only. Nothing persists until you click Accept All.
            Existing screenplays, drafts, scenes, and shot briefs are not
            modified.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            {revised ? (
              <>
                <span className="chip border-white/12 bg-white/[0.02] text-bone-400">
                  Original {originalAverageBinge}/100
                </span>
                <span className="text-bone-500">→</span>
                <ChainAvgChip avg={averageBinge} label="Revised" />
              </>
            ) : (
              <ChainAvgChip avg={averageBinge} />
            )}
            {failingEpisodes.length > 0 && (
              <span className="chip border-red-800/50 bg-red-950/30 text-red-200">
                <AlertTriangle className="h-3 w-3" />
                {failingEpisodes.length} would lose viewers · EP
                {failingEpisodes.map((n) => String(n).padStart(2, "0")).join(", EP")}
              </span>
            )}
            {weakMiddle.length > 0 && (
              <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
                Weak middle · EP
                {weakMiddle.map((n) => String(n).padStart(2, "0")).join(", EP")}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="label-eyebrow text-bone-500">Cohesion</span>
            {revised ? (
              <>
                <span className="chip border-white/12 bg-white/[0.02] text-bone-400">
                  Original {originalCohesion.cohesionScore}/100
                </span>
                <span className="text-bone-500">→</span>
                <CohesionScoreChip cohesion={cohesion} />
              </>
            ) : (
              <CohesionScoreChip cohesion={cohesion} />
            )}
            <span className="chip border-white/10 text-bone-300">
              Promise retention {cohesion.promiseRetentionPct}%
            </span>
            <span
              className={`chip ${
                cohesion.mysterySystemsCount <= 3
                  ? "border-white/10 text-bone-300"
                  : "border-red-800/50 bg-red-950/30 text-red-200"
              }`}
            >
              Mystery systems {cohesion.mysterySystemsCount}/3
            </span>
            <span className="chip border-white/10 text-bone-300">
              Layers {cohesion.mysteryLayerCount} · reveals{" "}
              {cohesion.characterRevealCount}
            </span>
          </div>

          {cohesion.forbiddenTropeHits.length > 0 && (
            <ForbiddenTropeBanner hits={cohesion.forbiddenTropeHits} />
          )}

          {revised && (
            <RevisionTrail
              trail={revisionTrail}
              originalAverageBinge={originalAverageBinge}
            />
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <ul className="space-y-3">
            {entries.map((entry) => (
              <ChainPreviewRow key={entry.plan.episodeNumber} entry={entry} />
            ))}
          </ul>
        </div>

        <footer className="border-t border-white/8 p-4">
          {acceptError && (
            <div className="mb-2 text-xs text-red-300">{acceptError}</div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={accepting}>
              Cancel
            </Button>
            <Button onClick={onAcceptAll} disabled={accepting}>
              {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Accept All
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ChainPreviewRow({ entry }: { entry: ChainEntry }) {
  const { plan, binge, viral } = entry;
  const total = binge.total;
  const bingeCls =
    total >= 65
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : total >= 50
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : "border-red-800/50 bg-red-950/30 text-red-200";
  const viralCls =
    viral.verdict === "yes"
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : viral.verdict === "weak"
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : "border-red-800/50 bg-red-950/30 text-red-200";
  return (
    <li className="rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs text-ember-300">
            EP {String(plan.episodeNumber).padStart(2, "0")}
          </span>
          <span className="font-serif text-bone-100">{plan.title}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`chip ${bingeCls}`}>Binge {total}/100</span>
          <span className={`chip ${viralCls}`}>Viral: {viral.verdict}</span>
        </div>
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
        <ChainCell label="HOOK" value={plan.hook} />
        <ChainCell label="SETUP" value={plan.setup} />
        <ChainCell label="TWIST" value={plan.twist} />
        <ChainCell label="CLIFFHANGER" value={plan.cliffhanger} />
        <ChainCell
          label="REVEALED TO AUDIENCE"
          value={plan.revealedToAudience}
        />
        <ChainCell
          label="WITHHELD"
          value={plan.withheldFromAudience}
        />
        <ChainCell
          label="FALSE ASSUMPTION"
          value={plan.falseAssumptionReinforcedOrBroken}
          colSpan={2}
        />
      </dl>

      {viral.recommendation && viral.verdict !== "yes" && (
        <div className="mt-2 flex items-start gap-2 rounded-sm border border-amber-700/40 bg-amber-900/10 px-2 py-1 text-[11px] text-amber-200">
          <AlertTriangle className="h-3 w-3 flex-none translate-y-[2px]" />
          <span>{viral.recommendation}</span>
        </div>
      )}
    </li>
  );
}

function ChainCell({
  label,
  value,
  colSpan = 1,
}: {
  label: string;
  value: string;
  colSpan?: 1 | 2;
}) {
  return (
    <div className={colSpan === 2 ? "md:col-span-2" : undefined}>
      <dt className="label-eyebrow text-bone-500">{label}</dt>
      <dd className="text-bone-200">{value || <span className="text-bone-500">—</span>}</dd>
    </div>
  );
}

function CohesionScoreChip({ cohesion }: { cohesion: MicroDramaCohesion }) {
  const score = cohesion.cohesionScore;
  // Cohesion gate is ≥70. We also flag amber when the gate passes by score
  // alone but the chain fails on any of the structural sub-checks.
  const gateFailed = !cohesion.passes;
  const cls = gateFailed
    ? "border-red-800/50 bg-red-950/30 text-red-200"
    : score >= 70
    ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
    : "border-amber-700/40 bg-amber-900/20 text-amber-200";
  return <span className={`chip ${cls}`}>Cohesion {score}/100</span>;
}

function ForbiddenTropeBanner({
  hits,
}: {
  hits: MicroDramaCohesion["forbiddenTropeHits"];
}) {
  return (
    <div className="mt-2 rounded-md border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-100">
      <div className="flex items-center gap-1 font-medium text-red-200">
        <AlertTriangle className="h-3.5 w-3.5" />
        Forbidden tropes detected — the engine attempted to remove these, but
        any that remain need a writer rewrite.
      </div>
      <ul className="mt-1 space-y-1">
        {hits.map((h) => (
          <li key={h.id} className="text-red-100">
            <div>
              <span className="font-medium">{h.label}</span>
              <span className="ml-1 font-mono text-[10px] text-red-200">
                · EP
                {h.episodes
                  .map((n) => String(n).padStart(2, "0"))
                  .join(", EP")}
              </span>
            </div>
            {h.matches.length > 0 && (
              <div className="pl-2 text-[10px] text-red-200/80">
                {h.matches.map((m) => (
                  <div key={`${h.id}-${m.episodeNumber}`}>
                    EP{String(m.episodeNumber).padStart(2, "0")} triggered by:{" "}
                    <span className="font-mono text-red-100">"{m.matched}"</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChainAvgChip({ avg, label }: { avg: number; label?: string }) {
  const cls =
    avg >= 70
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : avg >= 65
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : "border-red-800/50 bg-red-950/30 text-red-200";
  return (
    <span className={`chip ${cls}`}>
      {label ?? "Avg binge"}: {avg}/100
    </span>
  );
}

// RevisionTrail — surfaces each automatic revision pass the engine ran so
// the writer can SEE why the chain was rewritten and how much it improved.
// Driven by the planning-layer self-revision loop (up to 3 passes).
function RevisionTrail({
  trail,
  originalAverageBinge,
}: {
  trail: Array<{
    pass: number;
    averageBinge: number;
    reason: string;
    mode: "full" | "weak";
    targetedEpisodes: number[];
  }>;
  originalAverageBinge: number;
}) {
  return (
    <div className="mt-3 rounded-md border border-amber-700/30 bg-amber-900/10 p-2 text-[11px]">
      <div className="label-eyebrow mb-1 text-amber-200">
        Revision trail · auto-revised {trail.length}× to lift retention
      </div>
      <ol className="space-y-1">
        <li className="text-bone-400">
          Pass 0 · initial generation → avg {originalAverageBinge}/100
        </li>
        {trail.map((t) => {
          const direction =
            t.averageBinge > originalAverageBinge ? "↑" : "→";
          return (
            <li key={t.pass} className="text-bone-300">
              Pass {t.pass} ·{" "}
              <span className="text-bone-500">
                {t.mode === "weak"
                  ? `targeted rewrite (EP${t.targetedEpisodes
                      .map((n) => String(n).padStart(2, "0"))
                      .join(", EP")})`
                  : "full regenerate"}
              </span>{" "}
              {direction} avg {t.averageBinge}/100
              <div className="pl-2 text-[10px] text-bone-400">{t.reason}</div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste Episode Chain — manual chain import
// ---------------------------------------------------------------------------
//
// Writer-authored chains land here. The parser accepts the same plain-text
// format we use in chat — markdown-tolerant, label-alias-tolerant — and
// persists into the IDENTICAL data structure as Generate Episode Chain →
// Accept All (episodes.metadata.microDrama via the existing acceptEpisodeChain
// endpoint). No new storage format. No backend change. The per-episode Binge
// + Viral chips and the Season Retention Map pick up the new episodes
// automatically because they read the same metadata.

interface PastedPlan {
  episodeNumber: number;
  title: string;
  hook: string;
  setup: string;
  twist: string;
  cliffhanger: string;
  revealedToAudience: string;
  withheldFromAudience: string;
  falseAssumptionReinforcedOrBroken: string;
  /** Captured if the paste included a CURIOSITY GAP line — used to offer a
   *  project-bible curiosityGap update, not stored per-episode. */
  curiosityGap?: string;
}

interface ParseResult {
  plans: PastedPlan[];
  errors: string[];
  warnings: string[];
}

const FIELD_ALIASES: Array<{ key: keyof PastedPlan | "ignore"; labels: string[] }> = [
  { key: "hook", labels: ["hook"] },
  { key: "setup", labels: ["setup"] },
  { key: "twist", labels: ["twist"] },
  { key: "cliffhanger", labels: ["cliffhanger"] },
  { key: "revealedToAudience", labels: ["revealed to audience", "revealed"] },
  {
    key: "withheldFromAudience",
    labels: ["withheld from audience", "withheld"],
  },
  {
    key: "falseAssumptionReinforcedOrBroken",
    labels: [
      "false assumption reinforced or broken",
      "false assumption broken",
      "false assumption",
    ],
  },
  { key: "curiosityGap", labels: ["curiosity gap"] },
  // Commentary fields we silently skip so they don't bleed into other values.
  { key: "ignore", labels: ["why this should score higher", "anchors", "binge target", "edit notes"] },
];

const stripMarkdown = (s: string): string =>
  s
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/^>\s?/gm, "");

const findEpisodeStart = (line: string): { number: number; title: string } | null => {
  // EP 01 — "Title"  /  EP01 - Title  /  ## EP 1: Title  /  EP 1
  const m = line.match(/^EP\s*(\d{1,3})\s*(?:[—–\-:]\s*)?(?:"([^"]+)"|'([^']+)'|(.+))?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const title = (m[2] ?? m[3] ?? m[4] ?? "").trim().replace(/^[—–\-:\s]+/, "");
  return { number: n, title };
};

const matchFieldLabel = (
  rawLine: string
): { key: keyof PastedPlan | "ignore"; value: string } | null => {
  const line = rawLine.replace(/^[-•·\s]+/, "").trim();
  const colonIdx = line.indexOf(":");
  if (colonIdx <= 0) return null;
  const labelText = line.slice(0, colonIdx).toLowerCase().trim();
  const value = line.slice(colonIdx + 1).trim();
  for (const def of FIELD_ALIASES) {
    if (def.labels.includes(labelText)) {
      return { key: def.key, value };
    }
  }
  return null;
};

function parseChainText(raw: string): ParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stripped = stripMarkdown(raw);
  const lines = stripped.split(/\r?\n/);

  type WorkingPlan = Partial<PastedPlan> & { episodeNumber: number; title: string };
  const plans: WorkingPlan[] = [];
  let current: WorkingPlan | null = null;
  let currentField: keyof PastedPlan | "ignore" | null = null;

  const commitField = (key: keyof PastedPlan | "ignore", value: string) => {
    if (!current) return;
    if (key === "ignore") return;
    const prev = (current[key] as string | undefined) ?? "";
    (current as Record<string, string>)[key] =
      prev ? `${prev} ${value}`.replace(/\s+/g, " ").trim() : value;
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      currentField = null;
      continue;
    }
    const epStart = findEpisodeStart(trimmed);
    if (epStart) {
      if (current) plans.push(current);
      current = {
        episodeNumber: epStart.number,
        title: epStart.title || `EP${String(epStart.number).padStart(2, "0")}`,
      };
      currentField = null;
      continue;
    }
    if (!current) continue;
    const labeled = matchFieldLabel(trimmed);
    if (labeled) {
      currentField = labeled.key;
      if (labeled.value) commitField(labeled.key, labeled.value);
      continue;
    }
    if (currentField) commitField(currentField, trimmed);
  }
  if (current) plans.push(current);

  const finalised: PastedPlan[] = plans
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((p) => ({
      episodeNumber: p.episodeNumber,
      title: p.title || `EP${String(p.episodeNumber).padStart(2, "0")}`,
      hook: p.hook ?? "",
      setup: p.setup ?? "",
      twist: p.twist ?? "",
      cliffhanger: p.cliffhanger ?? "",
      revealedToAudience: p.revealedToAudience ?? "",
      withheldFromAudience: p.withheldFromAudience ?? "",
      falseAssumptionReinforcedOrBroken: p.falseAssumptionReinforcedOrBroken ?? "",
      curiosityGap: p.curiosityGap,
    }));

  if (finalised.length === 0) {
    errors.push(
      "No episodes detected. Each episode must start with a line like: EP 01 — \"Title\"."
    );
  }
  const seen = new Set<number>();
  for (const p of finalised) {
    if (seen.has(p.episodeNumber)) {
      errors.push(`Duplicate episode number: EP${String(p.episodeNumber).padStart(2, "0")}.`);
    }
    seen.add(p.episodeNumber);
  }

  return { plans: finalised, errors, warnings };
}

function validatePlans(
  plans: PastedPlan[],
  seasonLength: number,
  projectCuriosityGap: string
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (seasonLength > 0 && plans.length !== seasonLength) {
    errors.push(
      `This project's season length is ${seasonLength} episodes, but the paste has ${plans.length}. Update the bible's season length or fix the paste.`
    );
  }
  for (const p of plans) {
    const tag = `EP${String(p.episodeNumber).padStart(2, "0")}`;
    if (!p.hook.trim()) errors.push(`${tag}: HOOK is empty.`);
    if (!p.setup.trim()) errors.push(`${tag}: SETUP is empty.`);
    if (!p.twist.trim()) errors.push(`${tag}: TWIST is empty.`);
    if (!p.cliffhanger.trim()) errors.push(`${tag}: CLIFFHANGER is empty.`);
    if (!p.revealedToAudience.trim())
      warnings.push(`${tag}: REVEALED TO AUDIENCE is empty (allowed but recommended).`);
    if (!p.withheldFromAudience.trim())
      warnings.push(`${tag}: WITHHELD is empty (allowed but recommended).`);
    if (!p.falseAssumptionReinforcedOrBroken.trim())
      warnings.push(`${tag}: FALSE ASSUMPTION BROKEN is empty (allowed but recommended).`);
  }
  if (!projectCuriosityGap.trim()) {
    const anyGapInPaste = plans.some((p) => (p.curiosityGap ?? "").trim().length > 0);
    if (anyGapInPaste) {
      warnings.push(
        "The paste includes CURIOSITY GAP lines but the project bible's curiosityGap is empty. Save will lift the first non-empty paste value onto the bible."
      );
    } else {
      warnings.push(
        "Project curiosityGap is empty — every episode loses 12 Binge points to this field. Set it on the bible card before saving."
      );
    }
  }
  return { errors, warnings };
}

function PasteEpisodeChainDialog({
  projectId,
  seasonLength,
  projectCuriosityGap,
  onClose,
}: {
  projectId: string;
  seasonLength: number;
  projectCuriosityGap: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [raw, setRaw] = useState("");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [validation, setValidation] = useState<
    { errors: string[]; warnings: string[] } | null
  >(null);

  const parse = () => {
    const result = parseChainText(raw);
    setParsed(result);
    if (result.plans.length > 0) {
      setValidation(validatePlans(result.plans, seasonLength, projectCuriosityGap));
    } else {
      setValidation({ errors: result.errors, warnings: result.warnings });
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error("Nothing to save — click Parse Preview first.");
      // Optionally lift the first per-episode CURIOSITY GAP onto the project
      // bible if the bible's gap is currently empty. Only side effect on the
      // bible — fields untouched if the project gap already exists or no
      // episode supplied one.
      if (!projectCuriosityGap.trim()) {
        const firstGap = parsed.plans
          .map((p) => (p.curiosityGap ?? "").trim())
          .find((v) => v.length > 0);
        if (firstGap) {
          await api.patchMicroDramaBible(projectId, { curiosityGap: firstGap });
        }
      }
      const planPayload = parsed.plans.map((p) => ({
        episodeNumber: p.episodeNumber,
        title: p.title,
        hook: p.hook,
        setup: p.setup,
        twist: p.twist,
        cliffhanger: p.cliffhanger,
        revealedToAudience: p.revealedToAudience,
        withheldFromAudience: p.withheldFromAudience,
        falseAssumptionReinforcedOrBroken: p.falseAssumptionReinforcedOrBroken,
      }));
      return api.acceptEpisodeChain(projectId, planPayload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["episodes", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["episode-viral"] });
      onClose();
    },
  });

  const canSave =
    parsed !== null &&
    parsed.plans.length > 0 &&
    (validation?.errors.length ?? 1) === 0 &&
    !save.isPending;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel-strong flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-white/8 p-5">
          <h2 className="font-serif text-xl text-bone-50">Paste Episode Chain</h2>
          <p className="mt-1 text-xs text-bone-400">
            Paste a writer-authored chain in the standard format
            (EP 01 — "Title" then HOOK / SETUP / TWIST / CLIFFHANGER / REVEALED /
            WITHHELD / FALSE ASSUMPTION BROKEN / CURIOSITY GAP). Saves into the
            same place as Generate Episode Chain → Accept All. No LLM call.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {!parsed ? (
            <div className="space-y-2">
              <label className="label-eyebrow block">Chain text</label>
              <textarea
                className="input min-h-[420px] font-mono text-xs"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={
                  "EP 01 — \"3:17 AM\"\nHOOK: …\nSETUP: …\nTWIST: …\nCLIFFHANGER: …\nREVEALED: …\nWITHHELD: …\nFALSE ASSUMPTION BROKEN: …\n\nEP 02 — \"…\"\n…"
                }
              />
              <div className="text-[10px] text-bone-500">
                Markdown formatting (bold, italics, headings, bullets) is
                ignored. "REVEALED TO AUDIENCE" and "REVEALED" are equivalent.
                "FALSE ASSUMPTION" and "FALSE ASSUMPTION BROKEN" are equivalent.
              </div>
            </div>
          ) : (
            <PasteEpisodeChainPreview
              parsed={parsed}
              validation={validation}
              onEdit={() => {
                setParsed(null);
                setValidation(null);
              }}
            />
          )}
        </div>

        <footer className="border-t border-white/8 p-4">
          {save.error && (
            <div className="mb-2 rounded-sm border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
              {(save.error as Error).message}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            {!parsed ? (
              <Button onClick={parse} disabled={!raw.trim()}>
                Parse Preview
              </Button>
            ) : (
              <Button onClick={() => save.mutate()} disabled={!canSave}>
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save / Import
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function PasteEpisodeChainPreview({
  parsed,
  validation,
  onEdit,
}: {
  parsed: ParseResult;
  validation: { errors: string[]; warnings: string[] } | null;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm text-bone-200">
          Parsed <strong>{parsed.plans.length}</strong> episode
          {parsed.plans.length === 1 ? "" : "s"}.
        </div>
        <Button variant="ghost" onClick={onEdit}>
          Edit paste
        </Button>
      </div>
      {validation?.errors && validation.errors.length > 0 && (
        <div className="rounded-md border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-200">
          <div className="font-medium text-red-100">
            Errors — must fix before saving:
          </div>
          <ul className="mt-1 list-disc pl-5">
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {validation?.warnings && validation.warnings.length > 0 && (
        <div className="rounded-md border border-amber-700/40 bg-amber-900/15 p-2 text-xs text-amber-200">
          <div className="font-medium">Warnings (optional to fix):</div>
          <ul className="mt-1 list-disc pl-5">
            {validation.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="space-y-3">
        {parsed.plans.map((p) => (
          <li
            key={p.episodeNumber}
            className="rounded-md border border-white/8 bg-white/[0.02] p-3"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-ember-300">
                EP {String(p.episodeNumber).padStart(2, "0")}
              </span>
              <span className="font-serif text-bone-100">{p.title}</span>
            </div>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
              <PreviewCell label="HOOK" value={p.hook} />
              <PreviewCell label="SETUP" value={p.setup} />
              <PreviewCell label="TWIST" value={p.twist} />
              <PreviewCell label="CLIFFHANGER" value={p.cliffhanger} />
              <PreviewCell label="REVEALED" value={p.revealedToAudience} />
              <PreviewCell label="WITHHELD" value={p.withheldFromAudience} />
              <PreviewCell
                label="FALSE ASSUMPTION BROKEN"
                value={p.falseAssumptionReinforcedOrBroken}
                colSpan={2}
              />
              {p.curiosityGap && p.curiosityGap.trim() && (
                <PreviewCell
                  label="CURIOSITY GAP"
                  value={p.curiosityGap}
                  colSpan={2}
                />
              )}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviewCell({
  label,
  value,
  colSpan = 1,
}: {
  label: string;
  value: string;
  colSpan?: 1 | 2;
}) {
  return (
    <div className={colSpan === 2 ? "md:col-span-2" : undefined}>
      <dt className="label-eyebrow text-bone-500">{label}</dt>
      <dd className="text-bone-200">
        {value || <span className="text-bone-500">—</span>}
      </dd>
    </div>
  );
}
