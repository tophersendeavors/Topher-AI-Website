import { supabase } from "../db/client.js";
import { searchMemory } from "../memory/index.js";
import { buildPriorEpisodeContext } from "./episodes.js";
import type { AgentContext } from "../agents/types.js";
import type { AgentRole, WorkflowStageId } from "@toburt/shared";

export async function hydrateContext(args: {
  projectId: string;
  workflowId?: string;
  stage?: WorkflowStageId;
  collaborators: AgentRole[];
  query: string;
  user?: { id: string; name?: string };
  /** When set (episode-scoped work), earlier episodes are summarized into the
   *  agent context so later episodes can reference what already happened. */
  episodeNumber?: number;
}): Promise<AgentContext> {
  const { projectId, workflowId, stage, collaborators, query, episodeNumber } = args;

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

  const [canon, drafts, priorEpisodes] = await Promise.all([
    searchMemory({ projectId, query, approvedOnly: true, k: 8 }),
    searchMemory({ projectId, query, approvedOnly: false, k: 8 }),
    episodeNumber != null && episodeNumber > 1
      ? buildPriorEpisodeContext(projectId, episodeNumber)
      : Promise.resolve([]),
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
    priorEpisodes,
    user: args.user,
  };
}
