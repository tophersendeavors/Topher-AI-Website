// Department Collaboration routes (Stage 4 Phase A-B).
//
// REST surface for:
//   - registry + config              GET /projects/:id/departments
//   - per-dept config                PATCH /projects/:id/departments/:dept/config
//   - contribution CRUD              POST/GET /projects/:id/departments/:dept/contributions
//                                    PATCH/DELETE /contributions/:id
//   - approve / reject               POST /contributions/:id/approve|reject
//   - signed upload URL              POST /projects/:id/storage/department-upload-url
//   - activity log                   GET /projects/:id/departments/:dept/activity
//                                    GET /projects/:id/activity

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  ALL_DEPARTMENT_KEYS,
  DEFAULT_DEPARTMENT_CONFIG,
  DEPARTMENT_REGISTRY,
  type DepartmentConfig,
  type DepartmentKey,
} from "../departments/registry.js";
import {
  approveContribution,
  createContribution,
  deleteContribution,
  listActivity,
  listContributions,
  logActivity,
  patchContribution,
  rejectContribution,
  type ContributionRow,
} from "../departments/contributions.js";
import { loadResolvedCanon } from "../departments/canonResolver.js";

const STORAGE_BUCKET = "department-contributions";

const Z_DEPT = z.enum(ALL_DEPARTMENT_KEYS as [DepartmentKey, ...DepartmentKey[]]);

const Z_CONTRIB_KIND = z.enum([
  "note",
  "image",
  "url",
  "pdf",
  "color",
  "material",
  "moodboard",
]);

export default async function departmentRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------
  // GET /projects/:id/departments
  // Registry + per-dept config + contribution + approved-canon counts.
  // -------------------------------------------------------------------
  app.get("/projects/:id/departments", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);

    const { data: project } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", id)
      .single();
    const meta = (project?.metadata ?? {}) as Record<string, unknown>;
    const configMap = (meta.departmentConfig ?? {}) as Record<string, DepartmentConfig>;

    const { data: counts } = await supabase
      .from("department_contributions")
      .select("department, status", { count: "exact", head: false })
      .eq("project_id", id);
    const byDept: Record<string, { total: number; approved: number; candidate: number }> = {};
    for (const row of counts ?? []) {
      const d = row.department as string;
      byDept[d] ??= { total: 0, approved: 0, candidate: 0 };
      byDept[d].total++;
      if (row.status === "approved") byDept[d].approved++;
      if (row.status === "candidate") byDept[d].candidate++;
    }

    const canon = await loadResolvedCanon(id);
    const approvedFieldsByDept: Record<string, number> = {};
    for (const fieldPath of canon.approvedFields) {
      // Determine which dept owns this path by prefix.
      for (const dept of ALL_DEPARTMENT_KEYS) {
        const owns = DEPARTMENT_REGISTRY[dept].ownedFieldPaths.some((pat) => {
          const root = pat.replace(/\.\*$/, "").replace(/\.\*\./g, ".");
          return fieldPath.startsWith(root.split(".*")[0]);
        });
        if (owns) {
          approvedFieldsByDept[dept] = (approvedFieldsByDept[dept] ?? 0) + 1;
          break;
        }
      }
    }

    return {
      registry: ALL_DEPARTMENT_KEYS.map((k) => ({
        ...DEPARTMENT_REGISTRY[k],
        config: configMap[k] ?? DEFAULT_DEPARTMENT_CONFIG,
        contributionCounts: byDept[k] ?? { total: 0, approved: 0, candidate: 0 },
        approvedCanonFields: approvedFieldsByDept[k] ?? 0,
      })),
    };
  });

  // -------------------------------------------------------------------
  // PATCH /projects/:id/departments/:dept/config
  // -------------------------------------------------------------------
  app.patch("/projects/:id/departments/:dept/config", async (req) => {
    const user = await requireUser(req);
    const { id, dept } = req.params as { id: string; dept: string };
    const deptKey = Z_DEPT.parse(dept);
    await assertProjectMember(user.id, id);

    const body = z
      .object({
        mode: z.enum(["ai", "human", "hybrid"]).optional(),
        leadAssigneeId: z.string().nullable().optional(),
        additionalAssigneeIds: z.array(z.string()).optional(),
        aiAssistantEnabled: z.boolean().optional(),
        approvalRequired: z.boolean().optional(),
        locked: z.boolean().optional(),
      })
      .strict()
      .parse(req.body ?? {});

    const { data: project } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", id)
      .single();
    const meta = (project?.metadata ?? {}) as Record<string, unknown>;
    const cfgMap = (meta.departmentConfig ?? {}) as Record<string, DepartmentConfig>;
    const before = cfgMap[deptKey] ?? DEFAULT_DEPARTMENT_CONFIG;
    cfgMap[deptKey] = {
      ...before,
      ...body,
      updatedAt: new Date().toISOString(),
    };
    meta.departmentConfig = cfgMap;
    await supabase.from("projects").update({ metadata: meta }).eq("id", id);
    await logActivity({
      projectId: id,
      department: deptKey,
      actorId: user.id,
      action: "config_updated",
      targetType: "config",
      diff: { before, after: cfgMap[deptKey] },
    });
    return cfgMap[deptKey];
  });

  // -------------------------------------------------------------------
  // POST /projects/:id/departments/:dept/contributions
  // -------------------------------------------------------------------
  app.post("/projects/:id/departments/:dept/contributions", async (req) => {
    const user = await requireUser(req);
    const { id, dept } = req.params as { id: string; dept: string };
    const deptKey = Z_DEPT.parse(dept);
    await assertProjectMember(user.id, id);

    const body = z
      .object({
        kind: Z_CONTRIB_KIND,
        title: z.string().optional(),
        body: z.string().optional(),
        url: z.string().optional(),
        storage_path: z.string().optional(),
        thumbnail_url: z.string().optional(),
        color_hex: z.string().optional(),
        tags: z.array(z.string()).optional(),
        links: z.record(z.unknown()).optional(),
        status: z
          .enum(["inspiration", "candidate", "approved", "rejected", "archived"])
          .optional(),
      })
      .parse(req.body ?? {});

    return createContribution({
      projectId: id,
      department: deptKey,
      contributorId: user.id,
      ...body,
    });
  });

  // -------------------------------------------------------------------
  // GET /projects/:id/departments/:dept/contributions
  // -------------------------------------------------------------------
  app.get("/projects/:id/departments/:dept/contributions", async (req) => {
    const user = await requireUser(req);
    const { id, dept } = req.params as { id: string; dept: string };
    const deptKey = Z_DEPT.parse(dept);
    await assertProjectMember(user.id, id);
    const status = (req.query as { status?: ContributionRow["status"] }).status;
    return listContributions({ projectId: id, department: deptKey, status });
  });

  // -------------------------------------------------------------------
  // PATCH /contributions/:id
  // -------------------------------------------------------------------
  app.patch("/contributions/:cid", async (req) => {
    const user = await requireUser(req);
    const { cid } = req.params as { cid: string };
    const { data: row } = await supabase
      .from("department_contributions")
      .select("project_id")
      .eq("id", cid)
      .single();
    if (!row) throw new Error("contribution not found");
    await assertProjectMember(user.id, row.project_id as string);
    const body = z
      .object({
        title: z.string().optional(),
        body: z.string().optional(),
        url: z.string().optional(),
        thumbnail_url: z.string().optional(),
        color_hex: z.string().optional(),
        tags: z.array(z.string()).optional(),
        links: z.record(z.unknown()).optional(),
        status: z
          .enum(["inspiration", "candidate", "approved", "rejected", "archived"])
          .optional(),
      })
      .parse(req.body ?? {});
    return patchContribution({ contributionId: cid, actorId: user.id, fields: body });
  });

  // -------------------------------------------------------------------
  // DELETE /contributions/:id
  // -------------------------------------------------------------------
  app.delete("/contributions/:cid", async (req) => {
    const user = await requireUser(req);
    const { cid } = req.params as { cid: string };
    const { data: row } = await supabase
      .from("department_contributions")
      .select("project_id")
      .eq("id", cid)
      .single();
    if (!row) return { ok: true };
    await assertProjectMember(user.id, row.project_id as string);
    await deleteContribution({ contributionId: cid, actorId: user.id });
    return { ok: true };
  });

  // -------------------------------------------------------------------
  // POST /contributions/:id/approve
  // POST /contributions/:id/reject
  // -------------------------------------------------------------------
  app.post("/contributions/:cid/approve", async (req) => {
    const user = await requireUser(req);
    const { cid } = req.params as { cid: string };
    const { data: row } = await supabase
      .from("department_contributions")
      .select("project_id")
      .eq("id", cid)
      .single();
    if (!row) throw new Error("contribution not found");
    await assertProjectMember(user.id, row.project_id as string);
    return approveContribution({ contributionId: cid, actorId: user.id });
  });

  app.post("/contributions/:cid/reject", async (req) => {
    const user = await requireUser(req);
    const { cid } = req.params as { cid: string };
    const { data: row } = await supabase
      .from("department_contributions")
      .select("project_id")
      .eq("id", cid)
      .single();
    if (!row) throw new Error("contribution not found");
    await assertProjectMember(user.id, row.project_id as string);
    const body = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    return rejectContribution({
      contributionId: cid,
      actorId: user.id,
      reason: body.reason,
    });
  });

  // -------------------------------------------------------------------
  // POST /projects/:id/storage/department-upload-url
  // Returns a signed PUT URL for uploading directly to Supabase Storage.
  // -------------------------------------------------------------------
  app.post("/projects/:id/storage/department-upload-url", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        filename: z.string().min(1),
        contentType: z.string().min(1),
        department: Z_DEPT,
      })
      .parse(req.body ?? {});
    // Path: <projectId>/<department>/<uuid>-<filename>
    const safeName = body.filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const path = `${id}/${body.department}/${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw new Error(error?.message ?? "signed url failed");
    // Also generate a long-lived signed READ URL (1 year) for the public
    // display surface. For prod we'd issue short-lived signed URLs on
    // demand — fine for the EP01 pilot.
    const { data: readData } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, 365 * 24 * 60 * 60);
    return {
      storage_path: path,
      upload_url: data.signedUrl,
      upload_token: data.token,
      public_read_url: readData?.signedUrl ?? null,
    };
  });

  // -------------------------------------------------------------------
  // GET activity feeds
  // -------------------------------------------------------------------
  app.get("/projects/:id/departments/:dept/activity", async (req) => {
    const user = await requireUser(req);
    const { id, dept } = req.params as { id: string; dept: string };
    const deptKey = Z_DEPT.parse(dept);
    await assertProjectMember(user.id, id);
    return listActivity({ projectId: id, department: deptKey, limit: 50 });
  });

  app.get("/projects/:id/activity", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    return listActivity({ projectId: id, limit: 100 });
  });

  // -------------------------------------------------------------------
  // GET /projects/:id/canon-sources — debug / Preflight detail view.
  // -------------------------------------------------------------------
  app.get("/projects/:id/canon-sources", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const resolved = await loadResolvedCanon(id);
    return {
      approvedFields: [...resolved.approvedFields],
      textOverrides: Object.fromEntries(resolved.textOverrides),
      references: resolved.references,
    };
  });
}
