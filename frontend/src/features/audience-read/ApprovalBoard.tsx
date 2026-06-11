import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  X,
  Pencil,
  PauseCircle,
  Wand2,
  Loader2,
  ShieldCheck,
  Sparkles,
  Lock,
  GitBranch,
  AlertTriangle,
  ThumbsUp,
} from "lucide-react";
import type {
  ApprovalStatus,
  ApprovedChangeSet,
  ChangeProposal,
  HumanReadPipelineResponse,
  ProposalRisk,
  RewriteJob,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

const STATUS_META: Record<ApprovalStatus, { label: string; chip: string }> = {
  pending: { label: "Pending", chip: "border-bone-600/40 bg-white/5 text-bone-300" },
  approved: { label: "Approved", chip: "border-emerald-700/40 bg-emerald-900/20 text-emerald-100" },
  auto_safe: { label: "Auto-safe", chip: "border-teal-700/40 bg-teal-900/20 text-teal-100" },
  rejected: { label: "Rejected", chip: "border-red-700/40 bg-red-950/30 text-red-200" },
  revise: { label: "Revise", chip: "border-violet-700/40 bg-violet-950/30 text-violet-200" },
  hold: { label: "Hold", chip: "border-slate-600/40 bg-slate-800/30 text-slate-200" },
};

const RISK_CHIP: Record<ProposalRisk, string> = {
  low: "border-emerald-700/40 bg-emerald-900/15 text-emerald-200",
  medium: "border-amber-700/40 bg-amber-900/15 text-amber-100",
  high: "border-red-700/40 bg-red-950/25 text-red-200",
};

export function ApprovalBoard({
  projectId,
  episodeId,
  hasReport,
}: {
  projectId: string;
  episodeId: string;
  hasReport: boolean;
}) {
  const qc = useQueryClient();
  const key = ["human-read-pipeline", projectId, episodeId];
  const q = useQuery({ queryKey: key, queryFn: () => api.getChangeProposals(projectId, episodeId) });
  const seed = (r: HumanReadPipelineResponse) => qc.setQueryData(key, r);

  const generate = useMutation({
    mutationFn: () => api.generateChangeProposals(projectId, episodeId),
    onSuccess: seed,
  });
  const buildSet = useMutation({
    mutationFn: () => api.buildApprovedChangeSet(projectId, episodeId),
    onSuccess: (r) => seed(r),
  });

  const data = q.data;
  const proposals = data?.proposals ?? [];
  const changeSets = data?.changeSets ?? [];
  const rewriteJobs = data?.rewriteJobs ?? [];
  const approvedCount = proposals.filter(
    (p) => p.approvalStatus === "approved" || p.approvalStatus === "auto_safe"
  ).length;
  const decided = proposals.filter((p) => p.approvalStatus !== "pending").length;

  return (
    <Panel
      eyebrow="Approval Board"
      title={
        proposals.length
          ? `Human Read complete — ${proposals.length} proposed change${proposals.length === 1 ? "" : "s"}`
          : "Convert the read into approval cards"
      }
    >
      {/* The rule */}
      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-700/30 bg-amber-950/20 p-2.5 text-[11.5px] text-amber-100/90">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Human Read passes <strong>diagnose</strong>; they do not authorize rewrites. Only proposals you
          mark <strong>Approved</strong> or <strong>Auto-safe</strong> can ever enter a rewrite.
        </span>
      </div>

      {proposals.length === 0 ? (
        <div className="rounded-md border border-white/8 bg-white/[0.02] p-4">
          <p className="text-[12.5px] text-bone-300">
            Turn the Human Read's notes into individual change cards you can approve, reject, revise, or
            hold — one decision at a time. Nothing is applied to the script here.
          </p>
          <div className="mt-3">
            <Button onClick={() => generate.mutate()} disabled={!hasReport || generate.isPending}>
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {hasReport ? "Generate change proposals" : "Run the Audience Read first"}
            </Button>
          </div>
          {generate.isError && (
            <p className="mt-2 text-[11.5px] text-red-300">{(generate.error as Error).message}</p>
          )}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11.5px] text-bone-400">
            <span>{decided}/{proposals.length} decided</span>
            <span className="text-emerald-300">· {approvedCount} cleared for rewrite</span>
            <button
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:text-bone-100 disabled:opacity-50"
              onClick={() => generate.mutate()}
              disabled={generate.isPending}
              title="Regenerate proposals from the latest read (resets all decisions)"
            >
              {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              Regenerate
            </button>
          </div>

          <div className="space-y-3">
            {proposals.map((p) => (
              <ProposalCard key={p.id} projectId={projectId} episodeId={episodeId} proposal={p} onUpdate={seed} />
            ))}
          </div>

          {/* Master action */}
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-bone-300">
                Builds a locked Approved Change Set from{" "}
                <strong className="text-emerald-200">{approvedCount}</strong> approved / auto-safe card
                {approvedCount === 1 ? "" : "s"}. Rejected, held, pending and revise cards are excluded.
              </div>
              <Button onClick={() => buildSet.mutate()} disabled={approvedCount === 0 || buildSet.isPending}>
                {buildSet.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Generate Rewrite From Approved Changes Only
              </Button>
            </div>
            {buildSet.isError && (
              <p className="mt-2 text-[11.5px] text-red-300">{(buildSet.error as Error).message}</p>
            )}
          </div>

          {/* Locked change sets + controlled rewrite */}
          {changeSets.length > 0 && (
            <RewriteReview
              projectId={projectId}
              episodeId={episodeId}
              changeSets={changeSets}
              rewriteJobs={rewriteJobs}
              onUpdate={seed}
            />
          )}
        </>
      )}
    </Panel>
  );
}

function RewriteReview({
  projectId,
  episodeId,
  changeSets,
  rewriteJobs,
  onUpdate,
}: {
  projectId: string;
  episodeId: string;
  changeSets: ApprovedChangeSet[];
  rewriteJobs: RewriteJob[];
  onUpdate: (r: HumanReadPipelineResponse) => void;
}) {
  const latestSet = changeSets[changeSets.length - 1];
  const run = useMutation({
    mutationFn: () => api.runControlledRewrite(projectId, episodeId, latestSet.id),
    onSuccess: onUpdate,
  });
  const jobForLatest = rewriteJobs.filter((j) => j.approvedChangeSetId === latestSet.id);

  return (
    <div className="mt-3 space-y-2">
      <div className="rounded-md border border-emerald-700/30 bg-emerald-950/15 p-3 text-[12px] text-bone-200">
        <div className="flex items-center gap-2 text-emerald-200">
          <ShieldCheck className="h-4 w-4" />
          Approved Change Set locked · {latestSet.approvedProposalIds.length} change
          {latestSet.approvedProposalIds.length === 1 ? "" : "s"} ·{" "}
          {latestSet.lockedPromptPayload.protectedElements.length} protected ·{" "}
          {latestSet.lockedPromptPayload.rewriteBoundaries.length} scope boundar
          {latestSet.lockedPromptPayload.rewriteBoundaries.length === 1 ? "y" : "ies"}
        </div>
        <div className="mt-1 text-bone-400">
          The controlled rewrite receives this locked payload and nothing else — not the Human Read
          report. It edits only in-scope scenes and leaves the rest byte-identical.
        </div>
        <div className="mt-2">
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
            Run controlled rewrite
          </Button>
          {run.isError && <p className="mt-2 text-[11.5px] text-red-300">{(run.error as Error).message}</p>}
        </div>
      </div>

      {jobForLatest.map((job) => (
        <RewriteJobView key={job.id} projectId={projectId} episodeId={episodeId} job={job} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function RewriteJobView({
  projectId,
  episodeId,
  job,
  onUpdate,
}: {
  projectId: string;
  episodeId: string;
  job: RewriteJob;
  onUpdate: (r: HumanReadPipelineResponse) => void;
}) {
  const promote = useMutation({
    mutationFn: () => api.promoteRewriteJob(projectId, episodeId, job.id),
    onSuccess: onUpdate,
  });
  const reject = useMutation({
    mutationFn: () => api.rejectRewriteJob(projectId, episodeId, job.id),
    onSuccess: onUpdate,
  });
  const busy = promote.isPending || reject.isPending;
  const protectedTouched = job.diff.some((d) => d.protectedTouched);

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-serif text-bone-50">
          Diff review · {job.scenesRewritten} scene{job.scenesRewritten === 1 ? "" : "s"} rewritten ·{" "}
          {job.scenesUntouched} untouched
        </div>
        <span
          className={
            "rounded-md border px-2 py-0.5 text-[10.5px] " +
            (job.rewriteStatus === "promoted"
              ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-100"
              : job.rewriteStatus === "rejected"
              ? "border-red-700/40 bg-red-950/30 text-red-200"
              : "border-sky-700/40 bg-sky-900/20 text-sky-100")
          }
        >
          {job.rewriteStatus === "promoted"
            ? `Promoted → Draft ${job.newDraftNumber}`
            : job.rewriteStatus === "rejected"
            ? "Rejected"
            : "Awaiting approval"}
        </span>
      </div>

      <p className="mt-1 text-[11.5px] text-bone-400">
        The source draft is unchanged. Approving mints a new draft version; rejecting discards this
        rewrite.
      </p>

      {protectedTouched && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-700/40 bg-amber-950/25 p-2 text-[11.5px] text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          A protected element was touched in at least one scene — review carefully before promoting.
        </div>
      )}

      {job.continuityRisks.length > 0 && (
        <div className="mt-2 text-[11.5px] text-bone-300">
          <span className="text-bone-500">Continuity risks:</span> {job.continuityRisks.join(" · ")}
        </div>
      )}

      <div className="mt-2 space-y-2">
        {job.diff.map((d) => (
          <details key={d.ord} className="rounded-md border border-white/8 bg-black/20 p-2" open={d.changed}>
            <summary className="cursor-pointer text-[12px] text-bone-100">
              Scene {d.ord} · {d.heading}{" "}
              {d.changed ? (
                <span className="text-emerald-300">— changed</span>
              ) : (
                <span className="text-bone-500">— unchanged</span>
              )}
              {d.protectedTouched && <span className="ml-1 text-amber-300">⚠ protected</span>}
            </summary>
            {d.changeSummary && <div className="mt-1 text-[11.5px] text-bone-400">{d.changeSummary}</div>}
            {d.changed && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-red-900/30 bg-red-950/10 p-2 text-[11px] text-bone-300">
                  {d.before}
                </pre>
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-emerald-900/30 bg-emerald-950/10 p-2 text-[11px] text-bone-100">
                  {d.after}
                </pre>
              </div>
            )}
          </details>
        ))}
      </div>

      {job.rewriteStatus === "complete" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => promote.mutate()} disabled={busy}>
            {promote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />}
            Approve New Version
          </Button>
          <Button variant="outline" onClick={() => reject.mutate()} disabled={busy}>
            {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
            Reject Rewrite
          </Button>
          {(promote.isError || reject.isError) && (
            <p className="mt-1 w-full text-[11.5px] text-red-300">
              {((promote.error || reject.error) as Error).message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
  projectId,
  episodeId,
  proposal,
  onUpdate,
}: {
  projectId: string;
  episodeId: string;
  proposal: ChangeProposal;
  onUpdate: (r: HumanReadPipelineResponse) => void;
}) {
  const [notes, setNotes] = useState(proposal.creatorDecisionNotes);
  const patch = useMutation({
    mutationFn: (body: { approvalStatus?: ApprovalStatus; creatorDecisionNotes?: string }) =>
      api.patchChangeProposal(projectId, episodeId, proposal.id, body),
    onSuccess: onUpdate,
  });
  const setStatus = (s: ApprovalStatus) => patch.mutate({ approvalStatus: s });
  const status = proposal.approvalStatus;
  const sm = STATUS_META[status];

  const StatusBtn = ({ s, icon, label }: { s: ApprovalStatus; icon: React.ReactNode; label: string }) => (
    <button
      onClick={() => setStatus(s)}
      disabled={patch.isPending}
      className={
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-50 " +
        (status === s ? STATUS_META[s].chip : "border-white/10 text-bone-400 hover:text-bone-100")
      }
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="font-serif text-bone-50">{proposal.title}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] ${RISK_CHIP[proposal.riskLevel]}`}>
            {proposal.riskLevel} risk
          </span>
          <span className={`rounded-md border px-2 py-0.5 text-[10px] ${sm.chip}`}>{sm.label}</span>
        </div>
      </div>

      <Field label="Problem">{proposal.problem}</Field>
      {proposal.evidence && <Field label="Why it matters (from the read)">{proposal.evidence}</Field>}
      <Field label="Proposed fix">{proposal.proposedSolution}</Field>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        <Field label="Scenes affected">
          {proposal.scenesAffected.length ? proposal.scenesAffected.join(", ") : "—"}
        </Field>
        <Field label="Rewrite scope">{proposal.rewriteScope || "—"}</Field>
      </div>
      {proposal.protectedElements.length > 0 && (
        <div className="mt-2">
          <div className="text-[10.5px] uppercase tracking-wide text-bone-500">Protect these elements</div>
          <ul className="mt-1 space-y-0.5">
            {proposal.protectedElements.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] text-bone-300">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-sky-300/70" />
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => {
          if (notes !== proposal.creatorDecisionNotes) patch.mutate({ creatorDecisionNotes: notes });
        }}
        rows={2}
        placeholder="Creator notes — e.g. 'Approve, but subtle. No exposition. One moment of recognition only.'"
        className="mt-3 w-full resize-y rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-[12px] text-bone-100 placeholder:text-bone-500 focus:border-ember-500/60 focus:outline-none"
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBtn s="approved" icon={<Check className="h-3 w-3" />} label="Approve" />
        <StatusBtn s="rejected" icon={<X className="h-3 w-3" />} label="Reject" />
        <StatusBtn s="revise" icon={<Pencil className="h-3 w-3" />} label="Revise" />
        <StatusBtn s="hold" icon={<PauseCircle className="h-3 w-3" />} label="Hold" />
        <StatusBtn s="auto_safe" icon={<ShieldCheck className="h-3 w-3" />} label="Auto-safe" />
        {patch.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-bone-400" />}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-[10.5px] uppercase tracking-wide text-bone-500">{label}</div>
      <div className="text-[12.5px] text-bone-200">{children}</div>
    </div>
  );
}
