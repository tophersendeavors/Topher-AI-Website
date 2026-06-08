import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Film, Plus, Smartphone } from "lucide-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Project } from "@toburt/shared";
import { PROJECT_TYPES, PROJECT_TYPE_LABEL, PROJECT_TYPE_DESCRIPTION, type ProjectType } from "@toburt/shared";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

// Read projectType off the project's metadata jsonb. Legacy projects with
// no metadata.projectType default to prestige_series so the dashboard
// continues to render them under the expected tier.
function readProjectType(p: Project): ProjectType {
  const raw = (p.metadata as Record<string, unknown> | undefined)?.projectType;
  if (typeof raw === "string" && (PROJECT_TYPES as readonly string[]).includes(raw)) {
    return raw as ProjectType;
  }
  return "prestige_series";
}

export function ProjectsPage() {
  const { data: projects, isLoading, error } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<"all" | ProjectType>("all");

  // Count by tier for the filter chips + the Micro Dramas dashboard card.
  const counts = (() => {
    const out: Record<ProjectType, number> = {
      prestige_series: 0, mini_series: 0, micro_drama: 0,
    };
    for (const p of projects ?? []) out[readProjectType(p)]++;
    return out;
  })();
  const visible = (projects ?? []).filter(
    (p) => filter === "all" || readProjectType(p) === filter
  );
  const microDramas = (projects ?? []).filter((p) => readProjectType(p) === "micro_drama");

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

      <div className="space-y-6 px-8">
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
            description="Spin up a feature, pilot, miniseries, or micro drama."
            action={
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4" />
                Start your first project
              </Button>
            }
          />
        ) : (
          <>
            {/* Micro Dramas dashboard card — only shows when at least one exists. */}
            {microDramas.length > 0 && (
              <Panel>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-ember-400" />
                    <h3 className="font-serif text-lg text-bone-50">Micro Dramas</h3>
                    <span className="chip">{microDramas.length} active</span>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={() => setFilter("micro_drama")}
                  >
                    Filter to micro dramas
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {microDramas.slice(0, 6).map((p) => {
                    const bible = (p.metadata as Record<string, unknown> | undefined)
                      ?.microDramaBible as Record<string, unknown> | undefined;
                    const epLen = typeof bible?.episodeLengthSec === "number" ? bible.episodeLengthSec : null;
                    const seasonLen = typeof bible?.seasonLength === "number" ? bible.seasonLength : null;
                    const emotion = typeof bible?.audienceEmotion === "string" ? bible.audienceEmotion : null;
                    const hook = typeof bible?.hook === "string" ? bible.hook : "";
                    const runtimeMin = epLen && seasonLen ? Math.round((epLen * seasonLen) / 60) : null;
                    return (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="rounded-md border border-white/8 bg-white/[0.02] p-3 transition-colors hover:bg-white/[0.04]"
                      >
                        <div className="flex flex-wrap items-baseline gap-1">
                          <span className="font-serif text-bone-50">{p.title}</span>
                          {emotion && <span className="chip">{emotion}</span>}
                          <MicroDramaViralFlag projectId={p.id} />
                        </div>
                        {hook && (
                          <p className="mt-1 line-clamp-2 text-xs text-bone-300">{hook}</p>
                        )}
                        <div className="mt-1 text-[10px] text-bone-500">
                          {seasonLen ? `${seasonLen} eps` : "season length —"}
                          {epLen ? ` · ${epLen}s each` : ""}
                          {runtimeMin ? ` · ~${runtimeMin} min total` : ""}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </Panel>
            )}

            {/* Tier filter row. */}
            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="label-eyebrow mr-2">Filter</span>
              <FilterChip
                active={filter === "all"}
                onClick={() => setFilter("all")}
                label={`All (${projects!.length})`}
              />
              {(PROJECT_TYPES as readonly ProjectType[]).map((t) => (
                <FilterChip
                  key={t}
                  active={filter === t}
                  onClick={() => setFilter(t)}
                  label={`${PROJECT_TYPE_LABEL[t]} (${counts[t]})`}
                />
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <CreateProjectDialog onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}

function FilterChip({
  active, label, onClick,
}: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-2.5 py-0.5 transition-colors " +
        (active
          ? "border-ember-700/60 bg-ember-900/30 text-ember-100"
          : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
      }
    >
      {label}
    </button>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const projectType = readProjectType(project);
  const accent =
    projectType === "micro_drama"
      ? "from-amber-500/25 via-transparent"
      : projectType === "mini_series"
      ? "from-emerald-500/20 via-transparent"
      : project.kind === "feature"
      ? "from-ember-500/20 via-transparent"
      : project.kind === "pilot"
      ? "from-blue-500/20 via-transparent"
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
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={
            "chip " +
            (projectType === "micro_drama"
              ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
              : projectType === "mini_series"
              ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
              : "border-white/10")
          }>
            {PROJECT_TYPE_LABEL[projectType]}
          </span>
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
  const [projectType, setProjectType] = useState<ProjectType>("prestige_series");
  const [logline, setLogline] = useState("");
  const [genre, setGenre] = useState("");

  // Two-step create: project, then set its projectType in metadata. This
  // keeps the existing createProject contract unchanged.
  const create = useMutation({
    mutationFn: async () => {
      const created = await api.createProject({
        title,
        kind,
        logline: logline || undefined,
        genre: genre
          ? genre.split(",").map((g) => g.trim()).filter(Boolean)
          : undefined,
      });
      if (projectType !== "prestige_series") {
        await api.setProjectType(created.id, projectType);
      }
      return created;
    },
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
            <label className="label-eyebrow mb-1 block">Project Type</label>
            <div className="grid grid-cols-1 gap-1.5">
              {(PROJECT_TYPES as readonly ProjectType[]).map((t) => (
                <label
                  key={t}
                  className={
                    "flex cursor-pointer gap-3 rounded-md border p-2.5 text-sm transition-colors " +
                    (projectType === t
                      ? "border-ember-700/60 bg-ember-900/15"
                      : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]")
                  }
                >
                  <input
                    type="radio"
                    checked={projectType === t}
                    onChange={() => setProjectType(t)}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-bone-100">{PROJECT_TYPE_LABEL[t]}</div>
                    <div className="text-[11px] text-bone-400">
                      {PROJECT_TYPE_DESCRIPTION[t]}
                    </div>
                  </div>
                </label>
              ))}
            </div>
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

// MicroDramaViralFlag — surfaces the count of failing-viral-test episodes
// on each micro-drama tile in the dashboard's Micro Dramas card. Reads
// existing per-episode endpoints (list + viralTest). UI-only; nothing is
// written back to the project.
function MicroDramaViralFlag({ projectId }: { projectId: string }) {
  const episodes = useQuery({
    queryKey: ["episodes", projectId],
    queryFn: () => api.listEpisodes(projectId),
  });
  const eps = episodes.data ?? [];

  const tests = useQueries({
    queries: eps.map((e) => ({
      queryKey: ["episode-viral", e.id],
      queryFn: () => api.getEpisodeViralTest(e.id),
    })),
  });

  if (eps.length === 0) return null;
  const failing = tests.filter((t) => t.data?.test.passes === false).length;
  if (failing === 0) return null;

  return (
    <span className="chip border-red-800/50 bg-red-950/30 text-red-200">
      <AlertTriangle className="h-3 w-3" />
      {failing} ep{failing === 1 ? "" : "s"} would lose viewers
    </span>
  );
}
