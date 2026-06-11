import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Loader2, ChevronRight, ArrowRight } from "lucide-react";
import { STUDIO_ROLE_LABELS, type Project } from "@toburt/shared";
import { api } from "@/lib/api";
import { StudioLeftRail } from "./StudioLeftRail";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

type PType = "prestige_series" | "mini_series" | "micro_drama" | "feature" | "anthology";
const PTYPE_ORDER: PType[] = ["prestige_series", "mini_series", "micro_drama", "feature", "anthology"];
const PTYPE_LABEL: Record<PType, string> = {
  prestige_series: "Prestige Series",
  mini_series: "Mini Series",
  micro_drama: "Micro Drama",
  feature: "Feature Film",
  anthology: "Anthology",
};
function ptype(p: Project): PType {
  const v = (p as unknown as { metadata?: Record<string, unknown> }).metadata?.projectType;
  return PTYPE_ORDER.includes(v as PType) ? (v as PType) : "prestige_series";
}

/** Map the project's coarse DB status onto the high-level production journey:
 *  the broad phase, the room it's in, the next action, and progress. */
function slate(p: Project): { phase: string; room: string; nextLabel: string; nextPath: string; progress: number } {
  switch (p.status) {
    case "ideation":
      return { phase: "Ideation", room: "Development", nextLabel: "Continue Development", nextPath: "", progress: 0.06 };
    case "development":
      return { phase: "Story Foundation", room: "Character Dept.", nextLabel: "Open Character Dept.", nextPath: "character-bible", progress: 0.2 };
    case "draft":
      return { phase: "Writers Room", room: "Writers Room", nextLabel: "Enter Writers Room", nextPath: "writers-room", progress: 0.5 };
    case "production":
      return { phase: "Production", room: "Production Floor", nextLabel: "Open Production", nextPath: "production", progress: 0.82 };
    case "archived":
      return { phase: "Archived", room: "—", nextLabel: "Open", nextPath: "", progress: 1 };
  }
}

export function StudioProjectsPage() {
  const ownerQ = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const configQ = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });

  const owner = ownerQ.data?.owner ?? null;
  const config = configQ.data?.config ?? null;
  const approvedStudio = config?.concepts.find((c) => c.id === config?.approvedConceptId) ?? null;
  const studioName = approvedStudio?.name ?? "TOBURT STUDIOS";
  const ownerName = owner?.name && owner.name !== "chris" ? owner.name : "Studio Owner";
  const ownerTitle = owner?.role ? STUDIO_ROLE_LABELS[owner.role] : "Studio Owner";

  const all = projectsQ.data ?? [];
  const railFeatured = all.filter((p) => p.status !== "archived")[0] ?? null;

  const [filter, setFilter] = useState<PType | "all" | "archived">("all");
  const active = all.filter((p) => p.status !== "archived");
  const shown =
    filter === "all"
      ? active
      : filter === "archived"
      ? all.filter((p) => p.status === "archived")
      : active.filter((p) => ptype(p) === filter);

  const featured = shown[0] ?? null;
  const rest = shown.slice(1);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-bone-100">
      <StudioLeftRail
        project={railFeatured}
        studioName={studioName}
        logoUrl={config?.logoUrl ?? null}
        ownerName={ownerName}
        ownerTitle={ownerTitle}
        ownerAvatar={owner?.avatarUrl ?? null}
      />

      <main className="lg:pl-[224px]">
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* ===== Hero ===== */}
          <Hero />

          {/* ===== Filters ===== */}
          <div className="mt-5 flex flex-wrap items-center gap-1.5">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All (${active.length})`} />
            {PTYPE_ORDER.map((t) => {
              const n = active.filter((p) => ptype(p) === t).length;
              return <FilterChip key={t} active={filter === t} onClick={() => setFilter(t)} label={`${PTYPE_LABEL[t]} (${n})`} />;
            })}
            {all.some((p) => p.status === "archived") && (
              <FilterChip active={filter === "archived"} onClick={() => setFilter("archived")} label="Archived" />
            )}
          </div>

          {/* ===== Featured Production ===== */}
          {featured ? (
            <div className="mt-5">
              <SectionLabel>Featured Production</SectionLabel>
              <FeaturedProduction project={featured} stageNo={1} />
            </div>
          ) : (
            <div className="mt-8 rounded-2xl border border-dashed border-[#26262c] p-12 text-center">
              <div className="font-apple text-xl text-bone-50">No productions in this category</div>
              <p className="mx-auto mt-1 max-w-md text-[12.5px] text-bone-400">
                Open a new sound stage and bring a story to life.
              </p>
            </div>
          )}

          {/* ===== Active Sound Stages ===== */}
          {featured && (
            <div className="mt-7">
              <SectionLabel>Active Sound Stages</SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rest.map((p, i) => (
                  <StagePass key={p.id} project={p} stageNo={i + 2} />
                ))}
                <AvailableStage stageNo={rest.length + 2} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Hero() {
  const nav = useNavigate();
  return (
    <header className="relative flex min-h-[180px] flex-col justify-end overflow-hidden rounded-2xl border border-[#26262c]">
      <img src="/studio/projects-header.jpg" alt="" className="absolute inset-0 h-full w-full scale-105 object-cover blur-[1px]" />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,8,10,0.55) 0%, rgba(8,8,10,0.2) 35%, rgba(8,8,10,0.92) 100%)" }} />
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 140px 40px rgba(0,0,0,0.7)" }} />
      <div className="relative flex flex-wrap items-end justify-between gap-3 px-6 py-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] text-bone-400">Studio · Production Office</div>
          <h1 className="mt-1 font-apple text-4xl font-semibold text-bone-50">Production Slate</h1>
          <p className="mt-1.5 text-[13px] text-bone-300">Every story currently alive on the lot.</p>
        </div>
        <button
          onClick={() => nav("/projects")}
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black"
          style={{ background: GOLD }}
        >
          <Plus className="h-4 w-4" /> New Production
        </button>
      </div>
    </header>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2.5 text-[11px] uppercase tracking-[0.24em]" style={gold}>{children}</div>;
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border px-3 py-1 text-[11.5px] transition-colors"
      style={active ? { borderColor: GOLD, color: GOLD, background: "rgba(216,177,90,0.10)" } : { borderColor: "#26262c", color: "#bdb497" }}
    >
      {label}
    </button>
  );
}

const STATUS_HUE: Record<Project["status"], string> = {
  ideation: "#c2bdae",
  development: "#6aa3d8",
  draft: "#d8b15a",
  production: "#6ad88f",
  archived: "#777",
};

// ---------------------------------------------------------------------------

function FeaturedProduction({ project, stageNo }: { project: Project; stageNo: number }) {
  const s = slate(project);
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group relative flex min-h-[320px] flex-col justify-end overflow-hidden rounded-2xl border border-[#26262c] transition-all hover:border-[#d8b15a]/55"
    >
      <div className="absolute inset-0 overflow-hidden">
        <ProjImg project={project} />
      </div>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.94) 100%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(0,0,0,0.4) 0%, transparent 55%)" }} />

      {/* stage tag */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        <span className="rounded-md border border-[#d8b15a]/40 bg-black/50 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] backdrop-blur-sm" style={gold}>
          Sound Stage {stageNo}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/50 px-2.5 py-1 text-[10px] uppercase tracking-wide backdrop-blur-sm" style={{ color: STATUS_HUE[project.status] }}>
          ● {s.phase}
        </span>
      </div>

      <div className="relative z-10 max-w-2xl p-6">
        <h2 className="font-apple text-[34px] font-semibold leading-none text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.9)]">{project.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-bone-300">
          <span className="uppercase tracking-wide" style={gold}>{PTYPE_LABEL[ptype(project)]}</span>
          <span>Phase · <span className="text-bone-100">{s.phase}</span></span>
          <span>Room · <span className="text-bone-100">{s.room}</span></span>
        </div>
        {project.logline && <p className="mt-2.5 max-w-xl text-[13px] leading-relaxed text-bone-200">{project.logline}</p>}
        <ProgressBar value={s.progress} className="mt-3.5 max-w-md" />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-medium text-black" style={{ background: GOLD }}>
            Enter Stage <ArrowRight className="h-4 w-4" />
          </span>
          <NextActionPill project={project} label={s.nextLabel} path={s.nextPath} />
        </div>
      </div>
    </Link>
  );
}

function StagePass({ project, stageNo }: { project: Project; stageNo: number }) {
  const qc = useQueryClient();
  const s = slate(project);
  const [confirming, setConfirming] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group relative flex min-h-[300px] flex-col justify-end overflow-hidden rounded-2xl border border-[#26262c] transition-all hover:border-[#d8b15a]/55"
    >
      <div className="absolute inset-0 overflow-hidden">
        <ProjImg project={project} />
      </div>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0.5) 54%, rgba(0,0,0,0.94) 100%)" }} />

      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5">
        <span className="rounded-md border border-[#d8b15a]/40 bg-black/55 px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] backdrop-blur-sm" style={gold}>
          Stage {stageNo}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-black/55 px-2 py-0.5 text-[9px] uppercase tracking-wide backdrop-blur-sm" style={{ color: STATUS_HUE[project.status] }}>
          {s.phase}
        </span>
      </div>

      <button
        onClick={(e) => { stop(e); setConfirming(true); }}
        className="absolute right-3 top-3 z-20 hidden rounded-md border border-white/15 bg-black/55 p-1.5 text-bone-300 backdrop-blur-sm hover:border-red-500/50 hover:text-red-300 group-hover:block"
        title="Delete project"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className="relative z-10 p-4">
        <div className="font-apple text-[22px] font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">{project.title}</div>
        <div className="mt-1 text-[10.5px] uppercase tracking-wide" style={gold}>{PTYPE_LABEL[ptype(project)]}</div>
        <div className="mt-1.5 text-[11px] text-bone-300">Room · <span className="text-bone-100">{s.room}</span></div>
        <ProgressBar value={s.progress} className="mt-2.5" />
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={gold}>
            Enter Stage <ChevronRight className="h-3.5 w-3.5" />
          </span>
          <NextActionPill project={project} label={s.nextLabel} path={s.nextPath} small />
        </div>
      </div>

      {confirming && (
        <div onClick={stop} className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/88 p-6 text-center backdrop-blur-sm">
          <Trash2 className="h-6 w-6 text-red-400" />
          <div className="font-apple text-[15px] text-bone-50">Delete "{project.title}"?</div>
          <p className="max-w-xs text-[11.5px] leading-relaxed text-bone-400">
            Permanently removes the production and all of its work. This can't be undone.
          </p>
          {del.isError && <p className="text-[11px] text-red-300">{(del.error as Error).message}</p>}
          <div className="mt-1 flex gap-2">
            <button onClick={(e) => { stop(e); del.mutate(); }} disabled={del.isPending} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-60">
              {del.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {del.isPending ? "Deleting…" : "Delete forever"}
            </button>
            <button onClick={(e) => { stop(e); setConfirming(false); }} className="rounded-lg border border-white/15 px-4 py-1.5 text-[12.5px] text-bone-200 hover:bg-white/5">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Link>
  );
}

function AvailableStage({ stageNo }: { stageNo: number }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav("/projects")}
      className="group relative flex min-h-[300px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed border-[#2c2c33] text-center transition-colors hover:border-[#d8b15a]/45"
      style={{ background: "radial-gradient(120% 90% at 50% 120%, rgba(216,177,90,0.06), transparent 60%), linear-gradient(180deg, #121016, #0a0a0c)" }}
    >
      <div className="text-[10px] uppercase tracking-[0.22em] text-bone-500">Sound Stage {stageNo}</div>
      <div className="grid h-12 w-12 place-items-center rounded-full border" style={{ borderColor: `${GOLD}55`, color: GOLD }}>
        <Plus className="h-5 w-5" />
      </div>
      <div className="font-apple text-[16px] text-bone-200">Available Stage</div>
      <div className="text-[11px] text-bone-500 group-hover:text-[#d8b15a]">Open a new production →</div>
    </button>
  );
}

function NextActionPill({ project, label, path, small }: { project: Project; label: string; path: string; small?: boolean }) {
  const nav = useNavigate();
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        nav(path ? `/projects/${project.id}/${path}` : `/projects/${project.id}`);
      }}
      className={
        "inline-flex items-center gap-1 rounded-lg border border-white/15 bg-black/40 backdrop-blur-sm hover:border-[#d8b15a]/45 hover:text-bone-50 " +
        (small ? "px-2 py-1 text-[10.5px] text-bone-300" : "px-3 py-2 text-[12px] text-bone-200")
      }
    >
      {label}
    </button>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={"h-1 w-full overflow-hidden rounded-full bg-white/10 " + className}>
      <div className="h-full rounded-full" style={{ width: `${Math.round(value * 100)}%`, background: GOLD }} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function ProjImg({ project }: { project: Project }) {
  const sources = [
    project.cover_url ?? "",
    `/studio/projects/${project.id}.png`,
    `/studio/projects/${slugify(project.title)}.png`,
  ].filter(Boolean);
  const [i, setI] = useState(0);
  const src = sources[i];
  if (!src) {
    return <div className="h-full w-full" style={{ background: "linear-gradient(180deg, #1c150d, #0b0a08)" }} />;
  }
  return (
    <img
      src={src}
      alt={project.title}
      onError={() => setI((n) => n + 1)}
      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
    />
  );
}
