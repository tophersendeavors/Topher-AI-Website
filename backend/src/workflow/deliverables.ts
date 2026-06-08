// Deliverable approval + AI regen (Stage 7).
//
// When a stage role is assigned to AI (Generic or Influence), the user
// never uploads anything. Instead they see AI-proposed deliverable
// values and approve / reject / regenerate them. This module backs
// those actions.

import { supabase } from "../db/client.js";
import { callLLM } from "../llm/provider.js";
import {
  CREATIVE_INFLUENCES,
  getInfluence,
} from "./creativeInfluences.js";
import { loadResolvedCanon } from "../departments/canonResolver.js";
import { logActivity } from "../departments/contributions.js";
import type { DepartmentKey } from "../departments/registry.js";

/** Approve a deliverable — writes a textOverride on canonSources so the
 *  value is locked verbatim. Uses the value supplied by the caller (the
 *  current bible value, or a regenerated proposal). No contribution row
 *  is created — this is the AI-approval path, not the human-upload
 *  path. */
export async function approveDeliverable(args: {
  scriptId: string;
  projectId: string;
  actorId: string;
  canonFieldPath: string;
  value: string;
  departmentKey: DepartmentKey;
}): Promise<void> {
  const { data: project } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", args.projectId)
    .single();
  if (!project) throw new Error("project not found");
  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const cs = (meta.canonSources ?? {}) as Record<string, unknown>;
  const existing = (cs[args.canonFieldPath] ?? {
    references: [],
    lastUpdatedAt: new Date(0).toISOString(),
  }) as {
    references: unknown[];
    textOverride?: {
      value: string;
      contributionId: string | null;
      approvedBy: string;
      approvedAt: string;
    };
    lastUpdatedAt: string;
  };
  existing.textOverride = {
    value: args.value,
    contributionId: null,
    approvedBy: args.actorId,
    approvedAt: new Date().toISOString(),
  };
  existing.lastUpdatedAt = new Date().toISOString();
  cs[args.canonFieldPath] = existing;
  meta.canonSources = cs;
  await supabase.from("projects").update({ metadata: meta }).eq("id", args.projectId);
  await logActivity({
    projectId: args.projectId,
    department: args.departmentKey,
    actorId: args.actorId,
    action: "deliverable_approved",
    targetType: "canon",
    targetId: args.canonFieldPath,
    notes: `AI-proposed value approved as canon: "${args.value.slice(0, 80)}${args.value.length > 80 ? "…" : ""}"`,
  });
}

/** Reject a deliverable's current proposal — clears any textOverride
 *  and notes that a fresh proposal is needed. */
export async function rejectDeliverable(args: {
  scriptId: string;
  projectId: string;
  actorId: string;
  canonFieldPath: string;
  departmentKey: DepartmentKey;
  notes?: string;
}): Promise<void> {
  const { data: project } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", args.projectId)
    .single();
  if (!project) return;
  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const cs = (meta.canonSources ?? {}) as Record<string, Record<string, unknown>>;
  const entry = cs[args.canonFieldPath];
  if (entry && entry.textOverride) {
    delete (entry as Record<string, unknown>).textOverride;
    entry.lastUpdatedAt = new Date().toISOString();
    meta.canonSources = cs;
    await supabase.from("projects").update({ metadata: meta }).eq("id", args.projectId);
  }
  await logActivity({
    projectId: args.projectId,
    department: args.departmentKey,
    actorId: args.actorId,
    action: "deliverable_rejected",
    targetType: "canon",
    targetId: args.canonFieldPath,
    notes: args.notes ?? "(no notes)",
  });
}

/** Shape of one cached AI proposal stored on script.metadata.workflowAIProposals.
 *  This is the "soft" AI-suggested value — distinct from canonSources
 *  textOverride, which is the locked human-approved value. */
export interface CachedAIProposal {
  value: string;
  generatedAt: string;
  influenceKey?: string | null;
  notes?: string;
  /** Tracks the last input the proposal was generated against. Lets us
   *  decide later whether a cached proposal is still fresh. */
  contextHash?: string;
}

/** Persist a regenerated AI proposal to the script's per-field cache so
 *  it can be surfaced next time the workflow report is loaded (without
 *  re-firing the LLM). */
async function writeProposalCache(args: {
  scriptId: string;
  canonFieldPath: string;
  proposal: CachedAIProposal;
}): Promise<void> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", args.scriptId)
    .single();
  if (!script) return;
  const meta = (script.metadata ?? {}) as Record<string, unknown>;
  const cache = (meta.workflowAIProposals ?? {}) as Record<string, CachedAIProposal>;
  cache[args.canonFieldPath] = args.proposal;
  meta.workflowAIProposals = cache;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", args.scriptId);
}

/** Roles whose canon fields each fall behind a lane-keeping prompt. */
type RegenRole =
  | "production_designer"
  | "art_director"
  | "propmaster"
  | "wardrobe"
  | "hmu"
  | "generic";

/** Detect the legacy char-indexed serialization pattern in a string.
 *  Triggered when an older version of `assembleBlockingSeed` ran
 *  `Object.entries(string)` on what should have been an object — the
 *  result reads like `0: C; 1: l; 2: o; 3: c; 4: k; 5:  ; 6: o; ...`.
 *  When this is detected on a regen's `currentValue`, the value is
 *  dropped from the prompt so the LLM writes fresh from shot context
 *  instead of trying to refine nonsense (and returning empty).
 *
 *  Heuristic: count `\d+: \S` tokens. Real Director / DP briefs never
 *  contain more than a handful of these (e.g. "T2.2", "8:1 ratio").
 *  10+ consecutive matches is unambiguously the broken pattern. */
function isCharIndexedGarbage(value: string | undefined | null): boolean {
  if (!value) return false;
  // Count occurrences of `<number>: <single-non-space-char>` separated
  // by `; ` — the signature of the bug.
  const matches = value.match(/\b\d+:\s*\S/g);
  if (!matches) return false;
  if (matches.length >= 10) return true;
  // Stricter consecutive-run check for shorter values.
  return /\b\d+:\s*\S(\s*;\s*\d+:\s*\S){5,}/.test(value);
}

/** Map a canon field path to the creative role that owns it. Drives the
 *  role-specialized regen prompt. */
function classifyRoleFromPath(path: string): RegenRole {
  if (path.startsWith("locationBibles.") && path.includes(".architecture.")) {
    return "production_designer";
  }
  if (
    path.startsWith("locationBibles.") &&
    (path.includes(".setDressing.") || path.includes(".furnitureDesign."))
  ) {
    return "art_director";
  }
  if (path.startsWith("propBibles.")) return "propmaster";
  if (
    path.startsWith("characters.") &&
    path.includes(".visualBible.wardrobeByEpisode")
  ) {
    return "wardrobe";
  }
  if (
    path.startsWith("characters.") &&
    path.includes(".visualBible.hmuByEpisode")
  ) {
    return "hmu";
  }
  return "generic";
}

/** Per-role system prompts. Each role gets:
 *  - A short IDENTITY line so the LLM knows who it is.
 *  - An IN-LANE list — what THIS role decides.
 *  - An explicit OUT-OF-LANE list — what THIS role must NEVER propose
 *    (those decisions belong to other departments).
 *  - A FORMAT rule — short, concrete, production-ready, no headers. */
function buildSingleFieldRolePrompt(args: {
  role: RegenRole;
  influence: string;
}): string {
  const inLanes: Record<RegenRole, string> = {
    production_designer:
      "You are the Production Designer. You decide the architectural identity of the space ONLY: room type, wall colors and finishes, floor color and material, ceiling treatment, base palette.",
    art_director:
      "You are the Art Director. You decide set-dressing items and their condition ONLY: dressed furniture, bedding (comforter / sheets / pillows), wall décor rule, clutter level, materials and color of decorative items.",
    propmaster:
      "You are the Propmaster. You decide the visual canon of hero props ONLY: how a specific prop must look across every shot (material, color, wear, scale, distinguishing details).",
    wardrobe:
      "You are the Wardrobe department head. You decide character clothing for THIS episode ONLY: garment, color, material, fit, distinguishing details. No hair, no makeup, no jewelry beyond what the character literally wears.",
    hmu:
      "You are Hair / Makeup. You decide character hair and makeup state for THIS episode ONLY: hair condition, makeup intensity, skin state, episode-specific looks.",
    generic:
      "You are a department head on a production. You propose ONE specific canonical value for the requested decision.",
  };

  const outLanes: Record<RegenRole, string[]> = {
    production_designer: [
      "Do NOT propose furniture pieces, bedding, wall décor, or decorative items — that is Art Direction.",
      "Do NOT propose props or anything characters handle — that is the Propmaster.",
      "Do NOT propose camera, lens, lighting design, framing — that is the DP.",
      "Do NOT propose wardrobe, hair, makeup — that is Wardrobe / HMU.",
      "Do NOT propose blocking, eyelines, performance — that is the Director.",
    ],
    art_director: [
      "Do NOT propose architectural elements (wall color, floor, ceiling) — that is Production Design.",
      "Do NOT propose hero props or items characters actively handle — that is the Propmaster.",
      "Do NOT propose camera, lens, lighting, framing — that is the DP.",
      "Do NOT propose wardrobe, hair, makeup — that is Wardrobe / HMU.",
      "Do NOT propose blocking, eyelines, performance — that is the Director.",
    ],
    propmaster: [
      "Do NOT propose architecture, walls, floor — that is Production Design.",
      "Do NOT propose set dressing or decorative items the prop sits on — that is Art Direction.",
      "Do NOT propose camera, lens, lighting, framing — that is the DP.",
      "Do NOT propose wardrobe, hair, makeup — that is Wardrobe / HMU.",
      "Do NOT propose blocking, character action, or how the prop is handled in performance — that is the Director.",
    ],
    wardrobe: [
      "Do NOT propose hair or makeup — that is HMU.",
      "Do NOT propose architecture, set dressing, or props — those are PD / Art / Props.",
      "Do NOT propose camera, lens, lighting, framing — that is the DP.",
      "Do NOT propose blocking or performance — that is the Director.",
    ],
    hmu: [
      "Do NOT propose clothing or accessories — that is Wardrobe.",
      "Do NOT propose architecture, set dressing, or props — those are PD / Art / Props.",
      "Do NOT propose camera, lens, lighting, framing — that is the DP.",
      "Do NOT propose blocking or performance — that is the Director.",
    ],
    generic: [
      "Stay in your department's lane — don't propose values that belong to another role.",
    ],
  };

  return [
    inLanes[args.role],
    "",
    "Output rules:",
    "- Return ONLY the production-ready value for the requested field.",
    "- Short, concrete, filmable. No headers, no markdown, no bullet lists.",
    "- Consistent with the project's Visual World Rules.",
    "- Be opinionated, not generic.",
    "",
    "Lane discipline (strict):",
    ...outLanes[args.role].map((l) => `- ${l}`),
    args.influence ? `\nYou are styled by this creative influence (principles only):\n${args.influence}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Regenerate a deliverable proposal via LLM. Returns the new value
 *  AND caches it on the script so the workflow report can surface it
 *  the next time the stage is opened — no need for the writer to click
 *  Regenerate before they can Approve.
 *
 *  Inputs the LLM sees:
 *    - the field's label + description (what's being decided)
 *    - the screenplay/project context
 *    - the current value (if any), so the regen can deviate
 *    - the role's Creative Influence principles (when assigned)
 *    - optional user notes (for "regen with notes") */
export async function regenDeliverableProposal(args: {
  scriptId: string;
  projectId: string;
  canonFieldPath: string;
  deliverableLabel: string;
  deliverableDescription?: string;
  currentValue?: string;
  influenceKey?: string | null;
  notes?: string;
}): Promise<{ value: string }> {
  // Pull project + screenplay context.
  const { data: project } = await supabase
    .from("projects")
    .select("metadata, title")
    .eq("id", args.projectId)
    .single();
  const projMeta = (project?.metadata ?? {}) as Record<string, unknown>;
  const projectTitle = (project?.title as string | undefined) ?? "Untitled";
  const vwr = (projMeta.visualWorldRules ?? {}) as {
    aesthetic?: string[];
    forbidden?: string[];
    lighting?: string[];
    texture?: string[];
  };

  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", args.scriptId)
    .single();
  const scriptMeta = (script?.metadata ?? {}) as Record<string, unknown>;
  const chain = (scriptMeta.chainSnapshot ?? {}) as {
    hook?: string;
    setup?: string;
    twist?: string;
    cliffhanger?: string;
  };

  // Influence principles.
  const influence = args.influenceKey ? getInfluence(args.influenceKey) : undefined;
  const principleLines = (influence?.principles ?? []).map((p) => `  • ${p}`).join("\n");

  // Specialized prompts for per-shot canon fields. The Director's brief
  // and the DP's brief are structured multi-line specifications, not
  // single sentences — they have to stay in lane and cover every
  // creative decision that role is responsible for.
  const isDPBrief = /\.dpBrief$/.test(args.canonFieldPath);
  const isDirectorBrief = /\.directorBrief$/.test(args.canonFieldPath);

  // Lane detection for Stages 3-6 (Production Designer, Art Director,
  // Propmaster, Wardrobe, HMU). Each role's regen prompt explicitly
  // states what's IN their lane and what's OUT, so an Art Director
  // can't drift into camera/lens (DP) and a Propmaster can't drift
  // into set dressing (Art Dept).
  const role = classifyRoleFromPath(args.canonFieldPath);

  let roleSystemPrompt: string;
  if (isDPBrief) {
    roleSystemPrompt = [
      "You are the Director of Photography for this shot. Produce a COMPLETE",
      "DP brief covering every cinematography decision. Stay in the DP's",
      "lane: composition, optics, motion, focus, light. Do NOT drift into",
      "production design, set dressing, props, wardrobe, hair/makeup,",
      "blocking, or performance.",
      "",
      "INTERNAL CONSISTENCY (verify before writing — non-negotiable):",
      "  1. Pick exactly ONE lens focal length. Mention focal length / mm /",
      "     lens character ONLY in the 'Lens' line. Never reference a",
      "     different focal length in 'Framing' or 'Camera position'.",
      "  2. Camera height MUST be an explicit relative descriptor",
      "     (e.g. 'low, mattress-height with Maya lying down',",
      "     'waist-level standing', 'high, ceiling-corner'). Forbid the",
      "     bare word 'eye-level' unless qualified by the character's body",
      "     position at that moment.",
      "  3. Camera position MUST be a precise spatial statement (distance,",
      "     side, angle in degrees if useful) — not 'from foot of bed'",
      "     alone. Use the character's position as the anchor.",
      "  4. Lighting MUST name a specific motivated source. Forbid",
      "     'ambient wash' / 'soft general fill' / 'cool tone' without a",
      "     stated source (phone screen, window sun, off-screen practical",
      "     lamp, TV, sodium streetlight, etc.).",
      "  5. Out-of-frame is CINEMATOGRAPHY exclusions only (lights,",
      "     reflections, camera crew, mic, second subject leaving frame).",
      "     Not set-dressing or wardrobe rules.",
      "  6. NEVER INVENT SET PIECES. You may only reference physical",
      "     set / architectural elements (window, curtain, lamp, door,",
      "     mirror, fixture, etc.) if they appear in the Approved set",
      "     elements list provided below. If a needed light source isn't",
      "     in that list, describe the EFFECT only — 'ambient bleed from",
      "     off-screen camera-right', 'unspecified exterior cool source",
      "     spilling onto wall', 'off-screen warm practical' — committing",
      "     only to direction + quality, NOT to the physical fixture.",
      "     Introducing new set pieces is Production Design / Art",
      "     Direction's job, not yours.",
      "",
      "Output FORMAT — exactly these labeled lines, in this order:",
      "  Aspect ratio: <e.g. 9:16, 16:9, 2.39:1>",
      "  Framing: <shot size + composition only — CU, MCU, MS, MWS, WS,",
      "    OTS, two-shot, insert; plus the key compositional choice. NO",
      "    lens specs here.>",
      "  Lens: <ONE focal length, e.g. 35mm or 50mm or 85mm + lens",
      "    character in one phrase, e.g. 'fast prime, slight character",
      "    breathing'. ONE lens. Period.>",
      "  Camera position / view zone: <exact spatial position relative to",
      "    the subject — distance, side, height descriptor anchored to the",
      "    subject's body position, angle (slightly up / level / down) in",
      "    degrees if it matters. Example: 'low, mattress-height, ~3 ft",
      "    from Maya's face, slightly off-axis camera-left, angled up ~8°'.>",
      "  Camera movement: <locked-off / slow push-in / pull-out / dolly /",
      "    handheld + intent. State 'locked-off' if no movement.>",
      "  Focus priority: <what is sharp vs soft; depth-of-field f-stop or",
      "    descriptor; rack-focus if any. Skip with '—' if not relevant.>",
      "  Lighting: <required triplet on one or three lines —",
      "    source: which motivated source(s) provide the light",
      "      (be specific: phone screen, window sun, practical lamp,",
      "      off-screen TV, sodium streetlight, etc.);",
      "    direction: which side the key comes from (camera-left, frontal,",
      "      top-down, raking from window), where fill (if any) comes from;",
      "    dominance: contrast ratio, hardness (hard / soft / diffused),",
      "      which source DOMINATES the frame.>",
      "  Out-of-frame: <cinematography-only exclusions — overhead",
      "    practicals, reflections that break the illusion, second",
      "    characters that should not be in the composition, camera",
      "    equipment. NOT set-dressing or wardrobe rules.>",
      "",
      "Every line is required (Focus priority may be '—' if not relevant).",
      "Be concrete and shootable. No marketing language.",
      influence
        ? `\nYou are styled by this creative influence (principles only):\n${principleLines}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else if (isDirectorBrief) {
    roleSystemPrompt = [
      "You are the Director for this shot. Produce a COMPLETE blocking",
      "brief covering character movement, eyeline, and physical action.",
      "Do NOT drift into other departments (no camera/lens/lighting — that",
      "is the DP; no set dressing or wardrobe; no production-design",
      "decisions). Stay in the Director's lane: where people stand, how",
      "they move, where they look, how they touch props.",
      "",
      "Output FORMAT — exactly these labeled lines, in this order:",
      "  Start position: <exact spatial position of each character at shot start>",
      "  End position: <exact spatial position of each character at shot end>",
      "  Movement path: <how each character gets from start to end; pace + emotional beat>",
      "  Eyeline target: <where each character looks and at what beat>",
      "  Prop handling: <what each character touches/handles, how, when in the shot>",
      "  Performance beat: <the one emotional turn this shot must land>",
      "",
      "Every line is required. Be concrete and stageable.",
      influence
        ? `\nYou are styled by this creative influence (principles only):\n${principleLines}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    roleSystemPrompt = buildSingleFieldRolePrompt({
      role,
      influence: influence?.label ? principleLines : "",
    });
  }
  const systemPrompt = roleSystemPrompt;

  // Pull the shot's brief context so DP / Director regens know what
  // they're shooting — slugline, action, characters, primary image.
  let shotContext = "";
  if (isDPBrief || isDirectorBrief) {
    shotContext = await loadShotContextForRegen({
      scriptId: args.scriptId,
      canonFieldPath: args.canonFieldPath,
    });
  }

  // Detect the legacy "char-indexed garbage" pattern from the earlier
  // `Object.entries(string)` bug in assembleBlockingSeed. The corrupted
  // value looks like `0: C; 1: l; 2: o; 3: c; 4: k; ...`. When we see
  // this, we IGNORE currentValue entirely and tell the LLM to write
  // fresh from the shot context — passing the garbage in poisons the
  // generation (the LLM tries to "refine" nonsense and returns nothing).
  const corruptedCharIndexed = isCharIndexedGarbage(args.currentValue);
  const safeCurrentValue = corruptedCharIndexed ? undefined : args.currentValue;
  const corruptionNote = corruptedCharIndexed
    ? "Prior value for this field was corrupted (legacy serialization bug). Ignore any prior value and write this brief fresh from the shot context above."
    : "";

  const userBlocks = [
    `Project: ${projectTitle}`,
    chain.hook ? `Hook: ${chain.hook}` : "",
    chain.setup ? `Setup: ${chain.setup}` : "",
    chain.twist ? `Twist: ${chain.twist}` : "",
    chain.cliffhanger ? `Cliffhanger: ${chain.cliffhanger}` : "",
    vwr.aesthetic?.length ? `Visual aesthetic anchors:\n  • ${vwr.aesthetic.join("\n  • ")}` : "",
    vwr.forbidden?.length ? `Visual forbidden moves:\n  • ${vwr.forbidden.join("\n  • ")}` : "",
    shotContext ? `\nShot context:\n${shotContext}` : "",
    "",
    `Field to decide: ${args.deliverableLabel}`,
    args.deliverableDescription ? `Field meaning: ${args.deliverableDescription}` : "",
    safeCurrentValue ? `Current value (you may deviate or refine):\n  ${safeCurrentValue}` : "",
    corruptionNote,
    args.notes ? `\nWriter steering notes:\n  ${args.notes}` : "",
    "",
    "Return ONLY the production-ready value, as a short paragraph or phrase.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userBlocks },
    ],
    // Structured DP / Director briefs need internal consistency (no
    // contradictory focal lengths, no vague lighting). Lower temperature
    // = less drift. Single-field role canon (wallColor etc.) keeps the
    // higher temperature for varied creative options.
    temperature: isDPBrief || isDirectorBrief ? 0.35 : 0.6,
    // Structured per-shot briefs are 6–9 labeled lines with real detail.
    maxTokens: isDPBrief || isDirectorBrief ? 1200 : 400,
  });

  // Strip surrounding quotes if the LLM added them.
  let value = res.text.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }

  // Cache the proposal on the script so deliverables.deriveDeliverables
  // can surface it without re-firing the LLM.
  await writeProposalCache({
    scriptId: args.scriptId,
    canonFieldPath: args.canonFieldPath,
    proposal: {
      value,
      generatedAt: new Date().toISOString(),
      influenceKey: args.influenceKey ?? null,
      notes: args.notes,
    },
  });

  return { value };
}

/** Look up the shot context (slugline + action + characters + primary
 *  image) for a per-shot canon field path so the DP / Director regen
 *  prompt has enough to write a real brief. Returns "" when the path
 *  isn't a shotBriefs.* path.
 *
 *  For DP briefs we also load the APPROVED set elements (architecture
 *  + furniture + set dressing) so the DP can only reference physical
 *  set pieces that PD / Art Dept have actually approved. Unapproved
 *  fixtures must be described as "ambient bleed / off-screen source"
 *  rather than invented. */
async function loadShotContextForRegen(args: {
  scriptId: string;
  canonFieldPath: string;
}): Promise<string> {
  const m = args.canonFieldPath.match(/^shotBriefs\.(\d+)\.(\d+)\./);
  if (!m) return "";
  const sceneOrd = Number(m[1]);
  const shotIndex = Number(m[2]);
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, metadata")
    .eq("id", args.scriptId)
    .single();
  const meta = (script?.metadata ?? {}) as Record<string, unknown>;
  const briefs = ((meta.aiPrompts as Record<string, unknown> | undefined)
    ?.briefs as Record<string, Record<string, Record<string, unknown>>> | undefined) ?? {};
  const brief = briefs[String(sceneOrd)]?.[String(shotIndex)] as Record<string, unknown> | undefined;
  const { data: sceneRow } = await supabase
    .from("script_scenes")
    .select("slugline")
    .eq("script_id", args.scriptId)
    .eq("ord", sceneOrd)
    .maybeSingle();
  const slugline = (sceneRow?.slugline as string | null) ?? "";
  const pieces: string[] = [];
  if (slugline) pieces.push(`Slugline: ${slugline}`);
  if (brief) {
    const primary = brief.primaryImage as string | undefined;
    if (primary && primary.trim()) pieces.push(`Primary image: ${primary.trim()}`);
    const action = (brief.actionDescription as string | undefined)
      ?? (brief.action as string | undefined)
      ?? (brief.shotAction as string | undefined);
    if (action) pieces.push(`Action: ${String(action).trim()}`);
    const chars = brief.characters as Array<{ name?: string }> | undefined;
    if (chars && chars.length > 0) {
      pieces.push(
        `Characters in shot: ${chars.map((c) => c.name).filter(Boolean).join(", ")}`
      );
    }
    const intent = brief.shotIntent as string | undefined;
    if (intent) pieces.push(`Shot intent: ${intent}`);
  }

  // DP-specific: list approved set elements for this scene's location.
  // The DP brief prompt forbids inventing physical fixtures — they may
  // only reference items in this list. Items not in the list must be
  // described as effects (ambient bleed, off-screen source) instead.
  const isDP = /\.dpBrief$/.test(args.canonFieldPath);
  if (isDP && slugline && script?.project_id) {
    const approvedElements = await loadApprovedSetElementsForSlug({
      projectId: script.project_id as string,
      slugline,
    });
    if (approvedElements.length > 0) {
      pieces.push(
        "",
        "APPROVED set elements (you may reference these physical pieces;",
        "anything NOT in this list must be described as off-screen / ambient",
        "rather than introduced):",
        ...approvedElements.map((e) => `  • ${e}`)
      );
    } else {
      pieces.push(
        "",
        "APPROVED set elements: (none approved yet)",
        "→ Do not invent physical set pieces. Describe lighting as",
        "  off-screen / ambient with direction + quality only."
      );
    }

    // Location-level DP constraints — persistent rules the DP regen
    // must honor on EVERY shot in this location. These come from canon
    // textOverrides at synthetic paths `locationBibles.<key>.dpLightingConstraints`
    // and `.dpFramingRules`, edited via the Cinematography stage UI.
    const constraints = await loadLocationDPConstraintsForSlug({
      projectId: script.project_id as string,
      slugline,
    });
    if (constraints.lighting.length > 0 || constraints.framing.length > 0) {
      pieces.push("", "LOCATION-LEVEL DP CONSTRAINTS (honor verbatim on every shot in this location):");
      if (constraints.lighting.length > 0) {
        pieces.push("  Lighting:");
        for (const line of constraints.lighting) pieces.push(`    • ${line}`);
      }
      if (constraints.framing.length > 0) {
        pieces.push("  Framing / Out-of-frame:");
        for (const line of constraints.framing) pieces.push(`    • ${line}`);
      }
    }
  }
  return pieces.join("\n");
}

/** Read location-level DP constraints (lighting + framing) for the
 *  scene's location. Constraints are stored as canon textOverrides at
 *  `locationBibles.<key>.dpLightingConstraints` and `.dpFramingRules`
 *  — newline-joined strings, one rule per line. */
async function loadLocationDPConstraintsForSlug(args: {
  projectId: string;
  slugline: string;
}): Promise<{ lighting: string[]; framing: string[] }> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", args.projectId)
    .maybeSingle();
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const locBibles = (meta.locationBibles ?? {}) as Record<string, Record<string, unknown>>;
  const canonSources = (meta.canonSources ?? {}) as Record<
    string,
    { textOverride?: { value: string } }
  >;
  const slugTok = args.slugline
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const lighting: string[] = [];
  const framing: string[] = [];
  const splitLines = (s: string | undefined): string[] => {
    if (!s) return [];
    return s
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-•*]\s*/, "").trim())
      .filter((l) => l.length > 0);
  };
  for (const [key, bible] of Object.entries(locBibles)) {
    const nameTok = ((bible.name as string) || key)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
    const matches =
      slugTok === nameTok ||
      slugTok.includes(nameTok) ||
      nameTok.includes(slugTok);
    if (!matches) continue;
    const litPath = `locationBibles.${key}.dpLightingConstraints`;
    const framePath = `locationBibles.${key}.dpFramingRules`;
    lighting.push(...splitLines(canonSources[litPath]?.textOverride?.value));
    framing.push(...splitLines(canonSources[framePath]?.textOverride?.value));
  }
  return { lighting, framing };
}

/** Pull the approved set-element values from canon for a given scene
 *  slugline. Looks at location bibles whose name matches and returns
 *  the human-readable approved values (textOverrides preferred, falling
 *  back to bible defaults). */
async function loadApprovedSetElementsForSlug(args: {
  projectId: string;
  slugline: string;
}): Promise<string[]> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", args.projectId)
    .maybeSingle();
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const locBibles = (meta.locationBibles ?? {}) as Record<string, Record<string, unknown>>;
  const canonSources = (meta.canonSources ?? {}) as Record<
    string,
    { textOverride?: { value: string } }
  >;
  const slugTok = args.slugline
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const out: string[] = [];
  for (const [key, bible] of Object.entries(locBibles)) {
    const nameTok = ((bible.name as string) || key)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
    const matches =
      slugTok === nameTok ||
      slugTok.includes(nameTok) ||
      nameTok.includes(slugTok);
    if (!matches) continue;
    const arch = (bible.architecture as Record<string, string> | undefined) ?? {};
    const sd = (bible.setDressing as Record<string, unknown> | undefined) ?? {};
    const fd = (bible.furnitureDesign as Record<string, string> | undefined) ?? {};
    const resolved = (path: string, fallback: string | undefined): string | undefined => {
      const tov = canonSources[path]?.textOverride?.value;
      return (tov && tov.trim()) || (fallback && String(fallback).trim()) || undefined;
    };
    for (const [k, v] of Object.entries(arch)) {
      const val = resolved(`locationBibles.${key}.architecture.${k}`, v);
      if (val) out.push(`${humanize(k)}: ${val}`);
    }
    for (const [k, v] of Object.entries(fd)) {
      const val = resolved(`locationBibles.${key}.furnitureDesign.${k}`, v);
      if (val) out.push(`${humanize(k)}: ${val}`);
    }
    for (const [k, v] of Object.entries(sd)) {
      if (k === "bedding" && v && typeof v === "object") {
        for (const [bk, bv] of Object.entries(v as Record<string, unknown>)) {
          const val = resolved(
            `locationBibles.${key}.setDressing.bedding.${bk}`,
            bv as string | undefined
          );
          if (val) out.push(`${humanize(bk)}: ${val}`);
        }
        continue;
      }
      if (typeof v === "string") {
        const val = resolved(`locationBibles.${key}.setDressing.${k}`, v);
        if (val) out.push(`${humanize(k)}: ${val}`);
      }
    }
  }
  return out;
}

function humanize(s: string): string {
  return s
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Bulk-fire AI proposals for every deliverable in a stage that doesn't
 *  yet have a cached proposal or human approval. Returns one entry per
 *  field with either { ok, value } or { ok: false, error }. */
export async function autoProposeStage(args: {
  scriptId: string;
  projectId: string;
  influenceKey: string | null;
  deliverables: Array<{
    canonFieldPath: string;
    deliverableLabel: string;
    deliverableDescription?: string;
    currentValue?: string;
  }>;
}): Promise<{
  results: Array<{
    canonFieldPath: string;
    ok: boolean;
    value?: string;
    error?: string;
  }>;
}> {
  const out = await Promise.all(
    args.deliverables.map(async (d) => {
      try {
        const r = await regenDeliverableProposal({
          scriptId: args.scriptId,
          projectId: args.projectId,
          canonFieldPath: d.canonFieldPath,
          deliverableLabel: d.deliverableLabel,
          deliverableDescription: d.deliverableDescription,
          currentValue: d.currentValue,
          influenceKey: args.influenceKey,
        });
        return { canonFieldPath: d.canonFieldPath, ok: true, value: r.value };
      } catch (err) {
        return {
          canonFieldPath: d.canonFieldPath,
          ok: false,
          error: (err as Error).message,
        };
      }
    })
  );
  return { results: out };
}
