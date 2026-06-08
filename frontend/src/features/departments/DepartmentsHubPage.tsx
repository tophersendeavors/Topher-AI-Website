// Departments Hub — grid of all departments with mode + contribution counts.
// Dark theme to match the app shell.

import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Panel } from "@/components/ui/Panel";

export function DepartmentsHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const q = useQuery({
    queryKey: ["departments", projectId],
    queryFn: () => api.listDepartments(projectId),
  });
  if (q.isLoading)
    return (
      <div className="p-6 text-sm text-bone-400">
        <Loader2 className="inline animate-spin h-4 w-4 mr-1" /> Loading departments…
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <Panel eyebrow="Production" title="Departments">
        <p className="text-sm text-bone-400">
          Each department can run in AI / human / hybrid mode. Click in to upload
          references, paste URLs, pick colors, write notes, and approve canon.
          Approved canon feeds the AI Video Prompts pipeline at regeneration time.
        </p>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(q.data?.registry ?? []).map((d) => (
            <Link
              key={d.key}
              to={`/projects/${projectId}/departments/${d.key}`}
              className="block rounded border border-white/8 bg-white/[0.03] p-3 hover:bg-white/[0.06] transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-serif text-bone-50 text-base leading-tight">
                  {d.label}
                </div>
                <ModePill mode={d.config.mode} />
              </div>
              <div className="mt-1 text-xs text-bone-400 line-clamp-2">
                {d.description}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11px] flex-wrap">
                <span className="text-emerald-300">
                  {d.approvedCanonFields} canon
                </span>
                <span className="text-bone-500">·</span>
                <span className="text-bone-200">
                  {d.contributionCounts.total} contribs
                </span>
                {d.contributionCounts.candidate > 0 && (
                  <>
                    <span className="text-bone-500">·</span>
                    <span className="text-amber-300">
                      {d.contributionCounts.candidate} pending
                    </span>
                  </>
                )}
                {!d.canonOwner && (
                  <span className="ml-auto text-[10px] text-bone-500">advisory</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ModePill({ mode }: { mode: "ai" | "human" | "hybrid" }) {
  const tone =
    mode === "human"
      ? "bg-blue-900/40 text-blue-200 ring-blue-700/40"
      : mode === "hybrid"
        ? "bg-violet-900/40 text-violet-200 ring-violet-700/40"
        : "bg-white/[0.06] text-bone-300 ring-white/10";
  return (
    <span
      className={
        "text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 ring-1 " + tone
      }
    >
      {mode}
    </span>
  );
}
