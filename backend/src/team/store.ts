// Creative Team — persistence.
//
// Stored at projects.metadata.roleAssignments[roleKey]. Approval
// timestamp (when set) lives at projects.metadata.teamRosterApprovedAt.

import { supabase } from "../db/client.js";
import {
  DEFAULT_WORKFLOW_MODE,
  WORKFLOW_MODES,
  type RoleAssignment,
  type WorkflowMode,
} from "@toburt/shared";

type Json = Record<string, unknown>;
const j = (v: unknown): Json => ((v ?? {}) as Json);

interface RawProject {
  id: string;
  title: string | null;
  metadata: Json;
}

async function loadProject(projectId: string): Promise<RawProject | null> {
  const { data } = await supabase
    .from("projects")
    .select("id, title, metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    title: (data.title as string | null) ?? null,
    metadata: j((data as { metadata?: unknown }).metadata),
  };
}

async function saveProjectMetadata(projectId: string, metadata: Json): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
}

export interface TeamState {
  projectId: string;
  projectTitle: string | null;
  assignments: Record<string, RoleAssignment>;
  rosterApprovedAt: string | null;
  workflowMode: WorkflowMode;
}

function readWorkflowMode(metadata: Json): WorkflowMode {
  const raw = metadata.workflowMode;
  if (typeof raw === "string" && (WORKFLOW_MODES as readonly string[]).includes(raw)) {
    return raw as WorkflowMode;
  }
  return DEFAULT_WORKFLOW_MODE;
}

export async function loadTeamState(projectId: string): Promise<TeamState | null> {
  const project = await loadProject(projectId);
  if (!project) return null;
  const assignments =
    ((project.metadata.roleAssignments as Record<string, RoleAssignment>) ?? {}) as Record<
      string,
      RoleAssignment
    >;
  const rosterApprovedAt =
    typeof project.metadata.teamRosterApprovedAt === "string"
      ? (project.metadata.teamRosterApprovedAt as string)
      : null;
  return {
    projectId: project.id,
    projectTitle: project.title,
    assignments,
    rosterApprovedAt,
    workflowMode: readWorkflowMode(project.metadata),
  };
}

export async function setWorkflowMode(
  projectId: string,
  mode: WorkflowMode
): Promise<WorkflowMode> {
  const project = await loadProject(projectId);
  if (!project) throw new Error("project_not_found");
  await saveProjectMetadata(projectId, {
    ...project.metadata,
    workflowMode: mode,
  });
  return mode;
}

export async function upsertAssignment(
  projectId: string,
  roleKey: string,
  assignment: RoleAssignment
): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new Error("project_not_found");
  const current =
    ((project.metadata.roleAssignments as Record<string, RoleAssignment>) ?? {}) as Record<
      string,
      RoleAssignment
    >;
  const next = { ...current, [roleKey]: assignment };
  await saveProjectMetadata(projectId, {
    ...project.metadata,
    roleAssignments: next,
  });
}

export async function deleteAssignment(
  projectId: string,
  roleKey: string
): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) throw new Error("project_not_found");
  const current =
    ((project.metadata.roleAssignments as Record<string, RoleAssignment>) ?? {}) as Record<
      string,
      RoleAssignment
    >;
  if (!(roleKey in current)) return;
  const next = { ...current };
  delete next[roleKey];
  await saveProjectMetadata(projectId, {
    ...project.metadata,
    roleAssignments: next,
  });
}

export async function setRosterApproved(
  projectId: string,
  approved: boolean,
  approvedBy: string | null
): Promise<string | null> {
  const project = await loadProject(projectId);
  if (!project) throw new Error("project_not_found");
  const stamp = approved ? new Date().toISOString() : null;
  const next = { ...project.metadata, teamRosterApprovedAt: stamp };
  if (!approved) delete (next as Json).teamRosterApprovedBy;
  else (next as Json).teamRosterApprovedBy = approvedBy;
  await saveProjectMetadata(projectId, next);
  return stamp;
}
