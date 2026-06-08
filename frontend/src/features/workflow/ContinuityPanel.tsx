// Continuity stage (Stage 9 — Script Supervisor).
//
// Reads like a professional continuity report, not a raw test panel.
// Hero result card up top tells the user EXACTLY what state continuity
// is in (ready / needs review / not yet run). Category cards use plain
// labels: "Passed" / "Warning" / "Failed" / "Not checked yet".
//
// Backend: heuristic validator at `backend/src/continuity/validator.ts`
// returns {summary, issues}. Summary only counts ISSUES — `pass:0,
// warning:0, fail:0` for a category means "no issues" once the pass
// has actually run.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, Check, CheckCircle2, ChevronDown,
  ChevronRight, Circle, Eye, FileText, Film, Info, Loader2, Package,
  PlayCircle, Plus, RefreshCw, Sparkles, Trash2, User,
} from "lucide-react";
import {
  api, type ContinuityIssue, type ContinuityPassResult,
  type ContinuityManualFinding,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";

interface Props {
  scriptId: string;
  onChange: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  character: "Character continuity",
  location: "Location continuity",
  prop: "Props",
  eyeline: "Eyelines",
  reference: "Reference attachment",
  story_containment: "Story containment",
};

const CATEGORY_ICON: Record<string, typeof User> = {
  character: User,
  location: Film,
  prop: Package,
  eyeline: Eye,
  reference: Sparkles,
  story_containment: FileText,
};

const SEVERITY_TONE: Record<string, string> = {
  pass: "text-emerald-300",
  warning: "text-amber-300",
  fail: "text-red-300",
};

const SEVERITY_LABEL: Record<string, string> = {
  pass: "Note",
  warning: "Warning",
  fail: "Issue requiring fix",
};

export function ContinuityPanel({ scriptId, onChange }: Props) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["continuity-status", scriptId],
    queryFn: () => api.getContinuityStatus(scriptId),
  });
  const runPass = useMutation({
    mutationFn: () => api.runContinuityPass(scriptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["continuity-status", scriptId] });
      qc.invalidateQueries({ queryKey: ["workflow"] });
      onChange();
    },
  });
  const deleteFinding = useMutation({
    mutationFn: (id: string) => api.deleteContinuityFinding(scriptId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["continuity-status", scriptId] });
    },
  });

  const data: ContinuityPassResult | null = statusQ.data ?? null;
  const hasRun = !!(data && data.runAt);
  const manualFindings = data?.manualFindings ?? [];
  const heuristicIssues = data?.issues ?? [];

  const totals = useMemo(() => {
    let warning = 0, fail = 0;
    if (data?.summary) {
      for (const v of Object.values(data.summary)) {
        warning += v.warning; fail += v.fail;
      }
    }
    for (const m of manualFindings) {
      if (m.severity === "warning") warning++;
      else if (m.severity === "fail") fail++;
    }
    return { warning, fail };
  }, [data, manualFindings]);

  // Overall state — what the supervisor needs to know at a glance.
  let overall: "not_run" | "ready" | "needs_review";
  if (!hasRun && manualFindings.length === 0) overall = "not_run";
  else if (totals.warning === 0 && totals.fail === 0) overall = "ready";
  else overall = "needs_review";

  return (
    <div className="space-y-3">
      {/* Hero result — the headline status. */}
      <HeroResult
        overall={overall}
        warnings={totals.warning}
        fails={totals.fail}
        runAt={data?.runAt}
        runPending={runPass.isPending}
        onRunPass={() => runPass.mutate()}
        hasRun={hasRun}
      />

      {runPass.error && (
        <div className="rounded border border-red-700/30 bg-red-900/10 px-2.5 py-1.5 text-[11px] text-red-200">
          <AlertCircle size={10} className="inline mr-1" />
          Pass failed: {(runPass.error as Error).message}
        </div>
      )}

      {/* Per-category status grid. Plain labels. */}
      {(hasRun || manualFindings.length > 0) && (
        <div>
          <div className="os-sec-label">
            <span className="os-eyebrow-h" style={{ fontSize: 15, fontWeight: 600, color: "var(--os-t-1)", letterSpacing: "-0.01em" }}>
              Continuity areas
            </span>
          </div>
          <div className="os-cat-grid">
            {Object.keys(CATEGORY_LABEL).map((cat) => {
              const heur = data?.summary?.[cat as keyof typeof data.summary] ??
                { pass: 0, warning: 0, fail: 0 };
              const manualHere = manualFindings.filter(
                (m) =>
                  (m.category === "other" ? "story_containment" : m.category) === cat
              );
              const w = heur.warning + manualHere.filter((m) => m.severity === "warning").length;
              const f = heur.fail + manualHere.filter((m) => m.severity === "fail").length;
              return (
                <CategoryCard
                  key={cat}
                  category={cat}
                  hasRun={hasRun}
                  warning={w}
                  failure={f}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Findings list — only renders when there's something to fix. */}
      {(heuristicIssues.length > 0 || manualFindings.length > 0) && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.12em] text-bone-500 mb-1.5">
            Findings
          </div>
          <IssueList
            issues={heuristicIssues}
            manual={manualFindings}
            onDelete={(id) => deleteFinding.mutate(id)}
          />
        </div>
      )}

      {/* Honest disclosure — what the heuristic actually catches. */}
      <CoverageDisclosure />

      {/* Manual finding form — Script Supervisor logs what the
       *  heuristic missed. */}
      <ManualFindingForm
        scriptId={scriptId}
        onSaved={() => statusQ.refetch()}
      />

      {/* Forward-look — make it crystal clear what approving does. */}
      {hasRun && (
        <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] text-bone-300">
          <div className="text-bone-100 font-medium mb-0.5">
            What approving Continuity does
          </div>
          Approving this stage unlocks <strong>Prompt Supervisor</strong> — the
          next-stage step where every shot's video prompt is regenerated against
          the canon you've approved so far.
        </div>
      )}
    </div>
  );
}

function HeroResult({
  overall,
  warnings,
  fails,
  runAt,
  runPending,
  onRunPass,
  hasRun,
}: {
  overall: "not_run" | "ready" | "needs_review";
  warnings: number;
  fails: number;
  runAt?: string;
  runPending: boolean;
  onRunPass: () => void;
  hasRun: boolean;
}) {
  const variant =
    overall === "ready" ? "is-ready" : overall === "needs_review" ? "is-attn" : "is-attn";
  const headline =
    overall === "not_run"
      ? "Run continuity pass first."
      : overall === "ready"
        ? "Continuity is ready for approval."
        : "Continuity needs review.";
  const sub =
    overall === "not_run"
      ? "The Script Supervisor's checks haven't been run on the current draft yet."
      : overall === "ready"
        ? `All continuity checks completed with no issues.${runAt ? ` Last checked ${fmtTime(runAt)}.` : ""} You can approve to advance to Prompt Supervisor.`
        : `${fails > 0 ? `${fails} issue${fails === 1 ? "" : "s"} requiring fixes` : ""}${fails > 0 && warnings > 0 ? " · " : ""}${warnings > 0 ? `${warnings} warning${warnings === 1 ? "" : "s"}` : ""}. Resolve the findings below, then re-run the pass.`;
  return (
    <div className={`os-readiness ${variant}`}>
      <span className="os-rb-ring">
        {overall === "ready" ? (
          <Check size={20} />
        ) : (
          <AlertTriangle size={20} />
        )}
      </span>
      <div className="os-rb-text">
        <div className="os-rb-headline">{headline}</div>
        <div className="os-rb-sub">{sub}</div>
      </div>
      <button
        type="button"
        onClick={onRunPass}
        disabled={runPending}
        className={overall === "not_run" ? "os-btn os-btn-primary" : "os-btn os-btn-ghost"}
      >
        {runPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : overall === "not_run" ? (
          <PlayCircle size={14} />
        ) : (
          <RefreshCw size={14} />
        )}
        {overall === "not_run" ? "Run continuity pass" : "Re-run pass"}
      </button>
    </div>
  );
}

function CategoryCard({
  category,
  hasRun,
  warning,
  failure,
}: {
  category: string;
  hasRun: boolean;
  warning: number;
  failure: number;
}) {
  const Icon = CATEGORY_ICON[category] ?? User;
  const label = CATEGORY_LABEL[category] ?? category;
  let state: "not_checked" | "passed" | "warning" | "failed";
  if (!hasRun) state = "not_checked";
  else if (failure > 0) state = "failed";
  else if (warning > 0) state = "warning";
  else state = "passed";
  const cellMod =
    state === "failed"
      ? "is-block"
      : state === "warning"
        ? "is-attn"
        : "";
  const tagCls =
    state === "passed"
      ? "is-approved"
      : state === "warning"
        ? "is-attn"
        : state === "failed"
          ? "is-block"
          : "is-locked";
  const note =
    state === "not_checked"
      ? "Not checked yet"
      : state === "passed"
        ? "Cleared — no issues"
        : state === "warning"
          ? warning === 1
            ? "1 warning to review"
            : `${warning} warnings to review`
          : failure === 1
            ? "1 issue requires a fix"
            : `${failure} issues require fixes`;
  const tagText =
    state === "not_checked"
      ? "Not checked"
      : state === "passed"
        ? "Cleared"
        : state === "warning"
          ? "Warning"
          : "Failed";
  return (
    <div className={`os-cat-cell ${cellMod}`}>
      <div className="os-cat-top">
        <Icon size={13} style={{ color: "var(--os-t-3)" }} />
        <span className="os-cat-name">{label}</span>
      </div>
      <p className="os-cat-note">{note}</p>
      <span className={`os-cat-tag ${tagCls}`}>{tagText}</span>
    </div>
  );
}

function IssueList({
  issues,
  manual,
  onDelete,
}: {
  issues: ContinuityIssue[];
  manual: ContinuityManualFinding[];
  onDelete: (id: string) => void;
}) {
  const manualAsIssues: Array<ContinuityIssue & { manual?: ContinuityManualFinding }> = manual.map((m) => ({
    id: m.id,
    category: (m.category === "other" ? "story_containment" : m.category) as ContinuityIssue["category"],
    severity: m.severity,
    where: {
      sceneOrd: m.where.sceneOrd ?? null,
      shotIndex: m.where.shotIndex ?? null,
    },
    message: m.message,
    suggestedFix: m.suggestedFix,
    manual: m,
  }));
  const all = [...issues, ...manualAsIssues];
  const fails = all.filter((i) => i.severity === "fail");
  const warns = all.filter((i) => i.severity === "warning");
  const passes = all.filter((i) => i.severity === "pass");
  return (
    <div className="space-y-2">
      {fails.length > 0 && (
        <IssueGroup
          label={`Issues requiring fixes (${fails.length})`}
          tone="red"
          issues={fails}
          defaultOpen
          onDelete={onDelete}
        />
      )}
      {warns.length > 0 && (
        <IssueGroup
          label={`Warnings (${warns.length})`}
          tone="amber"
          issues={warns}
          defaultOpen={fails.length === 0}
          onDelete={onDelete}
        />
      )}
      {passes.length > 0 && (
        <IssueGroup
          label={`Notes (${passes.length})`}
          tone="emerald"
          issues={passes}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

function IssueGroup({
  label,
  tone,
  issues,
  defaultOpen,
  onDelete,
}: {
  label: string;
  tone: "red" | "amber" | "emerald";
  issues: Array<ContinuityIssue & { manual?: ContinuityManualFinding }>;
  defaultOpen?: boolean;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const ring =
    tone === "red"
      ? "border-red-700/30 bg-red-900/5"
      : tone === "amber"
        ? "border-amber-700/30 bg-amber-900/5"
        : "border-emerald-700/30 bg-emerald-900/5";
  return (
    <div className={`rounded border ${ring}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown size={12} className="text-bone-400" /> : <ChevronRight size={12} className="text-bone-400" />}
          <span className="text-[11px] uppercase tracking-[0.12em] text-bone-300 font-medium">
            {label}
          </span>
        </div>
      </button>
      {open && (
        <ul className="px-2.5 pb-2 space-y-1.5">
          {issues.map((iss) => (
            <li key={iss.id} className="rounded border border-white/8 bg-black/20 px-2 py-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] uppercase tracking-wide ${SEVERITY_TONE[iss.severity]} mb-0.5 flex items-center gap-1.5`}>
                    <span>
                      {SEVERITY_LABEL[iss.severity] ?? iss.severity} · {CATEGORY_LABEL[iss.category] ?? iss.category}
                    </span>
                    {iss.manual && (
                      <span className="text-[9px] rounded-full bg-sky-900/40 text-sky-200 ring-1 ring-sky-700/40 px-1.5 py-0.5 normal-case tracking-normal">
                        Logged by Script Supervisor
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-bone-100">{iss.message}</div>
                  {(iss.where.sceneOrd != null || iss.where.shotIndex != null || iss.where.characterName || iss.where.locationName || iss.where.propName) && (
                    <div className="mt-0.5 text-[10px] text-bone-500">
                      {whereLabel(iss.where)}
                    </div>
                  )}
                  {iss.suggestedFix && (
                    <div className="mt-1 text-[11px] text-sky-200">
                      <strong className="text-sky-100">Suggested fix:</strong> {iss.suggestedFix}
                    </div>
                  )}
                </div>
                {iss.manual && (
                  <button
                    type="button"
                    onClick={() => onDelete(iss.id)}
                    className="shrink-0 text-bone-500 hover:text-red-300 transition"
                    title="Delete this finding"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CoverageDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-left"
      >
        <span className="text-[11px] text-bone-300 inline-flex items-center gap-1.5">
          <Info size={11} className="text-bone-400" /> What the continuity pass catches (read this)
        </span>
        {open ? (
          <ChevronDown size={11} className="text-bone-400" />
        ) : (
          <ChevronRight size={11} className="text-bone-400" />
        )}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 text-[11px] text-bone-200 leading-relaxed space-y-2">
          <div>
            <div className="text-bone-100 font-medium mb-0.5">Catches:</div>
            <ul className="list-disc pl-4 space-y-0.5 text-bone-300">
              <li>Scenes tagged with a character that has no record.</li>
              <li>Visible characters with no reference image or Kling ID.</li>
              <li>Scenes whose slugline doesn't match any Location Bible.</li>
              <li>Briefs whose framing matches a bible's forbidden-angle phrase.</li>
              <li>Props named in briefs that don't have a Prop Bible.</li>
              <li>Briefs with "facing away / wrong direction / flipped" near a prop.</li>
              <li>Close-up + observational shots with no eyeline declared.</li>
              <li>Prompts that literally say "looks into the lens / camera".</li>
              <li>startFrameImage / endFrameImage pointing at a character reference URL.</li>
              <li>Voice-only / text-only characters appearing as visible.</li>
            </ul>
          </div>
          <div>
            <div className="text-bone-100 font-medium mb-0.5">Does NOT catch (log these manually):</div>
            <ul className="list-disc pl-4 space-y-0.5 text-bone-300">
              <li>Wardrobe drift between scenes.</li>
              <li>DP brief internal contradictions.</li>
              <li>Director's blocking brief contradicting earlier shot's end position.</li>
              <li>Approved canon textOverride not surfaced in stored prompts (the Stale Prompts panel above covers that).</li>
              <li>Location constraint violations (e.g. window light when location says no visible window).</li>
              <li>Beat-level story drift across scenes.</li>
            </ul>
          </div>
          <div className="text-bone-400">
            This is a deterministic heuristic — no LLM. A clean run is necessary, not sufficient.
          </div>
        </div>
      )}
    </div>
  );
}

function ManualFindingForm({
  scriptId,
  onSaved,
}: {
  scriptId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"character" | "location" | "prop" | "eyeline" | "reference" | "story_containment" | "other">("other");
  const [severity, setSeverity] = useState<"warning" | "fail">("warning");
  const [message, setMessage] = useState("");
  const [suggestedFix, setSuggestedFix] = useState("");
  const [sceneOrd, setSceneOrd] = useState("");
  const [shotIndex, setShotIndex] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.logContinuityFinding(scriptId, {
        category,
        severity,
        message,
        suggestedFix: suggestedFix.trim() || undefined,
        sceneOrd: sceneOrd ? Math.max(0, Number(sceneOrd) - 1) : null,
        shotIndex: shotIndex ? Number(shotIndex) : null,
      }),
    onSuccess: () => {
      setMessage("");
      setSuggestedFix("");
      setSceneOrd("");
      setShotIndex("");
      setOpen(false);
      onSaved();
    },
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus size={12} className="mr-1" /> Add a manual finding the pass missed
      </Button>
    );
  }

  const inputCls =
    "w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 placeholder:text-bone-500 px-2 py-1 text-xs";

  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-3 space-y-2">
      <div className="text-sm text-bone-100 font-medium">New manual finding</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">Category</div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className={inputCls}
          >
            <option value="character">Character</option>
            <option value="location">Location</option>
            <option value="prop">Prop</option>
            <option value="eyeline">Eyeline</option>
            <option value="reference">Reference</option>
            <option value="story_containment">Story containment</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">Severity</div>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as typeof severity)}
            className={inputCls}
          >
            <option value="warning">Warning</option>
            <option value="fail">Issue requiring fix</option>
          </select>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">Scene (optional)</div>
          <input
            type="number"
            min={1}
            placeholder="e.g. 2 for SC02"
            value={sceneOrd}
            onChange={(e) => setSceneOrd(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">Shot (optional)</div>
          <input
            type="number"
            min={0}
            placeholder="e.g. 2 for SH02"
            value={shotIndex}
            onChange={(e) => setShotIndex(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">What's wrong</div>
        <textarea
          rows={2}
          placeholder="e.g. SH02 DP brief lists a curtained window as light source; EP01 canon says no visible window."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">Suggested fix (optional)</div>
        <textarea
          rows={2}
          placeholder="e.g. Rephrase as 'ambient off-screen bleed' — no identifiable source."
          value={suggestedFix}
          onChange={(e) => setSuggestedFix(e.target.value)}
          className={inputCls}
        />
      </div>
      <div className="flex gap-2 items-center">
        <Button
          size="sm"
          onClick={() => save.mutate()}
          disabled={save.isPending || !message.trim()}
        >
          {save.isPending ? (
            <Loader2 size={10} className="animate-spin mr-1" />
          ) : (
            <Check size={10} className="mr-1" />
          )}
          Save finding
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {save.error && (
          <span className="text-[11px] text-red-300 inline-flex items-center gap-1">
            <AlertCircle size={10} /> {(save.error as Error).message}
          </span>
        )}
      </div>
    </div>
  );
}

function whereLabel(where: ContinuityIssue["where"]): string {
  const pieces: string[] = [];
  if (where.episodeNumber != null) pieces.push(`EP${String(where.episodeNumber).padStart(2, "0")}`);
  if (where.sceneOrd != null) pieces.push(`SC${String(where.sceneOrd + 1).padStart(2, "0")}`);
  if (where.shotIndex != null) pieces.push(`SH${String(where.shotIndex).padStart(2, "0")}`);
  const subj = where.characterName ?? where.locationName ?? where.propName;
  if (subj) pieces.push(`· ${subj}`);
  return pieces.join(" ");
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH} hour${diffH === 1 ? "" : "s"} ago`;
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
