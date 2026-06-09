// Production Path stepper — visualizes the 7-stage production journey
// for a single episode. Each step shows complete / current / missing /
// blocked state with a short status line and links to the page that
// owns it. Read-only.

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Circle, AlertTriangle, Sparkles, ArrowRight } from "lucide-react";
import type {
  ProductionPathStep,
  ProductionPathState,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { Panel } from "@/components/ui/Panel";

interface ProductionPathCardProps {
  /** Override the project — defaults to the current route's :projectId. */
  projectId?: string;
  /** Episode to read state for — defaults to route's :episodeId; when
   *  null/undefined, the backend picks the first episode. */
  episodeId?: string | null;
}

export function ProductionPathCard({
  projectId,
  episodeId,
}: ProductionPathCardProps) {
  const params = useParams<{ projectId?: string; episodeId?: string }>();
  const pid = projectId ?? params.projectId;
  const eid = episodeId !== undefined ? episodeId : (params.episodeId ?? null);

  // We reuse the wayfinder endpoint with scope=production. The
  // productionPath field on the response is the source of truth.
  const q = useQuery({
    queryKey: ["wayfinder", pid, eid ?? "", "production"],
    queryFn: () => api.getWayfinder(pid!, eid, "production"),
    enabled: !!pid,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  if (!pid) return null;
  if (q.isLoading || !q.data) {
    return (
      <Panel eyebrow="Production path" title="Episode journey">
        <div className="h-16 animate-pulse-soft rounded bg-white/[0.03]" />
      </Panel>
    );
  }

  const path = q.data.productionPath ?? [];
  if (path.length === 0) {
    return null;
  }
  const epLabel =
    q.data.episodeNumber !== null
      ? `EP${String(q.data.episodeNumber).padStart(2, "0")}${q.data.episodeTitle ? ` — ${q.data.episodeTitle}` : ""}`
      : "Episode";

  return (
    <Panel
      eyebrow="Production path"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> {epLabel} — production journey
        </span>
      }
    >
      <ol className="space-y-1.5">
        {path.map((s, i) => (
          <StepRow
            key={s.key}
            step={s}
            index={i}
            isLast={i === path.length - 1}
            projectId={pid}
          />
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10.5px] text-bone-500">
        <LegendDot state="complete" /> Complete
        <LegendDot state="current" /> Current
        <LegendDot state="blocked" /> Blocked
        <LegendDot state="missing" /> Not started
      </div>
    </Panel>
  );
}

function StepRow({
  step,
  index,
  isLast,
  projectId,
}: {
  step: ProductionPathStep;
  index: number;
  isLast: boolean;
  projectId: string;
}) {
  const tone = stateTone(step.state);
  return (
    <li>
      <Link
        to={`/projects/${projectId}${step.toRel}`}
        className={
          "group flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 transition-colors " +
          tone.row
        }
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-[10px] uppercase tracking-wide text-bone-500">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span
            className={
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full " +
              tone.icon
            }
          >
            {iconFor(step.state)}
          </span>
          <span className="text-[13px] text-bone-100">{step.label}</span>
          <span className="text-[11.5px] text-bone-400">{step.status}</span>
        </div>
        <ArrowRight className="h-3.5 w-3.5 text-bone-500 transition-transform group-hover:translate-x-0.5" />
      </Link>
      {!isLast && (
        <div className="ml-7 my-0.5 h-2 w-px bg-white/10" aria-hidden />
      )}
    </li>
  );
}

function iconFor(state: ProductionPathState) {
  switch (state) {
    case "complete":
      return <Check className="h-3.5 w-3.5" />;
    case "current":
      return <Sparkles className="h-3.5 w-3.5" />;
    case "blocked":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    case "missing":
    default:
      return <Circle className="h-3.5 w-3.5" />;
  }
}

function stateTone(state: ProductionPathState): {
  row: string;
  icon: string;
} {
  switch (state) {
    case "complete":
      return {
        row: "border-emerald-700/30 bg-emerald-900/[0.08] hover:bg-emerald-900/15",
        icon: "bg-emerald-900/40 text-emerald-200",
      };
    case "current":
      return {
        row: "border-ember-700/40 bg-ember-900/[0.10] hover:bg-ember-900/20",
        icon: "bg-ember-900/40 text-ember-200",
      };
    case "blocked":
      return {
        row: "border-amber-700/40 bg-amber-900/[0.08] hover:bg-amber-900/15",
        icon: "bg-amber-900/40 text-amber-200",
      };
    case "missing":
    default:
      return {
        row: "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]",
        icon: "bg-white/[0.05] text-bone-400",
      };
  }
}

function LegendDot({ state }: { state: ProductionPathState }) {
  const t = stateTone(state).icon;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={"inline-block h-2 w-2 rounded-full " + t} /> &nbsp;
    </span>
  );
}
