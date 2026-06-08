// AI Proposal View (Stage 7).
//
// Shown inside a workflow stage when the role is assigned to AI Generic
// or AI Influence. NO upload / URL / note inputs — the user only
// approves, regenerates, or regenerates with notes.
//
// For each deliverable that has a canon-field path:
//   • Show the current AI-proposed value
//   • [Approve] writes a textOverride on canonSources (locked verbatim)
//   • [Regenerate] re-runs the LLM and shows a new proposed value
//   • [Regenerate with notes] same, with optional steering text
//   • [Reject] clears any existing approval

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Pencil, RefreshCw, Sparkles, XCircle,
} from "lucide-react";
import { api, type WorkflowStageDeliverable } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { ImpactPreview } from "./ImpactPreview";

interface Props {
  scriptId: string;
  projectId: string;
  stageKey: string;
  deliverables: WorkflowStageDeliverable[];
  departmentKey: string;
  influenceKey: string | null;
  onChange: () => void;
}

export function AIProposalView(props: Props) {
  const { deliverables, scriptId, stageKey, onChange } = props;
  const qc = useQueryClient();
  const approvable = deliverables.filter((d) => !!d.canonFieldPath);
  const advisory = deliverables.filter((d) => !d.canonFieldPath);

  // Stage 7 (A) — auto-propose AI values when the stage opens and any
  // deliverable still has no human approval AND no cached AI proposal.
  // Fires once per stage entry. The backend short-circuits if nothing
  // is missing, so this is idempotent + cheap.
  const needsProposals = approvable.filter(
    (d) => !d.hasApprovedCanon && !d.hasAIProposal
  );
  const autoPropose = useMutation({
    mutationFn: () => api.autoProposeStage(scriptId, stageKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow"] });
      qc.invalidateQueries({ queryKey: ["stale-prompts"] });
      onChange();
    },
  });
  const autoProposeFiredRef = useRef(false);
  useEffect(() => {
    if (autoProposeFiredRef.current) return;
    if (needsProposals.length === 0) return;
    autoProposeFiredRef.current = true;
    autoPropose.mutate();
    // We intentionally don't react to needsProposals changes — fires once
    // per mount. User can hit the manual button to refire if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (approvable.length === 0 && advisory.length === 0) {
    return (
      <div className="mt-4 text-xs text-bone-500">
        (No AI-proposed deliverables for this stage yet.)
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="text-[10px] uppercase tracking-wide text-bone-400">
          AI proposals for this role — approve, regenerate, or reject
        </div>
        <button
          type="button"
          onClick={() => autoPropose.mutate()}
          disabled={autoPropose.isPending || needsProposals.length === 0}
          className="text-[10px] uppercase tracking-wide text-bone-400 hover:text-bone-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          title="Auto-propose AI values for every deliverable that doesn't have one yet."
        >
          {autoPropose.isPending ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Sparkles size={10} />
          )}
          Auto-propose all
        </button>
      </div>
      {autoPropose.isPending && (
        <div className="rounded border border-sky-700/30 bg-sky-900/15 px-2 py-1.5 text-[11px] text-sky-100">
          <Loader2 size={10} className="inline animate-spin mr-1" />
          The AI is drafting proposals for {needsProposals.length} deliverable
          {needsProposals.length === 1 ? "" : "s"}…
        </div>
      )}
      {autoPropose.data && !autoPropose.isPending && !autoPropose.data.skipped && (
        <div className="rounded border border-emerald-700/30 bg-emerald-900/10 px-2 py-1.5 text-[11px] text-emerald-200">
          <Check size={10} className="inline mr-1" />
          {autoPropose.data.proposed} of {autoPropose.data.total} AI proposals drafted. Review and Approve below.
        </div>
      )}
      {autoPropose.error && (
        <div className="rounded border border-red-700/30 bg-red-900/10 px-2 py-1.5 text-[11px] text-red-200">
          <AlertCircle size={10} className="inline mr-1" />
          Auto-propose failed: {(autoPropose.error as Error).message}
        </div>
      )}
      <GroupedDeliverables deliverables={approvable} props={props} />
      {advisory.length > 0 && (
        <div className="pt-2 text-[10px] text-bone-500">
          Plus {advisory.length} advisory item{advisory.length === 1 ? "" : "s"} this role
          tracks: {advisory.map((d) => d.label).join(" · ")}
        </div>
      )}
    </div>
  );
}

/** Render the deliverable list. For shot-level canon (blocking,
 *  cinematography) the rows get grouped under collapsible scene
 *  headers so a writer can scan SC01 / SC02 / SC03 rather than wading
 *  through 30+ flat rows. */
function GroupedDeliverables({
  deliverables,
  props,
}: {
  deliverables: WorkflowStageDeliverable[];
  props: Props;
}) {
  // Group by scene if labels match the shot-canon pattern "EPxx SCyy SHzz — …"
  const groups = new Map<string, WorkflowStageDeliverable[]>();
  let isShotLevel = false;
  for (const d of deliverables) {
    const m = d.label.match(/^((?:EP\d+\s+)?SC\d+)\s+SH\d+\s+—/);
    if (m) {
      isShotLevel = true;
      const key = m[1];
      const arr = groups.get(key) ?? [];
      arr.push(d);
      groups.set(key, arr);
    } else {
      const arr = groups.get("__flat__") ?? [];
      arr.push(d);
      groups.set("__flat__", arr);
    }
  }
  if (!isShotLevel) {
    return (
      <>
        {deliverables.map((d) => (
          <DeliverableRow key={d.key} d={d} {...props} />
        ))}
      </>
    );
  }
  const orderedKeys = Array.from(groups.keys()).sort();
  return (
    <>
      {orderedKeys.map((k) => {
        if (k === "__flat__") {
          return groups.get(k)!.map((d) => (
            <DeliverableRow key={d.key} d={d} {...props} />
          ));
        }
        return (
          <SceneGroup key={k} sceneLabel={k} items={groups.get(k)!} props={props} />
        );
      })}
    </>
  );
}

function SceneGroup({
  sceneLabel,
  items,
  props,
}: {
  sceneLabel: string;
  items: WorkflowStageDeliverable[];
  props: Props;
}) {
  const [open, setOpen] = useState(true);
  const approved = items.filter((d) => d.hasApprovedCanon).length;
  return (
    <div className="rounded border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 text-left hover:bg-white/[0.04] transition rounded-t"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {open ? (
            <ChevronDown size={12} className="text-bone-400" />
          ) : (
            <ChevronRight size={12} className="text-bone-400" />
          )}
          <span className="text-[11px] uppercase tracking-wide text-bone-300 font-medium">
            {sceneLabel}
          </span>
        </div>
        <span
          className={
            "text-[10px] rounded-full px-1.5 py-0.5 ring-1 " +
            (approved === items.length && items.length > 0
              ? "bg-emerald-900/30 text-emerald-200 ring-emerald-700/40"
              : "bg-white/[0.06] text-bone-300 ring-white/10")
          }
        >
          {approved}/{items.length}
        </span>
      </button>
      {open && (
        <div className="p-1.5 space-y-1 border-t border-white/8">
          {items.map((d) => (
            <DeliverableRow key={d.key} d={d} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}

function DeliverableRow({
  d,
  scriptId,
  departmentKey,
  influenceKey,
  onChange,
}: {
  d: WorkflowStageDeliverable;
  scriptId: string;
  projectId: string;
  stageKey: string;
  departmentKey: string;
  influenceKey: string | null;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [proposedValue, setProposedValue] = useState<string | undefined>(d.currentValue);
  const [showNotesBox, setShowNotesBox] = useState(false);
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  // Inline editing — for cases where the AI got 90% right and the user
  // just needs to surgically rephrase a sentence or two before
  // approving. Save persists to the cached proposal so the edit
  // survives reload; Approve writes the (possibly edited) value to canon.
  const [isEditing, setIsEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState<string>("");

  const approve = useMutation({
    mutationFn: () =>
      api.approveDeliverable(scriptId, {
        canonFieldPath: d.canonFieldPath!,
        value: proposedValue ?? "",
        departmentKey,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow"] });
      qc.invalidateQueries({ queryKey: ["stale-prompts"] });
      onChange();
    },
  });

  const reject = useMutation({
    mutationFn: () =>
      api.rejectDeliverable(scriptId, {
        canonFieldPath: d.canonFieldPath!,
        departmentKey,
        notes: undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflow"] });
      onChange();
    },
  });

  // Track the last regen value separately so we can show "the previous
  // proposal" underneath the spinner while regen is in flight, instead
  // of blanking the row to "Generating…". And guard against the LLM
  // returning an empty value — when that happens we keep the old
  // proposal in place and surface a warning rather than blanking it.
  const [regenWarning, setRegenWarning] = useState<string | null>(null);
  const regen = useMutation({
    mutationFn: (regenNotes?: string) =>
      api.regenDeliverable(scriptId, {
        canonFieldPath: d.canonFieldPath!,
        deliverableLabel: d.label,
        deliverableDescription: d.description,
        currentValue: proposedValue,
        influenceKey,
        notes: regenNotes,
      }),
    onMutate: () => {
      // Clear any prior warning when starting a new regen.
      setRegenWarning(null);
    },
    onSuccess: (data) => {
      const v = (data.value ?? "").trim();
      if (v.length === 0) {
        // LLM returned nothing usable — keep the existing proposal
        // visible so the user doesn't lose their place. Surface why.
        setRegenWarning(
          "The model returned no content for this regen. Most likely the current value contains corrupted text (e.g. char-indexed garbage from an older bug). Click Regenerate once more, or paste notes describing what you want."
        );
        return;
      }
      setProposedValue(v);
    },
    onError: (err) => {
      setRegenWarning(`Regen failed: ${(err as Error).message}`);
    },
  });

  const saveEdit = useMutation({
    mutationFn: () =>
      api.editDeliverableProposal(scriptId, {
        canonFieldPath: d.canonFieldPath!,
        value: editBuffer,
      }),
    onSuccess: () => {
      setProposedValue(editBuffer);
      setIsEditing(false);
      qc.invalidateQueries({ queryKey: ["workflow"] });
      onChange();
    },
  });

  const valueChanged =
    proposedValue !== undefined && proposedValue !== (d.currentValue ?? "");
  // Stage 7 — "approved" now means a human textOverride exists, NOT just
  // "the bible has a value." This makes the Approve button do something
  // visible even when the AI's proposal matches the bible's current text.
  const approved = !!d.hasApprovedCanon && !valueChanged;

  return (
    <div
      className={
        "os-deliv " +
        (approved ? "is-approved " : valueChanged ? "is-awaiting " : "")
      }
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start justify-between gap-2 text-left"
      >
        <div className="flex items-start gap-1.5 min-w-0">
          {expanded ? (
            <ChevronDown size={12} className="text-bone-500 mt-0.5 shrink-0" />
          ) : (
            <ChevronRight size={12} className="text-bone-500 mt-0.5 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm text-bone-100 line-clamp-1">{d.label}</div>
            {d.description && !expanded && (
              <div className="text-[11px] text-bone-400 line-clamp-1">{d.description}</div>
            )}
          </div>
        </div>
        <StatusBadge approved={!!approved} changed={valueChanged} />
      </button>

      {expanded && (
        <div className="mt-2 pl-4 space-y-2">
          {d.description && (
            <div className="text-[11px] text-bone-400">{d.description}</div>
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5 flex items-center justify-between">
              <span>{isEditing ? "Edit proposal" : "AI proposal"}</span>
              {!isEditing && proposedValue && proposedValue.trim() && !regen.isPending && (
                <button
                  type="button"
                  onClick={() => {
                    setEditBuffer(proposedValue ?? "");
                    setIsEditing(true);
                  }}
                  className="text-[10px] uppercase tracking-wide text-bone-400 hover:text-bone-100 inline-flex items-center gap-1"
                  title="Hand-edit the proposal text before approving."
                >
                  <Pencil size={10} /> Edit
                </button>
              )}
            </div>
            {isEditing ? (
              <div>
                <textarea
                  value={editBuffer}
                  onChange={(e) => setEditBuffer(e.target.value)}
                  rows={Math.min(20, Math.max(4, editBuffer.split(/\n/).length + 1))}
                  className="w-full rounded border border-sky-700/40 bg-black/30 px-2 py-1.5 text-xs text-bone-100 placeholder:text-bone-500 font-mono leading-snug"
                />
                <div className="mt-1 flex flex-wrap gap-1 items-center">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveEdit.mutate()}
                    disabled={
                      saveEdit.isPending || !editBuffer.trim() || editBuffer === proposedValue
                    }
                    title="Persists your edited text as a draft. Won't flow into prompts until you also Approve as canon."
                  >
                    {saveEdit.isPending ? (
                      <Loader2 size={10} className="animate-spin mr-1" />
                    ) : (
                      <Check size={10} className="mr-1" />
                    )}
                    Save as draft
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      // One-click: save edits AND approve as canon. Bakes
                      // the edited value into canonSources.textOverride so
                      // the prompt composer picks it up on next regen.
                      await saveEdit.mutateAsync();
                      // Approve with the same edited value.
                      setProposedValue(editBuffer);
                      approve.mutate();
                    }}
                    disabled={
                      saveEdit.isPending || approve.isPending || !editBuffer.trim()
                    }
                    title="Bakes the edited brief into canon so it flows into the next prompt regeneration."
                  >
                    {(saveEdit.isPending || approve.isPending) ? (
                      <Loader2 size={10} className="animate-spin mr-1" />
                    ) : (
                      <Check size={10} className="mr-1" />
                    )}
                    Approve as canon
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setEditBuffer("");
                    }}
                  >
                    Cancel
                  </Button>
                  <span className="text-[10px] text-amber-200 w-full">
                    <strong>Save as draft</strong> = persisted edit only.{" "}
                    <strong>Approve as canon</strong> = the prompt composer will inject this into every regenerated prompt for this shot.
                  </span>
                </div>
                {saveEdit.error && (
                  <div className="mt-1 text-[11px] text-red-300 flex items-center gap-1">
                    <AlertCircle size={10} /> {(saveEdit.error as Error).message}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-bone-100 whitespace-pre-wrap break-words relative">
                  {/* While regen is pending, keep the existing proposal
                      visible underneath so the row doesn't blank out.
                      Show the spinner banner ON TOP so the user knows
                      a new version is in flight. */}
                  {regen.isPending && (
                    <div className="mb-1.5 -mx-2 -mt-1.5 px-2 py-1 bg-sky-900/30 border-b border-sky-700/40 text-sky-200 text-[11px] flex items-center gap-1.5">
                      <Loader2 size={10} className="inline animate-spin" />
                      Generating new proposal — existing one is shown below until it's ready.
                    </div>
                  )}
                  {proposedValue && proposedValue.trim() ? (
                    <span className={regen.isPending ? "opacity-50" : ""}>
                      {proposedValue}
                    </span>
                  ) : !regen.isPending ? (
                    <span className="text-bone-500">(no proposal yet — click Regenerate)</span>
                  ) : null}
                </div>
                {regenWarning && !regen.isPending && (
                  <div className="mt-1 rounded border border-amber-700/40 bg-amber-900/15 px-2 py-1.5 text-[11px] text-amber-200 flex items-start gap-1.5">
                    <AlertCircle size={11} className="mt-0.5 shrink-0" />
                    <span>{regenWarning}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {showNotesBox && (
            <div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="What do you want the AI to do differently? (e.g. 'darker walls', 'no exposed wood', 'add wear and tear')"
                className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 placeholder:text-bone-500 px-2 py-1 text-xs"
              />
              <div className="mt-1 flex gap-1">
                <Button
                  size="sm"
                  onClick={() => {
                    regen.mutate(notes);
                    setShowNotesBox(false);
                    setNotes("");
                  }}
                  disabled={regen.isPending}
                >
                  Regenerate with these notes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowNotesBox(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {!showNotesBox && (
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                onClick={() => approve.mutate()}
                disabled={approve.isPending || !proposedValue?.trim()}
              >
                {approve.isPending ? (
                  <Loader2 size={10} className="animate-spin mr-1" />
                ) : (
                  <Check size={10} className="mr-1" />
                )}
                Approve as canon
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => regen.mutate(undefined)}
                disabled={regen.isPending}
              >
                {regen.isPending ? (
                  <Loader2 size={10} className="animate-spin mr-1" />
                ) : (
                  <RefreshCw size={10} className="mr-1" />
                )}
                Regenerate
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowNotesBox(true)}
                disabled={regen.isPending}
              >
                Regenerate with notes
              </Button>
              {approved && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => reject.mutate()}
                  disabled={reject.isPending}
                  title="Clear approval — sends this back for AI to re-propose"
                >
                  <XCircle size={10} className="mr-1" />
                  Reject
                </Button>
              )}
            </div>
          )}

          {/* Impact preview: shows up automatically when this deliverable
           *  has a canon field path — tells the user which shots get
           *  affected before/after Approve. */}
          {d.canonFieldPath && (
            <ImpactPreview
              scriptId={scriptId}
              canonFieldPath={d.canonFieldPath}
              hideWhenEmpty={!approved}
            />
          )}

          {approve.error && (
            <div className="text-[11px] text-red-300 flex items-center gap-1">
              <AlertCircle size={10} /> {(approve.error as Error).message}
            </div>
          )}
          {regen.error && (
            <div className="text-[11px] text-red-300 flex items-center gap-1">
              <AlertCircle size={10} /> {(regen.error as Error).message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({
  approved,
  changed,
}: {
  approved: boolean;
  changed: boolean;
}) {
  if (changed)
    return (
      <span className="text-[10px] uppercase tracking-wide rounded-full bg-amber-900/40 text-amber-200 ring-1 ring-amber-700/40 px-1.5 py-0.5 shrink-0">
        Unsaved
      </span>
    );
  if (approved)
    return (
      <span className="text-[10px] uppercase tracking-wide rounded-full bg-emerald-900/40 text-emerald-200 ring-1 ring-emerald-700/40 px-1.5 py-0.5 shrink-0">
        ✓ Approved
      </span>
    );
  return (
    <span className="text-[10px] uppercase tracking-wide rounded-full bg-white/[0.06] text-bone-300 ring-1 ring-white/10 px-1.5 py-0.5 shrink-0">
      Awaiting
    </span>
  );
}
