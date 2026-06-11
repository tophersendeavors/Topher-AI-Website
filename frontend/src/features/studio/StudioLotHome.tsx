import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Users,
  Palette,
  Clapperboard,
  Film,
  Share2,
  ScrollText,
  ListChecks,
  Bot,
  Plus,
  ChevronRight,
  Clock,
} from "lucide-react";
import type { Project, StudioOwnerResponse, StudioRole } from "@toburt/shared";
import { api } from "@/lib/api";
import { StudioOwnerOnboarding } from "./StudioOwnerOnboarding";

const GOLD = "#d8b15a";
const goldText = { color: GOLD };

// The studio's standing collaborators — the engine's agents, given a face.
const STUDIO_TEAM = [
  { name: "Character Architect", role: "Character Bibles", status: "Building legends" },
  { name: "Dialogue Specialist", role: "Voice & Scenes", status: "On call" },
  { name: "Emotional Truth Editor", role: "Emotional Pass", status: "Reviewing" },
  { name: "Continuity Director", role: "Continuity", status: "Watching canon" },
  { name: "Audience Analyst", role: "Human Read", status: "Scoring drafts" },
];

export function StudioLotHome() {
  const qc = useQueryClient();
  const ownerQ = useQuery({ queryKey: ["studio-owner"], queryFn: () => api.getStudioOwner() });
  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => api.listProjects() });
  const configQ = useQuery({ queryKey: ["studio-config"], queryFn: () => api.getStudioConfig() });
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.saveStudioOwner>[0]) => api.saveStudioOwner(patch),
    onSuccess: (r: StudioOwnerResponse) => qc.setQueryData(["studio-owner"], r),
  });

  const owner = ownerQ.data?.owner ?? null;
  const projects = projectsQ.data ?? [];
  const active = projects.filter((p) => p.status !== "archived");
  const inProduction = projects.filter((p) => p.status === "production");
  const featured = [...active].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] ?? null;

  if (owner && !owner.onboardingComplete) {
    return (
      <StudioOwnerOnboarding
        initial={owner}
        onComplete={async (patch) => {
          await save.mutateAsync(patch);
        }}
      />
    );
  }

  const config = configQ.data?.config ?? null;
  const approvedStudio = config?.concepts.find((c) => c.id === config?.approvedConceptId) ?? null;
  const studioName = approvedStudio?.name ?? "TOBURT";
  const studioTagline = approvedStudio?.tagline ?? "Stories. Reimagined. Limits. Removed.";
  const ownerName = owner?.name && owner.name !== "chris" ? owner.name : "Studio Owner";

  return (
    <div className="min-h-screen bg-[#08080a] text-bone-100">
      {/* ===== Cinematic lot hero ===== */}
      <div
        className="relative overflow-hidden px-8 pt-7"
        style={{
          background:
            "radial-gradient(120% 90% at 50% -10%, rgba(216,177,90,0.18), transparent 55%)," +
            "linear-gradient(180deg, #141008 0%, #0b0a08 40%, #08080a 100%)",
        }}
      >
        {/* top row: welcome + stats + owner */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.3em] text-bone-400">Studio Lot · Overview</div>
            <h1 className="mt-1 font-serif text-3xl text-bone-50">
              Welcome back, <span style={goldText}>{ownerName}</span>
            </h1>
            <p className="text-[13px] text-bone-400">Where imagination becomes legacy.</p>
          </div>

          <div className="flex items-center gap-5">
            <Stat label="Active Projects" value={active.length} />
            <Stat label="In Production" value={inProduction.length} />
            <Stat label="Sound Stages" value={projects.length} />
            <LotClock />
          </div>

          <OwnerChip name={ownerName} role={owner?.role ?? null} avatarUrl={owner?.avatarUrl ?? null} title={owner?.creativeTwin?.titleLine} />
        </div>

        {/* the lot wordmark band */}
        <div className="relative mx-auto mt-6 mb-8 flex h-44 max-w-5xl items-end justify-center rounded-2xl border border-[#d8b15a]/15">
          <div
            className="absolute inset-0 rounded-2xl"
            style={{
              background:
                "radial-gradient(80% 120% at 50% 120%, rgba(216,177,90,0.22), transparent 60%)," +
                "linear-gradient(180deg, rgba(20,16,8,0.2), rgba(8,8,10,0.85))",
            }}
          />
          <div className="relative pb-7 text-center">
            <div className="font-serif text-4xl tracking-[0.18em] text-bone-50">
              {approvedStudio ? studioName : "TOBURT STUDIOS"}
            </div>
            <div className="mt-1 text-[10.5px] uppercase tracking-[0.34em]" style={goldText}>
              {studioTagline}
            </div>
            {!approvedStudio && (
              <Link
                to="/studio/build"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-[11.5px]"
                style={{ borderColor: `${GOLD}55`, color: GOLD }}
              >
                <Sparkles className="h-3.5 w-3.5" /> Design your own studio
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 px-8 pb-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ===== main column ===== */}
        <div className="space-y-6">
          {/* Sound stages = projects */}
          <Section title="Sound Stages" action={<Link to="/projects" className="text-[12px] text-bone-400 hover:text-bone-100">All projects →</Link>}>
            {projects.length === 0 ? (
              <EmptyLot />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {active.map((p, i) => (
                  <SoundStage key={p.id} project={p} index={i + 1} />
                ))}
              </div>
            )}
          </Section>

          {/* Explore the studio = rooms/departments */}
          {featured && (
            <Section title="Explore the Studio" subtitle={`Step into ${featured.title}`}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rooms(featured.id).map((r) => (
                  <RoomCard key={r.label} {...r} />
                ))}
              </div>
            </Section>
          )}
        </div>

        {/* ===== right rail ===== */}
        <div className="space-y-6">
          {featured && <FeaturedProject project={featured} />}
          <Section title="Studio Team">
            <div className="space-y-1.5">
              {STUDIO_TEAM.map((m) => (
                <div key={m.name} className="flex items-center gap-2.5 rounded-md border border-white/6 bg-white/[0.015] px-2.5 py-1.5">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[12px]" style={{ borderColor: `${GOLD}55`, color: GOLD }}>
                    {m.name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-bone-100">{m.name}</div>
                    <div className="truncate text-[10.5px] text-bone-500">{m.role}</div>
                  </div>
                  <div className="shrink-0 text-[10px]" style={goldText}>{m.status}</div>
                </div>
              ))}
            </div>
          </Section>
          {featured && <QuickAccess projectId={featured.id} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <div className="font-serif text-2xl" style={goldText}>{value}</div>
      <div className="text-[9.5px] uppercase tracking-wide text-bone-500">{label}</div>
    </div>
  );
}

function LotClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-white/8 px-2.5 py-1 text-[11px] text-bone-400">
      <Clock className="h-3 w-3" style={goldText} />
      {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
    </div>
  );
}

function OwnerChip({ name, role, avatarUrl, title }: { name: string; role: StudioRole | null; avatarUrl: string | null; title?: string }) {
  return (
    <Link to="/studio/owner" className="flex items-center gap-2.5 rounded-xl border border-[#d8b15a]/25 bg-black/30 px-3 py-1.5 hover:border-[#d8b15a]/50">
      <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-full border" style={{ borderColor: `${GOLD}66` }}>
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : <span className="font-serif" style={goldText}>{name[0]}</span>}
      </div>
      <div className="leading-tight">
        <div className="text-[12.5px] text-bone-50">{name}</div>
        <div className="text-[9.5px] uppercase tracking-wide text-bone-500">{title ?? "Studio Owner"}</div>
      </div>
    </Link>
  );
}

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-end justify-between">
        <div>
          <h2 className="text-[12px] uppercase tracking-[0.22em]" style={goldText}>{title}</h2>
          {subtitle && <div className="text-[11px] text-bone-500">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const STATUS_HUE: Record<Project["status"], string> = {
  ideation: "#7c7c8a",
  development: "#6aa3d8",
  draft: "#d8b15a",
  production: "#6ad88f",
  archived: "#555",
};

function SoundStage({ project, index }: { project: Project; index: number }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="group relative overflow-hidden rounded-xl border border-white/8 bg-gradient-to-b from-white/[0.03] to-transparent p-3.5 transition-colors hover:border-[#d8b15a]/40"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-bone-500">Sound Stage {index}</span>
        <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: STATUS_HUE[project.status] }}>
          ● {project.status}
        </span>
      </div>
      <div className="mt-2 font-serif text-lg text-bone-50 group-hover:text-white">{project.title}</div>
      {project.logline && <p className="mt-1 line-clamp-2 text-[11.5px] text-bone-400">{project.logline}</p>}
      <div className="mt-2 flex items-center text-[11px] text-bone-500 group-hover:text-[#d8b15a]">
        Enter stage <ChevronRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function rooms(pid: string) {
  return [
    { label: "Writers Room", sub: "Develop Stories", Icon: Sparkles, to: `/projects/${pid}/writers-room` },
    { label: "Character Dept.", sub: "Build Legends", Icon: Users, to: `/projects/${pid}/character-bible` },
    { label: "Art Department", sub: "Create Worlds", Icon: Palette, to: `/projects/${pid}/production` },
    { label: "Production", sub: "Bring to Life", Icon: Clapperboard, to: `/projects/${pid}/episodes` },
    { label: "Post Production", sub: "Shape the Final Cut", Icon: Film, to: `/projects/${pid}/production` },
    { label: "Distribution", sub: "Share the Story", Icon: Share2, to: `/projects/${pid}/exports` },
  ];
}

function RoomCard({ label, sub, Icon, to }: { label: string; sub: string; Icon: typeof Sparkles; to: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3.5 transition-colors hover:border-[#d8b15a]/40">
      <div className="grid h-10 w-10 place-items-center rounded-lg border" style={{ borderColor: `${GOLD}44`, color: GOLD, background: "rgba(216,177,90,0.06)" }}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-[13px] text-bone-50">{label}</div>
        <div className="text-[11px] text-bone-500">{sub}</div>
      </div>
    </Link>
  );
}

function FeaturedProject({ project }: { project: Project }) {
  return (
    <Section title="Featured Project">
      <Link to={`/projects/${project.id}`} className="block overflow-hidden rounded-xl border border-[#d8b15a]/20 bg-gradient-to-b from-[#141008] to-[#0b0a08] p-4 hover:border-[#d8b15a]/45">
        <div className="font-serif text-2xl tracking-wide text-bone-50">{project.title}</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-[0.2em]" style={goldText}>{project.status}</div>
        {project.logline && <p className="mt-2 line-clamp-3 text-[12px] text-bone-300">{project.logline}</p>}
        <div className="mt-3 inline-flex items-center gap-1 text-[11.5px]" style={goldText}>
          Open production <ChevronRight className="h-3.5 w-3.5" />
        </div>
      </Link>
    </Section>
  );
}

function QuickAccess({ projectId }: { projectId: string }) {
  const items = [
    { label: "Story Bible", Icon: ScrollText, to: `/projects/${projectId}/story-bible` },
    { label: "Shot List", Icon: ListChecks, to: `/projects/${projectId}/episodes` },
    { label: "Character Bible", Icon: Users, to: `/projects/${projectId}/character-bible` },
    { label: "Audience Read", Icon: Film, to: `/projects/${projectId}/episodes` },
    { label: "Assets Library", Icon: Palette, to: `/projects/${projectId}/production` },
    { label: "AI Agents", Icon: Bot, to: `/projects/${projectId}/writers-room` },
  ];
  return (
    <Section title="Quick Access">
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <Link key={it.label} to={it.to} className="flex items-center gap-2 rounded-md border border-white/8 bg-white/[0.02] px-2.5 py-2 text-[11.5px] text-bone-300 hover:border-[#d8b15a]/40 hover:text-bone-100">
            <it.Icon className="h-3.5 w-3.5" style={goldText} />
            {it.label}
          </Link>
        ))}
      </div>
    </Section>
  );
}

function EmptyLot() {
  return (
    <div className="rounded-xl border border-dashed border-[#d8b15a]/25 bg-white/[0.01] p-8 text-center">
      <div className="font-serif text-xl text-bone-50">Your lot is empty</div>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] text-bone-400">
        Every production lights up a sound stage. Create your first one and the studio comes alive.
      </p>
      <Link
        to="/projects"
        className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black"
        style={{ background: GOLD }}
      >
        <Plus className="h-4 w-4" /> Open your first stage
      </Link>
    </div>
  );
}
