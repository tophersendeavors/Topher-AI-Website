// Lock guard for the `scripts` table.
//
// `scripts.metadata.lockedWritingDraft === true` marks a draft as a creative
// source-of-truth (e.g. an R9 polished draft promoted by the redevelopment
// pipeline). When this flag is set, NO scene-writing path may mutate the
// draft's `fountain`, its `script_scenes` rows, or demote it from `current`.
//
// The flag is enforced at the lowest level (the primitives `indexScenes` and
// `reassembleLiveFountain`, the gated drafter, and `syncDraftToScripts`) so
// no higher-level caller can accidentally bypass it.
//
// To intentionally mutate a locked draft (e.g. for a verified restore from
// source-of-truth), callers pass `{ allowLocked: true }` to the primitive.
// This is an opt-in escape hatch reserved for ops scripts.

import { supabase } from "../db/client.js";

/** True iff the script's metadata declares it locked from creative mutation. */
export async function isScriptLocked(scriptId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .maybeSingle();
  if (error) {
    // Fail safe: if we can't determine state, assume locked. Better to
    // reject a legitimate write than to mutate something we shouldn't.
    // eslint-disable-next-line no-console
    console.warn("[lockGuard] could not read scripts.metadata:", error.message, "— failing safe (locked)");
    return true;
  }
  if (!data) return false;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  return meta.lockedWritingDraft === true;
}

/** Throws a clear error if the script is locked. Call before any write to
 *  `scripts.fountain` or `script_scenes` rows belonging to `scriptId`. */
export async function assertScriptUnlockedForMutation(
  scriptId: string,
  context: string
): Promise<void> {
  if (await isScriptLocked(scriptId)) {
    throw new LockedDraftError(
      `This draft is locked (metadata.lockedWritingDraft = true). ` +
        `Operation "${context}" was blocked. ` +
        `To continue, create a NEW draft from this source instead of modifying it.`
    );
  }
}

/** Distinguishable error class so route handlers can map this to a 409 + a
 *  user-readable message instead of a generic 500. */
export class LockedDraftError extends Error {
  readonly code = "LOCKED_DRAFT" as const;
  constructor(message: string) {
    super(message);
    this.name = "LockedDraftError";
  }
}

/** Before a syncDraftToScripts-style demote (`update({ current: false })` over
 *  a project/episode scope), check whether any current row in scope is locked.
 *  If so, refuse — unless the caller explicitly opts in via
 *  `allowLockedDemotion: true`. */
export async function assertCanDemoteLockedCurrent(
  scope: { projectId: string; episodeId: string | null },
  opts: { allowLockedDemotion?: boolean } = {}
): Promise<void> {
  if (opts.allowLockedDemotion) return;
  let q = supabase
    .from("scripts")
    .select("id, draft_number, metadata")
    .eq("project_id", scope.projectId)
    .eq("current", true);
  q = scope.episodeId ? q.eq("episode_id", scope.episodeId) : q.is("episode_id", null);
  const { data, error } = await q;
  if (error) {
    // Fail safe: assume locked.
    throw new LockedDraftError(
      `Could not verify lock state before demote: ${error.message}. Aborting to protect the current draft.`
    );
  }
  const locked = (data ?? []).filter((row) => {
    const m = (row.metadata ?? {}) as Record<string, unknown>;
    return m.lockedWritingDraft === true;
  });
  if (locked.length > 0) {
    const names = locked.map((r) => `Draft ${r.draft_number}`).join(", ");
    throw new LockedDraftError(
      `Refusing to demote ${names} — the current draft is locked. ` +
        `Pass allowLockedDemotion only when explicitly promoting a NEW draft ` +
        `from a verified source. UI flow: "Start new draft from this source".`
    );
  }
}

/** Shape of metadata that any new draft created from a locked source must
 *  carry. Surfaces provenance so the UI can show "Generated from Draft 5 (R9
 *  final polish)" instead of leaving the new draft unattributed. */
export interface NewDraftProvenance {
  sourceScriptId: string;
  sourceDraftNumber: number;
  generatedBy: string;
  createdFromLockedDraft: boolean;
  priorCurrentScriptId: string | null;
}

/** Read provenance fields off a draft's metadata for the UI banner. */
export function readProvenance(
  metadata: Record<string, unknown> | null | undefined
): Partial<NewDraftProvenance> {
  const m = (metadata ?? {}) as Record<string, unknown>;
  return {
    sourceScriptId: typeof m.sourceScriptId === "string" ? m.sourceScriptId : undefined,
    sourceDraftNumber: typeof m.sourceDraftNumber === "number" ? m.sourceDraftNumber : undefined,
    generatedBy: typeof m.generatedBy === "string" ? m.generatedBy : undefined,
    createdFromLockedDraft: m.createdFromLockedDraft === true,
    priorCurrentScriptId:
      typeof m.priorCurrentScriptId === "string" ? m.priorCurrentScriptId : null,
  };
}
