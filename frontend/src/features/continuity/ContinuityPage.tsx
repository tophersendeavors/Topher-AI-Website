import * as React from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";

type Issue = {
  id: string;
  kind: string;
  severity: "info" | "warn" | "critical";
  note: string;
  suggested_fix?: string | null;
  created_at: string;
  resolved: boolean;
};

export function ContinuityPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const issues = useQuery({
    queryKey: ["continuity", projectId],
    queryFn: () => api.listContinuity(projectId) as Promise<Issue[]>,
  });

  const open = (issues.data ?? []).filter((i) => !i.resolved);
  const critical = open.filter((i) => i.severity === "critical");

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Continuity"
        title="Watchtower"
        description="The Continuity agent runs wide canon scans across scripts. Resolve issues to keep the project consistent."
      />
      <div className="grid grid-cols-1 gap-6 px-8 md:grid-cols-3">
        <Stat label="Open issues" value={open.length} accent="text-amber-300" Icon={GitBranch} />
        <Stat label="Critical" value={critical.length} accent="text-red-300" Icon={ShieldAlert} />
        <Stat
          label="Resolved"
          value={(issues.data ?? []).length - open.length}
          accent="text-emerald-300"
          Icon={ShieldCheck}
        />
      </div>
      <div className="px-8">
        <Panel eyebrow="Issues" title="All findings">
          {(issues.data ?? []).length === 0 ? (
            <EmptyState
              Icon={ShieldCheck}
              title="No continuity issues"
              description="The Continuity agent hasn't flagged anything yet."
            />
          ) : (
            <ul className="space-y-2">
              {issues.data!.map((i) => (
                <li key={i.id} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className={`chip ${
                        i.severity === "critical"
                          ? "border-red-700/50 text-red-200"
                          : i.severity === "warn"
                          ? "border-amber-700/50 text-amber-200"
                          : "text-bone-300"
                      }`}
                    >
                      {i.severity}
                    </span>
                    <span className="chip">{i.kind}</span>
                    <span className="text-xs text-bone-400">
                      {new Date(i.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-bone-100">{i.note}</div>
                  {i.suggested_fix && (
                    <div className="mt-1 text-xs text-bone-400">→ {i.suggested_fix}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  Icon,
}: {
  label: string;
  value: number;
  accent: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement> & { className?: string }>;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <div className="label-eyebrow">{label}</div>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className={`mt-2 font-serif text-3xl ${accent}`}>{value}</div>
    </div>
  );
}
