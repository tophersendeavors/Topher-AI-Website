// AI Production Queue / Generation Planner — episode-scoped command
// center for managing AI shot generation from approved shot lists.
//
// Read-only against creative content. Every write goes through the
// generationQueue routes and lands in projects.metadata.generationQueue.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clapperboard,
  Copy,
  Download,
  Loader2,
  Lock,
  PlayCircle,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  GENERATION_QUEUE_EXPORTS,
  GENERATION_QUEUE_STATUSES,
  MODEL_TARGETS,
  MODEL_TARGET_LABEL,
  type GenerationOutputReview,
  type GenerationQueueItem,
  type GenerationQueueResponse,
  type GenerationQueueStatus,
  type ModelTarget,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function GenerationQueuePage() {
  const { projectId, episodeId } = useParams<{
    projectId: string;
    episodeId: string;
  }>();
  if (!projectId || !episodeId) return null;
  const qc = useQueryClient();
  const queueQ = useQuery({
    queryKey: ["generation-queue", projectId, episodeId],
    queryFn: () => api.getGenerationQueue(projectId, episodeId),
  });
  const resync = useMutation({
    mutationFn: () => api.resyncGenerationQueue(projectId, episodeId),
    onSuccess: (data) =>
      qc.setQueryData(["generation-queue", projectId, episodeId], data),
  });

  if (queueQ.isLoading) {
    return (
      <div className="p-8 text-bone-300">Loading production queue…</div>
    );
  }
  if (queueQ.isError || !queueQ.data) {
    return (
      <div className="p-8 text-red-300">
        Failed to load generation queue.{" "}
        {(queueQ.error as Error | undefined)?.message ?? ""}
      </div>
    );
  }

  const resp = queueQ.data;
  const epLabel =
    resp.episodeNumber !== null
      ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
      : "Episode";
  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow="AI Production Queue"
        title={`${epLabel} — Generation Planner`}
        description={
          resp.scriptId === null
            ? "No current draft for this episode yet."
            : `${resp.summary.totalShots} shot${resp.summary.totalShots === 1 ? "" : "s"} · ${resp.summary.overallCompletionPct}% approved · ${resp.summary.blockedCount} blocked · ${resp.summary.awaitingReviewCount} awaiting review.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/episodes/${episodeId}/shot-list`}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Shot List
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/production`}>
              <Button variant="outline">
                Production Hub <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/exports`}>
              <Button variant="outline">
                Export Center <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={() => resync.mutate()}
              disabled={resync.isPending}
            >
              {resync.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Resync from artifacts
            </Button>
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <Explainer scriptLocked={resp.scriptIsLocked} />
        {resp.queue.items.length === 0 ? (
          <EmptyQueueGetStarted
            projectId={projectId}
            episodeId={episodeId}
          />
        ) : (
          <>
            <SummaryStrip resp={resp} />
            <ExportStrip
              projectId={projectId}
              episodeId={episodeId}
              empty={false}
            />
            <SceneCompletionTable resp={resp} />
            <BatchSummary resp={resp} />
            <QueueTable
              resp={resp}
              projectId={projectId}
              episodeId={episodeId}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Explainer({ scriptLocked }: { scriptLocked: boolean }) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3 text-[12.5px] text-bone-300">
      The Generation Planner mirrors every approved shot from the Curated
      Shot List into a queue item with model assignment, status, output
      version history, and review notes. <strong>Nothing here mutates the
      script.</strong> Approve briefs upstream — fixes flow back into the
      queue on Resync.
      {scriptLocked && (
        <span className="ml-2 inline-flex items-center gap-1 rounded border border-emerald-700/40 bg-emerald-900/20 px-1.5 py-0.5 text-[11px] text-emerald-200">
          <Lock className="h-3 w-3" /> draft locked
        </span>
      )}
    </div>
  );
}

function SummaryStrip({ resp }: { resp: GenerationQueueResponse }) {
  const s = resp.summary;
  const tiles: Array<{ label: string; value: string; tone?: "ok" | "warn" | "bad" }> = [
    { label: "Total shots", value: String(s.totalShots) },
    { label: "Ready", value: String(s.readyCount), tone: s.readyCount > 0 ? "ok" : undefined },
    { label: "Blocked", value: String(s.blockedCount), tone: s.blockedCount > 0 ? "warn" : undefined },
    { label: "Awaiting review", value: String(s.awaitingReviewCount), tone: s.awaitingReviewCount > 0 ? "warn" : undefined },
    { label: "Approved", value: `${s.byStatus.approved + s.byStatus.final}` },
    { label: "Rejected", value: String(s.byStatus.rejected), tone: s.byStatus.rejected > 0 ? "bad" : undefined },
    { label: "Completion", value: `${s.overallCompletionPct}%` },
  ];
  return (
    <Panel
      eyebrow="Pipeline"
      title="At a glance"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((t) => (
          <div
            key={t.label}
            className={
              "rounded-md border px-3 py-2 " +
              (t.tone === "ok"
                ? "border-cyan-700/40 bg-cyan-900/10"
                : t.tone === "warn"
                ? "border-amber-700/40 bg-amber-900/10"
                : t.tone === "bad"
                ? "border-red-700/40 bg-red-900/10"
                : "border-white/8 bg-white/[0.02]")
            }
          >
            <div className="text-[10px] uppercase tracking-wide text-bone-500">
              {t.label}
            </div>
            <div className="font-serif text-xl text-bone-50">{t.value}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ExportStrip({
  projectId,
  episodeId,
  empty,
}: {
  projectId: string;
  episodeId: string;
  empty: boolean;
}) {
  const [model, setModel] = useState<ModelTarget>("veo");
  const links: Array<{
    format: (typeof GENERATION_QUEUE_EXPORTS)[number];
    label: string;
    filename: string;
  }> = [
    { format: "queue_csv", label: "Queue CSV", filename: "queue.csv" },
    { format: "approved_manifest_json", label: "Approved manifest .json", filename: "manifest.json" },
    { format: "scene_assembly_checklist_markdown", label: "Scene assembly checklist .md", filename: "scenes.md" },
    { format: "trailer_batch_text", label: "Trailer batch .txt", filename: "trailer.txt" },
  ];
  return (
    <Panel eyebrow="Exports" title="Hand off the queue">
      {empty && (
        <div className="mb-3 rounded-md border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[12px] text-amber-100">
          Nothing to export yet — approve shots upstream and resync the queue first.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {links.map((l) => (
          <a
            key={l.format}
            className="btn-outline"
            href={api.exportGenerationQueueUrl(projectId, episodeId, {
              format: l.format,
            })}
            download={l.filename}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-3.5 w-3.5" />
            {l.label}
          </a>
        ))}
        <div className="ml-2 flex items-center gap-1.5">
          <select
            className="h-7 rounded border border-white/10 bg-black/30 px-2 text-[12px] text-bone-200"
            value={model}
            onChange={(e) => setModel(e.target.value as ModelTarget)}
          >
            {MODEL_TARGETS.map((m) => (
              <option key={m} value={m}>
                {MODEL_TARGET_LABEL[m]}
              </option>
            ))}
          </select>
          <a
            className="btn-outline"
            href={api.exportGenerationQueueUrl(projectId, episodeId, {
              format: "model_batch_text",
              model,
            })}
            download={`${model}_batch.txt`}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-3.5 w-3.5" />
            Model batch .txt
          </a>
        </div>
      </div>
    </Panel>
  );
}

function SceneCompletionTable({ resp }: { resp: GenerationQueueResponse }) {
  return (
    <Panel
      eyebrow="Scenes"
      title="Scene completion tracker"
    >
      {resp.summary.scenes.length === 0 ? (
        <EmptyState
          Icon={Clapperboard}
          title="No scenes in queue yet"
          description="Approve shots on the Curated Shot List and they will appear here."
        />
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="text-bone-500">
              <tr className="border-b border-white/8">
                <th className="py-2 pl-2 pr-3 font-normal">Scene</th>
                <th className="px-2 py-2 font-normal">Slugline</th>
                <th className="px-2 py-2 font-normal text-right">Total</th>
                <th className="px-2 py-2 font-normal text-right">Approved</th>
                <th className="px-2 py-2 font-normal text-right">Generated</th>
                <th className="px-2 py-2 font-normal text-right">Missing</th>
                <th className="px-2 py-2 font-normal text-right">Rejected</th>
                <th className="px-2 py-2 pr-2 font-normal text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {resp.summary.scenes.map((s) => (
                <tr key={s.sceneOrd} className="border-b border-white/5">
                  <td className="py-1.5 pl-2 pr-3 text-bone-100">SC{String(s.sceneOrd).padStart(2, "0")}</td>
                  <td className="px-2 py-1.5 text-bone-300">{s.slugline}</td>
                  <td className="px-2 py-1.5 text-right text-bone-200">{s.totalShots}</td>
                  <td className="px-2 py-1.5 text-right text-cyan-200">{s.approvedShots}</td>
                  <td className="px-2 py-1.5 text-right text-bone-200">{s.generatedShots}</td>
                  <td className="px-2 py-1.5 text-right text-amber-200">{s.missingShots}</td>
                  <td className="px-2 py-1.5 text-right text-red-300">{s.rejectedShots}</td>
                  <td className="px-2 py-1.5 pr-2 text-right text-bone-50">{s.completionPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function BatchSummary({ resp }: { resp: GenerationQueueResponse }) {
  const tabs: Array<{ key: keyof typeof resp.batches; label: string }> = [
    { key: "byCharacter", label: "Character" },
    { key: "byLocation", label: "Location" },
    { key: "byModel", label: "Model" },
    { key: "byAspectRatio", label: "Aspect" },
    { key: "byTimeOfDay", label: "Time of day" },
    { key: "byScene", label: "Scene" },
  ];
  const [active, setActive] = useState<keyof typeof resp.batches>("byCharacter");
  const groups = resp.batches[active];
  return (
    <Panel
      eyebrow="Batches"
      title="Group shots for efficient generation"
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={
              "rounded-md border px-2.5 py-1 text-[12px] " +
              (active === t.key
                ? "border-ember-500/60 bg-ember-500/15 text-ember-100"
                : "border-white/10 bg-white/[0.02] text-bone-300 hover:bg-white/[0.05]")
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      {groups.length === 0 ? (
        <div className="text-xs text-bone-400">No groups yet.</div>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <li
              key={g.key}
              className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.02] px-3 py-2 text-[12.5px]"
            >
              <span className="truncate text-bone-200">{g.label}</span>
              <span className="ml-2 chip border-white/10 bg-white/5 text-bone-300">
                {g.itemCount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function QueueTable({
  resp,
  projectId,
  episodeId,
}: {
  resp: GenerationQueueResponse;
  projectId: string;
  episodeId: string;
}) {
  const [filterStatus, setFilterStatus] = useState<GenerationQueueStatus | "all">("all");
  const [filterModel, setFilterModel] = useState<ModelTarget | "all">("all");
  const items = useMemo(() => {
    const out = resp.queue.items.slice().sort((a, b) =>
      a.sceneOrd - b.sceneOrd || a.shotIndex - b.shotIndex
    );
    return out.filter((it) => {
      if (filterStatus !== "all" && it.status !== filterStatus) return false;
      if (filterModel !== "all" && it.modelTarget !== filterModel) return false;
      return true;
    });
  }, [resp.queue.items, filterStatus, filterModel]);

  return (
    <Panel
      eyebrow={`${items.length} of ${resp.queue.items.length} shots`}
      title="Shot generation queue"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-bone-400">Filter:</span>
        <select
          className="h-7 rounded border border-white/10 bg-black/30 px-2 text-bone-200"
          value={filterStatus}
          onChange={(e) =>
            setFilterStatus(e.target.value as GenerationQueueStatus | "all")
          }
        >
          <option value="all">All statuses</option>
          {GENERATION_QUEUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {prettyStatus(s)}
            </option>
          ))}
        </select>
        <select
          className="h-7 rounded border border-white/10 bg-black/30 px-2 text-bone-200"
          value={filterModel}
          onChange={(e) =>
            setFilterModel(e.target.value as ModelTarget | "all")
          }
        >
          <option value="all">All models</option>
          {MODEL_TARGETS.map((m) => (
            <option key={m} value={m}>
              {MODEL_TARGET_LABEL[m]}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <EmptyState
          Icon={Camera}
          title="No shots match your filters"
          description="Adjust the status / model filters above, or approve more shots upstream."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <QueueItemRow
              key={it.id}
              item={it}
              projectId={projectId}
              episodeId={episodeId}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function QueueItemRow({
  item,
  projectId,
  episodeId,
}: {
  item: GenerationQueueItem;
  projectId: string;
  episodeId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const onUpdate = (data: GenerationQueueResponse) =>
    qc.setQueryData(["generation-queue", projectId, episodeId], data);
  const patch = useMutation({
    mutationFn: (body: import("@toburt/shared").GenerationQueueItemPatch) =>
      api.patchGenerationQueueItem(projectId, episodeId, item.id, body),
    onSuccess: onUpdate,
  });
  const ready = item.readiness.blockers.length === 0;
  return (
    <li className="rounded-md border border-white/8 bg-white/[0.02]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-bone-50">
            <span className="font-mono text-bone-300">
              SC{String(item.sceneOrd).padStart(2, "0")}_SH
              {String(item.shotIndex + 1).padStart(2, "0")}
            </span>
            <span className="truncate">{item.shotDescription}</span>
            <StatusChip status={item.status} />
            {!ready && (
              <span className="chip border-amber-700/40 bg-amber-900/15 text-amber-200">
                <AlertCircle className="h-3 w-3" /> {item.readiness.blockers.length} blocker
                {item.readiness.blockers.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-bone-400">
            {item.characters.join(", ") || "—"} · {item.location || "—"} ·{" "}
            {item.aspectRatio} · {item.durationSec}s ·{" "}
            {MODEL_TARGET_LABEL[item.modelTarget]}
            {item.timeOfDay ? ` · ${item.timeOfDay}` : ""}
            {item.outputs.length > 0
              ? ` · ${item.outputs.length} output${item.outputs.length === 1 ? "" : "s"}`
              : ""}
          </div>
        </div>
        <ArrowRight
          className={
            "h-4 w-4 text-bone-400 transition-transform " +
            (expanded ? "rotate-90" : "")
          }
        />
      </button>
      {expanded && (
        <div className="border-t border-white/8 p-3 space-y-3">
          <ReadinessBlock item={item} />
          <PromptHandoffBlock item={item} />
          <ControlsBlock
            item={item}
            onPatch={(p) => patch.mutate(p)}
            busy={patch.isPending}
          />
          <OutputsBlock
            item={item}
            projectId={projectId}
            episodeId={episodeId}
          />
        </div>
      )}
    </li>
  );
}

function ReadinessBlock({ item }: { item: GenerationQueueItem }) {
  const rows: Array<{ label: string; ok: boolean }> = [
    { label: "Approved shot brief", ok: item.readiness.approvedShotBrief },
    { label: "Prompt generated", ok: item.readiness.promptGenerated },
    { label: "Character refs ready", ok: item.readiness.characterRefsReady },
    { label: "Location bible ready", ok: item.readiness.locationBibleReady },
    { label: "Prop continuity ready", ok: item.readiness.propContinuityReady },
    { label: "Sound notes ready", ok: item.readiness.soundNotesReady },
  ];
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.015] p-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-bone-500">
        Readiness checks
      </div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-1.5 text-[12px]">
            {r.ok ? (
              <Check className="h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <X className="h-3.5 w-3.5 text-amber-300" />
            )}
            <span className={r.ok ? "text-bone-200" : "text-amber-200"}>{r.label}</span>
          </div>
        ))}
      </div>
      {item.readiness.blockers.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-amber-100">
          {item.readiness.blockers.map((b, i) => (
            <li key={i}>• {b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PromptHandoffBlock({ item }: { item: GenerationQueueItem }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1200);
    } catch {
      /* ignore */
    }
  };
  const continuityNotes = [
    item.continuityRequirements.characters.length
      ? `Characters: ${item.continuityRequirements.characters.join(", ")}`
      : "",
    item.continuityRequirements.location
      ? `Location: ${item.continuityRequirements.location}`
      : "",
    item.continuityRequirements.props.length
      ? `Props: ${item.continuityRequirements.props.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.015] p-3">
      <div className="mb-1.5 text-[10px] uppercase tracking-wide text-bone-500">
        Prompt handoff
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <CopyBlock
          label="Model prompt"
          text={item.promptText}
          copied={copiedKey === "prompt"}
          onCopy={() => copy("prompt", item.promptText)}
        />
        <CopyBlock
          label="Continuity notes"
          text={continuityNotes}
          copied={copiedKey === "cont"}
          onCopy={() => copy("cont", continuityNotes)}
        />
        <CopyBlock
          label="Sound prompt"
          text={item.soundNotes?.audioField ?? ""}
          copied={copiedKey === "sound"}
          onCopy={() =>
            copy("sound", item.soundNotes?.audioField ?? "")
          }
          empty="Sound bible scene not approved"
        />
        <CopyBlock
          label="Music prompt"
          text={item.soundNotes?.nonDiegeticMusic ?? ""}
          copied={copiedKey === "music"}
          onCopy={() =>
            copy("music", item.soundNotes?.nonDiegeticMusic ?? "")
          }
          empty="Sound bible scene not approved"
        />
      </div>
    </div>
  );
}

function CopyBlock({
  label,
  text,
  copied,
  onCopy,
  empty,
}: {
  label: string;
  text: string;
  copied: boolean;
  onCopy: () => void;
  empty?: string;
}) {
  const ready = !!text.trim();
  return (
    <div className="rounded border border-white/8 bg-black/15 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-bone-500">
          {label}
        </span>
        <button
          className="btn-outline disabled:opacity-50"
          disabled={!ready}
          onClick={onCopy}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className={
          "max-h-32 overflow-y-auto whitespace-pre-wrap text-[11.5px] " +
          (ready ? "text-bone-200" : "text-bone-500 italic")
        }
      >
        {ready ? text : empty ?? "(no content)"}
      </div>
    </div>
  );
}

function ControlsBlock({
  item,
  onPatch,
  busy,
}: {
  item: GenerationQueueItem;
  onPatch: (p: import("@toburt/shared").GenerationQueueItemPatch) => void;
  busy: boolean;
}) {
  const [notes, setNotes] = useState(item.reviewNotes ?? "");
  const [retry, setRetry] = useState(item.retryInstruction ?? "");
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.015] p-3 space-y-2">
      <div className="mb-1 text-[10px] uppercase tracking-wide text-bone-500">
        Controls
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-bone-400">Model</label>
        <select
          className="h-7 rounded border border-white/10 bg-black/30 px-2 text-[12px] text-bone-200"
          value={item.modelTarget}
          disabled={busy}
          onChange={(e) =>
            onPatch({ modelTarget: e.target.value as ModelTarget })
          }
        >
          {MODEL_TARGETS.map((m) => (
            <option key={m} value={m}>
              {MODEL_TARGET_LABEL[m]}
            </option>
          ))}
        </select>
        <label className="ml-2 text-[11px] text-bone-400">Status</label>
        <select
          className="h-7 rounded border border-white/10 bg-black/30 px-2 text-[12px] text-bone-200"
          value={item.status}
          disabled={busy}
          onChange={(e) =>
            onPatch({ status: e.target.value as GenerationQueueStatus })
          }
        >
          {GENERATION_QUEUE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {prettyStatus(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="text-[11px] text-bone-400">Review notes</label>
          <textarea
            className="mt-1 w-full rounded border border-white/10 bg-black/20 p-2 text-[12px] text-bone-100"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onPatch({ reviewNotes: notes })}
            disabled={busy}
          />
        </div>
        <div>
          <label className="text-[11px] text-bone-400">Retry instruction</label>
          <textarea
            className="mt-1 w-full rounded border border-white/10 bg-black/20 p-2 text-[12px] text-bone-100"
            rows={2}
            value={retry}
            onChange={(e) => setRetry(e.target.value)}
            onBlur={() => onPatch({ retryInstruction: retry })}
            disabled={busy}
          />
        </div>
      </div>
    </div>
  );
}

function OutputsBlock({
  item,
  projectId,
  episodeId,
}: {
  item: GenerationQueueItem;
  projectId: string;
  episodeId: string;
}) {
  const [url, setUrl] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const qc = useQueryClient();
  const onUpdate = (data: GenerationQueueResponse) =>
    qc.setQueryData(["generation-queue", projectId, episodeId], data);
  const add = useMutation({
    mutationFn: () =>
      api.addGenerationOutput(projectId, episodeId, item.id, {
        url: url.trim(),
        modelTarget: item.modelTarget,
        versionLabel: versionLabel.trim() || undefined,
      }),
    onSuccess: (data) => {
      onUpdate(data);
      setUrl("");
      setVersionLabel("");
    },
  });
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.015] p-3 space-y-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-bone-500">
          Generated outputs ({item.outputs.length})
        </span>
        {item.approvedOutputId && (
          <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
            <Check className="h-3 w-3" /> Approved pinned
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          className="h-7 min-w-[260px] flex-1 rounded border border-white/10 bg-black/30 px-2 text-[12px] text-bone-100"
          placeholder="Paste output URL or file reference…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <input
          className="h-7 w-32 rounded border border-white/10 bg-black/30 px-2 text-[12px] text-bone-100"
          placeholder="v1, v2…"
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
        />
        <Button
          variant="primary"
          onClick={() => add.mutate()}
          disabled={!url.trim() || add.isPending}
        >
          {add.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Send className="h-3.5 w-3.5" />
          )}
          Attach output
        </Button>
      </div>
      {item.outputs.length === 0 ? (
        <div className="text-[11px] text-bone-400">
          No outputs attached yet. Generate this shot in your model of choice
          and paste the URL or file reference here.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {item.outputs.map((o) => (
            <OutputRow
              key={o.id}
              output={o}
              isApproved={item.approvedOutputId === o.id}
              projectId={projectId}
              episodeId={episodeId}
              itemId={item.id}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OutputRow({
  output,
  isApproved,
  projectId,
  episodeId,
  itemId,
}: {
  output: GenerationOutputReview;
  isApproved: boolean;
  projectId: string;
  episodeId: string;
  itemId: string;
}) {
  const qc = useQueryClient();
  const onUpdate = (data: GenerationQueueResponse) =>
    qc.setQueryData(["generation-queue", projectId, episodeId], data);
  const review = useMutation({
    mutationFn: (body: import("@toburt/shared").GenerationOutputReviewPatch) =>
      api.reviewGenerationOutput(projectId, episodeId, itemId, output.id, body),
    onSuccess: onUpdate,
  });
  const remove = useMutation({
    mutationFn: () =>
      api.deleteGenerationOutput(projectId, episodeId, itemId, output.id),
    onSuccess: onUpdate,
  });
  const tone =
    output.status === "approved"
      ? "border-emerald-700/40 bg-emerald-900/15"
      : output.status === "rejected"
        ? "border-red-700/40 bg-red-900/15"
        : "border-white/10 bg-white/[0.02]";
  const media = detectOutputMedia(output.url);
  return (
    <li className={"rounded border px-2.5 py-2 text-[12px] " + tone}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2 text-bone-100">
            {media.kind === "image" ? (
              <a
                href={output.url}
                target="_blank"
                rel="noreferrer"
                title="Open full size"
                className="block shrink-0"
              >
                <img
                  src={output.url}
                  alt=""
                  className="h-12 w-12 rounded border border-white/10 object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </a>
            ) : media.kind === "video" ? (
              <a
                href={output.url}
                target="_blank"
                rel="noreferrer"
                title="Open video"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded border border-white/10 bg-black/40"
              >
                <PlayCircle className="h-5 w-5 text-bone-200" />
              </a>
            ) : (
              <PlayCircle className="h-3.5 w-3.5 mt-1 text-bone-300" />
            )}
            <a
              className="truncate underline decoration-bone-700 hover:decoration-bone-300"
              href={output.url}
              target="_blank"
              rel="noreferrer"
            >
              {output.url}
            </a>
            {output.versionLabel && (
              <span className="chip border-white/10 bg-white/5 text-bone-300">
                {output.versionLabel}
              </span>
            )}
            <span className="chip border-white/10 bg-white/5 text-bone-300">
              {output.modelTarget}
            </span>
            {isApproved && (
              <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                approved final
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[11px] text-bone-400">
            uploaded {new Date(output.uploadedAt).toLocaleString()}
          </div>
          {output.reviewNotes && (
            <div className="mt-1 text-[11.5px] text-bone-200">
              Notes: {output.reviewNotes}
            </div>
          )}
          {output.retryInstruction && (
            <div className="mt-1 text-[11.5px] text-amber-200">
              Retry: {output.retryInstruction}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            className="btn-outline disabled:opacity-50"
            disabled={review.isPending || output.status === "approved"}
            onClick={() => review.mutate({ status: "approved" })}
          >
            <Check className="h-3.5 w-3.5" /> Approve
          </button>
          <button
            className="btn-outline disabled:opacity-50"
            disabled={review.isPending || output.status === "rejected"}
            onClick={() => review.mutate({ status: "rejected" })}
          >
            <X className="h-3.5 w-3.5" /> Reject
          </button>
          <button
            className="btn-outline disabled:opacity-50"
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm("Remove this output? This is metadata only.")) {
                remove.mutate();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </li>
  );
}

function StatusChip({ status }: { status: GenerationQueueStatus }) {
  const tone =
    status === "approved" || status === "final"
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : status === "ready" || status === "queued"
        ? "border-cyan-700/40 bg-cyan-900/15 text-cyan-200"
        : status === "needs_review" || status === "generating"
          ? "border-amber-700/40 bg-amber-900/15 text-amber-200"
          : status === "rejected" || status === "retry_needed"
            ? "border-red-700/40 bg-red-900/15 text-red-200"
            : "border-white/10 bg-white/5 text-bone-400";
  return <span className={"chip " + tone}>{prettyStatus(status)}</span>;
}

function prettyStatus(s: GenerationQueueStatus): string {
  return s.replace(/_/g, " ");
}

function detectOutputMedia(url: string): { kind: "image" | "video" | "other" } {
  const u = url.toLowerCase().split("?")[0].split("#")[0];
  if (/\.(jpe?g|png|webp|gif|avif)$/i.test(u)) return { kind: "image" };
  if (/\.(mp4|mov|webm|m4v|mkv)$/i.test(u)) return { kind: "video" };
  return { kind: "other" };
}

// Get-started card shown when items.length === 0. Replaces the empty
// summary tiles + scene completion table + queue table so the user lands
// on a clear next-step path instead of a wall of zeros.
function EmptyQueueGetStarted({
  projectId,
  episodeId,
}: {
  projectId: string;
  episodeId: string;
}) {
  return (
    <Panel
      eyebrow="Get started"
      title="Nothing in the queue yet"
    >
      <div className="space-y-4">
        <div className="text-[13px] text-bone-300">
          Generate and approve shot briefs first. The queue mirrors approved
          shots — once you have any, click <strong>Resync from artifacts</strong>{" "}
          (top right) and the items will populate here automatically.
        </div>
        <ol className="space-y-2 text-[12.5px] text-bone-200">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-bone-300">
              1
            </span>
            <span>
              On <strong>Shot List</strong>, run{" "}
              <em>Auto-build briefs for all scenes</em>, then{" "}
              <em>Approve all generated shots</em>.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-bone-300">
              2
            </span>
            <span>
              On <strong>Sound Bible</strong>, generate the bible and approve
              identity / music / scene rows. Sound prompts ride into each
              queue item.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[11px] text-bone-300">
              3
            </span>
            <span>
              Come back and <strong>Resync</strong> — your shots will appear
              with readiness checks, model assignment, and prompt handoff.
            </span>
          </li>
        </ol>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Link to={`/projects/${projectId}/episodes/${episodeId}/shot-list`}>
            <Button variant="primary">
              <Camera className="h-3.5 w-3.5" />
              Open Shot List
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Link to={`/projects/${projectId}/episodes/${episodeId}/sound-bible`}>
            <Button variant="outline">
              <Clapperboard className="h-3.5 w-3.5" />
              Open Sound Bible
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </Panel>
  );
}
