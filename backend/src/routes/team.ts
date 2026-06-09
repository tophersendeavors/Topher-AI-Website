// Creative Team — HTTP routes.
//
// Writes only to projects.metadata.roleAssignments + .teamRosterApprovedAt.
// Never touches scripts.fountain or script_scenes.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import {
  CREATIVE_BRIEF_STYLES,
  HANDOFF_FORMATS,
  MODEL_TARGETS,
  ROLE_KINDS,
  type RoleAssignment,
  type RoleAssignmentPatch,
} from "@toburt/shared";
import { buildTeamRoster } from "../team/aggregator.js";
import { coreRoleByKey } from "../team/registry.js";
import { supabase } from "../db/client.js";
import {
  deleteAssignment,
  setRosterApproved,
  upsertAssignment,
} from "../team/store.js";

const AssignmentBody = z.object({
  kind: z.enum(ROLE_KINDS as unknown as [string, ...string[]]),
  label: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  modelTarget: z
    .enum(MODEL_TARGETS as unknown as [string, ...string[]])
    .optional(),
  profileId: z.string().max(200).optional(),
  avoidList: z.array(z.string().max(200)).max(50).optional(),
  creativeBriefStyle: z
    .enum(CREATIVE_BRIEF_STYLES as unknown as [string, ...string[]])
    .optional(),
  personName: z.string().max(200).optional(),
  personEmail: z.string().max(200).optional(),
  handoffFormat: z
    .enum(HANDOFF_FORMATS as unknown as [string, ...string[]])
    .optional(),
});

/** Validate that a derived role key references a character that exists
 *  on this project. Core role keys are validated against the static
 *  registry. */
async function assertValidRoleKey(projectId: string, roleKey: string): Promise<void> {
  if (coreRoleByKey(roleKey)) return;
  const m = roleKey.match(/^(actor|voice):([0-9a-fA-F-]{36})$/);
  if (!m) throw new Error("unknown_role_key");
  const characterId = m[2];
  const { data } = await supabase
    .from("characters")
    .select("id")
    .eq("id", characterId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!data) throw new Error("unknown_character_for_role");
}

export default async function teamRoutes(app: FastifyInstance) {
  // GET full roster
  app.get("/projects/:projectId/team", async (req, reply) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const roster = await buildTeamRoster(projectId);
    if (!roster) {
      reply.code(404);
      return { error: "project_not_found" };
    }
    return roster;
  });

  // PUT upsert one role
  app.put(
    "/projects/:projectId/team/roles/:roleKey",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, roleKey } = req.params as {
        projectId: string;
        roleKey: string;
      };
      await assertProjectMember(user.id, projectId);
      try {
        await assertValidRoleKey(projectId, roleKey);
      } catch (e) {
        reply.code(400);
        return { error: (e as Error).message };
      }
      const body = AssignmentBody.parse(req.body) as RoleAssignmentPatch;
      const assignment: RoleAssignment = {
        kind: body.kind,
        label: body.label.trim(),
        notes: body.notes,
        modelTarget: body.modelTarget,
        profileId: body.profileId,
        avoidList: body.avoidList,
        creativeBriefStyle: body.creativeBriefStyle,
        personName: body.personName,
        personEmail: body.personEmail,
        handoffFormat: body.handoffFormat,
        assignedAt: new Date().toISOString(),
        assignedBy: user.id ?? null,
      };
      await upsertAssignment(projectId, roleKey, assignment);
      return buildTeamRoster(projectId);
    }
  );

  // DELETE clear one role
  app.delete(
    "/projects/:projectId/team/roles/:roleKey",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, roleKey } = req.params as {
        projectId: string;
        roleKey: string;
      };
      await assertProjectMember(user.id, projectId);
      try {
        await assertValidRoleKey(projectId, roleKey);
      } catch (e) {
        reply.code(400);
        return { error: (e as Error).message };
      }
      await deleteAssignment(projectId, roleKey);
      return buildTeamRoster(projectId);
    }
  );

  // POST approve / unapprove roster
  app.post(
    "/projects/:projectId/team/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const body = (req.body ?? {}) as { approved?: boolean };
      const approved = body.approved !== false;
      await setRosterApproved(projectId, approved, user.id ?? null);
      return buildTeamRoster(projectId);
    }
  );
}
