import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Film, Loader2, Plus, Smartphone } from "lucide-react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Project } from "@toburt/shared";
import {
  PROJECT_TYPES,
  PROJECT_TYPE_LABEL,
  PROJECT_TYPE_DESCRIPTION,
  PROJECT_TYPE_CONFIGS,
  type ProjectType,
} from "@toburt/shared";
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
  // Initialised from PROJECT_TYPES so new types (feature, anthology) get
  // a slot automatically. Pre-Phase-A this object hardcoded 3 keys and
  // threw at runtime when a feature/anthology project existed.
  const counts = (() => {
    const out = Object.fromEntries(
      (PROJECT_TYPES as readonly ProjectType[]).map((t) => [t, 0])
    ) as Record<ProjectType, number>;
    for (const p of projects ?? []) {
      const t = readProjectType(p);
      out[t] = (out[t] ?? 0) + 1;
    }
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

/** Default Kind per project type — matches what each format expects in
 *  the existing schema, so the user doesn't have to think about Kind. */
const KIND_BY_TYPE: Record<ProjectType, Project["kind"]> = {
  micro_drama: "series",
  prestige_series: "pilot",
  mini_series: "miniseries",
  feature: "feature",
  anthology: "series",
};

/** Where to land the user after creation. Routes by project type so they
 *  arrive at the surface that actually moves their work forward. */
function postCreateRoute(
  projectId: string,
  projectType: ProjectType,
  redevTemplateId: string | null
): string {
  // SELVAJE template → straight into Redevelopment (R1 is waiting).
  if (redevTemplateId === "selvaje") {
    return `/projects/${projectId}/redevelopment`;
  }
  // Micro-drama bible lives on the project overview as a top card.
  if (projectType === "micro_drama") {
    return `/projects/${projectId}`;
  }
  // Prestige / mini / feature / anthology all start at project overview;
  // the recommended-next-step engine then routes them appropriately.
  return `/projects/${projectId}`;
}

export function CreateProjectDialog({
  onClose,
  landingRoute,
}: {
  onClose: () => void;
  // Override where the user lands after creation (e.g. straight into the new
  // project's Writers Room). Defaults to the type-aware postCreateRoute.
  landingRoute?: (projectId: string, projectType: ProjectType) => string;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [projectType, setProjectType] = useState<ProjectType>("prestige_series");
  const [redevTemplateId, setRedevTemplateId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [logline, setLogline] = useState("");
  const [genre, setGenre] = useState("");

  const templates = useQuery({
    queryKey: ["redev-templates"],
    queryFn: api.listRedevTemplates,
    enabled: step === 2,
  });

  const create = useMutation({
    mutationFn: async () => {
      const created = await api.createProject({
        title,
        kind: KIND_BY_TYPE[projectType],
        logline: logline || undefined,
        genre: genre
          ? genre.split(",").map((g) => g.trim()).filter(Boolean)
          : undefined,
        projectType,
        redevTemplateId: redevTemplateId ?? undefined,
      });
      return created;
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
      navigate(
        landingRoute
          ? landingRoute(created.id, projectType)
          : postCreateRoute(created.id, projectType, redevTemplateId)
      );
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel-strong w-full max-w-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl text-bone-50">
            {step === 1 ? "New project — choose format" : "New project — choose template"}
          </h2>
          <StepDots step={step} />
        </div>
        <p className="mt-1 text-sm text-bone-300">
          {step === 1
            ? "Pick the format. This drives the shot policy, workflow, and the surfaces you land on after creation."
            : "Templates seed the redevelopment passes with starting canon. Blank is a fresh start; SELVAJE pre-loads the prestige-thriller story spine."}
        </p>

        {step === 1 && (
          <ProjectTypeStep
            projectType={projectType}
            onChange={setProjectType}
          />
        )}

        {step === 2 && (
          <TemplateStep
            projectType={projectType}
            templates={templates.data ?? null}
            templatesLoading={templates.isLoading}
            redevTemplateId={redevTemplateId}
            onTemplate={setRedevTemplateId}
            title={title}
            setTitle={setTitle}
            logline={logline}
            setLogline={setLogline}
            genre={genre}
            setGenre={setGenre}
          />
        )}

        {create.error && (
          <div className="mt-3 rounded-md border border-red-700/50 bg-red-950/30 p-2 text-sm text-red-200">
            {(create.error as Error).message}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          {step === 1 ? (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          {step === 1 ? (
            <Button onClick={() => setStep(2)}>
              Continue <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              disabled={!title || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create project
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepDots({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-bone-400">
      <span className={step === 1 ? "text-ember-300" : ""}>Step 1</span>
      <span>·</span>
      <span className={step === 2 ? "text-ember-300" : ""}>Step 2</span>
    </div>
  );
}

function ProjectTypeStep({
  projectType,
  onChange,
}: {
  projectType: ProjectType;
  onChange: (t: ProjectType) => void;
}) {
  return (
    <div className="mt-4 grid grid-cols-1 gap-1.5">
      {(PROJECT_TYPES as readonly ProjectType[]).map((t) => {
        const cfg = PROJECT_TYPE_CONFIGS[t];
        const policy = cfg.shotPolicy;
        const active = projectType === t;
        return (
          <label
            key={t}
            className={
              "flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors " +
              (active
                ? "border-ember-700/60 bg-ember-900/15"
                : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]")
            }
          >
            <input
              type="radio"
              checked={active}
              onChange={() => onChange(t)}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-bone-100">{PROJECT_TYPE_LABEL[t]}</span>
                <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                  {policy.defaultAspectRatio}
                </span>
                <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                  {policy.minDurationSec}–{policy.maxDurationSec}s shots
                </span>
                <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                  {policy.coverageDensity} coverage
                </span>
                {policy.isMicroDramaTier && (
                  <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
                    vertical · retention-first
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] text-bone-400">
                {PROJECT_TYPE_DESCRIPTION[t]}
              </div>
              <div className="mt-1 text-[11px] text-bone-500">
                Best for: {bestForLabel(t)}
              </div>
            </div>
          </label>
        );
      })}
    </div>
  );
}

function bestForLabel(t: ProjectType): string {
  switch (t) {
    case "micro_drama":
      return "TikTok / Reels / Shorts. 30-120s vertical episodes. Hook-first.";
    case "prestige_series":
      return "Cinematic episodic TV. 30-60 minute episodes. Restrained coverage.";
    case "mini_series":
      return "Limited series. 4-12 episodes. Simpler production canon than prestige.";
    case "feature":
      return "Single film. 90-180 minutes. Theatrical pacing.";
    case "anthology":
      return "Standalone episodes sharing a world / tone. Each is its own creative pass.";
    default:
      return "";
  }
}

function TemplateStep({
  projectType,
  templates,
  templatesLoading,
  redevTemplateId,
  onTemplate,
  title,
  setTitle,
  logline,
  setLogline,
  genre,
  setGenre,
}: {
  projectType: ProjectType;
  templates: Array<{ templateId: string; templateName: string; templateTagline?: string; projectFormat?: string }> | null;
  templatesLoading: boolean;
  redevTemplateId: string | null;
  onTemplate: (id: string | null) => void;
  title: string;
  setTitle: (s: string) => void;
  logline: string;
  setLogline: (s: string) => void;
  genre: string;
  setGenre: (s: string) => void;
}) {
  return (
    <div className="mt-4 space-y-4">
      <div>
        <label className="label-eyebrow mb-1 block">Template</label>
        <div className="grid grid-cols-1 gap-1.5">
          {/* Blank — always available. */}
          <label
            className={
              "flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors " +
              (redevTemplateId === null || redevTemplateId === "blank"
                ? "border-ember-700/60 bg-ember-900/15"
                : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]")
            }
          >
            <input
              type="radio"
              checked={redevTemplateId === null || redevTemplateId === "blank"}
              onChange={() => onTemplate(null)}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="text-bone-100">Blank</div>
              <div className="mt-0.5 text-[12px] text-bone-400">
                Fresh start. No brief defaults, no character seeds — you author everything.
              </div>
              <div className="mt-1 text-[11px] text-bone-500">
                Compatible with: every project type
              </div>
            </div>
          </label>
          {/* Backend-registered templates (BLANK + SELVAJE today; more later). */}
          {templatesLoading ? (
            <div className="text-xs text-bone-400 px-3 py-2">Loading templates…</div>
          ) : (
            (templates ?? [])
              .filter((t) => t.templateId !== "blank") // shown above
              .map((t) => {
                const active = redevTemplateId === t.templateId;
                const compatible = templateCompatibleWith(t, projectType);
                return (
                  <label
                    key={t.templateId}
                    className={
                      "flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors " +
                      (active
                        ? "border-ember-700/60 bg-ember-900/15"
                        : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]") +
                      (compatible ? "" : " opacity-60")
                    }
                    title={compatible ? "" : `Designed for ${t.projectFormat ?? "another format"}`}
                  >
                    <input
                      type="radio"
                      checked={active}
                      onChange={() => onTemplate(t.templateId)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-bone-100">{t.templateName}</span>
                        {t.projectFormat && (
                          <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                            {t.projectFormat}
                          </span>
                        )}
                        {!compatible && (
                          <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
                            cross-format
                          </span>
                        )}
                      </div>
                      {t.templateTagline && (
                        <div className="mt-0.5 text-[12px] text-bone-400">{t.templateTagline}</div>
                      )}
                      <div className="mt-1 text-[11px] text-bone-500">
                        Includes: brief defaults · cast seeds · story engine · forbidden moves · R6 character contracts (when applicable)
                      </div>
                    </div>
                  </label>
                );
              })
          )}
        </div>
      </div>
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
        <label className="label-eyebrow mb-1 block">Logline (optional)</label>
        <textarea
          className="input min-h-[80px]"
          value={logline}
          onChange={(e) => setLogline(e.target.value)}
        />
      </div>
      <div>
        <label className="label-eyebrow mb-1 block">Genre (comma separated)</label>
        <input
          className="input"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="thriller, sci-fi, drama"
        />
      </div>
    </div>
  );
}

/** Templates may carry a `projectFormat` field naming the format they
 *  were authored for. We still allow the user to pick a cross-format
 *  template, but flag it visually. */
function templateCompatibleWith(
  t: { projectFormat?: string },
  projectType: ProjectType
): boolean {
  if (!t.projectFormat) return true;
  return t.projectFormat === projectType;
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
