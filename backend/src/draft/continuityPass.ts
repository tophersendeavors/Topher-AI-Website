import { runAgent } from "../agents/runner.js";
import { continuityAgent } from "../agents/continuity.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { supabase } from "../db/client.js";
import { syncStoredSluglines } from "./reassemble.js";
import type { ContinuityIssue } from "@toburt/shared";

export type ContinuityIssueRow = ContinuityIssue & {
  id?: string;
  resolved?: boolean;
};

export type ContinuityResult = {
  issues: ContinuityIssueRow[];
  scriptId: string;
  ranAt: string;
  grounded?: number;
  discarded?: number;
  rawCount?: number;
  suppressedByApproval?: number;
  /** Stored sluglines that were re-synced to match the scene body. */
  metadataSynced?: Array<{ ord: number; from: string; to: string }>;
  /** Issues the user resolved-with-note as deliberate (shown as a report). */
  approvedIntents?: ResolutionRecord[];
};

/**
 * Run the Continuity agent against a saved script. Persists every issue
 * to the existing `continuity_issues` table so the Continuity sidebar page
 * starts populating. Returns the structured report for inline display in
 * the workspace.
 */
export async function runContinuityPass(
  scriptId: string,
  user?: { id: string; name?: string },
  notes?: string,
  mode: "strict" | "standard" | "supervisor" = "strict"
): Promise<ContinuityResult> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("id, project_id, title, fountain")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  if (!script.fountain || script.fountain.trim().length < 50) {
    throw new Error(
      "Script is empty. Generate at least one scene before running Continuity."
    );
  }

  // VALIDATION RULE: before reading scene metadata, re-sync each scene's stored
  // slugline to the heading actually written in its body. This is a
  // metadata/body mismatch repair — it is NEVER a scene rewrite. It guarantees
  // the checker (which reads stored sluglines) and the fixer (which reads the
  // body) compare the same source of truth, killing false "duplicate slugline"
  // flags caused by stale metadata.
  const metadataSynced = await syncStoredSluglines(scriptId);

  // User-approved intents: issues the user resolved-with-note as deliberate.
  // We tell the agent not to re-flag them, AND suppress them deterministically
  // below — so the same approved choice doesn't keep getting re-raised.
  const approved = await listResolutions(scriptId);

  // Pull per-scene metadata + bodies so the agent can cite scenes by ord AND
  // so we can re-map every issue to the scene whose body actually contains the
  // quoted evidence (rather than trusting the agent's guessed ord).
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline, tags, status, fountain")
    .eq("script_id", scriptId)
    .in("status", ["generated", "revised", "locked"])
    .order("ord", { ascending: true });

  const sceneIndex = (scenes ?? []).map((s) => ({
    ord: s.ord as number,
    slugline: s.slugline as string,
    characters: (s.tags as string[]) ?? [],
  }));

  // ord -> normalized body text, for locating issues by quoted evidence.
  const ordBodies = (scenes ?? []).map((s) => ({
    ord: s.ord as number,
    body: normalizeForMatch((s.fountain as string) ?? ""),
  }));
  const locateByEvidence = (evidence: string[]): number[] => {
    const found = new Set<number>();
    for (const q of evidence) {
      const nq = normalizeForMatch(q);
      if (nq.length < 12) continue; // too short to be a reliable locator
      for (const sb of ordBodies) if (sb.body.includes(nq)) found.add(sb.ord);
    }
    return [...found].sort((a, b) => a - b);
  };

  const aCtx = await hydrateContext({
    projectId: script.project_id,
    stage: "continuity_pass",
    collaborators: ["continuity", "world"],
    query: script.title,
    user,
  });
  // CRITICAL: continuity analyzes the CURRENT draft only. Retrieved drafts are
  // stale snapshots of this same script from earlier passes — they contain
  // pre-edit names/content and cause false positives (e.g. flagging a name we
  // already normalized away). Strip them so `draftFountain` is the sole truth.
  aCtx.retrievedDrafts = [];
  aCtx.retrievedCanon = [];

  const approvedText = approved.length
    ? "USER-APPROVED INTENTS — do NOT re-flag these; they are deliberate:\n" +
      approved
        .map(
          (a) =>
            `- [${a.continuityKind}]${a.sceneOrds.length ? ` scenes ${a.sceneOrds.join(", ")}` : ""}: ${a.rationale}`
        )
        .join("\n")
    : "";
  const agentNotes = [notes, approvedText].filter(Boolean).join("\n\n") || undefined;

  const { output } = await runAgent(
    continuityAgent,
    {
      scope: { scriptId },
      draftFountain: script.fountain,
      sceneIndex,
      userNotes: agentNotes,
      mode,
    },
    aCtx,
    { maxTokens: 6000, maxToolRounds: 1 }
  );

  // The agent can return null/empty output (e.g. it coerced to nothing after
  // exhausting rounds). Guard before reading `.issues`. Also accept a few
  // alternate shapes the model uses.
  const outObj =
    output && typeof output === "object" ? (output as Record<string, unknown>) : {};
  const rawIssues = (Array.isArray(outObj.issues)
    ? outObj.issues
    : Array.isArray(outObj.continuityIssues)
    ? outObj.continuityIssues
    : Array.isArray(outObj.conflicts)
    ? outObj.conflicts
    : []) as unknown[];
  const validKinds = new Set([
    "wardrobe",
    "location",
    "timeline",
    "relationship",
    "prop",
  ]);
  const validSev = new Set(["info", "warn", "critical"]);
  type RawIssue = ContinuityIssue & { evidence: string[] };
  const issues: RawIssue[] = rawIssues
    .map((raw): RawIssue | null => {
      const i = (raw ?? {}) as Record<string, unknown>;
      const kindRaw = String(i.kind ?? "").toLowerCase();
      const kind = validKinds.has(kindRaw)
        ? (kindRaw as ContinuityIssue["kind"])
        : null;
      const sevRaw = String(i.severity ?? "warn").toLowerCase();
      const severity = validSev.has(sevRaw)
        ? (sevRaw as ContinuityIssue["severity"])
        : "warn";
      const note =
        typeof i.note === "string"
          ? i.note
          : typeof i.body === "string"
          ? i.body
          : typeof i.description === "string"
          ? i.description
          : "";
      if (!kind || !note) return null;
      const sceneIdsRaw =
        (i.sceneIds as unknown) ??
        (i.sceneOrds as unknown) ??
        (i.scenes as unknown) ??
        [];
      const sceneIds = Array.isArray(sceneIdsRaw)
        ? sceneIdsRaw.map((s) => String(s))
        : [];
      const suggestedFix =
        typeof i.suggestedFix === "string"
          ? i.suggestedFix
          : typeof i.fix === "string"
          ? i.fix
          : typeof i.suggestion === "string"
          ? i.suggestion
          : undefined;
      const evidence = Array.isArray(i.evidence)
        ? (i.evidence as unknown[]).filter(
            (e): e is string => typeof e === "string" && e.trim().length > 0
          )
        : [];
      return { kind, severity, sceneIds, note, suggestedFix, evidence };
    })
    .filter((x): x is RawIssue => x !== null);

  // ----------------------------------------------------------------------
  // SCENE RE-MAPPING: the agent often cites the wrong scene ord. Locate each
  // issue by the scene(s) whose BODY actually contains the quoted evidence and
  // override the agent's ords — so "Jump to #N" and "Fix scene #N" always
  // point at the scene the quote really lives in, not stale index metadata.
  // ----------------------------------------------------------------------
  for (const issue of issues) {
    const located = locateByEvidence(issue.evidence);
    if (located.length > 0) issue.sceneIds = located.map(String);
  }

  // ----------------------------------------------------------------------
  // GROUNDING GUARDRAIL: discard any issue whose evidence is not literally
  // present in the current draft. The agent confabulates names/details from
  // training priors and stale context; this filter keeps only issues that
  // quote text actually in `script.fountain`.
  // ----------------------------------------------------------------------
  const haystack = normalizeForMatch(script.fountain);
  const isGrounded = (issue: RawIssue) => {
    // 1) Prefer explicit evidence quotes — require at least one substantive
    //    quote (>= 12 chars) to appear verbatim in the draft.
    const quotes = issue.evidence.filter((q) => q.trim().length >= 12);
    if (quotes.length > 0) {
      return quotes.some((q) => haystack.includes(normalizeForMatch(q)));
    }
    // 2) No usable evidence → fall back to proper-noun grounding: every
    //    Capitalized/ALL-CAPS name token cited in the note must exist in the
    //    draft. If the note cites a name not in the draft, it's confabulated.
    const names = extractNameTokens(issue.note);
    if (names.length === 0) return false; // no evidence, no checkable names → discard
    return names.every((n) => haystack.includes(normalizeForMatch(n)));
  };

  const grounded = issues.filter(isGrounded);
  const discarded = issues.length - grounded.length;

  // APPROVED-INTENT SUPPRESSION: drop any grounded issue the user already
  // resolved-with-note as deliberate (same kind + its scenes ⊆ the approved
  // scenes). This is what stops the same intentional choice being re-flagged.
  const issueOrds = (issue: RawIssue): number[] =>
    issue.sceneIds.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const isApproved = (issue: RawIssue): boolean => {
    const ords = issueOrds(issue);
    return approved.some(
      (a) =>
        a.continuityKind === issue.kind &&
        a.sceneOrds.length > 0 &&
        ords.length > 0 &&
        ords.every((o) => a.sceneOrds.includes(o))
    );
  };
  // Deterministic severity gate by mode (backstop to the agent's own filtering).
  const allowedSeverities =
    mode === "strict"
      ? new Set(["critical"])
      : mode === "standard"
      ? new Set(["critical", "warn"])
      : new Set(["critical", "warn", "info"]);
  const inMode = grounded.filter((i) => allowedSeverities.has(i.severity));

  const confirmed = inMode.filter((i) => !isApproved(i));
  const suppressedByApproval = inMode.length - confirmed.length;
  // eslint-disable-next-line no-console
  console.log(
    `[continuity] grounding guardrail: ${confirmed.length} confirmed, ${discarded} discarded, ${suppressedByApproval} suppressed (user-approved) of ${issues.length} raw.`
  );
  const issuesToPersist = confirmed;

  // If the agent produced no usable output at all (null/empty response that
  // coerced to nothing), treat it as a FAILED run: don't clear the prior
  // issues, surface an error so the user can retry. Only a genuine result —
  // even an empty one — should replace the snapshot.
  if (!output || (typeof output === "object" && rawIssues.length === 0 && !("issues" in outObj))) {
    throw new Error(
      "Continuity agent returned no usable output (check /tmp/toburt-llm-dumps). Previous issues kept — try running again."
    );
  }

  // Each run is a FRESH SNAPSHOT of the current draft. Clear the prior
  // UNRESOLVED issues for this script before inserting the new scan, so the
  // list reflects the current state instead of stacking run-on-run. Resolved
  // issues are kept as history.
  await supabase
    .from("continuity_issues")
    .delete()
    .eq("script_id", script.id)
    .eq("resolved", false);

  // Persist ONLY the grounded (confirmed) issues.
  const persisted: ContinuityIssueRow[] = [];
  for (const issue of issuesToPersist) {
    const { data: row, error: pErr } = await supabase
      .from("continuity_issues")
      .insert({
        project_id: script.project_id,
        script_id: script.id,
        episode_id: null,
        kind: issue.kind,
        severity: issue.severity,
        // The schema column is `scene_ids uuid[]` but the agent emits ords
        // like ["3","5"]. Store them as text in scene_ids only if all parse
        // as UUIDs; otherwise leave empty and keep the ords in the note.
        scene_ids: issue.sceneIds.every((s) =>
          /^[0-9a-f-]{36}$/i.test(s)
        )
          ? issue.sceneIds
          : [],
        note:
          issue.sceneIds.length > 0 && !issue.sceneIds.every((s) =>
            /^[0-9a-f-]{36}$/i.test(s)
          )
            ? `[scenes ${issue.sceneIds.join(", ")}] ${issue.note}`
            : issue.note,
        suggested_fix: issue.suggestedFix ?? null,
        resolved: false,
      })
      .select("id")
      .single();
    if (pErr) {
      // Don't fail the whole pass if one row can't persist; surface in logs.
      // eslint-disable-next-line no-console
      console.warn("[continuity] failed to persist issue:", pErr.message);
      persisted.push({ ...issue, resolved: false });
    } else {
      persisted.push({ ...issue, id: row.id, resolved: false });
    }
  }

  return {
    issues: persisted,
    scriptId,
    ranAt: new Date().toISOString(),
    grounded: confirmed.length,
    discarded,
    rawCount: issues.length,
    suppressedByApproval,
    metadataSynced,
    approvedIntents: approved,
  };
}

/** Normalize text for literal substring matching: lowercase, collapse
 *  whitespace, unify dashes/quotes. */
function normalizeForMatch(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[—–-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull Capitalized or ALL-CAPS proper-noun tokens (names) from a note so we
 *  can verify they actually exist in the draft. */
function extractNameTokens(note: string): string[] {
  const tokens = new Set<string>();
  // ALL-CAPS names like MARINA VOSS, DR. CASTELLANO
  for (const m of note.matchAll(/\b([A-Z][A-Z.'’-]{2,}(?:\s+[A-Z][A-Z.'’-]{2,})*)\b/g)) {
    tokens.add(m[1]);
  }
  // 'Quoted' or "quoted" specific names
  for (const m of note.matchAll(/['"]([A-Z][\w.'’ -]{2,}?)['"]/g)) {
    tokens.add(m[1]);
  }
  // Filter out generic ALL-CAPS words that aren't names.
  const stop = new Set([
    "INT", "EXT", "DAY", "NIGHT", "DAWN", "DUSK", "VILLA", "SCENE", "THE",
    "AND", "VS", "CUT", "FADE", "CONTINUOUS",
  ]);
  return [...tokens].filter((t) => !stop.has(t.replace(/[^A-Z]/g, "")));
}

/**
 * Resolve a single continuity issue (mark as fixed). Used by the UI when
 * the user clicks "Resolved" on a card.
 */
export async function resolveContinuityIssue(issueId: string): Promise<void> {
  const { error } = await supabase
    .from("continuity_issues")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", issueId);
  if (error) throw error;
}

/** Parse scene ords from an issue's "[scenes 3, 5] ..." note prefix. */
function ordsFromNote(note: string): number[] {
  const m = (note ?? "").match(/^\[scenes\s+([\d, ]+)\]/i);
  return m
    ? m[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    : [];
}

export type ResolutionRecord = {
  id: string;
  continuityKind: string;
  issueNote: string;
  sceneOrds: number[];
  rationale: string;
  created_at: string;
};

/**
 * Resolve an issue WITH a note. Marks it resolved AND records the user's
 * reasoning as a durable "user-approved intent" (a memory_entries note that
 * survives future continuity scans). Future checks read these and stop
 * re-flagging the same deliberate choice.
 */
export async function resolveIssueWithNote(issueId: string, note: string): Promise<void> {
  const { data: issue, error } = await supabase
    .from("continuity_issues")
    .select("id, project_id, script_id, kind, note")
    .eq("id", issueId)
    .single();
  if (error) throw error;

  await supabase
    .from("continuity_issues")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", issueId);

  await supabase.from("memory_entries").insert({
    project_id: issue.project_id,
    scope: "project" as const,
    scope_ref: issue.script_id,
    kind: "note" as const,
    body: {
      kind: "continuity_resolution",
      continuityKind: issue.kind,
      issueNote: String(issue.note ?? "").replace(/^\[scenes[^\]]+\]\s*/i, ""),
      sceneOrds: ordsFromNote(String(issue.note ?? "")),
      rationale: note,
      ts: new Date().toISOString(),
    },
    approved: true,
  });
}

/** List the user-approved continuity resolutions recorded for a script. */
export async function listResolutions(scriptId: string): Promise<ResolutionRecord[]> {
  const { data } = await supabase
    .from("memory_entries")
    .select("id, body, created_at")
    .eq("scope_ref", scriptId)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((m) => (m.body as { kind?: string })?.kind === "continuity_resolution")
    .map((m) => {
      const b = m.body as Record<string, unknown>;
      return {
        id: m.id as string,
        continuityKind: String(b.continuityKind ?? ""),
        issueNote: String(b.issueNote ?? ""),
        sceneOrds: Array.isArray(b.sceneOrds) ? (b.sceneOrds as number[]) : [],
        rationale: String(b.rationale ?? ""),
        created_at: m.created_at as string,
      };
    });
}
