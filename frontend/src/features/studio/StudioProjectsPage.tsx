import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Smartphone } from "lucide-react";
import { STUDIO_ROLE_LABELS, type Project } from "@toburt/shared";
import { api } from "@/lib/api";
import { StudioLeftRail } from "./StudioLeftRail";
import { StudioSidePanel } from "./StudioSidePanel";

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
  return (PTYPE_ORDER.includes(v as PType) ? (v as PType) : "prestige_series");
}

export function StudioProjectsPage() {
  const ownerQ = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const configQ = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });

  const owner = ownerQ.data?.owner ?? null;
  const projects = (projectsQ.data ?? []).filter((p) => p.status !== "archived");
  const config = configQ.data?.config ?? null;
  const approvedStudio = config?.concepts.find((c) => c.id === config?.approvedConceptId) ?? null;
  const studioName = approvedStudio?.name ?? "TOBURT STUDIOS";
  const ownerName = owner?.name && owner.name !== "chris" ? owner.name : "Studio Owner";
  const ownerTitle = owner?.role ? STUDIO_ROLE_LABELS[owner.role] : "Studio Owner";
  const featured = projects[0] ?? null;

  const [filter, setFilter] = useState<PType | "all">("all");
  const microDramas = projects.filter((p) => ptype(p) === "micro_drama");
  const shown = filter === "all" ? projects : projects.filter((p) => ptype(p) === filter);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-bone-100">
      <StudioLeftRail
        project={featured}
        studioName={studioName}
        logoUrl={config?.logoUrl ?? null}
        ownerName={ownerName}
        ownerTitle={ownerTitle}
        ownerAvatar={owner?.avatarUrl ?? null}
      />
      <StudioSidePanel project={featured} anchor="top" />

      <main className="lg:pl-[224px] lg:pr-[300px]">
        <div className="mx-auto max-w-5xl px-6 py-7">
          {/* header band */}
          <header className="relative mb-6 flex min-h-[200px] flex-col justify-end overflow-hidden rounded-2xl border border-[#26262c]">
            <LotBand />
            <div className="relative px-6 py-6">
              <div className="text-[11px] uppercase tracking-[0.3em] text-bone-400">Studio</div>
              <h1 className="mt-1 font-apple text-4xl font-semibold text-bone-50">Projects</h1>
              <p className="mt-2 max-w-md text-[13px] text-bone-300">
                Every film, pilot, series and short in development. Open one to enter its writers' room.
              </p>
            </div>
          </header>

          {/* micro dramas highlight */}
          {microDramas.length > 0 && (
            <div className="mb-6 rounded-2xl border border-[#26262c] bg-white/[0.015] p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-4 w-4" style={gold} />
                  <span className="text-[14px] font-medium text-bone-50">Micro Dramas</span>
                  <span className="rounded-full border border-[#26262c] px-2 py-0.5 text-[10px] text-bone-400">
                    {microDramas.length} active
                  </span>
                </div>
                <button onClick={() => setFilter("micro_drama")} className="text-[11px] text-bone-400 hover:text-bone-100">
                  Filter to micro dramas
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {microDramas.slice(0, 2).map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="flex gap-3 rounded-xl border border-[#26262c] p-2.5 hover:border-[#d8b15a]/40">
                    <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md">
                      <ProjImg project={p} />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-bone-50">{p.title}</div>
                      {p.logline && <p className="mt-0.5 line-clamp-2 text-[11px] text-bone-400">{p.logline}</p>}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* filters */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] uppercase tracking-[0.2em] text-bone-500">Filter</span>
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label={`All (${projects.length})`} />
            {PTYPE_ORDER.map((t) => (
              <FilterChip
                key={t}
                active={filter === t}
                onClick={() => setFilter(t)}
                label={`${PTYPE_LABEL[t]} (${projects.filter((p) => ptype(p) === t).length})`}
              />
            ))}
          </div>

          {/* grid */}
          {shown.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#26262c] p-10 text-center text-[13px] text-bone-400">
              No projects in this category yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function LotBand() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, #1a140c, #0b0a08)" }} />
      {!failed && (
        <img
          src="/studio/projects-header.jpg"
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {/* darken the left for title legibility, plus a gentle bottom fade */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(8,8,10,0.92) 0%, rgba(8,8,10,0.58) 45%, rgba(8,8,10,0.22) 100%)" }} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(8,8,10,0.15), rgba(8,8,10,0.5))" }} />
    </div>
  );
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

function ProjectCard({ project }: { project: Project }) {
  const tags = project.genre ?? [];
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group relative flex min-h-[380px] flex-col justify-end overflow-hidden rounded-2xl border border-[#26262c] transition-all hover:border-[#d8b15a]/55"
    >
      {/* full-bleed poster image */}
      <div className="absolute inset-0 overflow-hidden">
        <ProjImg project={project} />
      </div>
      {/* legibility gradient — clear at top, dark at the bottom where text sits */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 26%, rgba(0,0,0,0.5) 56%, rgba(0,0,0,0.93) 100%)",
        }}
      />

      {/* type chips — top-left */}
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
        <TypeChip accent>{PTYPE_LABEL[ptype(project)]}</TypeChip>
        <TypeChip>{project.kind}</TypeChip>
        <TypeChip>{project.status}</TypeChip>
      </div>

      {/* title + logline + genre — overlaid at the bottom */}
      <div className="relative z-10 p-4">
        <div className="font-apple text-[26px] font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">
          {project.title}
        </div>
        {project.logline && (
          <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-bone-200">{project.logline}</p>
        )}
        {tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tags.slice(0, 4).map((g) => (
              <span
                key={g}
                className="rounded border border-white/15 bg-black/40 px-2 py-0.5 text-[9px] uppercase tracking-wide text-bone-200 backdrop-blur-sm"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

function TypeChip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className="rounded-md border bg-black/45 px-2 py-0.5 text-[9px] uppercase tracking-wide backdrop-blur-sm"
      style={
        accent
          ? { borderColor: `${GOLD}80`, color: GOLD }
          : { borderColor: "rgba(255,255,255,0.18)", color: "#dad3bd" }
      }
    >
      {children}
    </span>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function ProjImg({ project }: { project: Project }) {
  // cover_url → /studio/projects/<id>.png → /studio/projects/<title-slug>.png → placeholder
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
