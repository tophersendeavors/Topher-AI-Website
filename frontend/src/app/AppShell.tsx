import { NavLink, Outlet, useParams } from "react-router-dom";
import {
  Briefcase,
  Clapperboard,
  Compass,
  Film,
  GitBranch,
  Heart,
  Layers,
  ListTree,
  Megaphone,
  Presentation,
  ScrollText,
  Settings2,
  Smartphone,
  Sparkles,
  Users,
  Wand2,
  Wrench,
} from "lucide-react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useUIMode } from "@/lib/uiMode";
import { api } from "@/lib/api";

// Sidebar nav — organised by the three studio phases:
//
//   • Studio (overview / always at top)
//   • Writing       (write → review → lock)
//   • Production    (assemble canon, plan shots, run the queue)
//   • Delivery      (pitch + final exports)
//
// Routes are preserved — only labels and grouping change. The Studio
// Timeline on the Overview page is the canonical "what to do next"
// surface; the sidebar is the directory.
const NAV: Array<{ to: (id: string) => string; label: string; Icon: typeof Film; section: 0 | 1 | 2 | 3 | 4 }> = [
  // STUDIO — overview always at the top
  { to: (id) => `/projects/${id}`, label: "Studio Timeline", Icon: Compass, section: 0 },
  // WRITING — write + review + lock
  { to: (id) => `/projects/${id}/writers-room`, label: "Writers Room", Icon: Sparkles, section: 1 },
  { to: (id) => `/projects/${id}/drafts`, label: "Drafts", Icon: Film, section: 1 },
  { to: (id) => `/projects/${id}/continuity`, label: "Continuity", Icon: GitBranch, section: 1 },
  { to: (id) => `/projects/${id}/emotional`, label: "Emotional Intelligence", Icon: Heart, section: 1 },
  // TEAM — assemble + assign roles
  { to: (id) => `/projects/${id}/team`, label: "Creative Team", Icon: Users, section: 2 },
  // PRODUCTION — assemble canon, plan, queue
  { to: (id) => `/projects/${id}/episodes`, label: "Episodes", Icon: ListTree, section: 3 },
  { to: (id) => `/projects/${id}/character-bible`, label: "Character Bible", Icon: Users, section: 3 },
  { to: (id) => `/projects/${id}/story-bible`, label: "Story Bible", Icon: ScrollText, section: 3 },
  { to: (id) => `/projects/${id}/production`, label: "Production Hub", Icon: Layers, section: 3 },
  // DELIVERY — pitch + exports
  { to: (id) => `/projects/${id}/pitch`, label: "Pitch Materials", Icon: Presentation, section: 4 },
  { to: (id) => `/projects/${id}/exports`, label: "Export Center", Icon: Clapperboard, section: 4 },
];

export function AppShell() {
  const params = useParams();
  const projectId = params.projectId;
  const { session, signOut, configured } = useAuth();

  return (
    <div className="grid h-screen grid-cols-[280px_minmax(0,1fr)]">
      <aside className="os-sidebar relative flex flex-col">
        <NavLink to="/studio" className="os-sidebar-brand">
          <div className="os-sidebar-brand-mark">T</div>
          <div>
            <div className="os-sidebar-brand-eyebrow">TOBURT</div>
            <div className="os-sidebar-brand-name">Studios OS</div>
          </div>
        </NavLink>

        <div className="px-3 pb-2">
          <NavLink
            to="/studio"
            end
            className={({ isActive }) => clsx("os-nav-item", isActive && "is-active")}
          >
            <Clapperboard className="os-nav-icon" />
            Studio Lot
          </NavLink>
          <NavLink
            to="/projects"
            end
            className={({ isActive }) =>
              clsx("os-nav-item", isActive && "is-active")
            }
          >
            <Megaphone className="os-nav-icon" />
            All Projects
          </NavLink>
        </div>

        {projectId && <CurrentProjectChip projectId={projectId} />}

        {projectId ? (
          <nav className="flex flex-1 flex-col overflow-y-auto pb-4">
            <SectionLabel label="Studio" />
            {NAV.filter((n) => n.section === 0).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Writing" />
            {NAV.filter((n) => n.section === 1).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Team" />
            {NAV.filter((n) => n.section === 2).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Production" />
            {NAV.filter((n) => n.section === 3).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Delivery" />
            {NAV.filter((n) => n.section === 4).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
          </nav>
        ) : (
          <div className="px-5 pt-3 text-sm text-bone-400">
            Select a project to open the writers' room.
          </div>
        )}

        <ModeSwitch />

        <div className="mt-auto border-t border-white/[0.06] px-5 py-4 text-xs">
          {configured ? (
            session ? (
              <div className="flex items-center justify-between">
                <div className="text-bone-300 truncate">{session.user.email}</div>
                <button className="text-ember-400 hover:underline" onClick={signOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <div className="text-bone-400">Signed out</div>
            )
          ) : (
            <div className="rounded-md border border-amber-700/50 bg-amber-950/30 p-2 text-amber-200/90">
              <div className="flex items-center gap-1.5 font-medium">
                <Settings2 className="h-3 w-3" /> Local dev mode
              </div>
              <div className="mt-1 text-[11px] text-amber-200/70">
                Supabase env not set — auth bypassed.
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

// Simple / Advanced mode switch — persisted in localStorage. Simple is the
// default for non-experts: the OS shows AI actions + plain-language helpers
// and hides version labels, audit JSON, prompt internals. Advanced exposes
// the full craft control surface.
function ModeSwitch() {
  const { mode, setMode } = useUIMode();
  return (
    <div className="border-t border-white/[0.06] px-5 py-4 text-[11px]">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-bone-400/70">
        Mode
      </div>
      <div className="flex gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.025] p-1">
        <button
          onClick={() => setMode("simple")}
          className={clsx(
            "flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
            mode === "simple"
              ? "bg-white/[0.08] text-bone-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
              : "text-bone-400 hover:text-bone-100 hover:bg-white/[0.04]"
          )}
          title="Non-expert mode. AI drafts; you review. Jargon is explained inline."
        >
          Simple
        </button>
        <button
          onClick={() => setMode("advanced")}
          className={clsx(
            "flex-1 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-all",
            mode === "advanced"
              ? "bg-gradient-to-b from-ember-400/95 to-ember-600/85 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_14px_-6px_rgba(243,80,26,0.55)]"
              : "text-bone-400 hover:text-bone-100 hover:bg-white/[0.04]"
          )}
          title="Writers / producers. Full controls, version history, scoring details, prompt internals."
        >
          Advanced
        </button>
      </div>
    </div>
  );
}

function Item({
  to,
  label,
  Icon,
}: {
  to: string;
  label: string;
  Icon: typeof Film;
}) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) => clsx("os-nav-item", isActive && "is-active")}
    >
      <Icon className="os-nav-icon" />
      {label}
    </NavLink>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <div className="os-nav-section">{label}</div>;
}

// Always-visible "current project" card in the sidebar. Shows the project
// title + a tier chip (Prestige Series / Mini Series / Micro Drama) so the
// writer never wonders which project they're inside. Reads the same
// project metadata the dashboard reads. Updates automatically when the URL
// projectId changes.
function CurrentProjectChip({ projectId }: { projectId: string }) {
  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const meta = (project.data?.metadata ?? {}) as { projectType?: string };
  const tier = meta.projectType ?? "prestige_series";
  const tierLabel =
    tier === "micro_drama"
      ? "Micro Drama"
      : tier === "mini_series"
      ? "Mini Series"
      : "Prestige Series";
  return (
    <div className="os-project-card">
      <div className="os-project-card-eyebrow">Current Project</div>
      {project.isLoading ? (
        <div className="mt-2 h-5 animate-pulse-soft rounded-sm bg-white/[0.04]" />
      ) : (
        <>
          <div className="os-project-card-title">
            {project.data?.title ?? "Untitled"}
          </div>
          <div className="os-project-tier">
            <span className="os-tier-dot" />
            {tier === "micro_drama" && <Smartphone className="h-3 w-3" />}
            {tierLabel}
          </div>
        </>
      )}
    </div>
  );
}
