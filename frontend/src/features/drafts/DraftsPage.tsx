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
              {list.data!.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/projects/${projectId}/drafts/${s.id}`}
                    className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                  >
                    <div>
                      <div className="text-bone-50">{s.title}</div>
                      <div className="text-xs text-bone-400">
                        Draft {s.draft_number} • updated {new Date(s.updated_at).toLocaleString()}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-bone-400" />
                  </Link>
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
