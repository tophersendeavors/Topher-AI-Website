// Workflow state derivation + persistence (Stage 5).
//
// Reads + writes script.metadata.episodeWorkflow. Auto-populates
// deliverable satisfaction from existing canonSources / bibles / briefs
// so the user's earlier work is never lost.

import { supabase } from "../db/client.js";
import {
  ALL_STAGE_KEYS,
  type EpisodeWorkflowState,
  type RoleAssignment,
  type RoleKey,
  type RoleMeta,
  type StageDeliverable,
  type StageKey,
  type StageState,
  type WorkflowReport,
} from "./types.js";
import { loadResolvedCanon } from "../departments/canonResolver.js";
import { runPreflight } from "../preflight/preflight.js";
import {
  resolveProjectTypeConfig,
  isScriptApprovedForProduction,
  isScriptSpinePresent,
} from "@toburt/shared";

// ----- Role registry (simplified for Stage 5; full talent system is Phase 6) ----

export const ROLE_REGISTRY: Record<RoleKey, RoleMeta> = {
  director: {
    key: "director",
    label: "Director",
    responsibility:
      "Scene intention, character movement, emotional beats, performance restraint.",
    departmentKey: "blocking",
  },
  script_supervisor: {
    key: "script_supervisor",
    label: "Script Supervisor / Continuity",
    responsibility:
      "Shot-to-shot continuity, draft-source match, eyelines, prop / wardrobe continuity.",
    departmentKey: "script_supervisor",
  },
  production_designer: {
    key: "production_designer",
    label: "Production Designer",
    responsibility:
      "Visual world, location identity, architecture, palette, mood, what the space must never become.",
    departmentKey: "production_design",
  },
  art_director: {
    key: "art_director",
    label: "Art Director",
    responsibility:
      "Specific set dressing — furniture, bedding, wall decor, clutter level, in-frame rules.",
    departmentKey: "art_dept",
  },
  set_decorator: {
    key: "set_decorator",
    label: "Set Decorator",
    responsibility:
      "Sourcing and placing every dressed item; supports the Art Director.",
    departmentKey: "art_dept",
  },
  propmaster: {
    key: "propmaster",
    label: "Propmaster",
    responsibility:
      "Hero props — phone, clock, closet door, blood smear, handled documents. Visual canon + handler + start/end positions.",
    departmentKey: "props",
  },
  wardrobe: {
    key: "wardrobe",
    label: "Wardrobe",
    responsibility:
      "Character clothing, jewelry, episode-specific looks, forbidden wardrobe drift.",
    departmentKey: "wardrobe_hmu",
  },
  hmu: {
    key: "hmu",
    label: "Hair / Makeup",
    responsibility:
      "Hair state, makeup state, episode-specific appearance, forbidden HMU drift.",
    departmentKey: "wardrobe_hmu",
  },
  cinematographer: {
    key: "cinematographer",
    label: "Cinematographer / DP",
    responsibility:
      "Shot size, lens, camera position, movement, lighting, view zones, what's in and out of frame.",
    departmentKey: "cinematography",
  },
  blocking: {
    key: "blocking",
    label: "Blocking / Movement",
    responsibility:
      "Character start/end positions, movement paths, eyeline targets, prop handling per shot.",
    departmentKey: "blocking",
  },
  prompt_supervisor: {
    key: "prompt_supervisor",
    label: "AI Video Prompt Supervisor",
    responsibility:
      "Translates approved department work into model-specific prompts (Kling / Flow / Runway).",
    departmentKey: "prompt_supervisor",
  },
  quality_control: {
    key: "quality_control",
    label: "Quality Control",
    responsibility:
      "Final readiness check — script match, continuity, references, drift, missing canon.",
    departmentKey: "quality_gate",
  },
};

export const ALL_ROLE_KEYS = Object.keys(ROLE_REGISTRY) as RoleKey[];

// ----- Stage dependencies + which deliverables drive each stage --------------

const STAGE_DEPS: Record<StageKey, StageKey[]> = {
  script_approved: [],
  roles_assigned: ["script_approved"],
  production_design: ["roles_assigned"],
  art_dept: ["production_design"],
  props: ["production_design", "art_dept"],
  wardrobe_hmu: ["production_design"],
  blocking: ["production_design", "art_dept", "props", "wardrobe_hmu"],
  cinematography: [
    "production_design",
    "art_dept",
    "props",
    "wardrobe_hmu",
    "blocking",
  ],
  continuity: ["blocking", "cinematography"],
  prompt_supervisor: ["continuity"],
  preflight: ["prompt_supervisor"],
  generate: ["preflight"],
};

const DEFAULT_ROLE_ASSIGNMENT = (role: RoleKey): RoleAssignment => ({
  roleKey: role,
  assignmentType: "ai_generic",
  influenceKey: null,
  assigneeUserId: null,
  assigneeName: null,
  status: "unassigned",
  updatedAt: new Date(0).toISOString(),
});

const DEFAULT_STAGE = (): StageState => ({
  status: "locked",
  blockedBy: [],
  approvedBy: null,
  approvedAt: null,
  changesRequestedAt: null,
  changesRequestedNotes: null,
});

function emptyState(): EpisodeWorkflowState {
  const stages = {} as Record<StageKey, StageState>;
  for (const k of ALL_STAGE_KEYS) stages[k] = DEFAULT_STAGE();
  const roleAssignments = {} as Record<RoleKey, RoleAssignment>;
  for (const r of ALL_ROLE_KEYS) roleAssignments[r] = DEFAULT_ROLE_ASSIGNMENT(r);
  return {
    stages,
    roleAssignments,
    rolesConfirmedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

// ----- Public API ------------------------------------------------------------

export async function getWorkflowReport(scriptId: string): Promise<WorkflowReport> {
  const { data: script } = await supabase
    .from("scripts")
    .select("id, project_id, episode_id, metadata")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error(`Script ${scriptId} not found`);

  const meta = (script.metadata ?? {}) as Record<string, unknown>;
  let state =
    (meta.episodeWorkflow as EpisodeWorkflowState | undefined) ?? emptyState();
  // Self-heal: if any stage key is missing (older record), fill in.
  for (const k of ALL_STAGE_KEYS) state.stages[k] ??= DEFAULT_STAGE();
  for (const r of ALL_ROLE_KEYS) state.roleAssignments[r] ??= DEFAULT_ROLE_ASSIGNMENT(r);

  // Resolve project type → adapter. The adapter tells us which
  // `scripts.metadata` field signals Stage 1 approval (micro vs
  // prestige/mini) so the workflow works for every project type, not
  // just Micro Drama. See docs/PROJECT_TYPE_ADAPTERS.md.
  const { data: projectRow } = await supabase
    .from("projects")
    .select("metadata, kind")
    .eq("id", script.project_id as string)
    .maybeSingle();
  const projectMeta = (projectRow?.metadata ?? {}) as Record<string, unknown>;
  const ptConfig = resolveProjectTypeConfig(
    projectMeta.projectType as string | undefined,
    projectRow?.kind as string | undefined
  );

  // Derive deliverables from canonSources / bibles / briefs / preflight.
  const deliverables = await deriveDeliverables(
    script.project_id as string,
    scriptId,
    script,
    ptConfig
  );

  // Auto-mark Stage 1 (script approved) when the appropriate approval
  // signal is set — `microDramaApproval` for micro, `draftApproval`
  // for prestige / mini / feature / pilot / etc.
  const stage1 = isScriptApprovedForProduction(meta, ptConfig);
  if (stage1.approved && state.stages.script_approved.status !== "approved") {
    state.stages.script_approved = {
      ...state.stages.script_approved,
      status: "approved",
      approvedAt: stage1.approvedAt ?? new Date().toISOString(),
      approvedBy: state.stages.script_approved.approvedBy ?? null,
    };
  }

  // Compute live statuses based on deps + deliverable satisfaction.
  state = computeLiveStatuses(state, deliverables);

  // Episode info.
  let episodeNumber: number | null = null;
  let episodeTitle: string | null = null;
  if (script.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number, title")
      .eq("id", script.episode_id)
      .maybeSingle();
    episodeNumber = (ep?.number as number | undefined) ?? null;
    episodeTitle = (ep?.title as string | null) ?? null;
  }

  // Current focus stage: first non-approved, non-locked stage.
  let currentStageKey: StageKey = "script_approved";
  for (const k of ALL_STAGE_KEYS) {
    if (state.stages[k].status === "approved") continue;
    currentStageKey = k;
    break;
  }

  return {
    scriptId,
    episodeNumber,
    episodeTitle,
    state,
    deliverables,
    currentStageKey,
  };
}

export async function patchWorkflow(args: {
  scriptId: string;
  patch: Partial<EpisodeWorkflowState>;
}): Promise<EpisodeWorkflowState> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", args.scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const meta = (script.metadata ?? {}) as Record<string, unknown>;
  const before =
    (meta.episodeWorkflow as EpisodeWorkflowState | undefined) ?? emptyState();
  const next: EpisodeWorkflowState = {
    ...before,
    ...args.patch,
    stages: { ...before.stages, ...(args.patch.stages ?? {}) },
    roleAssignments: {
      ...before.roleAssignments,
      ...(args.patch.roleAssignments ?? {}),
    },
    updatedAt: new Date().toISOString(),
  };
  meta.episodeWorkflow = next;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", args.scriptId);
  return next;
}

export async function approveStage(args: {
  scriptId: string;
  stageKey: StageKey;
  actorId: string;
  /** Override blocking review-stage gates (Showrunner/Admin only —
   *  enforcement of role-restriction is a TODO once roles ship; today
   *  the frontend hides it behind a stern confirm). Has no effect on
   *  the canon 80% gate. */
  force?: boolean;
}): Promise<EpisodeWorkflowState> {
  const before = await getWorkflowReport(args.scriptId);
  const stage = before.state.stages[args.stageKey];
  if (!stage) throw new Error(`Unknown stage: ${args.stageKey}`);
  if (stage.status === "locked")
    throw new Error(`Stage ${args.stageKey} is locked — finish dependencies first.`);
  // Stage 7 (B) — gate stage advance on per-stage approval ratio. Only
  // creative stages have a non-zero gate (see STAGE_APPROVAL_GATE).
  const prog = stage.approvalProgress;
  if (prog && !prog.meetsGate) {
    const pct = Math.round(prog.requiredRatio * 100);
    throw new Error(
      `Stage gate not met: ${prog.approved}/${prog.approveable} deliverables approved as canon (need ${pct}%). Approve more deliverables, then try again.`
    );
  }
  // Review-stage gates — Continuity / Preflight / Prompt Supervisor
  // cannot be approved if they have unresolved blocking issues. The
  // override (force=true) bypasses these and is recorded in metadata.
  if (!args.force) {
    const review = await computeReviewStageGate(args.scriptId, args.stageKey);
    if (review && review.blockers.length > 0) {
      throw new Error(
        `${labelForStage(args.stageKey)} cannot be approved yet: ${review.blockers.join(" · ")}. Resolve the blocking issues, or have a Showrunner Override and approve anyway.`
      );
    }
  } else {
    // Audit the override on script.metadata for traceability.
    await recordStageOverride(args.scriptId, args.stageKey, args.actorId);
  }
  const newStage: StageState = {
    ...stage,
    status: "approved",
    approvedBy: args.actorId,
    approvedAt: new Date().toISOString(),
    changesRequestedAt: null,
    changesRequestedNotes: null,
  };
  return patchWorkflow({
    scriptId: args.scriptId,
    patch: { stages: { [args.stageKey]: newStage } as Record<StageKey, StageState> },
  });
}

export async function requestStageChanges(args: {
  scriptId: string;
  stageKey: StageKey;
  actorId: string;
  notes?: string;
}): Promise<EpisodeWorkflowState> {
  const before = await getWorkflowReport(args.scriptId);
  const stage = before.state.stages[args.stageKey];
  if (!stage) throw new Error(`Unknown stage: ${args.stageKey}`);
  const newStage: StageState = {
    ...stage,
    status: "in_progress",
    approvedBy: null,
    approvedAt: null,
    changesRequestedAt: new Date().toISOString(),
    changesRequestedNotes: args.notes ?? null,
  };
  return patchWorkflow({
    scriptId: args.scriptId,
    patch: { stages: { [args.stageKey]: newStage } as Record<StageKey, StageState> },
  });
}

export async function setRoleAssignment(args: {
  scriptId: string;
  roleKey: RoleKey;
  patch: Partial<RoleAssignment>;
}): Promise<EpisodeWorkflowState> {
  const before = await getWorkflowReport(args.scriptId);
  const prev = before.state.roleAssignments[args.roleKey] ?? DEFAULT_ROLE_ASSIGNMENT(args.roleKey);
  const next: RoleAssignment = {
    ...prev,
    ...args.patch,
    updatedAt: new Date().toISOString(),
  };
  if (next.assignmentType && next.assignmentType !== "ai_generic") {
    if (next.assignmentType === "ai_influence" && !next.influenceKey)
      next.status = "unassigned";
    else if (next.assignmentType === "live_person" && !next.assigneeUserId)
      next.status = "unassigned";
    else next.status = "assigned";
  } else {
    next.status = "assigned"; // AI Generic is auto-assigned
  }
  return patchWorkflow({
    scriptId: args.scriptId,
    patch: {
      roleAssignments: { [args.roleKey]: next } as Record<RoleKey, RoleAssignment>,
    },
  });
}

export async function confirmRolesAssigned(args: {
  scriptId: string;
  actorId: string;
}): Promise<EpisodeWorkflowState> {
  const before = await getWorkflowReport(args.scriptId);
  // Move Stage 2 to approved.
  const next = await approveStage({
    scriptId: args.scriptId,
    stageKey: "roles_assigned",
    actorId: args.actorId,
  });
  return patchWorkflow({
    scriptId: args.scriptId,
    patch: { rolesConfirmedAt: new Date().toISOString(), ...next } as Partial<EpisodeWorkflowState>,
  });
}

// ----- Deliverable derivation ------------------------------------------------

async function deriveDeliverables(
  projectId: string,
  scriptId: string,
  script: { project_id: string; episode_id: string | null; metadata: Record<string, unknown> },
  ptConfig?: ReturnType<typeof resolveProjectTypeConfig>
): Promise<Record<StageKey, StageDeliverable[]>> {
  const out: Record<StageKey, StageDeliverable[]> = {} as Record<StageKey, StageDeliverable[]>;
  for (const k of ALL_STAGE_KEYS) out[k] = [];

  const meta = script.metadata as Record<string, unknown>;
  const canon = await loadResolvedCanon(projectId);

  // Cached AI proposals (written by regenDeliverableProposal). When a
  // field has no human approval but has a cached AI proposal, surface
  // that as the current value so the writer sees what the AI suggested
  // without having to click Regenerate. Approve uses this value.
  const proposalCache = (meta.workflowAIProposals ?? {}) as Record<
    string,
    { value: string; generatedAt: string }
  >;
  const ctx: DeriveCtx = { canon, proposalCache };

  // ---------- Stage 1: Script approved ----------
  // Reads the project-type adapter so micro-drama uses
  // `microDramaApproval` + `chainSnapshot`, while prestige/mini/feature
  // use `draftApproval` + a single approval deliverable.
  const cfg =
    ptConfig ??
    resolveProjectTypeConfig(
      (await loadProjectMeta(projectId, "projectType")) as string | undefined,
      undefined
    );
  const stage1 = isScriptApprovedForProduction(meta, cfg);
  const spinePresent = isScriptSpinePresent(meta, cfg);
  out.script_approved = cfg.stage1Deliverables.map((d) => {
    if (d.key === "approval") {
      return {
        key: d.key,
        label: d.label,
        description: d.description,
        satisfied: stage1.approved,
        currentValue: stage1.approved ? "approved" : "pending",
      };
    }
    if (d.key === "chain") {
      const chain = meta.chainSnapshot as
        | { hook?: string; setup?: string; twist?: string; cliffhanger?: string }
        | undefined;
      return {
        key: d.key,
        label: d.label,
        description: d.description,
        satisfied: spinePresent,
        currentValue: chain?.hook ? "complete" : "missing",
      };
    }
    return {
      key: d.key,
      label: d.label,
      description: d.description,
      satisfied: false,
    };
  });

  // ---------- Stage 2: Roles ----------
  out.roles_assigned = ALL_ROLE_KEYS.map((r) => {
    const meta = ROLE_REGISTRY[r];
    return {
      key: r,
      label: meta.label,
      description: meta.responsibility,
      satisfied: false, // satisfied is set at stage level once the user confirms
    };
  });

  // Scope: which locations/props/episodes actually appear in THIS script's
  // scenes? Without this filter, the workflow shows EP02+ locations when
  // editing EP01 (etc.).
  const scope = await resolveScriptScope(scriptId, script.episode_id);

  // ---------- Stage 3: Production Design ----------
  const locBibles = (await loadProjectMeta(projectId, "locationBibles")) as Record<string, Record<string, unknown>>;
  const inScopeLocations = Object.entries(locBibles).filter(([key, bible]) =>
    locationInScope(key, bible, scope)
  );
  for (const [key, bible] of inScopeLocations) {
    const locName = (bible.name as string) || key;
    const arch = (bible.architecture as Record<string, string> | undefined) ?? {};
    out.production_design.push(
      mkDeliverable("locationIdentity_" + key, `${locName} — Location identity`, `locationBibles.${key}.architecture.locationIdentity`, arch.locationIdentity, ctx,"Production Designer decides what kind of room this is."),
      mkDeliverable("wallColor_" + key, `${locName} — Wall color`, `locationBibles.${key}.architecture.wallColor`, arch.wallColor, ctx,"The walls' base color and finish."),
      mkDeliverable("floorColor_" + key, `${locName} — Floor`, `locationBibles.${key}.architecture.floorColor`, arch.floorColor, ctx,"Floor color + material."),
      mkDeliverable("ceiling_" + key, `${locName} — Ceiling`, `locationBibles.${key}.architecture.ceiling`, arch.ceiling, ctx,"Ceiling treatment."),
    );
  }

  // ---------- Stage 4: Art Dept (set dressing) ----------
  for (const [key, bible] of inScopeLocations) {
    const locName = (bible.name as string) || key;
    const sd = (bible.setDressing as Record<string, unknown> | undefined) ?? {};
    const bedding = sd.bedding as Record<string, unknown> | undefined;
    if (bedding) {
      out.art_dept.push(
        mkDeliverable("comforter_" + key, `${locName} — Comforter`, `locationBibles.${key}.setDressing.bedding.comforterColor`, bedding.comforterColor as string | undefined, ctx,"Comforter color + material."),
        mkDeliverable("sheets_" + key, `${locName} — Sheets`, `locationBibles.${key}.setDressing.bedding.sheetColor`, bedding.sheetColor as string | undefined, ctx,"Sheet color."),
        mkDeliverable("pillows_" + key, `${locName} — Pillows`, `locationBibles.${key}.setDressing.bedding.pillowColors`, bedding.pillowColors as string | undefined, ctx,"Pillows count, color, condition."),
      );
    }
    out.art_dept.push(
      mkDeliverable("wallDecor_" + key, `${locName} — Wall décor rule`, `locationBibles.${key}.setDressing.wallDecor`, sd.wallDecor as string | undefined, ctx,"Whether wall art / mirrors / shelves appear."),
      mkDeliverable("clutter_" + key, `${locName} — Clutter level`, `locationBibles.${key}.setDressing.clutterLevel`, sd.clutterLevel as string | undefined, ctx,"Minimal / lived-in / cluttered."),
    );
  }

  // ---------- Stage 5: Props ----------
  const propBibles = (await loadProjectMeta(projectId, "propBibles")) as Record<string, Record<string, unknown>>;
  for (const [key, prop] of Object.entries(propBibles)) {
    if (!propInScope(prop, scope)) continue;
    const name = (prop.name as string) || key;
    out.props.push(
      mkDeliverable(
        "visualDetails_" + key,
        `${name} — Visual canon`,
        `propBibles.${key}.visualDetails`,
        prop.visualDetails as string | undefined,
        ctx,
        "How this prop must look across every shot."
      )
    );
  }

  // ---------- Stage 6: Wardrobe/HMU ----------
  const { data: chars } = await supabase
    .from("characters")
    .select("id, name, metadata")
    .eq("project_id", projectId);
  for (const c of chars ?? []) {
    const vb = ((c.metadata as { visualBible?: Record<string, unknown> })?.visualBible ?? {}) as Record<string, unknown>;
    const presence = vb.presenceType as string | undefined;
    if (presence === "voice_only" || presence === "text_only") continue;
    const wbe = (vb.wardrobeByEpisode as Record<string, Record<string, unknown>> | undefined) ?? {};
    const hbe = (vb.hmuByEpisode as Record<string, Record<string, unknown>> | undefined) ?? {};
    const epFilter = (epStr: string) =>
      scope.episodeNumber == null || Number(epStr) === scope.episodeNumber;
    for (const [ep, w] of Object.entries(wbe)) {
      if (!epFilter(ep)) continue;
      out.wardrobe_hmu.push(
        mkDeliverable(
          `wardrobe_${c.id}_${ep}_top`,
          `${c.name} — EP${ep} top`,
          `characters.${c.id}.visualBible.wardrobeByEpisode.${ep}.top`,
          (w as Record<string, unknown>).top as string | undefined,
          ctx,
          "Primary garment."
        )
      );
    }
    for (const [ep, h] of Object.entries(hbe)) {
      if (!epFilter(ep)) continue;
      out.wardrobe_hmu.push(
        mkDeliverable(
          `hmu_${c.id}_${ep}_hair`,
          `${c.name} — EP${ep} hair`,
          `characters.${c.id}.visualBible.hmuByEpisode.${ep}.hairCondition`,
          (h as Record<string, unknown>).hairCondition as string | undefined,
          ctx,
          "Hair state."
        )
      );
    }
  }

  // ---------- Stage 7: Blocking + Stage 8: Cinematography ----------
  // Per-shot canon deliverables. The Director sees each shot's start
  // position + eyeline; the DP sees each shot's framing + lens + view
  // zone. Each row is approve/regen-able like any other canon item, and
  // approved values write a textOverride keyed by the brief path so the
  // composer can honor it.
  const briefs = ((meta.aiPrompts as Record<string, unknown> | undefined)?.briefs as Record<string, Record<string, Record<string, unknown>>> | undefined) ?? {};
  const sceneSlugByOrd = new Map<number, string>();
  for (const tok of scope.locationTokens) {
    // Reuse the slug tokens we resolved earlier for location filtering.
    void tok;
  }
  // Look up slugs directly so we can label rows "SC01 — INT. MAYA'S BEDROOM".
  const { data: scenesForLabels } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", scriptId);
  for (const s of scenesForLabels ?? []) {
    sceneSlugByOrd.set(s.ord as number, (s.slugline as string | null) ?? "");
  }

  const epLabel = scope.episodeNumber != null
    ? `EP${String(scope.episodeNumber).padStart(2, "0")}`
    : "";

  const sortedBriefScenes = Object.keys(briefs)
    .map((k) => ({ key: k, ord: Number(k) }))
    .sort((a, b) => a.ord - b.ord);

  for (const { key: sceneKey, ord: sceneOrd } of sortedBriefScenes) {
    const byShot = briefs[sceneKey] ?? {};
    const sortedShots = Object.keys(byShot)
      .map((k) => ({ key: k, idx: parseShotIndex(k) }))
      .sort((a, b) => a.idx - b.idx);
    const slug = sceneSlugByOrd.get(sceneOrd) ?? "";
    const sceneLabel = [
      epLabel,
      `SC${String(sceneOrd + 1).padStart(2, "0")}`,
    ].filter(Boolean).join(" ") + (slug ? ` — ${slug}` : "");

    for (const { key: shotKey, idx: shotIndex } of sortedShots) {
      const brief = byShot[shotKey] as Record<string, unknown>;
      const shotLabel = `${[epLabel, `SC${String(sceneOrd + 1).padStart(2, "0")}`, `SH${String(shotIndex).padStart(2, "0")}`].filter(Boolean).join(" ")}`;
      const shotDesc = describeShotForRow(brief, sceneLabel);

      // Blocking — ONE complete Director's blocking brief per shot.
      // Covers start/end positions, movement path, eyeline, prop
      // handling. The Director approves the whole brief (or regens it)
      // rather than approving 5 separate fragments.
      const seedBlocking = assembleBlockingSeed(brief);
      out.blocking.push(
        mkDeliverable(
          `blk_${sceneOrd}_${shotIndex}`,
          `${shotLabel} — Director's blocking brief`,
          `shotBriefs.${sceneOrd}.${shotIndex}.directorBrief`,
          seedBlocking || undefined,
          ctx,
          shotDesc
        )
      );

      // Cinematography — ONE complete DP brief per shot. Covers aspect
      // ratio, framing, lens, exact camera position+angle, movement,
      // focus priority, lighting (source/direction/quality/contrast),
      // and what must remain out of frame. Stays in the DP's lane —
      // no set dressing, wardrobe, or performance notes.
      const seedDP = assembleDPSeed(brief);
      out.cinematography.push(
        mkDeliverable(
          `cin_${sceneOrd}_${shotIndex}`,
          `${shotLabel} — DP brief`,
          `shotBriefs.${sceneOrd}.${shotIndex}.dpBrief`,
          seedDP || undefined,
          ctx,
          shotDesc
        )
      );
    }
  }

  // Continuity pass
  const contPass = meta.continuity as { summary?: Record<string, { pass: number; warning: number; fail: number }> } | undefined;
  let contFails = 0;
  if (contPass?.summary) for (const v of Object.values(contPass.summary)) contFails += v.fail ?? 0;
  out.continuity.push({
    key: "continuity_clean",
    label: "Continuity pass — 0 failures",
    satisfied: !!contPass && contFails === 0,
    currentValue: contPass ? `${contFails} fails` : "not yet run",
  });

  // Prompts persisted
  const prompts = (((meta.aiPrompts as Record<string, unknown>)?.prompts as Record<string, Record<string, Record<string, { current?: { mainPrompt?: string; readiness?: { ok?: boolean } } }>>>) ?? {});
  let totalPrompts = 0;
  let readyPrompts = 0;
  for (const byShot of Object.values(prompts)) {
    for (const byModel of Object.values(byShot ?? {})) {
      for (const slot of Object.values(byModel ?? {})) {
        totalPrompts++;
        if (slot.current?.readiness?.ok) readyPrompts++;
      }
    }
  }
  out.prompt_supervisor.push({
    key: "prompts_generated",
    label: "Prompts generated for every brief",
    satisfied: totalPrompts > 0 && readyPrompts === totalPrompts,
    currentValue: `${readyPrompts}/${totalPrompts} ready`,
  });

  // Preflight
  try {
    const pre = await runPreflight(scriptId);
    out.preflight.push({
      key: "preflight_ready",
      label: "Preflight overall: ready",
      satisfied: pre.allowPromptGeneration,
      currentValue: pre.overall,
    });
  } catch (_) {
    out.preflight.push({
      key: "preflight_ready",
      label: "Preflight overall: ready",
      satisfied: false,
      currentValue: "error",
    });
  }

  // Generate stage gates on Preflight
  out.generate.push({
    key: "generate_allowed",
    label: "All gates pass — clip generation allowed",
    satisfied: false, // computed live in computeLiveStatuses
    currentValue: "—",
  });

  return out;
}

interface DeriveCtx {
  canon: {
    approvedFields: Set<string>;
    textOverrides: Map<string, { value: string; approvedBy: string; approvedAt: string }>;
  };
  proposalCache: Record<string, { value: string; generatedAt: string }>;
}

function mkDeliverable(
  key: string,
  label: string,
  canonFieldPath: string,
  value: string | undefined,
  ctx: DeriveCtx,
  description: string
): StageDeliverable {
  const { canon, proposalCache } = ctx;
  const hasApproved = canon.approvedFields.has(canonFieldPath);
  const textOverride = canon.textOverrides.get(canonFieldPath);
  const cachedProposal = proposalCache[canonFieldPath];
  const hasApprovedCanon = !!textOverride;
  const hasValue = !!(value && value.trim());
  const hasAIProposal =
    !!(cachedProposal?.value && cachedProposal.value.trim());
  // The "current value" the UI should show, in priority order:
  //   1. Human-approved textOverride (locked verbatim)
  //   2. Cached AI proposal (from regen / auto-propose)
  //   3. Raw bible value (whatever was extracted upstream)
  const display =
    (textOverride?.value && textOverride.value.trim()) ||
    (cachedProposal?.value && cachedProposal.value.trim()) ||
    value ||
    undefined;
  return {
    key,
    label,
    description,
    canonFieldPath,
    satisfied: hasValue || hasApproved || hasAIProposal,
    hasApprovedCanon,
    hasAIProposal,
    currentValue: display,
  };
}

interface ScriptScope {
  episodeNumber: number | null;
  locationTokens: Set<string>;
}

function normalizeSlugToken(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

async function resolveScriptScope(
  scriptId: string,
  episodeId: string | null
): Promise<ScriptScope> {
  let episodeNumber: number | null = null;
  if (episodeId) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", episodeId)
      .maybeSingle();
    episodeNumber = (ep?.number as number | undefined) ?? null;
  }
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("slugline, location")
    .eq("script_id", scriptId);
  const locationTokens = new Set<string>();
  for (const s of scenes ?? []) {
    const slug = (s.slugline as string | null) ?? "";
    const loc = (s.location as string | null) ?? "";
    if (slug) locationTokens.add(normalizeSlugToken(slug.split(" - ")[0] || slug));
    if (loc) locationTokens.add(normalizeSlugToken(loc));
  }
  return { episodeNumber, locationTokens };
}

function locationInScope(
  key: string,
  bible: Record<string, unknown>,
  scope: ScriptScope
): boolean {
  // If we have no scene data at all, don't filter (avoid empty deliverables).
  if (scope.locationTokens.size === 0) return true;
  const nameTok = normalizeSlugToken((bible.name as string) || key);
  // Match if any scene's slugline/location contains the bible's name tokens
  // (or vice versa). This handles "INT. MAYA'S BEDROOM" matching a bible
  // named "MAYA'S BEDROOM" or "Maya's Bedroom".
  for (const tok of scope.locationTokens) {
    if (tok === nameTok) return true;
    if (tok.includes(nameTok) && nameTok.length >= 4) return true;
    if (nameTok.includes(tok) && tok.length >= 4) return true;
  }
  return false;
}

function parseShotIndex(key: string): number {
  const m = key.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/** Seed a Director's blocking brief from whatever the production
 *  pipeline already wrote on the shot. Used as the row's currentValue
 *  before the Director hits Regenerate (which will rewrite via the
 *  specialized blocking prompt). Empty string means "nothing yet —
 *  user should regen / approve once the AI proposes." */
function assembleBlockingSeed(brief: Record<string, unknown>): string {
  const parts: string[] = [];
  const start = (brief.characterStartPosition as string | undefined)?.trim();
  const end = (brief.characterEndPosition as string | undefined)?.trim();
  const path = (brief.movementPath as string | undefined)?.trim();
  const eye = (brief.eyelineTarget as string | undefined)?.trim();
  // propPositions is normally a Record<string, unknown>, but older briefs
  // (and a few in EP01) wrote it as a single string. Without this guard,
  // `Object.entries("Clock on …")` iterated the chars and produced
  // "Prop handling: 0: C; 1: l; 2: o; …" garbage downstream. Handle both
  // shapes safely — plain string, structured object, or unset.
  const propsRaw = brief.propPositions as
    | string
    | Record<string, unknown>
    | undefined
    | null;
  if (start) parts.push(`Start position: ${start}`);
  if (end) parts.push(`End position: ${end}`);
  if (path) parts.push(`Movement path: ${path}`);
  if (eye) parts.push(`Eyeline target: ${eye}`);
  if (typeof propsRaw === "string") {
    const s = propsRaw.trim();
    if (s) parts.push(`Prop handling: ${s}`);
  } else if (
    propsRaw &&
    typeof propsRaw === "object" &&
    !Array.isArray(propsRaw) &&
    Object.keys(propsRaw).length > 0
  ) {
    const propStr = Object.entries(propsRaw)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join("; ");
    parts.push(`Prop handling: ${propStr}`);
  } else if (Array.isArray(propsRaw) && propsRaw.length > 0) {
    parts.push(`Prop handling: ${propsRaw.map((v) => String(v)).join("; ")}`);
  }
  return parts.join("\n");
}

/** Seed a DP brief from existing brief fields. The regen pass will
 *  rewrite this into the full DP brief format. */
function assembleDPSeed(brief: Record<string, unknown>): string {
  const parts: string[] = [];
  const ar = (brief.aspectRatio as string | undefined)?.trim();
  const framing = ((brief.frame as string | undefined) ?? (brief.cameraFraming as string | undefined))?.trim();
  const lens = (brief.lensSuggestion as string | undefined)?.trim();
  const view = (brief.cameraViewZone as string | undefined)?.trim();
  const move = (brief.cameraMovement as string | undefined)?.trim();
  const lighting = (brief.lightingContinuity as string | undefined)?.trim()
    ?? (brief.lighting as string | undefined)?.trim();
  const forbidden = brief.forbiddenSetElements as string[] | undefined;
  if (ar) parts.push(`Aspect ratio: ${ar}`);
  if (framing) parts.push(`Framing: ${framing}`);
  if (lens) parts.push(`Lens: ${lens}`);
  if (view) parts.push(`Camera position / view zone: ${view}`);
  if (move) parts.push(`Camera movement: ${move}`);
  if (lighting) parts.push(`Lighting: ${lighting}`);
  if (forbidden && forbidden.length > 0) {
    parts.push(`Out-of-frame: ${forbidden.join(", ")}`);
  }
  return parts.join("\n");
}

/** Build a short "context line" for a per-shot deliverable so the row's
 *  description tells the Director / DP what shot they're approving. */
function describeShotForRow(brief: Record<string, unknown>, sceneLabel: string): string {
  const action = (brief.actionDescription as string | undefined)
    || (brief.action as string | undefined)
    || (brief.shotAction as string | undefined);
  const primary = brief.primaryImage as string | undefined;
  const pieces = [sceneLabel];
  if (action && action.trim()) pieces.push(action.trim().slice(0, 120));
  else if (primary && primary.trim()) pieces.push(primary.trim().slice(0, 120));
  return pieces.join(" · ");
}

function propInScope(prop: Record<string, unknown>, scope: ScriptScope): boolean {
  if (scope.episodeNumber == null) return true;
  const eps = prop.episodesPresent as number[] | undefined;
  if (!Array.isArray(eps) || eps.length === 0) return true;
  return eps.includes(scope.episodeNumber);
}

async function loadProjectMeta(projectId: string, field: string): Promise<unknown> {
  const { data } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  return (meta[field] ?? {}) as unknown;
}

// ----- Live status compute --------------------------------------------------

/** Stage 7 (B) — fraction of canon-bearing deliverables that must have a
 *  human textOverride before the user can advance the stage. Set per stage
 *  so non-creative stages (script_approved, generate, etc.) aren't gated
 *  on canon approval. Threshold of 0 means "always passes." */
const STAGE_APPROVAL_GATE: Record<StageKey, number> = {
  script_approved: 0,
  roles_assigned: 0,
  production_design: 0.8,
  art_dept: 0.8,
  props: 0.8,
  wardrobe_hmu: 0.8,
  blocking: 0.8,
  cinematography: 0.8,
  continuity: 0,
  prompt_supervisor: 0,
  preflight: 0,
  generate: 0,
};

function computeStageApprovalProgress(
  stageKey: StageKey,
  deliverables: StageDeliverable[]
): NonNullable<StageState["approvalProgress"]> {
  const approveable = deliverables.filter((d) => !!d.canonFieldPath);
  const approved = approveable.filter((d) => d.hasApprovedCanon);
  const requiredRatio = STAGE_APPROVAL_GATE[stageKey] ?? 0;
  const ratio = approveable.length === 0 ? 1 : approved.length / approveable.length;
  return {
    approved: approved.length,
    approveable: approveable.length,
    requiredRatio,
    meetsGate: ratio >= requiredRatio,
  };
}

/** Compute review-stage advance gate. Returns blockers (must be
 *  resolved before approval) and warnings (advisory; user may approve
 *  with confirm). Returns null for stages that aren't review-gated. */
export async function computeReviewStageGate(
  scriptId: string,
  stageKey: StageKey
): Promise<{ blockers: string[]; warnings: string[] } | null> {
  if (stageKey === "continuity") {
    const { data: script } = await supabase
      .from("scripts")
      .select("metadata")
      .eq("id", scriptId)
      .single();
    const meta = (script?.metadata ?? {}) as Record<string, unknown>;
    const cont = meta.continuity as
      | { summary?: Record<string, { fail: number; warning: number }>; runAt?: string }
      | undefined;
    const manualFindings = (meta.continuityManualFindings ?? []) as Array<{
      severity: string;
    }>;
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!cont || !cont.runAt) {
      blockers.push("Run continuity pass before approving");
      return { blockers, warnings };
    }
    let fails = 0;
    let warns = 0;
    for (const v of Object.values(cont.summary ?? {})) {
      fails += v.fail ?? 0;
      warns += v.warning ?? 0;
    }
    for (const m of manualFindings) {
      if (m.severity === "fail") fails++;
      else if (m.severity === "warning") warns++;
    }
    if (fails > 0) {
      blockers.push(
        `${fails} continuity ${fails === 1 ? "issue" : "issues"} requiring fixes`
      );
    }
    if (warns > 0) {
      warnings.push(
        `${warns} continuity ${warns === 1 ? "warning" : "warnings"}`
      );
    }
    return { blockers, warnings };
  }
  if (stageKey === "preflight") {
    const blockers: string[] = [];
    const warnings: string[] = [];
    try {
      const pre = await runPreflight(scriptId);
      if (pre.overall === "fail") {
        blockers.push(
          "Preflight is blocking — one or more departments report fail"
        );
      } else if (pre.overall === "missing") {
        blockers.push(
          "Preflight has not been fully set up — some departments are unconfigured"
        );
      } else if (pre.overall === "partial") {
        warnings.push(
          "Preflight is partial — some departments still need attention"
        );
      }
    } catch (err) {
      blockers.push(`Preflight could not run: ${(err as Error).message}`);
    }
    return { blockers, warnings };
  }
  if (stageKey === "prompt_supervisor") {
    const { data: script } = await supabase
      .from("scripts")
      .select("metadata")
      .eq("id", scriptId)
      .single();
    const meta = (script?.metadata ?? {}) as Record<string, unknown>;
    const prompts = (((meta.aiPrompts as Record<string, unknown> | undefined)
      ?.prompts as
      | Record<string, Record<string, Record<string, { current?: { readiness?: { ok?: boolean } } }>>>
      | undefined) ?? {});
    let total = 0;
    let ready = 0;
    for (const byShot of Object.values(prompts)) {
      for (const byModel of Object.values(byShot ?? {})) {
        for (const slot of Object.values(byModel ?? {})) {
          total++;
          if (slot?.current?.readiness?.ok) ready++;
        }
      }
    }
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (total === 0) {
      blockers.push("No prompts have been generated yet");
    } else if (ready < total) {
      blockers.push(
        `${total - ready} of ${total} prompts are not ready`
      );
    }
    return { blockers, warnings };
  }
  return null;
}

function labelForStage(stageKey: StageKey): string {
  const labels: Record<StageKey, string> = {
    script_approved: "Script Approved",
    roles_assigned: "Assign Roles",
    production_design: "Production Design",
    art_dept: "Art Direction",
    props: "Props",
    wardrobe_hmu: "Wardrobe / HMU",
    blocking: "Blocking",
    cinematography: "Cinematography",
    continuity: "Continuity",
    prompt_supervisor: "Prompt Supervisor",
    preflight: "Preflight",
    generate: "Generate",
  };
  return labels[stageKey];
}

async function recordStageOverride(
  scriptId: string,
  stageKey: StageKey,
  actorId: string
): Promise<void> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  if (!script) return;
  const meta = (script.metadata ?? {}) as Record<string, unknown>;
  const log = ((meta.stageOverrides as Array<unknown> | undefined) ?? []) as Array<
    Record<string, unknown>
  >;
  log.push({
    stageKey,
    actorId,
    overriddenAt: new Date().toISOString(),
  });
  meta.stageOverrides = log;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);
}

function computeLiveStatuses(
  state: EpisodeWorkflowState,
  deliverables: Record<StageKey, StageDeliverable[]>
): EpisodeWorkflowState {
  for (const k of ALL_STAGE_KEYS) {
    const deps = STAGE_DEPS[k];
    const blockedBy: StageKey[] = [];
    for (const d of deps) if (state.stages[d].status !== "approved") blockedBy.push(d);
    const dels = deliverables[k] ?? [];
    const allSatisfied = dels.length > 0 && dels.every((d) => d.satisfied);
    const someSatisfied = dels.some((d) => d.satisfied);
    const wasApproved = state.stages[k].status === "approved";
    const approvalProgress = computeStageApprovalProgress(k, dels);
    let status: StageState["status"];
    if (blockedBy.length > 0) status = "locked";
    else if (wasApproved) status = "approved";
    else if (allSatisfied) status = "in_progress"; // ready to be Approved by the user
    else if (someSatisfied) status = "in_progress";
    else status = "available";
    state.stages[k] = { ...state.stages[k], status, blockedBy, approvalProgress };
  }
  return state;
}
