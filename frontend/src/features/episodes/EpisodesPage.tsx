import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ListTree, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function EpisodesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();

  const seasons = useQuery({
    queryKey: ["seasons", projectId],
    queryFn: () => api.listSeasons(projectId),
  });
  const episodes = useQuery({
    queryKey: ["episodes", projectId],
    queryFn: () => api.listEpisodes(projectId),
  });

  const [showNew, setShowNew] = useState(false);

  const create = useMutation({
    mutationFn: (body: { number: number; title: string; logline: string; seasonId?: string }) =>
      api.createEpisode({
        projectId,
        number: body.number,
        title: body.title,
        logline: body.logline,
        seasonId: body.seasonId,
      } as Parameters<typeof api.createEpisode>[0]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["episodes", projectId] });
      setShowNew(false);
    },
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Episodes"
        title="Season structure"
        description="Episodes group beat sheets, scene lists and drafts. Tentpole episodes anchor the season."
        actions={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New episode
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 px-8">
        <Panel eyebrow="Seasons" title={`${(seasons.data ?? []).length || 0} season(s)`}>
          {(seasons.data ?? []).length === 0 ? (
            <div className="text-sm text-bone-400">
              Run a workflow through the Season Arc stage and the Showrunner will create seasons here.
            </div>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {seasons.data!.map((s) => (
                <li key={s.id} className="chip">
                  S{String(s.number).padStart(2, "0")} {s.title ?? ""}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel eyebrow="Episodes" title="All episodes">
          {episodes.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (episodes.data ?? []).length === 0 ? (
            <EmptyState
              Icon={ListTree}
              title="No episodes"
              description="Add your pilot or first episode to start outlining."
              action={
                <Button onClick={() => setShowNew(true)}>
                  <Plus className="h-4 w-4" /> Add episode
                </Button>
              }
            />
          ) : (
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {episodes.data!.map((e) => (
                <li
                  key={e.id}
                  className="rounded-md border border-white/8 bg-white/[0.02] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs text-ember-300">
                      EP {String(e.number).padStart(2, "0")}
                    </div>
                    <span className="chip">{e.status}</span>
                  </div>
                  <div className="mt-1 text-bone-50">{e.title ?? "Untitled"}</div>
                  {e.logline && (
                    <p className="mt-1 text-sm text-bone-300">{e.logline}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {showNew && (
        <NewEpisodeDialog
          onClose={() => setShowNew(false)}
          onSubmit={(v) => create.mutate(v)}
          pending={create.isPending}
        />
      )}
    </div>
  );
}

function NewEpisodeDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (v: { number: number; title: string; logline: string }) => void;
  pending: boolean;
}) {
  const [num, setNum] = useState(1);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-serif text-xl">New episode</h2>
        <div className="mt-4 space-y-3">
          <div>
            <label className="label-eyebrow mb-1 block">Number</label>
            <input className="input" type="number" min={1} value={num} onChange={(e) => setNum(Number(e.target.value))} />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Title</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Logline</label>
            <textarea className="input min-h-[72px]" value={logline} onChange={(e) => setLogline(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSubmit({ number: num, title, logline })} disabled={pending}>
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
