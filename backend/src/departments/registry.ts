// Department Registry (Stage 4 Phase A).
//
// Canonical list of departments + which bible field paths each owns.
// The ownership pattern tells the contribution router whether a given
// canon target is writable by a department contribution.
//
// Field-path syntax (dot-separated, jsonb-style):
//   project.visualWorldRules.aesthetic
//   locationBibles.<KEY>.architecture.wallColor
//   propBibles.<KEY>.visualDetails
//   characters.<CHARACTER_ID>.visualBible.wardrobeByEpisode.<N>.top
//
// The wildcards `<KEY>` / `<CHARACTER_ID>` / `<N>` are matched in the
// canon resolver — `pathMatchesPrefix("locationBibles.*.architecture.*", path)`.

export type DepartmentKey =
  | "story"
  | "script_supervisor"
  | "production_design"
  | "art_dept"
  | "props"
  | "wardrobe_hmu"
  | "cinematography"
  | "blocking"
  | "prompt_supervisor"
  | "quality_gate";

export interface DepartmentMeta {
  key: DepartmentKey;
  label: string;
  description: string;
  /** Whether this department owns canon fields (vs advisory/QC). */
  canonOwner: boolean;
  /** Field-path prefixes this department can write to. Empty for
   *  advisory departments. */
  ownedFieldPaths: string[];
}

export const DEPARTMENT_REGISTRY: Record<DepartmentKey, DepartmentMeta> = {
  story: {
    key: "story",
    label: "Story / Showrunner",
    description:
      "Approved screenplay, hook, setup, twist, cliffhanger, withheld information, episode chain.",
    canonOwner: false,
    ownedFieldPaths: [],
  },
  script_supervisor: {
    key: "script_supervisor",
    label: "Script Supervisor / Continuity",
    description:
      "Shot-to-shot continuity, eyelines, screen direction, prop positions, adjacent-shot blocking.",
    canonOwner: false,
    ownedFieldPaths: [],
  },
  production_design: {
    key: "production_design",
    label: "Production Designer",
    description:
      "Location identity, architecture, palette, lighting logic, overall visual world.",
    canonOwner: true,
    ownedFieldPaths: [
      "project.visualWorldRules.*",
      "locationBibles.*.architecture.*",
      "locationBibles.*.furnitureDesign.*",
      "locationBibles.*.lightingSources.*",
      "locationBibles.*.continuityPrompt",
      "locationBibles.*.layout",
    ],
  },
  art_dept: {
    key: "art_dept",
    label: "Art Director / Set Decorator",
    description:
      "Set dressing, bedding, wall décor, clutter level, lamps, curtains, books, forbidden drift.",
    canonOwner: true,
    ownedFieldPaths: [
      "locationBibles.*.setDressing.*",
      "locationBibles.*.setDressing.bedding.*",
    ],
  },
  props: {
    key: "props",
    label: "Props",
    description:
      "Specific props (clock, phone, closet door, blood smear, future ep props) — visual canon + handler + start/end positions.",
    canonOwner: true,
    ownedFieldPaths: [
      "propBibles.*.visualDetails",
      "propBibles.*.startsAt",
      "propBibles.*.endsAt",
      "propBibles.*.orientation",
      "propBibles.*.doNotChange",
    ],
  },
  wardrobe_hmu: {
    key: "wardrobe_hmu",
    label: "Wardrobe / Hair / Makeup",
    description:
      "Per-episode wardrobe + HMU per visible character; references; approved looks; forbidden drift.",
    canonOwner: true,
    ownedFieldPaths: [
      "characters.*.visualBible.wardrobe",
      "characters.*.visualBible.wardrobeByEpisode.*",
      "characters.*.visualBible.hmuByEpisode.*",
      "characters.*.visualBible.doNotChangeTraits",
    ],
  },
  cinematography: {
    key: "cinematography",
    label: "Cinematographer / Shot Designer",
    description:
      "Lensing rules, framing, view zones, movement language, shot style.",
    canonOwner: false,
    ownedFieldPaths: [],
  },
  blocking: {
    key: "blocking",
    label: "Blocking / Movement",
    description:
      "Character start/end positions, movement paths, eyeline targets, prop positions per shot.",
    canonOwner: false,
    ownedFieldPaths: [],
  },
  prompt_supervisor: {
    key: "prompt_supervisor",
    label: "AI Video Prompt Supervisor",
    description: "Model-specific formatting, reference vs start frame, hero image priority.",
    canonOwner: false,
    ownedFieldPaths: [],
  },
  quality_gate: {
    key: "quality_gate",
    label: "Quality Gate",
    description: "Pre-copy readiness checks across all departments.",
    canonOwner: false,
    ownedFieldPaths: [],
  },
};

export const ALL_DEPARTMENT_KEYS = Object.keys(DEPARTMENT_REGISTRY) as DepartmentKey[];

/** True when the given canonical field path matches one of the
 *  department's owned-path patterns. `*` in a pattern matches one
 *  dot-delimited segment. */
export function pathMatchesPattern(pattern: string, path: string): boolean {
  const pSeg = pattern.split(".");
  const tSeg = path.split(".");
  // Trailing `*` matches one OR MORE segments.
  if (pSeg[pSeg.length - 1] === "*") {
    if (tSeg.length < pSeg.length) return false;
  } else if (pSeg.length !== tSeg.length) {
    return false;
  }
  for (let i = 0; i < pSeg.length; i++) {
    const p = pSeg[i];
    const t = tSeg[i];
    if (p === "*") continue;
    if (i === pSeg.length - 1 && p === "*") return true;
    if (p !== t) return false;
  }
  return true;
}

export function departmentOwnsPath(
  dept: DepartmentKey,
  fieldPath: string
): boolean {
  const meta = DEPARTMENT_REGISTRY[dept];
  return meta.ownedFieldPaths.some((pat) => pathMatchesPattern(pat, fieldPath));
}

/** Department config stored at `projects.metadata.departmentConfig[key]`. */
export interface DepartmentConfig {
  mode: "ai" | "human" | "hybrid";
  leadAssigneeId: string | null;
  additionalAssigneeIds: string[];
  aiAssistantEnabled: boolean;
  approvalRequired: boolean;
  locked: boolean;
  updatedAt: string;
}

export const DEFAULT_DEPARTMENT_CONFIG: DepartmentConfig = {
  mode: "ai",
  leadAssigneeId: null,
  additionalAssigneeIds: [],
  aiAssistantEnabled: true,
  approvalRequired: false,
  locked: false,
  updatedAt: new Date(0).toISOString(),
};
