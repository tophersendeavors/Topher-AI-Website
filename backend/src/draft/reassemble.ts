import { supabase } from "../db/client.js";
import { firstSlugline } from "../screenplay/fountain.js";
import { assertScriptUnlockedForMutation } from "./lockGuard.js";

/** Normalize a slugline for comparison (case/space/dash-insensitive). */
function normSlug(s: string): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/[—–-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keep each live scene's STORED slugline in sync with the slugline actually
 * written in its body. The continuity checker reads the stored slugline (via
 * its sceneIndex) while the body is the rendered truth — if they drift, the
 * checker flags false duplicates and the surgical fixer (which reads the body)
 * sees "no change needed". Syncing makes both read the same source of truth.
 * Returns the corrections made so callers can surface them.
 */
export async function syncStoredSluglines(
  scriptId: string
): Promise<Array<{ ord: number; from: string; to: string }>> {
  const { data: rows } = await supabase
    .from("script_scenes")
    .select("id, ord, slugline, fountain, status")
    .eq("script_id", scriptId)
    .in("status", ["generated", "revised", "locked"]);
  const corrections: Array<{ ord: number; from: string; to: string }> = [];
  for (const r of rows ?? []) {
    const bodySlug = firstSlugline((r.fountain as string) ?? "");
    if (!bodySlug) continue;
    const stored = ((r.slugline as string) ?? "").trim();
    if (normSlug(bodySlug) !== normSlug(stored)) {
      await supabase
        .from("script_scenes")
        .update({ slugline: bodySlug })
        .eq("id", r.id);
      corrections.push({ ord: r.ord as number, from: stored, to: bodySlug });
    }
  }
  return corrections;
}

/**
 * Rebuild scripts.fountain from the ordered set of LIVE script_scenes
 * (generated / revised / locked). Pending/generating scenes contribute
 * nothing, so the blob view always matches what's live in the grid. Also
 * re-syncs each scene's stored slugline from its body so metadata never drifts.
 */
export async function reassembleLiveFountain(
  scriptId: string,
  opts: { allowLocked?: boolean } = {}
): Promise<void> {
  // Guard: refuse to rewrite the fountain of a locked draft unless the
  // caller has opted in (e.g. ops restore). This is the bottom-of-the-stack
  // gate that protects against every path that calls reassemble.
  if (!opts.allowLocked) {
    await assertScriptUnlockedForMutation(scriptId, "reassembleLiveFountain");
  }

  // Keep stored sluglines aligned with the bodies before assembling.
  await syncStoredSluglines(scriptId);

  const { data: rows } = await supabase
    .from("script_scenes")
    .select("ord, fountain, status")
    .eq("script_id", scriptId)
    .in("status", ["generated", "revised", "locked"])
    .order("ord", { ascending: true });
  const fountain = (rows ?? [])
    .map((r) => (r.fountain ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
  await supabase
    .from("scripts")
    .update({ fountain, updated_at: new Date().toISOString() })
    .eq("id", scriptId);
}
