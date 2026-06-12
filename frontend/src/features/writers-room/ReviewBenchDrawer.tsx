import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Play, SkipForward, RotateCcw, Check, Loader2, CheckCircle2 } from "lucide-react";
import type { QualityAgent, ReviewRun, ReviewStatus, WritersRoomResponse } from "@toburt/shared";
import { REVIEW_AUTHORITY_LABELS, reviewAuthorityOf } from "@toburt/shared";
import { api } from "@/lib/api";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

type Action = "run" | "skip" | "apply" | "reset";

const STATUS_META: Record<ReviewStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#9a927e" },
  active: { label: "Active", color: GOLD },
  done: { label: "Done", color: "#7fd1a4" },
  skipped: { label: "Skipped", color: "#7f8a9a" },
};

export function ReviewBenchDrawer({
  projectId, staff, runs, onState, onClose,
}: {
  projectId: string;
  staff: QualityAgent[];
  runs: ReviewRun[];
  onState: (state: WritersRoomResponse["state"]) => void;
  onClose: () => void;
}) {
  const runById = new Map(runs.map((r) => [r.agentId, r]));
  const [acting, setActing] = useState<{ id: string; action: Action } | null>(null);

  const act = useMutation({
    mutationFn: (v: { id: string; action: Action }) => api.reviewAgentAction(projectId, v.id, v.action),
    onMutate: (v) => setActing(v),
    onSuccess: (r) => onState(r.state),
    onSettled: () => setActing(null),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[#26262c] bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#26262c] px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Studio Script Staff</div>
            <div className="font-apple text-lg text-bone-50">Review Bench</div>
            <div className="mt-0.5 text-[11.5px] text-bone-400">The studio's quality staff — not co-writers. Run a pass to get a diagnosis; agents that can safely fix something propose a rewrite. You approve before anything is applied.</div>
          </div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {staff.map((agent) => {
            const run = runById.get(agent.id) ?? null;
            const busy = acting?.id === agent.id;
            return (
              <AgentCard
                key={agent.id}
                agent={agent}
                run={run}
                busy={busy}
                actingAction={busy ? acting?.action ?? null : null}
                onAction={(action) => act.mutate({ id: agent.id, action })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgentCard({
  agent, run, busy, actingAction, onAction,
}: {
  agent: QualityAgent;
  run: ReviewRun | null;
  busy: boolean;
  actingAction: Action | null;
  onAction: (a: Action) => void;
}) {
  const status: ReviewStatus = busy && actingAction === "run" ? "active" : run?.status ?? "pending";
  const sm = STATUS_META[status];
  const authority = run?.authority ?? reviewAuthorityOf(agent.rewriteAuthority);
  const finding = run?.finding ?? null;
  const canRewrite = authority === "rewrite" || authority === "rewrite_requires_approval";

  return (
    <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] text-bone-50">{agent.name}</span>
            <span className="rounded-full px-2 py-0.5 text-[9.5px]" style={{ color: sm.color, background: `${sm.color}1f` }}>{sm.label}</span>
          </div>
          <div className="truncate text-[10.5px]" style={gold}>{agent.role} · activates in {agent.stage}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="rounded border border-[#26262c] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-bone-400">{REVIEW_AUTHORITY_LABELS[authority]}</span>
            {finding && <span className="text-[9.5px] text-bone-500">confidence {Math.round((finding.confidence ?? 0) * 100)}%</span>}
          </div>
        </div>
      </div>

      {finding && status !== "skipped" && (
        <div className="mt-2 rounded-lg border border-[#26262c] bg-black/30 p-2.5">
          <p className="text-[12px] leading-snug text-bone-100">{finding.diagnosis}</p>
          {finding.notes.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {finding.notes.map((n, i) => (
                <li key={i} className="flex gap-1.5 text-[11px] text-bone-300"><span style={gold}>·</span><span>{n}</span></li>
              ))}
            </ul>
          )}
          {finding.rewriteOption && (
            <div className="mt-2 rounded-md border border-[#d8b15a]/25 bg-[#d8b15a]/[0.05] p-2">
              <div className="text-[9.5px] uppercase tracking-wide" style={gold}>Rewrite option · {finding.rewriteOption.targetLabel}</div>
              {finding.rewriteOption.before && (
                <p className="mt-1 whitespace-pre-wrap text-[11px] text-bone-500 line-through decoration-bone-700">{finding.rewriteOption.before}</p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-[11.5px] text-bone-50">{finding.rewriteOption.after}</p>
              <p className="mt-1 text-[10.5px] italic text-bone-400">{finding.rewriteOption.rationale}</p>
              <div className="mt-2">
                {run?.applied ? (
                  <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "#7fd1a4" }}><CheckCircle2 className="h-3.5 w-3.5" /> Applied with your approval</span>
                ) : (
                  <button onClick={() => onAction("apply")} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
                    {busy && actingAction === "apply" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve &amp; apply
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <button onClick={() => onAction("run")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2 py-1 text-[11px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">
          {busy && actingAction === "run" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {run ? "Re-run" : "Run pass"}
        </button>
        {status !== "skipped" ? (
          <button onClick={() => onAction("skip")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2 py-1 text-[11px] text-bone-400 hover:border-bone-600 disabled:opacity-50">
            <SkipForward className="h-3 w-3" /> Skip
          </button>
        ) : (
          <button onClick={() => onAction("reset")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2 py-1 text-[11px] text-bone-400 hover:border-bone-600 disabled:opacity-50">
            <RotateCcw className="h-3 w-3" /> Un-skip
          </button>
        )}
        {canRewrite && !finding && <span className="ml-auto text-[9.5px] text-bone-600">can propose a rewrite</span>}
      </div>
    </div>
  );
}
