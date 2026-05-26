import { useCallback, useEffect, useMemo, useState } from "react";
import { generateDailyDesigns, generateDesign } from "@/lib/designGenerator";
import {
  deleteDesign,
  loadBrandSettings,
  loadDesigns,
  loadPromptTemplate,
  saveBrandSettings,
  saveDesign,
  savePromptTemplate,
} from "@/lib/store";
import { runPrintReadiness } from "@/lib/printChecker";
import { fetchTrendSignals } from "@/lib/trendResearch";
import {
  DEFAULT_BRAND_SETTINGS,
  type BrandSettings,
  type Design,
  type GarmentType,
} from "@/types";

interface StudioState {
  designs: Design[];
  todayBatch: Design[];
  brand: BrandSettings;
  promptTemplate: string;
  loading: boolean;
  generating: boolean;
  lastGeneratedAt: string | null;
}

export function useDesignStudio() {
  const [state, setState] = useState<StudioState>({
    designs: [],
    todayBatch: [],
    brand: DEFAULT_BRAND_SETTINGS,
    promptTemplate: "",
    loading: true,
    generating: false,
    lastGeneratedAt: null,
  });

  // Initial hydrate
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [brand, designs] = await Promise.all([
        loadBrandSettings(),
        loadDesigns(),
      ]);
      const promptTemplate = loadPromptTemplate();
      if (cancelled) return;

      const today = new Date().toISOString().slice(0, 10);
      const todayBatch = designs.filter((d) => d.generatedFor === today);

      setState((s) => ({
        ...s,
        brand,
        designs,
        promptTemplate,
        todayBatch,
        loading: false,
      }));

      if (todayBatch.length === 0) {
        await generateToday(brand);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Schedule a fresh batch at the next UTC midnight so the dashboard rolls
  // over automatically while open.
  useEffect(() => {
    const now = new Date();
    const tomorrow = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0, 0, 5,
    ));
    const ms = tomorrow.getTime() - now.getTime();
    const t = setTimeout(() => {
      generateToday(state.brand);
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.brand]);

  const generateToday = useCallback(async (brandOverride?: BrandSettings) => {
    setState((s) => ({ ...s, generating: true }));
    const brand = brandOverride ?? state.brand;
    const batch = await generateDailyDesigns({ brand, count: 5 });
    for (const d of batch) await saveDesign(d);
    const designs = await loadDesigns();
    setState((s) => ({
      ...s,
      generating: false,
      designs,
      todayBatch: batch,
      lastGeneratedAt: new Date().toISOString(),
    }));
    return batch;
  }, [state.brand]);

  const regenerate = useCallback(
    async (id: string) => {
      const original = state.designs.find((d) => d.id === id);
      const fresh = await generateDesign({
        brand: state.brand,
        garmentType: original?.garmentType,
        trends: await fetchTrendSignals(),
      });
      // Keep the original id so callers can swap in place
      const replacement: Design = { ...fresh, id, status: original?.status ?? "draft" };
      await saveDesign(replacement);
      const designs = await loadDesigns();
      const today = new Date().toISOString().slice(0, 10);
      setState((s) => ({
        ...s,
        designs,
        todayBatch: designs.filter((d) => d.generatedFor === today),
      }));
      return replacement;
    },
    [state.brand, state.designs],
  );

  const updateDesign = useCallback(
    async (id: string, patch: Partial<Design>) => {
      const current = state.designs.find((d) => d.id === id);
      if (!current) return;
      const next: Design = { ...current, ...patch };
      next.printCheck = runPrintReadiness(next, state.brand.forbiddenTerms);
      if (next.approved && next.stage !== "exported") next.stage = "approved";
      await saveDesign(next);
      const designs = await loadDesigns();
      const today = new Date().toISOString().slice(0, 10);
      setState((s) => ({
        ...s,
        designs,
        todayBatch: designs.filter((d) => d.generatedFor === today),
      }));
    },
    [state.designs, state.brand.forbiddenTerms],
  );

  const removeDesign = useCallback(async (id: string) => {
    await deleteDesign(id);
    const designs = await loadDesigns();
    const today = new Date().toISOString().slice(0, 10);
    setState((s) => ({
      ...s,
      designs,
      todayBatch: designs.filter((d) => d.generatedFor === today),
    }));
  }, []);

  const updateBrand = useCallback(async (brand: BrandSettings) => {
    await saveBrandSettings(brand);
    setState((s) => ({ ...s, brand }));
  }, []);

  const updatePromptTemplate = useCallback((tpl: string) => {
    savePromptTemplate(tpl);
    setState((s) => ({ ...s, promptTemplate: tpl }));
  }, []);

  const setGarmentType = useCallback(
    (id: string, garmentType: GarmentType) => updateDesign(id, { garmentType }),
    [updateDesign],
  );

  const savedLibrary = useMemo(
    () => state.designs.filter((d) => d.status === "saved" || d.status === "approved"),
    [state.designs],
  );

  const exportReady = useMemo(
    () => state.designs.filter((d) => d.readyForNinjaTransfers || d.stage === "exported"),
    [state.designs],
  );

  return {
    ...state,
    savedLibrary,
    exportReady,
    generateToday,
    regenerate,
    updateDesign,
    removeDesign,
    updateBrand,
    updatePromptTemplate,
    setGarmentType,
  };
}

export type StudioApi = ReturnType<typeof useDesignStudio>;
