// Creative Team role registry.
//
// 16 core roles spanning leadership → writing → directing → camera →
// production design → sound/music → post → ops. Talent rows are
// auto-derived from the project's character bible (one actor slot and
// one voice slot per character).

import { supabase } from "../db/client.js";
import type {
  ModelTarget,
  RoleDefinition,
  RoleKind,
  RoleRecommendation,
} from "@toburt/shared";

interface CoreRole {
  key: string;
  label: string;
  description: string;
  category: RoleDefinition["category"];
  defaultKind: RoleKind;
  required: boolean;
  departmentKey?: string;
  exampleAssignments?: string[];
  recommendation: RoleRecommendation;
}

// Convenience model lists used by recommendations below.
const ALL_VIDEO_MODELS: ModelTarget[] = [
  "veo",
  "kling",
  "runway",
  "luma",
  "pika",
  "higgsfield",
];
const MANUAL_ONLY: ModelTarget[] = ["manual_external"];
const VIDEO_PLUS_MANUAL: ModelTarget[] = [...ALL_VIDEO_MODELS, "manual_external"];

const CORE_ROLES: CoreRole[] = [
  {
    key: "showrunner",
    label: "Showrunner",
    description: "Owns the season vision and creative direction.",
    category: "leadership",
    defaultKind: "live_person",
    required: true,
    exampleAssignments: ["Showrunner / Creator"],
    recommendation: {
      recommendedKind: "live_person",
      allowedKinds: ["live_person", "ai_creative"],
      recommendedHandoffFormat: "director_notes",
      recommendedBriefStyle: "review_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Owns creative vision and final approvals — usually a human creative lead, occasionally an AI Creative reviewer.",
    },
  },
  {
    key: "producer",
    label: "Producer",
    description: "Coordinates production logistics and delivery dates.",
    category: "leadership",
    defaultKind: "live_person",
    required: true,
    recommendation: {
      recommendedKind: "live_person",
      allowedKinds: ["live_person", "ai_creative"],
      recommendedHandoffFormat: "task_list",
      recommendedBriefStyle: "review_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Coordinates logistics, approvals, and delivery — not a generative video model role.",
    },
  },
  {
    key: "writer",
    label: "Writer",
    description: "Drafts the screenplay.",
    category: "writing",
    defaultKind: "live_person",
    required: true,
    recommendation: {
      recommendedKind: "live_person",
      allowedKinds: ["live_person", "ai_creative"],
      recommendedHandoffFormat: "human_brief",
      recommendedBriefStyle: "rewrite_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Drafts the screenplay — a human or AI creative writing role.",
    },
  },
  {
    key: "co_writer",
    label: "Co-Writer",
    description: "Collaborates on the screenplay alongside the writer.",
    category: "writing",
    defaultKind: "live_person",
    required: false,
    recommendation: {
      recommendedKind: "live_person",
      allowedKinds: ["live_person", "ai_creative"],
      recommendedHandoffFormat: "human_brief",
      recommendedBriefStyle: "rewrite_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Pairs with the writer on the screenplay — not a model-generation role.",
    },
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
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "shot_plan",
      recommendedHandoffFormat: "director_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Produces shot intent and staging direction — a creative-direction role, not the final generated asset.",
    },
  },
  {
    key: "cinematographer",
    label: "Cinematographer / DP",
    description: "Owns lensing, lighting and framing language.",
    category: "camera",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "cinematography",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "shot_plan",
      recommendedHandoffFormat: "director_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Defines lensing and framing language for the AI shot composer — direction, not final generation.",
    },
  },
  {
    key: "production_designer",
    label: "Production Designer",
    description: "Owns world look, palette, environments.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "production_design",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "department_note",
      recommendedHandoffFormat: "wardrobe_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Owns world look + environments — direction guidance, not a final asset.",
    },
  },
  {
    key: "art_director",
    label: "Art Director",
    description: "Translates production design into per-scene direction.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: false,
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "department_note",
      recommendedHandoffFormat: "wardrobe_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Translates Production Design into scene-level direction — creative briefs, not generation.",
    },
  },
  {
    key: "prop_master",
    label: "Prop Master",
    description: "Owns the prop bibles and continuity-critical objects.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: false,
    departmentKey: "props",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "department_note",
      recommendedHandoffFormat: "wardrobe_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Owns prop continuity — a department brief role.",
    },
  },
  {
    key: "wardrobe_hmu",
    label: "Wardrobe / HMU",
    description: "Per-episode wardrobe, hair, makeup canon.",
    category: "production_design",
    defaultKind: "ai_creative",
    required: false,
    departmentKey: "wardrobe",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "department_note",
      recommendedHandoffFormat: "wardrobe_notes",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Owns wardrobe / HMU continuity — a continuity-driven department brief.",
    },
  },
  {
    key: "composer",
    label: "Composer",
    description: "Score and music guidance.",
    category: "sound_music",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "music",
    recommendation: {
      recommendedKind: "ai_creative",
      // Composer can be AI when paired with a music tool — but we don't
      // expose video models for that. AI mode uses manual_external +
      // user-supplied profile id (Suno, Udio, etc).
      allowedKinds: ["ai_creative", "live_person", "ai"],
      recommendedBriefStyle: "department_note",
      recommendedHandoffFormat: "composer_brief",
      recommendedModelTarget: "manual_external",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Music role — AI Creative briefs are common; if you go AI, use a music tool via manual_external (not a video model).",
    },
  },
  {
    key: "sound_designer",
    label: "Sound Designer",
    description: "Ambient bed, motifs, diegetic sound design.",
    category: "sound_music",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "sound",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "department_note",
      recommendedHandoffFormat: "composer_brief",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Ambient + motifs — a department brief role, not video generation.",
    },
  },
  {
    key: "editor",
    label: "Editor",
    description: "Assembles approved shots into final cut.",
    category: "post",
    defaultKind: "live_person",
    required: true,
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "review_notes",
      recommendedHandoffFormat: "task_list",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "Assembles approved shots into final cut — review-driven, not generation.",
    },
  },
  {
    key: "trailer_editor",
    label: "Trailer Editor",
    description: "Owns teaser / trailer / social cut deliverables.",
    category: "post",
    defaultKind: "ai_creative",
    required: false,
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "prompt_strategy",
      recommendedHandoffFormat: "task_list",
      // Trailer editor can stand up trailer-shot video generation.
      allowedModelTargets: VIDEO_PLUS_MANUAL,
      reason:
        "Owns teaser / trailer cuts — prompt strategy + review. Video models allowed if you generate trailer shots.",
    },
  },
  {
    key: "script_supervisor",
    label: "Script Supervisor",
    description: "Continuity passes, timeline & scene canon.",
    category: "ops",
    defaultKind: "ai_creative",
    required: false,
    departmentKey: "continuity",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "review_notes",
      recommendedHandoffFormat: "task_list",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Continuity + canon checks — review-driven, not generation.",
    },
  },
  {
    key: "prompt_supervisor",
    label: "Prompt Supervisor",
    description: "Owns AI video prompt quality across departments.",
    category: "ops",
    defaultKind: "ai_creative",
    required: true,
    departmentKey: "prompt_supervision",
    recommendation: {
      recommendedKind: "ai_creative",
      allowedKinds: ["ai_creative", "live_person"],
      recommendedBriefStyle: "prompt_strategy",
      recommendedHandoffFormat: "task_list",
      allowedModelTargets: MANUAL_ONLY,
      reason: "Owns prompt strategy + QA — a creative-direction role.",
    },
  },
  {
    key: "ai_video_operator",
    label: "AI Video Operator",
    description: "Runs generations in Veo / Kling / Runway externally.",
    category: "ops",
    defaultKind: "live_person",
    required: true,
    recommendation: {
      recommendedKind: "live_person",
      // AI Video Operator is a human running the external models — not
      // the performer. AI kind is intentionally not in allowedKinds.
      allowedKinds: ["live_person", "ai_creative"],
      recommendedHandoffFormat: "task_list",
      recommendedBriefStyle: "prompt_strategy",
      allowedModelTargets: MANUAL_ONLY,
      reason:
        "A human operator running external models — not a performer model. Use Actor roles to specify generation targets.",
    },
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
    recommendation: c.recommendation,
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
      recommendation: {
        recommendedKind: "ai",
        allowedKinds: ["ai", "live_person"],
        recommendedModelTarget: "veo",
        // Actor performance shots — video models are fair game. Manual
        // stays available for tools we don't model directly.
        allowedModelTargets: VIDEO_PLUS_MANUAL,
        recommendedHandoffFormat: "actor_notes",
        reason:
          `Performs ${c.name} in generated shots. Pair with the character's visual bible. If casting live, switch to Live Person.`,
      },
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
        recommendation: {
          recommendedKind: "ai",
          allowedKinds: ["ai", "live_person"],
          // Voice generation — no video models. We don't have a
          // first-class voice model target, so manual_external is used
          // with a profile id pointing at the chosen voice tool.
          recommendedModelTarget: "manual_external",
          allowedModelTargets: MANUAL_ONLY,
          recommendedHandoffFormat: "actor_notes",
          reason:
            "Voice performance for V.O. / looping. Use a voice tool via manual_external — video models do not apply.",
        },
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
