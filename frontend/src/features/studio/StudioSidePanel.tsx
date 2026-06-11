import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, ChevronRight } from "lucide-react";
import type { Project } from "@toburt/shared";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

// Representative studio team — the engine's collaborators given faces. Drop a
// photo at /studio/team/<slug>.png to replace the monogram. Real per-project
// role assignments will populate this later.
const TEAM = [
  { slug: "showrunner", name: "Showrunner", title: "Story & Season", status: "Steering the season" },
  { slug: "character-architect", name: "Character Architect", title: "Character Bibles", status: "Updating bible" },
  { slug: "emotional-truth", name: "Emotional Truth Editor", title: "Emotional Pass", status: "In review" },
  { slug: "continuity", name: "Continuity Director", title: "Continuity", status: "Continuity check" },
  { slug: "audience", name: "Audience Analyst", title: "Human Read", status: "Scoring drafts" },
  { slug: "production-designer", name: "Production Designer", title: "Art Department", status: "Designing set" },
];

// Placeholder until a calendar feed is wired — shape is final.
const EVENTS = [
  { title: "Writers Room Session", when: "Tomorrow · 10:00 AM" },
  { title: "Table Read — Episode 4", when: "Fri · 2:00 PM" },
  { title: "Directing Review", when: "Mon · 11:00 AM" },
];

const STATUS_PROGRESS: Record<Project["status"], number> = {
  ideation: 0.12,
  development: 0.35,
  draft: 0.6,
  production: 0.85,
  archived: 1,
};

export function StudioSidePanel({ project, anchor = "bottom" }: { project: Project | null; anchor?: "top" | "bottom" }) {
  return (
    <div
      className={
        "fixed right-4 z-20 hidden max-h-[calc(100vh-2rem)] w-[272px] flex-col gap-3 overflow-y-auto pr-0.5 lg:flex " +
        (anchor === "top" ? "top-4" : "bottom-4")
      }
    >
      <FeaturedProjectCard project={project} />
      <StudioTeamCard projectId={project?.id ?? null} />
      <UpcomingEventsCard />
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={"rounded-2xl border border-[#26262c] bg-black/45 p-3 backdrop-blur-xl " + className}
      style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)" }}
    >
      {children}
    </div>
  );
}

function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-[0.26em]" style={gold}>{title}</span>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------

function FeaturedProjectCard({ project }: { project: Project | null }) {
  if (!project) {
    return (
      <Card>
        <CardHeader title="Featured Project" />
        <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-5 text-center text-[12px] text-bone-400">
          No production yet. Open a sound stage to feature it here.
        </div>
      </Card>
    );
  }
  const progress = STATUS_PROGRESS[project.status] ?? 0.1;
  return (
    <Card>
      <CardHeader title="Featured Project" />
      <Link to={`/projects/${project.id}`} className="group block overflow-hidden rounded-xl border border-[#26262c]">
        {/* 4:3 hero image with the title overlaid (poster treatment) */}
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <FeaturedImage project={project} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.85))" }} />
          <div className="absolute inset-x-0 bottom-0 p-3 text-center">
            <div className="font-apple text-2xl font-semibold tracking-wide text-bone-50">{project.title}</div>
            <div className="text-[10px] uppercase tracking-[0.2em]" style={gold}>{project.kind}</div>
          </div>
        </div>
        {/* status + progress */}
        <div className="bg-gradient-to-b from-[#141008] to-[#0b0a08] px-3 py-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="capitalize text-bone-300">{project.status}</span>
            <span className="text-bone-500 transition-colors group-hover:text-[#d8b15a]">Open →</span>
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/8">
            <div className="h-full rounded-full" style={{ width: `${Math.round(progress * 100)}%`, background: GOLD }} />
          </div>
        </div>
      </Link>
    </Card>
  );
}

function FeaturedImage({ project }: { project: Project }) {
  const sources = [
    project.cover_url ?? "",
    `/studio/projects/${project.id}.png`,
    "/studio/projects/featured.png",
    "/studio/projects/featured.svg", // sample so the card is populated; real drops above win
  ].filter(Boolean);
  const [i, setI] = useState(0);
  const src = sources[i];
  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center" style={{ background: "linear-gradient(180deg, #1c150d, #0b0a08)" }}>
        <span className="text-[9px] uppercase tracking-wide text-bone-600">project image</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={project.title}
      onError={() => setI((n) => n + 1)}
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
    />
  );
}

// ---------------------------------------------------------------------------

function StudioTeamCard({ projectId }: { projectId: string | null }) {
  return (
    <Card>
      <CardHeader
        title="Studio Team"
        action={
          <Link to={projectId ? `/projects/${projectId}/team` : "/projects"} className="text-[10px] hover:text-bone-100" style={gold}>
            View All
          </Link>
        }
      />
      <div className="space-y-1">
        {TEAM.slice(0, 4).map((m) => (
          <div key={m.slug} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-white/[0.03]">
            <TeamAvatar slug={m.slug} name={m.name} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12px] text-bone-50">{m.name}</div>
              <div className="truncate text-[10px] text-bone-500">{m.title}</div>
              <div className="truncate text-[10px]" style={gold}>{m.status}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function TeamAvatar({ slug, name }: { slug: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full border text-[12px]" style={{ borderColor: `${GOLD}55`, color: GOLD }}>
        {name[0]}
      </div>
    );
  }
  return (
    <img
      src={`/studio/team/${slug}.png`}
      alt={name}
      onError={() => setFailed(true)}
      className="h-9 w-9 shrink-0 rounded-full border object-cover"
      style={{ borderColor: `${GOLD}55` }}
    />
  );
}

// ---------------------------------------------------------------------------

function UpcomingEventsCard() {
  return (
    // Fixed height to match the Explore-the-Studio panel exactly.
    <Card className="flex h-[200px] flex-col">
      <CardHeader
        title="Upcoming Events"
        action={<span className="cursor-default text-[10px] text-bone-500" title="Calendar coming soon">View Calendar</span>}
      />
      <div className="flex flex-1 flex-col justify-between">
        {EVENTS.map((e) => (
          <div key={e.title} className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[#26262c] bg-white/[0.02]">
              <Calendar className="h-3.5 w-3.5" style={gold} />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[12px] text-bone-100">{e.title}</div>
              <div className="text-[10px] text-bone-500">{e.when}</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-bone-600" />
          </div>
        ))}
      </div>
    </Card>
  );
}
