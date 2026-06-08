import clsx from "clsx";
import { useState } from "react";
import { ChevronDown, ChevronUp, Copy as CopyIcon, Check } from "lucide-react";

/**
 * DraftPreviewPanel — premium dark-glass reading surface for long
 * screenplay / Fountain text. Replaces the cramped
 * `<pre class="max-h-72 ...">` blocks scattered through R6/R7/R8 Pass 2
 * + Drafts page + future preview surfaces.
 *
 * Features:
 *   • Refined monospace typography, generous line-height
 *   • Expand/collapse with a soft height transition
 *   • Copy button with transient "Copied" confirmation
 *   • Optional draft metadata strip (status, draft #, char count)
 *   • State tone: "proposed" | "promoted" | "current" | "neutral"
 */
export type DraftPreviewState = "proposed" | "promoted" | "current" | "neutral";

const STATE_LABEL: Record<DraftPreviewState, string> = {
  proposed: "Proposed",
  promoted: "Promoted",
  current: "Current",
  neutral: "",
};

const STATE_TONE: Record<DraftPreviewState, string> = {
  proposed: "border-sky-400/30 bg-sky-500/10 text-sky-200",
  promoted: "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
  current: "border-bone-400/30 bg-white/[0.06] text-bone-100",
  neutral: "border-white/10 bg-white/[0.04] text-bone-200",
};

export function DraftPreviewPanel({
  title,
  text,
  draftNumber,
  state = "neutral",
  startExpanded = false,
  footerHint,
  className,
}: {
  title?: string;
  text: string;
  draftNumber?: number | null;
  state?: DraftPreviewState;
  startExpanded?: boolean;
  /** Optional small line of text below the preview (e.g. "Approving inserts as Draft N+1"). */
  footerHint?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(startExpanded);
  const [copied, setCopied] = useState(false);
  const charCount = text?.length ?? 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked in some contexts; silently fail.
    }
  };

  return (
    <div
      className={clsx(
        "panel overflow-hidden",
        // Subtle paper-feel inner gradient so the reading surface
        // doesn't look like a debug terminal.
        "bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))]",
        className
      )}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-bone-400/80">
            {title ?? "Screenplay preview"}
          </span>
          {state !== "neutral" && (
            <span
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide",
                STATE_TONE[state]
              )}
            >
              {STATE_LABEL[state]}
              {typeof draftNumber === "number" && (
                <span className="opacity-80">· Draft {draftNumber}</span>
              )}
            </span>
          )}
          <span className="text-[11px] text-bone-500">
            {charCount.toLocaleString()} characters
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="os-icon-action"
            title="Copy the full Fountain text to clipboard."
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-300" />
                Copied
              </>
            ) : (
              <>
                <CopyIcon className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="os-icon-action"
            title={open ? "Collapse the preview" : "Expand the preview"}
          >
            {open ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="h-3.5 w-3.5" />
                Expand
              </>
            )}
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
        <pre
          className={clsx(
            // Monospace tuned for screenplay reading. Slightly larger
            // and looser than the old cramped 12px / 1.3 default.
            "overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-[1.65] text-bone-100",
            // Soft inset card so the text doesn't sit flush on the panel.
            "rounded-xl border border-white/[0.05] bg-black/25 px-5 py-4",
            "transition-[max-height] duration-300 ease-out",
            open ? "max-h-[78vh]" : "max-h-72"
          )}
        >
          {text || (
            <span className="italic text-bone-500">
              No screenplay text yet.
            </span>
          )}
        </pre>
        {footerHint && (
          <div className="mt-2 text-[11px] text-bone-500">{footerHint}</div>
        )}
      </div>
    </div>
  );
}
