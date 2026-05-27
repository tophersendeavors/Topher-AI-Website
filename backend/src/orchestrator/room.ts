import { supabase } from "../db/client.js";
import type { AgentRole, WorkflowStageId } from "@toburt/shared";

export interface PostRoomMessageInput {
  projectId: string;
  workflowId?: string | null;
  stageId?: WorkflowStageId | null;
  authorKind: "agent" | "user" | "system";
  authorRole?: AgentRole | null;
  authorUserId?: string | null;
  kind?: "message" | "suggestion" | "critique" | "approval" | "tool_call";
  body?: string;
  payload?: unknown;
  parentId?: string | null;
}

export async function postRoomMessage(input: PostRoomMessageInput) {
  const { error, data } = await supabase
    .from("room_messages")
    .insert({
      project_id: input.projectId,
      workflow_id: input.workflowId ?? null,
      stage_id: input.stageId ?? null,
      author_kind: input.authorKind,
      author_role: input.authorRole ?? null,
      author_user_id: input.authorUserId ?? null,
      kind: input.kind ?? "message",
      body: input.body ?? null,
      payload: input.payload ?? null,
      parent_id: input.parentId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
