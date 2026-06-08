// Recommended Next Step banner. One AI-derived action the user can take
// right now to move the project forward. Pulled from
// /projects/:id/next-step on the backend, which inspects current state
// (characters, treatment, relationships, episodes, scripts, audit, pitch)
// and picks the most impactful single action.
//
// Shown at the top of: Project Overview, Pitch Materials, Relationships,
// and anywhere else we want guided non-expert flow.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";

export interface NextStep {
  title: string;
  body: string;
  ctaLabel: string;
  /** Internal route path (under /projects/:id) or "/" for project root. */
  toRel: string;
  /** Optional accent — "primary" (default) or "warning". */
  tone?: "primary" | "warning" | "info";
}

export function RecommendedNextStep({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryKey: ["next-step", projectId],
    queryFn: () => api.getRecommendedNextStep(projectId),
    // Keep cheap; this is small.
    staleTime: 30_000,
  });
  if (q.isLoading) {
    return <div className="h-16 animate-pulse-soft rounded-lg border border-white/8 bg-white/[0.02]" />;
  }
  const step = q.data;
  if (!step) return null;
  const tone = step.tone ?? "primary";
  const accent =
    tone === "warning"
      ? "border-amber-700/40 bg-amber-900/15"
      : tone === "info"
      ? "border-sky-700/40 bg-sky-900/15"
      : "border-emerald-700/40 bg-emerald-900/10";
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 rounded-md border ${accent} p-3`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-bone-400">
          <Sparkles className="h-3 w-3" /> Recommended next step
        </div>
        <div className="mt-1 text-sm text-bone-50">{step.title}</div>
        <div className="mt-1 text-xs text-bone-300">{step.body}</div>
      </div>
      <Link to={`/projects/${projectId}${step.toRel || ""}`}>
        <Button>
          {step.ctaLabel} <ArrowRight className="h-4 w-4" />
        </Button>
      </Link>
    </div>
  );
}
