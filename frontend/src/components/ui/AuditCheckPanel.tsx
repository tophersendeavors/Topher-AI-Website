import clsx from "clsx";
import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ShieldCheck,
  Wrench,
  Sparkles,
} from "lucide-react";

/**
 * AuditCheckPanel — the unified premium audit/quality-check display.
 * Replaces the older `QualityCheckPanel` (which had harsh amber-bordered
 * debug-looking blocks) with a calm Studios-OS treatment:
 *
 *   • Header: status icon + label + tally chips (passed / repaired / review / fail)
 *   • Collapsible body listing every check as a clean row with tone-coloured icon
 *   • Repairs section (if any) rendered as a separate quiet block
 *   • Tone-coded outer ring only when something is genuinely blocking
 *
 * Works for R3, R4, R5, R6, R7, R8 and any future audit that follows
 * the `RedevAuditReport` shape: `{ checks: [{id,label,status,message}], repairs: [{description}] }`.
 */

export type AuditCheckStatus =
  | "passed"
  | "warning"
  | "auto_repaired"
  | "blocking";

export interface AuditCheckRow {
  id: string;
  label: string;
  status: AuditCheckStatus | string;
  message: string;
}

export interface AuditCheckPanelData {
  checks: AuditCheckRow[];
  repairs?: Array<{ description: string }>;
}

export function AuditCheckPanel({
  audit,
  title = "Generation Quality Check",
  collapsedByDefault = false,
  className,
}: {
  audit: AuditCheckPanelData;
  title?: string;
  collapsedByDefault?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const passedCount = audit.checks.filter((c) => c.status === "passed").length;
  const repairedCount = audit.checks.filter(
    (c) => c.status === "auto_repaired"
  ).length;
  const warningCount = audit.checks.filter((c) => c.status === "warning").length;
  const blockingCount = audit.checks.filter(
    (c) => c.status === "blocking" || c.status === "failed"
  ).length;
  const repairsApplied = audit.repairs?.length ?? 0;

  // Outer tone — only ember/red if something truly needs attention.
  // Otherwise the panel reads as calm "everything passed" glass.
  const tone =
    blockingCount > 0
      ? "border-[color:var(--os-red-edge)] bg-[color:var(--os-red-wash)]"
      : warningCount > 0
        ? "border-[color:var(--os-ember-edge)] bg-[linear-gradient(120deg,var(--os-ember-wash),var(--os-glass-1)_55%)]"
        : repairedCount > 0
          ? "border-[color:var(--os-blue-edge)] bg-[linear-gradient(120deg,var(--os-blue-wash),var(--os-glass-1)_55%)]"
          : "border-white/[0.08] bg-white/[0.025]";

  const headIcon =
    blockingCount > 0 ? (
      <AlertTriangle className="h-4 w-4 text-[color:var(--os-red)]" />
    ) : warningCount > 0 ? (
      <AlertTriangle className="h-4 w-4 text-[color:var(--os-ember)]" />
    ) : repairedCount > 0 ? (
      <Wrench className="h-4 w-4 text-[color:var(--os-blue)]" />
    ) : (
      <ShieldCheck className="h-4 w-4 text-[color:var(--os-emerald)]" />
    );

  return (
    <div
      className={clsx(
        "rounded-2xl border backdrop-blur-md transition-colors",
        tone,
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="shrink-0">{headIcon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-bone-300/80">
            {title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
            <TallyChip
              tone="approved"
              icon={<Check className="h-3 w-3" />}
              label={`${passedCount} passed`}
            />
            {repairedCount > 0 && (
              <TallyChip
                tone="info"
                icon={<Wrench className="h-3 w-3" />}
                label={`${repairedCount} repaired`}
              />
            )}
            {warningCount > 0 && (
              <TallyChip
                tone="ember"
                icon={<AlertTriangle className="h-3 w-3" />}
                label={`${warningCount} review`}
              />
            )}
            {blockingCount > 0 && (
              <TallyChip
                tone="blocking"
                icon={<AlertTriangle className="h-3 w-3" />}
                label={`${blockingCount} blocking`}
              />
            )}
            {repairsApplied > 0 && (
              <span className="ml-1 inline-flex items-center gap-1 text-[10px] text-bone-400">
                <Sparkles className="h-3 w-3" />
                {repairsApplied} repair{repairsApplied === 1 ? "" : "s"} applied
              </span>
            )}
          </div>
        </div>
        <span className="shrink-0 text-bone-400">
          {open ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/[0.05] px-4 py-3">
          <ul className="space-y-2">
            {audit.checks.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.015] px-3 py-2"
              >
                <RowIcon status={c.status} />
                <div className="min-w-0">
                  <div className="text-[12.5px] font-medium leading-tight text-bone-100">
                    {c.label}
                  </div>
                  <div className="mt-1 text-[11.5px] leading-snug text-bone-400">
                    {c.message}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {audit.repairs && audit.repairs.length > 0 && (
            <div className="mt-3 rounded-xl border border-[color:var(--os-blue-edge)] bg-[color:var(--os-blue-wash)] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.06em] text-[color:var(--os-blue)]">
                <Wrench className="h-3.5 w-3.5" />
                Repairs applied
              </div>
              <ul className="mt-1.5 space-y-1">
                {audit.repairs.map((r, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[11.5px] leading-snug text-bone-200"
                  >
                    <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[color:var(--os-blue)]" />
                    {r.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TallyChip({
  tone,
  icon,
  label,
}: {
  tone: "approved" | "info" | "ember" | "blocking";
  icon: React.ReactNode;
  label: string;
}) {
  const cls =
    tone === "approved"
      ? "border-[color:var(--os-emerald-edge)] bg-[color:var(--os-emerald-wash)] text-[color:var(--os-emerald)]"
      : tone === "info"
        ? "border-[color:var(--os-blue-edge)] bg-[color:var(--os-blue-wash)] text-[color:var(--os-blue)]"
        : tone === "ember"
          ? "border-[color:var(--os-ember-edge)] bg-[color:var(--os-ember-wash)] text-[color:var(--os-ember-soft)]"
          : "border-[color:var(--os-red-edge)] bg-[color:var(--os-red-wash)] text-[color:var(--os-red)]";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        cls
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function RowIcon({ status }: { status: AuditCheckStatus | string }) {
  if (status === "passed") {
    return (
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--os-emerald)]" />
    );
  }
  if (status === "auto_repaired") {
    return (
      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--os-blue)]" />
    );
  }
  if (status === "warning") {
    return (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--os-ember)]" />
    );
  }
  if (status === "blocking" || status === "failed") {
    return (
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--os-red)]" />
    );
  }
  return (
    <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-bone-500" />
  );
}
