import { readEnv } from "@/lib/env";

export interface TrendSignal {
  tag: string;
  scene: string;
  motif: string;
  mood: string;
}

const CURATED_TRENDS: TrendSignal[] = [
  {
    tag: "luxury-grunge",
    scene: "luxury grunge",
    motif: "torn velvet drape, oxidized silver hardware, smudged graphite",
    mood: "haunted opulence",
  },
  {
    tag: "gothic-minimalism",
    scene: "gothic minimalism",
    motif: "single elongated cross, blackletter wordmark, void negative space",
    mood: "monastic restraint",
  },
  {
    tag: "y2k-decay",
    scene: "Y2K decay",
    motif: "chrome lens flare, pixel sleet, lo-fi camcorder timestamp",
    mood: "millennium static",
  },
  {
    tag: "distressed-type",
    scene: "distressed typography",
    motif: "ink-bled serif slogan, photocopy ghosting, registration misprint",
    mood: "underground zine",
  },
  {
    tag: "vintage-tattoo",
    scene: "vintage tattoo flash",
    motif: "dagger through rose, banner script, dotwork shading",
    mood: "carnival blood",
  },
  {
    tag: "runway-streetwear",
    scene: "runway streetwear",
    motif: "oversized silhouette diagram, technical pattern marks, edition stamp",
    mood: "atelier graveyard",
  },
  {
    tag: "underground-fashion",
    scene: "underground fashion",
    motif: "rave flyer overprint, smeared barcode, polaroid burn",
    mood: "back-alley couture",
  },
  {
    tag: "washed-denim",
    scene: "washed denim",
    motif: "rivet diagram, indigo crack pattern, selvedge fray",
    mood: "post-industrial cool",
  },
  {
    tag: "post-apocalyptic-romance",
    scene: "post-apocalyptic romance",
    motif: "wilted rose skeleton, ash drift, smoke halo",
    mood: "tender ruin",
  },
  {
    tag: "religious-iconography",
    scene: "religious iconography",
    motif: "ash-marked halo, latin epitaph, broken rosary",
    mood: "saint of the gutter",
  },
  {
    tag: "biker-couture",
    scene: "biker couture",
    motif: "skull rocker patch silhouette, chain link engraving, tail-light blur",
    mood: "midnight chrome",
  },
  {
    tag: "japanese-noise",
    scene: "japanese noise",
    motif: "vertical kanji-style strokes, ink splash, glitch tiling",
    mood: "kabuki static",
  },
];

interface TrendApiResponse {
  signals?: TrendSignal[];
}

export async function fetchTrendSignals(): Promise<TrendSignal[]> {
  const url = readEnv("VITE_TREND_API_URL");
  const key = readEnv("VITE_TREND_API_KEY");

  if (!url) return CURATED_TRENDS;

  try {
    const res = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    if (!res.ok) return CURATED_TRENDS;
    const data = (await res.json()) as TrendApiResponse;
    if (!data?.signals?.length) return CURATED_TRENDS;
    return [...data.signals, ...CURATED_TRENDS];
  } catch {
    return CURATED_TRENDS;
  }
}

export function pickTrend(seed: number, pool: TrendSignal[]): TrendSignal {
  return pool[seed % pool.length];
}

export const FALLBACK_TRENDS = CURATED_TRENDS;
