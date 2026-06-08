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

export async function indexScenes(
  scriptId: string,
  fountain: string
): Promise<{ count: number }> {
  const parsed = parseFountain(fountain);

  await supabase.from("script_scenes").delete().eq("script_id", scriptId);
  if (parsed.scenes.length === 0) return { count: 0 };

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
  }));
  const { error } = await supabase.from("script_scenes").insert(rows);
  if (error) throw error;
  return { count: rows.length };
}
