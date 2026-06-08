// AI Creative Influence presets (Stage 5).
//
// IMPORTANT: per the user's spec, we do NOT store or use names of living
// artists in generated prompts. Each influence is a neutral set of
// production principles. The "famous personas" UI may surface a short
// caption (which the writer reads), but the system prompt only ever
// sees the principles below.

export interface CreativeInfluencePreset {
  key: string;
  /** Public-facing label (shown to the writer). */
  label: string;
  /** One-line caption — humanizes the influence without naming a person. */
  caption: string;
  /** The PRINCIPLES the system actually injects into prompts when
   *  assignmentType === "ai_influence". Plain neutral language. */
  principles: string[];
  /** Roles this preset is sensible for. */
  applicableRoles: string[];
}

export const CREATIVE_INFLUENCES: CreativeInfluencePreset[] = [
  // ----- Director -----
  {
    key: "restrained_emotional_staging",
    label: "Restrained Emotional Staging",
    caption: "Character-first staging. Camera moves only when emotion earns it.",
    principles: [
      "character-first staging — geography is always clear",
      "warm emotional blocking, not symmetrical posing",
      "camera moves only when motivated by character action",
      "wonder achieved through restraint, not spectacle",
      "wide compositions that let the room breathe",
    ],
    applicableRoles: ["director"],
  },
  {
    key: "heightened_tension_stillness",
    label: "Heightened Tension Through Stillness",
    caption: "Bold framing. Controlled dialogue rhythm. Tension built in silence.",
    principles: [
      "tension built through stillness, not motion",
      "bold character framing — chest-up close-ups when stakes rise",
      "controlled dialogue rhythm with deliberate pauses",
      "sharp visual contrast between blocks of action",
      "confident, planted staging — no handheld unless intentional",
    ],
    applicableRoles: ["director"],
  },
  {
    key: "naturalistic_overlap",
    label: "Naturalistic Improvisational Realism",
    caption: "Handheld looseness. Overlapping dialogue. Off-center, lived-in framing.",
    principles: [
      "handheld looseness that breathes with performance",
      "overlapping dialogue and reactive camerawork",
      "off-center compositions; the camera observes rather than directs",
      "available light and natural sound design",
      "no glossy color grade — keep the surface untreated",
    ],
    applicableRoles: ["director"],
  },
  {
    key: "symmetrical_cool_restraint",
    label: "Symmetrical Cool Restraint",
    caption: "Centered framing. Deliberate pacing. Pastel-anchored palette.",
    principles: [
      "centered, symmetrical framing as a baseline",
      "deliberate pacing — no quick cuts unless punchline",
      "pastel-anchored, low-saturation palette",
      "dry humor through composition, not dialogue",
      "tableau-style staging; characters as visual elements",
    ],
    applicableRoles: ["director"],
  },

  // ----- DP / Cinematographer -----
  {
    key: "natural_light_minimalism",
    label: "Natural-Light Minimalism",
    caption: "Soft window light. Long lenses. Deep negative space.",
    principles: [
      "soft motivated light — practical sources only",
      "long lenses with shallow depth of field",
      "deep negative space in the frame",
      "minimal handheld; locked-off or slow dolly",
      "cool to neutral palette; no warm fill",
    ],
    applicableRoles: ["cinematographer"],
  },
  {
    key: "photographic_naturalism",
    label: "Photographic Naturalism",
    caption: "Bounced practical light. Motivated camera. Low ISO grain.",
    principles: [
      "bounced practical light only",
      "every camera move motivated by character action",
      "low ISO with visible film grain at higher exposures",
      "wide-to-medium lenses; avoid extreme telephoto",
      "no color grade fashion — preserve true skin tones",
    ],
    applicableRoles: ["cinematographer"],
  },
  {
    key: "high_contrast_formalism",
    label: "High-Contrast Formalism",
    caption: "Hard shadow shapes. Controlled palette. Telephoto compression.",
    principles: [
      "hard-edged shadow shapes as compositional elements",
      "tightly controlled palette (often 2-3 colors)",
      "telephoto compression for emotional isolation",
      "deliberate negative space and asymmetric framing",
      "blacks crushed to true black; no lift",
    ],
    applicableRoles: ["cinematographer"],
  },
  {
    key: "documentary_handheld_realism",
    label: "Documentary Handheld Realism",
    caption: "Available light. Handheld. Reactive framing.",
    principles: [
      "available light only — no movie lighting",
      "handheld camera following character action",
      "reactive framing; the camera discovers the shot",
      "shorter focal lengths (24-35mm) for immersion",
      "no stylized color treatment",
    ],
    applicableRoles: ["cinematographer"],
  },

  // ----- Production Designer -----
  {
    key: "lived_in_realism",
    label: "Lived-In Realism",
    caption: "Authentic wear. Neutral palette. Period-correct fixtures.",
    principles: [
      "authentic wear on every surface — not staged distress",
      "neutral cool palette anchored in real materials",
      "period-correct fixtures and dimensions",
      "minimal styling — props earn their place",
      "no luxury finishes or designer signatures",
    ],
    applicableRoles: ["production_designer"],
  },
  {
    key: "maximalist_storytelling_spaces",
    label: "Maximalist Storytelling Spaces",
    caption: "Layered objects. Rich palettes. Character-coded textures.",
    principles: [
      "layered objects that read character backstory",
      "rich palettes with bold accent textures",
      "character-coded ornament — every prop has meaning",
      "asymmetric room geometry with depth in every direction",
      "no minimalism — spaces feel inhabited by years",
    ],
    applicableRoles: ["production_designer"],
  },
  {
    key: "minimal_architectural_geometry",
    label: "Minimal Architectural Geometry",
    caption: "Clean lines. Restrained palette. Sculptural negative space.",
    principles: [
      "clean architectural lines — no decorative trim",
      "restrained palette (3-4 tones maximum)",
      "sculptural negative space treated as a character",
      "modernist furniture proportions",
      "natural materials in monochrome treatment",
    ],
    applicableRoles: ["production_designer"],
  },

  // ----- Art Director / Set Decorator -----
  {
    key: "magazine_editorial_styling",
    label: "Magazine Editorial Styling",
    caption: "Composed surfaces. Tonal control. Deliberate object placement.",
    principles: [
      "every surface composed for the frame",
      "tonal control — narrow color and texture range",
      "deliberate object placement at golden-ratio points",
      "no clutter — every prop earned",
      "wear is curated, not random",
    ],
    applicableRoles: ["art_director", "set_decorator"],
  },
  {
    key: "documentary_set_dressing",
    label: "Documentary Set Dressing",
    caption: "Found objects. Imperfect placement. Real-world clutter level.",
    principles: [
      "found objects — feels collected over years, not bought",
      "imperfect placement; nothing centered",
      "real-world clutter level — not minimal, not maximalist",
      "muted, age-tinged palette",
      "wear is honest, not styled",
    ],
    applicableRoles: ["art_director", "set_decorator"],
  },

  // ----- Wardrobe / HMU -----
  {
    key: "minimalist_wardrobe_authenticity",
    label: "Minimalist Wardrobe Authenticity",
    caption: "Plain garments. Natural fabrics. No costume styling.",
    principles: [
      "plain garments without prints or logos",
      "natural fabrics in muted shades",
      "no costume styling — clothes feel owned",
      "minimal jewelry; nothing announces itself",
      "wear consistent across continuity",
    ],
    applicableRoles: ["wardrobe", "hmu"],
  },
  {
    key: "naturalistic_hmu",
    label: "Naturalistic Hair & Makeup",
    caption: "Bare faces. Untouched hair. No glam lighting compensation.",
    principles: [
      "bare faces, no foundation",
      "natural hair texture and parting",
      "skin reads as skin — no smoothing",
      "no styling product visible",
      "tired / sleep-state honest, not enhanced",
    ],
    applicableRoles: ["wardrobe", "hmu"],
  },

  // ----- Prompt Supervisor -----
  {
    key: "filmable_precision",
    label: "Filmable Precision",
    caption: "Photographable language only. No interpretive adjectives.",
    principles: [
      "only photographable behavior in the prompt body",
      "no interpretive adjectives (restrained, watchful, composed)",
      "specific camera + lens + framing for every shot",
      "explicit eyeline target on every character shot",
      "negative prompts surface every forbidden drift",
    ],
    applicableRoles: ["prompt_supervisor"],
  },
];

export function influencesForRole(role: string): CreativeInfluencePreset[] {
  return CREATIVE_INFLUENCES.filter((c) => c.applicableRoles.includes(role));
}

export function getInfluence(key: string): CreativeInfluencePreset | undefined {
  return CREATIVE_INFLUENCES.find((c) => c.key === key);
}
