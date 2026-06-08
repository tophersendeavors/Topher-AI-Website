// Canon Target Picker catalog (Stage 5).
//
// The friendly cascading picker the workflow UI shows instead of the
// raw `locationBibles.<KEY>.architecture.wallColor` paths. We derive
// it on-the-fly from each project's bibles + the existing department
// registry so it always reflects the real state of the project.

import { supabase } from "../db/client.js";
import type { LocationBible, PropBible } from "../continuity/types.js";
import { normalizeKey } from "../continuity/types.js";
import {
  ALL_DEPARTMENT_KEYS,
  type DepartmentKey,
} from "../departments/registry.js";
import { loadResolvedCanon } from "../departments/canonResolver.js";

export interface CanonCatalogEntry {
  /** The actual underlying jsonb path — used by the contribution API
   *  but NEVER shown to the user. */
  fieldPath: string;
  /** Cascading picker labels — these ARE shown. */
  location: string | null;       // "Maya's Bedroom"
  category: string;              // "Architecture" | "Furniture" | "Set Dressing" | "Props" | "Wardrobe" | "HMU"
  item: string;                  // "Walls" | "Bed" | "Comforter"
  field: string;                 // "Color" | "Design" | "Material"
  /** Plain-English description shown as a tooltip. */
  description: string;
  /** Current bible value, when one exists. */
  currentValue: string | null;
  /** Whether this field has a human-approved canon source. */
  hasApprovedCanon: boolean;
  /** Department key that owns this field (drives permissions). */
  ownerDepartmentKey: DepartmentKey;
}

export interface CanonCatalog {
  entries: CanonCatalogEntry[];
  /** Pre-grouped for the cascading picker UI. */
  groupedByLocation: Record<string, CanonCatalogEntry[]>;
}

/** Compute the full canon catalog for a project. */
export async function buildCanonCatalog(projectId: string): Promise<CanonCatalog> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
  const locBibles =
    (meta.locationBibles as Record<string, LocationBible> | undefined) ?? {};
  const propBibles =
    (meta.propBibles as Record<string, PropBible> | undefined) ?? {};

  const canon = await loadResolvedCanon(projectId);
  const isApproved = (path: string): boolean => canon.approvedFields.has(path);

  const { data: chars } = await supabase
    .from("characters")
    .select("id, name, metadata")
    .eq("project_id", projectId);

  const entries: CanonCatalogEntry[] = [];

  // ---------- Location bibles → Architecture / Furniture / Set Dressing
  for (const [key, bible] of Object.entries(locBibles)) {
    const locName = bible.name || key;
    const arch = (bible as unknown as { architecture?: Record<string, string> }).architecture;
    const fd = (bible as unknown as { furnitureDesign?: Record<string, string> }).furnitureDesign;
    const sd = (bible as unknown as { setDressing?: Record<string, unknown> }).setDressing;

    // architecture.*
    if (arch) {
      for (const [k, v] of Object.entries(arch)) {
        const path = `locationBibles.${key}.architecture.${k}`;
        entries.push({
          fieldPath: path,
          location: locName,
          category: "Architecture",
          item: humanize(k),
          field: "Detail",
          description: `Architectural detail: ${humanize(k)}.`,
          currentValue: v ?? null,
          hasApprovedCanon: isApproved(path),
          ownerDepartmentKey: "production_design",
        });
      }
    }
    // furnitureDesign.*
    if (fd) {
      for (const [k, v] of Object.entries(fd)) {
        const path = `locationBibles.${key}.furnitureDesign.${k}`;
        entries.push({
          fieldPath: path,
          location: locName,
          category: "Furniture",
          item: humanize(k).replace(/ Design$/, ""),
          field: "Design",
          description: `Furniture design: ${humanize(k)}.`,
          currentValue: v ?? null,
          hasApprovedCanon: isApproved(path),
          ownerDepartmentKey: "production_design",
        });
      }
    }
    // setDressing.*
    if (sd) {
      for (const [k, v] of Object.entries(sd)) {
        if (k === "bedding" && v && typeof v === "object") {
          const bedding = v as Record<string, unknown>;
          for (const [bk, bv] of Object.entries(bedding)) {
            const path = `locationBibles.${key}.setDressing.bedding.${bk}`;
            entries.push({
              fieldPath: path,
              location: locName,
              category: "Set Dressing",
              item: "Bedding",
              field: humanize(bk),
              description: `Bedding ${humanize(bk).toLowerCase()}.`,
              currentValue: bv != null ? String(bv) : null,
              hasApprovedCanon: isApproved(path),
              ownerDepartmentKey: "art_dept",
            });
          }
          continue;
        }
        const path = `locationBibles.${key}.setDressing.${k}`;
        entries.push({
          fieldPath: path,
          location: locName,
          category: "Set Dressing",
          item: humanize(k),
          field: "Rule",
          description: `Set dressing rule: ${humanize(k).toLowerCase()}.`,
          currentValue: typeof v === "string" ? v : null,
          hasApprovedCanon: isApproved(path),
          ownerDepartmentKey: "art_dept",
        });
      }
    }
    // Misc top-level
    {
      const path = `locationBibles.${key}.continuityPrompt`;
      entries.push({
        fieldPath: path,
        location: locName,
        category: "Architecture",
        item: "Continuity Prompt",
        field: "Prose",
        description:
          "Locked-geometry continuity directive — injected into every prompt for this location.",
        currentValue: bible.continuityPrompt ?? null,
        hasApprovedCanon: isApproved(path),
        ownerDepartmentKey: "production_design",
      });
    }
    {
      const path = `locationBibles.${key}.layout`;
      entries.push({
        fieldPath: path,
        location: locName,
        category: "Architecture",
        item: "Layout",
        field: "Prose",
        description: "Overall room layout description.",
        currentValue: bible.layout ?? null,
        hasApprovedCanon: isApproved(path),
        ownerDepartmentKey: "production_design",
      });
    }
  }

  // ---------- Prop bibles → Props category
  for (const [key, prop] of Object.entries(propBibles)) {
    const propName = prop.name || key;
    const homeLoc = prop.homeLocation || "—";
    for (const fieldKey of ["visualDetails", "startsAt", "endsAt", "orientation"] as const) {
      const v = (prop as unknown as Record<string, unknown>)[fieldKey];
      const path = `propBibles.${key}.${fieldKey}`;
      entries.push({
        fieldPath: path,
        location: homeLoc,
        category: "Props",
        item: propName,
        field: humanize(fieldKey),
        description: `${propName} — ${humanize(fieldKey).toLowerCase()}.`,
        currentValue: typeof v === "string" ? v : null,
        hasApprovedCanon: isApproved(path),
        ownerDepartmentKey: "props",
      });
    }
  }

  // ---------- Characters → Wardrobe / HMU
  for (const c of chars ?? []) {
    const vb = ((c.metadata as { visualBible?: Record<string, unknown> })?.visualBible ?? {}) as Record<string, unknown>;
    const presence = vb.presenceType as string | undefined;
    if (presence === "voice_only" || presence === "text_only") continue;
    const wbe = (vb.wardrobeByEpisode as Record<string, Record<string, unknown>> | undefined) ?? {};
    const hbe = (vb.hmuByEpisode as Record<string, Record<string, unknown>> | undefined) ?? {};
    for (const [ep, w] of Object.entries(wbe)) {
      for (const [k, v] of Object.entries(w)) {
        const path = `characters.${c.id}.visualBible.wardrobeByEpisode.${ep}.${k}`;
        entries.push({
          fieldPath: path,
          location: null,
          category: "Wardrobe",
          item: c.name as string,
          field: `EP${ep} ${humanize(k)}`,
          description: `${c.name} EP${ep} wardrobe: ${humanize(k).toLowerCase()}.`,
          currentValue: Array.isArray(v) ? (v as unknown[]).join(", ") : typeof v === "string" ? v : null,
          hasApprovedCanon: isApproved(path),
          ownerDepartmentKey: "wardrobe_hmu",
        });
      }
    }
    for (const [ep, h] of Object.entries(hbe)) {
      for (const [k, v] of Object.entries(h)) {
        const path = `characters.${c.id}.visualBible.hmuByEpisode.${ep}.${k}`;
        entries.push({
          fieldPath: path,
          location: null,
          category: "HMU",
          item: c.name as string,
          field: `EP${ep} ${humanize(k)}`,
          description: `${c.name} EP${ep} HMU: ${humanize(k).toLowerCase()}.`,
          currentValue: Array.isArray(v) ? (v as unknown[]).join(", ") : typeof v === "string" ? v : null,
          hasApprovedCanon: isApproved(path),
          ownerDepartmentKey: "wardrobe_hmu",
        });
      }
    }
  }

  // Group by location for picker rendering.
  const groupedByLocation: Record<string, CanonCatalogEntry[]> = {};
  for (const e of entries) {
    const k = e.location || "Characters";
    (groupedByLocation[k] ??= []).push(e);
  }
  return { entries, groupedByLocation };
}

function humanize(camel: string): string {
  return camel
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Quick check: department-key → list of catalog entries owned by it. */
export function filterCatalogByDepartment(
  catalog: CanonCatalog,
  dept: DepartmentKey
): CanonCatalogEntry[] {
  return catalog.entries.filter((e) => e.ownerDepartmentKey === dept);
}

export { ALL_DEPARTMENT_KEYS };
