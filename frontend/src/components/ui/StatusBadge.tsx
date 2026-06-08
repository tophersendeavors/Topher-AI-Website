import clsx from "clsx";
import type { ReactNode } from "react";

export type StatusTone =
  | "approved" // green
  | "active" // blue
  | "ember" // toburt orange (in-progress / hero)
  | "attn" // amber warning
  | "blocking" // red
  | "locked" // muted
  | "neutral"; // default glass

const TONE_CLASS: Record<StatusTone, string> = {
  approved: "os-chip os-chip-approved",
  active: "os-chip os-chip-active",
  ember: "os-chip os-chip-ember",
  attn: "os-chip os-chip-attn",
  blocking: "os-chip os-chip-blocking",
  locked: "os-chip os-chip-locked",
  neutral: "os-chip",
};

/**
 * Glass pill used for stage status, audit results, draft promotion state.
 * Pure display — wrap your own onClick if interactive.
 */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={clsx(TONE_CLASS[tone], className)}>{children}</span>;
}

/** Inline status dot (no chip). Mirrors the workflow rail's stage nodes. */
export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: StatusTone;
  className?: string;
}) {
  const cls =
    tone === "approved"
      ? "os-dot os-dot-approved"
      : tone === "active"
        ? "os-dot os-dot-active"
        : tone === "ember"
          ? "os-dot os-dot-ember"
          : tone === "attn"
            ? "os-dot os-dot-attn"
            : tone === "blocking"
              ? "os-dot os-dot-blocking"
              : "os-dot os-dot-locked";
  return <span className={clsx(cls, className)} />;
}
