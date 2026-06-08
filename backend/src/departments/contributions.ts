// Department contributions module (Stage 4 Phase A-B).
//
// CRUD + status transitions. Approve writes to `projects.metadata.canonSources`
// per user's clarification: image/URL contributions attach as canon
// REFERENCES (don't overwrite prose); contributions that include
// `links.canonOverrideText` set the textOverride for the target field.

import { supabase } from "../db/client.js";
import { departmentOwnsPath, type DepartmentKey } from "./registry.js";
import type { CanonSourceEntry, CanonSources } from "./canonResolver.js";

export interface ContributionRow {
  id: string;
  project_id: string;
  department: DepartmentKey;
  contributor_id: string | null;
  kind: "note" | "image" | "url" | "pdf" | "color" | "material" | "moodboard";
  title: string | null;
  body: string | null;
  url: string | null;
  storage_path: string | null;
  thumbnail_url: string | null;
  color_hex: string | null;
  status: "inspiration" | "candidate" | "approved" | "rejected" | "archived";
  tags: string[];
  links: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listContributions(args: {
  projectId: string;
  department?: DepartmentKey;
  status?: ContributionRow["status"];
}): Promise<ContributionRow[]> {
  let q = supabase
    .from("department_contributions")
    .select("*")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false });
  if (args.department) q = q.eq("department", args.department);
  if (args.status) q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ContributionRow[];
}

export async function createContribution(args: {
  projectId: string;
  department: DepartmentKey;
  contributorId: string;
  kind: ContributionRow["kind"];
  title?: string;
  body?: string;
  url?: string;
  storage_path?: string;
  thumbnail_url?: string;
  color_hex?: string;
  tags?: string[];
  links?: Record<string, unknown>;
  status?: ContributionRow["status"];
}): Promise<ContributionRow> {
  const { data, error } = await supabase
    .from("department_contributions")
    .insert({
      project_id: args.projectId,
      department: args.department,
      contributor_id: args.contributorId,
      kind: args.kind,
      title: args.title ?? null,
      body: args.body ?? null,
      url: args.url ?? null,
      storage_path: args.storage_path ?? null,
      thumbnail_url: args.thumbnail_url ?? null,
      color_hex: args.color_hex ?? null,
      tags: args.tags ?? [],
      links: args.links ?? {},
      status: args.status ?? "inspiration",
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logActivity({
    projectId: args.projectId,
    department: args.department,
    actorId: args.contributorId,
    action: "contribution_created",
    targetType: "contribution",
    targetId: data.id,
    notes: args.title ?? args.kind,
  });
  return data as ContributionRow;
}

export async function patchContribution(args: {
  contributionId: string;
  actorId: string;
  fields: Partial<
    Pick<
      ContributionRow,
      "title" | "body" | "url" | "thumbnail_url" | "color_hex" | "tags" | "links" | "status"
    >
  >;
}): Promise<ContributionRow> {
  const { data: before } = await supabase
    .from("department_contributions")
    .select("*")
    .eq("id", args.contributionId)
    .single();
  if (!before) throw new Error("contribution not found");
  const { data, error } = await supabase
    .from("department_contributions")
    .update({ ...args.fields, updated_at: new Date().toISOString() })
    .eq("id", args.contributionId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await logActivity({
    projectId: data.project_id,
    department: data.department as DepartmentKey,
    actorId: args.actorId,
    action: "contribution_updated",
    targetType: "contribution",
    targetId: data.id,
    diff: { before: before, after: data },
  });
  return data as ContributionRow;
}

/** Approve a contribution → bind as canon source for its target field.
 *  Image / URL / color / PDF / material contributions attach as REFERENCES.
 *  Contributions with `links.canonOverrideText` write a `textOverride`. */
export async function approveContribution(args: {
  contributionId: string;
  actorId: string;
}): Promise<{ contribution: ContributionRow; canonSources: CanonSources }> {
  const { data: row } = await supabase
    .from("department_contributions")
    .select("*")
    .eq("id", args.contributionId)
    .single();
  if (!row) throw new Error("contribution not found");
  const r = row as ContributionRow;
  const fieldPath = (r.links?.canonFieldPath as string | undefined) ?? "";
  const textOverride = (r.links?.canonOverrideText as string | undefined) ?? "";

  // Validate the contribution's department owns the target field path
  // (when set). Notes / inspiration rows without a field path are fine.
  if (fieldPath && !departmentOwnsPath(r.department as DepartmentKey, fieldPath)) {
    throw new Error(
      `Contribution target field "${fieldPath}" is not owned by department "${r.department}". Reassign or change the field path before approving.`
    );
  }

  // Move contribution to status=approved.
  const { error: updErr } = await supabase
    .from("department_contributions")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("id", r.id);
  if (updErr) throw new Error(updErr.message);

  // Update projects.metadata.canonSources when a field path is set.
  let canonSources: CanonSources = {};
  if (fieldPath) {
    const { data: project } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", r.project_id)
      .single();
    const meta = (project?.metadata ?? {}) as Record<string, unknown>;
    canonSources = (meta.canonSources as CanonSources | undefined) ?? {};
    const existing: CanonSourceEntry = canonSources[fieldPath] ?? {
      references: [],
      lastUpdatedAt: new Date().toISOString(),
    };
    // Always append as a reference (dedupe by contributionId).
    const refKind = r.kind as CanonSourceEntry["references"][number]["kind"];
    const nowIso = new Date().toISOString();
    if (!existing.references.some((x) => x.contributionId === r.id)) {
      existing.references.push({
        contributionId: r.id,
        kind: refKind,
        title: r.title ?? r.url ?? r.kind,
        url: r.url ?? null,
        storage_path: r.storage_path ?? null,
        color_hex: r.color_hex ?? null,
        approvedBy: args.actorId,
        approvedAt: nowIso,
      });
    }
    // textOverride only set if the contribution carries one.
    if (textOverride && textOverride.trim()) {
      existing.textOverride = {
        value: textOverride.trim(),
        contributionId: r.id,
        approvedBy: args.actorId,
        approvedAt: new Date().toISOString(),
      };
    }
    existing.lastUpdatedAt = new Date().toISOString();
    canonSources[fieldPath] = existing;
    meta.canonSources = canonSources;
    const { error: persistErr } = await supabase
      .from("projects")
      .update({ metadata: meta })
      .eq("id", r.project_id);
    if (persistErr) throw new Error(persistErr.message);
  }

  await logActivity({
    projectId: r.project_id,
    department: r.department as DepartmentKey,
    actorId: args.actorId,
    action: "contribution_approved",
    targetType: "contribution",
    targetId: r.id,
    notes: fieldPath
      ? `Bound to canon field: ${fieldPath}${textOverride ? " (text override)" : " (reference only)"}`
      : "(no canon field — kept as inspiration reference)",
  });

  const { data: refreshed } = await supabase
    .from("department_contributions")
    .select("*")
    .eq("id", r.id)
    .single();
  return { contribution: refreshed as ContributionRow, canonSources };
}

export async function rejectContribution(args: {
  contributionId: string;
  actorId: string;
  reason?: string;
}): Promise<ContributionRow> {
  const { data: row } = await supabase
    .from("department_contributions")
    .select("*")
    .eq("id", args.contributionId)
    .single();
  if (!row) throw new Error("contribution not found");
  const { data, error } = await supabase
    .from("department_contributions")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", args.contributionId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  // Stage 4.1 — if this contribution was previously approved + bound to a
  // canon source, strip it out now. Reject should be reversible: it should
  // not leave orphan references attached to the bible.
  await stripFromCanonSources(row.project_id, args.contributionId);
  await logActivity({
    projectId: row.project_id,
    department: row.department as DepartmentKey,
    actorId: args.actorId,
    action: "contribution_rejected",
    targetType: "contribution",
    targetId: row.id,
    notes: args.reason ?? "(no reason given)",
  });
  return data as ContributionRow;
}

export async function deleteContribution(args: {
  contributionId: string;
  actorId: string;
}): Promise<void> {
  const { data: row } = await supabase
    .from("department_contributions")
    .select("*")
    .eq("id", args.contributionId)
    .single();
  if (!row) return;
  // Stage 4.1 — strip from canonSources before the row goes away so we
  // don't leave dangling references pointing to a missing contribution.
  await stripFromCanonSources(row.project_id, args.contributionId);
  await supabase.from("department_contributions").delete().eq("id", args.contributionId);
  await logActivity({
    projectId: row.project_id,
    department: row.department as DepartmentKey,
    actorId: args.actorId,
    action: "contribution_deleted",
    targetType: "contribution",
    targetId: row.id,
  });
}

/** Helper: walk projects.metadata.canonSources, remove any reference
 *  entry pointing at contributionId, and clear textOverride if it was
 *  driven by the same contribution. Empty canonSources entries are kept
 *  (preserves the field key for audit). */
async function stripFromCanonSources(
  projectId: string,
  contributionId: string
): Promise<void> {
  const { data: project } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (!project) return;
  const meta = (project.metadata ?? {}) as Record<string, unknown>;
  const cs = (meta.canonSources ?? {}) as Record<string, CanonSourceEntry>;
  let changed = false;
  for (const fieldPath of Object.keys(cs)) {
    const entry = cs[fieldPath];
    const beforeLen = entry.references.length;
    entry.references = entry.references.filter(
      (r) => r.contributionId !== contributionId
    );
    if (entry.references.length !== beforeLen) changed = true;
    if (
      entry.textOverride &&
      entry.textOverride.contributionId === contributionId
    ) {
      entry.textOverride = undefined;
      changed = true;
    }
    entry.lastUpdatedAt = new Date().toISOString();
  }
  if (changed) {
    meta.canonSources = cs;
    await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
  }
}

// ----- activity -----------------------------------------------------------

export async function logActivity(args: {
  projectId: string;
  department: DepartmentKey;
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  diff?: Record<string, unknown>;
  notes?: string;
}): Promise<void> {
  await supabase.from("department_activity").insert({
    project_id: args.projectId,
    department: args.department,
    actor_id: args.actorId,
    action: args.action,
    target_type: args.targetType ?? null,
    target_id: args.targetId ?? null,
    diff: args.diff ?? null,
    notes: args.notes ?? null,
  });
}

export interface ActivityRow {
  id: string;
  project_id: string;
  department: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  diff: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
}

export async function listActivity(args: {
  projectId: string;
  department?: DepartmentKey;
  limit?: number;
}): Promise<ActivityRow[]> {
  let q = supabase
    .from("department_activity")
    .select("*")
    .eq("project_id", args.projectId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 100);
  if (args.department) q = q.eq("department", args.department);
  const { data } = await q;
  return (data ?? []) as ActivityRow[];
}
