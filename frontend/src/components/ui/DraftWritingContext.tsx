// DraftWritingContext — a banner that every scene-writing surface should
// display, so the writer always knows:
//   • Which draft is the SOURCE (read from)
//   • Which draft is the TARGET (written into)
//   • Whether the source is locked
//   • Whether the operation will mutate an existing draft or create a new one
//
// The component is read-only — it shows state. The companion
// <StartNewDraftFromHere> button is rendered alongside on locked sources.

import { Lock, ArrowRight, Plus, FileEdit, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

export type DraftWritingMode =
  | "continue_unlocked" // writer continues into the current unlocked draft
  | "blocked_locked" // current draft is locked; writer must start a new one
  | "new_from_locked" // writer is about to create a new draft from a locked source
  | "outline_only"; // writer is reading from beat_sheet / scene_list, not script prose

interface DraftSummary {
  draftNumber: number | null;
  title?: string | null;
  isLocked: boolean;
  sourceLabel?: string | null; // e.g. "R9 final polish" — pulled from metadata.source
}

interface Props {
  /** The draft the user is currently looking at (the candidate target). */
  current: DraftSummary;
  /** Mode controls the copy + visual treatment. */
  mode: DraftWritingMode;
  /** If mode === "outline_only", what's the artifact? */
  outlineKind?: "beat_sheet" | "scene_list";
  /** Optional: link to start a new draft from this one. */
  startNewDraftHref?: string;
  /** Optional: handler for the start-new-draft action when no plain href fits. */
  onStartNewDraft?: () => void;
  /** When the source is locked + restored from R9, the timestamp surfaces here. */
  restoredFromR9At?: string | null;
}

const tone = {
  continue_unlocked: {
    border: "border-emerald-700/40",
    bg: "bg-emerald-950/30",
    text: "text-emerald-100",
    subtext: "text-emerald-200/80",
    eyebrow: "Continuing existing draft",
    Icon: FileEdit,
  },
  blocked_locked: {
    border: "border-ember-700/70",
    bg: "bg-ember-950/40",
    text: "text-ember-100",
    subtext: "text-ember-200/90",
    eyebrow: "Draft is locked",
    Icon: Lock,
  },
  new_from_locked: {
    border: "border-amber-700/60",
    bg: "bg-amber-950/30",
    text: "text-amber-100",
    subtext: "text-amber-200/90",
    eyebrow: "Will create a new draft",
    Icon: Plus,
  },
  outline_only: {
    border: "border-amber-700/60",
    bg: "bg-amber-950/30",
    text: "text-amber-100",
    subtext: "text-amber-200/90",
    eyebrow: "Writing from outline",
    Icon: AlertTriangle,
  },
} as const;

export function DraftWritingContext(props: Props) {
  const t = tone[props.mode];
  const { Icon } = t;
  const draftLabel = props.current.draftNumber
    ? `Draft ${props.current.draftNumber}`
    : props.current.title || "this draft";
  const sourceTag = props.current.sourceLabel ? ` (${props.current.sourceLabel})` : "";

  let title = "";
  let body = "";
  let action: React.ReactNode = null;

  if (props.mode === "continue_unlocked") {
    title = `Continue ${draftLabel}`;
    body = `Scene writing will modify ${draftLabel} in place. Each scene you generate is added to this draft.`;
  } else if (props.mode === "blocked_locked") {
    title = "This draft is locked.";
    body =
      `${draftLabel}${sourceTag} is locked as a creative source-of-truth. ` +
      `Scene writing cannot modify it. To continue, create a new draft from this source — ` +
      `the new draft will be writable.`;
    action = props.startNewDraftHref ? (
      <Link
        to={props.startNewDraftHref}
        className="inline-flex items-center gap-1.5 rounded-md border border-ember-700/60 bg-ember-900/40 px-3 py-1.5 text-sm text-ember-50 hover:bg-ember-900/60"
      >
        <Plus className="h-3.5 w-3.5" /> Start new draft from this source
      </Link>
    ) : props.onStartNewDraft ? (
      <button
        onClick={props.onStartNewDraft}
        className="inline-flex items-center gap-1.5 rounded-md border border-ember-700/60 bg-ember-900/40 px-3 py-1.5 text-sm text-ember-50 hover:bg-ember-900/60"
      >
        <Plus className="h-3.5 w-3.5" /> Start new draft from this source
      </button>
    ) : null;
  } else if (props.mode === "new_from_locked") {
    title = `Will create a new draft from ${draftLabel}`;
    body =
      `${draftLabel}${sourceTag} is locked and read-only. The scene writer will ` +
      `create a NEW writable draft seeded from this one and write into the new draft. ` +
      `The locked source will not change.`;
  } else if (props.mode === "outline_only") {
    title = "Writer is reading from outline metadata, not script prose.";
    body =
      `This writer uses the workflow's ${
        props.outlineKind === "scene_list" ? "scene list" : "beat sheet"
      } — scene goals, conflicts, and turns — not the prose of any current draft. ` +
      `Output will be a brand-new draft. If you've polished a current draft, those changes are NOT carried in.`;
  }

  return (
    <div className={`rounded-xl border p-4 ${t.border} ${t.bg}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${t.text}`} />
        <div className="flex-1 space-y-1.5">
          <div className="text-xs uppercase tracking-wide text-bone-500">{t.eyebrow}</div>
          <div className={`font-serif text-base ${t.text === "text-ember-100" ? "text-bone-50" : t.text}`}>
            {title}
          </div>

          {/* Source → Target visual */}
          <DraftFlow
            sourceLabel={
              props.mode === "outline_only"
                ? props.outlineKind === "scene_list"
                  ? "Scene list (outline)"
                  : "Beat sheet (outline)"
                : `${draftLabel}${sourceTag}`
            }
            sourceLocked={props.current.isLocked}
            targetLabel={
              props.mode === "continue_unlocked"
                ? draftLabel
                : props.mode === "blocked_locked"
                ? "blocked — no writable target"
                : props.mode === "new_from_locked"
                ? `new Draft ${(props.current.draftNumber ?? 0) + 1}`
                : "new draft"
            }
            targetMutates={props.mode === "continue_unlocked"}
            targetBlocked={props.mode === "blocked_locked"}
          />

          <div className={`text-sm ${t.subtext}`}>{body}</div>

          {props.restoredFromR9At && (
            <div className="text-xs text-ember-300/70">
              Restored from R9 source-of-truth on{" "}
              {new Date(props.restoredFromR9At).toLocaleString()}.
            </div>
          )}

          {action && <div className="pt-1">{action}</div>}
        </div>
      </div>
    </div>
  );
}

function DraftFlow({
  sourceLabel,
  sourceLocked,
  targetLabel,
  targetMutates,
  targetBlocked,
}: {
  sourceLabel: string;
  sourceLocked: boolean;
  targetLabel: string;
  targetMutates: boolean;
  targetBlocked: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-bone-100">
        <span className="text-bone-500">Source:</span> {sourceLabel}
        {sourceLocked && <Lock className="ml-1 inline h-3 w-3 text-ember-300" />}
      </span>
      <ArrowRight className="h-3.5 w-3.5 text-bone-500" />
      <span
        className={`rounded-full border px-2.5 py-1 ${
          targetBlocked
            ? "border-ember-700/70 bg-ember-900/40 text-ember-200"
            : targetMutates
            ? "border-emerald-700/40 bg-emerald-900/30 text-emerald-100"
            : "border-amber-700/50 bg-amber-900/30 text-amber-100"
        }`}
      >
        <span className="text-bone-500">Target:</span> {targetLabel}
        {!targetBlocked && (
          <span className="ml-1 text-bone-500">
            ({targetMutates ? "mutates existing" : "creates new"})
          </span>
        )}
      </span>
    </div>
  );
}
