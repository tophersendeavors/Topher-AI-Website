// Canon Resolver (Stage 4 Phase D).
//
// Reads `projects.metadata.canonSources` + joins approved contribution
// rows to produce, for any bible field path, the human-approved value
// (when set) and the list of approved REFERENCES (image URLs, external
// links) the composer should attach to its referenceMetadata.
//
// Resolution rule (matches user's spec):
//   1. If canonSources[path].textOverride exists → use its value
//      (overrides bible field).
//   2. Always collect canonSources[path].references[] → composer surfaces
//      them as canonReferences in PromptVersion.referenceMetadata.
//   3. If no override → bible's existing string flows through unchanged.

import { supabase } from "../db/client.js";

export interface CanonReferenceEntry {
  contributionId: string;
  kind: "image" | "url" | "pdf" | "color" | "material" | "moodboard" | "note";
  title: string;
  url: string | null;
  storage_path: string | null;
  color_hex?: string | null;
  /** Stage 4.1 — attribution. Written when the reference is bound via
   *  approveContribution(). Older entries created before this addition
   *  may have these undefined. */
  approvedBy?: string;
  approvedAt?: string;
}

export interface CanonSourceEntry {
  /** Asset references that BACK this canon field (images, URLs, color
   *  swatches). The composer attaches these as canonReferences on every
   *  prompt whose visible canon touches this field. */
  references: CanonReferenceEntry[];
  /** Optional explicit human-approved TEXT value. When set, the
   *  composer's resolver returns this in place of the bible's stored
   *  string. Per user spec: image/URL approvals do NOT auto-overwrite
   *  prose — only contributions that include an explicit canonical
   *  text/value populate this field. */
  textOverride?: {
    value: string;
    contributionId: string;
    approvedBy: string;
    approvedAt: string;
  };
  lastUpdatedAt: string;
}

export type CanonSources = Record<string, CanonSourceEntry>;

export interface ResolvedCanon {
  /** Map of field path → human-approved override value (when set). */
  textOverrides: Map<string, { value: string; approvedBy: string; approvedAt: string }>;
  /** Flat list of every approved reference asset, keyed by field path,
   *  for the composer to surface. */
  references: Array<{ fieldPath: string } & CanonReferenceEntry>;
  /** Per-field path → bool, whether ANY approved reference or override
   *  exists. Used by the Preflight card to show "approved by you" pills. */
  approvedFields: Set<string>;
  /** Raw canonSources object (for activity / debugging / Preflight). */
  raw: CanonSources;
}

/** Load + resolve canon for a project. Returns the structured map that
 *  the composer + loader use to override field values + collect refs. */
export async function loadResolvedCanon(projectId: string): Promise<ResolvedCanon> {
  const { data: project } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (project?.metadata ?? {}) as Record<string, unknown>;
  const sources = (meta.canonSources as CanonSources | undefined) ?? {};

  const textOverrides = new Map<
    string,
    { value: string; approvedBy: string; approvedAt: string }
  >();
  const references: Array<{ fieldPath: string } & CanonReferenceEntry> = [];
  const approvedFields = new Set<string>();

  for (const [fieldPath, entry] of Object.entries(sources)) {
    if (entry.textOverride && entry.textOverride.value && entry.textOverride.value.trim()) {
      textOverrides.set(fieldPath, {
        value: entry.textOverride.value,
        approvedBy: entry.textOverride.approvedBy,
        approvedAt: entry.textOverride.approvedAt,
      });
      approvedFields.add(fieldPath);
    }
    for (const ref of entry.references ?? []) {
      references.push({ fieldPath, ...ref });
      approvedFields.add(fieldPath);
    }
  }

  return { textOverrides, references, approvedFields, raw: sources };
}

/** Apply canon overrides to a flat record of bible values.
 *  - Pass in a record of `path → string` (current bible values).
 *  - Returns same record with paths replaced by approved overrides
 *    where present. */
export function applyTextOverrides(
  values: Record<string, string | undefined>,
  resolved: ResolvedCanon
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...values };
  for (const [path, override] of resolved.textOverrides) {
    out[path] = override.value;
  }
  return out;
}

/** Pull just the references that match a given field-path prefix.
 *  e.g. `"locationBibles.INT_MAYA_BEDROOM_NIGHT."` collects every
 *  approved ref for any field inside that bible. */
export function referencesForPrefix(
  resolved: ResolvedCanon,
  prefix: string
): Array<{ fieldPath: string } & CanonReferenceEntry> {
  return resolved.references.filter((r) => r.fieldPath.startsWith(prefix));
}
