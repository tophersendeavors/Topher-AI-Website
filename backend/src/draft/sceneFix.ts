import { callLLM } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";
import { reassembleLiveFountain } from "./reassemble.js";
import { firstSlugline } from "../screenplay/fountain.js";

/**
 * Apply a day/time marker (e.g. "DAY TWO", "DAWN / DAY THREE") to every scene
 * in an ord range by editing ONLY the heading line of each scene body — no
 * prose is rewritten. The marker is added as a trailing parenthetical, and any
 * existing trailing parenthetical marker is replaced (so re-applying is
 * idempotent). Stored sluglines re-sync from the bodies on reassemble.
 */
export async function applyTimelineRange(args: {
  scriptId: string;
  from: number;
  to: number;
  marker: string;
}): Promise<{ updated: Array<{ ord: number; before: string; after: string }>; skippedLocked: number[] }> {
  const { scriptId } = args;
  const lo = Math.min(args.from, args.to);
  const hi = Math.max(args.from, args.to);
  const marker = args.marker.replace(/^\(+|\)+$/g, "").trim();
  if (!marker) throw new Error("Provide a day/time marker, e.g. DAY TWO.");

  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, slugline, fountain, status")
    .eq("script_id", scriptId)
    .gte("ord", lo)
    .lte("ord", hi)
    .order("ord", { ascending: true });

  const updated: Array<{ ord: number; before: string; after: string }> = [];
  const skippedLocked: number[] = [];

  for (const s of scenes ?? []) {
    if (s.status === "locked") {
      skippedLocked.push(s.ord as number);
      continue;
    }
    const fountain = (s.fountain as string) ?? "";
    const curSlug = firstSlugline(fountain);
    if (!curSlug) continue;
    // Replace any existing trailing parenthetical, then append the marker.
    const base = curSlug.replace(/\s*\([^)]*\)\s*$/, "").trimEnd();
    const newSlug = `${base} (${marker})`;
    if (newSlug === curSlug) continue;

    const lines = fountain.split("\n");
    const idx = lines.findIndex(
      (l) => l.trim().replace(/^\./, "").trim() === curSlug
    );
    if (idx < 0) continue;
    lines[idx] = newSlug;
    const newFountain = lines.join("\n");

    await supabase
      .from("script_scenes")
      .update({
        fountain: newFountain,
        slugline: newSlug,
        status: "revised",
        generated_at: new Date().toISOString(),
      })
      .eq("id", s.id);
    updated.push({ ord: s.ord as number, before: curSlug, after: newSlug });
  }

  await reassembleLiveFountain(scriptId);
  return { updated, skippedLocked };
}

/**
 * Apply MULTIPLE day/time markers across multiple scene ranges in one pass
 * (e.g. 11–15 → DAY TWO, 16–18 → DAY THREE). Heading-only, no prose rewrite.
 * On overlap, the last range covering a scene wins. Reassembles once.
 */
export async function applyTimelineRanges(args: {
  scriptId: string;
  ranges: Array<{ from: number; to: number; marker: string }>;
}): Promise<{
  updated: Array<{ ord: number; before: string; after: string; marker: string }>;
  skippedLocked: number[];
}> {
  const { scriptId } = args;
  // ord -> marker (last range covering an ord wins).
  const ordMarker = new Map<number, string>();
  for (const r of args.ranges ?? []) {
    const marker = (r.marker ?? "").replace(/^\(+|\)+$/g, "").trim();
    if (!marker) continue;
    const lo = Math.min(r.from, r.to);
    const hi = Math.max(r.from, r.to);
    for (let n = lo; n <= hi; n++) ordMarker.set(n, marker);
  }
  if (ordMarker.size === 0) {
    throw new Error("Add at least one range with a day/time marker.");
  }

  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("id, ord, slugline, fountain, status")
    .eq("script_id", scriptId)
    .in("ord", [...ordMarker.keys()])
    .order("ord", { ascending: true });

  const updated: Array<{ ord: number; before: string; after: string; marker: string }> = [];
  const skippedLocked: number[] = [];

  for (const s of scenes ?? []) {
    const marker = ordMarker.get(s.ord as number);
    if (!marker) continue;
    if (s.status === "locked") {
      skippedLocked.push(s.ord as number);
      continue;
    }
    const fountain = (s.fountain as string) ?? "";
    const curSlug = firstSlugline(fountain);
    if (!curSlug) continue;
    const base = curSlug.replace(/\s*\([^)]*\)\s*$/, "").trimEnd();
    const newSlug = `${base} (${marker})`;
    if (newSlug === curSlug) continue;
    const lines = fountain.split("\n");
    const idx = lines.findIndex(
      (l) => l.trim().replace(/^\./, "").trim() === curSlug
    );
    if (idx < 0) continue;
    lines[idx] = newSlug;
    await supabase
      .from("script_scenes")
      .update({
        fountain: lines.join("\n"),
        slugline: newSlug,
        status: "revised",
        generated_at: new Date().toISOString(),
      })
      .eq("id", s.id);
    updated.push({ ord: s.ord as number, before: curSlug, after: newSlug, marker });
  }

  await reassembleLiveFountain(scriptId);
  return { updated, skippedLocked };
}

export type ProposedFix = {
  ord: number;
  slugline: string;
  before: string;
  after: string;
  summary: string;
  changed: boolean;
};

/** Strip a leading/trailing markdown code fence if the model added one. */
function stripFence(s: string): string {
  const t = s.trim();
  const m = t.match(/^```(?:fountain|text)?\n([\s\S]*?)\n```$/);
  return (m ? m[1] : t).trim();
}

/** Coarse line-change count for a quick "what will change" summary. */
function diffSummary(before: string, after: string): { changed: boolean; summary: string } {
  const a = before.split("\n");
  const b = after.split("\n");
  const setA = new Map<string, number>();
  for (const l of a) setA.set(l, (setA.get(l) ?? 0) + 1);
  let removed = 0;
  for (const l of a) {
    const idx = b.indexOf(l);
    if (idx === -1) removed++;
  }
  const setB = new Map<string, number>();
  for (const l of b) setB.set(l, (setB.get(l) ?? 0) + 1);
  let added = 0;
  for (const l of b) {
    if (a.indexOf(l) === -1) added++;
  }
  const changed = before.trim() !== after.trim();
  if (!changed) return { changed: false, summary: "No change — the scene already satisfies this." };
  const parts: string[] = [];
  if (added) parts.push(`${added} line${added === 1 ? "" : "s"} added/changed`);
  if (removed) parts.push(`${removed} line${removed === 1 ? "" : "s"} removed/changed`);
  return { changed: true, summary: parts.join(", ") || "Minor text change" };
}

/**
 * Propose a TARGETED fix to a single scene WITHOUT saving it. The prompt makes
 * the smallest edit that satisfies the instruction and preserves everything
 * else verbatim — it only rewrites prose/dialogue when the instruction
 * explicitly asks. The caller shows the before/after to the user, who accepts,
 * rejects, or revises before anything is committed (see applySceneFix).
 */
export async function proposeSceneFix(args: {
  scriptId: string;
  ord: number;
  instruction: string;
}): Promise<ProposedFix> {
  const { scriptId, ord, instruction } = args;
  const { data: scene, error } = await supabase
    .from("script_scenes")
    .select("id, ord, slugline, fountain")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (error) throw new Error(`Scene ${ord} not found.`);
  const before = (scene.fountain as string) ?? "";
  if (!before.trim()) {
    throw new Error(`Scene ${ord} has no content to fix yet.`);
  }

  const system = [
    "You are a precise screenplay line-editor. You apply ONE targeted fix to a",
    "single scene and return the full updated scene in Fountain format.",
    "",
    "RULES (follow exactly):",
    "- Make the SMALLEST possible change that satisfies the instruction.",
    "- Change ONLY what the instruction names — e.g. a slugline, a character",
    "  name, an age, a prop, a continuity detail, a typo.",
    "- Preserve EVERY other line — action, dialogue, parentheticals,",
    "  transitions, blank lines, formatting — exactly as written, verbatim.",
    "- Do NOT rewrite prose, dialogue, tone, or pacing UNLESS the instruction",
    "  explicitly tells you to rewrite them.",
    "- Do not add scenes, characters, or commentary.",
    "",
    "Return ONLY the full updated scene in Fountain — no preamble, no fences,",
    "no explanation.",
  ].join("\n");

  const userMsg = [
    `INSTRUCTION:\n${instruction}`,
    "",
    "CURRENT SCENE (edit this, return the full scene):",
    before,
  ].join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    temperature: 0.2,
    maxTokens: 4096,
  });

  const after = stripFence(res.text);
  if (!after) {
    throw new Error("The editor returned an empty scene. Try again or revise the instruction.");
  }
  const { changed, summary } = diffSummary(before, after);
  return {
    ord,
    slugline: scene.slugline as string,
    before,
    after,
    summary,
    changed,
  };
}

/**
 * Commit a previously-proposed fix the user accepted. Snapshots the prior
 * fountain into script_scene_versions (so it can be restored), updates the
 * scene, and reassembles the live draft. Locked scenes are refused.
 */
export async function applySceneFix(args: {
  scriptId: string;
  ord: number;
  after: string;
  instruction?: string;
  /** Named pass label that produced this revision (e.g. "SubtextPass"). */
  passLabel?: string;
}): Promise<{ ok: true; ord: number }> {
  const { scriptId, ord, after, instruction, passLabel } = args;
  const { data: scene, error } = await supabase
    .from("script_scenes")
    .select("id, fountain, last_pass, notes, status")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (error) throw new Error(`Scene ${ord} not found.`);
  if (scene.status === "locked") {
    throw new Error(`Scene ${ord} is locked. Unlock it before applying a fix.`);
  }

  // Snapshot the prior content so the user can restore it.
  if (scene.fountain && (scene.fountain as string).trim().length > 0) {
    await supabase.from("script_scene_versions").insert({
      scene_id: scene.id,
      fountain: scene.fountain,
      last_pass: scene.last_pass ?? null,
      notes: instruction ? `Snapshot before fix: ${instruction}` : "Snapshot before targeted fix",
    });
  }

  const priorNotes = typeof scene.notes === "string" ? scene.notes.trim() : "";
  const mergedNotes = instruction
    ? [priorNotes, `Fix applied: ${instruction}`].filter(Boolean).join("\n")
    : priorNotes || null;

  await supabase
    .from("script_scenes")
    .update({
      fountain: after,
      status: "revised",
      generated_at: new Date().toISOString(),
      notes: mergedNotes,
      ...(passLabel ? { last_pass: passLabel } : {}),
    })
    .eq("id", scene.id);

  await reassembleLiveFountain(scriptId);
  return { ok: true, ord };
}
