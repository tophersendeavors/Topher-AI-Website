import { supabase } from "../db/client.js";
import { config } from "../config.js";
import { runAgent } from "../agents/runner.js";
import { behaviorAgent } from "../agents/behavior.js";
import { subtextAgent } from "../agents/subtext.js";
import { emotionalTruthAgent } from "../agents/emotionalTruth.js";
import { relationshipTensionAgent } from "../agents/relationshipTension.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { postRoomMessage } from "../orchestrator/room.js";
import { validateSceneDirectness } from "../screenplay/emotionalValidator.js";
import type {
  AgentRole,
  DirectnessViolation,
  SceneEmotionalState,
} from "@toburt/shared";

/**
 * Run the full Emotional Intelligence pass for a single scene.
 *
 * Sequence:
 *   1. Behavior agent     — translate stated emotions into actions/silences.
 *   2. Subtext agent      — rewrite remaining on-the-nose dialogue.
 *   3. Emotional Truth    — score & produce the SceneEmotionalState.
 *   4. Relationship Tension (if a relationship is in play) — power/relationship shift.
 *   5. Directness validator — heuristic gate; rejects if too direct.
 *   6. Persist SceneEmotionalState (latest, supersedes prior).
 */
export interface RunSceneEIInput {
  projectId: string;
  scriptId: string;
  sceneId: string;
  sceneFountain: string;
  characters?: string[];
  relationshipId?: string;
  workflowId?: string;
  userId?: string;
}

export interface RunSceneEIResult {
  state: SceneEmotionalState;
  rejected: boolean;
  rejectionReason?: string;
  violations: DirectnessViolation[];
  rewrittenFountain: string;
  truthScore?: number;
}

export async function runSceneEmotionalPass(
  input: RunSceneEIInput
): Promise<RunSceneEIResult> {
  const { projectId, scriptId, sceneId, sceneFountain } = input;

  // Stylistic flag.
  const { data: project } = await supabase
    .from("projects")
    .select("allow_stylistic_directness")
    .eq("id", projectId)
    .maybeSingle();
  const allowStylistic = project?.allow_stylistic_directness ?? false;

  // 1. Behavior pass.
  const behaviorCtx = await hydrateContext({
    projectId,
    workflowId: input.workflowId,
    stage: "draft_v1",
    collaborators: [
      "behavior",
      "subtext",
      "emotional_truth",
      "relationship_tension",
    ] as AgentRole[],
    query: sceneFountain.slice(0, 800),
    user: input.userId ? { id: input.userId } : undefined,
  });
  const behaviorRun = await runAgent(behaviorAgent, {
    sceneFountain,
    characters: input.characters ?? [],
    replaceStatedEmotion: true,
  }, behaviorCtx);

  // 2. Subtext pass over the behavior-translated scene.
  const subtextRun = await runAgent(subtextAgent, {
    sceneFountain: behaviorRun.output.fountain,
    characters: input.characters ?? [],
    preferAction: true,
  }, behaviorCtx);

  const rewritten = subtextRun.output.fountain;

  // 3. Emotional truth report on the rewritten scene.
  const truthRun = await runAgent(emotionalTruthAgent, {
    sceneFountain: rewritten,
    characters: input.characters ?? [],
    scriptId,
    allowStylistic,
  }, behaviorCtx);

  let state: SceneEmotionalState = {
    ...truthRun.output.state,
    sceneRef: sceneId,
    truthScore: truthRun.output.truthScore,
  };

  // 4. Relationship Tension if applicable.
  if (input.relationshipId) {
    const relRun = await runAgent(relationshipTensionAgent, {
      intent: "scene_pass",
      relationshipId: input.relationshipId,
      sceneFountain: rewritten,
    }, behaviorCtx);
    if (relRun.output.sceneEffect) {
      state = {
        ...state,
        powerShift: relRun.output.sceneEffect.powerShift,
        relationshipShift: relRun.output.sceneEffect.relationshipShift,
      };
    }
  }

  // 5. Directness validator (heuristic, deterministic).
  const validatorReport = validateSceneDirectness(rewritten, {
    rejectionThreshold: config.EMOTIONAL_REJECTION_THRESHOLD,
    allowStylistic,
  });
  state = { ...state, directnessViolations: validatorReport.violations };

  // Merge LLM rejections with validator output for the final reject decision.
  const llmCritical = truthRun.output.rejections.filter(
    (r) => r.severity === "critical"
  ).length;
  const validatorCritical = validatorReport.violations.filter(
    (v) => v.severity === "critical"
  ).length;
  const rejected =
    !allowStylistic &&
    (validatorReport.shouldReject ||
      llmCritical > config.EMOTIONAL_REJECTION_THRESHOLD);

  const rejectionReason = rejected
    ? `Scene explains emotion too directly — ${validatorCritical} validator critical + ${llmCritical} LLM critical violation(s).`
    : undefined;

  // 6. Persist as a new "current" revision, demoting any prior current.
  const { data: prior } = await supabase
    .from("scene_emotional_states")
    .select("id, version")
    .eq("scene_id", sceneId)
    .eq("current", true)
    .maybeSingle();

  if (prior) {
    const { error: demoteErr } = await supabase
      .from("scene_emotional_states")
      .update({ current: false })
      .eq("id", prior.id);
    if (demoteErr) throw demoteErr;
  }

  const insertPayload = {
    project_id: projectId,
    script_id: scriptId,
    scene_id: sceneId,
    emotional_entry_state: state.emotionalEntryState,
    emotional_exit_state: state.emotionalExitState,
    hidden_want: state.hiddenWant,
    visible_want: state.visibleWant,
    fear: state.fear,
    contradiction: state.contradiction,
    subtext: state.subtext,
    behavioral_tells: state.behavioralTells,
    power_shift: state.powerShift,
    relationship_shift: state.relationshipShift,
    truth_score: state.truthScore ?? null,
    directness_violations: state.directnessViolations,
    rejected,
    rejection_reason: rejectionReason ?? null,
    authored_by: input.userId ?? null,
    authored_role: "emotional_truth",
    version: (prior?.version ?? 0) + 1,
    supersedes_id: prior?.id ?? null,
    current: true,
  };

  const { error } = await supabase
    .from("scene_emotional_states")
    .insert(insertPayload);
  if (error) {
    // Roll back the demotion if the insert failed so the prior row is still
    // queryable as `current`.
    if (prior) {
      await supabase
        .from("scene_emotional_states")
        .update({ current: true })
        .eq("id", prior.id);
    }
    throw error;
  }

  // 7. Post a critique to the room if rejected.
  if (rejected) {
    await postRoomMessage({
      projectId,
      workflowId: input.workflowId ?? null,
      stageId: "draft_v1",
      authorKind: "agent",
      authorRole: "emotional_truth",
      kind: "critique",
      body: rejectionReason ?? "Scene rejected for direct emotional explanation.",
      payload: {
        sceneId,
        violations: state.directnessViolations,
        llmRejections: truthRun.output.rejections,
      },
    });

    // Also file a continuity-channel flag so the Continuity page shows it.
    await supabase.from("continuity_issues").insert({
      project_id: projectId,
      script_id: scriptId,
      kind: "emotional_directness",
      severity: "critical",
      scene_ids: [sceneId],
      note: rejectionReason!,
      suggested_fix:
        "Run the Subtext + Behavior agents again, or set allow_stylistic_directness on the project.",
    });
  }

  return {
    state,
    rejected,
    rejectionReason,
    violations: state.directnessViolations,
    rewrittenFountain: rewritten,
    truthScore: state.truthScore,
  };
}

/** Run the EI pass for every scene in a script. */
export async function runScriptEmotionalPass(args: {
  projectId: string;
  scriptId: string;
  userId?: string;
  workflowId?: string;
}): Promise<RunSceneEIResult[]> {
  const { data: scenes, error } = await supabase
    .from("script_scenes")
    .select("id, ord, fountain, characters")
    .eq("script_id", args.scriptId)
    .order("ord", { ascending: true });
  if (error) throw error;

  const results: RunSceneEIResult[] = [];
  for (const s of scenes ?? []) {
    const r = await runSceneEmotionalPass({
      projectId: args.projectId,
      scriptId: args.scriptId,
      sceneId: s.id,
      sceneFountain: s.fountain ?? "",
      characters: s.characters ?? [],
      userId: args.userId,
      workflowId: args.workflowId,
    });
    results.push(r);
  }
  return results;
}
