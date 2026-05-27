import { useState } from "react";
import { Link } from "react-router-dom";
import { Film, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Project } from "@toburt/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function ProjectsPage() {
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow="Studio"
        title="Projects"
        description="Every film, pilot, series and short in development. Open one to enter its writers' room."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
        }
      />

      <div className="px-8">
        {error ? (
          <Panel>
            <div className="text-red-300">
              Could not load projects: {(error as Error).message}
            </div>
          </Panel>
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="panel h-48 animate-pulse-soft bg-white/[0.02]"
              />
            ))}
          </div>
        ) : (projects ?? []).length === 0 ? (
          <EmptyState
            Icon={Film}
            title="No projects yet"
            description="Spin up a feature, pilot, or miniseries to assemble the room."
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Start your first project
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects!.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateProjectDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const accent =
    project.kind === "feature"
      ? "from-ember-500/20 via-transparent"
      : project.kind === "pilot"
        ? "from-blue-500/20 via-transparent"
        : project.kind === "miniseries"
          ? "from-emerald-500/20 via-transparent"
          : "from-violet-500/20 via-transparent";

  return (
    <Link
      to={`/projects/${project.id}`}
      className="group panel relative overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:shadow-ember"
    >
      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${accent} to-transparent opacity-60`}
      />
      <div className="relative">
        <div className="mb-2 flex items-center gap-2">
          <span className="chip">{project.kind}</span>
          <span className="chip">{project.status}</span>
        </div>
        <h3 className="font-serif text-xl text-bone-50">{project.title}</h3>
        {project.logline && (
          <p className="mt-2 line-clamp-3 text-sm text-bone-300">
            {project.logline}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-1">
          {(project.genre ?? []).slice(0, 4).map((g) => (
            <span key={g} className="chip">
              {g}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
}

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Project["kind"]>("feature");
  const [logline, setLogline] = useState("");
  const [genre, setGenre] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.createProject({
        title,
        kind,
        logline: logline || undefined,
        genre: genre
          ? genre.split(",").map((g) => g.trim()).filter(Boolean)
          : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel-strong w-full max-w-lg p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-xl text-bone-50">New project</h2>
        <p className="mt-1 text-sm text-bone-300">
          A project is one creative entity — a film, a pilot, a series.
        </p>
        <div className="mt-5 space-y-3">
          <div>
            <label className="label-eyebrow mb-1 block">Title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Kind</label>
            <select
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value as Project["kind"])}
            >
              <option value="feature">Feature</option>
              <option value="pilot">TV Pilot</option>
              <option value="miniseries">Miniseries</option>
              <option value="series">Series</option>
              <option value="short">Short</option>
            </select>
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">Logline (optional)</label>
            <textarea
              className="input min-h-[80px]"
              value={logline}
              onChange={(e) => setLogline(e.target.value)}
            />
          </div>
          <div>
            <label className="label-eyebrow mb-1 block">
              Genre (comma separated)
            </label>
            <input
              className="input"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="thriller, sci-fi, drama"
            />
          </div>
          {create.error && (
            <div className="rounded-md border border-red-700/50 bg-red-950/30 p-2 text-sm text-red-200">
              {(create.error as Error).message}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!title || create.isPending}
              onClick={() => create.mutate()}
            >
              Create project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
