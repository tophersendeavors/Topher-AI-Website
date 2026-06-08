// Title-page utilities — resolve the TitlePageMeta from the persisted script
// + project + episode rows, render the Fountain metadata block, and decide
// whether the export is ready to ship (writers + creators present).
//
// Three principles enforced here:
//   1. AI never fills `writers` or `creators`. The audit/export flow refuses
//      to call this "ready" until the user has set both.
//   2. Episode title only shows on the title page when title_status='approved'.
//   3. The script body never starts before the title-page block when one is
//      present — exporters must concatenate metadata + "\n\n" + body.

import { supabase } from "../db/client.js";
import type { TitlePageMeta } from "@toburt/shared";

/** Pull writers / creators / studio / contact / copyright off a script. */
function readScriptTitlePage(scriptMetadata: unknown): Partial<TitlePageMeta> {
  const m = (scriptMetadata as Record<string, unknown>) ?? {};
  const tp = (m.titlePage as Record<string, unknown>) ?? {};
  const sArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;
  const s = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  return {
    writers: sArr(tp.writers),
    creators: sArr(tp.creators),
    basedOn: s(tp.basedOn),
    draftDate: s(tp.draftDate),
    contact: s(tp.contact),
    studio: s(tp.studio),
    copyright: s(tp.copyright),
    includeContact: typeof tp.includeContact === "boolean" ? (tp.includeContact as boolean) : true,
  };
}

/** Format a Date as "May 30, 2026". */
function formatDate(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Resolve the full TitlePageMeta from the script + project + episode rows.
 * Reads stored title-page settings from `script.metadata.titlePage`; falls
 * back to sensible defaults (series title from project; draft label from
 * draft_number; date = today) so a Title Page is always renderable, but only
 * shows credits the user has actually set.
 */
export async function resolveTitlePage(scriptId: string): Promise<TitlePageMeta> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("project_id, episode_id, draft_number, metadata")
    .eq("id", scriptId)
    .single();
  if (error) throw error;

  const { data: proj } = await supabase
    .from("projects")
    .select("title")
    .eq("id", script.project_id)
    .maybeSingle();

  let episodeCredit: string | undefined;
  if (script.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number, title, title_status")
      .eq("id", script.episode_id)
      .maybeSingle();
    if (ep) {
      const epNum = ep.number as number;
      // Only render the approved title — never AI suggestions.
      const epTitle = ep.title_status === "approved" && ep.title ? (ep.title as string) : null;
      episodeCredit = epTitle ? `Episode ${epNum}: "${epTitle}"` : `Episode ${epNum}`;
    }
  }

  const stored = readScriptTitlePage(script.metadata);
  return {
    seriesTitle: (proj?.title as string) ?? "Untitled",
    episodeCredit,
    writers: stored.writers,
    creators: stored.creators,
    basedOn: stored.basedOn,
    draftLabel: `Draft ${script.draft_number}`,
    draftDate: stored.draftDate ?? formatDate(new Date()),
    contact: stored.contact,
    studio: stored.studio,
    copyright: stored.copyright,
    includeContact: stored.includeContact ?? true,
  };
}

/** Persist edits to a script's title-page settings. AI must not call this. */
export async function setTitlePage(
  scriptId: string,
  patch: Partial<TitlePageMeta>
): Promise<TitlePageMeta> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const meta = { ...((script.metadata as Record<string, unknown>) ?? {}) };
  const prev = ((meta.titlePage as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...prev };
  // Only persist user-editable fields (NOT seriesTitle, episodeCredit,
  // draftLabel — those are derived from the project/episode/draft rows).
  for (const key of [
    "writers",
    "creators",
    "basedOn",
    "draftDate",
    "contact",
    "studio",
    "copyright",
    "includeContact",
  ] as const) {
    if (patch[key] !== undefined) next[key] = patch[key];
  }
  meta.titlePage = next;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);
  return resolveTitlePage(scriptId);
}

/**
 * Render the Fountain title-page metadata block. This block sits at the very
 * top of the .fountain file followed by ONE blank line before the body.
 *
 * Format (Fountain spec):
 *   Title: SELVAJE
 *   Credit: Episode 1: "Arrival"
 *   Author: Christopher Maretich
 *   Source: Created by Christopher Maretich
 *   Draft date: May 30, 2026
 *   Contact: Toburt Studios — contact@toburt.studio
 */
export function renderFountainTitlePage(tp: TitlePageMeta): string {
  const lines: string[] = [];
  lines.push(`Title: ${tp.seriesTitle}`);
  if (tp.episodeCredit) lines.push(`Credit: ${tp.episodeCredit}`);
  if (tp.writers?.length) lines.push(`Author: ${tp.writers.join(", ")}`);
  if (tp.creators?.length) lines.push(`Source: Created by ${tp.creators.join(", ")}`);
  if (tp.basedOn) lines.push(`Notes: Based on ${tp.basedOn}`);
  if (tp.draftLabel) lines.push(`Draft: ${tp.draftLabel}`);
  if (tp.draftDate) lines.push(`Draft date: ${tp.draftDate}`);
  if (tp.studio && tp.includeContact !== false) lines.push(`Source: ${tp.studio}`);
  if (tp.contact && tp.includeContact !== false) lines.push(`Contact: ${tp.contact}`);
  if (tp.copyright) lines.push(`Copyright: ${tp.copyright}`);
  return lines.join("\n");
}

/** Is the title page complete enough to ship to a network / festival? */
export function exportReadiness(
  tp: TitlePageMeta
): { ready: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!tp.writers?.length) missing.push("Written by");
  if (!tp.creators?.length) missing.push("Created by");
  if (!tp.draftLabel) missing.push("Draft label");
  if (!tp.draftDate) missing.push("Draft date");
  return { ready: missing.length === 0, missing };
}
