import { Route, Routes } from "react-router-dom";
import Layout from "@/components/Layout";
import { useDesignStudio } from "@/hooks/useDesignStudio";
import Home from "@/pages/Home";
import DailyDesigns from "@/pages/DailyDesigns";
import DesignDetail from "@/pages/DesignDetail";
import SavedLibrary from "@/pages/SavedLibrary";
import ExportPage from "@/pages/ExportPage";
import BrandSettingsPage from "@/pages/BrandSettings";
import PromptEditor from "@/pages/PromptEditor";

export default function App() {
  const studio = useDesignStudio();

  if (studio.loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="display-title text-2xl text-ash-bone distress animate-pulse">
          Loading the atelier…
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout studio={studio} />}>
        <Route index element={<Home studio={studio} />} />
        <Route path="daily" element={<DailyDesigns studio={studio} />} />
        <Route path="design/:id" element={<DesignDetail studio={studio} />} />
        <Route path="library" element={<SavedLibrary studio={studio} />} />
        <Route path="export" element={<ExportPage studio={studio} />} />
        <Route path="brand" element={<BrandSettingsPage studio={studio} />} />
        <Route path="prompts" element={<PromptEditor studio={studio} />} />
      </Route>
    </Routes>
  );
}
