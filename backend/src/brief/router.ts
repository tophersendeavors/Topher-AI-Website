// Brief Router — produces handoff artifacts per (shot, role).
//
// Three builders share one context. The router picks the relevant
// roles for a shot (project-wide creative + technical roles, plus
// actor:<id> / voice:<id> for the characters appearing in the shot)
// and produces a brief per role kind:
//
//   • ai_model      → model-ready prompt block from the existing
//                     composedPrompt + continuity + refs + avoid list
//   • ai_creative   → creative department guidance — intent, strategy,
//                     review criteria — shape varies by creativeBriefStyle
//   • live_person   → human-readable handoff — context, deliverable,
//                     checklist — shape varies by handoffFormat
//
// No LLM calls. No script mutation. No regeneration. The router only
// arranges canonical data into role-appropriate artifacts.

import { coreRoleByKey } from "../team/registry.js";
import {
  loadEpisodeBriefContext,
  lookupLocation,
  lookupProp,
  type CharacterCanon,
  type EpisodeBriefContext,
  type LocationCanon,
  type PropCanon,
  type ShotContext,
} from "./context.js";
import type {
  AICreativeBrief,
  AIModelBrief,
  AIModelBriefRef,
  AnyBrief,
  BriefRouterSkip,
  EpisodeRoleBriefsResponse,
  LivePersonBrief,
  RoleAssignment,
  RoleBriefArtifact,
  RoleDefinition,
  ShotRoleBriefs,
} from "@toburt/shared";

// ---------------------------------------------------------------------------
// Which roles apply to a shot
// ---------------------------------------------------------------------------

const PROJECT_WIDE_SHOT_ROLES = new Set<string>([
  "director",
  "cinematographer",
  "production_designer",
  "art_director",
  "composer",
  "sound_designer",
  "prompt_supervisor",
  "ai_video_operator",
  "script_supervisor",
  "wardrobe_hmu",
  "prop_master",
  "trailer_editor",
]);

interface CandidateRole {
  key: string;
  definition: RoleDefinition;
  assignment: RoleAssignment | null;
}

function candidatesForShot(
  ctx: EpisodeBriefContext,
  shot: ShotContext
): CandidateRole[] {
  const out: CandidateRole[] = [];

  // Project-wide creative + technical roles.
  for (const key of PROJECT_WIDE_SHOT_ROLES) {
    const def = ctx.rolesByKey.get(key);
    if (!def) continue;
    out.push({
      key,
      definition: def,
      assignment: ctx.assignments[key] ?? null,
    });
  }

  // Per-character actor + voice roles for characters appearing in the shot.
  const charIds = new Set<string>();
  for (const name of shot.shot.characters) {
    const c = ctx.charactersByName.get(name.toLowerCase());
    if (c) charIds.add(c.id);
  }
  for (const id of charIds) {
    for (const prefix of ["actor", "voice"] as const) {
      const key = `${prefix}:${id}`;
      const def = ctx.rolesByKey.get(key);
      if (!def) continue;
      out.push({
        key,
        definition: def,
        assignment: ctx.assignments[key] ?? null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// AI Model brief builder
// ---------------------------------------------------------------------------

function characterRef(c: CharacterCanon): AIModelBriefRef {
  const pieces: string[] = [];
  if (c.consistencyPrompt) pieces.push(c.consistencyPrompt);
  if (c.wardrobeForEpisode) pieces.push(`Wardrobe: ${c.wardrobeForEpisode}`);
  if (c.hmuForEpisode) pieces.push(`HMU: ${c.hmuForEpisode}`);
  return {
    id: c.id,
    label: c.name,
    description: pieces.join(" · "),
    referenceUrl: c.approvedReferenceUrl ?? c.referenceUrl ?? undefined,
  };
}

function locationRef(loc: LocationCanon): AIModelBriefRef {
  return {
    id: loc.key,
    label: loc.name,
    description: loc.description,
  };
}

function propRef(p: PropCanon): AIModelBriefRef {
  return {
    id: p.key,
    label: p.name,
    description: p.description,
  };
}

function adapterHintsFor(ctx: EpisodeBriefContext): string[] {
  const hints: string[] = [];
  if (ctx.isMicroDramaTier) hints.push("verticalMicro");
  if (ctx.defaultAspectRatio === "9:16") hints.push("aspect9by16");
  return hints;
}

function buildAIModelBrief(
  ctx: EpisodeBriefContext,
  shot: ShotContext,
  assignment: RoleAssignment
): AIModelBrief {
  const characterRefs: AIModelBriefRef[] = [];
  for (const name of shot.shot.characters) {
    const c = ctx.charactersByName.get(name.toLowerCase());
    if (c) characterRefs.push(characterRef(c));
  }
  const loc = lookupLocation(ctx.locations, shot.shot.location || shot.slugline);
  const propRefs: AIModelBriefRef[] = [];
  for (const name of shot.shot.props) {
    const p = lookupProp(ctx.props, name);
    if (p) propRefs.push(propRef(p));
  }
  const sound = ctx.soundByOrd.get(shot.shot.sceneOrd) ?? null;
  const soundForBrief = sound && sound.approved
    ? {
        ambientBed: sound.ambientBed,
        keyDiegetic: sound.keyDiegetic,
        nonDiegeticMusic: sound.nonDiegeticMusic,
        audioField: sound.audioField,
      }
    : null;

  // Continuity locks — eyelines, wardrobe, forbidden angles.
  const locks: string[] = [];
  if (loc) {
    for (const r of loc.eyelineRules) locks.push(`Eyeline: ${r}`);
    for (const r of loc.forbiddenAngles) locks.push(`Forbidden angle: ${r}`);
  }
  for (const p of propRefs) {
    const canon = ctx.props.get(p.id);
    for (const r of canon?.doNotChange ?? []) locks.push(`${p.label} canon: ${r}`);
  }

  // Avoid list = project avoid list + the assignment-specific overrides.
  const avoid = new Set<string>(ctx.avoidList);
  for (const v of assignment.avoidList ?? []) avoid.add(v);

  // Compose the prompt text. Prefer the brief's composedPrompt; fall back
  // to the GenerationQueue's composer in degraded mode.
  const composed =
    typeof shot.rawBrief.composedPrompt === "string" &&
    shot.rawBrief.composedPrompt.trim().length > 0
      ? (shot.rawBrief.composedPrompt as string)
      : composeFallbackPromptText(shot);

  return {
    kind: "ai_model",
    modelTarget: assignment.modelTarget ?? "manual_external",
    aspectRatio: shot.shot.aspectRatio || ctx.defaultAspectRatio,
    durationSec: shot.shot.durationSec || ctx.defaultDurationSec,
    promptText: composed,
    characterRefs,
    locationRef: loc ? locationRef(loc) : null,
    propRefs,
    continuityLocks: locks,
    soundNotes: soundForBrief,
    avoidList: [...avoid],
    adapterHints: adapterHintsFor(ctx),
  };
}

function composeFallbackPromptText(shot: ShotContext): string {
  const bits = [
    shot.shot.primaryImage,
    shot.shot.action,
    shot.shot.cameraLanguage,
    shot.shot.emotionalBeat,
  ].filter((s) => typeof s === "string" && s.trim().length > 0);
  return bits.join(". ");
}

// ---------------------------------------------------------------------------
// AI Creative brief builder
// ---------------------------------------------------------------------------

interface CreativeFlavor {
  intentLead: string;
  strategyLead: string;
  reviewPrefix: string;
}

const CREATIVE_FLAVORS: Record<string, CreativeFlavor> = {
  department_note: {
    intentLead: "Department intent",
    strategyLead: "Department approach",
    reviewPrefix: "Department review",
  },
  shot_plan: {
    intentLead: "Shot intent",
    strategyLead: "Shot plan",
    reviewPrefix: "Shot review",
  },
  rewrite_notes: {
    intentLead: "Rewrite intent",
    strategyLead: "Rewrite strategy",
    reviewPrefix: "Rewrite review",
  },
  prompt_strategy: {
    intentLead: "Prompt intent",
    strategyLead: "Prompt strategy",
    reviewPrefix: "Prompt review",
  },
  review_notes: {
    intentLead: "Review focus",
    strategyLead: "Review angle",
    reviewPrefix: "Review checklist",
  },
};

function buildAICreativeBrief(
  ctx: EpisodeBriefContext,
  shot: ShotContext,
  definition: RoleDefinition,
  assignment: RoleAssignment
): AICreativeBrief {
  const style = assignment.creativeBriefStyle ?? "department_note";
  const flavor = CREATIVE_FLAVORS[style] ?? CREATIVE_FLAVORS.department_note;

  const intent =
    `${flavor.intentLead}: ${definition.label} owns the creative posture on this shot. ` +
    `${shot.shot.subject ? `Subject: ${shot.shot.subject}. ` : ""}` +
    `${shot.shot.emotionalBeat ? `Beat: ${shot.shot.emotionalBeat}. ` : ""}` +
    (shot.shot.visualMotif ? `Motif: ${shot.shot.visualMotif}.` : "");

  const visualStrategy =
    `${flavor.strategyLead}: ${shot.shot.cameraLanguage || "Default coverage"}. ` +
    `${shot.shot.action ? `Action: ${shot.shot.action}.` : ""}`;

  const alternates = pickAlternates(definition, shot);
  const reviewCriteria = pickReviewCriteria(definition, shot, ctx);
  const promptStrategy = buildPromptStrategy(definition, shot, ctx, assignment);
  const risks = collectRiskNotes(definition, shot, ctx);
  const continuityConcerns = collectContinuityConcerns(definition, shot, ctx);

  return {
    kind: "ai_creative",
    style,
    shotIntent: intent.trim(),
    emotionalBeat: shot.shot.emotionalBeat || "(beat not set)",
    visualStrategy: visualStrategy.trim(),
    alternateApproaches: alternates,
    reviewCriteria,
    promptStrategy,
    riskNotes: risks,
    continuityConcerns,
  };
}

function pickAlternates(def: RoleDefinition, shot: ShotContext): string[] {
  const out: string[] = [];
  if (def.key === "director") {
    out.push(`Push closer on ${shot.shot.subject || "the subject"} for a tighter emotional read.`);
    out.push(`Widen and let the environment carry the beat.`);
  } else if (def.key === "cinematographer") {
    out.push(`Static frame with motivated source light only.`);
    out.push(`Subtle handheld with slow push — let the actor anchor focus.`);
  } else if (def.key === "production_designer" || def.key === "art_director") {
    out.push(`Strip the frame to one hero prop — let negative space breathe.`);
    out.push(`Layer in one secondary texture (fabric / glass / metal) to deepen the world.`);
  } else if (def.key === "composer" || def.key === "sound_designer") {
    out.push(`Lean into silence — let the ambient bed carry the shot.`);
    out.push(`Introduce a single motif touchpoint to anchor the beat.`);
  } else if (def.key === "prompt_supervisor") {
    out.push(`Tighten the primary image; cut anything not photographable.`);
    out.push(`Reorder clauses so the subject lands in the first sentence.`);
  } else if (def.key.startsWith("actor:") || def.key.startsWith("voice:")) {
    out.push(`Play the truth of the beat, then a second take with one less choice.`);
    out.push(`Hit the inner objective, not the line reading.`);
  } else {
    out.push(`Cover the moment cleanly; tag any risks early.`);
  }
  return out;
}

function pickReviewCriteria(
  def: RoleDefinition,
  shot: ShotContext,
  ctx: EpisodeBriefContext
): string[] {
  const out: string[] = [
    "Does the shot honour the emotional beat?",
    "Does the framing land the subject as the hero?",
  ];
  if (def.key === "cinematographer") {
    out.push("Are lens, framing and light consistent with the location bible?");
  }
  if (def.key === "prompt_supervisor") {
    out.push("Is the prompt observable behaviour (no interpretation language)?");
    out.push("Does the first sentence anchor the primary image?");
  }
  if (def.key === "script_supervisor") {
    out.push("Continuity locks: eyelines, wardrobe, time-of-day all hold?");
  }
  if (def.key === "composer" || def.key === "sound_designer") {
    const sound = ctx.soundByOrd.get(shot.shot.sceneOrd);
    if (sound && !sound.approved) {
      out.push("Sound bible row for this scene is not approved — flag if used.");
    }
  }
  return out;
}

function buildPromptStrategy(
  def: RoleDefinition,
  shot: ShotContext,
  ctx: EpisodeBriefContext,
  assignment: RoleAssignment
): string {
  const lines: string[] = [];
  lines.push(
    `Primary image: ${shot.shot.primaryImage || "(set primaryImage in Shot List)"}`
  );
  if (shot.shot.shotType) lines.push(`Shot type: ${shot.shot.shotType}`);
  lines.push(
    `Aspect ${shot.shot.aspectRatio || ctx.defaultAspectRatio} · ${shot.shot.durationSec || ctx.defaultDurationSec}s`
  );
  if (def.key === "prompt_supervisor") {
    lines.push(
      `Avoid list: ${[...new Set([...ctx.avoidList, ...(assignment.avoidList ?? [])])].join(", ") || "(none)"}`
    );
  }
  return lines.join("\n");
}

function collectRiskNotes(
  def: RoleDefinition,
  shot: ShotContext,
  ctx: EpisodeBriefContext
): string[] {
  const out: string[] = [];
  const sound = ctx.soundByOrd.get(shot.shot.sceneOrd) ?? null;
  if (!sound || !sound.approved) {
    out.push("Sound bible row missing or not approved — audio direction may drift.");
  }
  const loc = lookupLocation(ctx.locations, shot.shot.location || shot.slugline);
  if (!loc) {
    out.push("No location bible match — continuity rules cannot be enforced.");
  } else if (!loc.approved) {
    out.push(`Location bible for "${loc.name}" is not approved.`);
  }
  if (shot.shot.props.length > 0) {
    const missing: string[] = [];
    for (const p of shot.shot.props) {
      if (!lookupProp(ctx.props, p)) missing.push(p);
    }
    if (missing.length) {
      out.push(`Missing prop canon for: ${missing.join(", ")}.`);
    }
  }
  if (def.key.startsWith("actor:") || def.key.startsWith("voice:")) {
    const charId = def.derivedFromCharacterId;
    if (charId) {
      const canon = ctx.characters.get(charId);
      if (canon && !canon.consistencyPrompt && !canon.referenceUrl && !canon.approvedReferenceUrl) {
        out.push(`No visual bible for ${canon.name} — character consistency at risk.`);
      }
    }
  }
  return out;
}

function collectContinuityConcerns(
  def: RoleDefinition,
  shot: ShotContext,
  ctx: EpisodeBriefContext
): string[] {
  void def;
  const out: string[] = [];
  const loc = lookupLocation(ctx.locations, shot.shot.location || shot.slugline);
  if (loc) {
    for (const r of loc.eyelineRules) out.push(`Eyeline: ${r}`);
  }
  for (const name of shot.shot.characters) {
    const c = ctx.charactersByName.get(name.toLowerCase());
    if (c?.wardrobeForEpisode) out.push(`${c.name} wardrobe: ${c.wardrobeForEpisode}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live Person brief builder
// ---------------------------------------------------------------------------

const FORMAT_CHECKLIST: Record<string, string[]> = {
  human_brief: [
    "Read the scene context.",
    "Confirm the deliverable + due date.",
    "Note any continuity locks.",
    "Flag risks before starting.",
  ],
  task_list: [
    "Open Shot List + Generation Queue.",
    "Execute the assigned task.",
    "Mark completion in the queue.",
    "Hand off review notes if needed.",
  ],
  actor_notes: [
    "Read the scene + emotional beat.",
    "Identify the inner objective.",
    "Bring two takes — one playing the beat, one against it.",
    "Note wardrobe + HMU continuity.",
  ],
  wardrobe_notes: [
    "Confirm episode wardrobe canon.",
    "Source materials matching the location bible.",
    "Photograph each look before shoot day.",
    "Hand off continuity sheet to script supervisor.",
  ],
  composer_brief: [
    "Confirm scene tempo + mood.",
    "Match the Sound Bible motif map.",
    "Honour the silence rules.",
    "Deliver stems + DAW project.",
  ],
  director_notes: [
    "Confirm shot intent + coverage.",
    "Block the moment in space.",
    "Communicate beats to talent.",
    "Sign off on takes before wrap.",
  ],
};

function buildLivePersonBrief(
  ctx: EpisodeBriefContext,
  shot: ShotContext,
  definition: RoleDefinition,
  assignment: RoleAssignment
): LivePersonBrief {
  const format = assignment.handoffFormat ?? "human_brief";

  const epLabel =
    ctx.episodeNumber !== null
      ? `EP${String(ctx.episodeNumber).padStart(2, "0")}`
      : ctx.episodeId.slice(0, 6);
  const shotLabel = `SC${String(shot.shot.sceneOrd).padStart(2, "0")}_SH${String(shot.shot.shotIndex + 1).padStart(2, "0")}`;
  const taskHeadline = `${definition.label} · ${epLabel} ${shotLabel}`;

  const context = [
    `Slugline: ${shot.slugline}`,
    `Subject: ${shot.shot.subject || "—"}`,
    `Beat: ${shot.shot.emotionalBeat || "—"}`,
    `Action: ${shot.shot.action || "—"}`,
    shot.timeOfDay ? `Time of day: ${shot.timeOfDay}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const deliverable = formatDeliverable(definition, format, shot);

  const references = collectReferences(definition, shot, ctx);
  const departmentNotes = collectDepartmentNotes(definition, shot, ctx);

  return {
    kind: "live_person",
    format,
    recipient: assignment.personName?.trim() || null,
    email: assignment.personEmail?.trim() || null,
    taskHeadline,
    context,
    deliverable,
    checklist: FORMAT_CHECKLIST[format] ?? FORMAT_CHECKLIST.human_brief,
    references,
    departmentNotes,
  };
}

function formatDeliverable(
  def: RoleDefinition,
  format: string,
  shot: ShotContext
): string {
  if (format === "actor_notes") return `Performance for ${def.label} on ${shot.shot.subject || "this shot"}.`;
  if (format === "wardrobe_notes") return `Per-shot wardrobe + HMU continuity sheet.`;
  if (format === "composer_brief") return `Stems + score notes for the scene's emotional beat.`;
  if (format === "director_notes") return `Shot intent, blocking, and beat marks for this shot.`;
  if (format === "task_list") return `Operational checklist completed and signed off.`;
  return `Department brief delivered to the team, with risks + continuity locks called out.`;
}

function collectReferences(
  def: RoleDefinition,
  shot: ShotContext,
  ctx: EpisodeBriefContext
): string[] {
  const refs: string[] = [];
  for (const name of shot.shot.characters) {
    const c = ctx.charactersByName.get(name.toLowerCase());
    if (c?.approvedReferenceUrl) refs.push(`${c.name} ref: ${c.approvedReferenceUrl}`);
    else if (c?.referenceUrl) refs.push(`${c.name} candidate ref: ${c.referenceUrl}`);
  }
  const loc = lookupLocation(ctx.locations, shot.shot.location || shot.slugline);
  if (loc) refs.push(`Location bible: ${loc.name}`);
  if (def.key === "composer" || def.key === "sound_designer") {
    const sound = ctx.soundByOrd.get(shot.shot.sceneOrd);
    if (sound) {
      if (sound.nonDiegeticMusic) refs.push(`Music guidance: ${sound.nonDiegeticMusic}`);
      if (sound.ambientBed) refs.push(`Ambient bed: ${sound.ambientBed}`);
    }
  }
  return refs;
}

function collectDepartmentNotes(
  def: RoleDefinition,
  shot: ShotContext,
  ctx: EpisodeBriefContext
): string[] {
  const notes: string[] = [];
  if (shot.shot.cameraLanguage) notes.push(`Camera: ${shot.shot.cameraLanguage}`);
  if (def.key === "cinematographer") {
    const loc = lookupLocation(ctx.locations, shot.shot.location || shot.slugline);
    if (loc?.forbiddenAngles?.length) {
      notes.push(`Forbidden angles: ${loc.forbiddenAngles.join("; ")}`);
    }
  }
  if (def.key === "wardrobe_hmu" || def.key.startsWith("actor:")) {
    for (const name of shot.shot.characters) {
      const c = ctx.charactersByName.get(name.toLowerCase());
      if (c?.wardrobeForEpisode) notes.push(`${c.name} wardrobe: ${c.wardrobeForEpisode}`);
      if (c?.hmuForEpisode) notes.push(`${c.name} HMU: ${c.hmuForEpisode}`);
    }
  }
  if (def.key === "composer" || def.key === "sound_designer") {
    const sound = ctx.soundByOrd.get(shot.shot.sceneOrd);
    if (sound?.audioField) notes.push(`Audio field: ${sound.audioField}`);
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Router orchestration
// ---------------------------------------------------------------------------

function routeOne(
  ctx: EpisodeBriefContext,
  shot: ShotContext,
  cand: CandidateRole
): RoleBriefArtifact | { skip: BriefRouterSkip } {
  if (!cand.assignment) {
    return {
      skip: {
        roleKey: cand.key,
        roleLabel: cand.definition.label,
        reason: "Not assigned — open Creative Team to assign.",
      },
    };
  }
  const stamp = new Date().toISOString();
  let brief: AnyBrief;
  if (cand.assignment.kind === "ai") {
    brief = buildAIModelBrief(ctx, shot, cand.assignment);
  } else if (cand.assignment.kind === "ai_creative") {
    brief = buildAICreativeBrief(ctx, shot, cand.definition, cand.assignment);
  } else {
    brief = buildLivePersonBrief(ctx, shot, cand.definition, cand.assignment);
  }
  return {
    shotId: `${shot.shot.sceneOrd}-${shot.shot.shotIndex}`,
    sceneOrd: shot.shot.sceneOrd,
    shotIndex: shot.shot.shotIndex,
    roleKey: cand.key,
    roleLabel: cand.assignment.label || cand.definition.label,
    roleKind: cand.assignment.kind,
    brief,
    generatedAt: stamp,
  };
}

export interface RouteEpisodeOptions {
  /** When set, only produce briefs for this shot. */
  shotKey?: string;
  /** When set, only produce briefs for this role. */
  roleKey?: string;
}

export async function routeEpisodeBriefs(
  projectId: string,
  episodeId: string,
  opts: RouteEpisodeOptions = {}
): Promise<EpisodeRoleBriefsResponse | null> {
  const ctx = await loadEpisodeBriefContext(projectId, episodeId);
  if (!ctx) return null;
  const hasAssignments = Object.keys(ctx.assignments).length > 0;
  const rolesAvailable = ctx.characters.size > 0;

  const shots: ShotRoleBriefs[] = [];
  for (const shot of ctx.shots) {
    const key = `${shot.shot.sceneOrd}-${shot.shot.shotIndex}`;
    if (opts.shotKey && opts.shotKey !== key) continue;

    const candidates = candidatesForShot(ctx, shot).filter((c) =>
      opts.roleKey ? c.key === opts.roleKey : true
    );
    const artifacts: RoleBriefArtifact[] = [];
    const skipped: BriefRouterSkip[] = [];
    for (const cand of candidates) {
      const result = routeOne(ctx, shot, cand);
      if ("skip" in result) skipped.push(result.skip);
      else artifacts.push(result);
    }
    shots.push({
      shotId: key,
      sceneOrd: shot.shot.sceneOrd,
      shotIndex: shot.shot.shotIndex,
      shotDescription: shot.shot.subject || shot.shot.action || shot.shot.primaryImage || "Shot",
      characters: shot.shot.characters,
      artifacts,
      skipped,
    });
  }

  return {
    projectId,
    episodeId,
    episodeNumber: ctx.episodeNumber,
    episodeTitle: ctx.episodeTitle,
    scriptId: ctx.scriptId,
    rolesAvailable,
    hasAssignments,
    shots,
  };
}

// Re-export helpers used by exporters.
export { coreRoleByKey };
