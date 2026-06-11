import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid,
  Film,
  Users,
  Sparkles,
  Clapperboard,
  Scissors,
  Share2,
  UserCircle2,
  FolderOpen,
  MessageSquare,
  Settings,
  Moon,
} from "lucide-react";
import type { Project } from "@toburt/shared";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

export function StudioLeftRail({ project, studioName, logoUrl }: { project: Project | null; studioName: string; logoUrl: string | null }) {
  const proj = (path: string) => (project ? `/projects/${project.id}/${path}` : "/projects");
  const items: Array<{ label: string; sub: string; Icon: typeof Film; to: string; end?: boolean }> = [
    { label: "Studio Lot", sub: "Overview", Icon: LayoutGrid, to: "/studio", end: true },
    { label: "Projects", sub: "All Projects", Icon: Film, to: "/projects" },
    { label: "Characters", sub: "Character Hub", Icon: Users, to: proj("character-bible") },
    { label: "Writers Room", sub: "Stories · Scripts", Icon: Sparkles, to: proj("writers-room") },
    { label: "Production", sub: "Stages · Shoots", Icon: Clapperboard, to: proj("production") },
    { label: "Post Production", sub: "Edit · VFX · Audio", Icon: Scissors, to: proj("episodes") },
    { label: "Distribution", sub: "Releases · Analytics", Icon: Share2, to: proj("exports") },
    { label: "Talent", sub: "Agents · Cast · Crew", Icon: UserCircle2, to: proj("team") },
    { label: "Resources", sub: "Assets · Library", Icon: FolderOpen, to: proj("production") },
    { label: "Messages", sub: "Studio Comms", Icon: MessageSquare, to: "/studio" },
    { label: "Settings", sub: "Studio Settings", Icon: Settings, to: "/studio/owner" },
  ];

  return (
    <div className="absolute left-4 top-4 bottom-4 z-30 hidden w-[196px] flex-col gap-3 lg:flex">
      {/* Card 1 — brand + navigation */}
      <div
        className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#26262c] bg-black/55 backdrop-blur-xl"
        style={{ boxShadow: "0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)" }}
      >
      {/* brand */}
      <div className="flex items-center gap-2.5 border-b border-white/8 px-3.5 py-3.5">
        <Logo logoUrl={logoUrl} name={studioName} />
        <div className="leading-tight">
          <div className="font-apple text-[15px] font-semibold tracking-[0.12em] text-bone-50">{studioName.split(" ")[0]}</div>
          <div className="text-[8px] uppercase tracking-[0.28em]" style={gold}>Studios</div>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {items.map((it) => (
          <NavLink
            key={it.label}
            to={it.to}
            end={it.end}
            className={({ isActive }) =>
              "group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors " +
              (isActive ? "bg-[#d8b15a]/12" : "hover:bg-white/[0.04]")
            }
          >
            {({ isActive }) => (
              <>
                <it.Icon className="h-[18px] w-[18px] shrink-0" style={{ color: isActive ? GOLD : "#9a927e" }} />
                <div className="leading-tight">
                  <div className="text-[12.5px]" style={{ color: isActive ? "#f9f7f1" : "#cfc7b4" }}>{it.label}</div>
                  <div className="text-[9px] text-bone-600">{it.sub}</div>
                </div>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      </div>

      {/* Card 2 — clock / date / weather (its own card) */}
      <div
        className="rounded-2xl border border-[#26262c] bg-black/55 backdrop-blur-xl"
        style={{ boxShadow: "0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)" }}
      >
        <RailClock />
      </div>
    </div>
  );
}

function Logo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const src = logoUrl ?? "/studio/logo.png";
  if (failed) {
    return (
      <div className="grid h-8 w-8 place-items-center rounded-md border font-apple text-[15px]" style={{ borderColor: `${GOLD}66`, color: GOLD }}>
        {(name.trim()[0] ?? "T").toUpperCase()}
      </div>
    );
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className="h-8 w-8 object-contain" />;
}

function RailClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="px-3.5 py-3">
      <div className="font-apple text-[20px] text-bone-50">
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </div>
      <div className="text-[11px] text-bone-500">
        {now.toLocaleDateString([], { month: "long", day: "numeric" })}
      </div>
      <div className="mt-1 flex items-center gap-1 text-[11px]" style={gold}>
        <Moon className="h-3 w-3" /> Clear
      </div>
    </div>
  );
}
