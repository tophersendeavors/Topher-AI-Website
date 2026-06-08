// Named "protocol" presets — opinionated defaults a project can adopt to
// pre-seed tone, showrunner restraint rules, and character guidance. The
// preset only ever MERGES into the project (existing tone/notes are kept and
// extended) so loading a protocol can never silently overwrite the writer's
// own bible. The audit reads these via project.tone + project.showrunner_notes;
// the structured prompt builder injects them into every scene generation.

export interface ProtocolPreset {
  /** Tone tags appended (deduped) to project.tone[]. */
  tone: string[];
  /** Multi-line restraint guidance appended to project.showrunner_notes. */
  showrunnerNotes: string;
  /** AI-production prefer / avoid rules — fed to the model router + adapters. */
  productionRules?: {
    prefer: string[];
    avoid: string[];
  };
}

export const PROTOCOL_PRESETS: Record<string, ProtocolPreset> = {
  // SELVAJE — prestige psychological thriller, A24 / HBO limited-series restraint.
  // Sourced from the 95% Script Quality Protocol the writer dictated.
  selvaje: {
    tone: [
      "Prestige psychological thriller",
      "A24 / HBO limited-series restraint",
      "Clinical elegance",
      "Slow-burn dread",
      "Silence over explanation",
    ],
    productionRules: {
      prefer: [
        "restrained emotion",
        "negative space",
        "hands and objects",
        "mist, water, stone, fabric, paper, breath, glass",
        "clinical elegance",
        "cloud-forest atmosphere",
        "controlled camera movement",
        "low-motion cinematic shots",
        "implied emotion over overt performance",
        "voiceover, silence, ambience, sound design",
      ],
      avoid: [
        "cheap horror visuals",
        "exaggerated facial expressions",
        "melodramatic acting",
        "generic cult imagery",
        "over-stylized fantasy looks",
        "excessive camera motion",
        "long AI-generated dialogue scenes",
        "complicated multi-character blocking",
      ],
    },
    showrunnerNotes: [
      "SELVAJE protocol — visual + tonal restraint rules:",
      "",
      "• No melodrama. No generic cult language. No cheap horror beats.",
      "• Silence is more powerful than explanation. Withhold first.",
      "• Hands, objects, breath, mist, fabric, paper, and spatial distance carry",
      "  emotion. Show feeling through one small physical act.",
      "• Action lines stay tight — usually three lines or fewer.",
      "• No therapy language. No on-the-nose dialogue. No backstory dumps.",
      "• If uncertain, choose restraint over exposition.",
      "",
      "Character guidance:",
      "• Margot — avoids first-person vulnerability. Reveals through what she",
      "  refuses to say, what she touches, what she folds too precisely.",
      "• Solano — never cartoonishly evil. Charm and clinical control; the danger",
      "  is in the calm, not the threat.",
      "• Dean — charm fractures occasionally. A small slip. Not a monologue.",
      "• Nadia — observant, partially concealed. We see her see; we don't yet see why.",
      "• Claire and Paul — marital tension is behavioral, not spoken. Glances,",
      "  unfinished sentences, who pours the drink, who doesn't.",
      "• The Protocol itself reads elegant, clinical, increasingly dangerous —",
      "  written in the language of wellness, executed in the language of control.",
    ].join("\n"),
  },
};

/** Merge a preset into a project's existing tone[] + showrunner_notes. */
export function mergePreset(
  current: { tone: string[] | null; showrunner_notes: string | null; metadata?: unknown },
  presetKey: string
): { tone: string[]; showrunner_notes: string; metadata?: Record<string, unknown> } {
  const preset = PROTOCOL_PRESETS[presetKey];
  if (!preset) throw new Error(`Unknown protocol preset: ${presetKey}`);
  const tone = Array.from(
    new Set([...(current.tone ?? []), ...preset.tone].map((t) => t.trim()).filter(Boolean))
  );
  const prevNotes = (current.showrunner_notes ?? "").trim();
  const presetMarker = `[${presetKey.toUpperCase()} PROTOCOL]`;
  // Avoid duplicating if the writer reloads the preset.
  const showrunner_notes = prevNotes.includes(presetMarker)
    ? prevNotes
    : [prevNotes, "", presetMarker, preset.showrunnerNotes].filter(Boolean).join("\n");

  // Merge production rules into project.metadata.productionRules so the
  // AI Video router + adapters can read them. Deduplicated.
  const out: { tone: string[]; showrunner_notes: string; metadata?: Record<string, unknown> } = {
    tone,
    showrunner_notes,
  };
  if (preset.productionRules) {
    const meta = ((current.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const prev = ((meta.productionRules as { prefer?: string[]; avoid?: string[] } | null) ?? {
      prefer: [],
      avoid: [],
    }) as { prefer: string[]; avoid: string[] };
    const dedupe = (a: string[], b: string[]) => Array.from(new Set([...a, ...b].map((s) => s.trim()).filter(Boolean)));
    meta.productionRules = {
      prefer: dedupe(prev.prefer ?? [], preset.productionRules.prefer),
      avoid: dedupe(prev.avoid ?? [], preset.productionRules.avoid),
    };
    out.metadata = meta;
  }
  return out;
}
