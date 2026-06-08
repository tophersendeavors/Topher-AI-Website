// Guided Production Workflow page (Stage 5).
//
//   /projects/:projectId/episodes/:episodeId/workflow
//
// Left rail: 12 stages with status pills + lock icons.
// Center: the current stage's detail panel (6-question framework).
// Stage 2 has a dedicated Role Assignment screen.
//
// All raw database paths are hidden from the user; the Canon Target Picker
// is used wherever a path is needed.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Bot, Check, CheckCircle2, Circle, ClipboardCheck, Clock, Lock, Lightbulb,
  Loader2, RefreshCw, User, Users, AlertTriangle, ChevronRight,
} from "lucide-react";
import {
  api,
  type CanonCatalog,
  type CreativeInfluencePreset,
  type WorkflowReport,
  type WorkflowRoleAssignment,
  type WorkflowRoleMeta,
  type WorkflowStageDeliverable,
  type WorkflowStageKey,
  type WorkflowStageState,
  type WorkflowStageStatus,
  type ProjectMemberRow,
} from "@/lib/api";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { DepartmentWorkspaceContent } from "@/features/departments/DepartmentWorkspacePage";
import { AIVideoPromptsPanel } from "@/features/drafts/AIVideoPromptsPanel";
import { PreflightCard } from "@/features/preflight/PreflightCard";
import { AIProposalView } from "./AIProposalView";
import { DPLocationConstraintsPanel } from "./DPLocationConstraints";
import { ContinuityPanel } from "./ContinuityPanel";
import { PromptSupervisorBoard } from "./PromptSupervisorBoard";

// Canonical top-down production order. This is the order the sidebar +
// "Stage N of 12" counters always render in — never Object.keys, which
// returns whatever insertion order Postgres / JSON happened to give us.
const STAGE_ORDER: WorkflowStageKey[] = [
  "script_approved",
  "roles_assigned",
  "production_design",
  "art_dept",
  "props",
  "wardrobe_hmu",
  "blocking",
  "cinematography",
  "continuity",
  "prompt_supervisor",
  "preflight",
  "generate",
];

/** Phase groupings shown as dividers in the left rail. Each phase
 *  bundles a set of stages that belong to the same production beat,
 *  so a non-technical creative can scan PLAN → VISUAL CANON →
 *  COVERAGE → DELIVERY without counting to 12. */
const STAGE_PHASES: Array<{ label: string; keys: WorkflowStageKey[] }> = [
  { label: "Plan", keys: ["script_approved", "roles_assigned"] },
  {
    label: "Visual canon",
    keys: ["production_design", "art_dept", "props", "wardrobe_hmu"],
  },
  { label: "Coverage", keys: ["blocking", "cinematography"] },
  {
    label: "Delivery",
    keys: ["continuity", "prompt_supervisor", "preflight", "generate"],
  },
];

const STAGE_LABEL: Record<WorkflowStageKey, string> = {
  script_approved: "Script Approved",
  roles_assigned: "Assign Roles",
  production_design: "Production Design",
  art_dept: "Art Direction / Set Dressing",
  props: "Props",
  wardrobe_hmu: "Wardrobe / Hair / Makeup",
  blocking: "Blocking / Movement",
  cinematography: "Cinematography",
  continuity: "Continuity",
  prompt_supervisor: "Prompt Supervisor",
  preflight: "Preflight",
  generate: "Generate Clips",
};

const STAGE_OWNER_HINT: Record<WorkflowStageKey, string> = {
  script_approved: "Writer / Showrunner",
  roles_assigned: "Showrunner / Producer",
  production_design: "Production Designer",
  art_dept: "Art Director / Set Decorator",
  props: "Propmaster",
  wardrobe_hmu: "Wardrobe + HMU Heads",
  blocking: "Director",
  cinematography: "Cinematographer / DP",
  continuity: "Script Supervisor",
  prompt_supervisor: "Prompt Supervisor",
  preflight: "Quality Control",
  generate: "Production",
};

// "canon" stages — the user explicitly approves AI-proposed values per
// deliverable (Production Design, Art Dept, Props, Wardrobe/HMU).
// "review" stages — the user reads a check / summary that was computed
// from earlier briefs and decides whether to accept it. There's no
// per-row Approve as canon; just one stage-level Approve button.
// "milestone" stages — pure gates with no embedded work (Script
// Approved, Assign Roles, Generate).
type StageKind = "canon" | "review" | "milestone";

const STAGE_KIND: Record<WorkflowStageKey, StageKind> = {
  script_approved: "milestone",
  roles_assigned: "milestone",
  production_design: "canon",
  art_dept: "canon",
  props: "canon",
  wardrobe_hmu: "canon",
  // Blocking + Cinematography are CANON stages (corrected from review).
  // The Director and DP need to see, approve, and regenerate every
  // shot's start position / eyeline / framing / lens / view zone.
  blocking: "canon",
  cinematography: "canon",
  continuity: "review",
  prompt_supervisor: "review",
  preflight: "review",
  generate: "milestone",
};

// One short line, "what are you actually approving here?" — pinned at
// the top of every stage so you never have to guess.
const STAGE_APPROVING: Record<WorkflowStageKey, string> = {
  script_approved:
    "You're approving that the screenplay is locked and ready for production.",
  roles_assigned:
    "You're confirming every creative role has been assigned (AI or person).",
  production_design:
    "You're approving AI-proposed location identity, walls, floor, ceiling — these become locked canon.",
  art_dept:
    "You're approving AI-proposed comforter, sheets, pillows, wall décor, and clutter level — locked canon.",
  props:
    "You're approving the visual canon (look + handling rules) for each hero prop in this episode.",
  wardrobe_hmu:
    "You're approving the wardrobe top and hair state for each character in this episode.",
  blocking:
    "You're approving each shot's start position + eyeline target — where characters stand and where they look. Approve per shot or regenerate.",
  cinematography:
    "You're approving each shot's framing + lens + camera view zone. Approve per shot or regenerate.",
  continuity:
    "You're acknowledging the continuity pass found zero failures. Review check, not new canon.",
  prompt_supervisor:
    "You're confirming a model-ready prompt has been generated for every shot. Use the embedded panel below to inspect.",
  preflight:
    "You're confirming Preflight reports overall: ready (all upstream gates clean).",
  generate:
    "You're acknowledging that clip generation is unlocked. This is the final stage.",
};

const STAGE_NEXT_HINT: Record<WorkflowStageKey, string> = {
  script_approved: "Roles get assigned next.",
  roles_assigned: "Production Design begins.",
  production_design: "Art Direction can finalize set dressing.",
  art_dept: "Props can lock placement; Cinematography can finalize.",
  props: "Blocking + Cinematography can finalize.",
  wardrobe_hmu: "Character-visible shot prompts unlock.",
  blocking: "Cinematography finalizes shot design.",
  cinematography: "Prompt Supervisor compiles model prompts.",
  continuity: "Prompt Supervisor verifies + approves.",
  prompt_supervisor: "Preflight runs the final readiness check.",
  preflight: "Generate becomes available.",
  generate: "Dailies review.",
};

export function WorkflowPage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  if (!projectId || !episodeId) return null;
  const qc = useQueryClient();

  // Resolve the current=true script for this episode.
  const scriptQ = useQuery({
    queryKey: ["episode-current-script", episodeId],
    queryFn: async () => api.getEpisodeCurrentScreenplay(episodeId),
  });
  const scriptId = scriptQ.data?.script?.id as string | undefined;

  const workflowQ = useQuery({
    queryKey: ["workflow", scriptId],
    queryFn: () => api.getWorkflow(scriptId!),
    enabled: !!scriptId,
  });

  const [selectedStage, setSelectedStage] = useState<WorkflowStageKey | null>(null);
  const stages = workflowQ.data?.state.stages;
  const currentKey = workflowQ.data?.currentStageKey;
  const activeStage = (selectedStage ?? currentKey) as WorkflowStageKey | undefined;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["workflow", scriptId] });
  };

  if (scriptQ.isLoading || (!!scriptId && workflowQ.isLoading)) {
    return (
      <div className="p-6 text-sm text-bone-400">
        <Loader2 className="inline animate-spin h-4 w-4 mr-1" /> Loading production workflow…
      </div>
    );
  }
  if (!scriptId) {
    return (
      <div className="p-6 text-sm text-bone-400">
        This episode has no approved screenplay yet. Approve a screenplay first.
      </div>
    );
  }
  if (!workflowQ.data || !stages || !activeStage) {
    return (
      <div className="p-6 text-sm text-red-300">
        Failed to load workflow. {(workflowQ.error as Error)?.message ?? ""}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      {/* Breadcrumb — always shows where you are. */}
      <nav className="text-[11px] text-bone-500 mb-4 flex items-center gap-1.5 uppercase tracking-wider">
        <Link to={`/projects/${projectId}/episodes`} className="hover:text-bone-200 transition">
          Episodes
        </Link>
        <ChevronRight size={10} className="opacity-60" />
        <span className="text-bone-300">
          {workflowQ.data.episodeNumber != null
            ? `EP${String(workflowQ.data.episodeNumber).padStart(2, "0")} — ${workflowQ.data.episodeTitle ?? ""}`
            : "Episode"}
        </span>
        <ChevronRight size={10} className="opacity-60" />
        <span className="text-bone-100">{STAGE_LABEL[activeStage]}</span>
      </nav>
      <OnboardingBanner />
      <StalePromptsPanel scriptId={scriptId} onChange={refresh} />

      <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-5 os-fade-in">
        {/* Production timeline — glass rail with phase acts + status spine */}
        <aside
          className="os-rail md:sticky md:self-start"
          style={{ top: 16, maxHeight: "calc(100vh - 32px)" }}
        >
          <div className="os-rail-head">
            <div className="os-eyebrow os-eyebrow-gold">
              ◆ Production Workflow
            </div>
            <h2 className="os-rail-title">
              {workflowQ.data.episodeNumber != null
                ? `Episode ${String(workflowQ.data.episodeNumber).padStart(2, "0")} — ${workflowQ.data.episodeTitle ?? ""}`
                : "Episode"}
            </h2>
            <p className="os-rail-logline">
              Every stage unlocks the next. No stage skips — the workflow holds
              until each department signs off.
            </p>
            <button
              type="button"
              onClick={refresh}
              className="os-eyebrow"
              style={{
                background: "transparent",
                border: 0,
                cursor: "pointer",
                padding: 0,
                display: "inline-flex",
                gap: 6,
                alignItems: "center",
              }}
              title="Refresh workflow"
            >
              <RefreshCw size={11} /> Refresh
            </button>
          </div>
          <ProgressMeter stages={stages} />
          <div className="os-rail-timeline">
            {STAGE_PHASES.map((phase, i) => (
              <div className="os-phase" key={phase.label}>
                <div className="os-phase-head">
                  <span className="os-phase-act">
                    {romanNumerals[i] ?? `${i + 1}`}
                  </span>
                  <span className="os-phase-label">{phase.label}</span>
                  <span className="os-phase-rule" />
                </div>
                <div className="os-phase-stages">
                  {phase.keys.map((k) => {
                    const stage = stages[k];
                    if (!stage) return null;
                    const ix = STAGE_ORDER.indexOf(k);
                    const isActive = activeStage === k;
                    return (
                      <OsStageRow
                        key={k}
                        index={ix + 1}
                        stageKey={k}
                        stage={stage}
                        isActive={isActive}
                        onClick={() => setSelectedStage(k)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Center detail */}
        <div className="min-w-0">
          <StageDetail
            scriptId={scriptId}
            projectId={projectId}
            stageKey={activeStage}
            report={workflowQ.data}
            onChange={refresh}
            onJumpToStage={(k) => setSelectedStage(k)}
          />
        </div>
      </div>
    </div>
  );
}

const romanNumerals = ["I", "II", "III", "IV"];

/** Production-progress meter for the rail head. Counts approved stages
 *  out of total and renders the amber gradient. */
function ProgressMeter({
  stages,
}: {
  stages: Record<WorkflowStageKey, WorkflowStageState>;
}) {
  const keys = Object.keys(stages) as WorkflowStageKey[];
  const done = keys.filter((k) => stages[k]?.status === "approved").length;
  const total = keys.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="os-meter">
      <div className="os-meter-top">
        <span className="os-eyebrow">Production progress</span>
        <span className="os-meter-num">
          <b>{done}</b> of {total}
        </span>
      </div>
      <div className="os-meter-track">
        <div className="os-meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** OS-styled stage row with spine + status node. Replaces the old
 *  Tailwind-utility StageRow but renders the same data + click behavior. */
function OsStageRow({
  index,
  stageKey,
  stage,
  isActive,
  onClick,
}: {
  index: number;
  stageKey: WorkflowStageKey;
  stage: WorkflowStageState;
  isActive: boolean;
  onClick: () => void;
}) {
  const status = stage.status;
  const nodeCls =
    status === "approved"
      ? "os-stage-node-approved"
      : status === "in_progress"
        ? "os-stage-node-active"
        : status === "blocked"
          ? "os-stage-node-attn"
          : status === "locked"
            ? "os-stage-node-locked"
            : "";
  const statusLabel =
    status === "approved"
      ? "Approved"
      : status === "in_progress"
        ? "In progress"
        : status === "blocked"
          ? "Needs attention"
          : status === "locked"
            ? "Locked"
            : "Available";
  const statusCls =
    status === "approved"
      ? "os-stage-status-approved"
      : status === "in_progress"
        ? "os-stage-status-active"
        : status === "blocked"
          ? "os-stage-status-attn"
          : status === "locked"
            ? "os-stage-status-locked"
            : "";
  const rowCls =
    "os-stage-row" +
    (isActive ? " is-on" : "") +
    (status === "locked" ? " is-locked" : "");
  return (
    <button type="button" onClick={onClick} className={rowCls}>
      <span className="os-stage-spine">
        <span className={"os-stage-node " + nodeCls}>
          {status === "approved" && <CheckCircle2 size={9} strokeWidth={3} />}
          {status === "locked" && <Lock size={8} strokeWidth={2.4} />}
        </span>
      </span>
      <span className="os-stage-body">
        <span className="os-stage-n">{String(index).padStart(2, "0")}</span>
        <span className="os-stage-title">{STAGE_LABEL[stageKey]}</span>
        <span className={"os-stage-status " + statusCls}>
          {statusLabel}
          {stage.approvalProgress &&
          stage.approvalProgress.approveable > 0 &&
          stage.approvalProgress.requiredRatio > 0 &&
          status !== "approved"
            ? ` · ${stage.approvalProgress.approved}/${stage.approvalProgress.approveable}`
            : ""}
        </span>
      </span>
    </button>
  );
}

// ============================================================================
// Stage row in the left rail
// ============================================================================

function StatusIcon({ status }: { status: WorkflowStageStatus }) {
  if (status === "approved")
    return <CheckCircle2 size={14} className="text-emerald-300 shrink-0" />;
  if (status === "locked") return <Lock size={14} className="text-bone-500 shrink-0" />;
  if (status === "in_progress")
    return <Clock size={14} className="text-amber-300 shrink-0" />;
  if (status === "blocked")
    return <AlertTriangle size={14} className="text-red-300 shrink-0" />;
  return <Circle size={14} className="text-bone-400 shrink-0" />;
}

function StageRow({
  index,
  stageKey,
  stage,
  isActive,
  onClick,
}: {
  index: number;
  stageKey: WorkflowStageKey;
  stage: WorkflowStageState;
  isActive: boolean;
  onClick: () => void;
}) {
  // Stage-row visual treatment: cinematic, scannable. The active row
  // gets a left accent rail in sky to read like a marker on a timeline;
  // approved rows go quiet bone-300; locked rows fade.
  const isLocked = stage.status === "locked";
  const isApproved = stage.status === "approved";
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "w-full text-left rounded-md pl-2.5 pr-2 py-2 flex items-center gap-2 transition relative " +
        (isActive
          ? "bg-white/[0.05] ring-1 ring-sky-700/50 shadow-[inset_3px_0_0_0_rgb(56_189_248_/_0.7)]"
          : "hover:bg-white/[0.04]")
      }
    >
      <span
        className={
          "text-[10px] tabular-nums w-4 shrink-0 " +
          (isLocked ? "text-bone-600" : isApproved ? "text-emerald-500/70" : "text-bone-500")
        }
      >
        {index}
      </span>
      <StatusIcon status={stage.status} />
      <span
        className={
          "text-[13px] flex-1 line-clamp-1 leading-tight " +
          (isLocked
            ? "text-bone-500"
            : isApproved
              ? "text-bone-200"
              : isActive
                ? "text-bone-50 font-medium"
                : "text-bone-100")
        }
      >
        {STAGE_LABEL[stageKey]}
      </span>
      {stage.approvalProgress &&
        stage.approvalProgress.approveable > 0 &&
        stage.approvalProgress.requiredRatio > 0 &&
        stage.status !== "approved" && (
          <span
            className={
              "text-[10px] rounded-full px-1.5 py-0.5 shrink-0 ring-1 " +
              (stage.approvalProgress.meetsGate
                ? "bg-emerald-900/30 text-emerald-200 ring-emerald-700/40"
                : "bg-white/[0.06] text-bone-300 ring-white/10")
            }
            title={`${stage.approvalProgress.approved}/${stage.approvalProgress.approveable} approved as canon`}
          >
            {stage.approvalProgress.approved}/{stage.approvalProgress.approveable}
          </span>
        )}
      <ChevronRight size={12} className="text-bone-500 shrink-0" />
    </button>
  );
}

// ============================================================================
// Stage detail (the 6-question framework)
// ============================================================================

function StageDetail({
  scriptId,
  projectId,
  stageKey,
  report,
  onChange,
  onJumpToStage,
}: {
  scriptId: string;
  projectId: string;
  stageKey: WorkflowStageKey;
  report: WorkflowReport;
  onChange: () => void;
  /** Jump the right-hand panel to a different stage — used by the
   *  locked-stage banner so users can click "Go to Preflight" without
   *  hunting the sidebar. */
  onJumpToStage?: (k: WorkflowStageKey) => void;
}) {
  const stage = report.state.stages[stageKey];
  const deliverables = report.deliverables[stageKey] ?? [];

  const approve = useMutation({
    mutationFn: (opts?: { force?: boolean }) =>
      api.approveWorkflowStage(scriptId, stageKey, opts?.force),
    onSuccess: onChange,
  });
  const requestChanges = useMutation({
    mutationFn: (notes?: string) =>
      api.requestWorkflowChanges(scriptId, stageKey, notes),
    onSuccess: onChange,
  });

  // Review-stage gate (Continuity / Preflight / Prompt Supervisor).
  // Returns blockers + warnings; canon stages return empty arrays and
  // are gated by approvalProgress instead (StageGateBanner).
  const reviewStageKeys: WorkflowStageKey[] = ["continuity", "preflight", "prompt_supervisor"];
  const isReviewStage = reviewStageKeys.includes(stageKey);
  const reviewGateQ = useQuery({
    queryKey: ["review-gate", scriptId, stageKey],
    queryFn: () => api.getStageReviewGate(scriptId, stageKey),
    enabled: isReviewStage && stage.status !== "locked" && stage.status !== "approved",
  });
  const reviewGate = reviewGateQ.data;
  const hasBlockers = !!reviewGate && reviewGate.blockers.length > 0;
  const hasWarnings = !!reviewGate && reviewGate.warnings.length > 0;

  // Determine next stage label (use canonical order, NOT Object.keys order).
  const ix = STAGE_ORDER.indexOf(stageKey);
  const nextStageKey = STAGE_ORDER[ix + 1];

  // Stage hero chip status — maps stage status to the OS-chip variant.
  const heroChip =
    stage.status === "approved"
      ? { cls: "os-chip-approved", label: "Approved" }
      : stage.status === "in_progress"
        ? { cls: "os-chip-active", label: "In progress" }
        : stage.status === "blocked"
          ? { cls: "os-chip-attn", label: "Needs attention" }
          : stage.status === "locked"
            ? { cls: "os-chip-locked", label: "Locked" }
            : { cls: "", label: "Available" };
  return (
    <div className="os-stage-detail os-fade-in">
      {stage.status === "locked" && (
        <LockedBanner
          blockedBy={stage.blockedBy}
          onJumpToStage={(k) => onJumpToStage?.(k)}
        />
      )}

      {/* Editorial hero — eyebrow + display headline + credit row */}
      <div className="os-stage-hero">
        <div className="os-stage-hero-top">
          <div className="os-eyebrow os-eyebrow-gold">
            {`Stage ${String(ix + 1).padStart(2, "0")} · ${STAGE_LABEL[stageKey]}`}
          </div>
          <span className={"os-chip " + heroChip.cls}>{heroChip.label}</span>
        </div>
        <h1 className="os-stage-hero-h1">{STAGE_APPROVING[stageKey]}</h1>
        <div className="os-stage-hero-credit">
          <div>
            <div className="os-credit-label">Owned by</div>
            <div className="os-credit-name">{STAGE_OWNER_HINT[stageKey]}</div>
            {stage.approvedAt && (
              <div className="os-credit-label" style={{ marginTop: 4 }}>
                Approved {new Date(stage.approvedAt).toLocaleString()}
              </div>
            )}
          </div>
          {nextStageKey && (
            <div className="os-unlocks">
              <div className="os-credit-label">Unlocks next</div>
              <div className="os-unlocks-row">
                <ChevronRight size={14} style={{ color: "var(--os-t-4)" }} />
                <span>{STAGE_LABEL[nextStageKey]}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Stage 2 — Role Assignment screen */}
      {stageKey === "roles_assigned" && (
        <RoleAssignmentScreen
          scriptId={scriptId}
          report={report}
          onChange={onChange}
        />
      )}

      {/* All other stages — top-down order:
       *   1. The actionable AI proposals / department workspace (do the work)
       *   2. Status recap — what's approved, what's still needed
       *   3. Forward-look — what happens when you approve, what unlocks next
       *   4. Stage-level Approve / Request changes (rendered just below)
       */}
      {stageKey !== "roles_assigned" && stage.status !== "locked" && (
        <StageEmbed
          stageKey={stageKey}
          projectId={projectId}
          scriptId={scriptId}
          report={report}
          deliverables={deliverables}
          onChange={onChange}
        />
      )}

      {/* Generate stage locked on Preflight — show the PreflightCard
       *  inline with a deep-link to the Preflight stage so the user can
       *  see WHY and fix it without hunting (UX_RULES #18). */}
      {stageKey === "generate" &&
        stage.status === "locked" &&
        stage.blockedBy.includes("preflight" as WorkflowStageKey) && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="text-[10px] uppercase tracking-wide text-bone-400 mb-2 flex items-center justify-between">
              <span>Preflight readiness — what's blocking Generate</span>
              <button
                type="button"
                onClick={() => onJumpToStage?.("preflight" as WorkflowStageKey)}
                className="text-[10px] uppercase tracking-wide text-sky-200 hover:text-sky-100"
              >
                Open Preflight →
              </button>
            </div>
            <PreflightCard scriptId={scriptId} />
          </div>
        )}

      {stageKey !== "roles_assigned" && (
        <div className="mt-4">
          <SixQuestionFramework
            projectId={projectId}
            stageKey={stageKey}
            deliverables={deliverables}
            nextStageKey={nextStageKey}
            kind={STAGE_KIND[stageKey]}
            onChange={onChange}
          />
        </div>
      )}

      {/* Approve / Request changes — visible only when stage isn't locked */}
      {stage.status !== "locked" && stage.status !== "approved" && stageKey !== "roles_assigned" && (
        <div className="mt-4 pt-3 border-t border-white/10">
          {/* Canon-stage gate (Production Design / Art Direction / etc.) */}
          <StageGateBanner progress={stage.approvalProgress} />
          {/* Review-stage gate (Continuity / Preflight / Prompt Supervisor) */}
          {isReviewStage && reviewGate && (
            <ReviewStageGateBanner
              gate={reviewGate}
              stageLabel={STAGE_LABEL[stageKey]}
            />
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                // If only warnings (no blockers), confirm before
                // proceeding — warnings are recorded but allowed.
                if (isReviewStage && hasWarnings && !hasBlockers) {
                  const ok = window.confirm(
                    `${STAGE_LABEL[stageKey]} has ${reviewGate!.warnings.length} warning${reviewGate!.warnings.length === 1 ? "" : "s"}:\n\n${reviewGate!.warnings.map((w) => `• ${w}`).join("\n")}\n\nApprove with warnings? They will be recorded.`
                  );
                  if (!ok) return;
                }
                approve.mutate();
              }}
              disabled={
                approve.isPending ||
                (stage.approvalProgress ? !stage.approvalProgress.meetsGate : false) ||
                hasBlockers
              }
              title={
                hasBlockers
                  ? `${STAGE_LABEL[stageKey]} cannot be approved yet. Resolve ${reviewGate!.blockers.length} blocking issue${reviewGate!.blockers.length === 1 ? "" : "s"}, then re-run the pass.`
                  : stage.approvalProgress && !stage.approvalProgress.meetsGate
                    ? `Approve more deliverables first (${stage.approvalProgress.approved}/${stage.approvalProgress.approveable})`
                    : undefined
              }
            >
              {approve.isPending && !approve.variables?.force ? (
                <Loader2 size={12} className="animate-spin mr-1" />
              ) : (
                <CheckCircle2 size={12} className="mr-1" />
              )}
              Approve this stage
            </Button>
            {/* Showrunner override — only renders when there are
             *  blockers. Stern confirm. Logged in script.metadata.
             *  TODO: role-restrict to Showrunner/Admin once roles ship. */}
            {isReviewStage && hasBlockers && (
              <Button
                variant="outline"
                onClick={() => {
                  const ok = window.confirm(
                    `OVERRIDE — approve ${STAGE_LABEL[stageKey]} with unresolved blocking issues?\n\n${reviewGate!.blockers.map((b) => `• ${b}`).join("\n")}\n\nThis bypasses the gate and is recorded as a Showrunner override on the script. Use only when you have authority to ship the stage as-is.\n\nProceed?`
                  );
                  if (ok) approve.mutate({ force: true });
                }}
                disabled={approve.isPending}
                title="Showrunner override — bypass the gate. Recorded in the script."
                className="border-amber-700/40 text-amber-200 hover:bg-amber-900/20"
              >
                {approve.isPending && approve.variables?.force ? (
                  <Loader2 size={12} className="animate-spin mr-1" />
                ) : (
                  <AlertTriangle size={12} className="mr-1" />
                )}
                Override and approve anyway
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                const notes = window.prompt("Request changes — note for the team?") ?? undefined;
                requestChanges.mutate(notes);
              }}
              disabled={requestChanges.isPending}
            >
              Request changes
            </Button>
            {approve.error && (
              <div className="text-xs text-red-300 w-full">
                {(approve.error as Error).message}
              </div>
            )}
          </div>
        </div>
      )}
      {stage.status === "approved" && (
        <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle2 size={14} /> Stage approved. Next stage unlocked.
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm("Reopen this stage for changes?")) requestChanges.mutate(undefined);
            }}
          >
            Reopen
          </Button>
        </div>
      )}
    </div>
  );
}

function LockedBanner({
  blockedBy,
  onJumpToStage,
}: {
  blockedBy: WorkflowStageKey[];
  onJumpToStage: (k: WorkflowStageKey) => void;
}) {
  const labels = blockedBy.map((b) => STAGE_LABEL[b]).filter(Boolean);
  return (
    <div className="os-gate is-wait mb-4">
      <div className="os-gate-l">
        <div className="os-gate-ring is-wait">
          <Lock size={20} />
        </div>
        <div>
          <div className="os-gate-title">This stage is locked</div>
          <div className="os-gate-sub">
            Waiting on{" "}
            {labels.length > 0 ? (
              labels.map((l, i) => (
                <span key={l}>
                  <strong style={{ color: "var(--os-t-1)" }}>{l}</strong>
                  {i < labels.length - 1 ? ", " : ""}
                </span>
              ))
            ) : (
              "an earlier stage"
            )}
            . Finish what's needed there, then return here.
          </div>
        </div>
      </div>
      {blockedBy.length > 0 && (
        <div className="flex flex-col gap-1.5 shrink-0">
          {blockedBy.map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onJumpToStage(b)}
              className="os-btn os-btn-sm os-btn-ghost"
            >
              Go to {STAGE_LABEL[b]} <ChevronRight size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewStageGateBanner({
  gate,
  stageLabel,
}: {
  gate: { blockers: string[]; warnings: string[] };
  stageLabel: string;
}) {
  if (gate.blockers.length === 0 && gate.warnings.length === 0) return null;
  const blockers = gate.blockers;
  const warnings = gate.warnings;
  if (blockers.length > 0) {
    return (
      <div className="os-gate is-blocked">
        <div className="os-gate-l">
          <div className="os-gate-ring is-blocked">
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className="os-gate-title">{stageLabel} cannot be approved yet</div>
            <div className="os-gate-sub">
              {blockers.length} blocking issue{blockers.length === 1 ? "" : "s"} must be resolved — or use the Showrunner override.
            </div>
            <ul className="mt-2 space-y-0.5 text-[12px]" style={{ color: "var(--os-t-2)" }}>
              {blockers.map((b) => (
                <li key={b}>• {b}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="os-gate is-wait">
      <div className="os-gate-l">
        <div className="os-gate-ring is-wait">
          <AlertTriangle size={20} />
        </div>
        <div>
          <div className="os-gate-title">
            {stageLabel} has {warnings.length} warning{warnings.length === 1 ? "" : "s"}
          </div>
          <div className="os-gate-sub">
            You can approve with warnings — they'll be recorded. You'll be asked to confirm.
          </div>
          <ul className="mt-2 space-y-0.5 text-[12px]" style={{ color: "var(--os-t-2)" }}>
            {warnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function StageGateBanner({
  progress,
}: {
  progress?: {
    approved: number;
    approveable: number;
    requiredRatio: number;
    meetsGate: boolean;
  };
}) {
  if (!progress) return null;
  if (progress.approveable === 0) return null;
  if (progress.requiredRatio === 0) return null;
  const pct = Math.round((progress.approved / progress.approveable) * 100);
  const need = Math.round(progress.requiredRatio * 100);
  if (progress.meetsGate) {
    return (
      <div className="rounded border border-emerald-700/30 bg-emerald-900/10 px-2.5 py-1.5 text-xs text-emerald-200">
        ✓ Stage gate met — {progress.approved}/{progress.approveable} deliverables approved as canon ({pct}%).
        You can advance to the next stage.
      </div>
    );
  }
  return (
    <div className="rounded border border-amber-700/30 bg-amber-900/15 px-2.5 py-1.5 text-xs text-amber-100">
      <div className="flex items-center justify-between gap-2">
        <span>
          <strong>Stage gate not met.</strong> {progress.approved}/{progress.approveable} deliverables approved as canon ({pct}%) — need {need}% before you can advance.
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className="h-full bg-amber-400 transition-all"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/8 bg-white/[0.03] px-2.5 py-1.5 min-w-[140px]">
      <div className="text-[10px] uppercase tracking-wide text-bone-500">{label}</div>
      <div className="text-bone-100 text-xs leading-snug capitalize">{value}</div>
    </div>
  );
}

// ============================================================================
// 6-question framework (for every stage except roles_assigned)
// ============================================================================

function SixQuestionFramework({
  projectId,
  stageKey,
  deliverables,
  nextStageKey,
  kind,
  onChange,
}: {
  projectId: string;
  stageKey: WorkflowStageKey;
  deliverables: WorkflowStageDeliverable[];
  nextStageKey: WorkflowStageKey | undefined;
  kind: StageKind;
  onChange: () => void;
}) {
  // For canon stages, the recap MUST mirror the stage-advance gate
  // (which counts human-approved canon, NOT "bible has a value"). The
  // old logic split by `satisfied` and called the first bucket
  // "Already approved", which was misleading: every shot with a brief
  // value was counted as approved even when no human had clicked it.
  // We now split canon-stage recaps by `hasApprovedCanon` so the count
  // matches the gate banner above.
  const canonApprovable = deliverables.filter((d) => !!d.canonFieldPath);
  const canonApproved = canonApprovable.filter((d) => !!d.hasApprovedCanon);
  const canonAwaiting = canonApprovable.filter((d) => !d.hasApprovedCanon);
  // Review-stage fallback uses `satisfied` (legacy behavior).
  const satisfied = deliverables.filter((d) => d.satisfied);
  const missing = deliverables.filter((d) => !d.satisfied);

  // For review / milestone stages the "Already approved (N)" + "Still
  // needed (M)" framing is misleading — there's nothing to approve as
  // canon. Show a simple summary layout instead.
  if (kind !== "canon") {
    return (
      <div className="space-y-4 text-sm">
        <Section title="Review summary" icon={ClipboardCheck}>
          {deliverables.length === 0 && (
            <div className="text-xs text-bone-500">(nothing to review)</div>
          )}
          <ul className="space-y-1">
            {deliverables.map((d) => (
              <li
                key={d.key}
                className={
                  "rounded border px-2 py-1.5 " +
                  (d.satisfied
                    ? "border-emerald-700/30 bg-emerald-900/10"
                    : "border-amber-700/30 bg-amber-900/10")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-bone-100 text-xs">{d.label}</div>
                    {d.description && (
                      <div className="mt-0.5 text-[11px] text-bone-400 line-clamp-2">
                        {d.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {d.currentValue && (
                      <span className="text-[10px] text-bone-300 rounded-full bg-white/[0.06] ring-1 ring-white/10 px-1.5 py-0.5">
                        {d.currentValue}
                      </span>
                    )}
                    {d.satisfied ? (
                      <CheckCircle2 size={12} className="text-emerald-300" />
                    ) : (
                      <AlertTriangle size={12} className="text-amber-300" />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="What happens when you approve" icon={Lightbulb}>
          <p className="text-xs text-bone-300">
            {nextStageKey
              ? `${STAGE_LABEL[nextStageKey]} unlocks.`
              : "All upstream gates pass; final clip generation becomes available."}
          </p>
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Counts mirror the stage-advance gate: human-approved canon
       *  (hasApprovedCanon) vs awaiting your approval. "Bible has a
       *  value" alone does not count — see the gate banner above for
       *  the matching tally. */}
      <Section title={`Approved as canon (${canonApproved.length})`} icon={CheckCircle2}>
        {canonApproved.length === 0 && (
          <div className="text-xs text-bone-500">
            Nothing approved yet. The AI proposed values are above — review and click <strong>Approve as canon</strong> to lock them in.
          </div>
        )}
        <ul className="space-y-1">
          {canonApproved.map((d) => (
            <li
              key={d.key}
              className="rounded border border-emerald-700/30 bg-emerald-900/10 px-2 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-bone-100 text-xs">{d.label}</div>
                <CheckCircle2 size={12} className="text-emerald-300 shrink-0" />
              </div>
              {d.currentValue && (
                <div className="mt-0.5 text-[11px] text-bone-300 line-clamp-2">
                  {d.currentValue}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title={`Awaiting your approval (${canonAwaiting.length})`} icon={Circle}>
        {canonAwaiting.length === 0 && (
          <div className="text-xs text-emerald-300">
            Every deliverable has been approved. You can advance the stage.
          </div>
        )}
        <ul className="space-y-1">
          {canonAwaiting.slice(0, 20).map((d) => (
            <li
              key={d.key}
              className="rounded border border-amber-700/30 bg-amber-900/10 px-2 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-bone-100 text-xs">{d.label}</div>
                  {d.hasAIProposal && (
                    <div className="mt-0.5 text-[11px] text-sky-200">
                      AI has proposed a value — scroll up to review &amp; Approve.
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
          {canonAwaiting.length > 20 && (
            <li className="text-[11px] text-bone-500">
              …and {canonAwaiting.length - 20} more. All of them appear in the
              AI Proposals list above.
            </li>
          )}
        </ul>
      </Section>

      <Section title="What happens when you approve" icon={Lightbulb}>
        <p className="text-xs text-bone-300">
          {nextStageKey
            ? `${STAGE_LABEL[nextStageKey]} unlocks. Any prompts that depended on the current canon may be flagged as stale.`
            : "All upstream gates pass; final clip generation becomes available."}
        </p>
      </Section>

      <Section title="Next stage" icon={ChevronRight}>
        <p className="text-xs text-bone-300">
          {nextStageKey ? STAGE_LABEL[nextStageKey] : "(none — this is the final stage)"}
        </p>
      </Section>
      {/* Silence the unused-var linter — `satisfied` / `missing` are kept
       *  for review-stage branches above. */}
      <span style={{ display: "none" }}>{satisfied.length + missing.length}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof CheckCircle2;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-bone-400 mb-1">
        <Icon size={11} /> {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

// ============================================================================
// Stage 2 — Role Assignment Screen
// ============================================================================

function RoleAssignmentScreen({
  scriptId,
  report,
  onChange,
}: {
  scriptId: string;
  report: WorkflowReport;
  onChange: () => void;
}) {
  const projectId = (useParams<{ projectId: string }>().projectId) ?? "";
  const rolesQ = useQuery({
    queryKey: ["workflow-roles"],
    queryFn: () => api.getWorkflowRoles(),
  });
  const membersQ = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => api.getProjectMembers(projectId),
    enabled: !!projectId,
  });
  const influencesQ = useQuery({
    queryKey: ["creative-influences"],
    queryFn: () => api.getCreativeInfluences(),
  });
  const confirmRoles = useMutation({
    mutationFn: () => api.confirmWorkflowRoles(scriptId),
    onSuccess: onChange,
  });

  if (rolesQ.isLoading) {
    return (
      <div className="text-sm text-bone-400">
        <Loader2 className="inline animate-spin h-4 w-4 mr-1" /> Loading roles…
      </div>
    );
  }
  const roles = rolesQ.data?.roles ?? [];
  const members = membersQ.data?.members ?? [];
  const influences = influencesQ.data?.presets ?? [];

  const allAssigned = roles.every((r) => {
    const a = report.state.roleAssignments[r.key];
    return a && (a.assignmentType === "ai_generic" || a.status === "assigned");
  });

  return (
    <div className="space-y-3">
      <div className="text-sm text-bone-300">
        Assign every creative role for this episode. Each role can be played by the
        AI (Generic), an AI guided by a creative-influence preset, or a live human
        collaborator. Once you confirm the team, Production Design begins.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {roles.map((r) => (
          <RoleRow
            key={r.key}
            roleMeta={r}
            assignment={report.state.roleAssignments[r.key]}
            members={members}
            influences={influences}
            scriptId={scriptId}
            onChange={onChange}
          />
        ))}
      </div>

      <div className="pt-3 border-t border-white/10 flex flex-wrap items-center gap-2">
        <Button
          onClick={() => confirmRoles.mutate()}
          disabled={!allAssigned || confirmRoles.isPending}
        >
          {confirmRoles.isPending ? (
            <Loader2 size={12} className="animate-spin mr-1" />
          ) : (
            <CheckCircle2 size={12} className="mr-1" />
          )}
          Confirm team — unlock Production Design
        </Button>
        {!allAssigned && (
          <span className="text-[11px] text-amber-300">
            Some roles need an assignee or influence pick.
          </span>
        )}
      </div>
    </div>
  );
}

function RoleRow({
  roleMeta,
  assignment,
  members,
  influences,
  scriptId,
  onChange,
}: {
  roleMeta: WorkflowRoleMeta;
  assignment: WorkflowRoleAssignment | undefined;
  members: ProjectMemberRow[];
  influences: CreativeInfluencePreset[];
  scriptId: string;
  onChange: () => void;
}) {
  const a = assignment ?? {
    roleKey: roleMeta.key,
    assignmentType: "ai_generic",
    influenceKey: null,
    assigneeUserId: null,
    assigneeName: null,
    status: "unassigned" as const,
    updatedAt: new Date(0).toISOString(),
  };
  const update = useMutation({
    mutationFn: (body: {
      assignmentType: "ai_generic" | "ai_influence" | "live_person";
      influenceKey?: string | null;
      assigneeUserId?: string | null;
      assigneeName?: string | null;
    }) => api.setWorkflowRole(scriptId, roleMeta.key, body),
    onSuccess: onChange,
  });
  const relevantInfluences = influences.filter((i) =>
    roleMeta.influences.some((r) => r.key === i.key)
  );

  return (
    <div className="rounded border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div>
          <div className="text-sm text-bone-50 font-medium">{roleMeta.label}</div>
          <div className="text-[11px] text-bone-400 mt-0.5 line-clamp-2">
            {roleMeta.responsibility}
          </div>
        </div>
        <StatusChip status={a.status} />
      </div>

      <div className="mt-2 flex gap-1 text-xs items-center">
        <ToggleButton
          active={a.assignmentType === "ai_generic"}
          onClick={() =>
            update.mutate({ assignmentType: "ai_generic", influenceKey: null })
          }
          icon={Bot}
        >
          AI Generic
        </ToggleButton>
        <ToggleButton
          active={a.assignmentType === "ai_influence"}
          onClick={() =>
            update.mutate({ assignmentType: "ai_influence", influenceKey: null })
          }
          icon={Lightbulb}
          disabled={relevantInfluences.length === 0}
          title={
            relevantInfluences.length === 0
              ? "No creative influence presets defined for this role yet."
              : "AI plays this role, styled by a chosen production-principle preset."
          }
        >
          AI Influence
        </ToggleButton>
        <ToggleButton
          active={a.assignmentType === "live_person"}
          onClick={() =>
            update.mutate({ assignmentType: "live_person", assigneeUserId: null })
          }
          icon={User}
        >
          Live Person
        </ToggleButton>
        {update.isPending && (
          <Loader2 size={12} className="animate-spin text-bone-400 ml-1" />
        )}
        {update.isSuccess && !update.isPending && (
          <Check size={12} className="text-emerald-300 ml-1" />
        )}
      </div>
      {update.error && (
        <div className="mt-1 text-[11px] text-red-300">
          Failed: {(update.error as Error).message}
        </div>
      )}

      {a.assignmentType === "ai_influence" && (
        <div className="mt-2">
          <select
            className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-xs"
            value={a.influenceKey ?? ""}
            onChange={(e) =>
              update.mutate({
                assignmentType: "ai_influence",
                influenceKey: e.target.value || null,
              })
            }
          >
            <option value="">— pick a creative direction —</option>
            {relevantInfluences.map((i) => (
              <option key={i.key} value={i.key}>
                {i.label}
              </option>
            ))}
          </select>
          {a.influenceKey && (
            <div className="mt-1 text-[11px] text-bone-400 line-clamp-2">
              {relevantInfluences.find((i) => i.key === a.influenceKey)?.caption}
            </div>
          )}
        </div>
      )}

      {a.assignmentType === "live_person" && (
        <div className="mt-2">
          <select
            className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-xs"
            value={a.assigneeUserId ?? ""}
            onChange={(e) => {
              const m = members.find((mm) => mm.user_id === e.target.value);
              update.mutate({
                assignmentType: "live_person",
                assigneeUserId: e.target.value || null,
                assigneeName:
                  m?.profiles?.name ?? m?.profiles?.email ?? "(unknown)",
              });
            }}
          >
            <option value="">— pick a project member —</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.profiles?.name ?? m.profiles?.email ?? m.user_id.slice(0, 8)}
              </option>
            ))}
          </select>
          {members.length === 0 && (
            <div className="mt-1 text-[11px] text-amber-300">
              No other project members yet. Invite people on the Team page (coming soon).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: WorkflowRoleAssignment["status"] }) {
  const tone =
    status === "approved"
      ? "bg-emerald-900/40 text-emerald-200 ring-emerald-700/40"
      : status === "assigned"
        ? "bg-sky-900/40 text-sky-200 ring-sky-700/40"
        : "bg-white/[0.06] text-bone-400 ring-white/10";
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 ring-1 shrink-0 " +
        tone
      }
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function ToggleButton({
  active,
  onClick,
  icon: Icon,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bot;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "flex items-center gap-1 rounded px-2 py-1 transition " +
        (active
          ? "bg-sky-900/40 ring-1 ring-sky-700/40 text-sky-100"
          : "border border-white/10 bg-white/[0.02] text-bone-300 hover:bg-white/[0.06]") +
        (disabled ? " opacity-40 cursor-not-allowed" : "")
      }
    >
      <Icon size={11} /> {children}
    </button>
  );
}

// ============================================================================
// Stale-prompt panel (Stage 5.5 step C) — surfaces prompts whose stored text
// or references are out of sync with the latest approved canon, and lets
// the writer bulk-regen the affected shots.
// ============================================================================

function StalePromptsPanel({
  scriptId,
  onChange,
}: {
  scriptId: string;
  onChange: () => void;
}) {
  const q = useQuery({
    queryKey: ["stale-prompts", scriptId],
    queryFn: () => api.detectStalePrompts(scriptId),
  });
  const regen = useMutation({
    mutationFn: () => api.regenerateStalePrompts(scriptId),
    onSuccess: () => {
      q.refetch();
      onChange();
    },
  });

  if (q.isLoading)
    return (
      <Panel className="mb-4">
        <div className="text-xs text-bone-400">
          <Loader2 className="inline animate-spin h-3 w-3 mr-1" /> Checking for stale prompts…
        </div>
      </Panel>
    );
  if (!q.data) return null;
  const { stale, totalPrompts } = q.data;
  if (stale.length === 0) {
    return (
      <Panel className="mb-4">
        <div className="text-xs text-emerald-300 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> All {totalPrompts} prompts are up-to-date with the latest approved canon.
        </div>
      </Panel>
    );
  }
  return (
    <Panel className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-amber-200 flex items-center gap-1.5">
            <AlertTriangle size={14} /> {stale.length} stale prompt{stale.length === 1 ? "" : "s"} of {totalPrompts}
          </div>
          <p className="mt-0.5 text-xs text-bone-400">
            These prompts were generated before recent canon approvals. Regenerate so the
            new references and any text overrides flow into the prompt and its reference
            metadata.
          </p>
        </div>
        <Button
          onClick={() => {
            if (
              confirm(
                `Regenerate ${stale.length} stale prompt${stale.length === 1 ? "" : "s"}? This uses ~1 LLM call per prompt.`
              )
            )
              regen.mutate();
          }}
          disabled={regen.isPending}
        >
          {regen.isPending ? (
            <Loader2 size={12} className="animate-spin mr-1" />
          ) : (
            <RefreshCw size={12} className="mr-1" />
          )}
          Regenerate affected shots
        </Button>
      </div>
      <details className="mt-2 text-[11px] text-bone-300">
        <summary className="cursor-pointer hover:text-bone-100">
          Show what's stale ({stale.length})
        </summary>
        <ul className="mt-1.5 space-y-1">
          {stale.slice(0, 30).map((s, i) => (
            <li key={i} className="rounded border border-white/8 bg-white/[0.02] px-2 py-1">
              <div className="flex items-center gap-2">
                <span className="text-bone-200 text-xs">
                  {s.label ?? `Scene ${s.sceneOrd + 1} · Shot ${s.shotIndex} · ${s.model}`}
                </span>
              </div>
              <ul className="mt-0.5 list-disc pl-4 text-bone-400">
                {s.reasons.slice(0, 4).map((r, j) => (
                  <li key={j}>{r}</li>
                ))}
              </ul>
            </li>
          ))}
          {stale.length > 30 && (
            <li className="text-bone-500">…and {stale.length - 30} more</li>
          )}
        </ul>
      </details>
      {regen.error && (
        <div className="mt-2 text-xs text-red-300">{(regen.error as Error).message}</div>
      )}
      {regen.data && (
        <div className="mt-2 text-xs text-emerald-300">
          Regenerated {regen.data.regenerated} prompt(s).
        </div>
      )}
    </Panel>
  );
}

// ============================================================================
// StageEmbed — per-stage sub-tool (department workspaces, AI Video Prompts
// panel, Preflight). The existing pages still exist as standalone routes;
// this just shows the same content inline so the writer never has to
// leave the Workflow.
// ============================================================================

const STAGE_DEPT_MAP: Partial<Record<WorkflowStageKey, string>> = {
  production_design: "production_design",
  art_dept: "art_dept",
  props: "props",
  wardrobe_hmu: "wardrobe_hmu",
  // Stages 7 + 8 are canon now. The dept key drives the AI Proposal vs
  // Live Person Department Workspace branch in StageEmbed.
  blocking: "blocking",
  cinematography: "cinematography",
};

// Per-stage primary role key (drives the AI/Live Person branch).
const STAGE_PRIMARY_ROLE: Partial<Record<WorkflowStageKey, string>> = {
  production_design: "production_designer",
  art_dept: "art_director",
  props: "propmaster",
  wardrobe_hmu: "wardrobe",
  blocking: "blocking",
  cinematography: "cinematographer",
  continuity: "script_supervisor",
  prompt_supervisor: "prompt_supervisor",
  preflight: "quality_control",
};

function StageEmbed({
  stageKey,
  projectId,
  scriptId,
  report,
  deliverables,
  onChange,
}: {
  stageKey: WorkflowStageKey;
  projectId: string;
  scriptId: string;
  report: WorkflowReport;
  deliverables: WorkflowStageDeliverable[];
  onChange: () => void;
}) {
  const deptKey = STAGE_DEPT_MAP[stageKey];
  const roleKey = STAGE_PRIMARY_ROLE[stageKey];
  const assignment = roleKey ? report.state.roleAssignments[roleKey] : undefined;
  const isAI =
    assignment?.assignmentType === "ai_generic" ||
    assignment?.assignmentType === "ai_influence";
  const isLivePerson = assignment?.assignmentType === "live_person";

  if (deptKey) {
    // Stage 7 — AI roles get the AI-Proposal view (no inputs, only
    // approve / regen / regen-with-notes). Live Person roles get the
    // existing Department Workspace (uploads, URLs, notes, etc.).
    if (isAI) {
      return (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[10px] uppercase tracking-wide text-bone-400 mb-2">
            AI role · {assignment.assignmentType === "ai_influence" ? "Influence" : "Generic"}
          </div>
          {/* Cinematography stage gets a location-level constraints
           *  panel above the AI proposals. Rules entered here apply to
           *  EVERY shot's DP brief in that location on regen. */}
          {stageKey === "cinematography" && (
            <DPLocationConstraintsPanel scriptId={scriptId} onChange={onChange} />
          )}
          <AIProposalView
            scriptId={scriptId}
            projectId={projectId}
            stageKey={stageKey}
            deliverables={deliverables}
            departmentKey={deptKey}
            influenceKey={assignment.influenceKey ?? null}
            onChange={onChange}
          />
        </div>
      );
    }
    if (isLivePerson) {
      return (
        <div className="mt-4 border-t border-white/10 pt-4">
          <div className="text-[10px] uppercase tracking-wide text-bone-400 mb-2">
            Live Person · {assignment.assigneeName ?? "(unassigned)"} — upload references, notes, approve canon
          </div>
          <DepartmentWorkspaceContent projectId={projectId} deptKey={deptKey} scriptId={scriptId} />
        </div>
      );
    }
    // No assignment yet — show neither; the Approve gates will handle this.
    return (
      <div className="mt-4 text-xs text-bone-500">
        Role unassigned. Go back to Stage 2 and pick AI Generic / AI Influence / Live Person for this role.
      </div>
    );
  }

  if (stageKey === "continuity") {
    return (
      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="text-[10px] uppercase tracking-wide text-bone-400 mb-2">
          Continuity pass — review what the Script Supervisor's pass found, or run it fresh
        </div>
        <ContinuityPanel scriptId={scriptId} onChange={onChange} />
      </div>
    );
  }

  if (stageKey === "prompt_supervisor") {
    return (
      <div className="mt-4 border-t border-white/10 pt-4 space-y-6">
        <PromptSupervisorBoard
          scriptId={scriptId}
          onInspect={() => {
            // Scroll the AI Video Prompts panel into view so the supervisor
            // can drill into the specific shot they clicked.
            const el = document.getElementById("aivp-panel-anchor");
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        />
        <div id="aivp-panel-anchor">
          <div className="text-[10px] uppercase tracking-wide text-bone-400 mb-2">
            AI Video Prompts — full panel for inspecting individual shots
          </div>
          <AIVideoPromptsPanel
            scriptId={scriptId}
            ready={true}
            originContext="production"
          />
        </div>
      </div>
    );
  }

  if (stageKey === "preflight") {
    return (
      <div className="mt-4 border-t border-white/10 pt-4">
        <div className="text-[10px] uppercase tracking-wide text-bone-400 mb-2">
          Production preflight — every department status + readiness gates
        </div>
        <PreflightCard scriptId={scriptId} />
      </div>
    );
  }

  return null;
}

// ============================================================================
// First-time onboarding — single dismissible banner that explains the
// 12-stage flow. Stored in localStorage so it doesn't keep coming back.
// ============================================================================

const ONBOARDING_KEY = "toburt:workflow:onboarding:dismissed";

function OnboardingBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDING_KEY) === "true";
    } catch (_) {
      return false;
    }
  });
  if (dismissed) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch (_) {
      /* ignore */
    }
    setDismissed(true);
  };
  return (
    <div className="mb-4 rounded-md border border-sky-700/30 bg-sky-900/15 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-sky-100">
            Welcome to the Production Workflow
          </div>
          <p className="mt-1 text-xs text-bone-300">
            Twelve stages, in order. Each stage shows what's been approved,
            what's still needed, and unlocks the next stage when you click
            <strong className="text-bone-100"> Approve</strong>. The system
            won't let you skip ahead — that's how a real production crew
            works. Start with <strong className="text-bone-100">Stage 2 Assign Roles</strong>,
            then walk through Production Design → Art Direction → Props →
            Wardrobe → Blocking → Cinematography → Continuity → Prompt
            Supervisor → Preflight → Generate.
          </p>
        </div>
        <button
          onClick={dismiss}
          className="rounded border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.1] shrink-0"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
