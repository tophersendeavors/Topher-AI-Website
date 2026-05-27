import { supabase } from "../db/client.js";
import { searchMemory } from "../memory/index.js";
import type { AgentContext } from "../agents/types.js";
import type { AgentRole, WorkflowStageId } from "@toburt/shared";

export async function hydrateContext(args: {
  projectId: string;
  workflowId?: string;
  stage?: WorkflowStageId;
  collaborators: AgentRole[];
  query: string;
  user?: { id: string; name?: string };
}): Promise<AgentContext> {
  const { projectId, workflowId, stage, collaborators, query } = args;

  const [{ data: project }, { data: transcript }] = await Promise.all([
    supabase
      .from("projects")
      .select("showrunner_notes")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("room_messages")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const [canon, drafts] = await Promise.all([
    searchMemory({ projectId, query, approvedOnly: true, k: 8 }),
    searchMemory({ projectId, query, approvedOnly: false, k: 8 }),
  ]);

  return {
    projectId,
    workflowId,
    stage,
    showrunnerNotes: project?.showrunner_notes ?? undefined,
    retrievedCanon: canon,
    retrievedDrafts: drafts,
    collaborators,
    transcriptWindow: (transcript ?? []).reverse(),
    user: args.user,
  };
}
