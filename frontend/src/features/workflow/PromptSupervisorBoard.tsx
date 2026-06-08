// Prompt Supervisor Board.
//
// Scene-grouped review of every model prompt before the supervisor signs
// off. Combines two distinct signals into one read:
//
//   1. STALE — bible changed since the prompt was generated. Pulled from
//      /scripts/:id/stale-prompts.
//   2. VALIDATOR ISSUES — the prompt's readiness gate flagged it (word
//      count, hero-image dominance, key-art language, etc.). Pulled from
//      /scripts/:id/ai-prompts (each PromptVersion carries
//      `readiness: { ok, issues[] }`).
//
// Per-row actions:
//   • Inspect    — scrolls the AI Video Prompts panel into view.
//   • Regenerate — current bible only.
//   • Regenerate with notes — supervisor steers the rewrite ("trim under
//     220 words", "lead with phone screen"). Wraps the existing
//     /scripts/:id/scenes/:ord/shots/:shot/prompt endpoint which already
//     accepts a notes field.
//   • Mark reviewed — local supervisor checkmark (does NOT bypass the
//     Approve gate — Stage Approve still runs the full review check).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Eye, Loader2,
  RefreshCw, MessageSquarePlus,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ModelKey, PromptVersion, StalePromptInfo } from "@/lib/api";

interface Props {
  scriptId: string;
  /** Called when the user clicks "Inspect" — typically scrolls the
   *  attached AI Video Prompts panel into view. */
  onInspect?: (sceneOrd: number, shotIndex: number, model: string) => void;
}

interface ShotIssueRow {
  sceneOrd: number;
  shotIndex: number;
  model: ModelKey;
  label: string;
  stale: boolean;
  staleReasons: string[];
  needsRegen: boolean;
  validatorIssues: string[];
  validatorOk: boolean;
}

interface SceneGroup {
  sceneOrd: number;
  sceneLabel: string;
  rows: ShotIssueRow[];
  flaggedCount: number;
}

export function PromptSupervisorBoard({ scriptId, onInspect }: Props) {
  const qc = useQueryClient();

  const staleQ = useQuery({
    queryKey: ["stale-prompts", scriptId],
    queryFn: () => api.detectStalePrompts(scriptId),
  });
  const promptsQ = useQuery({
    queryKey: ["ai-prompts", scriptId],
    queryFn: () => api.getAiPrompts(scriptId),
  });

  const regenAllStale = useMutation({
    mutationFn: () => api.regenerateStalePrompts(scriptId),
    onSuccess: () => invalidateAll(),
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["stale-prompts", scriptId] });
    qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
  };

  // Per-row regen mutations are dispatched by key; we keep the in-flight
  // key in local state so the button can show a spinner without forcing
  // a useMutation per row (there can be dozens of shots).
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const regenerateOne = async (
    sceneOrd: number,
    shotIndex: number,
    model: ModelKey,
    notes?: string
  ) => {
    const key = rowKey(sceneOrd, shotIndex, model);
    setBusyRow(key);
    setError(null);
    try {
      await api.generatePrompt(scriptId, sceneOrd, shotIndex, model, notes);
      invalidateAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyRow(null);
    }
  };

  // Local supervisor marks — purely advisory.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const toggleMark = (k: string) =>
    setMarked((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  // Track which rows have the notes editor open. Multiple can be open
  // at once — the supervisor often wants to set notes on several shots
  // before triggering each.
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set());
  const [notesByRow, setNotesByRow] = useState<Record<string, string>>({});
  const toggleNotes = (k: string) =>
    setNotesOpen((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const grouped: SceneGroup[] = useMemo(() => {
    const staleByKey = new Map<string, StalePromptInfo>();
    for (const s of staleQ.data?.stale ?? []) {
      staleByKey.set(rowKey(s.sceneOrd, s.shotIndex, s.model as ModelKey), s);
    }

    const rowsByScene = new Map<number, ShotIssueRow[]>();
    const seenKeys = new Set<string>();

    // Take every current prompt from /ai-prompts as the spine — these
    // are the rows the supervisor actually needs to inspect.
    for (const p of promptsQ.data?.prompts ?? []) {
      const cur: PromptVersion | undefined = p.current;
      if (!cur) continue;
      const k = rowKey(p.sceneOrd, p.shotIndex, cur.model);
      seenKeys.add(k);
      const stale = staleByKey.get(k);
      const rawIssues = cur.readiness?.issues ?? [];
      const validatorOk = cur.readiness?.ok !== false;
      // Edge case: `readiness.ok === false` but `issues === []`. This
      // happens when the prompt was saved by an older composer version
      // that flipped `ok` without recording WHY. Without this guard the
      // board renders the row as "Ready" because the issues list is
      // empty — misleading. Inject a synthetic explanation so the
      // supervisor can act on it.
      const validatorIssues =
        !validatorOk && rawIssues.length === 0
          ? ["Readiness flag was set false by an earlier composer version with no recorded reason. Regenerate to refresh the readiness check."]
          : rawIssues;
      const row: ShotIssueRow = {
        sceneOrd: p.sceneOrd,
        shotIndex: p.shotIndex,
        model: cur.model,
        label: friendlyLabel(p.sceneOrd, p.shotIndex),
        stale: !!stale,
        staleReasons: stale?.reasons ?? [],
        needsRegen: stale?.needsRegen ?? false,
        validatorIssues,
        validatorOk,
      };
      const list = rowsByScene.get(p.sceneOrd) ?? [];
      list.push(row);
      rowsByScene.set(p.sceneOrd, list);
    }

    // Catch any stale prompts that aren't in /ai-prompts (rare, but
    // possible if a prompt history entry was orphaned).
    for (const s of staleQ.data?.stale ?? []) {
      const k = rowKey(s.sceneOrd, s.shotIndex, s.model as ModelKey);
      if (seenKeys.has(k)) continue;
      const row: ShotIssueRow = {
        sceneOrd: s.sceneOrd,
        shotIndex: s.shotIndex,
        model: s.model as ModelKey,
        label: s.label ?? friendlyLabel(s.sceneOrd, s.shotIndex),
        stale: true,
        staleReasons: s.reasons,
        needsRegen: s.needsRegen,
        validatorIssues: [],
        validatorOk: true,
      };
      const list = rowsByScene.get(s.sceneOrd) ?? [];
      list.push(row);
      rowsByScene.set(s.sceneOrd, list);
    }

    const groups: SceneGroup[] = [];
    Array.from(rowsByScene.keys())
      .sort((a, b) => a - b)
      .forEach((sceneOrd) => {
        const rows = (rowsByScene.get(sceneOrd) ?? []).sort((a, b) =>
          a.shotIndex !== b.shotIndex
            ? a.shotIndex - b.shotIndex
            : a.model.localeCompare(b.model)
        );
        const flaggedCount = rows.filter((r) => r.stale || r.validatorIssues.length > 0).length;
        groups.push({
          sceneOrd,
          sceneLabel: `Scene ${String(sceneOrd + 1).padStart(2, "0")}`,
          rows,
          flaggedCount,
        });
      });
    return groups;
  }, [promptsQ.data, staleQ.data]);

  const totals = useMemo(() => {
    const all = grouped.flatMap((g) => g.rows);
    const stale = all.filter((r) => r.stale).length;
    const validator = all.filter((r) => r.validatorIssues.length > 0).length;
    const flagged = all.filter((r) => r.stale || r.validatorIssues.length > 0).length;
    const ready = all.length - flagged;
    const needsRegen = all.filter((r) => r.needsRegen).length;
    return { total: all.length, stale, validator, flagged, ready, needsRegen };
  }, [grouped]);

  if (staleQ.isLoading || promptsQ.isLoading) {
    return (
      <div className="os-sup-board">
        <div className="text-sm text-bone-400">
          <Loader2 className="inline animate-spin h-4 w-4 mr-1.5" />
          Auditing every model prompt — stale-canon check + readiness validator…
        </div>
      </div>
    );
  }
  const loadErr = staleQ.error || promptsQ.error;
  if (loadErr) {
    return (
      <div className="os-sup-board">
        <div className="text-sm text-red-300">
          Couldn't load prompt audit: {(loadErr as Error).message}
        </div>
      </div>
    );
  }

  const allReady = totals.total > 0 && totals.flagged === 0;

  return (
    <div className="os-sup-board">
      <div className="os-sup-header">
        <div>
          <h2 className="os-sup-title">Prompt Supervisor — Review Board</h2>
          <div className="os-sup-sub">
            Two checks per shot: <b>Stale</b> (bible changed since the prompt was generated)
            and <b>Validator</b> (word count, hero-image dominance, key-art language, etc).
            Steer rewrites with notes.
          </div>
        </div>
        <div className="os-sup-stats">
          <Stat n={totals.total} label="Total prompts" />
          <Stat n={totals.ready} label="Ready" tone={totals.ready > 0 ? "ready" : undefined} />
          <Stat n={totals.stale} label="Stale (canon)" tone={totals.stale > 0 ? "attn" : undefined} />
          <Stat n={totals.validator} label="Validator flags" tone={totals.validator > 0 ? "attn" : undefined} />
          <Stat n={totals.needsRegen} label="Need regen" tone={totals.needsRegen > 0 ? "blocking" : undefined} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => regenAllStale.mutate()}
          disabled={regenAllStale.isPending || totals.needsRegen === 0}
          className="os-btn os-btn-sm os-btn-primary"
          title="Regenerate every prompt the stale-canon check says needs it. Validator-only flags aren't bulk-fixed — those need notes."
        >
          {regenAllStale.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {regenAllStale.isPending
            ? "Regenerating…"
            : `Regenerate ${totals.needsRegen} stale prompt${totals.needsRegen === 1 ? "" : "s"}`}
        </button>
        <button
          type="button"
          onClick={invalidateAll}
          disabled={staleQ.isFetching || promptsQ.isFetching}
          className="os-btn os-btn-sm os-btn-ghost"
        >
          {(staleQ.isFetching || promptsQ.isFetching) ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Re-audit
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-700/30 bg-red-900/10 p-2 text-xs text-red-200">
          {error}
        </div>
      )}

      {allReady ? (
        <div className="rounded border border-emerald-700/30 bg-emerald-900/10 p-4 text-sm text-emerald-200">
          <Check className="inline h-4 w-4 mr-1.5" />
          All {totals.total} prompt{totals.total === 1 ? "" : "s"} are current and pass the readiness validator. Ready for Preflight.
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded border border-white/8 bg-white/[0.02] p-4 text-sm text-bone-400">
          No prompts have been generated yet. Build briefs in earlier stages first.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {grouped.map((g) => (
            <SceneBlock
              key={g.sceneOrd}
              group={g}
              busyRow={busyRow}
              marked={marked}
              notesOpen={notesOpen}
              notesByRow={notesByRow}
              onToggleMark={toggleMark}
              onToggleNotes={toggleNotes}
              onNotesChange={(k, v) => setNotesByRow((prev) => ({ ...prev, [k]: v }))}
              onRegen={(r) => regenerateOne(r.sceneOrd, r.shotIndex, r.model)}
              onRegenWithNotes={(r) => {
                const k = rowKey(r.sceneOrd, r.shotIndex, r.model);
                const n = (notesByRow[k] ?? "").trim();
                if (!n) return;
                regenerateOne(r.sceneOrd, r.shotIndex, r.model, n);
              }}
              onInspect={onInspect}
            />
          ))}
        </div>
      )}

      <div className="text-[11px] text-bone-500 leading-snug">
        Stage Approve runs the full review gate. "Mark reviewed" is a supervisor's
        notebook — it doesn't bypass the gate.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scene group — collapsible, sorts flagged rows above clean ones.
// ---------------------------------------------------------------------------
function SceneBlock({
  group,
  busyRow,
  marked,
  notesOpen,
  notesByRow,
  onToggleMark,
  onToggleNotes,
  onNotesChange,
  onRegen,
  onRegenWithNotes,
  onInspect,
}: {
  group: SceneGroup;
  busyRow: string | null;
  marked: Set<string>;
  notesOpen: Set<string>;
  notesByRow: Record<string, string>;
  onToggleMark: (k: string) => void;
  onToggleNotes: (k: string) => void;
  onNotesChange: (k: string, v: string) => void;
  onRegen: (r: ShotIssueRow) => void;
  onRegenWithNotes: (r: ShotIssueRow) => void;
  onInspect?: (sceneOrd: number, shotIndex: number, model: string) => void;
}) {
  // Default: scene open only when there are flagged rows. The supervisor
  // can expand clean scenes manually.
  const [open, setOpen] = useState(group.flaggedCount > 0);
  const flaggedRows = group.rows.filter((r) => r.stale || r.validatorIssues.length > 0);
  const cleanRows = group.rows.filter((r) => !r.stale && r.validatorIssues.length === 0);

  return (
    <div className="os-sup-scene">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="os-sup-scene-head w-full text-left"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="os-sup-scene-h">{group.sceneLabel}</span>
        </div>
        <div className="text-[11px] text-bone-400">
          {group.flaggedCount > 0 ? (
            <span className="text-amber-300">
              {group.flaggedCount} flagged
            </span>
          ) : (
            <span className="text-emerald-300">All clean</span>
          )}
          <span className="text-bone-600"> · {group.rows.length} prompt{group.rows.length === 1 ? "" : "s"}</span>
        </div>
      </button>
      {open && (
        <>
          {flaggedRows.map((r) => (
            <ShotRow
              key={rowKey(r.sceneOrd, r.shotIndex, r.model)}
              row={r}
              busyRow={busyRow}
              marked={marked}
              notesOpen={notesOpen}
              notesByRow={notesByRow}
              onToggleMark={onToggleMark}
              onToggleNotes={onToggleNotes}
              onNotesChange={onNotesChange}
              onRegen={onRegen}
              onRegenWithNotes={onRegenWithNotes}
              onInspect={onInspect}
            />
          ))}
          {cleanRows.length > 0 && (
            <details className="border-t border-white/8 px-4 py-2 text-[11px] text-bone-500">
              <summary className="cursor-pointer hover:text-bone-300">
                {cleanRows.length} clean prompt{cleanRows.length === 1 ? "" : "s"} (no flags)
              </summary>
              <div className="mt-2 flex flex-col">
                {cleanRows.map((r) => (
                  <ShotRow
                    key={rowKey(r.sceneOrd, r.shotIndex, r.model)}
                    row={r}
                    busyRow={busyRow}
                    marked={marked}
                    notesOpen={notesOpen}
                    notesByRow={notesByRow}
                    onToggleMark={onToggleMark}
                    onToggleNotes={onToggleNotes}
                    onNotesChange={onNotesChange}
                    onRegen={onRegen}
                    onRegenWithNotes={onRegenWithNotes}
                    onInspect={onInspect}
                  />
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shot row — issue list + actions + optional notes editor.
// ---------------------------------------------------------------------------
function ShotRow({
  row,
  busyRow,
  marked,
  notesOpen,
  notesByRow,
  onToggleMark,
  onToggleNotes,
  onNotesChange,
  onRegen,
  onRegenWithNotes,
  onInspect,
}: {
  row: ShotIssueRow;
  busyRow: string | null;
  marked: Set<string>;
  notesOpen: Set<string>;
  notesByRow: Record<string, string>;
  onToggleMark: (k: string) => void;
  onToggleNotes: (k: string) => void;
  onNotesChange: (k: string, v: string) => void;
  onRegen: (r: ShotIssueRow) => void;
  onRegenWithNotes: (r: ShotIssueRow) => void;
  onInspect?: (sceneOrd: number, shotIndex: number, model: string) => void;
}) {
  const key = rowKey(row.sceneOrd, row.shotIndex, row.model);
  const isBusy = busyRow === key;
  const isFlagged = row.stale || row.validatorIssues.length > 0;
  const isMarked = marked.has(key);
  const notesIsOpen = notesOpen.has(key);
  const notesVal = notesByRow[key] ?? "";

  return (
    <div className={"os-sup-shot " + (isFlagged ? "is-stale" : "is-ready")}>
      <div>
        <div className="os-sup-shot-label">{row.label}</div>
        <div className="os-sup-shot-model">{row.model}</div>
      </div>
      <div className="os-sup-shot-meta">
        {row.stale && (
          <div className="flex items-start gap-1.5 text-amber-300">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <span>
              <b>Stale</b>
              <span className="text-bone-400"> — {row.staleReasons.join("; ")}</span>
            </span>
          </div>
        )}
        {row.validatorIssues.length > 0 && (
          <div className="mt-1 flex items-start gap-1.5 text-rose-200">
            <AlertTriangle size={11} className="mt-0.5 shrink-0" />
            <div>
              <b>Validator flagged {row.validatorIssues.length} issue{row.validatorIssues.length === 1 ? "" : "s"}</b>
              <ul className="mt-0.5 list-disc pl-4 text-bone-300">
                {row.validatorIssues.slice(0, 3).map((iss, i) => (
                  <li key={i}>{iss}</li>
                ))}
                {row.validatorIssues.length > 3 && (
                  <li className="text-bone-500">
                    …and {row.validatorIssues.length - 3} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}
        {!isFlagged && (
          <div className="text-emerald-300">
            <Check size={11} className="inline mr-1" /> Ready
          </div>
        )}
      </div>
      <div className="os-sup-shot-actions">
        {onInspect && (
          <button
            type="button"
            onClick={() => onInspect(row.sceneOrd, row.shotIndex, row.model)}
            className="os-btn os-btn-sm os-btn-ghost"
            title="Open this shot in the AI Video Prompts panel below."
          >
            <Eye size={12} /> Inspect
          </button>
        )}
        <button
          type="button"
          onClick={() => onRegen(row)}
          disabled={isBusy}
          className="os-btn os-btn-sm os-btn-quiet"
          title="Regenerate this prompt against the current bible — no notes."
        >
          {isBusy && !notesIsOpen ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Regenerate
        </button>
        <button
          type="button"
          onClick={() => onToggleNotes(key)}
          className={
            "os-btn os-btn-sm " +
            (notesIsOpen ? "os-btn-primary" : "os-btn-quiet")
          }
          title="Steer the rewrite with a short note — e.g. 'Trim under 220 words; lead with phone screen; no key-art language.'"
        >
          <MessageSquarePlus size={12} />
          {notesIsOpen ? "Hide notes" : "Regenerate with notes"}
        </button>
        <button
          type="button"
          onClick={() => onToggleMark(key)}
          className={
            "os-btn os-btn-sm " +
            (isMarked ? "os-btn-primary" : "os-btn-ghost")
          }
          title={
            isMarked
              ? "Marked reviewed (local). Stage Approve still runs the real review gate."
              : "Mark this shot reviewed by the Prompt Supervisor."
          }
        >
          <Check size={12} />
          {isMarked ? "Reviewed" : "Mark"}
        </button>
      </div>

      {notesIsOpen && (
        <div
          className="mt-3 border-t border-white/8 pt-3 space-y-2"
          style={{ gridColumn: "1 / -1" }}
        >
          {row.validatorIssues.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-bone-500 self-center mr-1">
                Quick-add:
              </span>
              {suggestNotesFor(row.validatorIssues).map((tip) => (
                <button
                  key={tip}
                  type="button"
                  onClick={() =>
                    onNotesChange(
                      key,
                      notesVal.length > 0 ? `${notesVal.trim()} ${tip}` : tip
                    )
                  }
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-bone-200 hover:bg-white/[0.06]"
                >
                  + {tip}
                </button>
              ))}
            </div>
          )}
          <textarea
            value={notesVal}
            onChange={(e) => onNotesChange(key, e.target.value)}
            rows={3}
            placeholder="e.g. 'Trim under 220 words. Lead Sentence 1 with the phone screen — establish the hero before any character. Strip all key-art / publicity language.'"
            className="w-full rounded border border-sky-700/40 bg-black/30 px-2 py-1.5 text-xs text-bone-100 placeholder:text-bone-500 leading-snug"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onRegenWithNotes(row)}
              disabled={isBusy || notesVal.trim().length === 0}
              className="os-btn os-btn-sm os-btn-primary"
              title="Send these notes to the prompt composer and regenerate."
            >
              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Regenerate with these notes
            </button>
            <button
              type="button"
              onClick={() => onNotesChange(key, "")}
              disabled={notesVal.length === 0}
              className="os-btn os-btn-sm os-btn-ghost"
            >
              Clear
            </button>
          </div>
          <div className="text-[10px] text-bone-500">
            Notes are sent to the prompt composer as steering instructions for this one shot+model.
            They don't change the bible. To change canon, use the Canon Target Picker on an earlier stage.
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone?: "ready" | "attn" | "blocking";
}) {
  const cls = tone === "ready" ? "is-ready" : tone === "attn" ? "is-attn" : tone === "blocking" ? "is-blocking" : "";
  return (
    <div className="os-sup-stat">
      <div className={`os-sup-stat-num ${cls}`}>{n}</div>
      <div className="os-sup-stat-label">{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rowKey(sceneOrd: number, shotIndex: number, model: string): string {
  return `${sceneOrd}-${shotIndex}-${model}`;
}

function friendlyLabel(sceneOrd: number, shotIndex: number): string {
  return `SC${String(sceneOrd + 1).padStart(2, "0")} SH${String(shotIndex + 1).padStart(2, "0")}`;
}

/** Turn raw validator issues into short, ready-to-paste notes the
 *  supervisor can add to their regenerate prompt. Pattern-matches the
 *  exact strings emitted by the prompt composer's readiness gate. */
function suggestNotesFor(issues: string[]): string[] {
  const out = new Set<string>();
  for (const i of issues) {
    if (/exceeds 220 words/i.test(i)) out.add("Trim under 220 words.");
    if (/missing from the opening 40%/i.test(i)) {
      const m = i.match(/Hero subject "([^"]+)"/);
      if (m) out.add(`Lead Sentence 1 with the ${m[1]} — establish hero before character.`);
      else out.add("Lead with the hero image before any character.");
    }
    if (/key-art|publicity-still/i.test(i)) out.add("Strip key-art / publicity-still language. Cinematic frame only.");
    if (/Primary Image present but not dominant/i.test(i)) out.add("Make Primary Image dominant; no character introduced in Sentence 1.");
    if (/Supporting detail dominates primary image/i.test(i)) out.add("Move the supporting detail later; rewrite Sentence 1 around the hero.");
    if (/missing --ar/i.test(i)) out.add("Add --ar 9:16 flag.");
    if (/contains video-motion language/i.test(i)) out.add("Remove video-motion verbs — this is a still.");
    if (/Pika prompt is too long/i.test(i)) out.add("Trim under 60 words for Pika.");
    if (/too short to be model-ready/i.test(i)) out.add("Flesh out the prompt — minimum 30 words of cinematic detail.");
    if (/raw field label|Dropped sentence/i.test(i)) out.add("Rewrite the dropped sentence in observable behavior.");
  }
  return Array.from(out);
}

// Re-export for callers that need to type variables passed to onInspect.
export type { StalePromptInfo };
