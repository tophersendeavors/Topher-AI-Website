import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Download } from "lucide-react";
import { EXPORT_FORMATS } from "@toburt/shared";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";

export function ExportCenterPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Export Center"
        title="Ship your draft"
        description="Industry-standard exports for every draft — PDF, Final Draft, Fountain, Markdown."
      />
      <div className="px-8">
        <Panel eyebrow="Drafts" title={`${(scripts.data ?? []).length} draft(s)`}>
          {scripts.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (scripts.data ?? []).length === 0 ? (
            <EmptyState
              Icon={Clapperboard}
              title="No drafts to export"
              description="Create a draft from the Drafts page first."
            />
          ) : (
            <ul className="space-y-3">
              {scripts.data!.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.02] p-4"
                >
                  <div>
                    <div className="text-bone-50">{s.title}</div>
                    <div className="text-xs text-bone-400">
                      Draft {s.draft_number} • {new Date(s.updated_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPORT_FORMATS.map((f) => (
                      <a
                        key={f.id}
                        href={api.exportScriptUrl(s.id, f.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-outline"
                      >
                        <Download className="h-3.5 w-3.5" />
                        .{f.extension}
                      </a>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
