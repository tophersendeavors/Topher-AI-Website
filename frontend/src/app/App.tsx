import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { UIModeProvider } from "@/lib/uiMode";
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
import { DraftWorkspacePage } from "@/features/drafts/DraftWorkspacePage";
import { RewritesPage } from "@/features/rewrites/RewritesPage";
import { ContinuityPage } from "@/features/continuity/ContinuityPage";
import { ProductionPage } from "@/features/production/ProductionPage";
import { ExportCenterPage } from "@/features/exports/ExportCenterPage";
import { EmotionalIntelligencePage } from "@/features/emotional/EmotionalIntelligencePage";
import { PitchMaterialsPage } from "@/features/pitch/PitchMaterialsPage";
import { DepartmentsHubPage } from "@/features/departments/DepartmentsHubPage";
import { DepartmentWorkspacePage } from "@/features/departments/DepartmentWorkspacePage";
import { WorkflowPage } from "@/features/workflow/WorkflowPage";
import { RedevelopmentPage } from "@/features/redevelopment/RedevelopmentPage";
import { SoundBiblePage } from "@/features/sound-bible/SoundBiblePage";
import { AudienceReadPage } from "@/features/audience-read/AudienceReadPage";
import { StudioLotHome } from "@/features/studio/StudioLotHome";
import { StudioOwnerPage } from "@/features/studio/StudioOwnerPage";
import { ShotListPage } from "@/features/shot-list/ShotListPage";
import { TrailerBuilderPage } from "@/features/trailer-builder/TrailerBuilderPage";
import { ProductionHubPage } from "@/features/production-hub/ProductionHubPage";
import { GenerationQueuePage } from "@/features/generation-queue/GenerationQueuePage";
import { CreativeTeamPage } from "@/features/team/CreativeTeamPage";

export function App() {
  return (
    <AuthProvider>
      <UIModeProvider>
        <AppRoutes />
      </UIModeProvider>
    </AuthProvider>
  );
}

function AppRoutes() {
  return (
    <>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/studio" replace />} />
            <Route path="studio" element={<StudioLotHome />} />
            <Route path="studio/owner" element={<StudioOwnerPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="projects/:projectId" element={<ProjectOverviewPage />} />
            <Route path="projects/:projectId/writers-room" element={<WritersRoomPage />} />
            <Route path="projects/:projectId/character-bible" element={<CharacterBiblePage />} />
            <Route path="projects/:projectId/story-bible" element={<StoryBiblePage />} />
            <Route path="projects/:projectId/episodes" element={<EpisodesPage />} />
            {/* Pitch Materials — buyer-facing, separate from the 95% Script Quality Protocol. */}
            <Route path="projects/:projectId/pitch" element={<PitchMaterialsPage />} />
            <Route path="projects/:projectId/drafts" element={<DraftsPage />} />
            <Route path="projects/:projectId/drafts/:scriptId" element={<DraftWorkspacePage />} />
            <Route path="projects/:projectId/drafts/:scriptId/editor" element={<ScriptEditorPage />} />
            <Route path="projects/:projectId/rewrites" element={<RewritesPage />} />
            <Route path="projects/:projectId/continuity" element={<ContinuityPage />} />
            <Route path="projects/:projectId/emotional" element={<EmotionalIntelligencePage />} />
            <Route path="projects/:projectId/production" element={<ProductionHubPage />} />
            <Route path="projects/:projectId/production-tools" element={<ProductionPage />} />
            <Route path="projects/:projectId/exports" element={<ExportCenterPage />} />
            <Route path="projects/:projectId/team" element={<CreativeTeamPage />} />
            <Route path="projects/:projectId/departments" element={<DepartmentsHubPage />} />
            <Route
              path="projects/:projectId/departments/:deptKey"
              element={<DepartmentWorkspacePage />}
            />
            <Route
              path="projects/:projectId/episodes/:episodeId/workflow"
              element={<WorkflowPage />}
            />
            <Route
              path="projects/:projectId/episodes/:episodeId/sound-bible"
              element={<SoundBiblePage />}
            />
            <Route
              path="projects/:projectId/episodes/:episodeId/audience-read"
              element={<AudienceReadPage />}
            />
            <Route
              path="projects/:projectId/episodes/:episodeId/shot-list"
              element={<ShotListPage />}
            />
            <Route
              path="projects/:projectId/episodes/:episodeId/trailer-builder"
              element={<TrailerBuilderPage />}
            />
            <Route
              path="projects/:projectId/episodes/:episodeId/generation-queue"
              element={<GenerationQueuePage />}
            />
            <Route
              path="projects/:projectId/redevelopment"
              element={<RedevelopmentPage />}
            />
            <Route
              path="projects/:projectId/redevelopment/:passId"
              element={<RedevelopmentPage />}
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
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
