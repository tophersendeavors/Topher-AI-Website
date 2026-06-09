// Story Cleanup — secondary, non-blocking notice rendered below the
// Studio Timeline on the Project Overview page. Surfaces warnings from
// the legacy /next-step engine (relationship speculation, missing
// foundation items) without competing with the timeline as the primary
// guidance.
//
// Renders nothing when the legacy engine has no warning to share. Reads
// the timeline so it can name the current stage and frame the warning
// as non-blocking for THAT stage.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

export function StoryCleanupPanel({ projectId }: { projectId: string }) {
  const stepQ = useQuery({
    queryKey: ["next-step", projectId],
    queryFn: () => api.getRecommendedNextStep(projectId),
    staleTime: 30_000,
  });
  const tlQ = useQuery({
    queryKey: ["studio-timeline", projectId],
    queryFn: () => api.getStudioTimeline(projectId),
    staleTime: 30_000,
  });

  const step = stepQ.data;
  // Only surface this panel when the legacy engine is flagging a
  // warning (e.g. speculative relationship details). Info / primary
  // recommendations are now owned by the Studio Timeline.
  if (!step || step.tone !== "warning") return null;

  const tl = tlQ.data;
  const currentStageTitle = tl
    ? tl.stages.find((s) => s.key === tl.summary.currentStageKey)?.title ?? null
    : null;

  const blockerLine = currentStageTitle
    ? `This does not block ${currentStageTitle}.`
    : "This does not block your current production stage.";

  return (
    <div className="rounded-md border border-amber-700/30 bg-amber-900/10 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.18em] text-amber-200/80">
            <AlertTriangle className="h-3.5 w-3.5" />
            Story cleanup · non-blocking
          </div>
          <div className="mt-1 text-[13px] text-bone-100">{step.title}</div>
          <p className="mt-1 text-[11.5px] leading-snug text-bone-300">
            {step.body}
          </p>
          <p className="mt-1 text-[11.5px] text-bone-400">{blockerLine}</p>
        </div>
        <Link to={`/projects/${projectId}${step.toRel || ""}`}>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/40 bg-amber-900/20 px-2.5 py-1.5 text-[12px] text-amber-100 hover:bg-amber-900/30">
            {step.ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </Link>
      </div>
    </div>
  );
}
