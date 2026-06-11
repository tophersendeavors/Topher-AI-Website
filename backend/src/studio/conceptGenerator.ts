// Studio concept generator. Turns the creator's design preferences into a
// few distinct studio concepts (name, tagline, identity, visual direction)
// to approve or regenerate. The approved concept's visualDirection later
// seeds cinematic lot + logo image generation.

import { callLLM, extractJSON } from "../llm/provider.js";
import {
  STUDIO_ATMOSPHERE_LABELS,
  STUDIO_LOCATION_LABELS,
  STUDIO_SCALE_LABELS,
  STUDIO_STYLE_LABELS,
  type StudioPreferences,
} from "@toburt/shared";

export interface ConceptDraft {
  name: string;
  tagline: string;
  identity: string;
  visualDirection: string;
}

export interface ConceptGenInput {
  preferences: StudioPreferences;
  ownerName: string;
  /** Optional — names the creator wants to avoid re-seeing on regenerate. */
  avoidNames?: string[];
}

export async function generateStudioConcepts(input: ConceptGenInput): Promise<ConceptDraft[]> {
  const { preferences: p, ownerName, avoidNames = [] } = input;

  const prefsBlock = [
    p.style ? `Style: ${STUDIO_STYLE_LABELS[p.style]}` : null,
    p.location ? `Location: ${STUDIO_LOCATION_LABELS[p.location]}` : null,
    p.atmosphere.length ? `Atmosphere: ${p.atmosphere.map((a) => STUDIO_ATMOSPHERE_LABELS[a]).join(", ")}` : null,
    p.scale ? `Scale: ${STUDIO_SCALE_LABELS[p.scale]}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const sys = [
    "You name and define film studios. Given a creator's design preferences,",
    "produce THREE distinct studio concepts they could own. Each must feel like",
    "a real, ownable studio with a soul — not a tech brand.",
    "",
    "Rules:",
    "- Studio names: evocative, memorable, premium. No generic 'AI/Labs/Tech'",
    "  words. They can riff on the owner's name but need not.",
    "- The three concepts should be genuinely different from each other in feel.",
    "- visualDirection is a cinematic image-generation brief for the studio lot:",
    "  describe architecture, landscape, time of day, light, mood — concrete and",
    "  filmable, matching the chosen style/location/atmosphere.",
    avoidNames.length ? `- Do NOT reuse these names: ${avoidNames.join(", ")}.` : "",
    "",
    "Return JSON shaped EXACTLY as:",
    '{ "concepts": [',
    "  {",
    '    "name": string,            // the studio name',
    '    "tagline": string,         // a short motto, e.g. "Stories. Reimagined."',
    '    "identity": string,        // 2-3 sentences: what this studio feels like to own',
    '    "visualDirection": string  // cinematic brief for the lot render',
    "  }",
    "] }  // exactly 3 concepts",
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `OWNER: ${ownerName || "the creator"}`,
    "",
    "DESIGN PREFERENCES:",
    prefsBlock || "(no strong preferences — surprise them with range)",
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.85,
    maxTokens: 1800,
  });

  const parsed = extractJSON<{ concepts?: unknown[] }>(res.text);
  const out: ConceptDraft[] = [];
  for (const raw of parsed.concepts ?? []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const name = str(m.name);
    if (!name) continue;
    out.push({
      name,
      tagline: str(m.tagline),
      identity: str(m.identity),
      visualDirection: str(m.visualDirection),
    });
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
