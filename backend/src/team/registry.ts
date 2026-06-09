// Creative Team role registry.
//
// 16 core roles spanning leadership → writing → directing → camera →
// production design → sound/music → post → ops. Talent rows are
// auto-derived from the project's character bible (one actor slot and
// one voice slot per character).

import { supabase } from "../db/client.js";
import type { RoleDefinition, RoleKind } from "@toburt/shared";

interface CoreRole {
  key: string;
  label: string;
  description: string;
  category: RoleDefinition["category"];
  defaultKind: RoleKind;
  required: boolean;
  departmentKey?: string;
  exampleAssignments?: string[];
}

const CORE_ROLES: CoreRole[] = [
  {
    key: "showrunner",
    label: "Showrunner",
    description: "Owns the season vision and creative direction.",
    category: "leadership",
    defaultKind: "live_person",
    required: true,
    exampleAssignments: ["Showrunner / Creator"],
  },
  {
    key: "producer",
    label: "Producer",
    description: "Coordinates production logistics and delivery dates.",
    category: "leadership",
    defaultKind: "live_person",
    required: true,
  },
  {
    key: "writer",
    label: "Writer",
    description: "Drafts the screenplay.",
    category: "writing",
    defaultKind: "live_person",
    required: true,
  },
  {
    key: "co_writer",
    label: "Co-Writer",
    description: "Collaborates on the screenplay alongside the writer.",
    category: "writing",
    defaultKind: "live_person",
    required: false,
  },
  {
    key: "director",
    label: "Director",
    description: "Defines staging, performance and shot intent.",
    category: "directing",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "director",
    exampleAssignments: ["AI Director (shot plan)", "Live Director"],
  },
  {
    key: "cinematographer",
    label: "Cinematographer / DP",
    description: "Owns lensing, lighting and framing language.",
    category: "camera",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "cinematography",
  },
  {
    key: "production_designer",
    label: "Production Designer",
    description: "Owns world look, palette, environments.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "production_design",
  },
  {
    key: "art_director",
    label: "Art Director",
    description: "Translates production design into per-scene direction.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: false,
  },
  {
    key: "prop_master",
    label: "Prop Master",
    description: "Owns the prop bibles and continuity-critical objects.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: false,
    departmentKey: "props",
  },
  {
    key: "wardrobe_hmu",
    label: "Wardrobe / HMU",
    description: "Per-episode wardrobe, hair, makeup canon.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: false,
    departmentKey: "wardrobe",
  },
  {
    key: "composer",
    label: "Composer",
    description: "Score and music guidance.",
    category: "sound_music",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "music",
  },
  {
    key: "sound_designer",
    label: "Sound Designer",
    description: "Ambient bed, motifs, diegetic sound design.",
    category: "sound_music",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "sound",
  },
  {
    key: "editor",
    label: "Editor",
    description: "Assembles approved shots into final cut.",
    category: "post",
    defaultKind: "live_person",
    required: true,
  },
  {
    key: "trailer_editor",
    label: "Trailer Editor",
    description: "Owns teaser / trailer / social cut deliverables.",
    category: "post",
    defaultKind: "ai_creative",
    required: false,
  },
  {
    key: "script_supervisor",
    label: "Script Supervisor",
    description: "Continuity passes, timeline & scene canon.",
    category: "ops",
    defaultKind: "ai_creative",
    required: false,
    departmentKey: "continuity",
  },
  {
    key: "prompt_supervisor",
    label: "Prompt Supervisor",
    description: "Owns AI video prompt quality across departments.",
    category: "ops",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "prompt_supervision",
  },
  {
    key: "ai_video_operator",
    label: "AI Video Operator",
    description: "Runs generations in Veo / Kling / Runway externally.",
    category: "ops",
    defaultKind: "live_person",
    required: true,
  },
];

function definitionFromCore(c: CoreRole): RoleDefinition {
  return {
    key: c.key,
    label: c.label,
    description: c.description,
    category: c.category,
    defaultKind: c.defaultKind,
    required: c.required,
    departmentKey: c.departmentKey,
    exampleAssignments: c.exampleAssignments,
  };
}

export function coreRoleDefinitions(): RoleDefinition[] {
  return CORE_ROLES.map(definitionFromCore);
}

export function coreRoleByKey(key: string): RoleDefinition | null {
  const c = CORE_ROLES.find((r) => r.key === key);
  return c ? definitionFromCore(c) : null;
}

// ---------------------------------------------------------------------------
// Auto-derived talent rows from the character bible.
// ---------------------------------------------------------------------------

interface CharacterRow {
  id: string;
  name: string;
  metadata: Record<string, unknown> | null;
}

async function loadCharacters(projectId: string): Promise<CharacterRow[]> {
  const { data } = await supabase
    .from("characters")
    .select("id, name, metadata")
    .eq("project_id", projectId);
  return ((data as CharacterRow[]) ?? []).filter((c) => !!c.name);
}

function isVOPresent(c: CharacterRow): boolean {
  // Heuristic — if the metadata flags a voice presence (e.g. narrator,
  // V.O. block), surface a voice slot. Otherwise we still surface it
  // optionally so the writer can opt in.
  const dna = (c.metadata?.dna as Record<string, unknown> | undefined) ?? {};
  const presence = (dna.presenceType as string | undefined)?.toLowerCase() ?? "";
  return presence.includes("voice") || presence.includes("vo");
}

export async function derivedTalentDefinitions(
  projectId: string
): Promise<RoleDefinition[]> {
  const characters = await loadCharacters(projectId);
  const out: RoleDefinition[] = [];
  for (const c of characters) {
    out.push({
      key: `actor:${c.id}`,
      label: `Actor — ${c.name}`,
      description: `Performer for ${c.name}. Choose AI / AI-Creative direction / Live Person.`,
      category: "talent",
      defaultKind: "ai",
      required: false,
      derivedFromCharacterId: c.id,
    });
    if (isVOPresent(c)) {
      out.push({
        key: `voice:${c.id}`,
        label: `Voice — ${c.name}`,
        description: `Voice performance (V.O. / looping) for ${c.name}.`,
        category: "talent",
        defaultKind: "ai",
        required: false,
        derivedFromCharacterId: c.id,
      });
    }
  }
  return out;
}

export async function allRoleDefinitions(
  projectId: string
): Promise<RoleDefinition[]> {
  const core = coreRoleDefinitions();
  const derived = await derivedTalentDefinitions(projectId);
  return [...core, ...derived];
}
