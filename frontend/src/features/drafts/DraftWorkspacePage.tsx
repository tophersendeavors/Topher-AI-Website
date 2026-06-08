import { Fragment, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useIsMutating,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  Edit3,
  FileText,
  Lock,
  Loader2,
  Pencil,
  PlayCircle,
  RefreshCcw,
  ShieldCheck,
  Stethoscope,
  Clapperboard,
  Heart,
  Unlock,
  History,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Copy,
  Check,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Explainer } from "@/components/ui/Explainer";
import { useUIMode } from "@/lib/uiMode";
import { BusyBar } from "@/components/ui/BusyBar";
import {
  buildInsights,
  buildCharacterHealth,
  buildHeatmap,
  buildConfidence,
  buildPacing,
  buildDevelopmentSummary,
  rankFixes,
  CHARACTER_CLASS_LABEL,
  PASSES,
  analyzeSceneTurn,
  classifySceneJob,
  summarizeTurns,
  TURN_LEVEL_LABEL,
  SCENE_JOB_LABEL,
  SCENE_JOB_PROFILE,
  type AnalyzedScene,
  type SceneFlag,
  type PassKey,
  type CharacterHealth,
  type ScenePurpose,
  type PacingKind,
  type TurnLevel,
  type SceneJob,
} from "@toburt/shared";

import { AIVideoPromptsPanel } from "./AIVideoPromptsPanel";

type SceneRow = Awaited<ReturnType<typeof api.listSceneRows>>[number];

// Derive a Google Flow / Veo shot list from the (untouched) draft. The source
// screenplay is never modified — this adaptation lives separately in metadata.
function VideoAdaptationPanel({ scriptId, ready }: { scriptId: string; ready: boolean }) {
  const qc = useQueryClient();
  const sceneRows = useQuery({ queryKey: ["scene-rows", scriptId], queryFn: () => api.listSceneRows(scriptId) });
  const adaptation = useQuery({ queryKey: ["veo-adaptation", scriptId], queryFn: () => api.getVeoAdaptation(scriptId), enabled: ready });
  const byOrd = new Map((adaptation.data ?? []).map((a) => [a.ord, a]));
  const [regen, setRegen] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);

  const adapt = useMutation({
    mutationFn: (v: { ord: number; notes?: string }) => api.adaptSceneVeo(scriptId, v.ord, v.notes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["veo-adaptation", scriptId] }),
  });

  const rows = (sceneRows.data ?? []).filter((r) => ["generated", "revised", "locked"].includes(r.status));

  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  const runAll = async () => {
    setBatching(true);
    try {
      for (const r of rows) {
        if (byOrd.has(r.ord)) continue;
        await adapt.mutateAsync({ ord: r.ord });
      }
    } finally {
      setBatching(false);
    }
  };

  return (
    <Panel eyebrow="AI Video" title="AI Video Adaptation — Google Flow (Veo)">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex-1 text-xs text-bone-400">
          Turns each scene into ~8s Veo-ready shot prompts (camera, lighting, style,
          re-stated character looks, synced dialogue where it fits). Your screenplay is
          never changed — this is a separate, derived adaptation.
          {!ready && <span className="ml-2 text-amber-300">— write at least one scene first</span>}
        </div>
        <Button variant="outline" onClick={runAll} disabled={!ready || batching || adapt.isPending}>
          {batching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
          Generate all scenes
        </Button>
      </div>
      {adapt.error && <div className="mt-2 text-xs text-red-300">{(adapt.error as Error).message}</div>}

      {ready && (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const a = byOrd.get(r.ord);
            const isAdapting = adapt.isPending && adapt.variables?.ord === r.ord;
            return (
              <li key={r.ord} className="rounded-md border border-white/8 bg-white/[0.02] p-2 text-xs">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-bone-500">#{r.ord}</span>
                  <span className="text-bone-300">{r.slugline}</span>
                  {a && <span className="ml-auto text-[10px] text-bone-500">{a.shots.length} shots</span>}
                </div>

                {a && a.shots.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="flex justify-end">
                      <button
                        onClick={() => copy(`all-${r.ord}`, a.shots.map((s) => `Shot ${s.index} (${s.shotSize}, ${s.cameraMove}, ${s.durationSec}s):\n${s.prompt}${s.dialogue ? `\nDialogue: ${s.dialogue}` : ""}`).join("\n\n"))}
                        className="rounded-md border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                      >
                        {copied === `all-${r.ord}` ? "Copied ✓" : "Copy all shots"}
                      </button>
                    </div>
                    {a.shots.map((s) => (
                      <div key={s.index} className="rounded border border-white/8 bg-black/20 p-2">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-bone-500">
                          <span className="font-mono text-sky-300">Shot {s.index}</span>
                          <span className="chip border-white/12 bg-white/[0.04] text-bone-300">{s.shotSize}</span>
                          <span>{s.cameraMove}</span>
                          <span>{s.durationSec}s</span>
                          <button
                            onClick={() => copy(`${r.ord}-${s.index}`, s.prompt)}
                            className="ml-auto rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.06]"
                          >
                            {copied === `${r.ord}-${s.index}` ? "Copied ✓" : "Copy prompt"}
                          </button>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-bone-200">{s.prompt}</div>
                        {s.dialogue && (
                          <div className="mt-1 text-bone-300"><span className="text-bone-500">Dialogue:</span> {s.dialogue}</div>
                        )}
                        {s.notes && <div className="mt-0.5 text-[10px] text-amber-300">{s.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!a ? (
                    <button
                      onClick={() => adapt.mutate({ ord: r.ord })}
                      disabled={isAdapting || batching}
                      className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                    >
                      {isAdapting && <Loader2 className="h-3 w-3 animate-spin" />}
                      Generate Veo shot list
                    </button>
                  ) : (
                    <>
                      <input
                        value={regen[r.ord] ?? ""}
                        onChange={(e) => setRegen((m) => ({ ...m, [r.ord]: e.target.value }))}
                        placeholder="add a note to steer the shots…"
                        className="input min-w-[180px] flex-1 py-1 text-[11px]"
                      />
                      <button
                        onClick={() => adapt.mutate({ ord: r.ord, notes: (regen[r.ord] ?? "").trim() || undefined })}
                        disabled={isAdapting}
                        className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                      >
                        {isAdapting ? <Loader2 className="h-3 w-3 animate-spin" /> : (regen[r.ord] ?? "").trim() ? "Regenerate with notes" : "Regenerate"}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// 95% Script Quality Protocol — dashboard + per-scene drill-in.
// Composes the existing analyzers (turn, EI, subtext, continuity) into one
// scorecard with critical-category enforcement. The AI never marks a scene
// Spec Ready — only the writer can flip humanApproved.
function AuditPanel({ scriptId, ready }: { scriptId: string; ready: boolean }) {
  const qc = useQueryClient();
  const { isSimple, isAdvanced } = useUIMode();
  const dashboard = useQuery({
    queryKey: ["audit-dashboard", scriptId],
    queryFn: () => api.getAuditDashboard(scriptId),
    enabled: ready,
  });
  const rows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
    enabled: ready,
  });
  const auditAll = useMutation({
    mutationFn: () => api.auditScript(scriptId, false),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] }),
  });
  const auditOne = useMutation({
    mutationFn: (v: { ord: number; useLLM?: boolean }) =>
      api.auditScene(scriptId, v.ord, { useLLM: v.useLLM }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] }),
  });
  const approve = useMutation({
    mutationFn: (v: { ord: number; approved: boolean }) =>
      api.setSceneApproval(scriptId, v.ord, v.approved),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] }),
  });
  const [expanded, setExpanded] = useState<number | null>(null);

  const byOrd = new Map((dashboard.data ?? []).map((a) => [a.ord, a]));
  const sceneRows = (rows.data ?? []).filter((r) => ["generated", "revised", "locked"].includes(r.status));

  const summary = (() => {
    const items = dashboard.data ?? [];
    const green = items.filter((a) => a.status === "green").length;
    const yellow = items.filter((a) => a.status === "yellow").length;
    const red = items.filter((a) => a.status === "red").length;
    const approved = items.filter((a) => a.humanApproved).length;
    return { total: items.length, green, yellow, red, approved };
  })();

  return (
    <Panel
      eyebrow="Quality Gate"
      title={
        <span className="flex items-center">
          95% Script Quality Audit
          <Explainer id="ninety_five_protocol" />
        </span>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 text-xs text-bone-400">
          {isSimple ? (
            <>
              The system reads each scene and gives it plain-English notes —
              what's working, what to fix, and which one-click rewrite pass to
              run. AI never approves a scene; you do.
            </>
          ) : (
            <>
              Scores each scene 1–10 across ten categories. <span className="text-bone-200">Pass = avg ≥ 8.5 AND
              no critical category below 8.</span> Critical: Narrative Engine, Scene Turn, Character Voice,
              Subtext, Continuity. AI never marks a scene Spec Ready — only you can.
            </>
          )}
          {!ready && <span className="ml-2 text-amber-300">— write some of the draft first</span>}
        </div>
        <Button variant="outline" onClick={() => auditAll.mutate()} disabled={!ready || auditAll.isPending}>
          {auditAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Audit all scenes
        </Button>
      </div>
      {auditAll.error && (
        <div className="mt-2 text-xs text-red-300">{(auditAll.error as Error).message}</div>
      )}

      {ready && summary.total > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-200">
            {summary.green} pass
          </span>
          <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">
            {summary.yellow} polish
          </span>
          <span className="chip border-red-700/50 bg-red-900/30 text-red-200">
            {summary.red} fail
          </span>
          <span className="chip border-white/12 bg-white/[0.04] text-bone-300">
            {summary.approved} Spec Ready (you approved)
          </span>
        </div>
      )}

      {ready && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[10px] uppercase tracking-wide text-bone-500">
              <tr>
                <th className="px-2 py-1">#</th>
                <th className="px-2 py-1">Slugline</th>
                <th className="px-2 py-1">Status</th>
                {isAdvanced && <th className="px-2 py-1">Avg</th>}
                <th className="px-2 py-1">{isSimple ? "What to fix" : "Critical fails"}</th>
                {isAdvanced && <th className="px-2 py-1">Last pass</th>}
                <th className="px-2 py-1">Approved</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {sceneRows.map((r) => {
                const a = byOrd.get(r.ord);
                const expanded2 = expanded === r.ord;
                return (
                  <Fragment key={r.ord}>
                    <tr className="border-t border-white/6">
                      <td className="px-2 py-1 font-mono text-bone-500">#{r.ord}</td>
                      <td className="px-2 py-1 text-bone-200">{r.slugline}</td>
                      <td className="px-2 py-1">
                        {!a ? (
                          <span className="chip border-white/10 bg-white/[0.02] text-bone-500">
                            ·  unaudited
                          </span>
                        ) : (
                          <span className={statusChip(a.status)}>{statusLabel(a.status)}</span>
                        )}
                      </td>
                      {isAdvanced && (
                        <td className="px-2 py-1">
                          {a ? (
                            <span className={a.averageScore >= 8.5 ? "text-emerald-300" : a.averageScore >= 7 ? "text-amber-300" : "text-red-300"}>
                              {a.averageScore.toFixed(1)}
                            </span>
                          ) : (
                            <span className="text-bone-600">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-2 py-1 text-bone-300">
                        {a && a.criticalFailures.length > 0
                          ? (isSimple
                              ? plainEnglishDiagnosis(a.criticalFailures)
                              : a.criticalFailures.map((k) => k.replace(/_/g, " ")).join(", "))
                          : a ? <span className="text-bone-500">{isSimple ? "Reads clean" : "none"}</span> : ""}
                      </td>
                      {isAdvanced && <td className="px-2 py-1 text-bone-400">{a?.passLabel ?? ""}</td>}
                      <td className="px-2 py-1">
                        {a ? (
                          <input
                            type="checkbox"
                            checked={a.humanApproved}
                            onChange={(e) => approve.mutate({ ord: r.ord, approved: e.target.checked })}
                            className="h-3.5 w-3.5 accent-emerald-500"
                            title={a.humanApproved ? "Marked Spec Ready by you" : "Mark Spec Ready (only you can)"}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => auditOne.mutate({ ord: r.ord })}
                            disabled={auditOne.isPending}
                            className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
                          >
                            {auditOne.isPending && auditOne.variables?.ord === r.ord ? "…" : a ? "Re-audit" : "Audit"}
                          </button>
                          {a && (
                            <button
                              onClick={() => setExpanded((x) => (x === r.ord ? null : r.ord))}
                              className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                            >
                              {expanded2 ? "Hide" : "Details"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded2 && a && (
                      <tr className="border-t border-white/6">
                        <td colSpan={isAdvanced ? 8 : 6} className="bg-white/[0.02] px-2 py-2">
                          <div className="space-y-2">
                            <div className="grid gap-1 sm:grid-cols-2">
                              {/* In Simple mode, surface only the categories
                                  that need attention — hide the noise of every
                                  category at 9.5 with no failing items. */}
                              {a.categories
                                .filter((c) =>
                                  isAdvanced ||
                                  c.score < 8.5 ||
                                  c.failingItems.length > 0
                                )
                                .map((c) => (
                                <div key={c.key} className="rounded border border-white/8 bg-black/30 p-1.5">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span
                                      className={c.critical ? "text-amber-200" : "text-bone-200"}
                                    >
                                      {c.critical && "★ "}
                                      {c.label}
                                      <CategoryExplainer categoryKey={c.key} />
                                    </span>
                                    {isAdvanced && (
                                      <span
                                        className={
                                          c.score >= 8.5
                                            ? "text-emerald-300"
                                            : c.score >= 7
                                            ? "text-amber-300"
                                            : "text-red-300"
                                        }
                                      >
                                        {c.score.toFixed(1)}
                                      </span>
                                    )}
                                  </div>
                                  {isAdvanced && (
                                    <div className="mt-0.5 h-1 overflow-hidden rounded bg-white/8">
                                      <div
                                        className={`h-full ${
                                          c.score >= 8.5
                                            ? "bg-emerald-500"
                                            : c.score >= 7
                                            ? "bg-amber-500"
                                            : "bg-red-500"
                                        }`}
                                        style={{ width: `${(c.score / 10) * 100}%` }}
                                      />
                                    </div>
                                  )}
                                  {c.failingItems.length > 0 && (
                                    <ul className="mt-1 list-disc pl-4 text-[10px] text-bone-300">
                                      {c.failingItems.slice(0, 3).map((f, i) => (
                                        <li key={i}>{f}</li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="mt-1 text-[10px] text-bone-400">
                                    → {c.rewriteHint}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {a.rewriteStrategy.length > 0 && (
                              <div className="text-[11px] text-bone-300">
                                <span className="text-bone-500">Recommended passes (most impactful first):</span>{" "}
                                {a.rewriteStrategy.map((p) => (
                                  <span key={p} className="chip mr-1 border-sky-700/50 bg-sky-900/30 text-sky-200">
                                    {p}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="text-[10px] text-bone-500">
                              To run a fix: open Rewrite &amp; Polish below, pick the matching pass, then
                              Preview → Apply. The dashboard re-audits automatically.
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function statusChip(s: "green" | "yellow" | "red" | "gray"): string {
  if (s === "green") return "chip border-emerald-700/50 bg-emerald-900/30 text-emerald-200";
  if (s === "yellow") return "chip border-amber-700/50 bg-amber-900/30 text-amber-200";
  if (s === "red") return "chip border-red-700/50 bg-red-900/30 text-red-200";
  return "chip border-white/12 bg-white/[0.02] text-bone-500";
}
function statusLabel(s: "green" | "yellow" | "red" | "gray"): string {
  if (s === "green") return "Pass";
  if (s === "yellow") return "Polish";
  if (s === "red") return "Fail";
  return "Unaudited";
}

// Translate the 95% Protocol's category keys into one short, plain-English
// diagnosis. Used in Simple mode where "narrative_engine, scene_turn" reads
// as engineering shorthand.
function plainEnglishDiagnosis(criticals: string[]): string {
  const out: string[] = [];
  if (criticals.includes("scene_turn")) out.push("needs a clearer turn");
  if (criticals.includes("subtext"))
    out.push("dialogue explains emotion too directly");
  if (criticals.includes("character_voice")) out.push("voices read similar");
  if (criticals.includes("narrative_engine"))
    out.push("doesn't push the story forward");
  if (criticals.includes("continuity")) out.push("a continuity slip");
  if (out.length === 0) {
    // Non-critical failures aren't listed here — the table only shows
    // criticalFailures. Fall back to the raw key replacement.
    return criticals.map((k) => k.replace(/_/g, " ")).join(", ");
  }
  return out.join(" · ");
}

// Map audit-category keys to the glossary so a non-expert can hover the
// term and learn what it means. Returns null for categories we don't
// explain — the Explainer renders nothing in that case.
const CATEGORY_EXPLAIN_KEY: Record<string, string | null> = {
  scene_turn: "scene_turn",
  subtext: "subtext",
  power_shift: "power_shift",
  visual_behavior: "visual_behavior",
  emotional_residue: "emotional_residue",
  spec_formatting: "spec_format",
  // No glossary entry for these — Explainer renders null.
  narrative_engine: null,
  character_voice: null,
  pacing_rhythm: null,
  continuity: null,
};
function CategoryExplainer({ categoryKey }: { categoryKey: string }) {
  const id = CATEGORY_EXPLAIN_KEY[categoryKey];
  if (!id) return null;
  return <Explainer id={id} />;
}

// Explicit promotion to Draft N+1. Decimal versions (v1.1_SubtextPass etc.)
// are tracked automatically by the audit; promoting to a new full draft is
// the writer's call. After confirm we navigate to the new draft's workspace.
function StartNewDraftButton({ scriptId, projectId }: { scriptId: string; projectId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const promote = useMutation({
    mutationFn: () => api.startNewDraft(scriptId),
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["scripts", projectId] });
      qc.invalidateQueries({ queryKey: ["script", scriptId] });
      setOpen(false);
      navigate(`/projects/${projectId}/drafts/${next.id}`);
    },
  });
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Start new full draft
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">Start a new full draft?</h2>
            <p className="mt-2 text-sm text-bone-300">
              This promotes the current draft to <strong>Draft N+1</strong> — a deliberate full
              revision. The new draft is seeded from this one's scenes, and the current draft is
              demoted to history (still readable / restorable). Audit history starts fresh.
            </p>
            <p className="mt-2 text-xs text-bone-400">
              Use this only when you're intentionally beginning a major new pass. For smaller
              rewrite passes, the version label increments automatically (v1.1, v1.2, …) via the
              audit + Rewrite &amp; Polish flow.
            </p>
            {promote.error && (
              <div className="mt-2 text-xs text-red-300">{(promote.error as Error).message}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => promote.mutate()} disabled={promote.isPending}>
                {promote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Start new draft
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Rename the draft (script) title from the workspace header — any time.
function RenameScriptButton({ scriptId, currentTitle }: { scriptId: string; currentTitle: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentTitle);
  const rename = useMutation({
    mutationFn: (title: string) => api.updateScript(scriptId, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["script", scriptId] });
      setOpen(false);
    },
  });
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setValue(currentTitle);
          setOpen(true);
        }}
      >
        <Pencil className="h-4 w-4" /> Rename
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">Rename draft</h2>
            <input
              className="input mt-3 w-full"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) rename.mutate(value.trim());
              }}
            />
            {rename.error && (
              <div className="mt-2 text-xs text-red-300">{(rename.error as Error).message}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => rename.mutate(value.trim())}
                disabled={!value.trim() || value.trim() === currentTitle || rename.isPending}
              >
                {rename.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function DraftWorkspacePage() {
  const { projectId, scriptId } = useParams<{
    projectId: string;
    scriptId: string;
  }>();
  const navigate = useNavigate();
  if (!projectId || !scriptId) return null;

  const script = useQuery({
    queryKey: ["script", scriptId],
    queryFn: () => api.getScript(scriptId),
  });

  // Tier guard — this workspace is built for the prestige TV pipeline
  // (multi-scene drafts, scene-by-scene generation, audit, emotional
  // continuity, etc.). Micro-drama screenplays (single-scene, generated
  // and approved via the Episodes-page Screenplay block) crash this
  // workspace silently because the prestige sub-components expect
  // artifacts the micro-drama path never produces. Redirect such scripts
  // back to the Episodes page where their real tools live.
  const isMicroDrama =
    ((script.data?.metadata as { source?: string } | undefined)?.source ?? "") ===
    "micro_drama_chain";
  useEffect(() => {
    if (isMicroDrama) {
      navigate(`/projects/${projectId}/episodes`, { replace: true });
    }
  }, [isMicroDrama, projectId, navigate]);
  if (isMicroDrama) {
    // Render a brief explainer while the redirect navigates so the user
    // doesn't see a black screen mid-transition.
    return (
      <div className="space-y-4 p-8 text-center text-bone-300">
        <div className="font-serif text-2xl text-bone-50">
          Micro-drama screenplay
        </div>
        <div className="mx-auto max-w-xl text-sm">
          This is a vertical-drama episode and uses a different workflow than
          prestige drafts. Sending you to the Episodes page where its
          approval, regenerate / patch, draft history, and production-asset
          tools live.
        </div>
        <Link
          to={`/projects/${projectId}/episodes`}
          className="inline-block rounded-md border border-ember-700/60 bg-ember-900/30 px-4 py-2 text-ember-100"
        >
          Go to Episodes →
        </Link>
      </div>
    );
  }
  // Poll whenever ANY scene op / range / pass mutation is in flight — not just
  // when a scene is already "generating". The old condition was self-defeating:
  // at the start of a range run all scenes are "generated", so it never began
  // polling and chips never updated.
  const sceneOpActive = useIsMutating({ mutationKey: ["scene-op", scriptId] });
  const rangeActive = useIsMutating({ mutationKey: ["pass:range", scriptId] });
  const scenes = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
    refetchInterval: (q) => {
      const data = q.state.data as SceneRow[] | undefined;
      const anyGenerating = data?.some((s) => s.status === "generating");
      // Poll fast during active work; stop when truly idle.
      return anyGenerating || sceneOpActive > 0 || rangeActive > 0 ? 2000 : false;
    },
  });

  const rows = scenes.data ?? [];
  const total = rows.length;
  const generated = rows.filter((r) => r.status === "generated" || r.status === "revised" || r.status === "locked").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const locked = rows.filter((r) => r.status === "locked").length;
  const isAnyRunning = rows.some((r) => r.status === "generating");

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Drafts"
        title={script.data?.title ?? "Draft"}
        description="Episode drafting workspace — generate, regenerate, and lock individual scenes."
        actions={
          <div className="flex items-center gap-2">
            <RenameScriptButton scriptId={scriptId} currentTitle={script.data?.title ?? ""} />
            <StartNewDraftButton scriptId={scriptId} projectId={projectId} />
            <Link to={`/projects/${projectId}/drafts`}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> All drafts
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/drafts/${scriptId}/editor`}>
              <Button variant="outline">
                <Edit3 className="h-4 w-4" /> Open raw editor
              </Button>
            </Link>
          </div>
        }
      />

      <ActivityBar scriptId={scriptId} scenesGenerating={rows.filter((r) => r.status === "generating").map((r) => r.ord)} />

      <div className="px-8 space-y-6">
        {/* Step 4: Write Draft 1 — the primary creative action */}
        <GatedDraftPanel scriptId={scriptId} projectId={projectId} total={total} />

        {/* Development package intake — paste a dev doc, route project/season/scene changes */}
        {generated > 0 && <DevelopmentPackagePanel projectId={projectId} scriptId={scriptId} />}

        {/* Steps 5–7: post-draft quality passes, in recommended order */}
        <div className="rounded-xl border border-white/8 bg-white/[0.01] p-4">
          <div className="mb-3 text-sm text-bone-200">
            Quality checks
            <span className="ml-2 text-xs text-bone-500">
              {generated > 0
                ? "Run these once your draft is written to refine the story."
                : "Available after you've written some of the draft."}
            </span>
          </div>
          <div className="space-y-4">
            {/* 95% Quality Protocol — the gate. Always first so the writer sees pass/fail at a glance. */}
            <AuditPanel scriptId={scriptId} ready={generated > 0} />
            <ContinuityPanel scriptId={scriptId} ready={generated > 0} />
            <EmotionalPanel scriptId={scriptId} projectId={projectId} ready={generated > 0} />
            <SubtextPanel scriptId={scriptId} ready={generated > 0} />
            <ScriptDoctorPanel scriptId={scriptId} ready={generated > 0} />
          </div>
        </div>

        {/* Title Page Settings — editable metadata that drives every export. */}
        <TitlePageSettingsPanel scriptId={scriptId} />

        {/* Step 9: Export */}
        <ExportsPanel
          scriptId={scriptId}
          title={script.data?.title ?? "draft"}
          ready={generated > 0}
        />

        {/* AI Video Prompts — Master Shot Brief + Model Router + per-model adapters.
            The draft is never modified — these are derived artifacts. */}
        <AIVideoPromptsPanel scriptId={scriptId} ready={generated > 0} />

        {/* Legacy Veo-only adaptation kept for backwards compat (per-scene Veo shot list). */}
        <VideoAdaptationPanel scriptId={scriptId} ready={generated > 0} />

        {/* Production tools — secondary, not part of the core writing flow */}
        <ProductionPanel scriptId={scriptId} ready={generated > 0} />

        <Panel eyebrow="Scenes" title="Scene grid">
          {scenes.isLoading ? (
            <div className="h-32 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : rows.length === 0 ? (
            <div className="text-sm text-bone-400">
              No scenes yet. This draft hasn't been broken down into scenes — try
              opening the raw editor or run an enrichment first.
            </div>
          ) : (
            <ul className="space-y-2">
              {rows.map((s) => (
                <SceneRowView key={s.id} scriptId={scriptId} scene={s} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

type GatedLog = {
  ord: number;
  slugline: string;
  pass: boolean;
  attempts: number;
  violations: { facet: string; detail: string; evidence: string }[];
  facts: string[];
  summary: string;
};

// Writing-stage credits: prompts for writer name(s) and labels the draft with
// its number + creation date. Writer names are stored scene-safely in metadata.
function DraftCredits({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const script = useQuery({ queryKey: ["script", scriptId], queryFn: () => api.getScript(scriptId) });
  const s = script.data;
  const writers = ((s?.metadata as { writers?: string[] } | undefined)?.writers ?? []).filter(Boolean);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: (names: string[]) => api.setScriptCredits(scriptId, names),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["script", scriptId] });
      setEditing(false);
    },
  });
  if (!s) return null;
  const draftN = (s as { draft_number?: number }).draft_number ?? 1;
  const created = (s as { created_at?: string }).created_at;
  const dateStr = created
    ? new Date(created).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "";
  const parse = (v: string) => v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const showForm = writers.length === 0 || editing;

  return (
    <div className="mb-3 rounded-md border border-white/8 bg-white/[0.02] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip border-white/12 bg-white/[0.04] text-bone-200">
          Draft {draftN}{dateStr ? ` · ${dateStr}` : ""}
        </span>
        {writers.length > 0 && !editing && (
          <>
            <span className="text-bone-400">Written by {writers.join(", ")}</span>
            <button
              onClick={() => { setValue(writers.join(", ")); setEditing(true); }}
              className="text-bone-500 hover:text-bone-300"
            >
              edit
            </button>
          </>
        )}
      </div>
      {showForm && (
        <div className="mt-2">
          {writers.length === 0 && (
            <div className="mb-1 text-bone-400">
              Who's writing this draft? (separate multiple names with commas)
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-[200px] flex-1 py-1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. Christopher Maretich, Jane Doe"
              onKeyDown={(e) => { if (e.key === "Enter" && parse(value).length) save.mutate(parse(value)); }}
            />
            <button
              onClick={() => save.mutate(parse(value))}
              disabled={parse(value).length === 0 || save.isPending}
              className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
            >
              {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Save credit{parse(value).length > 1 ? "s" : ""}
            </button>
            {writers.length > 0 && (
              <button onClick={() => setEditing(false)} className="text-bone-500 hover:text-bone-300">cancel</button>
            )}
          </div>
        </div>
      )}
      {save.error && <div className="mt-1 text-red-300">{(save.error as Error).message}</div>}
    </div>
  );
}

function GatedDraftPanel({
  scriptId,
  projectId,
  total,
}: {
  scriptId: string;
  projectId: string;
  total: number;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [log, setLog] = useState<GatedLog[]>([]);
  const [running, setRunning] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
  });
  const rows = sceneRows.data ?? [];
  const canonicalCount = rows.filter(
    (r) => (r as { canonical?: boolean }).canonical
  ).length;

  // Resolve the workflow that matches THIS draft's episode (legacy/season-level
  // drafts have episode_id null and pair with the project-scoped workflow).
  // Using workflows[0] picked the wrong one and finalized a different draft.
  const script = useQuery({ queryKey: ["script", scriptId], queryFn: () => api.getScript(scriptId) });
  const workflows = useQuery({
    queryKey: ["workflows", projectId],
    queryFn: () => api.listWorkflows(projectId),
  });
  const scriptEpisodeId = (script.data as { episode_id?: string | null } | undefined)?.episode_id ?? null;
  const targetWorkflow = (workflows.data ?? []).find(
    (w) => ((w as { episode_id?: string | null }).episode_id ?? null) === scriptEpisodeId
  );
  const workflowId = targetWorkflow?.id ?? workflows.data?.[0]?.id;
  const finish = useMutation({
    mutationFn: () => api.completeDraft(workflowId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workflows", projectId] });
      qc.invalidateQueries({ queryKey: ["approvals", projectId] });
      navigate(`/projects/${projectId}`);
    },
  });

  const record = (r: Awaited<ReturnType<typeof api.draftSceneGated>>) =>
    setLog((prev) => [
      {
        ord: r.ord,
        slugline: r.slugline,
        pass: r.check.pass,
        attempts: r.attempts,
        violations: r.check.violations,
        facts: r.check.continuityOut,
        summary: r.check.canonicalSummary,
      },
      ...prev,
    ]);

  async function draftOne() {
    setError(null);
    setRunning(true);
    try {
      const res = await api.draftNext(scriptId);
      if (res.done) {
        setError("Your whole draft is already written — nothing left to write.");
      } else {
        record(res as Awaited<ReturnType<typeof api.draftSceneGated>>);
        qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function draftAll() {
    setError(null);
    setRunning(true);
    setAutoMode(true);
    try {
      // Sequential: draft-next until done. Each scene gates before the next.
      // Safety cap at total+2 iterations.
      for (let i = 0; i < total + 2; i++) {
        const res = await api.draftNext(scriptId);
        if (res.done) break;
        record(res as Awaited<ReturnType<typeof api.draftSceneGated>>);
        qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setAutoMode(false);
    }
  }

  const facetLabel = (f: string) => f.replace(/_/g, " ");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const written = canonicalCount;
  const complete = total > 0 && written >= total;
  const nextStep = complete
    ? "Draft 1 complete — run your quality checks below."
    : written === 0
    ? "Start writing your first draft."
    : "Finish Draft 1.";

  return (
    <Panel eyebrow="Draft 1" title="Hollywood Draft Mode">
      <DraftCredits scriptId={scriptId} />
      {/* Simple, showrunner-facing progress */}
      <div className="rounded-lg border border-white/8 bg-white/[0.02] p-4">
        <div className="text-xs uppercase tracking-wide text-bone-500">
          Draft progress
        </div>
        <div className="mt-1 text-lg text-bone-50">
          {written} of {total} scenes written
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-ember-500 to-ember-300 transition-all"
            style={{ width: `${total ? Math.round((written / total) * 100) : 0}%` }}
          />
        </div>
        <div className="mt-2 text-sm text-bone-300">
          <span className="text-bone-500">Next recommended step:</span> {nextStep}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!complete && (
          <>
            <Button onClick={draftAll} disabled={running}>
              {running && autoMode ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              {running && autoMode ? "Writing…" : "Write the Full Draft"}
            </Button>
            <Button variant="outline" onClick={draftOne} disabled={running}>
              {running && !autoMode ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Write Next Scene
            </Button>
          </>
        )}
        {complete && (
          <div className="flex flex-col gap-2">
            <div className="text-sm text-emerald-300">
              ✓ Draft 1 is written. Run the quality checks below, or move on
              when you're happy with it.
            </div>
            <div>
              <Button
                onClick={() => finish.mutate()}
                disabled={finish.isPending || !workflowId}
              >
                {finish.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlayCircle className="h-4 w-4" />
                )}
                {finish.isPending ? "Finishing…" : "Finish Draft 1 & continue"}
              </Button>
            </div>
            {finish.error && (
              <div className="text-xs text-red-300">
                {(finish.error as Error).message}
              </div>
            )}
          </div>
        )}
      </div>

      {running && (
        <div className="mt-3">
          <BusyBar
            label={
              autoMode
                ? "Writing your draft, scene by scene"
                : "Writing the next scene"
            }
            subtext="The AI is writing each scene and checking it for story consistency before moving on. This takes a little time — no need to refresh."
          />
        </div>
      )}
      {error && (
        <div className="mt-3 rounded border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-200">
          {error}
        </div>
      )}

      {/* Friendly recent-scene feed (no technical jargon) */}
      {log.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {log.slice(0, 6).map((l, i) => (
            <li
              key={`${l.ord}-${i}`}
              className="flex items-start gap-2 text-sm text-bone-200"
            >
              <span className="mt-0.5 text-emerald-300">✓</span>
              <span>
                <span className="text-bone-400">Scene {l.ord}</span> written
                {l.summary ? ` — ${l.summary}` : ""}
                {!l.pass && (
                  <span className="ml-1 text-amber-300">
                    (adjusted for consistency)
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Everything technical lives here, opt-in */}
      {log.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-bone-500 hover:text-bone-300"
          >
            {showAdvanced ? "▾ Hide" : "▸ Advanced details"} (consistency checks, story facts)
          </button>
          {showAdvanced && (
            <ul className="mt-2 space-y-2">
              {log.map((l, i) => (
                <li
                  key={`adv-${l.ord}-${i}`}
                  className={`rounded-md border p-2 text-xs ${
                    l.pass
                      ? "border-emerald-800/50 bg-emerald-950/20"
                      : "border-amber-800/50 bg-amber-950/20"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-bone-500">#{l.ord}</span>
                    <span className="font-mono text-bone-200">{l.slugline}</span>
                    {l.attempts > 1 && (
                      <span className="text-bone-500">
                        {l.attempts} writing passes
                      </span>
                    )}
                  </div>
                  {l.violations.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {l.violations.map((v, j) => (
                        <li key={j} className="text-amber-200">
                          [{facetLabel(v.facet)}] {v.detail}
                        </li>
                      ))}
                    </ul>
                  )}
                  {l.facts.length > 0 && (
                    <div className="mt-1 text-bone-500">
                      Approved story facts: {l.facts.join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function RangeRunner({
  scriptId,
  total,
  disabled,
}: {
  scriptId: string;
  total: number;
  disabled: boolean;
}) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(2, total));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const run = useMutation({
    mutationKey: ["pass:range", scriptId],
    mutationFn: () => api.generateSceneRange(scriptId, from, to),
    onMutate: () => setStartedAt(Date.now()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] }),
  });

  // Live progress: while the range request is in flight, poll the scene rows
  // and count how many in [from,to] have been (re)generated since we started,
  // plus which scene is currently generating. Frontend-only — doesn't touch
  // the running request.
  const liveRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
    refetchInterval: run.isPending ? 2000 : false,
  });
  const rangeRows = (liveRows.data ?? []).filter(
    (r) => r.ord >= from && r.ord <= to
  );
  const currentlyGenerating = rangeRows.find((r) => r.status === "generating");
  const doneSinceStart =
    startedAt == null
      ? 0
      : rangeRows.filter(
          (r) =>
            r.status !== "generating" &&
            r.generated_at &&
            new Date(r.generated_at).getTime() >= startedAt - 1000
        ).length;
  const rangeTotal = Math.max(0, to - from + 1);

  const count = Math.max(0, to - from + 1);
  const calls = count * 4;
  const lowCost = (calls * 0.05).toFixed(2);
  const highCost = (calls * 0.3).toFixed(2);

  return (
    <Panel eyebrow="Bulk" title="Generate a range of scenes">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-bone-500">From</span>
          <input
            type="number"
            min={1}
            max={Math.max(1, total)}
            value={from}
            onChange={(e) =>
              setFrom(Math.min(Math.max(1, total), Math.max(1, parseInt(e.target.value || "1", 10))))
            }
            className="input w-24"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-bone-500">To</span>
          <input
            type="number"
            min={from}
            max={Math.max(from, total)}
            value={to}
            onChange={(e) =>
              setTo(Math.min(Math.max(from, total), Math.max(from, parseInt(e.target.value || "1", 10))))
            }
            className="input w-24"
          />
        </label>
        <div className="flex-1 text-xs text-bone-400">
          {count} scene{count === 1 ? "" : "s"} · {calls} LLM calls · ~${lowCost}–${highCost}
        </div>
        <Button
          onClick={() => run.mutate()}
          disabled={disabled || run.isPending || count <= 0 || count > total}
        >
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <PlayCircle className="h-4 w-4" />
          )}
          {run.isPending ? "Generating…" : `Generate scenes ${from}–${to}`}
        </Button>
      </div>

      {run.isPending && (
        <div className="mt-3 overflow-hidden rounded border border-ember-700/40 bg-ember-950/30">
          <div className="flex items-center gap-3 p-3 text-xs">
            <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-ember-200" />
            <div className="min-w-0 flex-1">
              <div className="text-ember-100">
                Rewriting scenes — {doneSinceStart} of {rangeTotal} done
                {currentlyGenerating && (
                  <>
                    {" "}· now on{" "}
                    <span className="font-mono">
                      #{currentlyGenerating.ord} {currentlyGenerating.slugline}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-0.5 text-ember-200/70">
                Each scene runs 4 passes (Scene → Dialogue → Behavior → Subtext)
                with the locked cast. Don't refresh — progress updates live.
              </div>
            </div>
          </div>
          <div className="h-1.5 w-full bg-ember-950/60">
            <div
              className="h-full rounded-r-full bg-gradient-to-r from-ember-500 to-ember-300 transition-all"
              style={{
                width: `${Math.round((doneSinceStart / Math.max(1, rangeTotal)) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {run.data && run.data.results.length === 0 && (
        <div className="mt-3 rounded border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-200">
          Range {run.data.from}–{run.data.to} matched no scenes on this draft.
          This draft only has {total} scene{total === 1 ? "" : "s"}. Did you mean
          a different draft? Check the Drafts list for the one marked
          <strong> current</strong>.
        </div>
      )}
      {run.data && run.data.results.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="mb-1 text-bone-400">Last run result:</div>
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
            {run.data.results.map((r) => (
              <li key={r.ord} className="rounded border border-white/8 bg-white/[0.02] p-1.5">
                <span className="text-bone-200">#{r.ord}</span>{" "}
                <span
                  className={
                    r.status === "generated"
                      ? "text-emerald-300"
                      : r.status === "skipped_locked"
                      ? "text-yellow-300"
                      : "text-red-300"
                  }
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {run.error && (
        <div className="mt-2 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(run.error as Error).message}
        </div>
      )}
    </Panel>
  );
}

/**
 * A severity count chip that stays neutral grey at 0 and only takes on its
 * severity color once it actually has a non-zero count. Avoids implying
 * problems exist before a pass has run.
 */
function CountChip({
  count,
  severity,
  label,
}: {
  count: number;
  severity: "critical" | "warn" | "info" | "resolved";
  label: string;
}) {
  const colored =
    count > 0
      ? {
          critical: "border-red-700/60 bg-red-950/40 text-red-200",
          warn: "border-amber-700/50 bg-amber-900/30 text-amber-200",
          info: "border-sky-700/50 bg-sky-900/30 text-sky-200",
          resolved: "border-emerald-700/50 bg-emerald-900/30 text-emerald-200",
        }[severity]
      : "border-white/10 bg-white/[0.03] text-bone-500";
  return <span className={`chip ${colored}`}>{count} {label}</span>;
}

function resolveSceneOrd(
  sceneRef: string | undefined,
  sceneId: string | undefined,
  rows: SceneRow[]
): number | null {
  const ref = (sceneRef ?? sceneId ?? "").trim();
  if (!ref) return null;
  // "#5", "Scene 5", "scene_5", "5"
  const numMatch = ref.match(/(?:#|scene[\s_-]+)(\d+)/i) ?? ref.match(/^(\d+)$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (rows.some((r) => r.ord === n)) return n;
  }
  // UUID match against scene row id.
  if (/^[0-9a-f-]{36}$/i.test(ref)) {
    const m = rows.find((r) => r.id === ref);
    if (m) return m.ord;
  }
  // Slugline match — normalise and look for exact / startsWith / contains.
  const norm = (s: string) =>
    s.toUpperCase().replace(/[—–-]/g, "-").replace(/\s+/g, " ").trim();
  const target = norm(ref);
  const exact = rows.find((r) => norm(r.slugline) === target);
  if (exact) return exact.ord;
  const startsWith = rows.find((r) => norm(r.slugline).startsWith(target));
  if (startsWith) return startsWith.ord;
  const contains = rows.find(
    (r) => norm(r.slugline).includes(target) || target.includes(norm(r.slugline))
  );
  if (contains) return contains.ord;
  return null;
}

function jumpToScene(ord: number) {
  const el = document.getElementById(`scene-row-${ord}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-ember-400");
  window.setTimeout(() => {
    el.classList.remove("ring-2", "ring-ember-400");
  }, 1500);
}

type SubtextIssue = Awaited<ReturnType<typeof api.runSubtextCheck>>["issues"][number];
type SubtextRevisionData = Awaited<ReturnType<typeof api.proposeSubtextRevision>>;

// Free heuristic ranking — narrative importance (severity), recurrence
// (how often this severity repeats), and emotional weight (labeling cues).
function rankSubtextIssues(
  issues: SubtextIssue[]
): Array<{ idx: number; issue: SubtextIssue; impact: number }> {
  const sevW: Record<string, number> = { critical: 1, warn: 0.6, info: 0.3 };
  const sevCount: Record<string, number> = {};
  for (const it of issues) sevCount[it.severity] = (sevCount[it.severity] ?? 0) + 1;
  const labeling = /on-the-nose|says exactly|states|explains|tells|labels|spell|narrat|over-explain|thematic/i;
  return issues
    .map((issue, idx) => {
      let impact = sevW[issue.severity] ?? 0.4;
      if (labeling.test(issue.problem)) impact += 0.2;
      impact += Math.min(0.24, ((sevCount[issue.severity] ?? 1) - 1) * 0.08);
      return { idx, issue, impact };
    })
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);
}

function SubtextPanel({ scriptId, ready }: { scriptId: string; ready: boolean }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const run = useMutation({
    mutationKey: ["pass:subtext", scriptId],
    mutationFn: () => api.runSubtextCheck(scriptId, notes.trim() || undefined),
    onSuccess: () => {
      setRevisions({});
      setChosen({});
      setApplied({});
      setPreviewByIdx({});
    },
  });
  const data = run.data;

  // Per-issue revision workflow state (propose → review → apply).
  const [revisions, setRevisions] = useState<Record<number, SubtextRevisionData>>({});
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const [applied, setApplied] = useState<Record<number, boolean>>({});
  const [batching, setBatching] = useState(false);

  const propose = useMutation({
    mutationFn: (v: { idx: number; issue: SubtextIssue }) =>
      api
        .proposeSubtextRevision(scriptId, {
          quote: v.issue.quote ?? v.issue.problem,
          problem: v.issue.problem,
          sceneRef: v.issue.sceneRef,
        })
        .then((r) => ({ idx: v.idx, r })),
    onSuccess: ({ idx, r }) => {
      setRevisions((m) => ({ ...m, [idx]: r }));
      setChosen((m) => ({ ...m, [idx]: 0 }));
    },
  });
  // Safe apply: preview the exact resulting scene + integrity check before any
  // commit. previewByIdx holds the dry-run; Confirm then commits it.
  type PreviewData = Awaited<ReturnType<typeof api.previewSubtextApply>>;
  const [previewByIdx, setPreviewByIdx] = useState<Record<number, PreviewData>>({});
  const preview = useMutation({
    mutationFn: (v: { idx: number; ord: number; original: string; replacement: string }) =>
      api.previewSubtextApply(scriptId, v.ord, v.original, v.replacement).then((r) => ({ idx: v.idx, r })),
    onSuccess: ({ idx, r }) => setPreviewByIdx((m) => ({ ...m, [idx]: r })),
  });
  const applyRev = useMutation({
    mutationFn: (v: { idx: number; ord: number; original: string; replacement: string }) =>
      api.applySubtextRevision(scriptId, v.ord, v.original, v.replacement).then(() => v),
    onSuccess: ({ idx }) => {
      setApplied((m) => ({ ...m, [idx]: true }));
      setPreviewByIdx((m) => { const n = { ...m }; delete n[idx]; return n; });
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      // Any change to scene content invalidates the audit too — keep the
      // 95% quality dashboard in sync without forcing the user to refresh.
      qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] });
    },
  });

  const runBatch = async () => {
    if (!data) return;
    setBatching(true);
    try {
      for (let i = 0; i < data.issues.length; i++) {
        if (revisions[i] || applied[i]) continue;
        await propose.mutateAsync({ idx: i, issue: data.issues[i] });
      }
    } finally {
      setBatching(false);
    }
  };

  // Draft integrity scan + safe mechanical repair (for already-damaged drafts).
  const scan = useMutation({
    mutationFn: () => api.integrityScan(scriptId),
  });
  const dedupe = useMutation({
    mutationFn: (ord: number) => api.dedupeRepair(scriptId, ord).then((r) => ({ ord, ...r })),
    onSuccess: () => {
      scan.mutate();
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      // Any change to scene content invalidates the audit too — keep the
      // 95% quality dashboard in sync without forcing the user to refresh.
      qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] });
    },
  });

  const sevColor = (s: string) =>
    s === "critical"
      ? "border-red-700/50 bg-red-950/20 text-red-200"
      : s === "warn"
      ? "border-amber-700/50 bg-amber-950/20 text-amber-200"
      : "border-white/10 bg-white/[0.02] text-bone-200";

  const top3 = data ? rankSubtextIssues(data.issues) : [];

  // Renders the propose→diff→apply controls for one issue.
  const renderRevision = (idx: number, issue: SubtextIssue) => {
    const rev = revisions[idx];
    const isProposing = propose.isPending && propose.variables?.idx === idx;
    const isApplied = applied[idx];
    if (isApplied) {
      return <div className="mt-2 text-[11px] text-emerald-300">Applied to the scene ✓</div>;
    }
    if (!rev) {
      return (
        <button
          onClick={() => propose.mutate({ idx, issue })}
          disabled={isProposing || batching}
          className="mt-2 flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
        >
          {isProposing && <Loader2 className="h-3 w-3 animate-spin" />}
          Generate revision (Subtext Pass)
        </button>
      );
    }
    const pick = chosen[idx] ?? 0;
    const pickedSug = rev.suggestions[pick];
    const chosenText = pickedSug?.text ?? "";
    const canApply = rev.located && rev.suggestions.length > 0;
    return (
      <div className="mt-2 space-y-2 rounded-md border border-sky-800/40 bg-sky-950/20 p-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2 text-bone-300">
          <span><span className="text-bone-500">Impact:</span> {rev.impact}</span>
          {rev.mode === "delete" && <span className="text-amber-300">· deletion recommended</span>}
          {rev.located && (
            <span
              className={`chip ${
                rev.confidence >= 0.85
                  ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
                  : "border-amber-700/50 bg-amber-900/30 text-amber-200"
              }`}
              title="How confident we are this is the exact line to change."
            >
              match {Math.round(rev.confidence * 100)}%
              {rev.confidence < 0.85 ? " — review the highlighted line" : ""}
            </span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-0.5 uppercase text-bone-600">Will replace (exact text)</div>
            <div className="rounded bg-black/30 p-1.5 italic text-bone-300 ring-1 ring-amber-600/30">
              {rev.original}
            </div>
          </div>
          <div>
            <div className="mb-0.5 uppercase text-emerald-400">
              Options{rev.suggestions.length > 1 ? " — compare, then choose" : ""}
            </div>
            {rev.suggestions.length === 0 ? (
              <div className="rounded bg-black/30 p-1.5 text-bone-500">
                No usable rewrite — try Regenerate.
              </div>
            ) : (
              <div className="space-y-1">
                {rev.suggestions.map((s, si) => (
                  <label
                    key={si}
                    className={`flex cursor-pointer gap-1.5 rounded p-1.5 ${
                      pick === si
                        ? s.delete
                          ? "bg-amber-900/30 ring-1 ring-amber-600/40"
                          : "bg-emerald-900/30 ring-1 ring-emerald-600/40"
                        : "bg-black/30"
                    }`}
                  >
                    {rev.suggestions.length > 1 && (
                      <input
                        type="radio"
                        name={`st-${idx}`}
                        checked={pick === si}
                        onChange={() => setChosen((m) => ({ ...m, [idx]: si }))}
                        className="mt-0.5"
                      />
                    )}
                    <span>
                      <span className={s.delete ? "text-amber-300" : "text-bone-500"}>
                        {s.level}:{" "}
                      </span>
                      {s.delete ? (
                        <span className="italic text-amber-200">remove the line entirely</span>
                      ) : (
                        <span className="text-bone-100">{s.text}</span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        {!rev.located && (
          <div className="text-amber-300">
            Couldn't locate this exact line to apply automatically — use the suggestion as a
            manual edit.
          </div>
        )}
        {(() => {
          const pv = previewByIdx[idx];
          const isPreviewing = preview.isPending && preview.variables?.idx === idx;
          // Safe apply: preview → confirm. Nothing commits without a preview.
          if (pv) {
            const critical = pv.issues.filter((i) => i.severity === "critical");
            const warns = pv.issues.filter((i) => i.severity === "warn");
            return (
              <div className="space-y-2 rounded border border-white/10 bg-black/20 p-2">
                <div className="text-[10px] uppercase text-bone-500">Resulting scene preview</div>
                {!pv.after ? (
                  <div className="text-amber-300">
                    {pv.reason === "ambiguous"
                      ? "This exact line appears more than once — can't target it safely. Edit manually."
                      : "The line no longer matches this scene (it may have changed). Regenerate the revision."}
                  </div>
                ) : (
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[11px] text-bone-200">
                    {pv.after}
                  </pre>
                )}
                {critical.map((c, ci) => (
                  <div key={`c${ci}`} className="text-red-300">⚠ {c.detail}</div>
                ))}
                {warns.map((w, wi) => (
                  <div key={`w${wi}`} className="text-amber-300">• {w.detail}</div>
                ))}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      rev.ord != null &&
                      applyRev.mutate({ idx, ord: rev.ord, original: rev.original, replacement: chosenText })
                    }
                    disabled={!pv.ok || !pv.after || applyRev.isPending}
                    title={
                      !pv.ok
                        ? "Apply is blocked because the result would be corrupted. Regenerate the revision."
                        : "Commit this exact change to the scene."
                    }
                    className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
                  >
                    {applyRev.isPending && applyRev.variables?.idx === idx && (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    Confirm apply
                  </button>
                  <button
                    onClick={() => setPreviewByIdx((m) => { const n = { ...m }; delete n[idx]; return n; })}
                    className="rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04]"
                  >
                    Back
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  rev.ord != null &&
                  preview.mutate({ idx, ord: rev.ord, original: rev.original, replacement: chosenText })
                }
                disabled={!canApply || isPreviewing}
                className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
              >
                {isPreviewing && <Loader2 className="h-3 w-3 animate-spin" />}
                Preview &amp; apply
              </button>
              <button
                onClick={() => setRevisions((m) => { const n = { ...m }; delete n[idx]; return n; })}
                className="rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04]"
              >
                Reject
              </button>
              <button
                onClick={() => propose.mutate({ idx, issue })}
                disabled={isProposing}
                className="rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04] disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <Panel eyebrow="Subtext" title="Subtext Check">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex-1 text-xs text-bone-400">
          Flags dialogue or action that feels too direct, obvious, repeated, or
          emotionally over-explained — then proposes targeted revisions you review
          before applying. Never rewrites automatically.
          {!ready && (
            <span className="ml-2 text-amber-300">
              — write at least one scene first
            </span>
          )}
        </div>
        <Button onClick={() => run.mutate()} disabled={!ready || run.isPending}>
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          {run.isPending ? "Checking…" : "Run Subtext Check"}
        </Button>
      </div>
      <CheckNotesField
        value={notes}
        onChange={setNotes}
        disabled={run.isPending}
        placeholder="e.g. Flag any dialogue where characters say exactly what they mean instead of revealing it indirectly."
      />

      {/* Draft integrity — scan for/repair corruption from earlier applies. */}
      <div className="mt-3 rounded-md border border-white/8 bg-white/[0.02] p-2 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-bone-400">
            Draft integrity — scan for duplicated lines, orphan fragments, or failed deletes.
          </span>
          <button
            onClick={() => scan.mutate()}
            disabled={!ready || scan.isPending}
            className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04] disabled:opacity-50"
          >
            {scan.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            Scan draft integrity
          </button>
        </div>
        {scan.data && (
          scan.data.scenes.length === 0 ? (
            <div className="mt-2 text-emerald-300">No integrity issues detected in the current draft.</div>
          ) : (
            <ul className="mt-2 space-y-2">
              {scan.data.scenes.map((s) => {
                const hasDup = s.issues.some((i) => i.kind === "duplicate-adjacent");
                return (
                  <li key={s.ord} className="rounded border border-amber-800/40 bg-amber-950/15 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-amber-200">
                        #{s.ord} {s.slugline}
                      </span>
                      {hasDup && (
                        <button
                          onClick={() => dedupe.mutate(s.ord)}
                          disabled={dedupe.isPending}
                          className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-0.5 text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
                          title="Safely removes adjacent duplicate lines. Snapshotted, reversible."
                        >
                          {dedupe.isPending && dedupe.variables === s.ord && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          Remove duplicate lines
                        </button>
                      )}
                    </div>
                    <ul className="mt-1 space-y-0.5 text-[11px]">
                      {s.issues.map((i, ii) => (
                        <li key={ii} className={i.severity === "critical" ? "text-red-300" : "text-amber-300"}>
                          {i.severity === "critical" ? "⚠" : "•"} {i.detail}
                        </li>
                      ))}
                    </ul>
                    {!hasDup && (
                      <div className="mt-1 text-[10px] text-bone-500">
                        These need a manual look or a regenerated revision — auto-repair only
                        removes duplicate lines safely. Use the scene's version history to revert
                        if needed.
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}
        {dedupe.data && dedupe.data.removed > 0 && (
          <div className="mt-1 text-[10px] text-emerald-300">
            Removed {dedupe.data.removed} duplicate line{dedupe.data.removed === 1 ? "" : "s"} from
            Scene {dedupe.data.ord}.
          </div>
        )}
      </div>

      {run.isPending && (
        <div className="mt-3">
          <BusyBar
            label="Reading the draft for on-the-nose moments"
            subtext="Checking dialogue and action for subtext. About a minute."
          />
        </div>
      )}
      {run.error && (
        <div className="mt-3 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(run.error as Error).message}
        </div>
      )}

      {data && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs">
            <div className="text-bone-300">
              <span className="text-bone-500">What I checked:</span> {data.checked}
            </div>
            <div className="mt-1 text-bone-300">
              <span className="text-bone-500">How I used your notes:</span>{" "}
              {data.notesUsed}
            </div>
          </div>

          {data.issues.length === 0 ? (
            <div className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2 text-xs text-emerald-200">
              No on-the-nose moments flagged. The subtext is landing.
            </div>
          ) : (
            <>
              {/* Top 3 highest-impact subtext fixes (free ranking). */}
              {top3.length > 0 && (
                <div className="rounded-md border border-bone-100/15 bg-white/[0.03] p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                    Top {top3.length} highest-impact subtext fix{top3.length === 1 ? "" : "es"}
                  </div>
                  <ol className="space-y-1 text-xs text-bone-300">
                    {top3.map((t, n) => (
                      <li key={t.idx} className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sky-300">{n + 1}.</span>
                        {t.issue.sceneRef && (
                          <span className="font-mono text-bone-500">{t.issue.sceneRef}</span>
                        )}
                        <span>{t.issue.problem}</span>
                        {!revisions[t.idx] && !applied[t.idx] && (
                          <button
                            onClick={() => propose.mutate({ idx: t.idx, issue: t.issue })}
                            disabled={propose.isPending || batching}
                            className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                          >
                            Generate revision
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-1 text-[10px] text-bone-600">
                    Ranked by severity, recurrence, and emotional weight.
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-bone-500">
                  Confirmed issues ({data.issues.length})
                </div>
                <button
                  onClick={runBatch}
                  disabled={batching || propose.isPending}
                  className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                  title="Generates a proposed revision for every flagged issue. Nothing is applied until you click Apply on each."
                >
                  {batching && <Loader2 className="h-3 w-3 animate-spin" />}
                  Run Subtext Pass on all flagged scenes
                </button>
              </div>

              <ul className="space-y-2">
                {data.issues.map((it, i) => (
                  <li key={i} className={`rounded-md border p-2 text-xs ${sevColor(it.severity)}`}>
                    {it.sceneRef && (
                      <div className="font-mono text-bone-400">{it.sceneRef}</div>
                    )}
                    {it.quote && (
                      <div className="mt-0.5 italic text-bone-100">“{it.quote}”</div>
                    )}
                    <div className="mt-1">
                      <span className="text-bone-500">Issue:</span> {it.problem}
                    </div>
                    <div className="mt-0.5 text-bone-400">Suggested pass: Subtext Pass</div>
                    {renderRevision(i, it)}
                  </li>
                ))}
              </ul>
            </>
          )}

          {data.suggestions.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-bone-500">
                Optional suggestions
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-bone-300">
                {data.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * Optional "Notes for this check" field shown above each quality-check run
 * button. Blank is fine; if filled, the backend treats it as priority guidance.
 */
function CheckNotesField({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="mt-3 block">
      <span className="text-xs text-bone-500">Notes for this check (optional)</span>
      <textarea
        className="input mt-1 min-h-[56px] w-full text-xs"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

type Diagnosis = Awaited<ReturnType<typeof api.runScriptDoctor>>["diagnoses"][number];
type RewritePreview = Awaited<ReturnType<typeof api.previewRewriteRevision>>;
type DiagStatus = "accepted" | "rejected" | "deferred";

function rankDiagnoses(
  diagnoses: Diagnosis[]
): Array<{ idx: number; d: Diagnosis; impact: number }> {
  const sevW: Record<string, number> = { critical: 1, warn: 0.6, info: 0.3 };
  const kindW: Record<string, number> = {
    weak_scene: 0.2,
    structure: 0.18,
    pacing: 0.14,
    emotion: 0.12,
    cliché: 0.08,
  };
  const kindCount: Record<string, number> = {};
  for (const d of diagnoses) kindCount[d.kind] = (kindCount[d.kind] ?? 0) + 1;
  return diagnoses
    .map((d, idx) => ({
      idx,
      d,
      impact:
        (sevW[d.severity] ?? 0.4) +
        (kindW[d.kind] ?? 0.1) +
        Math.min(0.18, ((kindCount[d.kind] ?? 1) - 1) * 0.06),
    }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 3);
}

// Paste a full development package; it's triaged into PROJECT (title/logline/
// comps), SEASON (episode arc), and SCENE (rewrites) — each reviewed + applied
// separately. Nothing auto-applies.
function DevelopmentPackagePanel({ projectId, scriptId }: { projectId: string; scriptId: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const analyze = useMutation({ mutationFn: () => api.analyzeDevPackage(projectId, scriptId, text.trim()) });
  const plan = analyze.data;

  const [fieldApplied, setFieldApplied] = useState<Record<string, boolean>>({});
  const applyField = useMutation({
    mutationFn: (v: { field: string; value: unknown }) =>
      api.updateProject(projectId, { [v.field]: v.value } as Record<string, unknown>).then(() => v),
    onSuccess: ({ field }) => {
      setFieldApplied((m) => ({ ...m, [field]: true }));
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const [arcApplied, setArcApplied] = useState(false);
  const applyArc = useMutation({
    mutationFn: () => api.applySeasonArc(projectId, plan!.seasonArc!),
    onSuccess: () => {
      setArcApplied(true);
      qc.invalidateQueries({ queryKey: ["episodes", projectId] });
      qc.invalidateQueries({ queryKey: ["seasons", projectId] });
    },
  });

  // Per-scene rewrite (reuses the safe preview→confirm engine).
  const [previews, setPreviews] = useState<Record<number, RewritePreview>>({});
  const [sceneApplied, setSceneApplied] = useState<Record<number, boolean>>({});
  const [regen, setRegen] = useState<Record<number, string>>({});
  const previewRev = useMutation({
    mutationFn: (v: { ord: number; instruction: string }) =>
      api.previewRewriteRevision(scriptId, v.ord, v.instruction).then((r) => ({ ord: v.ord, r })),
    onSuccess: ({ ord, r }) => setPreviews((m) => ({ ...m, [ord]: r })),
  });
  const regenInstruction = (base: string, ord: number) => {
    const extra = (regen[ord] ?? "").trim();
    return extra ? `${base}\n\nRefinement note: ${extra}` : base;
  };
  const applyScene = useMutation({
    mutationFn: (v: { ord: number; after: string; instruction: string }) =>
      api.applyRewriteRevision(scriptId, v.ord, v.after, v.instruction).then(() => v),
    onSuccess: ({ ord }) => {
      setSceneApplied((m) => ({ ...m, [ord]: true }));
      setPreviews((m) => { const n = { ...m }; delete n[ord]; return n; });
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      // Any change to scene content invalidates the audit too — keep the
      // 95% quality dashboard in sync without forcing the user to refresh.
      qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] });
    },
  });

  const fieldRow = (field: keyof NonNullable<typeof plan>["project"], label: string) => {
    if (!plan) return null;
    const proposed = plan.project[field];
    if (proposed === undefined) return null;
    const cur = (plan.current as Record<string, unknown>)[field];
    const fmt = (v: unknown) => (Array.isArray(v) ? v.join(", ") : (v as string) ?? "—");
    return (
      <div className="rounded border border-white/8 bg-white/[0.02] p-2">
        <div className="text-[10px] uppercase text-bone-600">{label}</div>
        <div className="text-[11px] text-bone-400 line-through">{fmt(cur) || "—"}</div>
        <div className="text-[11px] text-emerald-200">{fmt(proposed)}</div>
        <button
          onClick={() => applyField.mutate({ field, value: proposed })}
          disabled={fieldApplied[field] || applyField.isPending}
          className="mt-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-0.5 text-[11px] text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
        >
          {fieldApplied[field] ? "Applied ✓" : `Apply ${label.toLowerCase()}`}
        </button>
      </div>
    );
  };

  const projectKeys = plan ? (Object.keys(plan.project) as Array<keyof typeof plan.project>) : [];

  return (
    <Panel eyebrow="Development" title="Development Package">
      <div className="text-xs text-bone-400">
        Paste a full development package (retitle, logline, comps, an episode arc, scene
        beats, next-steps). It's sorted into project, season, and scene changes — you review
        and apply each separately. Nothing is applied automatically.
      </div>
      <textarea
        className="input mt-2 min-h-[120px] w-full text-sm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste your showrunner / development-exec package here…"
      />
      <Button onClick={() => analyze.mutate()} disabled={text.trim().length < 20 || analyze.isPending} className="mt-2">
        {analyze.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />}
        {analyze.isPending ? "Analyzing…" : "Analyze package"}
      </Button>
      {analyze.error && <div className="mt-2 text-xs text-red-300">{(analyze.error as Error).message}</div>}

      {plan && (
        <div className="mt-4 space-y-4 text-sm">
          {/* PROJECT */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-bone-300">
              Project changes {projectKeys.length === 0 && <span className="text-bone-600">— none detected</span>}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {fieldRow("title", "Title")}
              {fieldRow("logline", "Logline")}
              {fieldRow("genre", "Genre")}
              {fieldRow("tone", "Tone")}
              {fieldRow("inspirations", "Comps")}
            </div>
          </div>

          {/* SEASON ARC */}
          {plan.seasonArc && (
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-bone-300">
                  Season arc — {plan.seasonArc.episodes.length} episodes
                </span>
                <button
                  onClick={() => applyArc.mutate()}
                  disabled={arcApplied || applyArc.isPending}
                  className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-[11px] text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
                  title="Creates/updates episode records from this arc."
                >
                  {applyArc.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {arcApplied ? "Episodes updated ✓" : "Apply season arc → episodes"}
                </button>
              </div>
              <ol className="space-y-0.5 rounded border border-white/8 bg-white/[0.02] p-2 text-[11px] text-bone-300">
                {plan.seasonArc.episodes.map((e) => (
                  <li key={e.number}>
                    <span className="font-mono text-bone-500">Ep {e.number}</span>{" "}
                    <span className="text-bone-100">{e.title}</span>
                    {e.tentpole && <span className="ml-1 text-ember-300">·tentpole</span>}
                    {e.logline && <span className="text-bone-500"> — {e.logline}</span>}
                  </li>
                ))}
              </ol>
              {applyArc.error && <div className="text-xs text-red-300">{(applyArc.error as Error).message}</div>}
            </div>
          )}

          {/* SCENE REWRITES */}
          {plan.scenes.length > 0 && (
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-bone-300">
                Scene rewrites ({plan.scenes.length})
              </div>
              <div className="space-y-2">
                {plan.scenes.map((s) => {
                  const pv = previews[s.ord];
                  const isPrev = previewRev.isPending && previewRev.variables?.ord === s.ord;
                  return (
                    <div key={s.ord} className="rounded border border-white/10 bg-white/[0.02] p-2 text-[11px]">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-bone-500">#{s.ord}</span>
                        <span className="text-bone-300">{s.slugline}</span>
                        {sceneApplied[s.ord] && <span className="ml-auto text-emerald-300">applied ✓</span>}
                      </div>
                      <div className="mt-0.5 text-bone-400"><span className="text-bone-600">Instruction:</span> {s.instruction}</div>
                      {sceneApplied[s.ord] ? null : !pv ? (
                        <button
                          onClick={() => previewRev.mutate({ ord: s.ord, instruction: s.instruction })}
                          disabled={isPrev}
                          className="mt-1 flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                        >
                          {isPrev && <Loader2 className="h-3 w-3 animate-spin" />}
                          Generate proposed revision
                        </button>
                      ) : (
                        <div className="mt-1 space-y-1">
                          {!pv.changed && <div className="text-amber-300">No change proposed — Regenerate or refine.</div>}
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div><div className="mb-0.5 uppercase text-bone-600">Before</div><pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-bone-400">{pv.before}</pre></div>
                            <div><div className="mb-0.5 uppercase text-emerald-400">After</div><pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-bone-200">{pv.after}</pre></div>
                          </div>
                          {pv.issues.filter((i) => i.severity === "critical").map((c, ci) => <div key={ci} className="text-red-300">⚠ {c.detail}</div>)}
                          {pv.issues.filter((i) => i.severity === "warn").map((w, wi) => <div key={wi} className="text-amber-300">• {w.detail}</div>)}
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => applyScene.mutate({ ord: s.ord, after: pv.after, instruction: s.instruction })} disabled={!pv.ok || !pv.changed || applyScene.isPending} className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50">{applyScene.isPending && applyScene.variables?.ord === s.ord && <Loader2 className="h-3 w-3 animate-spin" />}Apply</button>
                            <button onClick={() => setPreviews((m) => { const n = { ...m }; delete n[s.ord]; return n; })} className="rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04]">Reject</button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={regen[s.ord] ?? ""}
                              onChange={(e) => setRegen((m) => ({ ...m, [s.ord]: e.target.value }))}
                              placeholder="add a note to steer the rewrite…"
                              className="input flex-1 min-w-[180px] py-1 text-[11px]"
                            />
                            <button
                              onClick={() => previewRev.mutate({ ord: s.ord, instruction: regenInstruction(s.instruction, s.ord) })}
                              disabled={isPrev}
                              className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                            >
                              {(regen[s.ord] ?? "").trim() ? "Regenerate with notes" : "Regenerate"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {applyScene.error && <div className="mt-1 text-xs text-red-300">{(applyScene.error as Error).message}</div>}
            </div>
          )}

          {/* UNROUTED */}
          {plan.unrouted.length > 0 && (
            <div className="rounded border border-amber-800/40 bg-amber-950/15 p-2 text-[11px] text-amber-200">
              <div className="font-medium">Couldn't auto-place — handle manually:</div>
              <ul className="list-disc pl-4">{plan.unrouted.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// Paste your own rewrite notes, target scenes (pick or auto-route), preview a
// diff per scene, and apply only what you accept — the draft is never
// overwritten (per-scene preview→confirm, snapshotted/reversible).
function RewriteFromNotes({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
  });
  const [mode, setMode] = useState<"pick" | "auto">("pick");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [targets, setTargets] = useState<Array<{ ord: number; slugline: string; instruction: string }>>([]);
  const [unrouted, setUnrouted] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<number, RewritePreview>>({});
  const [applied, setApplied] = useState<Record<number, boolean>>({});
  const [regen, setRegen] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const regenInstruction = (base: string, ord: number) => {
    const extra = (regen[ord] ?? "").trim();
    return extra ? `${base}\n\nRefinement note: ${extra}` : base;
  };

  const route = useMutation({ mutationFn: () => api.routeNotes(scriptId, notes.trim()) });
  const previewRev = useMutation({
    mutationFn: (v: { ord: number; instruction: string }) =>
      api.previewRewriteRevision(scriptId, v.ord, v.instruction).then((r) => ({ ord: v.ord, r })),
    onSuccess: ({ ord, r }) => setPreviews((m) => ({ ...m, [ord]: r })),
  });
  const applyRev = useMutation({
    mutationFn: (v: { ord: number; after: string; instruction: string }) =>
      api.applyRewriteRevision(scriptId, v.ord, v.after, v.instruction).then(() => v),
    onSuccess: ({ ord }) => {
      setApplied((m) => ({ ...m, [ord]: true }));
      setPreviews((m) => { const n = { ...m }; delete n[ord]; return n; });
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      // Any change to scene content invalidates the audit too — keep the
      // 95% quality dashboard in sync without forcing the user to refresh.
      qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] });
    },
  });

  const rows = sceneRows.data ?? [];
  const live = rows.filter((r) => ["generated", "revised", "locked"].includes(r.status));

  const propose = async () => {
    if (!notes.trim()) return;
    setBusy(true);
    setApplied({});
    setPreviews({});
    setUnrouted([]);
    try {
      let tg: Array<{ ord: number; slugline: string; instruction: string }> = [];
      if (mode === "pick") {
        tg = [...selected]
          .sort((a, b) => a - b)
          .map((ord) => ({
            ord,
            slugline: rows.find((r) => r.ord === ord)?.slugline ?? `Scene ${ord}`,
            instruction: notes.trim(),
          }));
      } else {
        const r = await route.mutateAsync();
        tg = r.routed;
        setUnrouted(r.unrouted);
      }
      setTargets(tg);
      for (const t of tg) await previewRev.mutateAsync({ ord: t.ord, instruction: t.instruction });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-bone-100/15 bg-white/[0.03] p-3 space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-300">
        Rewrite from your notes
      </div>
      <div className="text-xs text-bone-400">
        Paste your own rewrite notes and target the areas to change. You preview a diff
        per scene and apply only what you accept — your draft is never overwritten.
      </div>
      <div className="inline-flex rounded-md border border-white/10 bg-white/[0.02] p-0.5 text-xs">
        {(["pick", "auto"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-3 py-1 ${mode === m ? "bg-white/10 text-bone-100" : "text-bone-400 hover:text-bone-200"}`}
          >
            {m === "pick" ? "Pick scenes" : "Auto-route my notes"}
          </button>
        ))}
      </div>
      {mode === "pick" && (
        <div className="max-h-40 overflow-auto rounded border border-white/8 p-2 text-xs">
          {live.length === 0 ? (
            <div className="text-bone-500">No drafted scenes yet.</div>
          ) : (
            live.map((r) => (
              <label key={r.ord} className="flex items-center gap-2 py-0.5 text-bone-300">
                <input
                  type="checkbox"
                  checked={selected.has(r.ord)}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(r.ord); else n.delete(r.ord);
                      return n;
                    })
                  }
                />
                <span className="font-mono text-bone-500">#{r.ord}</span> {r.slugline}
              </label>
            ))
          )}
        </div>
      )}
      <textarea
        className="input min-h-[90px] w-full text-sm"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={
          mode === "pick"
            ? "Notes for the selected scene(s): e.g. Make Margot colder here; cut the on-the-nose grief line; raise the stakes of the offer."
            : "Paste all your notes, naming areas: e.g. Tighten the opening car scene. In the pool scene make Dean more evasive. End the Solano consultation on a harder beat."
        }
      />
      <button
        onClick={propose}
        disabled={busy || !notes.trim() || (mode === "pick" && selected.size === 0)}
        className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {mode === "pick"
          ? `Propose rewrites for ${selected.size} scene${selected.size === 1 ? "" : "s"}`
          : "Route my notes & propose rewrites"}
      </button>
      {route.error && <div className="text-xs text-red-300">{(route.error as Error).message}</div>}
      {unrouted.length > 0 && (
        <div className="rounded border border-amber-800/40 bg-amber-950/15 p-2 text-[11px] text-amber-200">
          <div className="font-medium">Couldn't auto-place these notes — handle manually:</div>
          <ul className="list-disc pl-4">{unrouted.map((u, i) => <li key={i}>{u}</li>)}</ul>
        </div>
      )}
      {targets.map((t) => {
        const pv = previews[t.ord];
        const isPrev = previewRev.isPending && previewRev.variables?.ord === t.ord;
        return (
          <div key={t.ord} className="rounded border border-white/10 bg-white/[0.02] p-2 text-[11px]">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-bone-500">#{t.ord}</span>
              <span className="text-bone-300">{t.slugline}</span>
              {applied[t.ord] && <span className="ml-auto text-emerald-300">applied ✓</span>}
            </div>
            <div className="mt-0.5 text-bone-400">
              <span className="text-bone-600">Your note:</span> {t.instruction}
            </div>
            {applied[t.ord] ? null : isPrev ? (
              <div className="mt-1 flex items-center gap-1 text-bone-400">
                <Loader2 className="h-3 w-3 animate-spin" /> proposing…
              </div>
            ) : pv ? (
              <div className="mt-1 space-y-1">
                {!pv.changed && (
                  <div className="text-amber-300">No change proposed — be more specific or Regenerate.</div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-0.5 uppercase text-bone-600">Before</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-bone-400">{pv.before}</pre>
                  </div>
                  <div>
                    <div className="mb-0.5 uppercase text-emerald-400">After</div>
                    <pre className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-bone-200">{pv.after}</pre>
                  </div>
                </div>
                {pv.issues.filter((i) => i.severity === "critical").map((c, ci) => (
                  <div key={`c${ci}`} className="text-red-300">⚠ {c.detail}</div>
                ))}
                {pv.issues.filter((i) => i.severity === "warn").map((w, wi) => (
                  <div key={`w${wi}`} className="text-amber-300">• {w.detail}</div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => applyRev.mutate({ ord: t.ord, after: pv.after, instruction: t.instruction })}
                    disabled={!pv.ok || !pv.changed || applyRev.isPending}
                    className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
                  >
                    {applyRev.isPending && applyRev.variables?.ord === t.ord && <Loader2 className="h-3 w-3 animate-spin" />}
                    Apply
                  </button>
                  <button onClick={() => setPreviews((m) => { const n = { ...m }; delete n[t.ord]; return n; })} className="rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04]">Reject</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={regen[t.ord] ?? ""}
                    onChange={(e) => setRegen((m) => ({ ...m, [t.ord]: e.target.value }))}
                    placeholder="add a note to steer the rewrite…"
                    className="input flex-1 min-w-[180px] py-1 text-[11px]"
                  />
                  <button
                    onClick={() => previewRev.mutate({ ord: t.ord, instruction: regenInstruction(t.instruction, t.ord) })}
                    disabled={isPrev}
                    className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                  >
                    {(regen[t.ord] ?? "").trim() ? "Regenerate with notes" : "Regenerate"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
      {applyRev.error && <div className="text-xs text-red-300">{(applyRev.error as Error).message}</div>}
      {previewRev.error && <div className="text-xs text-red-300">{(previewRev.error as Error).message}</div>}
    </div>
  );
}

function ScriptDoctorPanel({
  scriptId,
  ready,
}: {
  scriptId: string;
  ready: boolean;
}) {
  const qc = useQueryClient();
  const [focus, setFocus] = useState<
    "all" | "pacing" | "cliché" | "structure" | "emotional_impact"
  >("all");
  const [notes, setNotes] = useState("");
  // Per-diagnosis workflow state.
  const [revisions, setRevisions] = useState<Record<number, RewritePreview>>({});
  const [applied, setApplied] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<Record<number, DiagStatus>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batching, setBatching] = useState(false);
  const [creativeAccept, setCreativeAccept] = useState(false);
  const [regen, setRegen] = useState<Record<number, string>>({});
  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
  });
  const run = useMutation({
    mutationKey: ["pass:doctor", scriptId],
    mutationFn: () => api.runScriptDoctor(scriptId, focus, notes.trim() || undefined),
    onSuccess: () => {
      setRevisions({});
      setApplied({});
      setStatus({});
      setSelected(new Set());
      setCreativeAccept(false);
    },
  });
  const ordForDiag = (d: Diagnosis): number | null =>
    resolveSceneOrd(d.sceneRef, d.sceneId, sceneRows.data ?? []);
  const instrFor = (d: Diagnosis) =>
    `Script Doctor [${d.kind}/${d.severity}]: ${d.note}${d.suggestion ? ` Fix: ${d.suggestion}` : ""}`;

  const previewRev = useMutation({
    mutationFn: (v: { idx: number; ord: number; instruction: string }) =>
      api.previewRewriteRevision(scriptId, v.ord, v.instruction).then((r) => ({ idx: v.idx, r })),
    onSuccess: ({ idx, r }) => setRevisions((m) => ({ ...m, [idx]: r })),
  });
  const applyRev = useMutation({
    mutationFn: (v: { idx: number; ord: number; after: string; instruction: string }) =>
      api.applyRewriteRevision(scriptId, v.ord, v.after, v.instruction).then(() => v),
    onSuccess: ({ idx }) => {
      setApplied((m) => ({ ...m, [idx]: true }));
      setStatus((m) => ({ ...m, [idx]: "accepted" }));
      setRevisions((m) => { const n = { ...m }; delete n[idx]; return n; });
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      // Any change to scene content invalidates the audit too — keep the
      // 95% quality dashboard in sync without forcing the user to refresh.
      qc.invalidateQueries({ queryKey: ["audit-dashboard", scriptId] });
    },
  });

  const data = run.data;
  const diagnoses = data?.diagnoses ?? [];
  const top3 = data ? rankDiagnoses(diagnoses) : [];
  const counts = data
    ? {
        critical: diagnoses.filter((d) => d.severity === "critical").length,
        warn: diagnoses.filter((d) => d.severity === "warn").length,
        info: diagnoses.filter((d) => d.severity === "info").length,
      }
    : null;
  // Approval gating: a diagnosis is "resolved" if applied, accepted, or rejected.
  const isResolved = (i: number) => applied[i] || status[i] === "accepted" || status[i] === "rejected";
  const criticalUnresolved = diagnoses
    .map((d, i) => ({ d, i }))
    .filter(({ d, i }) => d.severity === "critical" && !isResolved(i)).length;
  const readyToApprove = criticalUnresolved === 0 || creativeAccept;

  const genSelected = async () => {
    if (!data) return;
    setBatching(true);
    try {
      for (const i of selected) {
        const d = diagnoses[i];
        const ord = ordForDiag(d);
        if (ord == null || revisions[i] || applied[i]) continue;
        await previewRev.mutateAsync({ idx: i, ord, instruction: instrFor(d) });
      }
    } finally {
      setBatching(false);
    }
  };

  const renderRevision = (idx: number, d: Diagnosis, ord: number) => {
    const rev = revisions[idx];
    const isPreviewing = previewRev.isPending && previewRev.variables?.idx === idx;
    if (applied[idx]) return <div className="mt-2 text-[11px] text-emerald-300">Applied to Scene #{ord} ✓</div>;
    if (!rev) {
      return (
        <button
          onClick={() => previewRev.mutate({ idx, ord, instruction: instrFor(d) })}
          disabled={isPreviewing || batching}
          className="mt-2 flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
        >
          {isPreviewing && <Loader2 className="h-3 w-3 animate-spin" />}
          Generate proposed revision
        </button>
      );
    }
    const critical = rev.issues.filter((i) => i.severity === "critical");
    return (
      <div className="mt-2 space-y-2 rounded border border-sky-800/40 bg-sky-950/20 p-2 text-[11px]">
        {!rev.changed && (
          <div className="text-amber-300">The pass proposed no change to this scene.</div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="mb-0.5 uppercase text-bone-600">Before</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-bone-400">{rev.before}</pre>
          </div>
          <div>
            <div className="mb-0.5 uppercase text-emerald-400">After (full scene preview)</div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-bone-200">{rev.after}</pre>
          </div>
        </div>
        {critical.map((c, ci) => (<div key={`c${ci}`} className="text-red-300">⚠ {c.detail}</div>))}
        {rev.issues.filter((i) => i.severity === "warn").map((w, wi) => (<div key={`w${wi}`} className="text-amber-300">• {w.detail}</div>))}
        <div className="flex items-center gap-2">
          <button
            onClick={() => applyRev.mutate({ idx, ord, after: rev.after, instruction: instrFor(d) })}
            disabled={!rev.ok || !rev.changed || applyRev.isPending}
            title={!rev.ok ? "Apply is blocked — the rewrite would corrupt the scene." : "Commit this revision (snapshotted, reversible)."}
            className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
          >
            {applyRev.isPending && applyRev.variables?.idx === idx && <Loader2 className="h-3 w-3 animate-spin" />}
            Apply
          </button>
          <button onClick={() => setRevisions((m) => { const n = { ...m }; delete n[idx]; return n; })} className="rounded-md border border-white/10 px-2 py-1 text-bone-300 hover:bg-white/[0.04]">Reject</button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={regen[idx] ?? ""}
            onChange={(e) => setRegen((m) => ({ ...m, [idx]: e.target.value }))}
            placeholder="add a note to steer the rewrite…"
            className="input flex-1 min-w-[180px] py-1 text-[11px]"
          />
          <button
            onClick={() => {
              const extra = (regen[idx] ?? "").trim();
              previewRev.mutate({ idx, ord, instruction: extra ? `${instrFor(d)}\n\nRefinement note: ${extra}` : instrFor(d) });
            }}
            disabled={isPreviewing}
            className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
          >
            {(regen[idx] ?? "").trim() ? "Regenerate with notes" : "Regenerate"}
          </button>
        </div>
      </div>
    );
  };

  const statusChip = (idx: number) => (
    <div className="mt-2 flex items-center gap-1">
      {(["accepted", "rejected", "deferred"] as DiagStatus[]).map((s) => (
        <button
          key={s}
          onClick={() => setStatus((m) => ({ ...m, [idx]: m[idx] === s ? undefined as never : s }))}
          className={`rounded px-2 py-0.5 text-[10px] ${
            status[idx] === s
              ? s === "accepted"
                ? "bg-emerald-900/40 text-emerald-200 ring-1 ring-emerald-600/40"
                : s === "rejected"
                ? "bg-red-900/40 text-red-200 ring-1 ring-red-600/40"
                : "bg-slate-800/50 text-slate-200 ring-1 ring-slate-500/40"
              : "border border-white/10 text-bone-500 hover:text-bone-300"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );

  return (
    <Panel eyebrow="Rewrite" title="Rewrite & Polish">
      {ready && <RewriteFromNotes scriptId={scriptId} />}
      <div className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wide text-bone-600">
        <span className="h-px flex-1 bg-white/10" /> or run an AI craft review{" "}
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-bone-500">Focus</span>
          <select
            value={focus}
            onChange={(e) => setFocus(e.target.value as typeof focus)}
            className="input w-48"
          >
            <option value="all">all dimensions</option>
            <option value="pacing">pacing</option>
            <option value="cliché">cliché</option>
            <option value="structure">structure</option>
            <option value="emotional_impact">emotional impact</option>
          </select>
        </label>
        <div className="flex-1 text-xs text-bone-400">
          A craft pass for pacing, weak scenes, repetition, tension, dialogue, and
          overall impact. Each note can generate a proposed rewrite you preview and
          apply — nothing changes until you confirm.
          {!ready && (
            <span className="ml-2 text-amber-300">
              — write at least one scene first
            </span>
          )}
        </div>
        <Button onClick={() => run.mutate()} disabled={!ready || run.isPending}>
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Stethoscope className="h-4 w-4" />
          )}
          {run.isPending ? "Reading…" : "Run Rewrite & Polish"}
        </Button>
      </div>
      <CheckNotesField
        value={notes}
        onChange={setNotes}
        disabled={run.isPending}
        placeholder="e.g. Preserve the slow-burn prestige tone. Do not make it louder, more commercial, or more supernatural."
      />

      {run.isPending && (
        <div className="mt-3">
          <BusyBar
            label="Script Doctor reading the draft"
            subtext="Reading your draft for craft notes. About a minute. Results appear below."
          />
        </div>
      )}
      {run.error && (
        <div className="mt-3 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(run.error as Error).message}
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-bone-500">Emotional arc score:</span>
            <span className="rounded bg-white/[0.04] px-2 py-0.5 text-bone-100">
              {Math.round(data.emotionalArcScore * 100)}/100
            </span>
            <CountChip count={counts!.critical} severity="critical" label="critical" />
            <CountChip count={counts!.warn} severity="warn" label="warn" />
            <CountChip count={counts!.info} severity="info" label="info" />
          </div>
          {/* Approval gating readout */}
          <div
            className={`rounded-md border p-2 text-[11px] ${
              readyToApprove
                ? "border-emerald-800/40 bg-emerald-950/15 text-emerald-200"
                : "border-amber-800/40 bg-amber-950/15 text-amber-200"
            }`}
          >
            {criticalUnresolved === 0 ? (
              <span>All critical notes addressed — Rewrite &amp; Polish is ready to approve on the overview.</span>
            ) : (
              <span>
                {criticalUnresolved} critical note{criticalUnresolved === 1 ? "" : "s"} unaddressed.
                Apply a fix, or mark them accepted/rejected, before approving.
              </span>
            )}
            <label className="mt-1 flex items-center gap-1.5 text-bone-400">
              <input type="checkbox" checked={creativeAccept} onChange={(e) => setCreativeAccept(e.target.checked)} />
              Approve remaining notes as deliberate creative choices
            </label>
          </div>

          {data.diagnoses.length === 0 ? (
            <div className="text-xs text-bone-400">
              No diagnoses returned. Either the draft is unusually clean, or the
              model didn't produce structured output.
            </div>
          ) : (
            <>
              {/* Top 3 highest-impact fixes */}
              {top3.length > 0 && (
                <div className="rounded-md border border-bone-100/15 bg-white/[0.03] p-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                    Top {top3.length} highest-impact fix{top3.length === 1 ? "" : "es"}
                  </div>
                  <ol className="space-y-1 text-xs text-bone-300">
                    {top3.map((t, n) => {
                      const ord = ordForDiag(t.d);
                      return (
                        <li key={t.idx} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sky-300">{n + 1}.</span>
                          <span className="font-mono text-bone-500">{t.d.sceneRef ?? `#${ord ?? "?"}`}</span>
                          <span>{t.d.note}</span>
                          {ord != null && !revisions[t.idx] && !applied[t.idx] && (
                            <button
                              onClick={() => previewRev.mutate({ idx: t.idx, ord, instruction: instrFor(t.d) })}
                              disabled={previewRev.isPending || batching}
                              className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                            >
                              Generate revision
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="mt-1 text-[10px] text-bone-600">Ranked by severity, type, and recurrence.</div>
                </div>
              )}

              {/* Apply-selected controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="uppercase tracking-wide text-bone-500">
                  Diagnoses ({data.diagnoses.length})
                </span>
                <button
                  onClick={genSelected}
                  disabled={selected.size === 0 || batching || previewRev.isPending}
                  className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-1 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                  title="Generate proposed revisions for the checked diagnoses. Nothing applies until you confirm each."
                >
                  {batching && <Loader2 className="h-3 w-3 animate-spin" />}
                  Generate fixes for selected ({selected.size})
                </button>
              </div>

              <ul className="space-y-2">
                {data.diagnoses.map((d, i) => {
                  const sev = d.severity;
                  const border =
                    sev === "critical" ? "border-red-800/60 bg-red-950/20"
                    : sev === "warn" ? "border-amber-800/60 bg-amber-950/20"
                    : "border-white/8 bg-white/[0.02]";
                  const rows = sceneRows.data ?? [];
                  const ord = resolveSceneOrd(d.sceneRef, d.sceneId, rows);
                  return (
                    <li key={i} className={`rounded-md border p-2 ${border}`}>
                      <div className="flex flex-wrap items-baseline gap-2 text-xs">
                        {ord != null && (
                          <input
                            type="checkbox"
                            checked={selected.has(i)}
                            onChange={(e) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(i); else next.delete(i);
                                return next;
                              })
                            }
                            title="Select for batch fix generation"
                          />
                        )}
                        <span className="font-mono text-bone-500">{d.sceneRef ?? d.sceneId ?? "—"}</span>
                        <span className="chip">{String(d.kind).replace(/_/g, " ")}</span>
                        <span
                          className={`chip ${
                            sev === "critical" ? "border-red-700/60 bg-red-950/40 text-red-200"
                            : sev === "warn" ? "border-amber-700/50 bg-amber-900/30 text-amber-200"
                            : "border-sky-700/50 bg-sky-900/30 text-sky-200"
                          }`}
                        >
                          {sev}
                        </span>
                        {applied[i] ? (
                          <span className="ml-auto text-[10px] text-emerald-300">applied</span>
                        ) : status[i] ? (
                          <span className="ml-auto text-[10px] text-bone-400">{status[i]}</span>
                        ) : ord != null ? (
                          <span className="ml-auto text-[10px] text-bone-500">→ scene #{ord}</span>
                        ) : (
                          <span className="ml-auto text-[10px] text-amber-400">(advisory — no scene match)</span>
                        )}
                      </div>
                      <div className="mt-1 text-bone-100">{d.note}</div>
                      {d.suggestion && (
                        <div className="mt-1 text-xs text-bone-300">
                          <span className="text-bone-500">Suggested fix:</span> {d.suggestion}
                        </div>
                      )}
                      {ord != null && renderRevision(i, d, ord)}
                      {ord == null && (
                        <div className="mt-1 text-[11px] text-bone-500">
                          No matching scene to auto-rewrite — handle this note manually, then mark it below.
                        </div>
                      )}
                      {statusChip(i)}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {previewRev.error && (
            <div className="rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
              {(previewRev.error as Error).message}
            </div>
          )}
          {applyRev.error && (
            <div className="rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
              {(applyRev.error as Error).message}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// Title Page Settings — editable metadata that drives the Fountain title
// block, PDF title page, and Final Draft (.fdx) TitlePage. AI never edits
// these; the user does. Series title, episode credit, and draft label come
// from the project / episode / draft rows so they stay authoritative; the
// writer-editable fields (writers, creators, dates, contact, copyright) live
// in scripts.metadata.titlePage.
function TitlePageSettingsPanel({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const tpQ = useQuery({
    queryKey: ["title-page", scriptId],
    queryFn: () => api.getTitlePage(scriptId),
  });
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof api.setTitlePage>[1]) => api.setTitlePage(scriptId, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["title-page", scriptId] }),
  });
  const tp = tpQ.data?.titlePage;
  const ready = tpQ.data?.readiness;
  const [form, setForm] = useState<{
    writers: string;
    creators: string;
    basedOn: string;
    draftDate: string;
    studio: string;
    contact: string;
    copyright: string;
    includeContact: boolean;
  }>({
    writers: "",
    creators: "",
    basedOn: "",
    draftDate: "",
    studio: "",
    contact: "",
    copyright: "",
    includeContact: true,
  });
  const [hydrated, setHydrated] = useState(false);
  if (tp && !hydrated) {
    setHydrated(true);
    setForm({
      writers: (tp.writers ?? []).join(", "),
      creators: (tp.creators ?? []).join(", "),
      basedOn: tp.basedOn ?? "",
      draftDate: tp.draftDate ?? "",
      studio: tp.studio ?? "",
      contact: tp.contact ?? "",
      copyright: tp.copyright ?? "",
      includeContact: tp.includeContact ?? true,
    });
  }
  const split = (s: string): string[] | undefined => {
    const arr = s.split(",").map((x) => x.trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  };
  const onSave = () =>
    save.mutate({
      writers: split(form.writers),
      creators: split(form.creators),
      basedOn: form.basedOn.trim() || undefined,
      draftDate: form.draftDate.trim() || undefined,
      studio: form.studio.trim() || undefined,
      contact: form.contact.trim() || undefined,
      copyright: form.copyright.trim() || undefined,
      includeContact: form.includeContact,
    });

  return (
    <Panel eyebrow="Title Page" title="Title Page Settings">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-bone-400">
          Series title, episode credit, and draft label are derived from the project / episode / draft —
          edit those on their own pages. AI never fills writer/creator credits.
        </div>
        {ready && (
          <span
            className={
              "chip " +
              (ready.ready
                ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
                : "border-amber-700/50 bg-amber-900/30 text-amber-200")
            }
          >
            {ready.ready ? "Ready for export" : `Missing: ${ready.missing.join(", ")}`}
          </span>
        )}
      </div>

      {tp && (
        <div className="mt-3 rounded-md border border-white/8 bg-black/30 p-3 text-[12px] text-bone-200 whitespace-pre-wrap">
          {/* Quick preview of how the title page will render. */}
          <div className="text-bone-100 font-bold uppercase">{tp.seriesTitle}</div>
          {tp.episodeCredit && <div className="text-bone-200">{tp.episodeCredit}</div>}
          <div className="mt-2">
            {(tp.writers?.length ?? 0) > 0 ? (
              <>
                <div className="text-bone-400">Written by</div>
                <div>{tp.writers!.join(", ")}</div>
              </>
            ) : (
              <div className="text-amber-300">[Written by — required]</div>
            )}
          </div>
          {(tp.creators?.length ?? 0) > 0 ? (
            <div className="mt-1">Created by {tp.creators!.join(", ")}</div>
          ) : (
            <div className="mt-1 text-amber-300">[Created by — required]</div>
          )}
          {tp.basedOn && <div className="mt-1">Based on {tp.basedOn}</div>}
          <div className="mt-2 text-bone-300">
            {tp.draftLabel} {tp.draftDate ? ` · ${tp.draftDate}` : ""}
          </div>
          {tp.includeContact !== false && (
            <>
              {tp.studio && <div className="mt-1">{tp.studio}</div>}
              {tp.contact && <div className="text-bone-300">{tp.contact}</div>}
            </>
          )}
          {tp.copyright && <div className="mt-1 text-bone-500">{tp.copyright}</div>}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <TpField label="Written by (comma-separated)" value={form.writers} onChange={(v) => setForm((s) => ({ ...s, writers: v }))} />
        <TpField label="Created by" value={form.creators} onChange={(v) => setForm((s) => ({ ...s, creators: v }))} />
        <TpField label="Based on" value={form.basedOn} onChange={(v) => setForm((s) => ({ ...s, basedOn: v }))} />
        <TpField label="Draft date (e.g. May 30, 2026)" value={form.draftDate} onChange={(v) => setForm((s) => ({ ...s, draftDate: v }))} />
        <TpField label="Studio / company" value={form.studio} onChange={(v) => setForm((s) => ({ ...s, studio: v }))} />
        <TpField label="Contact" value={form.contact} onChange={(v) => setForm((s) => ({ ...s, contact: v }))} />
        <TpField label="Copyright" value={form.copyright} onChange={(v) => setForm((s) => ({ ...s, copyright: v }))} wide />
        <label className="md:col-span-2 mt-1 flex items-center gap-2 text-xs text-bone-300">
          <input
            type="checkbox"
            checked={form.includeContact}
            onChange={(e) => setForm((s) => ({ ...s, includeContact: e.target.checked }))}
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          Include studio + contact on the title page
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={onSave} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save title page
        </Button>
      </div>
      {save.error && (
        <div className="mt-2 text-xs text-red-300">{(save.error as Error).message}</div>
      )}
    </Panel>
  );
}

function TpField({
  label,
  value,
  onChange,
  wide,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={"block " + (wide ? "md:col-span-2" : "")}>
      <div className="label-eyebrow mb-1">{label}</div>
      <input className="input w-full" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function ExportsPanel({
  scriptId,
  title,
  ready,
}: {
  scriptId: string;
  title: string;
  ready: boolean;
}) {
  const tpQ = useQuery({
    queryKey: ["title-page", scriptId],
    queryFn: () => api.getTitlePage(scriptId),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    fmt: "pdf" | "fdx" | "fountain" | "markdown";
    ext: string;
    missing: string[];
  } | null>(null);

  const safeName = title.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "draft";
  const formats: { id: "pdf" | "fdx" | "fountain" | "markdown"; label: string; ext: string }[] = [
    { id: "pdf", label: "PDF", ext: "pdf" },
    { id: "fdx", label: "Final Draft (.fdx)", ext: "fdx" },
    { id: "fountain", label: "Fountain", ext: "fountain" },
    { id: "markdown", label: "Markdown", ext: "md" },
  ];

  const download = async (fmt: typeof formats[number], force = false) => {
    setError(null);
    setBusy(fmt.id);
    try {
      await api.downloadExport(scriptId, fmt.id, `${safeName}.${fmt.ext}`, force);
      setConfirm(null);
    } catch (e) {
      const msg = (e as Error).message;
      // 409 → title-page incomplete. Prompt the user instead of failing silently.
      if (msg.includes("title_page_incomplete") || msg.startsWith("409")) {
        const ready2 = await api.getTitlePage(scriptId).catch(() => null);
        setConfirm({ fmt: fmt.id, ext: fmt.ext, missing: ready2?.readiness?.missing ?? ["Writer/Creator credits"] });
      } else {
        setError(msg);
      }
    } finally {
      setBusy(null);
    }
  };

  const readiness = tpQ.data?.readiness;
  return (
    <Panel eyebrow="Export" title="Export Center">
      <div className="text-xs text-bone-400">
        Exports compile from the live scenes only (generated / revised / locked).
        {!ready && (
          <span className="ml-2 text-amber-300">— generate at least one scene first</span>
        )}
        {ready && readiness && !readiness.ready && (
          <span className="ml-2 text-amber-300">
            — Title page incomplete: {readiness.missing.join(", ")}.{" "}
            Set them in <strong>Title Page Settings</strong> above.
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {formats.map((f) => (
          <Button
            key={f.id}
            variant="outline"
            disabled={!ready || busy !== null}
            onClick={() => download(f)}
          >
            {busy === f.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {busy === f.id ? "Preparing…" : f.label}
          </Button>
        ))}
      </div>
      {error && (
        <div className="mt-2 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {confirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirm(null)}
        >
          <div className="panel-strong w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-xl">Confirm export</h2>
            <p className="mt-2 text-sm text-bone-300">
              The title page is missing: <strong>{confirm.missing.join(", ")}</strong>.
            </p>
            <p className="mt-2 text-xs text-bone-400">
              You can open Title Page Settings to add them, or export anyway — the credit lines will be
              left blank in the file.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button
                onClick={() => download({ id: confirm.fmt, label: "", ext: confirm.ext }, true)}
                disabled={busy !== null}
              >
                Export anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Sticky strip that names every operation currently in flight for this draft
 * — scene generations, range runs, and each agent pass — so you always know
 * what's compiling no matter where you've scrolled.
 */
function ActivityBar({
  scriptId,
  scenesGenerating,
}: {
  scriptId: string;
  scenesGenerating: number[];
}) {
  const range = useIsMutating({ mutationKey: ["pass:range", scriptId] });
  const doctor = useIsMutating({ mutationKey: ["pass:doctor", scriptId] });
  const continuity = useIsMutating({ mutationKey: ["pass:continuity", scriptId] });
  const production = useIsMutating({ mutationKey: ["pass:production", scriptId] });
  const emotional = useIsMutating({ mutationKey: ["pass:emotional", scriptId] });
  const sceneMut = useIsMutating({ mutationKey: ["scene-op", scriptId] });

  const items: string[] = [];
  if (scenesGenerating.length > 0) {
    items.push(
      `Generating scene${scenesGenerating.length > 1 ? "s" : ""} ${scenesGenerating
        .map((o) => `#${o}`)
        .join(", ")}`
    );
  }
  if (sceneMut > 0 && scenesGenerating.length === 0)
    items.push("Generating a scene");
  if (range > 0) items.push("Generating a range of scenes");
  if (doctor > 0) items.push("Script Doctor analyzing the draft");
  if (continuity > 0) items.push("Continuity scanning the draft");
  if (production > 0) items.push("Producer assessing the draft");
  if (emotional > 0) items.push("Emotional Truth scoring scenes");

  if (items.length === 0) return null;

  return (
    <div className="sticky top-0 z-30 border-b border-ember-700/40 bg-ember-950/80 px-8 py-2 backdrop-blur">
      <div className="flex items-center gap-2 text-xs text-ember-100">
        <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-ember-300" />
        <span className="font-medium">Working:</span>
        <span className="text-ember-200">{items.join(" · ")}</span>
      </div>
    </div>
  );
}

const EI_DIMS: Array<{
  key: "truth" | "subtext" | "wound" | "behavior" | "tension" | "powerShift";
  label: string;
}> = [
  { key: "truth", label: "Truth" },
  { key: "subtext", label: "Subtext" },
  { key: "wound", label: "Wound" },
  { key: "behavior", label: "Behavior" },
  { key: "tension", label: "Tension" },
  { key: "powerShift", label: "Power" },
];

function scoreColor(v: number): string {
  if (v >= 0.7) return "text-emerald-300";
  if (v >= 0.45) return "text-amber-300";
  return "text-red-300";
}

// Heatmap cell fill by overall score (red → amber → emerald).
function heatBg(v: number): string {
  if (v >= 0.8) return "bg-emerald-500/70 border-emerald-400/60 text-emerald-50";
  if (v >= 0.65) return "bg-emerald-700/40 border-emerald-600/40 text-emerald-100";
  if (v >= 0.5) return "bg-amber-600/40 border-amber-500/40 text-amber-50";
  if (v >= 0.4) return "bg-orange-700/45 border-orange-600/40 text-orange-50";
  return "bg-red-800/50 border-red-600/50 text-red-50";
}

const SCENE_FLAG_META: Record<
  SceneFlag,
  { label: string; chip: string }
> = {
  weak: { label: "weak", chip: "border-red-700/50 bg-red-900/30 text-red-200" },
  standout: { label: "standout", chip: "border-emerald-700/50 bg-emerald-900/30 text-emerald-200" },
  "low-tension": { label: "low tension", chip: "border-sky-700/50 bg-sky-900/30 text-sky-200" },
  exposition: { label: "exposition", chip: "border-violet-700/50 bg-violet-900/30 text-violet-200" },
  repeated: { label: "repeated beat", chip: "border-amber-700/50 bg-amber-900/30 text-amber-200" },
};

function trendMark(trend: number): { sym: string; cls: string } {
  if (trend <= -0.05) return { sym: "↓", cls: "text-red-300" };
  if (trend >= 0.05) return { sym: "↑", cls: "text-emerald-300" };
  return { sym: "→", cls: "text-bone-500" };
}

// "2" · "2 and 3" · "2, 3 and 5" — for diagnostic-level Findings copy.
function joinScenes(nums: number[]): string {
  if (nums.length === 0) return "";
  if (nums.length === 1) return `${nums[0]}`;
  return `${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]}`;
}

// Character classification → chip styling (item 1, 7 states).
const CLASS_CHIP: Record<string, string> = {
  "insufficient-data": "border-white/15 bg-white/[0.04] text-bone-400",
  "low-presence": "border-slate-600/50 bg-slate-800/40 text-slate-300",
  underdeveloped: "border-orange-700/50 bg-orange-900/30 text-orange-200",
  static: "border-amber-700/50 bg-amber-900/30 text-amber-200",
  declining: "border-red-700/50 bg-red-900/30 text-red-200",
  growing: "border-sky-700/50 bg-sky-900/30 text-sky-200",
  "strong-arc": "border-emerald-700/50 bg-emerald-900/30 text-emerald-200",
};

// Pacing-zone kind → chip styling (item 7).
const PACING_CHIP: Record<PacingKind, string> = {
  "low-tension": "border-sky-700/50 bg-sky-900/30 text-sky-200",
  exposition: "border-violet-700/50 bg-violet-900/30 text-violet-200",
  repeated: "border-amber-700/50 bg-amber-900/30 text-amber-200",
  "setup-cluster": "border-slate-600/50 bg-slate-800/40 text-slate-300",
  "escalation-gap": "border-rose-700/50 bg-rose-900/30 text-rose-200",
  "payoff-drought": "border-fuchsia-700/50 bg-fuchsia-900/30 text-fuchsia-200",
};

const CONFIDENCE_CHIP: Record<string, string> = {
  low: "border-red-700/50 bg-red-900/30 text-red-200",
  medium: "border-amber-700/50 bg-amber-900/30 text-amber-200",
  high: "border-emerald-700/50 bg-emerald-900/30 text-emerald-200",
};

// Dramatic-turn level → chip styling.
const TURN_CHIP: Record<TurnLevel, string> = {
  detected: "border-emerald-700/50 bg-emerald-900/30 text-emerald-200",
  possible: "border-amber-700/50 bg-amber-900/30 text-amber-200",
  none: "border-white/12 bg-white/[0.04] text-bone-400",
};

// Scene-job → color for the heatmap job strip + per-scene chip.
const JOB_CLS: Record<SceneJob, string> = {
  setup: "text-slate-300",
  reflection: "text-emerald-300",
  mystery: "text-cyan-300",
  dread: "text-violet-300",
  confrontation: "text-rose-300",
  transition: "text-bone-500",
  payoff: "text-amber-300",
};

// Scene-purpose → short label color for the heatmap purpose strip.
const PURPOSE_CLS: Record<ScenePurpose, string> = {
  Setup: "text-slate-300",
  Escalation: "text-sky-300",
  Revelation: "text-cyan-300",
  Reversal: "text-rose-300",
  "Emotional Turn": "text-fuchsia-300",
  "Character Deepening": "text-emerald-300",
  Payoff: "text-amber-300",
  Transition: "text-bone-500",
};

function EmotionalPanel({
  scriptId,
  projectId,
  ready,
}: {
  scriptId: string;
  projectId: string;
  ready: boolean;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  // Analysis level: this episode, or the whole season (aggregated, free).
  const [level, setLevel] = useState<"episode" | "season">("episode");
  const seasonScore = useMutation({
    mutationKey: ["pass:emotional-season", projectId],
    mutationFn: () => api.scoreSeason(projectId, false),
  });
  const seasonArcs = useQuery({
    queryKey: ["season-arcs", projectId],
    queryFn: () => api.getSeasonArcs(projectId),
    retry: false,
    enabled: level === "season",
  });
  // Budget mode: scope + cost cap. Defaults — selected scenes, $0.25 cap.
  const [scope, setScope] = useState<"selected" | "first3" | "low" | "full">("selected");
  const [scopeInput, setScopeInput] = useState("1, 2, 3");
  const [budget, setBudget] = useState(0.25);
  // Real progress for the (possibly long) staged pass.
  const [phase, setPhase] = useState<{ label: string; done: number; total: number } | null>(null);
  const EI_BATCH = 6;
  const EST_PER_SCENE = 0.03; // rough deep-pass LLM cost per scene, for estimates
  const score = useMutation({
    mutationKey: ["pass:emotional", scriptId],
    // Budget-aware, batched. NEVER regenerates metadata (uses cached only).
    // Quick = heuristic, $0. Deep = LLM only on weak scenes, capped at budget.
    mutationFn: async (opts: { mode: "quick" | "deep" }) => {
      const useLLM = opts.mode === "deep";
      const note = notes.trim() || undefined;
      type Batch = Awaited<ReturnType<typeof api.scoreEmotionalBatch>>;
      // HARD RULE — no metadata, no emotional score. Stop before scoring if
      // wounds or relationship tensions are missing.
      const st = await api.emotionalStatus(scriptId);
      const woundsLoaded = st.woundsCount > 0;
      const tensionsLoaded = st.tensionsCount > 0;
      if (!woundsLoaded || !tensionsLoaded) {
        setPhase(null);
        return {
          setupIncomplete: true as const,
          scriptId,
          overall: 0,
          weakSceneCount: 0,
          scenes: [] as Batch["scenes"],
          cost: 0,
          budgetHit: false,
          debug: {
            woundsLoaded,
            tensionsLoaded,
            scenesScoredWithMetadata: 0,
            cached: false,
            setupRequired: true,
            missingWounds: st.missingWounds,
          },
        };
      }
      const liveOrds = (sceneRows.data ?? [])
        .filter((r) => ["generated", "revised", "locked"].includes(r.status))
        .map((r) => r.ord)
        .sort((a, b) => a - b);

      // Target scene ords by scope.
      let orders: number[];
      if (scope === "selected") {
        orders = scopeInput
          .split(/[,\s]+/)
          .map((x) => parseInt(x, 10))
          .filter((n) => !isNaN(n) && liveOrds.includes(n));
      } else if (scope === "first3") {
        orders = liveOrds.slice(0, 3);
      } else if (scope === "low") {
        setPhase({ label: "Finding low-scoring scenes (free quick scan)…", done: 0, total: 1 });
        const quick = await api.scoreEmotionalBatch(scriptId, {
          from: 0,
          to: 100000,
          useLLM: false,
          notes: note,
        });
        orders = quick.scenes.filter((s) => s.overall < 0.7).map((s) => s.order);
        if (orders.length === 0) {
          setPhase(null);
          return {
            setupIncomplete: false as const,
            scriptId,
            overall: quick.scenes.length
              ? quick.scenes.reduce((a, s) => a + s.overall, 0) / quick.scenes.length
              : 0,
            weakSceneCount: 0,
            scenes: quick.scenes,
            debug: {
              ...quick.debug,
              scenesScoredWithMetadata: quick.scenes.filter((s) => s.metadataApplied).length,
            },
            cost: 0,
            budgetHit: false,
          };
        }
      } else {
        orders = liveOrds; // full episode
      }

      const scenes: Batch["scenes"] = [];
      let debug: Batch["debug"] | undefined;
      let cost = 0;
      let budgetHit = false;
      const totalTargets = orders.length || 1;
      for (let i = 0; i < orders.length; i += EI_BATCH) {
        const chunk = orders.slice(i, i + EI_BATCH);
        setPhase({
          label: `Scoring scene${chunk.length > 1 ? "s" : ""} ${chunk[0]}${
            chunk.length > 1 ? `–${chunk[chunk.length - 1]}` : ""
          }${useLLM ? " (deep)" : ""}`,
          done: i,
          total: totalTargets,
        });
        const batch = await api.scoreEmotionalBatch(scriptId, {
          from: 0,
          to: 1,
          orders: chunk,
          useLLM,
          deepThreshold: useLLM ? 0.7 : undefined,
          budget: useLLM ? Math.max(0, budget - cost) : undefined,
          notes: note,
        });
        scenes.push(...batch.scenes);
        debug = batch.debug;
        cost += batch.cost;
        if (batch.budgetHit) budgetHit = true;
      }
      setPhase(null);
      return {
        setupIncomplete: false as const,
        scriptId,
        overall: scenes.length ? scenes.reduce((s, x) => s + x.overall, 0) / scenes.length : 0,
        weakSceneCount: scenes.filter((s) => s.weak).length,
        scenes,
        // Aggregate across ALL batches (not just the last one) — this was the
        // "0 / 19" bug.
        debug: { ...debug!, scenesScoredWithMetadata: scenes.filter((s) => s.metadataApplied).length },
        cost,
        budgetHit,
      };
    },
    onSettled: () => setPhase(null),
  });
  const validate = useMutation({
    mutationKey: ["pass:directness", scriptId],
    mutationFn: () => api.validateDirectness(scriptId),
  });
  const fixOne = useMutation({
    mutationKey: ["scene-op", scriptId],
    mutationFn: ({ ord, rationale }: { ord: number; rationale: string }) =>
      api.regenerateScene(scriptId, ord, rationale),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] }),
  });
  // Project-level emotional-metadata status + one-shot setup (the proper path —
  // not scene-by-scene). Setup generates wounds for all main characters + key
  // relationship tensions, then re-scores.
  const emoStatus = useQuery({
    queryKey: ["emotional-status", scriptId],
    queryFn: () => api.emotionalStatus(scriptId),
  });
  const setup = useMutation({
    mutationFn: () => api.setupEmotionalMetadata(scriptId),
    onSuccess: () => {
      emoStatus.refetch();
      score.mutate({ mode: "quick" });
    },
  });
  // Tensions-only generator (project level) for the "tensions missing" case.
  const tensions = useMutation({
    mutationFn: () => api.setupProjectTensions(scriptId),
    onSuccess: () => {
      emoStatus.refetch();
      score.mutate({ mode: "quick" }); // re-score all once after generating
    },
  });
  // Character arcs (named starting/current states). Tolerant: if the route or
  // table isn't ready yet, we simply omit named states — the numeric arc still
  // renders. retry:false avoids hammering a missing endpoint.
  const arcs = useQuery({
    queryKey: ["character-arcs", scriptId],
    queryFn: () => api.getCharacterArcs(scriptId),
    retry: false,
  });
  const mapArcs = useMutation({
    mutationFn: () => api.mapCharacterArcs(scriptId),
    onSuccess: () => arcs.refetch(),
  });
  // Guided fixes: clicking a recommended pass PROPOSES a targeted rewrite for
  // review. Nothing changes until the writer clicks Apply. EI never rewrites
  // because of a score.
  const [proposed, setProposed] = useState<{
    ord: number;
    pass: PassKey;
    instruction: string;
    slugline: string;
    before: string;
    after: string;
    summary: string;
    changed: boolean;
  } | null>(null);
  const proposeFix = useMutation({
    mutationFn: (v: { ord: number; pass: PassKey; instruction: string }) =>
      api.proposeSceneFix(scriptId, v.ord, v.instruction).then((r) => ({
        ord: v.ord,
        pass: v.pass,
        instruction: v.instruction,
        ...r,
      })),
    onSuccess: (r) => setProposed(r),
  });
  const applyFix = useMutation({
    mutationFn: () =>
      api.applySceneFix(scriptId, proposed!.ord, proposed!.after, proposed!.instruction),
    onSuccess: () => {
      setProposed(null);
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      score.mutate({ mode: "quick" });
    },
  });
  const runPass = (pass: PassKey, ord: number, characters: string[] = []) =>
    proposeFix.mutate({
      ord,
      pass,
      instruction: PASSES[pass].instruction({ characters }),
    });
  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
  });

  const data = score.data;
  const directnessTotal = (validate.data ?? []).reduce(
    (n, s) => n + s.report.violations.length,
    0
  );

  return (
    <Panel eyebrow="Emotional" title="Emotional Continuity Check">
      {/* Analysis level: this episode vs the whole season (aggregated, free). */}
      <div className="mb-3 inline-flex rounded-md border border-white/10 bg-white/[0.02] p-0.5 text-xs">
        {(["episode", "season"] as const).map((lv) => (
          <button
            key={lv}
            onClick={() => setLevel(lv)}
            className={`rounded px-3 py-1 ${
              level === lv ? "bg-white/10 text-bone-100" : "text-bone-400 hover:text-bone-200"
            }`}
          >
            {lv === "episode" ? "This episode" : "Whole season"}
          </button>
        ))}
      </div>

      {level === "season" && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Button
              variant="outline"
              onClick={() => seasonScore.mutate()}
              disabled={seasonScore.isPending}
            >
              {seasonScore.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Heart className="h-4 w-4" />
              )}
              Score season (free)
            </Button>
            <span className="text-bone-500">
              Aggregates every episode's current draft — heuristic, no AI cost.
            </span>
          </div>
          {seasonScore.error && (
            <div className="text-xs text-red-300">{(seasonScore.error as Error).message}</div>
          )}
          {seasonScore.data && seasonScore.data.scenes.length === 0 && (
            <div className="text-xs text-bone-500">
              No drafted episodes yet. Draft at least one episode to see a season view.
            </div>
          )}
          {seasonScore.data && seasonScore.data.scenes.length > 0 && (() => {
            const raw = seasonScore.data;
            // Re-index globally so per-episode `ord` collisions don't confuse analysis.
            const analyzed = raw.scenes.map((s, i) => ({ ...s, order: i + 1 })) as unknown as AnalyzedScene[];
            const insights = buildInsights(analyzed);
            const characters = buildCharacterHealth(analyzed);
            const pacing = buildPacing(analyzed);
            const confidence = buildConfidence(analyzed);
            const summary = buildDevelopmentSummary(analyzed, characters, insights, pacing);
            const arcByName = new Map((seasonArcs.data ?? []).map((a) => [a.name, a]));
            return (
              <div className="space-y-3">
                <div className="rounded-lg border border-bone-100/15 bg-white/[0.03] p-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-300">
                      Season Development Summary
                    </div>
                    <span className={`chip ${CONFIDENCE_CHIP[confidence.level]}`}>
                      Confidence: {confidence.level} ({raw.scenes.length} scenes · {raw.episodes.length} eps)
                    </span>
                  </div>
                  {summary.headline && <div className="text-sm text-bone-200">{summary.headline}</div>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-emerald-300">Strengths</div>
                      <ul className="space-y-1 text-xs text-bone-300">
                        {summary.strengths.length ? (
                          summary.strengths.map((t, i) => (
                            <li key={i} className="flex gap-1.5"><span className="text-emerald-400">+</span><span>{t}</span></li>
                          ))
                        ) : (<li className="text-bone-500">—</li>)}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-amber-300">Risks</div>
                      <ul className="space-y-1 text-xs text-bone-300">
                        {summary.risks.length ? (
                          summary.risks.map((t, i) => (
                            <li key={i} className="flex gap-1.5"><span className="text-amber-400">!</span><span>{t}</span></li>
                          ))
                        ) : (<li className="text-bone-500">No material risks detected.</li>)}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-400">Episodes</div>
                  <div className="space-y-1">
                    {raw.episodes.map((ep) => (
                      <div key={ep.number} className="flex items-center gap-2 text-xs">
                        <span className="w-44 shrink-0 truncate text-bone-300">Ep {ep.number} — {ep.title}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded bg-white/5">
                          <div
                            className={`h-full ${ep.overall >= 0.7 ? "bg-emerald-500/70" : ep.overall >= 0.5 ? "bg-amber-500/70" : "bg-red-600/70"}`}
                            style={{ width: `${Math.round(ep.overall * 100)}%` }}
                          />
                        </div>
                        <span className={scoreColor(ep.overall)}>{Math.round(ep.overall * 100)}</span>
                        <span className="text-bone-600">{ep.sceneCount} sc</span>
                      </div>
                    ))}
                  </div>
                </div>

                {characters.length > 0 && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-400">
                      Season Character Arc Health
                    </div>
                    <div className="space-y-1.5">
                      {characters.map((c) => {
                        const tm = trendMark(c.trend);
                        const arc = arcByName.get(c.name);
                        return (
                          <div key={c.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                            <span className="w-36 shrink-0 truncate font-medium text-bone-200">{c.name}</span>
                            <span className={`chip ${CLASS_CHIP[c.classification]}`}>{CHARACTER_CLASS_LABEL[c.classification]}</span>
                            <span className="text-bone-500">{c.presence} sc</span>
                            <span className={scoreColor(c.avgOverall)}>{Math.round(c.avgOverall * 100)} avg</span>
                            <span className={tm.cls}>{tm.sym} {c.arcStrength}</span>
                            {arc ? (
                              <span className="text-bone-400">
                                <span className="text-bone-600">{arc.startingState}</span> → <span className="text-bone-200">{arc.currentState}</span>
                              </span>
                            ) : (
                              <span className="italic text-bone-600">map arcs per episode to see states</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {level === "episode" && (<>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <div className="flex-1 text-xs text-bone-400">
          Checks whether each character's emotional journey feels earned,
          consistent, and specific from scene to scene.
          {!ready && (
            <span className="ml-2 text-amber-300">
              — write at least one scene first
            </span>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => validate.mutate()}
          disabled={!ready || validate.isPending}
        >
          {validate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Check directness
        </Button>
        <Button
          variant="outline"
          onClick={() => score.mutate({ mode: "quick" })}
          disabled={!ready || score.isPending}
          title="Fast heuristic scoring of every scene — flags major emotional jumps, no per-scene AI critique."
        >
          {score.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart className="h-4 w-4" />
          )}
          Quick pass
        </Button>
        <Button
          onClick={() => score.mutate({ mode: "deep" })}
          disabled={!ready || score.isPending}
          title="Slower — runs the AI emotional critique, but only on scenes that score weak after metadata."
        >
          {score.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart className="h-4 w-4" />
          )}
          Deep pass
        </Button>
      </div>

      {/* Budget mode controls — scope + cost cap + estimate. */}
      {(() => {
        const liveCount = (sceneRows.data ?? []).filter((r) =>
          ["generated", "revised", "locked"].includes(r.status)
        ).length;
        const selectedCount = scopeInput
          .split(/[,\s]+/)
          .map((x) => parseInt(x, 10))
          .filter((n) => !isNaN(n)).length;
        const targetCount =
          scope === "selected"
            ? selectedCount
            : scope === "first3"
            ? 3
            : scope === "full"
            ? liveCount
            : null; // low-scoring is unknown until the free scan
        const deepEst =
          targetCount != null ? Math.min(targetCount * EST_PER_SCENE, budget) : budget;
        return (
          <div className="mt-2 flex flex-wrap items-end gap-3 rounded-md border border-white/8 bg-white/[0.02] p-2 text-xs">
            <label className="flex flex-col gap-0.5">
              <span className="text-bone-500">Scope</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
                className="input w-48"
              >
                <option value="selected">Selected scenes</option>
                <option value="first3">First 3 scenes</option>
                <option value="low">Only low-scoring scenes</option>
                <option value="full">Full episode</option>
              </select>
            </label>
            {scope === "selected" && (
              <label className="flex flex-1 flex-col gap-0.5">
                <span className="text-bone-500">Scene numbers</span>
                <input
                  type="text"
                  value={scopeInput}
                  onChange={(e) => setScopeInput(e.target.value)}
                  placeholder="e.g. 1, 2, 3"
                  className="input w-full"
                />
              </label>
            )}
            <label className="flex flex-col gap-0.5">
              <span className="text-bone-500">Budget cap (deep)</span>
              <select
                value={budget}
                onChange={(e) => setBudget(parseFloat(e.target.value))}
                className="input w-28"
              >
                <option value={0.25}>$0.25</option>
                <option value={0.5}>$0.50</option>
                <option value={1}>$1.00</option>
              </select>
            </label>
            <div className="text-bone-400">
              Est: <span className="text-emerald-300">Quick $0.00</span> ·{" "}
              <span className="text-bone-200">
                Deep {targetCount != null ? `~$${deepEst.toFixed(2)}` : `≤ $${budget.toFixed(2)}`}
              </span>
              <span className="text-bone-600"> (hard cap ${budget.toFixed(2)})</span>
            </div>
          </div>
        );
      })()}

      <CheckNotesField
        value={notes}
        onChange={setNotes}
        disabled={score.isPending}
        placeholder="e.g. Margot should stay emotionally numb and controlled. Don't push her into obvious breakdowns too early."
      />

      {/* Setup incomplete — HARD RULE: no metadata, no emotional score. */}
      {ready && emoStatus.data && !emoStatus.data.ready && (() => {
        const woundsOk = emoStatus.data.woundsCount > 0 && emoStatus.data.missingWounds.length === 0;
        const tensionsOk = emoStatus.data.tensionsCount > 0;
        const busy = setup.isPending || tensions.isPending;
        return (
          <div className="mt-3 rounded-md border border-sky-700/50 bg-sky-950/20 p-3 text-xs">
            <div className="font-medium text-sky-100">
              Setup {emoStatus.data.woundsCount > 0 ? "incomplete" : "required"}
            </div>
            <div className="mt-0.5 space-y-0.5 text-sky-200/80">
              <div>
                Character wounds:{" "}
                <span className={woundsOk ? "text-emerald-300" : "text-amber-300"}>
                  {woundsOk
                    ? "loaded"
                    : emoStatus.data.missingWounds.length > 0
                    ? `missing for ${emoStatus.data.missingWounds.join(", ")}`
                    : "missing"}
                </span>
              </div>
              <div>
                Relationship tensions:{" "}
                <span className={tensionsOk ? "text-emerald-300" : "text-amber-300"}>
                  {tensionsOk ? "loaded" : "missing"}
                </span>
              </div>
              <div className="text-sky-200/60">
                No emotional score is shown until both are loaded.
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {!woundsOk && (
                <button
                  onClick={() => setup.mutate()}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                >
                  {setup.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {setup.isPending ? "Generating metadata…" : "Generate emotional metadata for project"}
                </button>
              )}
              {woundsOk && !tensionsOk && (
                <button
                  onClick={() => tensions.mutate()}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                >
                  {tensions.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {tensions.isPending ? "Generating tensions…" : "Generate missing relationship tensions for project"}
                </button>
              )}
            </div>
            {busy && (
              <div className="mt-1 text-[10px] text-sky-200/70">
                Building metadata for the project — a minute or two. It re-scores when done.
              </div>
            )}
            {(setup.error || tensions.error) && (
              <div className="mt-1 text-[10px] text-red-300">
                {((setup.error || tensions.error) as Error).message}
              </div>
            )}
          </div>
        );
      })()}

      {score.isPending && phase && (
        <div className="mt-3 rounded-md border border-ember-700/40 bg-ember-950/20 p-3">
          <div className="flex items-center gap-2 text-xs text-ember-100">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{phase.label}</span>
            {phase.total > 1 && (
              <span className="ml-auto text-ember-200/70">
                {Math.min(phase.done, phase.total)} / {phase.total}
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-ember-950/60">
            <div
              className="h-full rounded-full bg-gradient-to-r from-ember-500 to-ember-300 transition-all"
              style={{
                width:
                  phase.total > 1
                    ? `${Math.round((Math.min(phase.done, phase.total) / phase.total) * 100)}%`
                    : "15%",
              }}
            />
          </div>
        </div>
      )}
      {(score.error || validate.error) && (
        <div className="mt-3 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {((score.error || validate.error) as Error).message}
        </div>
      )}

      {validate.data && (
        <div className="mt-3 text-xs">
          {directnessTotal === 0 ? (
            <div className="rounded border border-emerald-800/40 bg-emerald-950/20 p-2 text-emerald-200">
              No on-the-nose dialogue detected. Characters aren't explaining
              their feelings.
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-amber-300">
                {directnessTotal} on-the-nose line
                {directnessTotal === 1 ? "" : "s"} detected:
              </div>
              {validate.data
                .filter((s) => s.report.violations.length > 0)
                .map((s) => (
                  <div
                    key={s.order}
                    className="rounded border border-amber-800/40 bg-amber-950/15 p-2"
                  >
                    <div className="font-mono text-bone-500">
                      #{s.order} {s.slugline}
                    </div>
                    {s.report.violations.map((v, i) => (
                      <div key={i} className="mt-0.5 text-bone-300">
                        <span className="text-red-300">“{v.text}”</span>{" "}
                        <span className="text-bone-500">({v.pattern})</span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* HARD RULE: no metadata, no emotional score. Don't render scene scores
          when setup is incomplete or no scene actually matched metadata. */}
      {data && (data.setupIncomplete || data.debug.scenesScoredWithMetadata === 0) && (
        <div className="mt-3 rounded-md border border-amber-700/50 bg-amber-950/15 p-3 text-xs">
          <div className="font-medium text-amber-100">Setup incomplete</div>
          <div className="mt-0.5 text-amber-200/80">
            {!data.debug.tensionsLoaded
              ? "Setup required: relationship tensions are missing."
              : !data.debug.woundsLoaded
              ? "Setup required: character wounds are missing."
              : "No scenes matched the emotional metadata (character matching found nothing to score)."}{" "}
            No emotional score is shown until metadata is complete and at least
            one scene matches it. Use the setup buttons above.
          </div>
          <div className="mt-2 rounded border border-white/8 bg-black/20 p-2 font-mono text-[11px] text-bone-400">
            <div>Character wounds loaded: <span className={data.debug.woundsLoaded ? "text-emerald-300" : "text-red-300"}>{data.debug.woundsLoaded ? "yes" : "no"}</span></div>
            <div>Relationship tensions loaded: <span className={data.debug.tensionsLoaded ? "text-emerald-300" : "text-red-300"}>{data.debug.tensionsLoaded ? "yes" : "no"}</span></div>
            <div>Scenes scored with metadata: <span className="text-bone-200">{data.debug.scenesScoredWithMetadata} / {data.scenes.length || "—"}</span></div>
          </div>
        </div>
      )}

      {data && !data.setupIncomplete && data.debug.scenesScoredWithMetadata > 0 && (() => {
        // Weak is now decided by the backend over the dimensions that APPLY,
        // so a scene is only weak for genuine writing reasons — never because
        // wound/tension metadata happened to be N/A.
        const trueWeakCount = data.scenes.filter((s) => s.weak).length;
        const partialCount = data.scenes.filter(
          (s) => (s.dimensionsScored ?? EI_DIMS.length) < (s.dimensionsTotal ?? EI_DIMS.length)
        ).length;
        // Free, deterministic development analysis over the per-scene reports (no LLM).
        const analyzed = data.scenes as unknown as AnalyzedScene[];
        const insights = buildInsights(analyzed);
        const characters = buildCharacterHealth(analyzed);
        const heatmap = buildHeatmap(analyzed);
        const pacing = buildPacing(analyzed);
        const confidence = buildConfidence(analyzed);
        // At LOW confidence, presence counts reflect sample size, not story —
        // suppress per-character presence warnings to avoid early-draft noise.
        const presenceReliable = confidence.level !== "low";
        const summary = buildDevelopmentSummary(analyzed, characters, insights, pacing);
        const arcByName = new Map((arcs.data ?? []).map((a) => [a.name, a]));
        const confPct = (v: number) => `${Math.round(v * 100)}%`;
        // Tier 1 dramatic-turn read, per scene + the honest headline counts.
        const orderedAnalyzed = [...analyzed].sort((a, b) => a.order - b.order);
        const turnByOrder = new Map(
          orderedAnalyzed.map((s, i) => {
            const job = classifySceneJob(s, orderedAnalyzed[i - 1], i, orderedAnalyzed.length);
            return [s.order, analyzeSceneTurn(s, orderedAnalyzed[i - 1], job)];
          })
        );
        const turnSummary = summarizeTurns(analyzed);
        const fixes = rankFixes(analyzed);
        return (
        <div className="mt-3 space-y-3 text-sm">
          {/* ===== Development Summary — reads like coverage, above everything ===== */}
          <div className="rounded-lg border border-bone-100/15 bg-white/[0.03] p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-300">
                Development Summary
              </div>
              <span
                className={`chip ${CONFIDENCE_CHIP[confidence.level]}`}
                title={`Based on ${confidence.sceneCount} scenes · metadata ${confPct(
                  confidence.factors.metadataCoverage
                )}, wounds ${confPct(confidence.factors.woundCoverage)}, tensions ${confPct(
                  confidence.factors.tensionCoverage
                )}, character participation ${confPct(confidence.factors.characterParticipation)}`}
              >
                Confidence: {confidence.level} ({confidence.sceneCount} scene
                {confidence.sceneCount === 1 ? "" : "s"})
              </span>
            </div>
            {summary.headline && (
              <div className="text-sm text-bone-200">{summary.headline}</div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-emerald-300">Strengths</div>
                <ul className="space-y-1 text-xs text-bone-300">
                  {summary.strengths.length ? (
                    summary.strengths.map((t, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-emerald-400">+</span>
                        <span>{t}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-bone-500">—</li>
                  )}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-amber-300">Risks</div>
                <ul className="space-y-1 text-xs text-bone-300">
                  {summary.risks.length ? (
                    summary.risks.map((t, i) => (
                      <li key={i} className="flex gap-1.5">
                        <span className="text-amber-400">!</span>
                        <span>{t}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-bone-500">No material risks detected.</li>
                  )}
                </ul>
              </div>
            </div>
            {fixes.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-medium text-sky-300">
                  Where I'd spend the next hour — top {fixes.length} highest-impact fix
                  {fixes.length === 1 ? "" : "es"}
                </div>
                <ol className="space-y-2 text-xs text-bone-300">
                  {fixes.map((f, i) => (
                    <li
                      key={f.order}
                      className="rounded border border-sky-800/30 bg-sky-950/10 p-2"
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-sky-300">{i + 1}.</span>
                        <span className="font-mono text-bone-500">#{f.order}</span>
                        <span className="text-bone-200">{f.problem}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-bone-500">{f.why}</div>
                      <button
                        onClick={() => runPass(f.pass, f.order, f.characters)}
                        disabled={proposeFix.isPending}
                        className="mt-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                        title="Proposes a fix for review — nothing changes until you Apply."
                      >
                        {PASSES[f.pass].label} on Scene {f.order}
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="mt-1 text-[10px] text-bone-600">
                  Ranked by impact across the episode. Passes propose a diff for your review —
                  EI never rewrites automatically.
                </div>
              </div>
            )}
          </div>

          {/* ---- Findings (actionable) ---- */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-400">
              Findings
            </div>
            <div className="mb-1 text-[10px] text-bone-600">
              Specific, scene- and character-level observations.
            </div>
            <ul className="space-y-1.5 text-xs text-bone-300">
              {/* Dimension diagnostics — name the exact scenes + characters. */}
              {insights.weaknesses.map((w, i) => (
                <li key={`w${i}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-amber-400">!</span>
                  <span>
                    Low {w.label} in Scene{w.affectedScenes.length === 1 ? "" : "s"}{" "}
                    {joinScenes(w.affectedScenes)}
                    {w.characters.length > 0 ? ` (${w.characters.join(", ")})` : ""}
                  </span>
                  <button
                    onClick={() => runPass(w.suggestedPass, w.affectedScenes[0], w.characters)}
                    disabled={proposeFix.isPending}
                    className="rounded-md border border-sky-600/60 bg-sky-900/30 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
                  >
                    {PASSES[w.suggestedPass].label}
                  </button>
                </li>
              ))}
              {/* Character presence diagnostics — deferred at LOW confidence so
                  early drafts don't get false "low presence" warnings. */}
              {!presenceReliable ? (
                <li className="flex items-start gap-2 text-bone-500">
                  <span>•</span>
                  <span>
                    Presence analysis deferred until sufficient scenes are available.
                  </span>
                </li>
              ) : (
                characters.map((c) => (
                  <li key={`c${c.name}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-bone-500">•</span>
                    <span>
                      {c.name} appears in {c.presence} scene{c.presence === 1 ? "" : "s"}
                    </span>
                    {(c.classification === "low-presence" ||
                      c.classification === "underdeveloped" ||
                      c.classification === "insufficient-data") && (
                      <span className={`chip ${CLASS_CHIP[c.classification]}`}>
                        {CHARACTER_CLASS_LABEL[c.classification]}
                      </span>
                    )}
                  </li>
                ))
              )}
              {insights.weaknesses.length === 0 && !presenceReliable && (
                <li className="text-bone-500">No dimension is below target.</li>
              )}
            </ul>
          </div>

          {/* ---- Episode heatmap ---- */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-400">
              Episode heatmap
            </div>
            {/* Honest, job-aware dramatic-turn headline (Tier 1 heuristic). */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-bone-400">
              <span><span className="text-emerald-300">{turnSummary.detected}</span> turn{turnSummary.detected === 1 ? "" : "s"} detected</span>
              <span><span className="text-amber-300">{turnSummary.possible}</span> possible</span>
              {turnSummary.missingExpectedTurn > 0 && (
                <span>
                  <span className="text-rose-300">{turnSummary.missingExpectedTurn}</span> should turn but don't
                  <span className="text-bone-600"> — heuristic, subtle turns may be missed</span>
                </span>
              )}
              {turnSummary.quietByDesign > 0 && (
                <span className="text-bone-500">
                  {turnSummary.quietByDesign} quiet by design
                </span>
              )}
              {turnSummary.intentNotLanding > 0 && (
                <span className="text-rose-300">
                  {turnSummary.intentNotLanding} intended turn{turnSummary.intentNotLanding === 1 ? "" : "s"} may not be landing
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {heatmap.cells.map((c) => {
                const notable = c.flags.find(
                  (f) => f === "exposition" || f === "low-tension" || f === "repeated"
                );
                const topBorder =
                  notable === "exposition"
                    ? "border-t-2 border-t-violet-400"
                    : notable === "low-tension"
                    ? "border-t-2 border-t-sky-400"
                    : notable === "repeated"
                    ? "border-t-2 border-t-amber-400"
                    : "";
                return (
                  <div
                    key={c.order}
                    title={`#${c.order} ${c.slugline} — ${Math.round(
                      c.overall * 100
                    )}/100${c.flags.length ? ` · ${c.flags.map((f) => SCENE_FLAG_META[f].label).join(", ")}` : ""}`}
                    className={`flex h-7 w-7 items-center justify-center rounded-sm border text-[9px] font-mono ${heatBg(
                      c.overall
                    )} ${topBorder}`}
                  >
                    {c.order}
                  </div>
                );
              })}
            </div>
            {/* Scene-job strip — each scene is graded against the job it performs. */}
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
              {heatmap.cells.map((c) => (
                <span
                  key={c.order}
                  className={JOB_CLS[c.job]}
                  title={`#${c.order}: ${SCENE_JOB_LABEL[c.job]} (inferred) — ${SCENE_JOB_PROFILE[c.job].purpose}`}
                >
                  #{c.order} {SCENE_JOB_LABEL[c.job]}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-bone-500">
              <span><span className="text-emerald-300">■</span> standout (≥80)</span>
              <span><span className="text-amber-300">■</span> mid</span>
              <span><span className="text-red-300">■</span> weak</span>
              <span><span className="text-violet-300">▔</span> exposition</span>
              <span><span className="text-sky-300">▔</span> low tension</span>
              <span><span className="text-amber-300">▔</span> repeated</span>
            </div>
            {pacing.zones.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {pacing.zones.map((z, i) => (
                  <span
                    key={i}
                    className={`chip ${PACING_CHIP[z.kind]}`}
                    title={`Scenes #${z.fromOrder}–#${z.toOrder}`}
                  >
                    {z.label}
                  </span>
                ))}
              </div>
            )}
            <div className="text-[10px] text-bone-600">
              Scene jobs are inferred heuristically — each scene is graded against the job it performs.
            </div>
          </div>

          {/* ---- Character Arc Health ---- */}
          {characters.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-bone-400">
                  Character Arc Health
                </div>
                <button
                  onClick={() => mapArcs.mutate()}
                  disabled={mapArcs.isPending}
                  className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-50"
                  title="Runs ONE AI pass to label each character's starting → current emotional state. Small cost; read-only — never rewrites the script."
                >
                  {mapArcs.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  {arcs.data && arcs.data.length ? "Re-map arcs" : "Map character arcs"}
                </button>
              </div>
              {mapArcs.data && (
                <div className="text-[10px] text-bone-600">
                  Arc pass cost: ${(mapArcs.data.cost ?? 0).toFixed(3)}
                </div>
              )}
              {!presenceReliable && (
                <div className="text-[10px] text-bone-500">
                  Presence analysis deferred until sufficient scenes are available —
                  classifications below reflect too small a sample to be reliable.
                </div>
              )}
              <div className="space-y-1.5">
                {characters.map((c) => {
                  const tm = trendMark(c.trend);
                  const arc = arcByName.get(c.name);
                  // Suppress pure presence-count flags at LOW confidence.
                  const presenceOnly =
                    c.classification === "low-presence" ||
                    c.classification === "insufficient-data";
                  const showWarningChip = presenceReliable || !presenceOnly;
                  return (
                    <div
                      key={c.name}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                    >
                      <span className="w-36 shrink-0 truncate font-medium text-bone-200">
                        {c.name}
                      </span>
                      {showWarningChip ? (
                        <span
                          className={`chip ${CLASS_CHIP[c.classification]}`}
                          title="Arc classification from presence + trend across the script."
                        >
                          {CHARACTER_CLASS_LABEL[c.classification]}
                        </span>
                      ) : (
                        <span
                          className="chip border-white/15 bg-white/[0.04] text-bone-500"
                          title="Too few scenes scored to classify presence yet."
                        >
                          early sample
                        </span>
                      )}
                      <span className="text-bone-500">
                        {c.presence} scene{c.presence === 1 ? "" : "s"}
                      </span>
                      <span className={scoreColor(c.avgOverall)}>
                        {Math.round(c.avgOverall * 100)} avg
                      </span>
                      <span
                        className={tm.cls}
                        title={`Trend ${c.trend >= 0 ? "+" : ""}${Math.round(
                          c.trend * 100
                        )} · arc strength ${c.arcStrength}`}
                      >
                        {tm.sym} {c.arcStrength}
                      </span>
                      {arc ? (
                        <span
                          className="text-bone-400"
                          title={(arc.evidence ?? []).join(" · ")}
                        >
                          <span className="text-bone-600">{arc.startingState}</span> →{" "}
                          <span className="text-bone-200">{arc.currentState}</span>
                        </span>
                      ) : (
                        <span className="italic text-bone-600">states not mapped</span>
                      )}
                      <span
                        className="text-bone-600"
                        title="Scenes where a tracked wound applied"
                      >
                        wound {Math.round(c.woundUsage * 100)}%
                      </span>
                    </div>
                  );
                })}
              </div>
              {mapArcs.error && (
                <div className="text-[11px] text-red-300">
                  {(mapArcs.error as Error).message}
                </div>
              )}
            </div>
          )}

          {/* ---- Guided-fix review (propose → Apply; never auto-rewrites) ---- */}
          {proposeFix.isPending && (
            <div className="flex items-center gap-2 text-xs text-bone-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Proposing a fix for review…
            </div>
          )}
          {proposeFix.error && (
            <div className="text-xs text-red-300">{(proposeFix.error as Error).message}</div>
          )}
          {proposed && (
            <div className="rounded-lg border border-sky-700/40 bg-sky-950/20 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
                  {PASSES[proposed.pass].label} — Scene #{proposed.ord} (review)
                </div>
                <button
                  onClick={() => setProposed(null)}
                  className="text-xs text-bone-500 hover:text-bone-300"
                >
                  dismiss
                </button>
              </div>
              <div className="text-[11px] text-bone-400">{proposed.summary}</div>
              {!proposed.changed ? (
                <div className="text-xs text-amber-300">
                  The pass proposed no change to this scene.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase text-bone-600">Before</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-bone-400">
                      {proposed.before}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[10px] uppercase text-emerald-400">
                      After (proposed)
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-bone-200">
                      {proposed.after}
                    </pre>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => applyFix.mutate()}
                  disabled={!proposed.changed || applyFix.isPending}
                  className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-900/30 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-900/50 disabled:opacity-50"
                >
                  {applyFix.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Apply to scene
                </button>
                <button
                  onClick={() => setProposed(null)}
                  className="rounded-md border border-white/10 px-3 py-1 text-xs text-bone-300 hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ---- Score summary (after findings) ---- */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-bone-500">Overall emotional score:</span>
            <span className="rounded bg-white/[0.04] px-2 py-0.5 text-bone-100">
              {Math.round(data.overall * 100)}/100
            </span>
            {trueWeakCount > 0 && (
              <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">
                {trueWeakCount} weak scene{trueWeakCount === 1 ? "" : "s"}
              </span>
            )}
            {partialCount > 0 && (
              <span
                className="chip border-sky-700/50 bg-sky-900/30 text-sky-200"
                title="These scenes had no applicable wound/tension, so those dimensions were scored N/A and excluded — not penalized."
              >
                {partialCount} partly N/A
              </span>
            )}
            {trueWeakCount === 0 && (
              <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-200">
                no weak scenes
              </span>
            )}
          </div>

          {/* Debug readout — so the score is trustworthy. */}
          {data.debug && (
            <div className="rounded-md border border-white/8 bg-black/20 p-2 font-mono text-[11px] text-bone-400">
              <div>
                Character wounds loaded:{" "}
                <span className={data.debug.woundsLoaded ? "text-emerald-300" : "text-red-300"}>
                  {data.debug.woundsLoaded ? "yes" : "no"}
                </span>
              </div>
              <div>
                Relationship tensions loaded:{" "}
                <span className={data.debug.tensionsLoaded ? "text-emerald-300" : "text-red-300"}>
                  {data.debug.tensionsLoaded ? "yes" : "no"}
                </span>
              </div>
              <div>
                Scenes scored with metadata:{" "}
                <span className="text-bone-200">
                  {data.debug.scenesScoredWithMetadata} / {data.scenes.length}
                </span>
              </div>
              <div>
                Cached result used:{" "}
                <span className="text-bone-200">{data.debug.cached ? "yes" : "no"}</span>
              </div>
              <div>
                Actual cost this run:{" "}
                <span className="text-bone-100">${(data.cost ?? 0).toFixed(2)}</span>
              </div>
              {data.budgetHit && (
                <div className="mt-1 text-amber-300">
                  Budget reached (${budget.toFixed(2)}) — remaining scenes were
                  scored heuristically (no AI critique). Raise the cap or narrow
                  the scope to deep-check the rest.
                </div>
              )}
              {data.debug.setupRequired && (
                <div className="mt-1 text-sky-300">
                  Setup required — generate emotional metadata above before
                  trusting these scores.
                </div>
              )}
            </div>
          )}

          <ul className="space-y-2">
            {data.scenes.map((s) => {
              const rows = sceneRows.data ?? [];
              const matched = rows.find((r) => r.ord === s.order);
              const isFixing = fixOne.isPending && fixOne.variables?.ord === s.order;
              const rationale = `Emotional Truth: scene scored ${Math.round(
                s.overall * 100
              )}/100. ${s.rewriteInstructions.join(" ")}`;
              // Weak now means a genuine emotional problem: the backend only
              // averages dimensions that actually APPLY (Wound/Tension count as
              // N/A when no wound/tension metadata matches the scene), so a low
              // score is never just a metadata gap.
              const trueWeak = s.weak;
              const dimsScored = s.dimensionsScored ?? EI_DIMS.length;
              const dimsTotal = s.dimensionsTotal ?? EI_DIMS.length;
              const partial = dimsScored < dimsTotal;
              return (
                <li
                  key={s.order}
                  className={`rounded-md border p-2 ${
                    trueWeak
                      ? "border-amber-800/60 bg-amber-950/15"
                      : "border-white/8 bg-white/[0.02]"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="font-mono text-bone-500">
                      #{s.order} {s.slugline}
                    </span>
                    <span className="ml-auto text-bone-300">
                      {Math.round(s.overall * 100)}/100
                    </span>
                    <span
                      className={`chip ${
                        partial
                          ? "border-sky-700/50 bg-sky-900/30 text-sky-200"
                          : "border-white/10 bg-white/[0.04] text-bone-400"
                      }`}
                      title={
                        partial
                          ? "Some dimensions are N/A for this scene (no matching wound/tension metadata) and were excluded from the score."
                          : "All six emotional dimensions applied to this scene."
                      }
                    >
                      {dimsScored}/{dimsTotal} dimensions
                    </span>
                    {trueWeak && (
                      <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">
                        weak
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                    {EI_DIMS.map((d) => {
                      const dim = s.scores[d.key];
                      const na = dim ? dim.available === false : false;
                      return (
                        <span key={d.key} title={dim?.reason}>
                          <span className="text-bone-500">{d.label}</span>{" "}
                          {na ? (
                            <span className="text-bone-600">N/A</span>
                          ) : (
                            <span className={scoreColor(dim?.value ?? 0)}>
                              {Math.round((dim?.value ?? 0) * 100)}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {/* Scene-character matching debug */}
                  {s.match && (
                    <div className="mt-1 rounded border border-white/8 bg-black/20 p-1.5 font-mono text-[10px] text-bone-500">
                      <div>
                        detected: {s.match.detectedCharacters.join(", ") || "—"} → resolved:{" "}
                        {s.match.resolvedCharacters.join(", ") || "—"}
                      </div>
                      <div>
                        wounds matched:{" "}
                        <span className={s.match.woundsMatched.length ? "text-emerald-300" : "text-amber-300"}>
                          {s.match.woundsMatched.join(", ") || "none"}
                        </span>{" "}
                        · tensions matched:{" "}
                        <span className={s.match.tensionsMatched ? "text-emerald-300" : "text-amber-300"}>
                          {s.match.tensionsMatched}
                        </span>{" "}
                        · metadata used:{" "}
                        <span className={s.metadataApplied ? "text-emerald-300" : "text-red-300"}>
                          {s.metadataApplied ? "yes" : "no"}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Dramatic turn: intended (from scene plan) vs detected. */}
                  {(() => {
                    const t = turnByOrder.get(s.order);
                    if (!t) return null;
                    return (
                      <div className="mt-2 space-y-0.5 text-[11px]">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span
                            className={`chip border-white/12 bg-white/[0.04] ${JOB_CLS[t.job]}`}
                            title={SCENE_JOB_PROFILE[t.job].purpose}
                          >
                            {SCENE_JOB_LABEL[t.job]}
                          </span>
                          <span className="text-bone-500">Detected turn:</span>
                          <span
                            className={`chip ${TURN_CHIP[t.detected.level]}`}
                            title={t.detected.evidence.join(" · ") || "No turn cues fired."}
                          >
                            {TURN_LEVEL_LABEL[t.detected.level]}
                          </span>
                          {!t.expectsTurn && t.detected.level === "none" && (
                            <span className="text-bone-600">(not expected for this job)</span>
                          )}
                          {t.detected.axes.length > 0 && (
                            <span className="text-bone-500">
                              {t.detected.axes.join(", ")}
                            </span>
                          )}
                        </div>
                        {t.intendedTurn && (
                          <div className="text-bone-500">
                            <span className="text-bone-600">Intended turn:</span> {t.intendedTurn}
                          </div>
                        )}
                        {t.note && (
                          <div
                            className={
                              t.alignment === "intent-not-landing"
                                ? "text-rose-300"
                                : "text-bone-500"
                            }
                          >
                            {t.note}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {partial && (
                    <div className="mt-2 text-[11px] text-bone-500">
                      {dimsTotal - dimsScored} dimension
                      {dimsTotal - dimsScored > 1 ? "s" : ""} (
                      {EI_DIMS.filter((d) => s.scores[d.key]?.available === false)
                        .map((d) => d.label)
                        .join(", ")}
                      ) marked N/A — no matching wound/tension applies to this scene, so they
                      were excluded from the score rather than counted as zero.
                    </div>
                  )}

                  {trueWeak && s.rewriteInstructions.length > 0 && (
                    <div className="mt-1 text-xs text-bone-300">
                      <span className="text-bone-500">Rewrite:</span>{" "}
                      {s.rewriteInstructions.join(" ")}
                    </div>
                  )}
                  {trueWeak && (
                    <div className="mt-2">
                      <button
                        disabled={!matched || matched.status === "locked" || isFixing}
                        title={
                          !matched
                            ? "No matching scene row."
                            : matched.status === "locked"
                            ? "Scene is locked."
                            : "Regenerate this scene with the emotional rewrite instructions."
                        }
                        onClick={() =>
                          matched && fixOne.mutate({ ord: s.order, rationale })
                        }
                        className="flex items-center gap-1 rounded-md border border-ember-700/60 bg-ember-900/30 px-2 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-50"
                      >
                        {isFixing ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RefreshCcw className="h-3 w-3" />
                        )}
                        {isFixing ? "Fixing…" : "Fix scene with note"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        );
      })()}
      </>)}
    </Panel>
  );
}

function ProductionPanel({
  scriptId,
  ready,
}: {
  scriptId: string;
  ready: boolean;
}) {
  const run = useMutation({
    mutationKey: ["pass:production", scriptId],
    mutationFn: () => api.runProductionPass(scriptId),
  });
  const data = run.data;
  const tierColor: Record<string, string> = {
    indie: "border-emerald-700/50 bg-emerald-900/30 text-emerald-200",
    mid: "border-sky-700/50 bg-sky-900/30 text-sky-200",
    studio: "border-amber-700/50 bg-amber-900/30 text-amber-200",
    tentpole: "border-red-700/60 bg-red-950/40 text-red-200",
  };
  const flagIcon = (k: string) =>
    ({
      vfx: "✨",
      stunt: "🤸",
      location: "📍",
      cast: "🎭",
      ai_gen: "🤖",
      weather: "🌧️",
    } as Record<string, string>)[k] ?? "•";
  return (
    <Panel eyebrow="Production" title="Production Breakdown">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex-1 text-xs text-bone-400">
          Estimates the budget tier and flags VFX, stunts, locations, cast,
          AI-gen and weather considerations scene by scene.
          {!ready && (
            <span className="ml-2 text-amber-300">
              — write at least one scene first
            </span>
          )}
        </div>
        <Button onClick={() => run.mutate()} disabled={!ready || run.isPending}>
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Clapperboard className="h-4 w-4" />
          )}
          {run.isPending ? "Assessing…" : "Run Production"}
        </Button>
      </div>

      {run.isPending && (
        <div className="mt-3">
          <BusyBar
            label="Producer assessing the draft"
            subtext="Breaking down the draft for production. About a minute."
          />
        </div>
      )}
      {run.error && (
        <div className="mt-3 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(run.error as Error).message}
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-bone-500">Budget tier:</span>
            <span className={`chip ${tierColor[data.estimate.tier] ?? ""}`}>
              {data.estimate.tier}
            </span>
            {data.estimate.reasoning && (
              <span className="text-bone-400">{data.estimate.reasoning}</span>
            )}
          </div>

          {data.flags.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-bone-500">
                Production flags ({data.flags.length})
              </div>
              <ul className="space-y-2">
                {data.flags.map((f, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-white/8 bg-white/[0.02] p-2"
                  >
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-mono text-bone-500">
                        {flagIcon(f.kind)} {f.kind}
                      </span>
                      {f.sceneIds.length > 0 && (
                        <span className="ml-auto text-[10px] text-bone-500">
                          scenes {f.sceneIds.map((s) => `#${s}`).join(", ")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-bone-100">{f.note}</div>
                    {f.mitigation && (
                      <div className="mt-1 text-xs text-bone-300">
                        <span className="text-bone-500">Mitigation:</span>{" "}
                        {f.mitigation}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.aiGen.length > 0 && (
            <div>
              <div className="mb-1 text-xs uppercase tracking-wide text-bone-500">
                AI-gen suitability
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {data.aiGen.map((a, i) => (
                  <li
                    key={i}
                    className={`chip ${
                      a.suitable
                        ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
                        : "border-white/10 bg-white/[0.03] text-bone-400"
                    }`}
                    title={a.notes}
                  >
                    #{a.sceneId} {a.suitable ? "✓ AI-gen" : "✕ live"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/** Line-based before/after diff for reviewing a proposed fix. */
function diffLines(before: string, after: string) {
  const a = String(before ?? "").split("\n");
  const b = String(after ?? "").split("\n");
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < m) out.push({ type: "del", text: a[i++] });
  while (j < n) out.push({ type: "add", text: b[j++] });
  return out;
}

function FountainDiff({ before, after }: { before: string; after: string }) {
  const rows = diffLines(before, after);
  const [copied, setCopied] = useState(false);
  // Copy the diff exactly as shown: "+" for green (added), "-" for red
  // (removed), two spaces for unchanged lines.
  const copyDiff = async () => {
    const text = rows
      .map((r) => (r.type === "add" ? "+ " : r.type === "del" ? "- " : "  ") + r.text)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="relative">
      <button
        onClick={copyDiff}
        title="Copy this diff (+ added / - removed)"
        className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded border border-white/10 bg-black/60 px-1.5 py-0.5 text-[10px] text-bone-300 hover:bg-white/10"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy diff"}
      </button>
      <div className="max-h-72 overflow-auto rounded border border-white/10 bg-black/30 p-2 pr-16 font-mono text-[11px] leading-snug">
      {rows.map((r, i) => (
        <div
          key={i}
          className={
            r.type === "add"
              ? "bg-emerald-950/40 text-emerald-200"
              : r.type === "del"
              ? "bg-red-950/40 text-red-300"
              : "text-bone-400"
          }
        >
          <span className="select-none opacity-50">
            {r.type === "add" ? "+ " : r.type === "del" ? "- " : "  "}
          </span>
          {r.text || " "}
        </div>
      ))}
      </div>
    </div>
  );
}

type ContinuityIssue = {
  id: string;
  kind: "wardrobe" | "location" | "timeline" | "relationship" | "prop";
  severity: "info" | "warn" | "critical";
  scene_ids: string[];
  note: string;
  suggested_fix: string | null;
};

// Mechanical issue kinds whose fixes are usually safe detail-corrections.
const SAFE_KINDS = new Set(["wardrobe", "prop", "location", "timeline"]);

// Signals in the suggested fix / note that mean the fix would ADD content,
// move scenes, insert exposition, or change story / character meaning. Any of
// these forces "Needs your call" regardless of the mechanical kind — so we
// never offer a blind Quick fix for something that rewrites or invents story.
const NEEDS_CALL_RE =
  /\b(add|adds|adding|insert|inserts|inserting|introduce|introduces|establish|establishing|transition|transitional|beat|motivation|motivate|exposition|backstory|imply|implies|implication|escalat\w*|emotional|relationship|reorder|manipulat\w*|lied?)\b|\bread\b[^.]*\b(private|letter|note|message|face-down)\b|\bmove\b[^.]*\bscene\b|\bbelongs?\b[^.]*\bepisode\b|missing scene|next episode|character intent|story logic/i;

/**
 * "safe" → mechanical correction; Quick fix allowed.
 * "needs_call" → story/meaning decision; require a note or explicit confirm.
 */
function classifyIssue(issue: {
  kind: string;
  note: string;
  suggested_fix: string | null;
}): "safe" | "needs_call" {
  const text = `${issue.note} ${issue.suggested_fix ?? ""}`;
  if (NEEDS_CALL_RE.test(text)) return "needs_call";
  if (!SAFE_KINDS.has(issue.kind)) return "needs_call";
  return "safe";
}

/**
 * Pull scene numbers referenced anywhere in an issue's text (note + suggested
 * fix) — e.g. "scenes (9–13)", "scenes 13 and 14", "11–18", "#11". Lets the
 * timeline tool prefill the real suggested range, not just the header chips.
 */
function extractSceneRefs(text: string): number[] {
  const nums = new Set<number>();
  for (const m of (text ?? "").matchAll(
    /(?:scenes?|#)\s*#?\s*\(?\s*(\d{1,3}(?:\s*(?:[–—-]|,|and|&|to|through|#|\s)+\d{1,3})*)/gi
  )) {
    for (const d of m[1].matchAll(/\d{1,3}/g)) nums.add(parseInt(d[0], 10));
  }
  return [...nums].sort((a, b) => a - b);
}

type ProposalState = {
  status: "proposing" | "ready" | "applying" | "applied" | "error";
  data?: { before: string; after: string; summary: string; changed: boolean; slugline: string };
  error?: string;
};

/**
 * One continuity issue with guided fix controls. Fixes are PROPOSED (surgical
 * by default) and shown as a before/after diff; nothing is written until the
 * user accepts. Supports single- and multi-scene issues.
 */
function ContinuityIssueCard({
  scriptId,
  issue,
  ords,
  rows,
  onResolve,
  resolving,
  onIgnore,
  jumpToScene,
}: {
  scriptId: string;
  issue: ContinuityIssue;
  ords: number[];
  rows: SceneRow[];
  onResolve: (id: string) => void;
  resolving: boolean;
  onIgnore: (id: string) => void;
  jumpToScene: (ord: number) => void;
}) {
  const qc = useQueryClient();
  const noteText = issue.note.replace(/^\[scenes[^\]]+\]\s*/i, "");
  const isSafe = classifyIssue(issue) === "safe";
  const unlockedOrds = ords.filter(
    (o) => rows.find((r) => r.ord === o)?.status !== "locked"
  );
  const [showNote, setShowNote] = useState(false);
  const [instruction, setInstruction] = useState(issue.suggested_fix ?? "");
  const [proposals, setProposals] = useState<Record<number, ProposalState>>({});

  // "Mark resolved with note" — records the user's reasoning as approved intent.
  const [showResolveNote, setShowResolveNote] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolvingNote, setResolvingNote] = useState(false);
  const submitResolveNote = async () => {
    if (!resolveNote.trim()) return;
    setResolvingNote(true);
    try {
      await api.resolveIssueWithNote(issue.id, resolveNote.trim());
      qc.invalidateQueries({ queryKey: ["continuity-issues", scriptId] });
      qc.invalidateQueries({ queryKey: ["resolutions", scriptId] });
    } finally {
      setResolvingNote(false);
    }
  };

  // Timeline-range tool: apply day/time markers across one or more scene
  // ranges — heading-only, no prose rewrite. Prefill from scenes referenced in
  // the issue TEXT (falling back to the header chips), so an issue mentioning
  // "scenes 11–18" prefills 11–18.
  const refOrds = extractSceneRefs(`${issue.note} ${issue.suggested_fix ?? ""}`);
  const prefillOrds = refOrds.length ? refOrds : [...ords].sort((a, b) => a - b);
  const pFrom = prefillOrds[0] ?? 1;
  const pTo = prefillOrds[prefillOrds.length - 1] ?? pFrom;
  const [tlRanges, setTlRanges] = useState<
    Array<{ from: number; to: number; marker: string }>
  >([{ from: pFrom, to: pTo, marker: "" }]);
  const [tl, setTl] = useState<{
    status: "idle" | "running" | "done" | "error";
    data?: {
      updated: { ord: number; before: string; after: string; marker: string }[];
      skippedLocked: number[];
    };
    error?: string;
  }>({ status: "idle" });
  const setRange = (i: number, patch: Partial<{ from: number; to: number; marker: string }>) =>
    setTlRanges((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRange = () =>
    setTlRanges((rs) => {
      const last = rs[rs.length - 1];
      const next = (last?.to ?? pTo) + 1;
      return [...rs, { from: next, to: next, marker: "" }];
    });
  const removeRange = (i: number) =>
    setTlRanges((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs));
  const runTimeline = async () => {
    const valid = tlRanges
      .filter((r) => r.marker.trim())
      .map((r) => ({ from: r.from, to: r.to, marker: r.marker.trim() }));
    if (!valid.length) return;
    setTl({ status: "running" });
    try {
      const data = await api.applyTimelineRanges(scriptId, valid);
      setTl({ status: "done", data });
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
    } catch (e) {
      setTl({ status: "error", error: (e as Error).message });
    }
  };

  // "Fix with note" mode selector. Defaults by issue kind: timeline → range,
  // location → metadata-only, story-meaning → issue-level note, else one scene.
  type FixMode = "one" | "selected" | "timeline" | "metadata" | "issue";
  const defaultFixMode: FixMode =
    issue.kind === "timeline"
      ? "timeline"
      : issue.kind === "location"
      ? "metadata"
      : !isSafe
      ? "issue"
      : "one";
  const [fixMode, setFixMode] = useState<FixMode>(defaultFixMode);
  const [oneOrd, setOneOrd] = useState<number>(unlockedOrds[0] ?? ords[0] ?? 0);
  const [selectedOrds, setSelectedOrds] = useState<Set<number>>(new Set(unlockedOrds));
  const [manualOrds, setManualOrds] = useState("");
  const toggleSelected = (o: number) =>
    setSelectedOrds((s) => {
      const n = new Set(s);
      n.has(o) ? n.delete(o) : n.add(o);
      return n;
    });
  const selectedForFix = (): number[] => {
    const manual = manualOrds
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => !isNaN(n));
    return [...new Set([...selectedOrds, ...manual])].sort((a, b) => a - b);
  };
  const META_PREFIX =
    "METADATA ONLY — change ONLY the scene heading/slugline (location, time of day, or day label). Do NOT change any dialogue, action, or other prose. ";

  const sev = issue.severity;
  const border =
    sev === "critical"
      ? "border-red-800/60 bg-red-950/20"
      : sev === "warn"
      ? "border-amber-800/60 bg-amber-950/20"
      : "border-white/8 bg-white/[0.02]";
  const kindIcon =
    ({ wardrobe: "👕", location: "📍", timeline: "🕒", relationship: "👥", prop: "🎯" } as Record<string, string>)[
      issue.kind
    ] ?? "•";

  const setProp = (ord: number, s: ProposalState) =>
    setProposals((p) => ({ ...p, [ord]: s }));

  // Propose a fix for the given scenes (skips locked). Shows a "proposing…"
  // state immediately so the click always gives visible feedback.
  async function propose(instr: string, targetOrds: number[]) {
    const text = instr.trim();
    const targets = targetOrds.filter(
      (o) => rows.find((r) => r.ord === o)?.status !== "locked"
    );
    if (!text || targets.length === 0) return;
    for (const ord of targets) {
      setProp(ord, { status: "proposing" });
      try {
        const data = await api.proposeSceneFix(scriptId, ord, text);
        setProp(ord, { status: "ready", data });
      } catch (e) {
        setProp(ord, { status: "error", error: (e as Error).message });
      }
    }
  }

  async function accept(ord: number) {
    const prop = proposals[ord];
    if (!prop?.data) return;
    setProp(ord, { ...prop, status: "applying" });
    try {
      await api.applySceneFix(scriptId, ord, prop.data.after, instruction.trim() || undefined);
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      setProp(ord, { ...prop, status: "applied" });
    } catch (e) {
      setProp(ord, { ...prop, status: "error", error: (e as Error).message });
    }
  }

  const clearProp = (ord: number) =>
    setProposals((p) => {
      const next = { ...p };
      delete next[ord];
      return next;
    });

  const quickInstruction =
    issue.suggested_fix?.trim() ||
    `Correct this ${issue.kind} continuity issue. Change only the specific detail involved — do not rewrite the scene: ${noteText}`;

  const anyProposal = Object.keys(proposals).length > 0;

  return (
    <li className={`rounded-md border p-2 ${border}`}>
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <span className="font-mono text-bone-500">
          {kindIcon} {issue.kind}
        </span>
        <span
          className={`chip ${
            sev === "critical"
              ? "border-red-700/60 bg-red-950/40 text-red-200"
              : sev === "warn"
              ? "border-amber-700/50 bg-amber-900/30 text-amber-200"
              : "border-sky-700/50 bg-sky-900/30 text-sky-200"
          }`}
        >
          {sev}
        </span>
        <span
          className={`chip text-[10px] ${
            isSafe
              ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-200"
              : "border-violet-700/40 bg-violet-950/30 text-violet-200"
          }`}
        >
          {isSafe ? "Safe technical fix" : "Needs your call"}
        </span>
        {ords.length > 0 && (
          <span className="ml-auto text-[10px] text-bone-500">
            scene{ords.length > 1 ? "s" : ""} {ords.map((o) => `#${o}`).join(", ")}
          </span>
        )}
      </div>

      <div className="mt-1 text-bone-100">{noteText}</div>
      {issue.suggested_fix && (
        <div className="mt-1 text-xs text-bone-300">
          <span className="text-bone-500">Suggested fix:</span> {issue.suggested_fix}
        </div>
      )}

      {/* Action row — every fix button proposes immediately (shows a diff to
          review before anything is written). */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {isSafe && (
          <button
            onClick={() => propose(quickInstruction, unlockedOrds)}
            disabled={unlockedOrds.length === 0}
            className="flex items-center gap-1 rounded-md border border-ember-700/60 bg-ember-900/30 px-2 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-50"
            title="Propose a minimal, surgical fix for review"
          >
            <RefreshCcw className="h-3 w-3" />
            {ords.length > 1 ? "Quick fix — all scenes" : "Quick fix"}
          </button>
        )}
        {!isSafe && issue.suggested_fix && (
          <button
            onClick={() => propose(issue.suggested_fix!, unlockedOrds)}
            disabled={unlockedOrds.length === 0}
            className="flex items-center gap-1 rounded-md border border-ember-700/60 bg-ember-900/30 px-2 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-50"
          >
            <ShieldCheck className="h-3 w-3" />
            {ords.length > 1 ? "Confirm suggested — all scenes" : "Confirm suggested fix"}
          </button>
        )}
        <button
          onClick={() => setShowNote((v) => !v)}
          className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-bone-200 hover:bg-white/[0.08]"
        >
          Fix with note
        </button>
        <button
          onClick={() => onResolve(issue.id)}
          disabled={resolving}
          className="rounded-md border border-emerald-700/50 bg-emerald-900/20 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-50"
        >
          Mark resolved
        </button>
        <button
          onClick={() => setShowResolveNote((v) => !v)}
          className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-2 py-1 text-xs text-emerald-200/90 hover:bg-emerald-900/30"
          title="Resolve and record why this is intentional — future checks won't re-flag it"
        >
          Mark resolved with note
        </button>
        <button
          onClick={() => onIgnore(issue.id)}
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-400 hover:bg-white/[0.04]"
        >
          Ignore for now
        </button>
        {ords.length > 0 && (
          <button
            onClick={() => jumpToScene(ords[0])}
            className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-bone-300 hover:bg-white/[0.08]"
          >
            Jump to #{ords[0]}
          </button>
        )}
      </div>

      {/* Mark resolved with note */}
      {showResolveNote && (
        <div className="mt-2 space-y-2 rounded-md border border-emerald-800/40 bg-emerald-950/15 p-2">
          <div className="text-[11px] text-emerald-200/80">
            Explain why this is intentional or acceptable. It's saved as
            approved intent — future checks won't re-flag it.
          </div>
          <textarea
            className="input min-h-[64px] w-full text-xs"
            placeholder="e.g. This is intentional escalation, not duplication. Scene 8 is avoidance; scene 14 is the one-second voicemail contact. The repeated setup is deliberate."
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={submitResolveNote}
              disabled={!resolveNote.trim() || resolvingNote}
              className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
            >
              {resolvingNote && <Loader2 className="h-3 w-3 animate-spin" />}
              Save &amp; resolve
            </button>
            <button
              onClick={() => setShowResolveNote(false)}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-400 hover:bg-white/[0.04]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Fix with note — mode selector */}
      {showNote && (
        <div className="mt-2 space-y-2 rounded-md border border-white/10 bg-white/[0.02] p-2">
          <div className="flex flex-wrap gap-1 text-[11px]">
            {(
              [
                ["one", "One scene"],
                ["selected", "Selected scenes"],
                ["timeline", "Timeline range"],
                ["metadata", "Metadata only"],
                ["issue", "Issue-level note"],
              ] as [FixMode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setFixMode(m)}
                className={`rounded border px-2 py-0.5 ${
                  fixMode === m
                    ? "border-ember-600/70 bg-ember-900/30 text-ember-100"
                    : "border-white/10 text-bone-300 hover:bg-white/[0.04]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {fixMode === "one" && (
            <div className="space-y-2">
              {unlockedOrds.length > 0 ? (
                <label className="flex items-center gap-2 text-xs">
                  <span className="text-bone-500">Scene</span>
                  <select
                    value={oneOrd}
                    onChange={(e) => setOneOrd(parseInt(e.target.value, 10))}
                    className="input w-28"
                  >
                    {unlockedOrds.map((o) => (
                      <option key={o} value={o}>
                        #{o}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="text-[11px] text-amber-300">
                  No unlocked scene linked — use “Selected scenes” to type a scene number.
                </div>
              )}
              <textarea
                className="input min-h-[56px] w-full text-xs"
                placeholder="How should this scene be fixed? (only what you ask changes)"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <button
                onClick={() => propose(instruction, [oneOrd])}
                disabled={!instruction.trim() || !oneOrd}
                className="flex items-center gap-1 rounded-md border border-ember-700/60 bg-ember-900/30 px-3 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-50"
              >
                <RefreshCcw className="h-3 w-3" /> Propose fix
              </button>
            </div>
          )}

          {(fixMode === "selected" || fixMode === "metadata") && (
            <div className="space-y-2">
              {fixMode === "metadata" && (
                <div className="text-[11px] text-bone-500">
                  Updates the scene heading/slugline (location · time · day) only —
                  never the prose.
                </div>
              )}
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="text-bone-500">Scenes:</span>
                {unlockedOrds.map((o) => (
                  <label
                    key={o}
                    className={`cursor-pointer rounded border px-2 py-0.5 ${
                      selectedOrds.has(o)
                        ? "border-ember-600/70 bg-ember-900/30 text-ember-100"
                        : "border-white/10 text-bone-300 hover:bg-white/[0.04]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mr-1 align-middle"
                      checked={selectedOrds.has(o)}
                      onChange={() => toggleSelected(o)}
                    />
                    #{o}
                  </label>
                ))}
              </div>
              <input
                type="text"
                className="input w-full text-xs"
                placeholder="Or add scene numbers, comma-separated — e.g. 6, 7, 8"
                value={manualOrds}
                onChange={(e) => setManualOrds(e.target.value)}
              />
              <textarea
                className="input min-h-[56px] w-full text-xs"
                placeholder={
                  fixMode === "metadata"
                    ? "e.g. change the location to Solano's private office"
                    : "How should these scenes be fixed?"
                }
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
              <button
                onClick={() =>
                  propose(
                    fixMode === "metadata" ? META_PREFIX + instruction : instruction,
                    selectedForFix()
                  )
                }
                disabled={!instruction.trim() || selectedForFix().length === 0}
                className="flex items-center gap-1 rounded-md border border-ember-700/60 bg-ember-900/30 px-3 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-50"
              >
                <RefreshCcw className="h-3 w-3" />
                {fixMode === "metadata" ? "Propose metadata fix" : "Propose fix"} —{" "}
                {selectedForFix().length} scene
                {selectedForFix().length === 1 ? "" : "s"}
              </button>
            </div>
          )}

          {fixMode === "issue" && (
            <div className="space-y-2">
              <div className="text-[11px] text-bone-500">
                Give the checker direction without selecting a scene. It's saved
                as approved intent and the issue is resolved.
              </div>
              <textarea
                className="input min-h-[56px] w-full text-xs"
                placeholder="e.g. Do not change Scene 8. Treat scenes 6–8 as Day One and 9–10 as Day Two."
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
              />
              <button
                onClick={submitResolveNote}
                disabled={!resolveNote.trim() || resolvingNote}
                className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-950/30 px-3 py-1 text-xs text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
              >
                {resolvingNote && <Loader2 className="h-3 w-3 animate-spin" />}
                Save instruction &amp; resolve
              </button>
            </div>
          )}
        </div>
      )}

      {/* Timeline-range marker tool (Fix with note → Timeline range mode) */}
      {showNote && fixMode === "timeline" && (
        <div className="mt-2 space-y-2 rounded-md border border-sky-800/40 bg-sky-950/15 p-2">
          <div className="text-[11px] text-sky-200/80">
            Stamp day/time markers across one or more scene ranges. This edits
            only the scene headings (e.g. adds{" "}
            <span className="font-mono">(DAY TWO)</span>) — no prose is rewritten.
          </div>
          {tlRanges.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 text-xs">
              <label className="flex flex-col gap-0.5">
                <span className="text-bone-500">From scene</span>
                <input
                  type="number"
                  min={1}
                  value={r.from}
                  onChange={(e) => setRange(i, { from: parseInt(e.target.value || "1", 10) })}
                  className="input w-20"
                />
              </label>
              <label className="flex flex-col gap-0.5">
                <span className="text-bone-500">To scene</span>
                <input
                  type="number"
                  min={1}
                  value={r.to}
                  onChange={(e) => setRange(i, { to: parseInt(e.target.value || "1", 10) })}
                  className="input w-20"
                />
              </label>
              <label className="flex flex-1 flex-col gap-0.5">
                <span className="text-bone-500">Marker</span>
                <input
                  type="text"
                  placeholder="e.g. DAY TWO  ·  DAWN / DAY THREE"
                  value={r.marker}
                  onChange={(e) => setRange(i, { marker: e.target.value })}
                  className="input w-full"
                />
              </label>
              {tlRanges.length > 1 && (
                <button
                  onClick={() => removeRange(i)}
                  title="Remove this range"
                  className="rounded-md border border-white/10 px-2 py-1.5 text-bone-400 hover:bg-white/[0.04]"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={addRange}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-300 hover:bg-white/[0.04]"
            >
              + Add another range
            </button>
            <button
              onClick={runTimeline}
              disabled={!tlRanges.some((r) => r.marker.trim()) || tl.status === "running"}
              className="flex items-center gap-1 rounded-md border border-sky-600/60 bg-sky-900/30 px-3 py-1.5 text-xs text-sky-100 hover:bg-sky-900/50 disabled:opacity-50"
            >
              {tl.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
              Apply markers
            </button>
          </div>
          {tl.status === "error" && (
            <div className="text-xs text-red-300">{tl.error}</div>
          )}
          {tl.status === "done" && tl.data && (
            <div className="text-xs text-sky-100">
              {tl.data.updated.length === 0 ? (
                <span>No scenes changed in those ranges.</span>
              ) : (
                <>
                  <div className="text-sky-200">
                    Stamped {tl.data.updated.length} scene
                    {tl.data.updated.length === 1 ? "" : "s"}:
                  </div>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                    {tl.data.updated.map((u) => (
                      <li key={u.ord}>
                        #{u.ord}: {u.after}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tl.data.skippedLocked.length > 0 && (
                <div className="mt-1 text-amber-300">
                  Skipped locked scenes: {tl.data.skippedLocked.map((o) => `#${o}`).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isSafe && !showNote && !anyProposal && (
        <div className="mt-1 text-[10px] text-violet-300/80">
          This one's a story/meaning decision — it would add or change content,
          so there's no blind Quick fix. Add a note with your direction, or
          confirm the suggested fix.
        </div>
      )}

      {ords.length === 0 && (
        <div className="mt-2 text-[10px] text-amber-300">
          This issue isn't linked to a specific scene. Open the scene from the
          grid and fix it there, or mark it resolved.
        </div>
      )}
      {ords.length > 0 && unlockedOrds.length === 0 && (
        <div className="mt-2 text-[10px] text-amber-300">
          All affected scenes are locked — unlock them to apply a fix.
        </div>
      )}

      {/* Proposal review (before/after diff per scene) — covers any proposed
          scene, including manually-added ones outside this issue's ords. */}
      {Object.keys(proposals)
        .map(Number)
        .sort((a, b) => a - b)
        .map((ord) => {
        const prop = proposals[ord];
        if (!prop) return null;
        return (
          <div key={ord} className="mt-3 rounded-md border border-white/10 bg-white/[0.02] p-2">
            <div className="mb-1 flex items-center gap-2 text-xs">
              <span className="font-mono text-bone-400">Scene #{ord}</span>
              {prop.status === "proposing" && (
                <span className="flex items-center gap-1 text-bone-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> proposing…
                </span>
              )}
              {prop.data && prop.status !== "proposing" && (
                <span className="text-bone-500">{prop.data.summary}</span>
              )}
              {prop.status === "applied" && (
                <span className="text-emerald-300">✓ applied — re-run the check to confirm</span>
              )}
            </div>

            {prop.status === "error" && (
              <div className="text-xs text-red-300">{prop.error}</div>
            )}

            {prop.data && prop.status !== "proposing" && (
              <>
                {prop.data.changed ? (
                  <FountainDiff before={prop.data.before} after={prop.data.after} />
                ) : (
                  <div className="text-xs text-bone-400">
                    No change needed — the scene already satisfies this.
                  </div>
                )}
                {prop.status !== "applied" && prop.data.changed && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <button
                      onClick={() => accept(ord)}
                      disabled={prop.status === "applying"}
                      className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
                    >
                      {prop.status === "applying" && <Loader2 className="h-3 w-3 animate-spin" />}
                      Accept
                    </button>
                    <button
                      onClick={() => {
                        clearProp(ord);
                        setShowNote(true);
                      }}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-300 hover:bg-white/[0.04]"
                    >
                      Edit Fix Instructions
                    </button>
                    <button
                      onClick={() => clearProp(ord)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-400 hover:bg-white/[0.04]"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </li>
  );
}

function ContinuityPanel({
  scriptId,
  ready,
}: {
  scriptId: string;
  ready: boolean;
}) {
  const qc = useQueryClient();
  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
  });
  const existing = useQuery({
    queryKey: ["continuity-issues", scriptId],
    queryFn: () => api.listContinuityIssues(scriptId),
  });
  const resolutions = useQuery({
    queryKey: ["resolutions", scriptId],
    queryFn: () => api.listResolutions(scriptId),
  });
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"strict" | "standard" | "supervisor">("strict");
  const run = useMutation({
    mutationKey: ["pass:continuity", scriptId],
    mutationFn: () => api.runContinuityPass(scriptId, notes.trim() || undefined, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["continuity-issues", scriptId] });
      qc.invalidateQueries({ queryKey: ["resolutions", scriptId] });
    },
  });
  const resolve = useMutation({
    mutationFn: (issueId: string) => api.resolveContinuityIssue(issueId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["continuity-issues", scriptId] }),
  });
  // Issues the user chose to "ignore for now" (client-side; cleared on reload).
  const [ignored, setIgnored] = useState<Set<string>>(new Set());

  const open = (existing.data ?? []).filter(
    (i) => !i.resolved && !ignored.has(i.id)
  );
  const resolved = (existing.data ?? []).filter((i) => i.resolved);
  const counts = {
    critical: open.filter((i) => i.severity === "critical").length,
    warn: open.filter((i) => i.severity === "warn").length,
    info: open.filter((i) => i.severity === "info").length,
  };

  const resolveOrds = (issue: { scene_ids?: string[]; note: string }): number[] => {
    const rows = sceneRows.data ?? [];
    const matched = (issue.scene_ids ?? [])
      .map((s) => resolveSceneOrd(s, undefined, rows))
      .filter((n): n is number => n != null);
    if (matched.length > 0) return matched;
    const m = issue.note.match(/^\[scenes\s+([\d, ]+)\]/i);
    return m
      ? m[1].split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && rows.some((r) => r.ord === n))
      : [];
  };

  return (
    <Panel eyebrow="Consistency" title="Story Consistency Check">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <div className="flex-1 text-xs text-bone-400">
          Checks timeline, character names, locations, props, relationships, and
          scene-to-scene continuity.
          {!ready && (
            <span className="ml-2 text-amber-300">
              — write at least one scene first
            </span>
          )}
        </div>
        <label className="flex flex-col gap-0.5 text-xs">
          <span className="text-bone-500">Check depth</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
            className="input w-56"
          >
            <option value="strict">Strict final — contradictions only</option>
            <option value="standard">Standard — contradictions + warnings</option>
            <option value="supervisor">Script supervisor — everything</option>
          </select>
        </label>
        <Button onClick={() => run.mutate()} disabled={!ready || run.isPending}>
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {run.isPending ? "Checking…" : "Run Story Consistency Check"}
        </Button>
      </div>
      <div className="mt-1 text-[11px] text-bone-500">
        {mode === "strict"
          ? "Strict final: only direct self-contradictions (wrong name, conflicting display, impossible timeline, prop/location logic breaks)."
          : mode === "standard"
          ? "Standard: contradictions plus continuity warnings (unclear elapsed time, unshown prop moves, missing day markers)."
          : "Script supervisor: everything, including watchlist items (repeated motifs, intentional-looking setups, minor logistics)."}
      </div>
      <CheckNotesField
        value={notes}
        onChange={setNotes}
        disabled={run.isPending}
        placeholder="e.g. Pay special attention to character ages, Lily voicemail continuity, day/night timeline, and old name drift."
      />

      {run.isPending && (
        <div className="mt-3">
          <BusyBar
            label="Continuity scanning the draft"
            subtext="Checking your draft for story-consistency problems. About a minute."
          />
        </div>
      )}
      {run.error && (
        <div className="mt-3 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(run.error as Error).message}
        </div>
      )}
      {run.data && typeof run.data.discarded === "number" && (
        <div className="mt-3 rounded border border-emerald-800/40 bg-emerald-950/20 p-2 text-xs text-emerald-200">
          Grounding guardrail:{" "}
          <strong>{run.data.grounded ?? run.data.issues.length} confirmed</strong>
          {run.data.discarded > 0 && (
            <>
              {" "}· {run.data.discarded} discarded as ungrounded (cited text
              not found literally in the draft)
            </>
          )}
          . Only issues with verbatim evidence from the current draft are kept.
        </div>
      )}

      {run.data?.metadataSynced && run.data.metadataSynced.length > 0 && (
        <div className="mt-3 rounded border border-sky-800/40 bg-sky-950/20 p-2 text-xs text-sky-200">
          <div className="font-medium">
            Metadata/body mismatch fixed ({run.data.metadataSynced.length})
          </div>
          <div className="mt-0.5 text-sky-200/80">
            These scenes had a stored heading that didn't match the slugline in
            the scene body. The stored heading was re-synced to the body — no
            scene was rewritten.
          </div>
          <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-sky-100">
            {run.data.metadataSynced.map((m) => (
              <li key={m.ord}>
                #{m.ord}: “{m.from || "(empty)"}” → “{m.to}”
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!run.data?.suppressedByApproval && run.data.suppressedByApproval > 0 && (
        <div className="mt-3 rounded border border-emerald-800/40 bg-emerald-950/15 p-2 text-xs text-emerald-200">
          {run.data.suppressedByApproval} issue
          {run.data.suppressedByApproval === 1 ? "" : "s"} you previously marked
          resolved-with-note were treated as approved intent and not re-flagged.
          See "Resolved by user" below.
        </div>
      )}

      {(existing.data?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-bone-500">Open issues:</span>
          <CountChip count={counts.critical} severity="critical" label="critical" />
          <CountChip count={counts.warn} severity="warn" label="warn" />
          <CountChip count={counts.info} severity="info" label="info" />
          {resolved.length > 0 && (
            <CountChip count={resolved.length} severity="resolved" label="resolved" />
          )}
        </div>
      )}

      {open.length > 0 && (
        <div className="mt-3 text-[11px] text-bone-500">
          Each issue below has its own guided fix — preview the change before
          anything is written. Technical issues offer a Quick fix; creative
          notes ask for your direction first.
        </div>
      )}

      {existing.isLoading ? (
        <div className="mt-3 h-12 animate-pulse-soft rounded bg-white/[0.03]" />
      ) : open.length === 0 ? (
        <div className="mt-3 text-xs text-bone-400">
          {existing.data && existing.data.length === 0
            ? "No continuity issues yet. Run the pass to scan the draft."
            : "All open issues have been resolved. Run again to scan for new ones."}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {open.map((d) => (
            <ContinuityIssueCard
              key={d.id}
              scriptId={scriptId}
              issue={d}
              ords={resolveOrds(d)}
              rows={sceneRows.data ?? []}
              onResolve={(id) => resolve.mutate(id)}
              resolving={resolve.isPending}
              onIgnore={(id) =>
                setIgnored((prev) => new Set(prev).add(id))
              }
              jumpToScene={jumpToScene}
            />
          ))}
        </ul>
      )}

      {/* Resolved by user — approved intents, dismissed with reasoning. */}
      {(resolutions.data?.length ?? 0) > 0 && (
        <details className="mt-4 rounded-md border border-emerald-800/30 bg-emerald-950/10 p-2">
          <summary className="cursor-pointer text-xs text-emerald-200/90">
            Resolved by user ({resolutions.data!.length}) — dismissed as
            intentional; not re-flagged
          </summary>
          <ul className="mt-2 space-y-2">
            {resolutions.data!.map((r) => (
              <li
                key={r.id}
                className="rounded border border-white/8 bg-white/[0.02] p-2 text-xs"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-bone-500">{r.continuityKind}</span>
                  {r.sceneOrds.length > 0 && (
                    <span className="text-bone-500">
                      scenes {r.sceneOrds.map((o) => `#${o}`).join(", ")}
                    </span>
                  )}
                </div>
                {r.issueNote && (
                  <div className="mt-0.5 text-bone-400">{r.issueNote}</div>
                )}
                <div className="mt-1 border-l-2 border-emerald-700/40 pl-2 text-emerald-100/90">
                  {r.rationale}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function SceneRowView({ scriptId, scene }: { scriptId: string; scene: SceneRow }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showDoctorNote, setShowDoctorNote] = useState(false);
  // Notes accumulate one line per fix applied: "Script Doctor […]",
  // "Continuity […]", "Emotional Truth […]". Show the chip if any agent fix
  // is recorded, and how many.
  const fixNotes =
    typeof scene.notes === "string"
      ? scene.notes
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => /^(Script Doctor|Continuity|Emotional Truth)\b/i.test(l))
      : [];
  const doctorFix = fixNotes.length > 0 ? scene.notes! : null;
  const fixCount = fixNotes.length;

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });

  const generate = useMutation({
    mutationKey: ["scene-op", scriptId],
    mutationFn: () => api.generateScene(scriptId, scene.ord),
    onSuccess: invalidate,
  });
  const regenerate = useMutation({
    mutationKey: ["scene-op", scriptId],
    mutationFn: () => api.regenerateScene(scriptId, scene.ord),
    onSuccess: invalidate,
  });
  const lock = useMutation({
    mutationFn: () =>
      scene.status === "locked"
        ? api.unlockScene(scriptId, scene.ord)
        : api.lockScene(scriptId, scene.ord),
    onSuccess: invalidate,
  });

  // "Fix with note" — guided edit on ANY scene (even ones the checks missed).
  // Surgical by default; previews a before/after diff before anything saves.
  const [showFix, setShowFix] = useState(false);
  const [fixNote, setFixNote] = useState("");
  const [fixProp, setFixProp] = useState<ProposalState | null>(null);
  const proposeFix = async () => {
    const text = fixNote.trim();
    if (!text) return;
    setFixProp({ status: "proposing" });
    try {
      const data = await api.proposeSceneFix(scriptId, scene.ord, text);
      setFixProp({ status: "ready", data });
    } catch (e) {
      setFixProp({ status: "error", error: (e as Error).message });
    }
  };
  const acceptFix = async () => {
    if (!fixProp?.data) return;
    setFixProp({ ...fixProp, status: "applying" });
    try {
      await api.applySceneFix(scriptId, scene.ord, fixProp.data.after, fixNote.trim() || undefined);
      invalidate();
      setFixProp({ ...fixProp, status: "applied" });
    } catch (e) {
      setFixProp({ ...fixProp, status: "error", error: (e as Error).message });
    }
  };

  const busy =
    scene.status === "generating" ||
    generate.isPending ||
    regenerate.isPending ||
    lock.isPending ||
    fixProp?.status === "proposing" ||
    fixProp?.status === "applying";

  const statusChip = (() => {
    switch (scene.status) {
      case "pending":
        return <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-200">pending</span>;
      case "generating":
        return (
          <span className="chip border-ember-700/60 bg-ember-900/40 text-ember-100">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            generating
          </span>
        );
      case "generated":
        return <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-200">generated</span>;
      case "revised":
        return <span className="chip border-sky-700/50 bg-sky-900/30 text-sky-200">revised</span>;
      case "locked":
        return <span className="chip border-yellow-700/60 bg-yellow-900/40 text-yellow-200">locked</span>;
    }
  })();

  const words = (scene.fountain ?? "").split(/\s+/).filter(Boolean).length;

  return (
    <li
      id={`scene-row-${scene.ord}`}
      className="rounded-md border border-white/8 bg-white/[0.02] transition-shadow"
    >
      <div className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-xs text-bone-500 w-8">#{scene.ord}</span>
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="truncate font-mono text-xs text-bone-100">
            {scene.slugline}
          </div>
          <div className="mt-0.5 text-[10px] text-bone-500">
            {(scene.tags ?? []).join(", ") || "no characters tagged"} · {words.toLocaleString()} words
            {scene.last_pass ? ` · last pass: ${scene.last_pass}` : ""}
          </div>
        </button>
        {doctorFix && (
          <button
            onClick={() => setShowDoctorNote((v) => !v)}
            title="Agent fixes applied to this scene. Click to view the notes that drove them."
            className="flex items-center gap-1 rounded-full border border-ember-700/60 bg-ember-900/30 px-2 py-0.5 text-[10px] text-ember-100 hover:bg-ember-900/50"
          >
            <Stethoscope className="h-3 w-3" />
            {fixCount > 1 ? `${fixCount} fixes` : "fixed"}
            {showDoctorNote ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
        {statusChip}
        <div className="flex items-center gap-1">
          {scene.status === "pending" ? (
            <Button
              variant="outline"
              onClick={() => generate.mutate()}
              disabled={busy}
            >
              {generate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )}
              Generate
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => regenerate.mutate()}
              disabled={busy || scene.status === "locked"}
              title={
                scene.status === "locked"
                  ? "Unlock the scene before regenerating"
                  : "Regenerate this scene (snapshots current to history)"
              }
            >
              {regenerate.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="h-3.5 w-3.5" />
              )}
              Regenerate
            </Button>
          )}
          {scene.status !== "pending" && (
            <Button
              variant="outline"
              onClick={() => setShowFix((v) => !v)}
              disabled={busy || scene.status === "locked"}
              title={
                scene.status === "locked"
                  ? "Unlock the scene before fixing"
                  : "Direct a change to this scene and preview it before saving"
              }
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Fix with note
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => lock.mutate()}
            disabled={busy}
            title={scene.status === "locked" ? "Unlock" : "Lock this scene"}
          >
            {scene.status === "locked" ? (
              <Unlock className="h-3.5 w-3.5" />
            ) : (
              <Lock className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowVersions((v) => !v)}
            title="View version history"
          >
            <History className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {(generate.error || regenerate.error || lock.error) && (
        <div className="border-t border-white/5 p-2 text-xs text-red-300">
          {((generate.error || regenerate.error || lock.error) as Error).message}
        </div>
      )}

      {showFix && (
        <div className="space-y-2 border-t border-white/5 p-3">
          <textarea
            className="input min-h-[64px] w-full text-xs"
            placeholder="Describe the change you want — e.g. tighten the dialogue, raise the tension, fix a detail the checker missed. Only what you ask for changes (say 'rewrite the scene' if you want a fuller pass)."
            value={fixNote}
            onChange={(e) => setFixNote(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={proposeFix}
              disabled={!fixNote.trim() || fixProp?.status === "proposing"}
              className="flex items-center gap-1 rounded-md border border-ember-700/60 bg-ember-900/30 px-3 py-1 text-xs text-ember-100 hover:bg-ember-900/50 disabled:opacity-50"
            >
              {fixProp?.status === "proposing" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw className="h-3 w-3" />
              )}
              {fixProp?.status === "proposing" ? "Proposing…" : "Propose fix"}
            </button>
            <button
              onClick={() => {
                setShowFix(false);
                setFixProp(null);
              }}
              className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-400 hover:bg-white/[0.04]"
            >
              Close
            </button>
          </div>

          {fixProp?.status === "error" && (
            <div className="text-xs text-red-300">{fixProp.error}</div>
          )}

          {fixProp?.data && fixProp.status !== "proposing" && (
            <div className="space-y-2">
              <div className="text-xs text-bone-500">{fixProp.data.summary}</div>
              {fixProp.data.changed ? (
                <FountainDiff before={fixProp.data.before} after={fixProp.data.after} />
              ) : (
                <div className="text-xs text-bone-400">
                  No change — the scene already satisfies this.
                </div>
              )}
              {fixProp.status === "applied" ? (
                <div className="text-xs text-emerald-300">✓ Applied.</div>
              ) : (
                fixProp.data.changed && (
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      onClick={acceptFix}
                      disabled={fixProp.status === "applying"}
                      className="flex items-center gap-1 rounded-md border border-emerald-600/60 bg-emerald-950/30 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
                    >
                      {fixProp.status === "applying" && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      Accept
                    </button>
                    <button
                      onClick={() => setFixProp(null)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-300 hover:bg-white/[0.04]"
                    >
                      Edit Fix Instructions
                    </button>
                    <button
                      onClick={() => setFixProp(null)}
                      className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-400 hover:bg-white/[0.04]"
                    >
                      Reject
                    </button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}

      {doctorFix && showDoctorNote && (
        <div className="border-t border-white/5 bg-ember-950/15 p-3 text-xs">
          <div className="mb-1 flex items-center gap-1 text-ember-200">
            <Stethoscope className="h-3 w-3" />
            <span className="uppercase tracking-wide">
              Fixes applied to this scene
            </span>
          </div>
          <ul className="space-y-1 text-bone-200">
            {fixNotes.map((n, i) => (
              <li key={i} className="border-l-2 border-ember-700/40 pl-2">
                {n}
              </li>
            ))}
          </ul>
          {scene.generated_at && (
            <div className="mt-1 text-bone-500">
              Last applied {new Date(scene.generated_at).toLocaleString()}
            </div>
          )}
        </div>
      )}

      {showVersions && (
        <VersionList
          scriptId={scriptId}
          ord={scene.ord}
          locked={scene.status === "locked"}
          onClose={() => setShowVersions(false)}
        />
      )}

      {expanded && scene.fountain && (
        <div className="border-t border-white/5 p-3">
          <ScenePreview fountain={scene.fountain} />
        </div>
      )}
      {expanded && !scene.fountain && (
        <div className="border-t border-white/5 p-3 text-xs text-bone-500">
          (not written yet — click Generate)
        </div>
      )}
    </li>
  );
}

function VersionList({
  scriptId,
  ord,
  locked,
  onClose,
}: {
  scriptId: string;
  ord: number;
  locked: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const versions = useQuery({
    queryKey: ["scene-versions", scriptId, ord],
    queryFn: () => api.listSceneVersions(scriptId, ord),
  });
  const restore = useMutation({
    mutationFn: (versionId: string) =>
      api.restoreSceneVersion(scriptId, ord, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scene-rows", scriptId] });
      qc.invalidateQueries({ queryKey: ["scene-versions", scriptId, ord] });
      onClose();
    },
  });
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const data = versions.data ?? [];

  return (
    <div className="border-t border-white/5 bg-black/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-bone-500">
          Version history ({data.length})
        </div>
        <button className="text-xs text-bone-400 hover:text-bone-200" onClick={onClose}>
          Close
        </button>
      </div>
      {versions.isLoading ? (
        <div className="h-12 animate-pulse-soft rounded bg-white/[0.03]" />
      ) : data.length === 0 ? (
        <div className="text-xs text-bone-500">
          No prior versions yet. The first version is created when you regenerate.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {data.map((v, i) => (
            <li key={v.id} className="rounded border border-white/8 bg-white/[0.02]">
              <div className="flex flex-wrap items-center gap-2 p-2 text-xs">
                <span className="text-bone-500">v{data.length - i}</span>
                <span className="text-bone-300">
                  {new Date(v.created_at).toLocaleString()}
                </span>
                {v.last_pass && (
                  <span className="chip">{v.last_pass}</span>
                )}
                <span className="text-bone-500">
                  {v.fountain.length.toLocaleString()} chars
                </span>
                {v.notes && (
                  <span className="text-bone-500 truncate">— {v.notes}</span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    className="rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.04]"
                    onClick={() => setPreviewIdx(previewIdx === i ? null : i)}
                  >
                    {previewIdx === i ? "Hide" : "Preview"}
                  </button>
                  <button
                    className="rounded border border-emerald-700/50 px-2 py-0.5 text-emerald-200 hover:bg-emerald-950/40 disabled:opacity-50"
                    onClick={() => restore.mutate(v.id)}
                    disabled={restore.isPending || locked}
                    title={locked ? "Unlock the scene first to restore a version" : "Restore this version as current"}
                  >
                    {restore.isPending ? "Restoring…" : "Restore"}
                  </button>
                </div>
              </div>
              {previewIdx === i && (
                <div className="border-t border-white/5 p-2">
                  <ScenePreview fountain={v.fountain} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {restore.error && (
        <div className="mt-2 rounded border border-red-800/50 bg-red-950/30 p-2 text-xs text-red-300">
          {(restore.error as Error).message}
        </div>
      )}
    </div>
  );
}

/**
 * Render a single scene's fountain in screenplay-style format. Lightweight
 * mirror of FountainPreview without the page-level stats chips.
 */
function ScenePreview({ fountain }: { fountain: string }) {
  const lines = fountain.split("\n");
  return (
    <div className="max-h-[40vh] overflow-y-auto rounded bg-black/40 px-4 py-3 font-mono text-[12px] leading-relaxed">
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return <div key={i} className="h-2" />;
        if (/^(INT|EXT|INT\/EXT)\b/i.test(t) || /^FADE (IN|OUT|TO)/i.test(t)) {
          return (
            <div key={i} className="mt-1 font-bold uppercase text-ember-200">
              {t}
            </div>
          );
        }
        if (/^(CUT TO|SMASH (CUT|TO)|MATCH CUT|FADE TO|DISSOLVE TO|TITLE CARD)/i.test(t)) {
          return (
            <div key={i} className="mt-1 text-right uppercase text-ember-300">
              {t}
            </div>
          );
        }
        if (
          /^[A-Z][A-Z0-9 .\-_'()]+$/.test(t) &&
          t.length < 60 &&
          !t.endsWith(".") &&
          (lines[i + 1] ?? "").trim()
        ) {
          return (
            <div key={i} className="ml-[30%] mt-1 uppercase text-bone-100">
              {t}
            </div>
          );
        }
        if (/^\(.*\)$/.test(t)) {
          return (
            <div key={i} className="ml-[22%] italic text-bone-400">
              {t}
            </div>
          );
        }
        return (
          <div key={i} className="text-bone-200">
            {t}
          </div>
        );
      })}
    </div>
  );
}
