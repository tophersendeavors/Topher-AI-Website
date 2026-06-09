// Creative Team — aggregate the static registry + auto-derived talent
// rows + current assignments into a single page response.

import { allRoleDefinitions } from "./registry.js";
import { loadTeamState } from "./store.js";
import {
  ROLE_KINDS,
  type RoleKind,
  type RoleSlot,
  type TeamRosterResponse,
  type TeamRosterSummary,
} from "@toburt/shared";

export async function buildTeamRoster(
  projectId: string
): Promise<TeamRosterResponse | null> {
  const state = await loadTeamState(projectId);
  if (!state) return null;
  const definitions = await allRoleDefinitions(projectId);
  const slots: RoleSlot[] = definitions.map((definition) => ({
    definition,
    assignment: state.assignments[definition.key] ?? null,
  }));

  const byKind = ROLE_KINDS.reduce<Record<RoleKind, number>>(
    (acc, k) => {
      acc[k] = 0;
      return acc;
    },
    { ai: 0, ai_creative: 0, live_person: 0 }
  );
  let assignedRoles = 0;
  let assignedRequiredRoles = 0;
  let requiredRoles = 0;
  for (const s of slots) {
    if (s.definition.required) requiredRoles += 1;
    if (s.assignment) {
      assignedRoles += 1;
      byKind[s.assignment.kind] = (byKind[s.assignment.kind] ?? 0) + 1;
      if (s.definition.required) assignedRequiredRoles += 1;
    }
  }
  const summary: TeamRosterSummary = {
    totalRoles: slots.length,
    requiredRoles,
    assignedRoles,
    assignedRequiredRoles,
    byKind,
    rosterApprovedAt: state.rosterApprovedAt,
    allRequiredAssigned: requiredRoles > 0 && assignedRequiredRoles === requiredRoles,
  };
  return {
    projectId: state.projectId,
    projectTitle: state.projectTitle,
    slots,
    summary,
  };
}
