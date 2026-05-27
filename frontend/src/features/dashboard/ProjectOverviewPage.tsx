import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Hammer,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { STAGE_LABELS, WORKFLOW_STAGES, type WorkflowStageId } from "@toburt/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

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
          <Link to={`/projects/${projectId}/writers-room`}>
            <Button>
              <Sparkles className="h-4 w-4" />
              Open Writers Room
            </Button>
          </Link>
        }
      />

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
              No workflows yet. Start one to take an idea through logline →
              treatment → season arc → draft.
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
                <li
                  key={a.id}
                  className="flex items-start gap-3 rounded-md border border-white/8 bg-white/[0.02] p-3"
                >
                  <CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-bone-100">
                      {a.target_kind === "artifact"
                        ? `Approve ${STAGE_LABELS[a.stage_id as WorkflowStageId] ?? a.stage_id}`
                        : `Approve ${a.target_kind}`}
                    </div>
                    <div className="mt-0.5 text-xs text-bone-400">
                      Requested by {a.requested_by ?? "system"} •{" "}
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                  </div>
                  <ApprovalButtons id={a.id} projectId={projectId} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <QuickLinks projectId={projectId} />
      </div>
    </div>
  );
}

function ApprovalButtons({ id, projectId }: { id: string; projectId: string }) {
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") =>
      api.decideApproval(id, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals", projectId] });
      qc.invalidateQueries({ queryKey: ["workflows", projectId] });
    },
  });
  return (
    <div className="flex gap-1">
      <button
        className="rounded-md border border-emerald-700/50 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-950/40"
        onClick={() => decide.mutate("approved")}
        disabled={decide.isPending}
      >
        Approve
      </button>
      <button
        className="rounded-md border border-red-700/50 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
        onClick={() => decide.mutate("rejected")}
        disabled={decide.isPending}
      >
        Reject
      </button>
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
        Start
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
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-bone-50">{title}</div>
          <div className="mt-0.5 text-xs text-bone-400">
            Stage:{" "}
            <span className="text-bone-200">{STAGE_LABELS[current] ?? current}</span>{" "}
            • Status: <span className="text-bone-200">{status}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AdvanceButton id={id} />
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ember-500 to-ember-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {WORKFLOW_STAGES.map((s, i) => (
          <span
            key={s}
            className={`chip ${
              i <= idx
                ? "border-ember-700/50 bg-ember-900/30 text-ember-100"
                : "opacity-50"
            }`}
          >
            {STAGE_LABELS[s]}
          </span>
        ))}
      </div>
    </div>
  );
}

function AdvanceButton({ id }: { id: string }) {
  const qc = useQueryClient();
  const advance = useMutation({
    mutationFn: () => api.advanceWorkflow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflows"] }),
  });
  return (
    <Button
      variant="outline"
      onClick={() => advance.mutate()}
      disabled={advance.isPending}
    >
      <ArrowRight className="h-4 w-4" />
      Advance stage
    </Button>
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
