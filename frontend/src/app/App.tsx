import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppShell } from "./AppShell";
import { SignInPage } from "@/features/auth/SignInPage";
import { ProjectsPage } from "@/features/dashboard/ProjectsPage";
import { ProjectOverviewPage } from "@/features/dashboard/ProjectOverviewPage";
import { WritersRoomPage } from "@/features/writers-room/WritersRoomPage";
import { CharacterBiblePage } from "@/features/character-bible/CharacterBiblePage";
import { StoryBiblePage } from "@/features/story-bible/StoryBiblePage";
import { EpisodesPage } from "@/features/episodes/EpisodesPage";
import { DraftsPage } from "@/features/drafts/DraftsPage";
import { ScriptEditorPage } from "@/features/editor/ScriptEditorPage";
import { RewritesPage } from "@/features/rewrites/RewritesPage";
import { ContinuityPage } from "@/features/continuity/ContinuityPage";
import { ProductionPage } from "@/features/production/ProductionPage";
import { ExportCenterPage } from "@/features/exports/ExportCenterPage";

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectOverviewPage />} />
            <Route path="projects/:projectId/writers-room" element={<WritersRoomPage />} />
            <Route path="projects/:projectId/character-bible" element={<CharacterBiblePage />} />
            <Route path="projects/:projectId/story-bible" element={<StoryBiblePage />} />
            <Route path="projects/:projectId/episodes" element={<EpisodesPage />} />
            <Route path="projects/:projectId/drafts" element={<DraftsPage />} />
            <Route path="projects/:projectId/drafts/:scriptId" element={<ScriptEditorPage />} />
            <Route path="projects/:projectId/rewrites" element={<RewritesPage />} />
            <Route path="projects/:projectId/continuity" element={<ContinuityPage />} />
            <Route path="projects/:projectId/production" element={<ProductionPage />} />
            <Route path="projects/:projectId/exports" element={<ExportCenterPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function RequireAuth() {
  const { session, loading, configured } = useAuth();
  if (loading) return <FullPageLoader />;
  // Allow exploration without auth when Supabase isn't configured (dev mode).
  if (!configured) return <AppShellOutlet />;
  if (!session) return <Navigate to="/sign-in" replace />;
  return <AppShellOutlet />;
}

import { Outlet } from "react-router-dom";

function AppShellOutlet() {
  return <Outlet />;
}

function FullPageLoader() {
  return (
    <div className="grid h-screen place-items-center text-bone-300">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-ember-400" />
        Loading TOBURT Studios…
      </div>
    </div>
  );
}
