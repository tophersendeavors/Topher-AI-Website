import {
  type BrandSettings,
  type Design,
  type GarmentType,
  type Placement,
  type PrintSize,
  DEFAULT_BRAND_SETTINGS,
} from "@/types";
import {
  FALLBACK_TRENDS,
  fetchTrendSignals,
  type TrendSignal,
} from "@/lib/trendResearch";
import { runPrintReadiness } from "@/lib/printChecker";
import { readEnv } from "@/lib/env";

// --- Deterministic PRNG so a "seed" always produces the same design ---
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

const SLOGAN_FRAGMENTS = [
  "ASH KROW",
  "AFTER THE BURN",
  "NOTHING REMAINS",
  "BONE & SMOKE",
  "BLACK MASS",
  "DEAD LANGUAGE",
  "PATRON OF DUST",
  "NO SAINTS LEFT",
  "QUIET RUIN",
  "MEMENTO ASH",
  "ANTHEM FOR DECAY",
  "VIOLENT CALM",
  "OBLITERATION",
  "REQUIEM 99",
  "CHROME GRAVE",
  "WASHED IN BLOOD",
  "DENIM CHURCH",
  "RUNWAY FUNERAL",
];

const ROMAN_NUMBERS = ["MCMXCIX", "MMXXVI", "XIII", "VII", "MMI", "XXI"];

const MOTIF_SHAPES = [
  "cross",
  "thorned-circle",
  "halo",
  "blade",
  "moth",
  "ash-drift",
  "rosette",
  "shroud",
];

const GARMENT_DEFAULTS: Record<GarmentType, { placement: Placement; size: PrintSize }> = {
  "t-shirt": { placement: "front-chest", size: { widthInches: 12, heightInches: 14 } },
  hoodie: { placement: "full-back", size: { widthInches: 14, heightInches: 16 } },
  sweatshirt: { placement: "front-chest", size: { widthInches: 12, heightInches: 14 } },
  sweatpants: { placement: "thigh", size: { widthInches: 6, heightInches: 8 } },
  jeans: { placement: "hip", size: { widthInches: 5, heightInches: 6 } },
  "denim-jacket": { placement: "full-back", size: { widthInches: 13, heightInches: 15 } },
  "long-sleeve": { placement: "sleeve", size: { widthInches: 3, heightInches: 14 } },
  cap: { placement: "front-chest", size: { widthInches: 4, heightInches: 2 } },
  tote: { placement: "front-chest", size: { widthInches: 12, heightInches: 14 } },
};

const PLACEMENT_LABEL: Record<Placement, string> = {
  "front-chest": "Front centered chest",
  "left-chest": "Left chest pocket area",
  "full-back": "Full back, between shoulder blades",
  sleeve: "Sleeve, vertical down outer arm",
  hip: "Right hip / coin pocket area",
  thigh: "Outer thigh, vertical",
  hood: "Across hood crown",
  "all-over": "All-over print",
};

export function placementLabel(p: Placement) {
  return PLACEMENT_LABEL[p];
}

// ---------- SVG generation ----------

interface SvgArtworkInput {
  rng: () => number;
  trend: TrendSignal;
  palette: string[];
  title: string;
  motif: string;
  year: string;
}

function buildSvgArtwork({ rng, trend, palette, title, motif, year }: SvgArtworkInput) {
  // 4500x5400 is ~15"x18" @ 300dpi — well within "≥ 4500px wide".
  const W = 4500;
  const H = 5400;
  const ink = palette[0] ?? "#0a0a0a";
  const bone = palette[1] ?? "#e9e3d6";
  const accent = palette[4] ?? "#7a0a0a";
  const tone = palette[3] ?? "#f5f1e8";

  // Halftone field
  const dots: string[] = [];
  const rows = 80;
  const cols = 66;
  const cellW = W / cols;
  const cellH = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * cellW + cellW / 2;
      const cy = r * cellH + cellH / 2;
      const dx = cx - W / 2;
      const dy = cy - H / 2;
      const dist = Math.sqrt(dx * dx + dy * dy) / (W / 2);
      const density = Math.max(0, 1 - dist) * rng();
      if (density < 0.18) continue;
      const radius = density * (cellW / 2.4);
      dots.push(
        `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="${bone}" opacity="${(0.18 + density * 0.4).toFixed(2)}"/>`,
      );
    }
  }

  // Central motif glyph
  const cx = W / 2;
  const cy = H / 2 - 200;
  let motifSvg = "";
  switch (motif) {
    case "cross":
      motifSvg = `
        <g transform="translate(${cx} ${cy})">
          <rect x="-60" y="-1100" width="120" height="2200" fill="${bone}"/>
          <rect x="-560" y="-360" width="1120" height="120" fill="${bone}"/>
        </g>`;
      break;
    case "thorned-circle":
      motifSvg = `
        <g transform="translate(${cx} ${cy})" fill="none" stroke="${bone}" stroke-width="22">
          <circle r="780"/>
          ${Array.from({ length: 24 })
            .map((_, i) => {
              const a = (i / 24) * Math.PI * 2;
              const x1 = Math.cos(a) * 780;
              const y1 = Math.sin(a) * 780;
              const x2 = Math.cos(a) * 940;
              const y2 = Math.sin(a) * 940;
              return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
            })
            .join("")}
        </g>`;
      break;
    case "halo":
      motifSvg = `
        <g transform="translate(${cx} ${cy})" fill="none" stroke="${bone}" stroke-width="14">
          <circle r="900"/>
          <circle r="720" opacity="0.55"/>
          <circle r="540" opacity="0.35"/>
        </g>`;
      break;
    case "blade":
      motifSvg = `
        <g transform="translate(${cx} ${cy})">
          <polygon points="0,-1100 90,-200 0,1100 -90,-200" fill="${bone}"/>
          <rect x="-260" y="-260" width="520" height="80" fill="${accent}"/>
        </g>`;
      break;
    case "moth":
      motifSvg = `
        <g transform="translate(${cx} ${cy})" fill="${bone}">
          <ellipse cx="-420" cy="0" rx="420" ry="700"/>
          <ellipse cx="420" cy="0" rx="420" ry="700"/>
          <rect x="-30" y="-720" width="60" height="1440"/>
        </g>`;
      break;
    case "ash-drift":
      motifSvg = `
        <g transform="translate(${cx} ${cy})">
          ${Array.from({ length: 80 })
            .map(() => {
              const x = (rng() - 0.5) * 1600;
              const y = (rng() - 0.5) * 1800;
              const r = rng() * 30 + 4;
              return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${bone}" opacity="${(0.3 + rng() * 0.6).toFixed(2)}"/>`;
            })
            .join("")}
        </g>`;
      break;
    case "rosette":
      motifSvg = `
        <g transform="translate(${cx} ${cy})" fill="none" stroke="${bone}" stroke-width="16">
          ${Array.from({ length: 6 })
            .map((_, i) => {
              const a = (i / 6) * Math.PI * 2;
              return `<ellipse cx="${(Math.cos(a) * 320).toFixed(1)}" cy="${(Math.sin(a) * 320).toFixed(1)}" rx="380" ry="220" transform="rotate(${(a * 180) / Math.PI})"/>`;
            })
            .join("")}
        </g>`;
      break;
    default:
      motifSvg = `
        <g transform="translate(${cx} ${cy})" fill="${bone}">
          <rect x="-700" y="-700" width="1400" height="1400" opacity="0.08"/>
          <rect x="-500" y="-500" width="1000" height="1000" fill="none" stroke="${bone}" stroke-width="18"/>
        </g>`;
  }

  // Distress overlay — broken scratch lines
  const scratches: string[] = [];
  for (let i = 0; i < 220; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const len = rng() * 320 + 40;
    const rot = (rng() - 0.5) * 30;
    scratches.push(
      `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${len.toFixed(1)}" height="2" fill="${bone}" opacity="${(rng() * 0.5).toFixed(2)}" transform="rotate(${rot.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`,
    );
  }

  const headline = title.toUpperCase();
  const subline = trend.scene.toUpperCase();

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-transparent="true" data-brand="ASH KROW">
  <title>${escapeXml(title)}</title>
  <desc>ASH KROW original print artwork. Transparent background. Generated procedurally.</desc>
  <g id="halftone-field" opacity="0.7">${dots.join("")}</g>
  <g id="motif">${motifSvg}</g>
  <g id="scratches">${scratches.join("")}</g>
  <g id="type" text-anchor="middle" fill="${bone}" font-family="'Bebas Neue', Impact, sans-serif">
    <text x="${W / 2}" y="${H - 1100}" font-size="520" letter-spacing="40" stroke="${ink}" stroke-width="6">${escapeXml(headline)}</text>
    <text x="${W / 2}" y="${H - 780}" font-size="180" letter-spacing="60" fill="${tone}" opacity="0.78">${escapeXml(subline)}</text>
    <text x="${W / 2}" y="${H - 540}" font-size="120" letter-spacing="80" fill="${accent}">— ${escapeXml(year)} —</text>
  </g>
  <g id="edition" font-family="'JetBrains Mono', monospace" fill="${tone}" opacity="0.55">
    <text x="220" y="${H - 220}" font-size="76">EDITION / ${escapeXml(year)}</text>
    <text x="${W - 220}" y="${H - 220}" font-size="76" text-anchor="end">ASH KROW · ORIGINAL</text>
  </g>
</svg>`;
}

function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Optional image-gen API ----------

async function tryRemoteImageGen(prompt: string): Promise<string | undefined> {
  const url = readEnv("VITE_IMAGE_API_URL");
  const key = readEnv("VITE_IMAGE_API_KEY");
  const model = readEnv("VITE_IMAGE_API_MODEL");
  const provider = readEnv("VITE_IMAGE_API_PROVIDER");
  if (!url || !key || provider === "mock") return undefined;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        prompt,
        model,
        size: "1024x1024",
        transparent_background: true,
      }),
    });
    if (!res.ok) return undefined;
    const data: { image?: string; data?: { url?: string }[] } = await res.json();
    if (data.image) return data.image;
    if (data.data?.[0]?.url) return data.data[0].url;
  } catch {
    /* fall through */
  }
  return undefined;
}

// ---------- Prompt construction ----------

function buildPrompt(
  brand: BrandSettings,
  trend: TrendSignal,
  motif: string,
  title: string,
  garment: GarmentType,
): string {
  return [
    `Original streetwear graphic for ASH KROW — "${title}".`,
    `Scene: ${trend.scene}. Mood: ${trend.mood}. Motif anchor: ${trend.motif}.`,
    `Composition: centered single-color print, ${motif} as the dominant icon, distressed serif headline reading "${title.toUpperCase()}".`,
    `Garment target: ${garment}. Heat-transfer compatible. No background, no garment in frame.`,
    brand.signaturePromptSuffix,
  ].join(" ");
}

// ---------- Public generators ----------

export interface GenerateOptions {
  brand?: BrandSettings;
  trends?: TrendSignal[];
  seed?: number;
  garmentType?: GarmentType;
  promptOverride?: string;
}

export async function generateDesign(
  opts: GenerateOptions = {},
): Promise<Design> {
  const brand = opts.brand ?? DEFAULT_BRAND_SETTINGS;
  const trends = opts.trends ?? FALLBACK_TRENDS;
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000);
  const rng = mulberry32(seed);

  const trend = pick(rng, trends);
  const motif = pick(rng, MOTIF_SHAPES);
  const slogan = pick(rng, SLOGAN_FRAGMENTS);
  const numeral = pick(rng, ROMAN_NUMBERS);
  const title = `${slogan} · ${numeral}`;

  const garmentPool: GarmentType[] =
    brand.preferredGarments.length > 0 ? brand.preferredGarments : ["t-shirt"];
  const garmentType: GarmentType =
    opts.garmentType ?? pick(rng, garmentPool);

  const defaults = GARMENT_DEFAULTS[garmentType];
  const palette = brand.palette;

  const prompt =
    opts.promptOverride ??
    buildPrompt(brand, trend, motif, title, garmentType);

  const svg = buildSvgArtwork({
    rng,
    trend,
    palette,
    title,
    motif,
    year: numeral,
  });

  let pngDataUrl: string | undefined;
  const provider = readEnv("VITE_IMAGE_API_PROVIDER");
  if (provider && provider !== "mock") {
    pngDataUrl = await tryRemoteImageGen(prompt);
  }

  const now = new Date();
  const design: Design = {
    id: cryptoRandomId(),
    createdAt: now.toISOString(),
    generatedFor: isoDateOnly(now),
    title,
    garmentType,
    visualDirection: `${trend.scene} × ${trend.mood} · ${motif} icon`,
    colorPalette: palette.slice(0, 5),
    placement: defaults.placement,
    printSize: defaults.size,
    prompt,
    heatTransferNotes: heatTransferNotesFor(garmentType, defaults.size),
    trendTags: [trend.tag, motif, "ash-krow"],
    stage: "generated",
    status: "draft",
    approved: false,
    readyForNinjaTransfers: false,
    notes: "",
    artwork: { svg, pngDataUrl, seed },
  } as Design;

  design.printCheck = runPrintReadiness(design, brand.forbiddenTerms);
  design.stage = "print-check";
  return design;
}

export async function generateDailyDesigns(
  opts: { brand?: BrandSettings; count?: number; date?: Date } = {},
): Promise<Design[]> {
  const brand = opts.brand ?? DEFAULT_BRAND_SETTINGS;
  const count = opts.count ?? 5;
  const date = opts.date ?? new Date();
  const trends = await fetchTrendSignals();

  const baseSeed = seedFromDate(date);
  const designs: Design[] = [];
  for (let i = 0; i < count; i++) {
    designs.push(
      await generateDesign({
        brand,
        trends,
        seed: baseSeed + i * 9173,
      }),
    );
  }
  return designs;
}

function heatTransferNotesFor(g: GarmentType, size: PrintSize): string {
  const base = `Print at ${size.widthInches}" × ${size.heightInches}". Recommended Ninja Transfers DTF — apply at 305°F for 12s firm pressure, cold peel, then re-press 5s with parchment.`;
  switch (g) {
    case "denim-jacket":
    case "jeans":
      return `${base} Pre-press denim 5s to remove moisture; expect intentional vintage cracking after 1–2 washes.`;
    case "hoodie":
    case "sweatshirt":
      return `${base} Mind seam/pocket clearance on placement; avoid pressing over zipper or drawstring eyelets.`;
    case "sweatpants":
      return `${base} Place a Teflon pad inside the leg to prevent transfer bleed-through.`;
    default:
      return base;
  }
}

function seedFromDate(d: Date): number {
  const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}
