// Wayfinder — persistent "Next Step" banner shown across every major page.
//
// Reads from the shared backend resolver so every page sees the same
// next step. The component is tone-aware (primary / warning / info /
// success), and never renders dead-end CTAs — the backend guarantees
// every step ships with a real toRel.

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Compass,
  Info,
  Sparkles,
} from "lucide-react";
import type { WayfinderStep, WayfinderTone } from "@toburt/shared";
import { api } from "@/lib/api";

interface WayfinderPanelProps {
  /** Override the project — defaults to the current route's :projectId. */
  projectId?: string;
  /** Optional episode scope — defaults to route's :episodeId if present. */
  episodeId?: string | null;
  /** Scope: "general" (default) walks dev-phase first; "production" skips
   *  dev and walks the production ladder only. Use "production" on
   *  Production Hub / Episodes / production-tool pages. */
  scope?: import("@toburt/shared").WayfinderScope;
  /** Tighter spacing variant for stage / drawer contexts. */
  dense?: boolean;
}

export function WayfinderPanel({
  projectId,
  episodeId,
  scope,
  dense,
}: WayfinderPanelProps) {
  const params = useParams<{ projectId?: string; episodeId?: string }>();
  const pid = projectId ?? params.projectId;
  const eid =
    episodeId !== undefined ? episodeId : (params.episodeId ?? null);

  const q = useQuery({
    queryKey: ["wayfinder", pid, eid ?? "", scope ?? "general"],
    queryFn: () => api.getWayfinder(pid!, eid, scope),
    enabled: !!pid,
    // Refetch when the user returns to the tab — state across the OS
    // changes underfoot (approvals, regenerations, etc).
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });

  if (!pid) return null;
  if (q.isLoading || !q.data) {
    return (
      <div
        className={
          "rounded-lg border border-white/8 bg-white/[0.02] " +
          (dense ? "px-3 py-2" : "px-4 py-3")
        }
      >
        <div className="h-10 animate-pulse-soft rounded bg-white/[0.04]" />
      </div>
    );
  }

  const { step, episodeNumber, episodeTitle } = q.data;
  const epLabel =
    episodeNumber !== null
      ? `EP${String(episodeNumber).padStart(2, "0")}${episodeTitle ? ` — ${episodeTitle}` : ""}`
      : null;

  return (
    <div
      className={
        "rounded-lg border " +
        toneCard(step.tone) +
        " " +
        (dense ? "p-3" : "p-4")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full " +
                toneIcon(step.tone)
              }
            >
              {iconForTone(step.tone)}
            </span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-bone-400">
              Next step · {step.phaseLabel}
              {epLabel ? ` · ${epLabel}` : ""}
            </span>
            <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
              {step.status}
            </span>
          </div>
          <h3
            className={
              (dense ? "mt-1 " : "mt-1.5 ") +
              "font-serif text-bone-50 " +
              (dense ? "text-base" : "text-lg")
            }
          >
            {step.title}
          </h3>
          <p
            className={
              "mt-1 max-w-2xl text-[12.5px] leading-snug " +
              (step.tone === "warning" ? "text-amber-100/90" : "text-bone-300")
            }
          >
            {step.why}
          </p>
          {step.blockers && step.blockers.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11.5px] text-amber-100/90">
              {step.blockers.slice(0, 3).map((b, i) => (
                <li key={i}>• {b}</li>
              ))}
              {step.blockers.length > 3 && (
                <li className="text-bone-400">
                  +{step.blockers.length - 3} more
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <Link
            to={`/projects/${pid}${step.primary.toRel}`}
            className={
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium " +
              tonePrimary(step.tone)
            }
          >
            {step.primary.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          {step.secondary && (
            <Link
              to={`/projects/${pid}${step.secondary.toRel}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-[11.5px] text-bone-200 hover:bg-white/[0.05]"
            >
              {step.secondary.label}
            </Link>
          )}
        </div>
      </div>
      {q.data.nonProductionWarnings && q.data.nonProductionWarnings.length > 0 && (
        <div className="mt-3 rounded-md border border-white/8 bg-white/[0.02] p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-bone-500">
            Story cleanup · non-production warnings
          </div>
          <ul className="space-y-0.5 text-[11.5px] text-bone-300">
            {q.data.nonProductionWarnings.slice(0, 3).map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
          <Link
            to={`/projects/${pid}`}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-bone-400 hover:text-bone-200"
          >
            Open Project Overview <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </div>
  );
}

function iconForTone(tone: WayfinderTone) {
  switch (tone) {
    case "warning":
      return <AlertTriangle className="h-3.5 w-3.5" />;
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5" />;
    case "info":
      return <Info className="h-3.5 w-3.5" />;
    case "primary":
    default:
      return <Compass className="h-3.5 w-3.5" />;
  }
}

function toneCard(tone: WayfinderTone): string {
  switch (tone) {
    case "warning":
      return "border-amber-700/40 bg-amber-900/10";
    case "success":
      return "border-emerald-700/40 bg-emerald-900/10";
    case "info":
      return "border-cyan-700/40 bg-cyan-900/[0.08]";
    case "primary":
    default:
      return "border-ember-700/40 bg-ember-900/[0.08]";
  }
}

function toneIcon(tone: WayfinderTone): string {
  switch (tone) {
    case "warning":
      return "bg-amber-900/30 text-amber-200";
    case "success":
      return "bg-emerald-900/30 text-emerald-200";
    case "info":
      return "bg-cyan-900/30 text-cyan-200";
    case "primary":
    default:
      return "bg-ember-900/30 text-ember-200";
  }
}

function tonePrimary(tone: WayfinderTone): string {
  switch (tone) {
    case "warning":
      return "bg-amber-500/80 text-amber-50 hover:bg-amber-500";
    case "success":
      return "bg-emerald-500/80 text-emerald-50 hover:bg-emerald-500";
    case "info":
      return "bg-cyan-500/80 text-cyan-50 hover:bg-cyan-500";
    case "primary":
    default:
      return "bg-ember-500/80 text-ember-50 hover:bg-ember-500";
  }
}

// Ergonomic re-export so consumers don't need to import the type directly.
export type { WayfinderStep };
