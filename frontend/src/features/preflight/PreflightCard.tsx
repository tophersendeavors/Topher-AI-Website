// Production Preflight card.
//
// Stage 1 = aggregator + soft gate.
// Stage 2.1 = expandable per-dept details + visible Refresh state.
//
// The card renders three layers:
//   1. summary pill + draft source on the header
//   2. one row per department with status + reasons
//   3. expandable detail panel per row showing the actual structured
//      data (architecture / wardrobe / per-brief blocking / VWR / etc.)
//
// `usePreflight` and `preflightGateMessage` are re-exported for use by
// the AI Video Prompts panel's soft gate.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
  XCircle,
} from "lucide-react";
import {
  api,
  type PreflightDepartmentReport,
  type PreflightDeptStatus,
  type PreflightReport,
} from "@/lib/api";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

interface Props {
  scriptId: string;
}

// Map Preflight aggregator dept keys → department-collaboration dept keys
// (workspace URLs). Only the 4 pilot canon-owner depts route to workspaces.
const PREFLIGHT_TO_DEPT_KEY: Record<string, string | undefined> = {
  productionDesign: "production_design",
  artDepartment: "art_dept",
  props: "props",
  wardrobeHmu: "wardrobe_hmu",
};

const STATUS_STYLE: Record<
  PreflightDeptStatus,
  { label: string; tone: string; icon: typeof CheckCircle2 }
> = {
  ready: {
    label: "Ready",
    tone: "bg-emerald-900/40 text-emerald-200 ring-emerald-700/40",
    icon: CheckCircle2,
  },
  partial: {
    label: "Needs attention",
    tone: "bg-amber-900/40 text-amber-200 ring-amber-700/40",
    icon: Clock,
  },
  missing: {
    label: "Not set up yet",
    tone: "bg-white/[0.06] text-bone-400 ring-white/10",
    icon: AlertTriangle,
  },
  fail: {
    label: "Blocking",
    tone: "bg-red-900/40 text-red-200 ring-red-700/40",
    icon: XCircle,
  },
};

function StatusPill({ status }: { status: PreflightDeptStatus }) {
  const s = STATUS_STYLE[status];
  const Icon = s.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium ring-1 ${s.tone}`}
    >
      <Icon size={11} /> {s.label}
    </span>
  );
}

export function PreflightCard({ scriptId }: Props) {
  const q = useQuery({
    queryKey: ["preflight", scriptId],
    queryFn: () => api.getPreflight(scriptId),
    staleTime: 30_000,
  });

  if (q.isLoading) {
    return (
      <Panel className="mb-4">
        <div className="flex items-center gap-2 text-sm text-bone-300">
          <RefreshCw className="animate-spin" size={14} /> Running production preflight…
        </div>
      </Panel>
    );
  }
  if (q.error || !q.data) {
    return (
      <Panel className="mb-4">
        <div className="text-sm text-red-300">
          Preflight failed to load. {(q.error as Error)?.message ?? ""}
        </div>
      </Panel>
    );
  }

  const r = q.data;
  return (
    <Panel className="mb-4">
      <PreflightCardBody
        report={r}
        isFetching={q.isFetching}
        onRefresh={() => q.refetch()}
      />
    </Panel>
  );
}

function PreflightCardBody({
  report,
  isFetching,
  onRefresh,
}: {
  report: PreflightReport;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  const updatedAt = new Date(report.generatedAt);
  // Roll up departments into plain-language counts for the hero card.
  const ready = report.departments.filter((d) => d.status === "ready").length;
  const partial = report.departments.filter((d) => d.status === "partial").length;
  const missing = report.departments.filter((d) => d.status === "missing").length;
  const fail = report.departments.filter((d) => d.status === "fail").length;
  const total = report.departments.length;
  return (
    <div className="space-y-3">
      {/* Hero — overall result in plain language. */}
      <PreflightHero
        overall={report.overall}
        ready={ready}
        partial={partial}
        missing={missing}
        fail={fail}
        total={total}
        runAt={updatedAt}
        episodeLabel={
          report.episodeNumber != null
            ? `Episode ${report.episodeNumber}${report.episodeTitle ? ` — ${report.episodeTitle}` : ""}`
            : "Script-level"
        }
        isFetching={isFetching}
        onRefresh={onRefresh}
      />

      {/* Stale-draft banner */}
      {!report.draftSource.isCurrentDraft && (
        <div className="rounded-md border border-red-700/40 bg-red-900/15 px-3 py-2 text-sm text-red-200">
          <div className="font-semibold">Stale draft assets</div>
          <ul className="mt-1 list-disc pl-5 space-y-0.5 text-xs">
            {report.draftSource.staleAssets.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Departments grid */}
      <div>
        <div className="os-sec-label">
          <span
            className="os-eyebrow-h"
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--os-t-1)",
              letterSpacing: "-0.01em",
            }}
          >
            Department readiness
          </span>
        </div>
        <div className="os-pf-grid">
          {report.departments.map((d) => (
            <DepartmentCard key={d.key} d={d} />
          ))}
        </div>
      </div>

      {report.notes.length > 0 && (
        <div className="text-xs text-bone-500">
          {report.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreflightHero({
  overall,
  ready,
  partial,
  missing,
  fail,
  total,
  runAt,
  episodeLabel,
  isFetching,
  onRefresh,
}: {
  overall: PreflightDeptStatus;
  ready: number;
  partial: number;
  missing: number;
  fail: number;
  total: number;
  runAt: Date;
  episodeLabel: string;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  let headline = "";
  let body = "";
  let variant = "is-attn";
  if (overall === "ready") {
    headline = "Preflight is ready for clip generation.";
    body = `All ${total} departments report ready. You can advance to Generate.`;
    variant = "is-ready";
  } else if (overall === "partial") {
    headline = "Preflight needs attention.";
    body = `${ready} of ${total} departments ready · ${partial} need attention. Resolve the items below, then re-run.`;
    variant = "is-attn";
  } else if (overall === "fail") {
    headline = "Preflight is blocked.";
    body = `${fail} department${fail === 1 ? "" : "s"} blocking clip generation. Fix what's flagged below.`;
    variant = "is-block";
  } else {
    headline = "Preflight has not been fully set up.";
    body = `${missing} department${missing === 1 ? " hasn't" : "s haven't"} been configured yet.`;
  }
  return (
    <div className={`os-readiness ${variant}`}>
      <span className="os-rb-ring">
        {overall === "ready" ? (
          <CheckCircle2 size={20} />
        ) : overall === "fail" ? (
          <XCircle size={20} />
        ) : (
          <AlertTriangle size={20} />
        )}
      </span>
      <div className="os-rb-text">
        <div
          className="os-eyebrow"
          style={{ marginBottom: 4, color: "var(--os-t-4)" }}
        >
          Preflight report · {episodeLabel}
        </div>
        <div className="os-rb-headline">{headline}</div>
        <div className="os-rb-sub">
          {body} Last checked {runAt.toLocaleTimeString()}.
        </div>
      </div>
      <div className="os-rb-score">
        <span className="os-rb-score-n">
          {ready}
          <small>/{total}</small>
        </span>
        <span className="os-rb-score-l">ready</span>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={isFetching}
        className="os-btn os-btn-ghost"
        title="Re-run preflight against the live data"
      >
        <RefreshCw
          size={13}
          className={isFetching ? "animate-spin" : ""}
        />
        {isFetching ? "Re-running…" : "Re-run"}
      </button>
    </div>
  );
}

function hasAnyDetails(d: PreflightDepartmentReport): boolean {
  if (!d.details) return false;
  const det = d.details;
  return (
    (det.fields?.length ?? 0) > 0 ||
    (det.blocks?.length ?? 0) > 0 ||
    !!det.table ||
    !!det.link
  );
}

function DepartmentCard({ d }: { d: PreflightDepartmentReport }) {
  const [open, setOpen] = useState(false);
  const expandable = hasAnyDetails(d);
  const deptKey = PREFLIGHT_TO_DEPT_KEY[d.key];
  const cellMod =
    d.status === "ready"
      ? "is-approved"
      : d.status === "partial"
        ? "is-attn"
        : d.status === "fail"
          ? "is-block"
          : "is-locked";
  const icMod =
    d.status === "ready"
      ? "is-approved"
      : d.status === "partial"
        ? "is-attn"
        : d.status === "fail"
          ? "is-block"
          : "is-locked";
  const IconComp =
    d.status === "ready"
      ? CheckCircle2
      : d.status === "partial"
        ? Clock
        : d.status === "fail"
          ? XCircle
          : AlertTriangle;
  return (
    <div className={`os-pf-cell ${cellMod}`}>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-2 text-left ${
          expandable ? "cursor-pointer" : "cursor-default"
        }`}
        aria-expanded={open}
        disabled={!expandable}
        style={{ background: "transparent", border: 0, padding: 0 }}
      >
        <div className="os-pf-top" style={{ flex: 1 }}>
          <span className={`os-pf-ic ${icMod}`}>
            <IconComp size={15} />
          </span>
          <span className="os-pf-name">{d.label}</span>
          {d.status === "fail" && (
            <span className="os-pf-blockflag">Blocks generate</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {d.stageTwoPlanned && (
            <span
              className="os-chip"
              style={{
                fontSize: 10,
                padding: "3px 9px",
                color: "var(--os-amber-soft)",
                borderColor: "var(--os-amber-edge)",
                background: "var(--os-amber-wash)",
              }}
            >
              Stage 2
            </span>
          )}
          {expandable && (open ? (
            <ChevronDown size={13} style={{ color: "var(--os-t-4)" }} />
          ) : (
            <ChevronRight size={13} style={{ color: "var(--os-t-4)" }} />
          ))}
        </div>
      </button>

      {d.reasons.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-bone-300 pl-5">
          {d.reasons.map((r) => (
            <li key={r}>• {r}</li>
          ))}
        </ul>
      )}
      {d.missingFields.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-200 pl-5">
          {d.missingFields.map((m) => (
            <li key={m} className="flex gap-1.5 items-start">
              <span aria-hidden className="text-amber-300">×</span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      )}

      {open && expandable && (
        <div className="mt-3 border-t border-white/10 pt-2 pl-5">
          <DepartmentDetailsBody d={d} />
        </div>
      )}

      {deptKey && (
        <PreflightDepartmentLink deptKey={deptKey} />
      )}
      {d.fixUrl && (
        <a
          className="mt-1 inline-block text-[11px] text-sky-200 hover:text-sky-100 pl-5"
          href={d.fixUrl}
        >
          Open to fix →
        </a>
      )}
    </div>
  );
}

function PreflightDepartmentLink({ deptKey }: { deptKey: string }) {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  return (
    <Link
      to={`/projects/${projectId}/departments/${deptKey}`}
      className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-200 hover:text-sky-100 pl-5"
    >
      Open department workspace <ExternalLink size={10} />
    </Link>
  );
}

function DepartmentDetailsBody({ d }: { d: PreflightDepartmentReport }) {
  const det = d.details!;
  return (
    <div className="space-y-3 text-[11px]">
      {(det.fields?.length ?? 0) > 0 && (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {det.fields!.map((f) => (
            <FieldRow key={f.label} label={f.label} value={f.value} />
          ))}
        </dl>
      )}

      {det.blocks?.map((b) => (
        <div key={b.heading} className="space-y-0.5">
          <div className="font-medium text-bone-200">{b.heading}</div>
          {Array.isArray(b.body) ? (
            <ul className="list-disc pl-5 space-y-0.5 text-bone-300">
              {b.body.map((line, i) => (
                <li key={i} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-bone-300 whitespace-pre-wrap break-words">{b.body}</div>
          )}
        </div>
      ))}

      {det.table && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-white/10">
                {det.table.headers.map((h) => (
                  <th
                    key={h}
                    className="py-1 pr-3 text-bone-400 font-medium"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {det.table.rows.map((row, i) => (
                <tr key={i} className="border-b border-white/[0.05] last:border-0">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="py-1 pr-3 align-top text-bone-200 break-words"
                    >
                      {cell || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {det.link && (
        <a
          className="text-sky-200 hover:text-sky-100"
          href={det.link.href}
          rel="noopener noreferrer"
        >
          {det.link.label} →
        </a>
      )}
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-bone-400">{label}</dt>
      <dd className="text-bone-100 break-words">{value}</dd>
    </>
  );
}

/** Hook variant for parent components that want to drive a soft gate. */
export function usePreflight(scriptId: string) {
  return useQuery({
    queryKey: ["preflight", scriptId],
    queryFn: () => api.getPreflight(scriptId),
    staleTime: 30_000,
  });
}

/** Confirm dialog wrapper for the soft gate. Returns a tuple of `(node,
 *  request)` — call `request(action)` from the Generate / Regenerate
 *  click handler. If preflight is green, `action()` fires immediately;
 *  otherwise the user gets a confirmation. */
export function preflightGateMessage(report: PreflightReport | undefined): string | null {
  if (!report) return null;
  if (report.allowPromptGeneration) return null;
  const lines: string[] = [];
  if (!report.draftSource.isCurrentDraft) {
    lines.push(
      `⚠ You are looking at ${report.draftSource.inspectedDraftLabel ?? "an older draft"} but the current draft is ${report.draftSource.currentDraftLabel ?? "(unknown)"}.`
    );
  }
  const broken = report.departments.filter(
    (d) => d.status === "fail" || (d.status === "missing" && !d.stageTwoPlanned)
  );
  const partial = report.departments.filter(
    (d) => d.status === "partial" && !d.stageTwoPlanned
  );
  if (broken.length)
    lines.push(`Hard fails: ${broken.map((b) => b.label).join(", ")}.`);
  if (partial.length)
    lines.push(`Partial: ${partial.map((b) => b.label).join(", ")}.`);
  lines.push("Generating prompts anyway may produce inconsistent results. Continue?");
  return lines.join("\n");
}
