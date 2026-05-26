import { NavLink, Outlet } from "react-router-dom";
import type { StudioApi } from "@/hooks/useDesignStudio";
import { isSupabaseConfigured } from "@/lib/supabase";
import { readEnv } from "@/lib/env";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/daily", label: "Daily Designs" },
  { to: "/library", label: "Saved Library" },
  { to: "/export", label: "Export" },
  { to: "/prompts", label: "Prompt Editor" },
  { to: "/brand", label: "Brand Settings" },
];

export default function Layout({ studio }: { studio: StudioApi }) {
  return (
    <div className="min-h-full flex">
      <aside className="w-64 shrink-0 border-r border-white/5 bg-ash-ink/60 p-6 flex flex-col gap-8">
        <div>
          <div className="display-title text-3xl text-ash-bone leading-none distress">
            ASH
            <br />
            KROW
          </div>
          <div className="label mt-2">Design Studio</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `px-3 py-2 text-xs uppercase tracking-[0.22em] border-l-2 ${
                  isActive
                    ? "border-ash-bone text-ash-bone bg-white/5"
                    : "border-transparent text-ash-gray hover:text-ash-bone hover:bg-white/[0.03]"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto text-[10px] uppercase tracking-[0.22em] text-ash-gray/80 leading-relaxed">
          <div>
            Supabase:{" "}
            <span className={isSupabaseConfigured ? "text-ash-bone" : "text-ash-rust"}>
              {isSupabaseConfigured ? "connected" : "local-only"}
            </span>
          </div>
          <div>
            Image API:{" "}
            <span className="text-ash-bone">
              {readEnv("VITE_IMAGE_API_PROVIDER") || "mock"}
            </span>
          </div>
          <div className="mt-3 text-ash-gray/60 normal-case tracking-normal">
            v0.1 — internal use only
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0 relative">
        <header className="sticky top-0 z-10 backdrop-blur bg-ash-black/70 border-b border-white/5 px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="label">Daily Auto-Generation</div>
            <div className="chip">
              {studio.todayBatch.length}/5 today
            </div>
            {studio.generating && <div className="chip text-ash-bone animate-pulse">generating…</div>}
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => studio.generateToday()}
            disabled={studio.generating}
          >
            Regenerate today
          </button>
        </header>
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
