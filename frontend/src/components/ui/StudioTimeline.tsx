// Studio Timeline — the always-visible 10-stage stepper at the top of
// the project page. The user's primary mental model:
//
//   Writing      → Team           → Production
//   01 02 03     04 05            06 07 08 09 10
//
// Each stage card shows the deliverable, next action, primary CTA, and
// the surfaces (existing pages) that already serve it. Click any stage
// to scroll-focus its expanded card.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Circle,
  Compass,
  Lock,
  Pause,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import type {
  StudioPhase,
  StudioStage,
  StudioStageKey,
  StudioStageStatus,
  StudioTimelineResponse,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { Panel } from "@/components/ui/Panel";

interface StudioTimelineProps {
  projectId?: string;
}

const PHASE_LABEL: Record<StudioPhase, string> = {
  writing: "Writing",
  team: "Team",
  production: "Production",
};

const PHASE_TONE: Record<StudioPhase, string> = {
  writing: "border-cyan-700/40 bg-cyan-900/[0.06]",
  team: "border-violet-700/40 bg-violet-900/[0.06]",
  production: "border-ember-700/40 bg-ember-900/[0.08]",
};

export function StudioTimeline({ projectId }: StudioTimelineProps) {
  const params = useParams<{ projectId?: string }>();
  const pid = projectId ?? params.projectId;
  const q = useQuery({
    queryKey: ["studio-timeline", pid],
    queryFn: () => api.getStudioTimeline(pid!),
    enabled: !!pid,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const [focusKey, setFocusKey] = useState<StudioStageKey | null>(null);

  if (!pid) return null;
  if (q.isLoading || !q.data) {
    return (
      <Panel eyebrow="Studio timeline" title="Project journey">
        <div className="h-24 animate-pulse-soft rounded bg-white/[0.03]" />
      </Panel>
    );
  }

  const tl: StudioTimelineResponse = q.data;
  const currentKey = focusKey ?? tl.summary.currentStageKey;
  const currentStage = currentKey
    ? tl.stages.find((s) => s.key === currentKey)
    : tl.stages[0];

  const epLabel =
    tl.representativeEpisodeNumber !== null
      ? `EP${String(tl.representativeEpisodeNumber).padStart(2, "0")}${tl.representativeEpisodeTitle ? ` — ${tl.representativeEpisodeTitle}` : ""}`
      : null;

  return (
    <Panel
      eyebrow="Studio timeline"
      title={
        <span className="inline-flex items-center gap-2">
          <Compass className="h-4 w-4" /> Project journey
          {epLabel && (
            <span className="text-[12px] font-normal text-bone-400">
              · production phase tracks {epLabel}
            </span>
          )}
        </span>
      }
      actions={
        <span className="text-[12px] text-bone-300">
          {tl.summary.completeStages} / {tl.summary.totalStages} complete ·{" "}
          <span className="text-bone-50 font-medium">
            {tl.summary.progressPct}%
          </span>
        </span>
      }
    >
      <PhasesRail
        stages={tl.stages}
        focusKey={currentKey ?? null}
        onPick={setFocusKey}
      />
      {currentStage && (
        <CurrentStageCard
          stage={currentStage}
          projectId={pid}
          isLockedToCurrent={focusKey === null}
        />
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Horizontal phases rail
// ---------------------------------------------------------------------------

function PhasesRail({
  stages,
  focusKey,
  onPick,
}: {
  stages: StudioStage[];
  focusKey: StudioStageKey | null;
  onPick: (k: StudioStageKey) => void;
}) {
  // Group by phase for the label row.
  const groups = useMemo(() => {
    const out: Array<{ phase: StudioPhase; stages: StudioStage[] }> = [];
    for (const s of stages) {
      const last = out[out.length - 1];
      if (last && last.phase === s.phase) {
        last.stages.push(s);
      } else {
        out.push({ phase: s.phase, stages: [s] });
      }
    }
    return out;
  }, [stages]);

  return (
    <div className="-mx-1 mb-4 overflow-x-auto pb-1">
      <div className="flex min-w-max items-stretch gap-2 px-1">
        {groups.map((g, gi) => (
          <div
            key={`${g.phase}-${gi}`}
            className={
              "rounded-lg border p-2 " + PHASE_TONE[g.phase]
            }
          >
            <div className="mb-1.5 px-1 text-[10px] uppercase tracking-[0.18em] text-bone-400">
              {PHASE_LABEL[g.phase]}
            </div>
            <div className="flex items-stretch gap-1.5">
              {g.stages.map((s) => (
                <StageChip
                  key={s.key}
                  stage={s}
                  active={focusKey === s.key}
                  onClick={() => onPick(s.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StageChip({
  stage,
  active,
  onClick,
}: {
  stage: StudioStage;
  active: boolean;
  onClick: () => void;
}) {
  const tone = statusTone(stage.status);
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex w-[148px] flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left transition-colors " +
        tone.row +
        (active ? " ring-1 ring-ember-400/70" : "")
      }
      title={`${stage.title} — ${stage.statusDetail}`}
    >
      <div className="flex w-full items-center justify-between gap-1.5">
        <span
          className={
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full " +
            tone.icon
          }
        >
          {iconFor(stage.status)}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-bone-500">
          {String(stage.number).padStart(2, "0")}
        </span>
      </div>
      <span className="text-[12px] font-medium leading-tight text-bone-100">
        {stage.title}
      </span>
      <span className="text-[10.5px] leading-tight text-bone-400 line-clamp-2">
        {stage.statusDetail}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Current / focused stage card
// ---------------------------------------------------------------------------

function CurrentStageCard({
  stage,
  projectId,
  isLockedToCurrent,
}: {
  stage: StudioStage;
  projectId: string;
  isLockedToCurrent: boolean;
}) {
  const tone = statusTone(stage.status);
  return (
    <div
      className={
        "rounded-lg border p-4 " +
        tone.row +
        " mt-2"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full " +
                tone.icon
              }
            >
              {iconFor(stage.status)}
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-bone-400">
              {isLockedToCurrent ? "You are here" : "Focused"} · Stage{" "}
              {String(stage.number).padStart(2, "0")} · {PHASE_LABEL[stage.phase]}
            </span>
            <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
              {prettyStatus(stage.status)}
            </span>
          </div>
          <h3 className="mt-1.5 font-serif text-lg text-bone-50">
            {stage.title}
          </h3>
          <div className="mt-0.5 text-[12px] text-bone-300">
            <span className="text-bone-500">Deliverable:</span>{" "}
            {stage.deliverable}
          </div>
          <p className="mt-2 max-w-2xl text-[12.5px] leading-snug text-bone-200">
            {stage.nextAction}
          </p>
          <div className="mt-1 text-[11px] text-bone-400">{stage.statusDetail}</div>
          {stage.surfaces.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] uppercase tracking-wide text-bone-500">
                Surfaces
              </span>
              {stage.surfaces.map((sf) => (
                <Link
                  key={sf.toRel}
                  to={`/projects/${projectId}${sf.toRel}`}
                  className="chip border-white/10 bg-white/[0.02] text-bone-300 hover:bg-white/[0.05]"
                >
                  {sf.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Link
            to={`/projects/${projectId}${stage.primary.toRel}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-ember-500/80 px-3 py-1.5 text-[12.5px] font-medium text-ember-50 hover:bg-ember-500"
          >
            {stage.primary.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          {stage.secondary && (
            <Link
              to={`/projects/${projectId}${stage.secondary.toRel}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[11.5px] text-bone-200 hover:bg-white/[0.05]"
            >
              {stage.secondary.label}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function iconFor(status: StudioStageStatus) {
  switch (status) {
    case "complete":
      return <Check className="h-3 w-3" />;
    case "in_progress":
      return <Sparkles className="h-3 w-3" />;
    case "blocked":
      return <AlertTriangle className="h-3 w-3" />;
    case "not_started":
    default:
      return <Circle className="h-3 w-3" />;
  }
}

function statusTone(status: StudioStageStatus): { row: string; icon: string } {
  switch (status) {
    case "complete":
      return {
        row: "border-emerald-700/40 bg-emerald-900/[0.08]",
        icon: "bg-emerald-900/40 text-emerald-200",
      };
    case "in_progress":
      return {
        row: "border-ember-700/45 bg-ember-900/[0.10]",
        icon: "bg-ember-900/40 text-ember-200",
      };
    case "blocked":
      return {
        row: "border-amber-700/40 bg-amber-900/[0.08]",
        icon: "bg-amber-900/40 text-amber-200",
      };
    case "not_started":
    default:
      return {
        row: "border-white/10 bg-white/[0.02]",
        icon: "bg-white/[0.05] text-bone-400",
      };
  }
}

function prettyStatus(s: StudioStageStatus): string {
  return s.replace(/_/g, " ");
}

// Silence unused-import warning — Lock, Pause kept for future stages.
void Lock;
void Pause;
