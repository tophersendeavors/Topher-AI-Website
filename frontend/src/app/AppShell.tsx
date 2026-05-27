import { NavLink, Outlet, useParams } from "react-router-dom";
import {
  Clapperboard,
  Film,
  GitBranch,
  Heart,
  Layers,
  ListTree,
  Megaphone,
  ScrollText,
  Settings2,
  Sparkles,
  Users,
  Wand2,
  Wrench,
} from "lucide-react";
import clsx from "clsx";
import { useAuth } from "@/lib/auth";

const NAV: Array<{ to: (id: string) => string; label: string; Icon: typeof Film; section: 1 | 2 | 3 }> = [
  { to: (id) => `/projects/${id}`, label: "Overview", Icon: Layers, section: 1 },
  { to: (id) => `/projects/${id}/writers-room`, label: "Writers Room", Icon: Sparkles, section: 1 },
  { to: (id) => `/projects/${id}/character-bible`, label: "Character Bible", Icon: Users, section: 2 },
  { to: (id) => `/projects/${id}/story-bible`, label: "Story Bible", Icon: ScrollText, section: 2 },
  { to: (id) => `/projects/${id}/episodes`, label: "Episodes", Icon: ListTree, section: 2 },
  { to: (id) => `/projects/${id}/drafts`, label: "Drafts", Icon: Film, section: 3 },
  { to: (id) => `/projects/${id}/rewrites`, label: "Rewrites", Icon: Wand2, section: 3 },
  { to: (id) => `/projects/${id}/continuity`, label: "Continuity", Icon: GitBranch, section: 3 },
  { to: (id) => `/projects/${id}/emotional`, label: "Emotional Intelligence", Icon: Heart, section: 3 },
  { to: (id) => `/projects/${id}/production`, label: "Production Tools", Icon: Wrench, section: 3 },
  { to: (id) => `/projects/${id}/exports`, label: "Export Center", Icon: Clapperboard, section: 3 },
];

export function AppShell() {
  const params = useParams();
  const projectId = params.projectId;
  const { session, signOut, configured } = useAuth();

  return (
    <div className="grid h-screen grid-cols-[280px_minmax(0,1fr)]">
      <aside className="relative flex flex-col border-r border-white/[0.06] bg-ink-900/60 backdrop-blur-xl">
        <div className="absolute inset-x-0 top-0 h-24 bg-ember-glow opacity-70 pointer-events-none" />

        <NavLink to="/projects" className="relative flex items-center gap-3 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-gradient-to-br from-ember-500 to-ember-700 text-white font-semibold shadow-ember">
            T
          </div>
          <div className="leading-tight">
            <div className="text-[10px] uppercase tracking-[0.25em] text-bone-400/80">
              TOBURT
            </div>
            <div className="text-sm font-semibold text-bone-50">Studios OS</div>
          </div>
        </NavLink>

        <div className="px-5 pb-3">
          <NavLink
            to="/projects"
            end
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-white/[0.06] text-bone-50"
                  : "text-bone-300 hover:bg-white/[0.04] hover:text-bone-50"
              )
            }
          >
            <Megaphone className="h-4 w-4" />
            All Projects
          </NavLink>
        </div>

        {projectId ? (
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
            <SectionLabel label="Develop" />
            {NAV.filter((n) => n.section === 1).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Bibles" />
            {NAV.filter((n) => n.section === 2).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Drafts & Production" />
            {NAV.filter((n) => n.section === 3).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
          </nav>
        ) : (
          <div className="px-5 pt-3 text-sm text-bone-400">
            Select a project to open the writers' room.
          </div>
        )}

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
      className={({ isActive }) =>
        clsx(
          "group flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-white/[0.06] text-bone-50"
            : "text-bone-300 hover:bg-white/[0.04] hover:text-bone-50"
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={clsx(
              "h-4 w-4 transition-colors",
              isActive ? "text-ember-400" : "text-bone-400 group-hover:text-bone-200"
            )}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="label-eyebrow mt-3 px-3 pb-1">{label}</div>
  );
}
