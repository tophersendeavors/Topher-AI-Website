import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Pencil, PauseCircle, Wand2, Loader2, ShieldCheck, Sparkles, Lock } from "lucide-react";
import type {
  ApprovalStatus,
  ChangeProposal,
  HumanReadPipelineResponse,
  ProposalRisk,
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

          {/* Locked change sets */}
          {changeSets.length > 0 && (
            <div className="mt-3 space-y-2">
              {changeSets.map((cs) => (
                <div
                  key={cs.id}
                  className="rounded-md border border-emerald-700/30 bg-emerald-950/15 p-3 text-[12px] text-bone-200"
                >
                  <div className="flex items-center gap-2 text-emerald-200">
                    <ShieldCheck className="h-4 w-4" />
                    Approved Change Set locked · {cs.approvedProposalIds.length} change
                    {cs.approvedProposalIds.length === 1 ? "" : "s"} · {new Date(cs.createdAt).toLocaleString()}
                  </div>
                  <div className="mt-1 text-bone-400">
                    {cs.lockedPromptPayload.protectedElements.length} protected element
                    {cs.lockedPromptPayload.protectedElements.length === 1 ? "" : "s"} ·{" "}
                    {cs.lockedPromptPayload.rewriteBoundaries.length} scope boundar
                    {cs.lockedPromptPayload.rewriteBoundaries.length === 1 ? "y" : "ies"}. This payload —
                    and only this — is what the controlled rewrite will receive.
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-bone-500">
                Next: the controlled rewrite runs from this locked set, produces a new draft version, and
                shows you a diff to approve or reject (Phase 2).
              </p>
            </div>
          )}
        </>
      )}
    </Panel>
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
