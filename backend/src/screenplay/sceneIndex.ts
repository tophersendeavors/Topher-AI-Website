// Scene-index helper — replaces all `script_scenes` rows for a given
// scriptId with a fresh parse of the supplied Fountain text. Idempotent:
// re-running on the same script wipes prior rows first, so calling it
// twice produces the same final state. Used by every route that creates
// or rewrites a script's Fountain (POST /scripts, PATCH /scripts/:id,
// new-draft, AND the micro-drama screenplay generator).
//
// Lifted from routes/scripts.ts during Blocker A fix so the micro-drama
// path could reuse it without crossing a routes→routes import (which
// would risk circular deps in the future).

import { supabase } from "../db/client.js";
import { parseFountain } from "./fountain.js";
import { assertScriptUnlockedForMutation } from "../draft/lockGuard.js";

export async function indexScenes(
  scriptId: string,
  fountain: string,
  opts: { allowLocked?: boolean; lockResultRows?: boolean } = {}
): Promise<{ count: number }> {
  // Guard: refuse to re-index a locked draft unless the caller has opted in
  // (e.g. an ops restore script writing the R9 source-of-truth back into the
  // draft).
  if (!opts.allowLocked) {
    await assertScriptUnlockedForMutation(scriptId, "indexScenes");
  }

  const parsed = parseFountain(fountain);

  await supabase.from("script_scenes").delete().eq("script_id", scriptId);
  if (parsed.scenes.length === 0) return { count: 0 };

  const nowIso = new Date().toISOString();
  const rows = parsed.scenes.map((s) => ({
    script_id: scriptId,
    ord: s.order,
    slugline: s.slugline,
    int_ext: s.intExt,
    time_of_day: s.timeOfDay,
    characters: [], // resolved to character ids by a later pass
    summary: null,
    fountain: s.fountain,
    tags: [],
    // When re-indexing a locked source-of-truth, mark every row as
    // generated + locked so the gated drafter never picks them up as
    // "pending" and the reassembler always includes them.
    ...(opts.lockResultRows
      ? { status: "locked", locked_at: nowIso, generated_at: nowIso, last_pass: "indexed_from_locked_source" }
      : {}),
  }));
  const { error } = await supabase.from("script_scenes").insert(rows);
  if (error) throw error;
  return { count: rows.length };
}
