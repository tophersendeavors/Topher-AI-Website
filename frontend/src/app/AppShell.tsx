import { NavLink, Outlet, useParams } from "react-router-dom";
import {
  Briefcase,
  Clapperboard,
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

// Sidebar nav (Stage 6 — consolidated).
//
// 5 sections, ~10 entries. Production Tools / Departments / Rewrites and
// the 4 sub-pitch entries are gone — their content lives inside other
// pages (Episode workflow stages, single Pitch page with internal tabs,
// Drafts page with rewrites tab). The Episode-level WORKFLOW page is
// the canonical entry point for everything production-related.
const NAV: Array<{ to: (id: string) => string; label: string; Icon: typeof Film; section: 1 | 2 | 3 | 4 }> = [
  // PLAN
  { to: (id) => `/projects/${id}`, label: "Overview", Icon: Layers, section: 1 },
  { to: (id) => `/projects/${id}/writers-room`, label: "Writers Room", Icon: Sparkles, section: 1 },
  { to: (id) => `/projects/${id}/character-bible`, label: "Character Bible", Icon: Users, section: 1 },
  { to: (id) => `/projects/${id}/story-bible`, label: "Story Bible", Icon: ScrollText, section: 1 },
  // WRITE & PRODUCE
  { to: (id) => `/projects/${id}/episodes`, label: "Episodes", Icon: ListTree, section: 2 },
  { to: (id) => `/projects/${id}/drafts`, label: "Drafts", Icon: Film, section: 2 },
  { to: (id) => `/projects/${id}/continuity`, label: "Continuity", Icon: GitBranch, section: 2 },
  { to: (id) => `/projects/${id}/emotional`, label: "Emotional Intelligence", Icon: Heart, section: 2 },
  // PITCH (single entry — the 5 deck types are tabs inside the page)
  { to: (id) => `/projects/${id}/pitch`, label: "Pitch Materials", Icon: Presentation, section: 3 },
  // EXPORT
  { to: (id) => `/projects/${id}/exports`, label: "Export Center", Icon: Clapperboard, section: 4 },
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

        {projectId && <CurrentProjectChip projectId={projectId} />}

        {projectId ? (
          <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
            <SectionLabel label="Plan" />
            {NAV.filter((n) => n.section === 1).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Write & Produce" />
            {NAV.filter((n) => n.section === 2).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Pitch" />
            {NAV.filter((n) => n.section === 3).map((n) => (
              <Item key={n.label} to={n.to(projectId)} label={n.label} Icon={n.Icon} />
            ))}
            <SectionLabel label="Export" />
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
    <div className="border-t border-white/[0.06] px-5 py-3 text-[11px]">
      <div className="mb-1 uppercase tracking-wide text-bone-500">Mode</div>
      <div className="flex rounded-md border border-white/8 bg-white/[0.02] p-0.5">
        <button
          onClick={() => setMode("simple")}
          className={clsx(
            "flex-1 rounded px-2 py-1 transition-colors",
            mode === "simple"
              ? "bg-white/[0.08] text-bone-50"
              : "text-bone-400 hover:text-bone-200"
          )}
          title="Non-expert mode. AI drafts; you review. Jargon is explained inline."
        >
          Simple
        </button>
        <button
          onClick={() => setMode("advanced")}
          className={clsx(
            "flex-1 rounded px-2 py-1 transition-colors",
            mode === "advanced"
              ? "bg-white/[0.08] text-bone-50"
              : "text-bone-400 hover:text-bone-200"
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
  const tierClass =
    tier === "micro_drama"
      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
      : tier === "mini_series"
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : "border-white/12 bg-white/[0.04] text-bone-200";
  return (
    <div className="mx-5 mb-3 rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="label-eyebrow text-bone-500">Current project</div>
      {project.isLoading ? (
        <div className="mt-1 h-4 animate-pulse-soft rounded-sm bg-white/[0.04]" />
      ) : (
        <>
          <div className="mt-1 truncate font-serif text-sm text-bone-50">
            {project.data?.title ?? "Untitled"}
          </div>
          <div className="mt-1 flex items-center gap-1">
            <span className={"chip text-[10px] " + tierClass}>
              {tier === "micro_drama" && (
                <Smartphone className="h-3 w-3" />
              )}
              {tierLabel}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
