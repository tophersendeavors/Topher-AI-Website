import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ChevronRight, FilePlus, FileText } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

const STARTER = `Title: Untitled
Author: TOBURT Studios

FADE IN:

INT. APARTMENT - NIGHT

Rain streaks the window. A single lamp clicks on.

JANE (40s) sits at the table, holding a letter she's read a hundred times.

JANE
(quietly)
Tonight, then.

She tears the letter in half.

CUT TO:
`;

export function DraftsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("Pilot — First Draft");

  const create = useMutation({
    mutationFn: () =>
      api.createScript({
        projectId,
        title,
        fountain: STARTER,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scripts", projectId] });
      setCreating(false);
    },
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Drafts"
        title="Screenplays"
        description="Every draft lives in the screenplay IDE, with the writers' room one click away."
        actions={
          <Button onClick={() => setCreating(true)}>
            <FilePlus className="h-4 w-4" /> New draft
          </Button>
        }
      />

      <div className="px-8">
        <Panel eyebrow="Library" title={`${(list.data ?? []).length} draft(s)`}>
          {list.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (list.data ?? []).length === 0 ? (
            <EmptyState
              Icon={FileText}
              title="No drafts yet"
              description="Generate one from a workflow, or start a fresh draft to write yourself."
              action={<Button onClick={() => setCreating(true)}><FilePlus className="h-4 w-4" /> New draft</Button>}
            />
          ) : (
            <ul className="space-y-2">
              {[...list.data!].sort((a, b) => {
                if (a.current === b.current) return b.draft_number - a.draft_number;
                return a.current ? -1 : 1;
              }).map((s) => (
                <li key={s.id}>
                  {(() => {
                    // Tier-aware routing — micro-drama scripts use the
                    // Episodes-page Screenplay block (approval / regen /
                    // patch / draft history / Copy / Production all live
                    // there). The prestige DraftWorkspacePage crashes on
                    // them. Route them home instead of into a broken page.
                    const meta = (s.metadata ?? {}) as { source?: string };
                    const isMicroDrama = meta.source === "micro_drama_chain";
                    const href = isMicroDrama
                      ? `/projects/${projectId}/episodes`
                      : `/projects/${projectId}/drafts/${s.id}`;
                    return (
                      <Link
                        to={href}
                        className={`flex items-center justify-between rounded-md border p-4 transition-colors ${
                          s.current
                            ? "border-ember-700/60 bg-ember-900/15 hover:bg-ember-900/25"
                            : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]"
                        }`}
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2 text-bone-50">
                            {s.title}
                            {s.current && (
                              <span className="chip border-ember-700/60 bg-ember-900/40 text-ember-100">
                                current
                              </span>
                            )}
                            {isMicroDrama && (
                              <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
                                micro-drama · edit on Episodes
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-bone-400">
                            Draft {s.draft_number} • updated {new Date(s.updated_at).toLocaleString()}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-bone-400" />
                      </Link>
                    );
                  })()}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setCreating(false)}>
          <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">New draft</h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="label-eyebrow mb-1 block">Title</label>
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
                <Button onClick={() => create.mutate()} disabled={!title || create.isPending}>
                  Create draft
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
