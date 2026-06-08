import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Download, Loader2 } from "lucide-react";
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
              {scripts.data!
                .slice()
                // Current draft first, then newest draft_number.
                .sort((a, b) => {
                  if (a.current !== b.current) return a.current ? -1 : 1;
                  if (a.draft_number !== b.draft_number) return b.draft_number - a.draft_number;
                  return Date.parse(b.updated_at) - Date.parse(a.updated_at);
                })
                .map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.02] p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-bone-50">
                        {s.title}
                        {s.current && (
                          <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                            current
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-bone-400">
                        Draft {s.draft_number} • {new Date(s.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <ExportButtons scriptId={s.id} title={s.title} />
                  </li>
                ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function ExportButtons({ scriptId, title }: { scriptId: string; title: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const safeName =
    title.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "draft";
  const go = async (id: "pdf" | "fdx" | "fountain" | "markdown", ext: string) => {
    setError(null);
    setBusy(id);
    try {
      await api.downloadExport(scriptId, id, `${safeName}.${ext}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-1.5">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.id}
            className="btn-outline disabled:opacity-50"
            disabled={busy !== null}
            onClick={() =>
              go(f.id as "pdf" | "fdx" | "fountain" | "markdown", f.extension)
            }
          >
            {busy === f.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            .{f.extension}
          </button>
        ))}
      </div>
      {error && (
        <div className="max-w-xs text-right text-xs text-red-300">{error}</div>
      )}
    </div>
  );
}
