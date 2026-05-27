import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Globe2, MapPin, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";

export function StoryBiblePage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const locations = useQuery({
    queryKey: ["locations", projectId],
    queryFn: () => api.listLocations(projectId),
  });
  const memorySearch = useQuery({
    queryKey: ["bible-memory", projectId],
    queryFn: () =>
      api.searchMemory({ projectId, query: "world rules, premise, tone", approvedOnly: true, k: 20 }),
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Story Bible"
        title="World, premise & tone"
        description="Approved canon, rules of the world, and the locations that ground every scene."
      />

      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-2">
        <Panel eyebrow="Premise & tone" title={project.data?.title ?? "—"} actions={<Sparkles className="h-4 w-4 text-ember-400" />}>
          <div className="space-y-3 text-sm text-bone-200">
            <p><span className="label-eyebrow mr-2">Logline</span>{project.data?.logline ?? "—"}</p>
            <div className="flex flex-wrap gap-1.5">
              {(project.data?.genre ?? []).map((g) => <span key={g} className="chip">{g}</span>)}
              {(project.data?.tone ?? []).map((t) => <span key={t} className="chip">{t}</span>)}
            </div>
            {project.data?.showrunner_notes && (
              <div className="whitespace-pre-wrap rounded-md border border-white/8 bg-white/[0.02] p-3 text-bone-200">
                <div className="label-eyebrow mb-1">Showrunner notes</div>
                {project.data.showrunner_notes}
              </div>
            )}
          </div>
        </Panel>

        <Panel eyebrow="Locations" title="World" actions={<Globe2 className="h-4 w-4 text-ember-400" />}>
          {locations.isLoading ? (
            <div className="h-20 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (locations.data ?? []).length === 0 ? (
            <EmptyState
              Icon={MapPin}
              title="No locations yet"
              description="Add locations as you draft scenes."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {locations.data!.map((l) => (
                <li
                  key={l.id}
                  className="rounded-md border border-white/8 bg-white/[0.02] p-3"
                >
                  <div className="text-sm text-bone-50">{l.name}</div>
                  <div className="text-xs text-bone-400">{l.kind ?? "—"}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel eyebrow="Approved canon" title="Latest facts" className="xl:col-span-2">
          {memorySearch.isLoading ? (
            <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (memorySearch.data ?? []).length === 0 ? (
            <div className="text-sm text-bone-400">No approved canon yet — the Showrunner promotes facts as the project develops.</div>
          ) : (
            <ul className="space-y-2">
              {memorySearch.data!.map((m) => (
                <li
                  key={m.id}
                  className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm text-bone-100"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="chip">{m.scope}</span>
                    <span className="chip">{m.kind}</span>
                    <span className="text-xs text-bone-400">
                      sim {m.similarity.toFixed(2)}
                    </span>
                  </div>
                  {m.text}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
