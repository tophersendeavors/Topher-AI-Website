import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { DEFAULT_BRAND_SETTINGS, type BrandSettings, type Design } from "@/types";

const DESIGNS_KEY = "ash_krow_designs_v1";
const BRAND_KEY = "ash_krow_brand_v1";
const PROMPT_TEMPLATE_KEY = "ash_krow_prompt_template_v1";

export const DEFAULT_PROMPT_TEMPLATE = `Original ASH KROW print graphic.
Scene: {{scene}}.
Mood: {{mood}}.
Motif: {{motif}}.
Headline: "{{title}}".
Garment: {{garment}}.
Style: dark luxury streetwear, distressed serif type, halftone grit, monochrome with restrained blood-red accent.
Constraints: transparent background, no garment in frame, no mockup, original artwork only, no copyrighted or trademarked elements.`;

function readLocal<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ---------- Designs ----------

export async function loadDesigns(): Promise<Design[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from("designs")
      .select("payload")
      .order("created_at", { ascending: false });
    if (!error && data) {
      return data.map((row) => row.payload as Design);
    }
  }
  return readLocal<Design[]>(DESIGNS_KEY, []);
}

export async function saveDesign(design: Design): Promise<void> {
  const existing = await loadDesigns();
  const idx = existing.findIndex((d) => d.id === design.id);
  const next =
    idx >= 0
      ? [...existing.slice(0, idx), design, ...existing.slice(idx + 1)]
      : [design, ...existing];
  writeLocal(DESIGNS_KEY, next);

  if (isSupabaseConfigured && supabase) {
    await supabase.from("designs").upsert({
      id: design.id,
      created_at: design.createdAt,
      generated_for: design.generatedFor,
      title: design.title,
      garment_type: design.garmentType,
      stage: design.stage,
      status: design.status,
      approved: design.approved,
      ready_for_ninja_transfers: design.readyForNinjaTransfers,
      payload: design,
    });
  }
}

export async function deleteDesign(id: string): Promise<void> {
  const existing = await loadDesigns();
  writeLocal(DESIGNS_KEY, existing.filter((d) => d.id !== id));
  if (isSupabaseConfigured && supabase) {
    await supabase.from("designs").delete().eq("id", id);
  }
}

// ---------- Brand settings ----------

export async function loadBrandSettings(): Promise<BrandSettings> {
  if (isSupabaseConfigured && supabase) {
    const { data } = await supabase
      .from("brand_settings")
      .select("payload")
      .eq("id", "default")
      .maybeSingle();
    if (data?.payload) return data.payload as BrandSettings;
  }
  return readLocal<BrandSettings>(BRAND_KEY, DEFAULT_BRAND_SETTINGS);
}

export async function saveBrandSettings(settings: BrandSettings): Promise<void> {
  writeLocal(BRAND_KEY, settings);
  if (isSupabaseConfigured && supabase) {
    await supabase.from("brand_settings").upsert({
      id: "default",
      payload: settings,
    });
  }
}

// ---------- Prompt template ----------

export function loadPromptTemplate(): string {
  return readLocal(PROMPT_TEMPLATE_KEY, DEFAULT_PROMPT_TEMPLATE);
}

export function savePromptTemplate(t: string) {
  writeLocal(PROMPT_TEMPLATE_KEY, t);
}
