import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, PenLine, ArrowRight, Loader2 } from "lucide-react";
import { STUDIO_ROLE_LABELS, type Project } from "@toburt/shared";
import { api } from "@/lib/api";
import { sortByRecent } from "@/lib/recentProjects";
import { StudioLeftRail } from "@/features/studio/StudioLeftRail";
import { CreateProjectDialog } from "@/features/dashboard/ProjectsPage";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

const PHASE: Record<Project["status"], string> = {
  ideation: "Ideation",
  development: "Story Foundation",
  draft: "Drafting",
  production: "In Production",
  archived: "Archived",
};

function slug(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function WritersRoomLobby() {
  const navigate = useNavigate();
  const ownerQ = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const configQ = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });
  const [creating, setCreating] = useState(false);

  const owner = ownerQ.data?.owner ?? null;
  const config = configQ.data?.config ?? null;
  const approved = config?.concepts.find((c) => c.id === config?.approvedConceptId) ?? null;
  const studioName = approved?.name ?? "TOBURT STUDIOS";
  const ownerName = owner?.name && owner.name !== "chris" ? owner.name : "Studio Owner";
  const ownerTitle = owner?.role ? STUDIO_ROLE_LABELS[owner.role] : "Studio Owner";

  const all = projectsQ.data ?? [];
  const active = sortByRecent(all.filter((p) => p.status !== "archived"));
  const railFeatured = active[0] ?? null;

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

      <main className="pl-[248px]">
        <div className="mx-auto max-w-6xl px-8 py-8">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Writers Room</div>
            <h1 className="mt-1 font-apple text-4xl font-semibold text-bone-50">Choose a script to develop</h1>
            <p className="mt-1 text-[13px] text-bone-400">Pick a project to enter its Writers Room, or start a new script. The room opens for the project you choose — nothing is assumed.</p>
          </div>

          {projectsQ.isLoading ? (
            <div className="mt-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-bone-500" /></div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((p) => <ScriptCard key={p.id} project={p} />)}
              <NewScriptCard onClick={() => setCreating(true)} />
            </div>
          )}
        </div>
      </main>

      {creating && (
        <CreateProjectDialog
          onClose={() => setCreating(false)}
          landingRoute={(id) => `/projects/${id}/writers-room`}
        />
      )}
    </div>
  );
}

function ScriptCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}/writers-room`}
      className="group relative flex min-h-[260px] flex-col justify-end overflow-hidden rounded-2xl border border-[#26262c] transition-all hover:border-[#d8b15a]/55"
    >
      <div className="absolute inset-0 overflow-hidden"><Poster project={project} /></div>
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.55) 56%, rgba(0,0,0,0.95) 100%)" }} />

      <div className="absolute left-3 top-3 z-10">
        <span className="rounded-md border border-white/15 bg-black/55 px-2 py-0.5 text-[9px] uppercase tracking-wide backdrop-blur-sm" style={gold}>
          {PHASE[project.status]}
        </span>
      </div>

      <div className="relative z-10 p-4">
        <div className="font-apple text-[21px] font-semibold leading-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]">{project.title}</div>
        {project.logline && <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-bone-300">{project.logline}</p>}
        <div className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium" style={gold}>
          Enter Writers Room <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

function NewScriptCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex min-h-[260px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed border-[#2c2c33] text-center transition-colors hover:border-[#d8b15a]/45"
      style={{ background: "radial-gradient(120% 90% at 50% 120%, rgba(216,177,90,0.06), transparent 60%), linear-gradient(180deg, #121016, #0a0a0c)" }}
    >
      <div className="grid h-12 w-12 place-items-center rounded-full border" style={{ borderColor: `${GOLD}55`, color: GOLD }}>
        <Plus className="h-5 w-5" />
      </div>
      <div className="flex items-center gap-1.5 font-apple text-[16px] text-bone-200">
        <PenLine className="h-4 w-4" style={gold} /> Start a new script
      </div>
      <div className="text-[11px] text-bone-500 group-hover:text-[#d8b15a]">Create a project and open its Writers Room →</div>
    </button>
  );
}

function Poster({ project }: { project: Project }) {
  const sources = [
    project.cover_url ?? "",
    `/studio/projects/${project.id}.png`,
    `/studio/projects/${slug(project.title)}.png`,
  ].filter(Boolean);
  const [i, setI] = useState(0);
  const src = sources[i];
  if (!src) return <div className="h-full w-full" style={{ background: "linear-gradient(180deg, #1c150d, #0b0a08)" }} />;
  return (
    <img
      src={src}
      alt={project.title}
      onError={() => setI((n) => n + 1)}
      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
    />
  );
}
