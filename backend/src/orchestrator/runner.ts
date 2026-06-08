import { supabase } from "../db/client.js";
import { nextStage } from "./graph.js";
import { getStage } from "./stages/index.js";
import { materializeEpisodesFromArc, loadSeasonFoundationArtifacts } from "./episodes.js";
import type { Stage, StageContext } from "./types.js";
import type { SeasonArc, WorkflowStageId, WorkflowStageStatus } from "@toburt/shared";

/**
 * Execute the current stage of a workflow. Persists artifact + checkpoint and
 * advances the workflow status. Approval-gated stages pause and require
 * `resumeWorkflow` after approval.
 */
export async function advanceWorkflow(
  workflowId: string,
  opts: { prompt?: string; userId?: string; revisionNote?: string } = {}
) {
  const { data: wf, error } = await supabase
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .maybeSingle();
  if (error) throw error;
  if (!wf) throw new Error("workflow not found");

  // Block on pending approvals.
  const { data: pending } = await supabase
    .from("approvals")
    .select("id")
    .eq("workflow_id", workflowId)
    .eq("status", "pending");
  if (pending && pending.length > 0) {
    return { status: "awaiting_approval" as const, pendingApprovals: pending };
  }

  const stageId = wf.current_stage as WorkflowStageId;
  const stage = getStage(stageId);

  await setStatus(workflowId, "running");

  // Load previous artifacts (top revision per stage_id) so the runner has the
  // full context for this stage. For an EPISODE workflow, also merge in the
  // Season workflow's foundation (treatment + season_arc) so episode stages can
  // read them — the episode workflow's own artifacts take precedence.
  let previousArtifacts = await loadAllArtifacts(workflowId);
  let episodeId: string | undefined;
  let episodeNumber: number | undefined;
  if (wf.episode_id) {
    const foundation = await loadSeasonFoundationArtifacts(wf.project_id);
    previousArtifacts = { ...foundation, ...previousArtifacts };
    episodeId = wf.episode_id as string;
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", wf.episode_id)
      .maybeSingle();
    episodeNumber = (ep?.number as number) ?? undefined;
  }

  const ctx: StageContext = {
    projectId: wf.project_id,
    workflowId,
    stage: stageId,
    user: opts.userId ? { id: opts.userId } : undefined,
    previousArtifacts,
    prompt: opts.prompt,
    revisionNote: opts.revisionNote,
    episodeId,
    episodeNumber,
  };

  let result;
  try {
    result = await stage.run(ctx);
  } catch (err) {
    await setStatus(workflowId, "rejected");
    throw err;
  }

  // Validate output.
  stage.outputSchema.parse(result.artifact);

  // Persist artifact.
  const revision = (await topRevision(workflowId, stageId)) + 1;
  const { data: art, error: artErr } = await supabase
    .from("workflow_stage_artifacts")
    .insert({
      workflow_id: workflowId,
      stage_id: stageId,
      revision,
      body: result.artifact as object,
      created_by: opts.userId ?? null,
    })
    .select("*")
    .single();
  if (artErr) throw artErr;

  // Stage row + checkpoint.
  await supabase.from("workflow_stages").insert({
    workflow_id: workflowId,
    stage_id: stageId,
    status: result.awaitingApproval ? "awaiting_approval" : "completed",
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    artifact_id: art.id,
  });
  await supabase.from("workflow_checkpoints").insert({
    workflow_id: workflowId,
    stage_id: stageId,
    state: { previousArtifacts, currentStage: stageId, revision },
    artifact_id: art.id,
  });

  if (result.awaitingApproval) {
    await supabase.from("approvals").insert({
      project_id: wf.project_id,
      workflow_id: workflowId,
      stage_id: stageId,
      target_kind: "artifact",
      target_id: art.id,
      payload: { stageId, revision },
      requested_by: "system",
    });
    await setStatus(workflowId, "awaiting_approval");
    return { status: "awaiting_approval" as const, artifactId: art.id };
  }

  // Auto-advance.
  const next = nextStage(stageId);
  if (!next) {
    await setStatus(workflowId, "completed", stageId);
    return { status: "completed" as const, artifactId: art.id };
  }
  await supabase
    .from("workflows")
    .update({ current_stage: next, status: "pending" })
    .eq("id", workflowId);
  return { status: "advanced" as const, nextStage: next, artifactId: art.id };
}

async function setStatus(id: string, status: WorkflowStageStatus, stage?: WorkflowStageId) {
  const update: Record<string, unknown> = { status };
  if (stage) update.current_stage = stage;
  await supabase.from("workflows").update(update).eq("id", id);
}

async function topRevision(workflowId: string, stageId: WorkflowStageId): Promise<number> {
  const { data } = await supabase
    .from("workflow_stage_artifacts")
    .select("revision")
    .eq("workflow_id", workflowId)
    .eq("stage_id", stageId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.revision ?? 0;
}

async function loadAllArtifacts(workflowId: string): Promise<Record<string, unknown>> {
  const { data } = await supabase
    .from("workflow_stage_artifacts")
    .select("stage_id, revision, body")
    .eq("workflow_id", workflowId)
    .order("revision", { ascending: false });
  const out: Record<string, unknown> = {};
  for (const row of data ?? []) {
    if (!(row.stage_id in out)) out[row.stage_id] = row.body;
  }
  return out;
}

/**
 * Resolve a pending approval (approve | reject | revise). When approved, the
 * workflow is auto-advanced to the next stage. When rejected, the workflow is
 * marked rejected; the user can restart the stage with a fresh prompt.
 */
export async function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected" | "revised",
  by: string,
  rationale?: string
) {
  const { data: app, error } = await supabase
    .from("approvals")
    .update({
      status: decision,
      decided_by: by,
      decided_at: new Date().toISOString(),
      rationale: rationale ?? null,
    })
    .eq("id", approvalId)
    .select("*")
    .single();
  if (error) throw error;

  if (!app.workflow_id) return { status: "ok" as const };

  if (decision === "approved") {
    const stageId = app.stage_id as WorkflowStageId | null;
    const { data: wf } = await supabase
      .from("workflows")
      .select("*")
      .eq("id", app.workflow_id)
      .single();
    if (wf && stageId === "season_arc" && !wf.episode_id) {
      // Season foundation approved: materialize episodes from the arc and STOP
      // the Season workflow here. Each episode is developed in its own
      // episode-scoped workflow (on demand), not by advancing this one.
      const { data: art } = await supabase
        .from("workflow_stage_artifacts")
        .select("body")
        .eq("workflow_id", wf.id)
        .eq("stage_id", "season_arc")
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      const arc = art?.body as SeasonArc | undefined;
      if (arc) {
        try {
          await materializeEpisodesFromArc(wf.project_id, arc);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[season_arc] episode materialization failed", e);
        }
      }
      await setStatus(wf.id, "completed", "season_arc");
    } else if (wf && stageId) {
      const next = nextStage(stageId);
      if (next) {
        await supabase
          .from("workflows")
          .update({ current_stage: next, status: "pending" })
          .eq("id", wf.id);
      } else {
        await setStatus(wf.id, "completed", stageId);
      }
    }
  } else if (decision === "rejected") {
    await setStatus(app.workflow_id, "rejected");
  }

  return { status: "ok" as const };
}

export type { Stage, StageContext };
