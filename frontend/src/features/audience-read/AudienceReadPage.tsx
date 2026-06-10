import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  Gauge,
  Loader2,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type {
  AudienceReadDimension,
  AudienceReadReport,
  AudienceReadResponse,
  AudienceVerdict,
  AudienceSceneBeat,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { ApprovalBoard } from "./ApprovalBoard";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

const VERDICT_STYLE: Record<AudienceVerdict, { chip: string; label: string }> = {
  strong: { chip: "border-emerald-700/40 bg-emerald-900/20 text-emerald-100", label: "Strong" },
  solid: { chip: "border-sky-700/40 bg-sky-900/20 text-sky-100", label: "Solid" },
  at_risk: { chip: "border-amber-700/45 bg-amber-900/20 text-amber-100", label: "At risk" },
};

export function AudienceReadPage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  if (!projectId || !episodeId) return null;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["audience-read", projectId, episodeId],
    queryFn: () => api.getAudienceRead(projectId, episodeId),
  });
  const seed = (r: AudienceReadResponse) =>
    qc.setQueryData(["audience-read", projectId, episodeId], r);
  const generate = useMutation({
    mutationFn: () => api.generateAudienceRead(projectId, episodeId),
    onSuccess: seed,
  });
  const approve = useMutation({
    mutationFn: () => api.approveAudienceRead(projectId, episodeId),
    onSuccess: seed,
  });

  const data = q.data;
  const report = data?.report ?? null;
  const source = data?.source;
  const busy = generate.isPending || approve.isPending;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Production · Audience Read"
        title="Bingeability & emotional read"
        description="Reads the final draft as a first-time bingeing viewer, scored against a rubric distilled from real reviews of comparable shows. Read-only — it never changes the draft."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/episodes`}>
              <Button variant="outline">
                <ChevronLeft className="h-4 w-4" /> Episodes
              </Button>
            </Link>
            <Button onClick={() => generate.mutate()} disabled={busy || !source?.scriptId}>
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {report ? "Re-read draft" : "Read the draft"}
            </Button>
          </div>
        }
      />

      <div className="space-y-6 px-8">
        {/* Source / provenance */}
        {source && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-white/8 bg-white/[0.02] px-3 py-2 text-[12px] text-bone-300">
            <span>
              Source:{" "}
              <span className="text-bone-100">{source.draftLabel ?? "(no draft yet)"}</span>
              {source.isLocked ? <span className="ml-1 text-amber-200">· locked</span> : null}
            </span>
            <span className="text-bone-400">{source.sceneCount} scenes</span>
            {report && (
              <span className="text-bone-500">
                Read {new Date(report.generatedAt).toLocaleString()}
                {report.sourceFountainHash ? ` · draft ${report.sourceFountainHash}` : ""}
              </span>
            )}
          </div>
        )}

        {q.isLoading && <div className="text-bone-300">Loading…</div>}

        {!q.isLoading && !report && (
          <EmptyState
            hasDraft={!!source?.scriptId}
            busy={generate.isPending}
            onGenerate={() => generate.mutate()}
          />
        )}

        {generate.isError && (
          <div className="rounded-md border border-red-700/40 bg-red-950/30 p-3 text-[12.5px] text-red-200">
            {(generate.error as Error).message}
          </div>
        )}

        {report && (
          <ReportView
            report={report}
            comps={data?.rubric.comps ?? []}
            sources={data?.rubric.sources ?? []}
            onApprove={() => approve.mutate()}
            approving={approve.isPending}
          />
        )}

        {/* Standing approval layer between the read and any rewrite. */}
        <ApprovalBoard projectId={projectId} episodeId={episodeId} hasReport={!!report} />
      </div>
    </div>
  );
}

function EmptyState({
  hasDraft,
  busy,
  onGenerate,
}: {
  hasDraft: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6">
      <h3 className="font-serif text-lg text-bone-50">No audience read yet</h3>
      <p className="mt-1 max-w-2xl text-[12.5px] text-bone-300">
        Run the read on this episode's current draft. An AI reads the whole script as a first-time
        bingeing viewer and scores it against a rubric built from real reviews of comparable
        shows — where it grips, where it risks dragging, hook strength, the episode-end pull, and
        an honest bingeability verdict with scene-anchored notes. It never edits the draft.
      </p>
      <div className="mt-4">
        <Button onClick={onGenerate} disabled={!hasDraft || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {hasDraft ? "Read the draft" : "No draft to read yet"}
        </Button>
      </div>
    </div>
  );
}

function ReportView({
  report,
  comps,
  sources,
  onApprove,
  approving,
}: {
  report: AudienceReadReport;
  comps: string[];
  sources: string[];
  onApprove: () => void;
  approving: boolean;
}) {
  const score = report.bingeScore;
  const scoreColor =
    score >= 75 ? "text-emerald-300" : score >= 55 ? "text-sky-300" : "text-amber-300";
  return (
    <div className="space-y-6">
      {/* Verdict header */}
      <Panel eyebrow="Verdict" title="Would an audience binge this?">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex flex-col items-center">
            <div className={`flex items-center gap-1 font-serif text-4xl ${scoreColor}`}>
              <Gauge className="h-6 w-6" />
              {score}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-bone-500">binge score</div>
            {report.approvedAt ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-md border border-emerald-700/40 bg-emerald-900/20 px-2 py-0.5 text-[10.5px] text-emerald-100">
                <Check className="h-3 w-3" /> Approved
              </span>
            ) : (
              <Button variant="outline" onClick={onApprove} disabled={approving} className="mt-2">
                {approving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Approve read
              </Button>
            )}
          </div>
          <p className="flex-1 text-[13.5px] leading-relaxed text-bone-100">{report.bingeVerdict}</p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
            <div className="text-[11px] uppercase tracking-wide text-bone-500">Opening hook</div>
            <p className="mt-1 text-[12.5px] text-bone-200">{report.hookVerdict}</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
            <div className="text-[11px] uppercase tracking-wide text-bone-500">Episode-end pull</div>
            <p className="mt-1 text-[12.5px] text-bone-200">{report.endingVerdict}</p>
          </div>
        </div>
      </Panel>

      {/* Engagement curve */}
      <Panel eyebrow="Scene by scene" title="Engagement curve">
        <EngagementCurve curve={report.engagementCurve} />
      </Panel>

      {/* Dimensions */}
      <Panel eyebrow="Rubric" title="How it scores on each lever">
        <div className="grid gap-2">
          {report.dimensions.map((d) => (
            <DimensionRow key={d.key} dim={d} />
          ))}
        </div>
      </Panel>

      {/* Top notes */}
      <Panel eyebrow="Actionable" title="Top notes to raise bingeability">
        <ol className="space-y-2.5">
          {report.topNotes.map((n, i) => (
            <li key={i} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-serif text-bone-50">
                  {i + 1}. {n.title}
                </div>
                {n.sceneRefs.length > 0 && (
                  <div className="shrink-0 text-[11px] text-bone-500">
                    scene{n.sceneRefs.length === 1 ? "" : "s"} {n.sceneRefs.join(", ")}
                  </div>
                )}
              </div>
              <p className="mt-1 text-[12.5px] text-bone-300">{n.detail}</p>
            </li>
          ))}
        </ol>
      </Panel>

      {/* Provenance footer */}
      <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-[11.5px] text-bone-400">
        <div>
          Scored against rubric <span className="text-bone-300">{report.rubricVersion}</span>, distilled from reviews of{" "}
          <span className="text-bone-300">{comps.join(", ")}</span>.
        </div>
        {sources.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {sources.map((s) => (
              <a key={s} href={s} target="_blank" rel="noreferrer" className="text-sky-300/80 hover:text-sky-200 underline">
                {new URL(s).hostname.replace(/^www\./, "")}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EngagementCurve({ curve }: { curve: AudienceSceneBeat[] }) {
  return (
    <div>
      <div className="flex items-end gap-1" style={{ height: 96 }}>
        {curve.map((s) => {
          const pct = (s.grip / 5) * 100;
          const color =
            s.grip >= 4 ? "bg-emerald-500/70" : s.grip >= 3 ? "bg-sky-500/60" : "bg-amber-500/60";
          return (
            <div key={s.ord} className="group relative flex flex-1 flex-col items-center justify-end" style={{ height: "100%" }}>
              <div className={`w-full rounded-t ${color}`} style={{ height: `${Math.max(6, pct)}%` }} />
              <div className="mt-1 text-[9px] text-bone-500">{s.ord}</div>
              {/* tooltip */}
              <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden w-56 rounded-md border border-white/10 bg-black/90 p-2 text-[11px] text-bone-200 group-hover:block">
                <div className="font-medium text-bone-100">
                  Scene {s.ord} · grip {s.grip}/5
                </div>
                <div className="text-bone-400">{s.heading}</div>
                {s.note && <div className="mt-1 text-bone-300">{s.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10.5px] text-bone-500">
        <TrendingUp className="h-3.5 w-3.5" />
        Hover a bar for the scene and why it grips or sags. Taller = harder to look away.
      </div>
    </div>
  );
}

function DimensionRow({ dim }: { dim: AudienceReadDimension }) {
  const s = VERDICT_STYLE[dim.verdict];
  return (
    <div className="flex items-start gap-3 rounded-md border border-white/8 bg-white/[0.02] p-3">
      <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-[10.5px] ${s.chip}`}>
        {s.label}
      </span>
      <div>
        <div className="text-[13px] text-bone-100">{dim.label}</div>
        <p className="mt-0.5 text-[12px] text-bone-300">{dim.note}</p>
      </div>
    </div>
  );
}
