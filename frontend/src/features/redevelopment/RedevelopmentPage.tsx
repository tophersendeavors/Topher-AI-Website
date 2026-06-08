// Series Redevelopment Mode — Phase 1 page.
//
// Stage rail (R1–R6) with gate states (locked/available/in_progress/approved),
// R1 Brief form, R2 Character Bible generator + approval flow.
// R3–R6 render as "Coming next phase" placeholders so the user can see
// the full shape of the workflow even when only R1+R2 are functional.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import clsx from "clsx";
import {
  AlertTriangle, Check, ChevronLeft, Compass, Copy, Lock, Loader2, Pencil, Plus, RefreshCw, Save, Sparkles, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  RedevAuditReport,
  RedevCharacterBible,
  RedevCharacterBibleFields,
  RedevPassReport,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevR6Guardrail,
  RedevR6GuardrailsBundle,
  RedevR6RewriteAction,
  RedevR6RewriteScenePlan,
  RedevR6RewriteTarget,
  RedevR7PolishCategory,
  RedevR7PolishItem,
  RedevR8VoicePolishCategory,
  RedevR8VoicePolishItem,
  RedevR9FinalPolishCategory,
  RedevR9FinalPolishItem,
  RedevSeasonArcEpisode,
  RedevStageKey,
} from "@/lib/api";
import { R6_REWRITE_TARGET_LABEL, R7_POLISH_CATEGORY_LABEL, R8_VOICE_CATEGORY_LABEL, R9_FINAL_CATEGORY_LABEL, normalizeR6Guardrails } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { ApprovalBadge } from "@/components/ui/ApprovalBadge";
import { AuditCheckPanel } from "@/components/ui/AuditCheckPanel";
import { DraftPreviewPanel } from "@/components/ui/DraftPreviewPanel";

const STAGE_ORDER: RedevStageKey[] = [
  "r1_brief",
  "r2_character_bibles",
  "r3_protocol_modules",
  "r4_season_arc",
  "r5_pilot_strategy",
  "r6_pilot_rewrite",
  "r7_pilot_polish",
  "r8_voice_polish",
  "r9_final_polish",
];

const STAGE_LABEL: Record<RedevStageKey, string> = {
  r1_brief: "R1 · Redevelopment Brief",
  r2_character_bibles: "R2 · Character Bibles",
  r3_protocol_modules: "R3 · Protocol Modules",
  r4_season_arc: "R4 · Season One Arc",
  r5_pilot_strategy: "R5 · Pilot Strategy",
  r6_pilot_rewrite: "R6 · Guardrails Setup",
  r7_pilot_polish: "R7 · Pilot Polish Pass",
  r8_voice_polish: "R8 · Voice & Scene Life Pass",
  r9_final_polish: "R9 · Final Hook & Emotional Anchor",
};

const STAGE_SUB: Record<RedevStageKey, string> = {
  r1_brief: "What changed about the show. New core principle. New season question.",
  r2_character_bibles: "Regenerate each principal's ten-field bible against the new engine.",
  r3_protocol_modules: "Generate 10–15 Protocol exercises. (Phase 2)",
  r4_season_arc: "Redesign Season One under the approved engine + modules. (Phase 2)",
  r5_pilot_strategy: "Plan the pilot rewrite — what to change, what to keep, where to plant.",
  r6_pilot_rewrite: "Lock per-character protection contracts the rewrite must honor. Rewrite generation coming next.",
  r7_pilot_polish: "Polish the promoted R6 pilot — continuity, dialogue, hook strength. Architecture stays locked.",
  r8_voice_polish: "Voice & scene-life pass on the promoted R7 pilot — make it less engineered, more alive. No architecture changes.",
  r9_final_polish: "Final automated rewrite pass on Draft 4 — Margot anchor, archive plant, sound, pacing, closing hook. Produces the locked Draft 5.",
};

const SELVAJE_DEFAULTS = {
  whatChanged:
    "The series engine has changed. SELVAJE is no longer 'broken people attend an unconventional healing retreat.' It is now: 'People arrive at Selvaje with avoidance strategies, and the Protocol systematically removes every place they have left to hide.' Every scene should put pressure on a character's avoidance strategy until truth becomes unavoidable. The body reveals what the mind avoids.",
  newCorePrinciple:
    "The Protocol does not uncover secrets. The Protocol destroys avoidance.",
  newSeasonQuestion:
    "What happens when people lose the ability to lie to themselves?",
  primaryMystery: "What is Selvaje really doing to people?",
  secondaryMystery:
    "What happened to Nadia's sister Elena? (Move this into the pilot's DNA — not a late subplot. The eventual possibility: Elena may not have been taken. Elena may have chosen Selvaje. Elena may have stayed voluntarily.)",
  mustNotChange:
    "Solano is not a fraud and not a cult leader. The Protocol actually works. Do not turn this into a thriller about exposing a con. The danger is truth, not deception.",
  targetsForRedevelopment:
    "Character bibles for Margot, Dean, Nadia, Claire, Paul, Dr. Izel Solano. Protocol module engine (10 modules). Season One arc (8 episodes). Pilot Episode 1 rewrite strategy (last).",
  audiencePromise:
    "There is something you don't understand yet, and when you finally understand it, everything changes. The audience should constantly reassess what they believe about each character and about Selvaje itself.",
  protocolPhilosophy:
    "The body reveals what the mind avoids. People do not lie primarily in speech — they lie in behavior. The Protocol does not ask 'How do you feel?' It asks, 'What do you do?' The Protocol attacks the strategy, not the wound. Cliffhangers come from what the exercises reveal, not from the exercises themselves.",
  solanoRule:
    "Solano is not a fraud. Solano is not a cult leader. The Protocol actually works. The danger is not deception — the danger is truth. Solano is unsettling because she is certain, not because she is evil. She may be the only person at Selvaje who is not lying.",
  forbiddenTones:
    "The Protocol must NOT feel like: hypnosis, magic, supernatural visions, generic therapy conversations, psychedelics every episode, 'tell me about your childhood' scenes. It must feel: scientifically plausible, emotionally terrifying, visually cinematic, capable of producing breakthroughs through behavior.",
};

const SELVAJE_CAST: Array<{ name: string; seed: string }> = [
  {
    name: "Margot Ellison",
    seed:
      "Hides in analysis. Must learn to feel. Her daughter knew she was loved — the person who cannot forgive Margot is Margot.",
  },
  {
    name: "Dean Palter",
    seed:
      "Built a harmful empire. Success became shame. The audience should first think he is lonely, then realize he is ashamed.",
  },
  {
    name: "Nadia Reyes",
    seed:
      "The missing woman is her sister Elena. Investigation is personal and embodied, not procedural. Hides obsession behind professionalism. Has hidden Elena even from the audience until late.",
  },
  {
    name: "Claire Beaumont",
    seed:
      "Built identity around grief. Healing feels like betrayal. Her fear is not pain — it is who she becomes if the pain leaves.",
  },
  {
    name: "Paul Beaumont",
    seed:
      "Was in the accident. Blacks out / genuinely does not know what happened. The other driver was convicted. Years later he discovers proof — the accident timestamp and his outgoing text timestamp align. Believed the lie too. Coward and self-deceiver, not a monster. His restraint and caregiving are guilt in disguise. NOTE: this is foundational architecture; the pilot must NOT reveal it. The reveal lands in Episode 6 or 7.",
  },
  {
    name: "Dr. Izel Solano",
    seed:
      "Hides nothing. That is why she is dangerous. May be the only person at Selvaje who is not lying. Unsettling because she is certain, not because she is evil.",
  },
];

export function RedevelopmentPage() {
  const { projectId, passId } = useParams<{ projectId: string; passId?: string }>();
  if (!projectId) return null;
  return <RedevContent projectId={projectId} passId={passId} />;
}

function RedevContent({ projectId, passId }: { projectId: string; passId?: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const passesQ = useQuery({
    queryKey: ["redev-passes", projectId],
    queryFn: () => api.listRedevPasses(projectId),
  });
  const activePassId =
    passId ??
    (passesQ.data ?? []).find((p) => p.status === "in_progress")?.id ??
    null;

  const reportQ = useQuery({
    queryKey: ["redev-pass", projectId, activePassId],
    queryFn: () => api.getRedevPass(projectId, activePassId!),
    enabled: !!activePassId,
  });

  const createPass = useMutation({
    mutationFn: () => {
      const title = `Redevelopment Pass — ${new Date().toLocaleString()}`;
      return api.createRedevPass(projectId, title);
    },
    onSuccess: (pass) => {
      qc.invalidateQueries({ queryKey: ["redev-passes", projectId] });
      navigate(`/projects/${projectId}/redevelopment/${pass.id}`);
    },
  });

  const [activeStage, setActiveStage] = useState<RedevStageKey>("r1_brief");

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Series Redevelopment"
        title="Redevelopment Mode"
        description="Step backward from screenplay polish into deeper series architecture without destroying existing drafts. Revise the engine, then propagate."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => navigate(`/projects/${projectId}`)}
            >
              <ChevronLeft className="h-4 w-4" /> Back to project
            </Button>
            {!activePassId && (
              <Button
                onClick={() => createPass.mutate()}
                disabled={createPass.isPending}
              >
                {createPass.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Start Redevelopment Pass
              </Button>
            )}
          </div>
        }
      />

      {!activePassId ? (
        <NoPassYet
          history={passesQ.data ?? []}
          loading={passesQ.isLoading}
          onResume={(id) => navigate(`/projects/${projectId}/redevelopment/${id}`)}
        />
      ) : reportQ.isLoading ? (
        <div className="px-8 text-sm text-bone-400">
          <Loader2 className="inline animate-spin h-4 w-4 mr-1" /> Loading pass…
        </div>
      ) : reportQ.error ? (
        <div className="px-8 text-sm text-red-300">
          {(reportQ.error as Error).message}
        </div>
      ) : reportQ.data ? (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-6 px-8">
          <StageRail
            report={reportQ.data}
            activeStage={activeStage}
            onPick={setActiveStage}
          />
          <StageDetail
            projectId={projectId}
            passId={activePassId}
            stage={activeStage}
            report={reportQ.data}
            onChange={() =>
              qc.invalidateQueries({
                queryKey: ["redev-pass", projectId, activePassId],
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// No-pass-yet card
// ---------------------------------------------------------------------------
function NoPassYet({
  history,
  loading,
  onResume,
}: {
  history: Array<{ id: string; title: string; status: string; createdAt: string }>;
  loading: boolean;
  onResume: (id: string) => void;
}) {
  return (
    <div className="px-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Panel eyebrow="Start" title="Begin a redevelopment pass">
        <p className="text-sm text-bone-300 leading-relaxed">
          A pass lets you revise the show's engine — core principle, season question,
          character architecture, season arc — without overwriting existing drafts
          or approved canon. Each stage produces <strong>proposed revisions</strong>;
          nothing replaces live work until you promote the pass.
        </p>
        <ul className="mt-3 space-y-1 text-xs text-bone-400">
          <li>• R1 — Define what's changed about the show.</li>
          <li>• R2 — Regenerate character bibles against the new engine.</li>
          <li>• R3 — Generate Protocol / system modules. (Phase 2)</li>
          <li>• R4 — Redesign Season One. (Phase 2)</li>
          <li>• R5 — Pilot rewrite strategy (nine prioritized lists).</li>
          <li>• R6 — Revised pilot draft. (next phase)</li>
        </ul>
        <div className="mt-4 text-[11px] text-bone-500">
          Click <strong>Start Redevelopment Pass</strong> above to begin.
        </div>
      </Panel>
      <Panel eyebrow="History" title="Prior passes">
        {loading ? (
          <div className="text-sm text-bone-400">
            <Loader2 className="inline animate-spin h-4 w-4 mr-1" /> Loading…
          </div>
        ) : history.length === 0 ? (
          <div className="text-sm text-bone-500">
            No prior passes yet for this project.
          </div>
        ) : (
          <ul className="space-y-2">
            {history
              .slice()
              .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
              .map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between rounded border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-bone-100 truncate">
                      {p.title}
                    </div>
                    <div className="text-[11px] text-bone-500">
                      {new Date(p.createdAt).toLocaleString()} · {p.status}
                    </div>
                  </div>
                  <Button variant="outline" onClick={() => onResume(p.id)}>
                    Resume
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage rail
// ---------------------------------------------------------------------------
function StageRail({
  report,
  activeStage,
  onPick,
}: {
  report: RedevPassReport;
  activeStage: RedevStageKey;
  onPick: (s: RedevStageKey) => void;
}) {
  const createdAt = report.pass.createdAt
    ? new Date(report.pass.createdAt)
    : null;
  return (
    <div className="panel sticky top-4 h-fit p-3">
      <div className="px-2 pt-2 pb-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-bone-400/70">
          Pass: {report.pass.title}
        </div>
        {createdAt && (
          <div className="mt-1 text-[11px] text-bone-500">
            {createdAt.toLocaleString(undefined, {
              month: "numeric",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
              hour12: true,
            })}
          </div>
        )}
      </div>
      <ol className="space-y-1">
        {STAGE_ORDER.map((s) => {
          const status = report.stages[s].status;
          const isActive = s === activeStage;
          const isLocked = status === "locked";
          // Dot tone: approved=green, in_progress=ember (warm), active=blue, locked=muted.
          const dotTone =
            status === "approved"
              ? "os-dot os-dot-approved"
              : status === "in_progress"
                ? "os-dot os-dot-ember"
                : status === "locked"
                  ? "os-dot os-dot-locked"
                  : "os-dot os-dot-active";
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className={clsx(
                  "group w-full rounded-xl px-3 py-2.5 text-left transition-all",
                  isActive
                    ? "bg-gradient-to-r from-ember-500/[0.12] to-transparent ring-1 ring-ember-500/35 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]"
                    : isLocked
                      ? "opacity-70 hover:bg-white/[0.025]"
                      : "hover:bg-white/[0.035]"
                )}
              >
                <div className="flex w-full items-center gap-3">
                  <span className={dotTone} />
                  <div className="min-w-0 flex-1 text-left">
                    <div
                      className={clsx(
                        "truncate text-[13.5px] font-medium leading-tight",
                        isActive
                          ? "text-bone-50"
                          : isLocked
                            ? "text-bone-400"
                            : "text-bone-200"
                      )}
                    >
                      {STAGE_LABEL[s]}
                    </div>
                    <div
                      className={clsx(
                        "mt-1 truncate text-[11px]",
                        status === "approved"
                          ? "text-emerald-300/80"
                          : status === "in_progress"
                            ? "text-ember-300/90"
                            : status === "locked"
                              ? "text-bone-500"
                              : "text-sky-300/80"
                      )}
                    >
                      {status === "locked"
                        ? `Locked — waiting on ${report.stages[s].blockedBy
                            .map((b) => STAGE_LABEL[b].split(" · ")[0])
                            .join(", ")}`
                        : status === "approved"
                          ? "Approved"
                          : status === "in_progress"
                            ? "In progress"
                            : "Available"}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage detail dispatch
// ---------------------------------------------------------------------------
function StageDetail({
  projectId,
  passId,
  stage,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  stage: RedevStageKey;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const stageStatus = report.stages[stage].status;

  if (stageStatus === "locked") {
    const blockers = report.stages[stage].blockedBy
      .map((k) => STAGE_LABEL[k])
      .join(", ");
    return (
      <Panel eyebrow={STAGE_LABEL[stage]} title="This stage is locked">
        <div className="os-banner os-banner-locked">
          <div className="os-banner-icon">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="os-banner-title">Waiting on {blockers}</div>
            <div className="os-banner-sub">{STAGE_SUB[stage]}</div>
          </div>
        </div>
      </Panel>
    );
  }

  if (stage === "r1_brief") {
    return <R1BriefStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r2_character_bibles") {
    return <R2CharacterBiblesStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r3_protocol_modules") {
    return <R3ProtocolModulesStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r4_season_arc") {
    return <R4SeasonArcStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r5_pilot_strategy") {
    return <R5PilotStrategyStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r6_pilot_rewrite") {
    return <R6PreRewriteStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r7_pilot_polish") {
    return <R7PolishStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r8_voice_polish") {
    return <R8VoicePolishStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  if (stage === "r9_final_polish") {
    return <R9FinalPolishStage projectId={projectId} passId={passId} report={report} onChange={onChange} />;
  }
  return <PhasePlaceholder stage={stage} />;
}

function PhasePlaceholder({ stage }: { stage: RedevStageKey }) {
  return (
    <Panel eyebrow={STAGE_LABEL[stage]} title="Coming next phase">
      <div className="flex items-start gap-3 rounded border border-white/10 bg-white/[0.02] p-4">
        <Compass className="h-5 w-5 text-bone-400 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm text-bone-100 font-medium">
            {STAGE_SUB[stage]}
          </div>
          <div className="text-xs text-bone-400 mt-1">
            Phase 1 ships R1 + R2. The remaining stages will be wired in upcoming phases —
            you can see the gates here so the workflow shape is visible.
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// R1 — Brief
// ---------------------------------------------------------------------------
function R1BriefStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const existing = report.pass.brief;
  const approved = !!existing?.approvedAt;
  // Auto-prefill SELVAJE defaults ONLY when the active redev template
  // is SELVAJE (or unset for backward-compat with the live SELVAJE
  // pass which predates the template field). Brand-new projects on
  // `blank` or any other template start with empty fields and never
  // inherit SELVAJE language. See backend/src/redevelopment/templates/.
  const passTemplateId = (report.pass as { redevTemplateId?: string | null }).redevTemplateId;
  const useSelvajeDefaults = !passTemplateId || passTemplateId === "selvaje";
  const D = (v: string) => (useSelvajeDefaults ? v : "");
  const [whatChanged, setWhatChanged] = useState(existing?.whatChanged ?? D(SELVAJE_DEFAULTS.whatChanged));
  const [newCorePrinciple, setNewCorePrinciple] = useState(existing?.newCorePrinciple ?? D(SELVAJE_DEFAULTS.newCorePrinciple));
  const [newSeasonQuestion, setNewSeasonQuestion] = useState(existing?.newSeasonQuestion ?? D(SELVAJE_DEFAULTS.newSeasonQuestion));
  const [primaryMystery, setPrimaryMystery] = useState(existing?.primaryMystery ?? D(SELVAJE_DEFAULTS.primaryMystery));
  const [secondaryMystery, setSecondaryMystery] = useState(existing?.secondaryMystery ?? D(SELVAJE_DEFAULTS.secondaryMystery));
  const [mustNotChange, setMustNotChange] = useState(existing?.mustNotChange ?? D(SELVAJE_DEFAULTS.mustNotChange));
  const [targets, setTargets] = useState(existing?.targetsForRedevelopment ?? D(SELVAJE_DEFAULTS.targetsForRedevelopment));
  const [audiencePromise, setAudiencePromise] = useState(existing?.audiencePromise ?? D(SELVAJE_DEFAULTS.audiencePromise));
  const [protocolPhilosophy, setProtocolPhilosophy] = useState(existing?.protocolPhilosophy ?? D(SELVAJE_DEFAULTS.protocolPhilosophy));
  const [solanoRule, setSolanoRule] = useState(existing?.solanoRule ?? D(SELVAJE_DEFAULTS.solanoRule));
  const [forbiddenTones, setForbiddenTones] = useState(existing?.forbiddenTones ?? D(SELVAJE_DEFAULTS.forbiddenTones));

  // Same transient "Saved ✓" pattern as the R2 character bibles —
  // gives the showrunner explicit confirmation that the brief saved.
  const [briefJustSaved, setBriefJustSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.saveRedevBrief(projectId, passId, {
        whatChanged,
        newCorePrinciple,
        newSeasonQuestion,
        primaryMystery,
        secondaryMystery,
        mustNotChange,
        targetsForRedevelopment: targets,
        audiencePromise,
        protocolPhilosophy,
        solanoRule,
        forbiddenTones,
      }),
    onSuccess: () => {
      setBriefJustSaved(true);
      setTimeout(() => setBriefJustSaved(false), 2500);
      onChange();
    },
  });
  const approve = useMutation({
    mutationFn: () => api.approveRedevBrief(projectId, passId),
    onSuccess: onChange,
  });

  const fields: Array<{
    label: string;
    value: string;
    setter: (v: string) => void;
    sub: string;
    rows: number;
  }> = [
    {
      label: "What changed about the show",
      value: whatChanged,
      setter: setWhatChanged,
      sub: "Plain language. What is no longer true about the previous engine?",
      rows: 4,
    },
    {
      label: "Audience promise",
      value: audiencePromise,
      setter: setAudiencePromise,
      sub: "What the audience is paying attention for. The contract the show makes with the viewer.",
      rows: 3,
    },
    {
      label: "New core principle",
      value: newCorePrinciple,
      setter: setNewCorePrinciple,
      sub: "The single sentence the writers' room repeats. The what.",
      rows: 2,
    },
    {
      label: "Protocol / system philosophy",
      value: protocolPhilosophy,
      setter: setProtocolPhilosophy,
      sub: "How the show's engine actually works. The how — separate from the what.",
      rows: 4,
    },
    {
      label: "New season question",
      value: newSeasonQuestion,
      setter: setNewSeasonQuestion,
      sub: "The question the season is testing. Replaces any prior, weaker version.",
      rows: 2,
    },
    {
      label: "Primary mystery",
      value: primaryMystery,
      setter: setPrimaryMystery,
      sub: "The big load-bearing mystery the audience tracks.",
      rows: 2,
    },
    {
      label: "Secondary mystery",
      value: secondaryMystery,
      setter: setSecondaryMystery,
      sub: "Sub-mystery layered through episodes.",
      rows: 3,
    },
    {
      label: "Solano rule (or other high-leverage character anchor)",
      value: solanoRule,
      setter: setSolanoRule,
      sub: "Architectural commitment about a character every downstream agent must respect. Locks the show's central ambiguity.",
      rows: 4,
    },
    {
      label: "Forbidden tones",
      value: forbiddenTones,
      setter: setForbiddenTones,
      sub: "Tones the show must NOT drift into. Hard forbidden list used by every generation prompt.",
      rows: 3,
    },
    {
      label: "What must NOT change",
      value: mustNotChange,
      setter: setMustNotChange,
      sub: "Genre / character / world commitments the redev must respect.",
      rows: 3,
    },
    {
      label: "What's being redeveloped",
      value: targets,
      setter: setTargets,
      sub: "Which character bibles, arcs, drafts are in scope for this pass.",
      rows: 2,
    },
  ];

  return (
    <Panel
      elevated
      emberEyebrow
      eyebrow={STAGE_LABEL["r1_brief"]}
      title="Redevelopment Brief"
      footer={approved && existing?.approvedAt ? (
        <>
          <div className="text-[11px] text-bone-500">
            Last updated by {existing.approvedBy ?? "Toburt"}
          </div>
          <ApprovalBadge approvedAt={existing.approvedAt} />
        </>
      ) : undefined}
      actions={
        (whatChanged || newCorePrinciple || newSeasonQuestion) && (
          <CopyButton
            variant="outline"
            text={formatBriefAsMarkdown({
              whatChanged,
              audiencePromise,
              newCorePrinciple,
              protocolPhilosophy,
              newSeasonQuestion,
              primaryMystery,
              secondaryMystery,
              solanoRule,
              forbiddenTones,
              mustNotChange,
              targetsForRedevelopment: targets,
              approvedAt: existing?.approvedAt,
            })}
            title="Copy the whole brief as Markdown — paste into Notion / Docs / Slack / email."
          />
        ) || undefined
      }
    >
      <p className="os-content-panel-lede">
        Define the new engine in writing before any architecture work. This brief
        becomes the system-prompt anchor for every downstream agent (character
        bibles, Protocol modules, season arc).
      </p>

      <div className="mt-5 space-y-3">
        {fields.map((f) => (
          <label key={f.label} className="os-field-card block hover:bg-white/[0.045]">
            <div className="os-field-label">{f.label}</div>
            <div className="os-field-help mb-1">{f.sub}</div>
            <textarea
              value={f.value}
              onChange={(e) => f.setter(e.target.value)}
              rows={f.rows}
              disabled={approved}
              className="os-field-textarea disabled:opacity-70 disabled:cursor-not-allowed"
            />
          </label>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {!approved && (
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || briefJustSaved}
            variant={briefJustSaved ? "primary" : "outline"}
            className={
              briefJustSaved
                ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                : undefined
            }
            title={
              briefJustSaved
                ? "Draft brief saved. You can Save & Approve when ready."
                : "Persist the brief without approving it yet."
            }
          >
            {save.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : briefJustSaved ? (
              <Check className="h-4 w-4 text-emerald-200" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {save.isPending ? "Saving…" : briefJustSaved ? "Saved" : "Save draft brief"}
          </Button>
        )}
        {!approved && (
          <Button
            onClick={async () => {
              await save.mutateAsync();
              approve.mutate();
            }}
            disabled={save.isPending || approve.isPending}
          >
            {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save & Approve Brief
          </Button>
        )}
        {approved && (
          <div className="inline-flex items-center gap-2 rounded border border-emerald-700/40 bg-emerald-900/15 px-3 py-1.5 text-sm text-emerald-200">
            <Check className="h-4 w-4" />
            Brief approved{existing?.approvedAt ? ` · ${new Date(existing.approvedAt).toLocaleString()}` : ""}
          </div>
        )}
        {(save.error || approve.error) && (
          <div className="w-full text-xs text-red-300">
            {((save.error || approve.error) as Error).message}
          </div>
        )}
      </div>

      {approved && (
        <div className="mt-3 text-[11px] text-bone-500">
          Open R2 in the rail to start regenerating character bibles against this brief.
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// R2 — Character Bibles
// ---------------------------------------------------------------------------
function R2CharacterBiblesStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSeed, setNewSeed] = useState("");

  // Hydrate the starter cast on first visit when the bible list is
  // empty. Auto-prefill only when the active redev template is SELVAJE
  // (or unset for backward-compat). Other templates start with no
  // pre-seeded characters — the writer adds their own.
  const passTemplateId = (report.pass as { redevTemplateId?: string | null }).redevTemplateId;
  const useSelvajeCast = !passTemplateId || passTemplateId === "selvaje";
  const bibles = useMemo<RedevCharacterBible[]>(() => {
    if (report.pass.characterBibles.length > 0) return report.pass.characterBibles;
    if (!useSelvajeCast) return [];
    return SELVAJE_CAST.map((c) => ({
      liveCharacterId: null,
      characterName: c.name,
      proposed: blankFields(),
      showrunnerSeed: c.seed,
      approvedAt: null,
      approvedBy: null,
    }));
  }, [report.pass.characterBibles, useSelvajeCast]);

  const persistBibles = useMutation({
    mutationFn: (bibles: RedevCharacterBible[]) =>
      api.saveRedevCharacterBibles(
        projectId,
        passId,
        bibles.map((b) => ({
          liveCharacterId: b.liveCharacterId,
          characterName: b.characterName,
          proposed: b.proposed,
          showrunnerSeed: b.showrunnerSeed,
        }))
      ),
    onSuccess: onChange,
  });

  const addCharacter = () => {
    if (!newName.trim()) return;
    const next = [
      ...bibles,
      {
        liveCharacterId: null,
        characterName: newName.trim(),
        proposed: blankFields(),
        showrunnerSeed: newSeed.trim() || undefined,
        approvedAt: null,
        approvedBy: null,
      } as RedevCharacterBible,
    ];
    persistBibles.mutate(next);
    setAdding(false);
    setNewName("");
    setNewSeed("");
  };

  const totalApproved = bibles.filter((b) => b.approvedAt).length;

  return (
    <div className="space-y-4">
      <Panel
        eyebrow={STAGE_LABEL["r2_character_bibles"]}
        title="Character Bible Redevelopment"
        actions={
          <div className="flex items-center gap-3">
            {bibles.some((b) => hasContent(b.proposed)) && (
              <CopyButton
                variant="outline"
                label="Copy all"
                successLabel="Copied all"
                title="Copy every populated bible as one Markdown document. Empty bibles are skipped."
                text={bibles
                  .filter((b) => hasContent(b.proposed))
                  .map(formatBibleAsMarkdown)
                  .join("\n---\n\n")}
              />
            )}
            <div className="text-[11px] text-bone-400">
              {totalApproved}/{bibles.length} approved
            </div>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Regenerate each principal's ten-field bible against the approved Brief.
          The AI never overwrites the live <code className="text-bone-200">characters</code> bible —
          these are proposed revisions you can edit and approve individually.
        </p>
        <div className="mt-3 rounded border border-sky-700/30 bg-sky-900/10 px-3 py-2 text-[11px] text-sky-100">
          <strong>Gate:</strong> R4 Season Arc unlocks only when EVERY bible here is approved.
          R6 Pilot Rewrite unlocks only when R2 + R3 + R4 are all approved.
        </div>

        <div className="mt-4 flex items-center gap-2">
          {!adding ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add character
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 w-full">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Character name"
                className="rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm flex-1 min-w-[140px]"
              />
              <input
                value={newSeed}
                onChange={(e) => setNewSeed(e.target.value)}
                placeholder="(optional) Seed line — 'X hides in analysis; must learn to feel.'"
                className="rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm flex-[2] min-w-[220px]"
              />
              <Button onClick={addCharacter} disabled={!newName.trim()}>
                Add
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </Panel>

      {bibles.map((b) => (
        <BibleCard
          key={b.characterName}
          projectId={projectId}
          passId={passId}
          bible={b}
          allBibles={bibles}
          onPersist={(next) => persistBibles.mutate(next)}
          onChange={() => qc.invalidateQueries({ queryKey: ["redev-pass", projectId, passId] })}
        />
      ))}
    </div>
  );
}

function BibleCard({
  projectId,
  passId,
  bible,
  allBibles,
  onPersist,
  onChange,
}: {
  projectId: string;
  passId: string;
  bible: RedevCharacterBible;
  allBibles: RedevCharacterBible[];
  onPersist: (next: RedevCharacterBible[]) => void;
  onChange: () => void;
}) {
  const [proposed, setProposed] = useState<RedevCharacterBibleFields>(bible.proposed);
  const [seed, setSeed] = useState(bible.showrunnerSeed ?? "");
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(!bible.approvedAt && !hasContent(bible.proposed));

  const generate = useMutation({
    mutationFn: () =>
      api.generateRedevCharacterBible(projectId, passId, {
        characterName: bible.characterName,
        showrunnerSeed: seed || undefined,
        notes: notes || undefined,
      }),
    onSuccess: (data) => {
      setProposed(data.proposed);
      // Persist the new proposed text immediately so it survives reload.
      const next = allBibles.map((b) =>
        b.characterName === bible.characterName
          ? { ...b, proposed: data.proposed, showrunnerSeed: seed || undefined }
          : b
      );
      onPersist(next);
    },
  });
  // Transient "Saved ✓" state — clears after ~2.5s. Gives the user
  // explicit confirmation that the save persisted before they click
  // Approve bible. Without this they couldn't tell if the spinner
  // reverting meant success or failure.
  const [justSaved, setJustSaved] = useState(false);
  const saveDraft = useMutation({
    mutationFn: () => {
      const next = allBibles.map((b) =>
        b.characterName === bible.characterName
          ? { ...b, proposed, showrunnerSeed: seed || undefined }
          : b
      );
      return api.saveRedevCharacterBibles(
        projectId,
        passId,
        next.map((b) => ({
          liveCharacterId: b.liveCharacterId,
          characterName: b.characterName,
          proposed: b.proposed,
          showrunnerSeed: b.showrunnerSeed,
        }))
      );
    },
    onSuccess: () => {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      onChange();
    },
  });
  const approve = useMutation({
    mutationFn: async () => {
      // Save edits first so the approval is on the latest text.
      await saveDraft.mutateAsync();
      return api.approveRedevCharacterBible(projectId, passId, bible.characterName);
    },
    onSuccess: onChange,
  });

  const approved = !!bible.approvedAt;
  const populated = hasContent(proposed);

  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (approved
          ? "border-emerald-700/40 bg-emerald-900/8"
          : "border-white/10 bg-white/[0.02]")
      }
    >
      <div className="w-full flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <Users className="h-4 w-4 text-bone-300 shrink-0" />
          <div className="min-w-0">
            <div className="text-base text-bone-50 truncate">{bible.characterName}</div>
            <div className="text-[11px] text-bone-500 truncate">
              {bible.showrunnerSeed || "(no seed)"}
            </div>
          </div>
        </button>
        <div className="text-[11px] flex items-center gap-2 shrink-0">
          {populated && (
            <CopyButton
              text={formatBibleAsMarkdown({ ...bible, proposed })}
              title={`Copy "${bible.characterName}" bible as Markdown.`}
            />
          )}
          {approved ? (
            <span className="text-emerald-300 inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Approved
            </span>
          ) : populated ? (
            <span className="text-amber-300">Proposed — not yet approved</span>
          ) : (
            <span className="text-bone-500">Not yet generated</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="text-[11px]">
              <span className="text-bone-400 uppercase tracking-wide">Showrunner seed (optional)</span>
              <input
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                placeholder="e.g. 'Margot hides in analysis. Must learn to feel.'"
                className="mt-0.5 w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-bone-100"
              />
            </label>
            <label className="text-[11px]">
              <span className="text-bone-400 uppercase tracking-wide">Steering notes for next generation (optional)</span>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. 'Make the avoidance more bodily — make it visible in stillness.'"
                className="mt-0.5 w-full rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-sm text-bone-100"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || approved}
              variant={populated ? "outline" : "primary"}
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {populated ? "Regenerate against brief" : "Generate against brief"}
            </Button>
            {populated && !approved && (
              <>
                <Button
                  variant={justSaved ? "primary" : "outline"}
                  onClick={() => saveDraft.mutate()}
                  disabled={saveDraft.isPending || justSaved}
                  className={
                    justSaved
                      ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                      : undefined
                  }
                  title={
                    justSaved
                      ? "Edits saved. Safe to click Approve bible now."
                      : "Persist your hand-edits to this proposed bible."
                  }
                >
                  {saveDraft.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : justSaved ? (
                    <Check className="h-4 w-4 text-emerald-200" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {saveDraft.isPending ? "Saving…" : justSaved ? "Saved" : "Save edits"}
                </Button>
                <Button
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                  title="Approve this proposed bible. (If you have unsaved edits, they will be saved as part of the approval.)"
                >
                  {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve bible
                </Button>
                {saveDraft.error && (
                  <div className="w-full text-xs text-red-300">
                    Save failed: {(saveDraft.error as Error).message}
                  </div>
                )}
              </>
            )}
            {generate.error && (
              <div className="w-full text-xs text-red-300">
                {(generate.error as Error).message}
              </div>
            )}
          </div>

          <BibleFields proposed={proposed} setProposed={setProposed} locked={approved} />

          {bible.approvedAt && (
            <div className="text-[11px] text-emerald-300">
              Approved {new Date(bible.approvedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BibleFields({
  proposed,
  setProposed,
  locked,
}: {
  proposed: RedevCharacterBibleFields;
  setProposed: (next: RedevCharacterBibleFields) => void;
  locked: boolean;
}) {
  const fields: Array<{ key: keyof RedevCharacterBibleFields; label: string; sub: string }> = [
    { key: "publicIdentity", label: "Public identity", sub: "How the world reads them." },
    { key: "privateIdentity", label: "Private identity", sub: "Who they are when alone." },
    { key: "coreWound", label: "Core wound", sub: "The unhealed past they will not describe out loud." },
    { key: "avoidanceStrategy", label: "Avoidance strategy", sub: "The filmable behavior they use to dodge the wound." },
    { key: "hiddenTruth", label: "Hidden truth", sub: "The fact they're protecting themselves from." },
    { key: "whatTheyThinkTheyNeed", label: "What they think they need", sub: "Defense disguised as a goal." },
    { key: "whatTheyActuallyNeed", label: "What they actually need", sub: "Opposite of avoidance." },
    { key: "protocolVulnerability", label: "Protocol vulnerability", sub: "The exact pressure that cracks their avoidance." },
    { key: "seasonRevelation", label: "Season revelation", sub: "What truth becomes unavoidable across the arc." },
    { key: "finalChoice", label: "Final choice", sub: "What they do with the truth. Costly. Surprising even to them." },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {fields.map((f) => (
        <label key={f.key} className="block">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">{f.label}</div>
          <div className="text-[11px] text-bone-500 mb-1">{f.sub}</div>
          <textarea
            value={proposed[f.key] ?? ""}
            onChange={(e) =>
              setProposed({
                ...proposed,
                [f.key]: e.target.value,
              })
            }
            rows={3}
            disabled={locked}
            placeholder="(empty — click Generate against brief above)"
            className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm leading-snug disabled:opacity-70"
          />
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function blankFields(): RedevCharacterBibleFields {
  return {
    publicIdentity: "",
    privateIdentity: "",
    coreWound: "",
    avoidanceStrategy: "",
    hiddenTruth: "",
    whatTheyThinkTheyNeed: "",
    whatTheyActuallyNeed: "",
    protocolVulnerability: "",
    seasonRevelation: "",
    finalChoice: "",
  };
}

function hasContent(b: RedevCharacterBibleFields): boolean {
  return Object.values(b).some((v) => typeof v === "string" && v.trim().length > 0);
}

// ===========================================================================
// R3 — Protocol Modules
// ===========================================================================

const SELVAJE_MODULE_SEEDS: Array<{ name: string; seed: string }> = [
  { name: "Surrender", seed: "Guests give up phones, notebooks, watches, distractions." },
  { name: "Observation", seed: "Nobody may discuss themselves. They may only observe others." },
  { name: "Silence", seed: "48 hours, no talking. Behavior replaces speech." },
  { name: "Pairing", seed: "Guests are assigned unexpected partners who destabilize their avoidance." },
  { name: "Truth / Prediction", seed: "Participants must publicly answer: 'What is this person avoiding?'" },
  { name: "Role Reversal", seed: "Guests must argue the opposite of what they believe." },
  { name: "Witness", seed: "One participant watches another complete an exercise without helping." },
  { name: "Exposure", seed: "Private information surfaces through participant BEHAVIOR — not through Solano forcing confession." },
  { name: "Isolation", seed: "Guests are separated from group support and distractions." },
  { name: "Choice", seed: "The final Protocol is not an exercise. It is a real-world decision." },
];

function R3ProtocolModulesStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSeed, setNewSeed] = useState("");

  const modules = useMemo<RedevProtocolModule[]>(() => {
    if (report.pass.protocolModules.length > 0) return report.pass.protocolModules;
    return SELVAJE_MODULE_SEEDS.map((m, i) => ({
      id: `seed-${i}-${m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: m.name,
      purpose: "",
      psychologicalTarget: "",
      avoidanceBehaviorStripped: "",
      physicalSomaticExercise: m.seed,
      visualExecution: "",
      dramaticRisks: "",
      affectedCharacterNames: [],
      truthPressured: "",
      possibleEpisodePlacement: "",
      approvedAt: null,
    }));
  }, [report.pass.protocolModules]);

  const persistModules = useMutation({
    mutationFn: (mods: RedevProtocolModule[]) =>
      api.saveRedevProtocolModules(projectId, passId, mods),
    onSuccess: onChange,
  });

  const totalApproved = modules.filter((m) => m.approvedAt).length;

  const addModule = () => {
    if (!newName.trim()) return;
    const next = [
      ...modules,
      {
        id: `seed-${modules.length}-${newName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: newName.trim(),
        purpose: "",
        psychologicalTarget: "",
        avoidanceBehaviorStripped: "",
        physicalSomaticExercise: newSeed.trim() || "",
        visualExecution: "",
        dramaticRisks: "",
        affectedCharacterNames: [],
        truthPressured: "",
        possibleEpisodePlacement: "",
        approvedAt: null,
      } as RedevProtocolModule,
    ];
    persistModules.mutate(next);
    setAdding(false);
    setNewName("");
    setNewSeed("");
  };

  return (
    <div className="space-y-4">
      <Panel
        eyebrow={STAGE_LABEL["r3_protocol_modules"]}
        title="Protocol Module Engine"
        actions={
          <div className="flex items-center gap-3">
            {modules.some((m) => hasModuleContent(m)) && (
              <CopyButton
                variant="outline"
                label="Copy all"
                successLabel="Copied all"
                title="Copy every module with content as one Markdown document. Empty modules are skipped."
                text={modules
                  .filter((m) => hasModuleContent(m))
                  .map(formatModuleAsMarkdown)
                  .join("\n---\n\n")}
              />
            )}
            <div className="text-[11px] text-bone-400">
              {totalApproved}/{modules.length} approved
            </div>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Design the show's Protocol exercises. Each module attacks a specific
          avoidance behavior the R2 character bibles named. Approve each module
          to unlock R4 Season Arc.
        </p>
        <div className="mt-3 rounded border border-sky-700/30 bg-sky-900/10 px-3 py-2 text-[11px] text-sky-100">
          <strong>Gate:</strong> R4 Season Arc unlocks only when EVERY module here is approved.
        </div>
        <div className="mt-4 flex items-center gap-2">
          {!adding ? (
            <Button variant="outline" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add module
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 w-full">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Module name (e.g. 'Mirror')"
                className="rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm flex-1 min-w-[140px]"
              />
              <input
                value={newSeed}
                onChange={(e) => setNewSeed(e.target.value)}
                placeholder="(optional) Surface behavior — 'Guests describe each other's avoidance to their face.'"
                className="rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm flex-[2] min-w-[220px]"
              />
              <Button onClick={addModule} disabled={!newName.trim()}>
                Add
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      </Panel>

      {modules.map((m) => (
        <ModuleCard
          key={m.id}
          projectId={projectId}
          passId={passId}
          module={m}
          allModules={modules}
          onPersist={(next) => persistModules.mutate(next)}
          onChange={() => qc.invalidateQueries({ queryKey: ["redev-pass", projectId, passId] })}
        />
      ))}
    </div>
  );
}

function ModuleCard({
  projectId,
  passId,
  module: m,
  allModules,
  onPersist,
  onChange,
}: {
  projectId: string;
  passId: string;
  module: RedevProtocolModule;
  allModules: RedevProtocolModule[];
  onPersist: (next: RedevProtocolModule[]) => void;
  onChange: () => void;
}) {
  const [local, setLocal] = useState<RedevProtocolModule>(m);
  const [expanded, setExpanded] = useState(!m.approvedAt && !hasModuleContent(m));
  const [justSaved, setJustSaved] = useState(false);
  const [justSavedNote, setJustSavedNote] = useState(false);
  // "Edit approved fields" mode — when true on an approved module, the
  // ten fields become editable inline. Saving from this mode preserves
  // the existing approval (server gets preserveApproval: true).
  const [editingApproved, setEditingApproved] = useState(false);
  const [justSavedAmend, setJustSavedAmend] = useState(false);
  // Validator notes from the last generate (e.g. "Claire auto-added").
  // Shown as a soft info banner so the writer knows the inclusion
  // validator fired on this module.
  const [lastValidatorNotes, setLastValidatorNotes] = useState<
    Array<{ characterName: string; triggeredBy: string[]; reason: string }>
  >([]);
  // Full Generation Quality Check report from the last generate. Shows
  // every rule the audit ran, what passed, what was auto-repaired, and
  // what the showrunner needs to review manually.
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  // Frontend mirror of the inclusion rules — surfaces missing
  // characters even on modules that were generated before the
  // validator existed.
  const missingInclusions = detectMissingCharacters(local);

  const generate = useMutation({
    mutationFn: () =>
      api.generateRedevProtocolModule(projectId, passId, {
        moduleName: local.name,
        showrunnerSeed: local.physicalSomaticExercise || undefined,
        // Use the PERSISTED steering note as the regen steering.
        notes: local.steeringNote || undefined,
      }),
    onSuccess: (data) => {
      // Keep the persisted steeringNote attached to the regenerated
      // module so the showrunner can keep iterating with the same
      // note (or clear it).
      const merged: RedevProtocolModule = {
        ...data.module,
        id: local.id,
        name: local.name,
        steeringNote: local.steeringNote,
        approvedAt: null,
      };
      setLocal(merged);
      // Surface server-side validator notes (e.g. "Claire auto-added")
      // so the showrunner can see WHY the affected-characters list
      // changed during generation.
      setLastValidatorNotes(data.validatorNotes ?? []);
      setLastAudit(data.audit ?? null);
      const next = allModules.map((mm) => (mm.id === local.id ? merged : mm));
      onPersist(next);
    },
  });
  const saveDraft = useMutation({
    mutationFn: () => {
      const next = allModules.map((mm) => (mm.id === local.id ? local : mm));
      return api.saveRedevProtocolModules(projectId, passId, next);
    },
    onSuccess: () => {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      onChange();
    },
  });
  // Steering-note-only save. Same endpoint, but visually distinct
  // confirmation so the showrunner knows the NOTE was persisted (not
  // the whole module). The server's approval-preservation logic
  // ignores `steeringNote`, so this never drops approval.
  const saveSteeringNote = useMutation({
    mutationFn: () => {
      const next = allModules.map((mm) => (mm.id === local.id ? local : mm));
      return api.saveRedevProtocolModules(projectId, passId, next);
    },
    onSuccess: () => {
      setJustSavedNote(true);
      setTimeout(() => setJustSavedNote(false), 2500);
      onChange();
    },
  });
  const approve = useMutation({
    mutationFn: async () => {
      await saveDraft.mutateAsync();
      return api.approveRedevProtocolModule(projectId, passId, local.id);
    },
    onSuccess: onChange,
  });
  // Save a surgical amendment to an APPROVED module without dropping
  // approval. The server honors `preserveApproval: true` on this
  // specific module — see backend redevelopment.ts PUT handler.
  const saveAmendment = useMutation({
    mutationFn: () => {
      const next = allModules.map((mm) => (mm.id === local.id ? local : mm));
      return api.saveRedevProtocolModules(projectId, passId, next, {
        [local.id]: true,
      });
    },
    onSuccess: () => {
      setJustSavedAmend(true);
      setTimeout(() => setJustSavedAmend(false), 2500);
      setEditingApproved(false);
      onChange();
    },
  });

  const approved = !!m.approvedAt;
  const populated = hasModuleContent(local);
  // While the showrunner is editing an approved module, the fields are
  // unlocked. Otherwise: approved → locked, unapproved → unlocked.
  const fieldsLocked = approved && !editingApproved;

  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (approved ? "border-emerald-700/40 bg-emerald-900/8" : "border-white/10 bg-white/[0.02]")
      }
    >
      <div className="w-full flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <Compass className="h-4 w-4 text-bone-300 shrink-0" />
          <div className="min-w-0">
            <div className="text-base text-bone-50 truncate">{m.name}</div>
            <div className="text-[11px] text-bone-500 truncate">
              {local.physicalSomaticExercise || "(no surface behavior yet)"}
            </div>
          </div>
        </button>
        <div className="text-[11px] flex items-center gap-2 shrink-0">
          {/* Inclusion-warning chip — surfaces in the collapsed header
              so the showrunner can scan a long list of modules and
              instantly see which ones need a character added. */}
          {missingInclusions.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-900/40 text-amber-100 ring-1 ring-amber-700/50 px-2 py-0.5"
              title={`Missing: ${missingInclusions
                .map((mi) => mi.rule.characterName)
                .join(", ")} — expand the card to add.`}
            >
              <AlertTriangle className="h-3 w-3" />
              {missingInclusions.length === 1
                ? `Missing: ${missingInclusions[0].rule.characterName}`
                : `${missingInclusions.length} missing`}
            </span>
          )}
          {/* Per-module Copy — always available so the writer can grab
              the module content without expanding the card. Disabled
              when there's nothing to copy yet. */}
          {populated && (
            <CopyButton
              text={formatModuleAsMarkdown(local)}
              title={`Copy "${m.name}" as Markdown — paste into Notion / Docs / Slack / email.`}
            />
          )}
          {approved ? (
            <span className="text-emerald-300 inline-flex items-center gap-1">
              <Check className="h-3.5 w-3.5" /> Approved
            </span>
          ) : populated ? (
            <span className="text-amber-300">Proposed — not yet approved</span>
          ) : (
            <span className="text-bone-500">Not yet generated</span>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
          {/* Persistent steering notes — always editable, even when
              the module is approved. Saving the note does NOT drop
              approval (server-side approval-preservation excludes
              steeringNote from its comparison). */}
          <div className="rounded border border-amber-700/30 bg-amber-900/10 p-3">
            <label className="text-[11px] block">
              <span className="text-amber-200 uppercase tracking-wide font-medium">
                Steering notes for next regeneration
              </span>
              <span className="text-amber-200/70 ml-2 normal-case tracking-normal">
                — persistent. Used automatically on the next Regenerate.
                {approved && " Editable even while the module is approved; saving the note does NOT drop approval."}
              </span>
              <textarea
                value={local.steeringNote ?? ""}
                onChange={(e) => setLocal({ ...local, steeringNote: e.target.value })}
                rows={2}
                placeholder="e.g. 'Make this attack intellectualization specifically — Margot must have nowhere to hide.' / 'Stop drifting into therapy framing. Lean harder on physical / behavioral pressure.'"
                className="mt-1 w-full rounded border border-amber-700/30 bg-black/30 px-2 py-1.5 text-sm text-bone-100 placeholder:text-bone-500"
              />
            </label>
            <div className="mt-1 flex items-center gap-2">
              <Button
                variant={justSavedNote ? "primary" : "outline"}
                onClick={() => saveSteeringNote.mutate()}
                disabled={
                  saveSteeringNote.isPending ||
                  justSavedNote ||
                  (local.steeringNote ?? "") === (m.steeringNote ?? "")
                }
                className={
                  justSavedNote
                    ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                    : undefined
                }
                title="Persist the steering note. Doesn't drop the module's approval — just saves the note for the next regeneration."
              >
                {saveSteeringNote.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : justSavedNote ? (
                  <Check className="h-4 w-4 text-emerald-200" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveSteeringNote.isPending
                  ? "Saving note…"
                  : justSavedNote
                    ? "Note saved"
                    : "Save steering note"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!approved && (
              <Button
                onClick={() => generate.mutate()}
                disabled={generate.isPending}
                variant={populated ? "outline" : "primary"}
                title={
                  local.steeringNote
                    ? "Regenerate using the saved steering note above."
                    : "Regenerate this module against the R1 brief + R2 bibles."
                }
              >
                {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {populated ? "Regenerate against brief" : "Generate against brief"}
              </Button>
            )}
            {approved && !editingApproved && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setEditingApproved(true)}
                  title="Unlock the ten fields below to surgically amend the approved module — e.g., add a missing name to 'Characters this affects most' — without dropping approval or re-running the LLM."
                >
                  <Pencil className="h-4 w-4" />
                  Edit approved fields
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const ok = window.confirm(
                      "Regenerate this approved module?\n\nThis will drop the module's approval and replace its fields with a new generation (using the saved steering note above). You'll need to re-approve afterward."
                    );
                    if (!ok) return;
                    generate.mutate();
                  }}
                  disabled={generate.isPending}
                  className="border-amber-700/40 text-amber-200 hover:bg-amber-900/20"
                  title="Drops approval and regenerates using the saved steering note."
                >
                  {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Regenerate (will drop approval)
                </Button>
              </>
            )}
            {approved && editingApproved && (
              <>
                <Button
                  variant={justSavedAmend ? "primary" : "outline"}
                  onClick={() => saveAmendment.mutate()}
                  disabled={saveAmendment.isPending || justSavedAmend}
                  className={
                    justSavedAmend
                      ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                      : undefined
                  }
                  title="Persist this surgical amendment. Approval is preserved — the server is explicitly told this is an in-place edit, not a re-approval."
                >
                  {saveAmendment.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : justSavedAmend ? (
                    <Check className="h-4 w-4 text-emerald-200" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {saveAmendment.isPending
                    ? "Saving amendment…"
                    : justSavedAmend
                      ? "Amendment saved"
                      : "Save amendment (keeps approval)"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    // Discard the user's in-flight edits and revert to
                    // the server's canonical approved version.
                    setLocal(m);
                    setEditingApproved(false);
                  }}
                  disabled={saveAmendment.isPending}
                  title="Discard your edits and return to the approved version."
                >
                  Cancel
                </Button>
              </>
            )}
            {populated && !approved && (
              <>
                <Button
                  variant={justSaved ? "primary" : "outline"}
                  onClick={() => saveDraft.mutate()}
                  disabled={saveDraft.isPending || justSaved}
                  className={
                    justSaved
                      ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                      : undefined
                  }
                >
                  {saveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : justSaved ? <Check className="h-4 w-4 text-emerald-200" /> : <RefreshCw className="h-4 w-4" />}
                  {saveDraft.isPending ? "Saving…" : justSaved ? "Saved" : "Save edits"}
                </Button>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                  {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve module
                </Button>
              </>
            )}
            {(generate.error || saveDraft.error || saveSteeringNote.error || approve.error) && (
              <div className="w-full text-xs text-red-300">
                {((generate.error || saveDraft.error || saveSteeringNote.error || approve.error) as Error).message}
              </div>
            )}
          </div>

          {approved && editingApproved && (
            <div className="rounded border border-amber-700/40 bg-amber-900/15 px-3 py-2 text-[11px] text-amber-200">
              <strong>Editing approved module.</strong> Make your changes,
              then click <strong>Save amendment</strong> to persist —
              approval is preserved. Or click <strong>Cancel</strong> to
              discard.
            </div>
          )}

          {/* Full Generation Quality Check panel — shows every rule
              the audit pipeline ran on the most-recent generation. */}
          {lastAudit && (
            <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
          )}

          {/* Validator notes from the latest generate (server-side
              auto-includes). Shown for a moment after Generate so the
              showrunner can see WHY a character was added. */}
          {lastValidatorNotes.length > 0 && (
            <div className="rounded border border-emerald-700/40 bg-emerald-900/15 px-3 py-2 text-[11px] text-emerald-100 space-y-1">
              {lastValidatorNotes.map((n, i) => (
                <div key={i}>
                  <strong>{n.characterName} auto-added</strong> by the
                  inclusion validator — module body mentioned{" "}
                  <span className="text-emerald-200">
                    {n.triggeredBy.map((t) => `"${t}"`).join(", ")}
                  </span>
                  . {n.reason}
                </div>
              ))}
            </div>
          )}

          {/* Live inclusion warnings — fired by the frontend mirror of
              the same rules. Catches existing modules generated before
              the validator was added, or where the writer manually
              removed a character despite the body still mentioning
              their territory. One-click "Add" button preserves approval
              if the module is already approved. */}
          {missingInclusions.length > 0 && (
            <div className="rounded border border-amber-700/40 bg-amber-900/15 p-3 space-y-2">
              {missingInclusions.map(({ rule, hits }) => (
                <div key={rule.characterName} className="space-y-1.5">
                  <div className="text-[12px] text-amber-100">
                    <strong>{rule.characterName}</strong> appears in this
                    module's body but is not listed in affected characters.
                  </div>
                  <div className="text-[11px] text-amber-200/80 leading-snug">
                    Triggered by:{" "}
                    {hits.slice(0, 5).map((h) => `"${h}"`).join(", ")}
                    {hits.length > 5 ? `, +${hits.length - 5} more` : ""}.
                    <br />
                    {rule.reason}
                  </div>
                  <Button
                    onClick={() => {
                      const next: RedevProtocolModule = {
                        ...local,
                        affectedCharacterNames: [
                          ...local.affectedCharacterNames,
                          rule.characterName,
                        ],
                      };
                      setLocal(next);
                      // Persist immediately. If the module is approved,
                      // use the preserveApproval channel; otherwise it's
                      // just a draft save.
                      const nextList = allModules.map((mm) =>
                        mm.id === local.id ? next : mm
                      );
                      const preserveMap = approved
                        ? { [local.id]: true }
                        : undefined;
                      api
                        .saveRedevProtocolModules(
                          projectId,
                          passId,
                          nextList,
                          preserveMap
                        )
                        .then(() => onChange());
                    }}
                    variant="outline"
                  >
                    <Plus className="h-4 w-4" /> Add {rule.characterName} to
                    affected characters
                    {approved && (
                      <span className="ml-1 text-[10px] text-amber-200/70">
                        (keeps approval)
                      </span>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <ModuleFields local={local} setLocal={setLocal} locked={fieldsLocked} />

          {m.approvedAt && (
            <div className="text-[11px] text-emerald-300">
              Approved {new Date(m.approvedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Controlled input for a comma-separated list of names. Keeps the
 *  raw text in local state while typing so the user can type a comma
 *  (or any other punctuation) without the value being normalized
 *  mid-keystroke. Normalizes + commits to the parent on blur. */
function CharacterListInput({
  value,
  onCommit,
  disabled,
  placeholder,
}: {
  value: string[];
  onCommit: (next: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  // Raw text while typing — mirrors what the user sees.
  const [raw, setRaw] = useState(value.join(", "));
  // Re-sync from parent when the value changes externally (e.g. after
  // a fresh Generate replaces the bibles). Skip while the input is
  // focused so we don't clobber the writer's in-flight typing.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setRaw(value.join(", "));
  }, [value, focused]);
  return (
    <input
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const normalized = raw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        onCommit(normalized);
        // Reflect the normalized form back into the visible value so a
        // double-space or stray comma the user typed gets tidied up.
        setRaw(normalized.join(", "));
      }}
      disabled={disabled}
      placeholder={placeholder}
      className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm disabled:opacity-70"
    />
  );
}

function ModuleFields({
  local,
  setLocal,
  locked,
}: {
  local: RedevProtocolModule;
  setLocal: (m: RedevProtocolModule) => void;
  locked: boolean;
}) {
  type Key = Exclude<keyof RedevProtocolModule, "id" | "name" | "approvedAt" | "affectedCharacterNames">;
  const fields: Array<{ key: Key; label: string; sub: string; rows: number }> = [
    { key: "purpose", label: "Purpose", sub: "Why this module exists. 2–3 sentences.", rows: 3 },
    { key: "psychologicalTarget", label: "Psychological target", sub: "Which specific avoidance type does this attack?", rows: 2 },
    { key: "avoidanceBehaviorStripped", label: "Avoidance behavior stripped", sub: "The BEHAVIOR removed — written as a behavior.", rows: 3 },
    { key: "physicalSomaticExercise", label: "Physical / somatic exercise", sub: "The staged action — filmable, specific.", rows: 4 },
    { key: "visualExecution", label: "Visual execution", sub: "What the camera sees — production design + blocking.", rows: 4 },
    { key: "dramaticRisks", label: "Dramatic risks", sub: "What can go wrong inside the exercise, in-fiction. Specific.", rows: 4 },
    { key: "truthPressured", label: "Truth pressured", sub: "The specific kind of truth this module forces to the surface.", rows: 3 },
    { key: "possibleEpisodePlacement", label: "Possible episode placement", sub: "Early/mid/late + condition (not a number).", rows: 2 },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {fields.map((f) => (
        <label key={f.key} className="block">
          <div className="text-[11px] uppercase tracking-wide text-bone-400">{f.label}</div>
          <div className="text-[11px] text-bone-500 mb-1">{f.sub}</div>
          <textarea
            value={(local[f.key] as string) ?? ""}
            onChange={(e) => setLocal({ ...local, [f.key]: e.target.value })}
            rows={f.rows}
            disabled={locked}
            placeholder="(empty — click Generate against brief above)"
            className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm leading-snug disabled:opacity-70"
          />
        </label>
      ))}
      <label className="block md:col-span-2">
        <div className="text-[11px] uppercase tracking-wide text-bone-400">Characters this affects most</div>
        <div className="text-[11px] text-bone-500 mb-1">Comma-separated names from your approved R2 bibles. Press Tab or click away to commit.</div>
        <CharacterListInput
          value={local.affectedCharacterNames}
          onCommit={(next) => setLocal({ ...local, affectedCharacterNames: next })}
          disabled={locked}
          placeholder="e.g. Margot Ellison, Paul Beaumont"
        />
      </label>
    </div>
  );
}

// =============================================================================
// CHARACTER INCLUSION RULES — frontend mirror.
//
// MUST stay in sync with `CHARACTER_INCLUSION_RULES` in
// backend/src/redevelopment/protocolModuleAgent.ts. Both sides need to
// detect the same triggers: the server auto-adds during generation,
// the frontend surfaces a warning + one-click fix on already-generated
// modules where the showrunner (or an older agent version) left a
// character off the CSV despite the body mentioning their territory.
// =============================================================================

interface InclusionRule {
  characterName: string;
  reason: string;
  territoryKeywords: string[];
}

const CHARACTER_INCLUSION_RULES: InclusionRule[] = [
  {
    characterName: "Claire Beaumont",
    reason:
      "Claire's avoidance is ritualized grief and Marcus-preservation. Modules touching ritual, aliveness, memorializing, ordinary pleasure, being witnessed outside grief, usefulness as exit, or controlled memory must include her.",
    territoryKeywords: [
      "Claire",
      "Marcus",
      "grief ritual",
      "ritualized grief",
      "ritual",
      "memorializing",
      "memorial",
      "remembering",
      "memory of",
      "preserving the",
      "preservation",
      "aliveness",
      "alive",
      "laughter",
      "laughing",
      "ordinary pleasure",
      "ordinary joy",
      "ordinary life",
      "betrayal of",
      "healing feels",
      "widow",
      "mourning",
      "anniversary",
      "shrine",
      "keepsake",
      "useful",
      "usefulness",
      "purposefulness",
      "caretaking the dead",
      "speaking for someone",
      "speaking on behalf",
    ],
  },
];

/** Returns the characters whose territory keywords appear in this
 *  module's body but who are NOT in `affectedCharacterNames`. The UI
 *  surfaces a warning for each one with a one-click "Add" fix. */
function detectMissingCharacters(
  m: RedevProtocolModule
): Array<{ rule: InclusionRule; hits: string[] }> {
  const haystack = [
    m.purpose,
    m.psychologicalTarget,
    m.avoidanceBehaviorStripped,
    m.physicalSomaticExercise,
    m.visualExecution,
    m.dramaticRisks,
    m.truthPressured,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const existing = new Set(m.affectedCharacterNames.map((n) => n.toLowerCase()));
  const out: Array<{ rule: InclusionRule; hits: string[] }> = [];
  for (const rule of CHARACTER_INCLUSION_RULES) {
    if (existing.has(rule.characterName.toLowerCase())) continue;
    const hits = rule.territoryKeywords.filter((kw) =>
      haystack.includes(kw.toLowerCase())
    );
    if (hits.length > 0) out.push({ rule, hits });
  }
  return out;
}

function hasModuleContent(m: RedevProtocolModule): boolean {
  return [
    m.purpose,
    m.psychologicalTarget,
    m.avoidanceBehaviorStripped,
    m.visualExecution,
    m.dramaticRisks,
    m.truthPressured,
    m.possibleEpisodePlacement,
  ].some((v) => typeof v === "string" && v.trim().length > 0);
}

/** Format the R1 Brief as Markdown. Empty fields skipped. */
function formatBriefAsMarkdown(brief: {
  whatChanged?: string;
  audiencePromise?: string;
  newCorePrinciple?: string;
  protocolPhilosophy?: string;
  newSeasonQuestion?: string;
  primaryMystery?: string;
  secondaryMystery?: string;
  solanoRule?: string;
  forbiddenTones?: string;
  mustNotChange?: string;
  targetsForRedevelopment?: string;
  approvedAt?: string | null;
}): string {
  const lines: string[] = ["# Redevelopment Brief"];
  if (brief.approvedAt) {
    lines.push(`*Approved ${new Date(brief.approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  const sections: Array<[string, string | undefined]> = [
    ["What changed about the show", brief.whatChanged],
    ["Audience promise", brief.audiencePromise],
    ["New core principle", brief.newCorePrinciple],
    ["Protocol / system philosophy", brief.protocolPhilosophy],
    ["New season question", brief.newSeasonQuestion],
    ["Primary mystery", brief.primaryMystery],
    ["Secondary mystery", brief.secondaryMystery],
    ["Solano rule", brief.solanoRule],
    ["Forbidden tones", brief.forbiddenTones],
    ["What must NOT change", brief.mustNotChange],
    ["What's being redeveloped", brief.targetsForRedevelopment],
  ];
  for (const [label, value] of sections) {
    if (!value || !value.trim()) continue;
    lines.push(`## ${label}`);
    lines.push(value.trim());
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

/** Format a R2 character bible as Markdown. */
function formatBibleAsMarkdown(b: RedevCharacterBible): string {
  const lines: string[] = [`# ${b.characterName}`];
  if (b.approvedAt) {
    lines.push(`*Approved ${new Date(b.approvedAt).toLocaleDateString()}*`);
  }
  if (b.showrunnerSeed) {
    lines.push("");
    lines.push(`*Showrunner seed: ${b.showrunnerSeed}*`);
  }
  lines.push("");
  const sections: Array<[string, string]> = [
    ["Public identity", b.proposed.publicIdentity],
    ["Private identity", b.proposed.privateIdentity],
    ["Core wound", b.proposed.coreWound],
    ["Avoidance strategy", b.proposed.avoidanceStrategy],
    ["Hidden truth", b.proposed.hiddenTruth],
    ["What they think they need", b.proposed.whatTheyThinkTheyNeed],
    ["What they actually need", b.proposed.whatTheyActuallyNeed],
    ["Protocol vulnerability", b.proposed.protocolVulnerability],
    ["Season revelation", b.proposed.seasonRevelation],
    ["Final choice", b.proposed.finalChoice],
  ];
  for (const [label, value] of sections) {
    if (!value || !value.trim()) continue;
    lines.push(`## ${label}`);
    lines.push(value.trim());
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

/** Format one Season-One episode as Markdown. */
function formatEpisodeAsMarkdown(ep: RedevSeasonArcEpisode): string {
  const num = String(ep.number).padStart(2, "0");
  const lines: string[] = [`# EP ${num} — ${ep.title || "(untitled)"}`];
  lines.push("");
  const sections: Array<[string, string]> = [
    ["Episode theme", ep.theme],
    ["Protocol module", ep.protocolModule],
    ["Character breakthrough", ep.characterBreakthrough],
    ["Character collision", ep.characterCollision],
    ["Mystery progression", ep.mysteryProgression],
    ["Revelation / perspective shift", ep.revelation],
    ["Cliffhanger", ep.cliffhanger],
    ["What Episode 1 must plant", ep.episode1Plant],
  ];
  for (const [label, value] of sections) {
    if (!value || !value.trim()) continue;
    lines.push(`## ${label}`);
    lines.push(value.trim());
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

/** Format the whole Season One arc as one Markdown document. */
function formatSeasonArcAsMarkdown(
  episodes: RedevSeasonArcEpisode[],
  approvedAt?: string | null
): string {
  const header = approvedAt
    ? `# Season One — Redesigned Arc\n*Approved ${new Date(approvedAt).toLocaleDateString()}*\n\n---\n\n`
    : `# Season One — Redesigned Arc\n\n---\n\n`;
  return (
    header +
    episodes
      .filter((e) => e.title || e.theme || e.protocolModule || e.cliffhanger)
      .map(formatEpisodeAsMarkdown)
      .join("\n---\n\n")
  );
}

/** Format a Protocol module as plain Markdown for the clipboard. Output
 *  is intentionally portable — pastes cleanly into Notion / Docs / email
 *  / Slack. Title + ten labeled fields. Empty fields are omitted. */
function formatModuleAsMarkdown(m: RedevProtocolModule): string {
  const lines: string[] = [];
  lines.push(`# ${m.name}`);
  if (m.approvedAt) {
    lines.push(`*Approved ${new Date(m.approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  const sections: Array<[string, string | string[]]> = [
    ["Purpose", m.purpose],
    ["Psychological target", m.psychologicalTarget],
    ["Avoidance behavior stripped", m.avoidanceBehaviorStripped],
    ["Physical / somatic exercise", m.physicalSomaticExercise],
    ["Visual execution", m.visualExecution],
    ["Dramatic risks", m.dramaticRisks],
    ["Truth pressured", m.truthPressured],
    ["Possible episode placement", m.possibleEpisodePlacement],
    ["Characters this affects most", m.affectedCharacterNames],
  ];
  for (const [label, value] of sections) {
    const text = Array.isArray(value) ? value.join(", ") : value;
    if (!text || !text.trim()) continue;
    lines.push(`## ${label}`);
    lines.push(text.trim());
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

/** Copy `text` to the clipboard, with a Safari/clipboard-permission
 *  fallback that uses a hidden textarea + execCommand. Returns true on
 *  success. */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Generation Quality Check panel — shows every validator rule that
 *  ran on a generation, what passed, what triggered an auto-repair,
 *  and what the showrunner needs to review manually. Returned by the
 *  server's audit pipeline for R3 modules and R4 season arc. */
/** Thin shim — delegates to the shared `AuditCheckPanel` so every
 *  call site in this file automatically inherits the upgraded design
 *  language. Kept as a wrapper to avoid churn on all ~12 callers. */
function QualityCheckPanel({
  audit,
  collapsedByDefault = false,
}: {
  audit: RedevAuditReport;
  collapsedByDefault?: boolean;
}) {
  return (
    <AuditCheckPanel
      audit={audit}
      collapsedByDefault={collapsedByDefault}
    />
  );
}

/** Small copy button used in module headers + batch toolbars. Shows
 *  a transient "Copied" state for ~1.8s after success. */
function CopyButton({
  text,
  label = "Copy",
  successLabel = "Copied",
  variant = "ghost",
  title,
}: {
  text: string;
  label?: string;
  successLabel?: string;
  variant?: "ghost" | "outline" | "primary";
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={copied ? "primary" : variant}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyTextToClipboard(text);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }
      }}
      title={title ?? "Copy as Markdown — paste into Notion / Docs / Slack / email."}
      className={
        copied
          ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
          : undefined
      }
    >
      {copied ? <Check className="h-4 w-4 text-emerald-200" /> : <Copy className="h-4 w-4" />}
      {copied ? successLabel : label}
    </Button>
  );
}

// ===========================================================================
// R4 — Season Arc
// ===========================================================================

function blankEpisode(n: number): RedevSeasonArcEpisode {
  return {
    number: n,
    title: "",
    theme: "",
    protocolModule: "",
    characterBreakthrough: "",
    characterCollision: "",
    mysteryProgression: "",
    revelation: "",
    cliffhanger: "",
    episode1Plant: "",
  };
}

function R4SeasonArcStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const existing = report.pass.seasonArc;
  const approved = !!existing?.approvedAt;
  const [episodes, setEpisodes] = useState<RedevSeasonArcEpisode[]>(
    existing?.episodes && existing.episodes.length === 8
      ? existing.episodes
      : Array.from({ length: 8 }, (_, i) => blankEpisode(i + 1))
  );
  // Persistent steering note. Replaces the old ephemeral `notes` local
  // state — survives reload, used by the next Regenerate, saved via
  // its OWN button so it never disturbs the arc's approval.
  const [steeringNote, setSteeringNote] = useState(existing?.steeringNote ?? "");
  // Pre-fill the SELVAJE supporting-module classifications when the
  // pass has none yet — Truth / Prediction + Isolation as supporting /
  // embedded beats per the showrunner's spec.
  const SUPPORTING_DEFAULT =
    `Truth / Prediction — Supporting / embedded beat. It functions after Observation has taught the group to see behavior and before later modules force consequence. It sharpens the group's ability to publicly name observable avoidance without turning the season into a confession structure. It can be embedded inside the middle-season pressure, especially around Episode 4 or Episode 5.\n\nIsolation — Supporting / embedded beat. It functions as a late-season internal pressure sequence around Paul's destabilization and the transition into Witness / Role Reversal. It removes the social receiver and exposes what each character's avoidance does when nobody is available to reward it. It should remain available as a late-season embedded sequence, not a full episode spine unless the arc later needs more internal pressure before Choice.`;
  const [supportingNotes, setSupportingNotes] = useState(
    existing?.supportingModuleUsageNotes ?? SUPPORTING_DEFAULT
  );
  const [justSaved, setJustSaved] = useState(false);
  const [justSavedSteering, setJustSavedSteering] = useState(false);
  const [justSavedSupporting, setJustSavedSupporting] = useState(false);
  // Generation Quality Check from the last R4 generate. Renders above
  // the episode cards so the showrunner sees what the auditor checked.
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  // Read-only audit of the CURRENT saved arc (no regeneration). The
  // user can run this any time to see what the validator would flag
  // on what's currently stored. Setting this clears the lastAudit
  // (from the last Generate) so only one panel shows at a time.
  const [reviewAudit, setReviewAudit] = useState<RedevAuditReport | null>(null);
  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevSeasonArc(projectId, passId),
    onSuccess: (data) => {
      setReviewAudit(data.audit);
      setLastAudit(null);
    },
  });

  const generate = useMutation({
    mutationFn: () =>
      api.generateRedevSeasonArc(projectId, passId, {
        notes: steeringNote.trim() || undefined,
      }),
    onSuccess: async (data) => {
      setEpisodes(data.episodes);
      setLastAudit(data.audit ?? null);
      // Carry the persisted steeringNote + supportingNotes through
      // when persisting the freshly-generated episodes — so neither
      // metadata field is wiped by the immediate save.
      await api.saveRedevSeasonArc(projectId, passId, data.episodes, {
        steeringNote,
        supportingModuleUsageNotes: supportingNotes,
      });
      onChange();
    },
  });
  const saveDraft = useMutation({
    mutationFn: () =>
      api.saveRedevSeasonArc(projectId, passId, episodes, {
        steeringNote,
        supportingModuleUsageNotes: supportingNotes,
      }),
    onSuccess: () => {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      onChange();
    },
  });
  // Metadata-only saves. Each PUTs the CURRENT episodes (so the
  // episode payload hash is unchanged and the server preserves the
  // arc's approval) plus the one metadata field being changed.
  const saveSteeringNote = useMutation({
    mutationFn: () =>
      api.saveRedevSeasonArc(projectId, passId, episodes, { steeringNote }),
    onSuccess: () => {
      setJustSavedSteering(true);
      setTimeout(() => setJustSavedSteering(false), 2500);
      onChange();
    },
  });
  const saveSupportingNotes = useMutation({
    mutationFn: () =>
      api.saveRedevSeasonArc(projectId, passId, episodes, {
        supportingModuleUsageNotes: supportingNotes,
      }),
    onSuccess: () => {
      setJustSavedSupporting(true);
      setTimeout(() => setJustSavedSupporting(false), 2500);
      onChange();
    },
  });
  const approve = useMutation({
    mutationFn: async () => {
      await saveDraft.mutateAsync();
      return api.approveRedevSeasonArc(projectId, passId);
    },
    onSuccess: onChange,
  });

  const populated = episodes.some(
    (e) => e.title || e.theme || e.protocolModule || e.cliffhanger
  );

  return (
    <div className="space-y-4">
      <Panel
        eyebrow={STAGE_LABEL["r4_season_arc"]}
        title="Season One Arc Redesign"
        actions={
          <div className="flex items-center gap-3">
            {populated && (
              <CopyButton
                variant="outline"
                label="Copy whole arc"
                successLabel="Copied arc"
                title="Copy all 8 episodes as one Markdown document — paste into Notion / Docs / Slack / email."
                text={formatSeasonArcAsMarkdown(episodes, existing?.approvedAt)}
              />
            )}
            <div className="text-[11px]">
              {approved ? (
                <span className="text-emerald-300 inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Arc approved
                </span>
              ) : populated ? (
                <span className="text-amber-300">Drafted — not yet approved</span>
              ) : (
                <span className="text-bone-500">Not yet generated</span>
              )}
            </div>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Generate all 8 episodes in one cohesive design. Each episode is anchored
          to a Protocol module and tracks the season's mysteries. Edits drop the
          arc's approval — re-approve after editing.
        </p>
        <div className="mt-3 rounded border border-sky-700/30 bg-sky-900/10 px-3 py-2 text-[11px] text-sky-100">
          <strong>Gate:</strong> R5 Pilot Strategy unlocks only when this arc is approved.
        </div>

        <div className="mt-4 space-y-2">
          {/* Persistent steering notes — saved via its own button so
              it never affects the arc's approval. Used by the next
              Regenerate. */}
          <div className="rounded border border-amber-700/30 bg-amber-900/10 p-3">
            <label className="text-[11px] block">
              <span className="text-amber-200 uppercase tracking-wide font-medium">
                Steering notes for next regeneration
              </span>
              <span className="text-amber-200/70 ml-2 normal-case tracking-normal">
                — persistent. Saving the note does NOT drop the arc's approval.
              </span>
              <textarea
                value={steeringNote}
                onChange={(e) => setSteeringNote(e.target.value)}
                rows={3}
                placeholder="e.g. 'Push Nadia's sister mystery into episode 2, not episode 5.' / 'Keep Paul's reveal in EP07; do not surface earlier.'"
                className="mt-1 w-full rounded border border-amber-700/30 bg-black/30 px-2 py-1.5 text-sm text-bone-100 placeholder:text-bone-500"
              />
            </label>
            <div className="mt-1 flex items-center gap-2">
              <Button
                variant={justSavedSteering ? "primary" : "outline"}
                onClick={() => saveSteeringNote.mutate()}
                disabled={
                  saveSteeringNote.isPending ||
                  justSavedSteering ||
                  steeringNote === (existing?.steeringNote ?? "")
                }
                className={
                  justSavedSteering
                    ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                    : undefined
                }
                title="Persist the steering note. Doesn't touch the arc's approval — just saves the note for the next Regenerate."
              >
                {saveSteeringNote.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : justSavedSteering ? (
                  <Check className="h-4 w-4 text-emerald-200" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveSteeringNote.isPending
                  ? "Saving note…"
                  : justSavedSteering
                    ? "Note saved"
                    : "Save steering note"}
              </Button>
            </div>
          </div>
          {/* Supporting / Embedded Module Usage — classify approved R3
              modules that aren't used as primary anchors. The R4
              audit counts modules as accounted-for if their name
              appears here (case-insensitive) OR as a primary on an
              episode. Metadata only — never drops approval. */}
          <div className="rounded border border-sky-700/30 bg-sky-900/10 p-3">
            <label className="text-[11px] block">
              <span className="text-sky-200 uppercase tracking-wide font-medium">
                Supporting / Embedded Module Usage
              </span>
              <span className="text-sky-200/70 ml-2 normal-case tracking-normal">
                — classify approved R3 modules that aren't primary anchors. The audit passes when every approved module is named here or appears as a primary episode anchor.
              </span>
              <textarea
                value={supportingNotes}
                onChange={(e) => setSupportingNotes(e.target.value)}
                rows={8}
                placeholder={
                  "One short paragraph per module. Examples:\n\n" +
                  "Truth / Prediction — Supporting / embedded beat. Embedded inside mid-season pressure (EP04–05) after Observation has taught the group to see behavior.\n\n" +
                  "Isolation — Supporting / embedded beat. Late-season internal pressure around Paul's destabilization, ahead of Witness / Role Reversal."
                }
                className="mt-1 w-full rounded border border-sky-700/30 bg-black/30 px-2 py-1.5 text-sm text-bone-100 placeholder:text-bone-500 font-mono leading-snug"
              />
            </label>
            <div className="mt-1 flex items-center gap-2">
              <Button
                variant={justSavedSupporting ? "primary" : "outline"}
                onClick={() => saveSupportingNotes.mutate()}
                disabled={
                  saveSupportingNotes.isPending ||
                  justSavedSupporting ||
                  supportingNotes === (existing?.supportingModuleUsageNotes ?? "")
                }
                className={
                  justSavedSupporting
                    ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                    : undefined
                }
                title="Save the module-usage classifications. Doesn't drop the arc's approval — the R4 audit will read these names when checking module accounting."
              >
                {saveSupportingNotes.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : justSavedSupporting ? (
                  <Check className="h-4 w-4 text-emerald-200" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveSupportingNotes.isPending
                  ? "Saving classifications…"
                  : justSavedSupporting
                    ? "Classifications saved"
                    : "Save module classifications"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || approved}
              variant={populated ? "outline" : "primary"}
            >
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {populated ? "Regenerate season arc" : "Generate season arc"}
            </Button>
            {populated && (
              <Button
                variant="outline"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                title="Run the R4 validator against the currently-saved arc WITHOUT regenerating. Read-only — nothing changes until you approve any edits yourself."
              >
                {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                {auditCurrent.isPending ? "Auditing…" : "Audit current arc"}
              </Button>
            )}
            {populated && !approved && (
              <>
                <Button
                  variant={justSaved ? "primary" : "outline"}
                  onClick={() => saveDraft.mutate()}
                  disabled={saveDraft.isPending || justSaved}
                  className={
                    justSaved
                      ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                      : undefined
                  }
                >
                  {saveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : justSaved ? <Check className="h-4 w-4 text-emerald-200" /> : <RefreshCw className="h-4 w-4" />}
                  {saveDraft.isPending ? "Saving…" : justSaved ? "Saved" : "Save edits"}
                </Button>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                  {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve season arc
                </Button>
              </>
            )}
            {(generate.error || saveDraft.error || approve.error) && (
              <div className="w-full text-xs text-red-300">
                {((generate.error || saveDraft.error || approve.error) as Error).message}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* Audit panel — shows either the audit from the LAST Generate
          (lastAudit) or the on-demand audit of the CURRENTLY SAVED
          arc (reviewAudit). Only one renders at a time so the user
          isn't comparing two panels. The on-demand audit panel adds
          a small "(read-only — nothing was changed)" note so it's
          unambiguous. */}
      {reviewAudit ? (
        <div className="space-y-2">
          <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-2 text-[11px] text-bone-300">
            Quality Check on the <strong>currently saved arc</strong>. This is read-only —
            nothing was regenerated or modified. Review the findings, then decide what to edit
            (use field-level edits in the episode cards below) or whether to Regenerate.
            <button
              type="button"
              onClick={() => setReviewAudit(null)}
              className="ml-2 underline text-bone-400 hover:text-bone-100"
            >
              dismiss
            </button>
          </div>
          <QualityCheckPanel audit={reviewAudit} collapsedByDefault={false} />
        </div>
      ) : lastAudit ? (
        <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
      ) : null}

      {episodes.map((e, i) => (
        <EpisodeCard
          key={e.number}
          ep={e}
          locked={approved}
          onChange={(next) => {
            const arr = [...episodes];
            arr[i] = next;
            setEpisodes(arr);
          }}
        />
      ))}
    </div>
  );
}

function EpisodeCard({
  ep,
  locked,
  onChange,
}: {
  ep: RedevSeasonArcEpisode;
  locked: boolean;
  onChange: (next: RedevSeasonArcEpisode) => void;
}) {
  const [open, setOpen] = useState(!ep.title);
  const populated = !!(ep.title || ep.theme || ep.protocolModule);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="w-full flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <span className="os-eyebrow os-eyebrow-gold">EP {String(ep.number).padStart(2, "0")}</span>
          <div className="text-base text-bone-50 truncate">{ep.title || "(untitled)"}</div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {populated && (
            <CopyButton
              text={formatEpisodeAsMarkdown(ep)}
              title={`Copy EP ${String(ep.number).padStart(2, "0")} — ${ep.title || "(untitled)"} as Markdown.`}
            />
          )}
          <div className="text-[11px] text-bone-400 truncate max-w-[40ch]">
            {ep.protocolModule || (populated ? "no module set" : "not yet drafted")}
          </div>
        </div>
      </div>
      {open && (
        <div className="mt-4 space-y-3 border-t border-white/8 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <EpField label="Title" sub="Working title — evocative, not generic." value={ep.title} setter={(v) => onChange({ ...ep, title: v })} locked={locked} rows={1} />
            <EpField label="Protocol module" sub="Name from your approved R3 modules." value={ep.protocolModule} setter={(v) => onChange({ ...ep, protocolModule: v })} locked={locked} rows={1} />
            <EpField label="Episode theme" sub="The truth this episode pressures." value={ep.theme} setter={(v) => onChange({ ...ep, theme: v })} locked={locked} rows={3} />
            <EpField label="Character breakthrough" sub="Whose strategy cracks, and HOW it shows." value={ep.characterBreakthrough} setter={(v) => onChange({ ...ep, characterBreakthrough: v })} locked={locked} rows={3} />
            <EpField label="Character collision" sub="Which two principals collide, and over what." value={ep.characterCollision} setter={(v) => onChange({ ...ep, characterCollision: v })} locked={locked} rows={3} />
            <EpField label="Mystery progression" sub="What advances on primary / secondary mystery." value={ep.mysteryProgression} setter={(v) => onChange({ ...ep, mysteryProgression: v })} locked={locked} rows={3} />
            <EpField label="Revelation / perspective shift" sub="What the audience now sees differently." value={ep.revelation} setter={(v) => onChange({ ...ep, revelation: v })} locked={locked} rows={3} />
            <EpField label="Cliffhanger" sub="What the exercise REVEALS — not a stunt." value={ep.cliffhanger} setter={(v) => onChange({ ...ep, cliffhanger: v })} locked={locked} rows={3} />
            <EpField label="What Episode 1 must plant" sub="Specific thing the pilot must establish." value={ep.episode1Plant} setter={(v) => onChange({ ...ep, episode1Plant: v })} locked={locked} rows={3} cols={2} />
          </div>
        </div>
      )}
    </div>
  );
}

function EpField({
  label,
  sub,
  value,
  setter,
  locked,
  rows,
  cols,
}: {
  label: string;
  sub: string;
  value: string;
  setter: (v: string) => void;
  locked: boolean;
  rows: number;
  cols?: number;
}) {
  return (
    <label className={cols === 2 ? "block md:col-span-2" : "block"}>
      <div className="text-[11px] uppercase tracking-wide text-bone-400">{label}</div>
      <div className="text-[11px] text-bone-500 mb-1">{sub}</div>
      <textarea
        value={value}
        onChange={(e) => setter(e.target.value)}
        rows={rows}
        disabled={locked}
        className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm leading-snug disabled:opacity-70"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// R5 — Pilot Rewrite Strategy
// ---------------------------------------------------------------------------
// Nine free-text strategy buckets that R6 will execute. The agent reads
// the existing EP01 draft (if any) so recommendations can cite specific
// scenes. UI exposes:
//   • Generate / Regenerate (grounded in R1-R4 + live EP01 scenes)
//   • Audit current strategy (read-only)
//   • Per-bucket editing
//   • Persistent steering note (own Save — does not drop approval)
//   • Save edits / Approve

const R5_BUCKETS: Array<{
  key: keyof RedevPilotStrategy;
  label: string;
  hint: string;
}> = [
  {
    key: "whatMustChange",
    label: "What must change",
    hint: "Beats/scenes that contradict the new architecture. Cite scene slugs when possible.",
  },
  {
    key: "whatMustRemain",
    label: "What must remain",
    hint: "Beats/scenes the rewrite must KEEP intact (they already serve the new architecture).",
  },
  {
    key: "newSeedsToPlant",
    label: "New seeds to plant",
    hint: "Every R4 episode1Plant the pilot must establish. Concrete, not vague.",
  },
  {
    key: "oldBeatsToRemove",
    label: "Old beats to remove",
    hint: "Specific beats currently in the pilot that belong to the prior version of the show.",
  },
  {
    key: "characterIntroAdjustments",
    label: "Character intro adjustments",
    hint: "How each principal's pilot intro must read as the START of their R2 arc.",
  },
  {
    key: "protocolPhilosophyMoments",
    label: "Protocol philosophy moments",
    hint: "2-4 places the pilot must put the Protocol philosophy on screen (precept, fragment, exercise).",
  },
  {
    key: "mysteryPlants",
    label: "Mystery plants",
    hint: "Pilot-specific plants for the primary / secondary mysteries from R1.",
  },
  {
    key: "characterArcPlants",
    label: "Character arc plants",
    hint: "Pilot-specific plants for each character's season-revelation arc.",
  },
  {
    key: "finalHookOptions",
    label: "Final hook options",
    hint: "2-4 distinct candidate pilot endings. Format each 'Option A: …', 'Option B: …'.",
  },
];

const EMPTY_STRATEGY: Omit<RedevPilotStrategy, "approvedAt"> = {
  whatMustChange: [],
  whatMustRemain: [],
  newSeedsToPlant: [],
  oldBeatsToRemove: [],
  characterIntroAdjustments: [],
  protocolPhilosophyMoments: [],
  mysteryPlants: [],
  characterArcPlants: [],
  finalHookOptions: [],
};

function formatPilotStrategyAsMarkdown(
  s: Omit<RedevPilotStrategy, "approvedAt">,
  approvedAt?: string | null
): string {
  const lines: string[] = [];
  lines.push("# Pilot Rewrite Strategy");
  if (approvedAt) {
    lines.push(`*Approved ${new Date(approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  for (const b of R5_BUCKETS) {
    const items = (s[b.key] as string[]) ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${b.label}`);
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function R5PilotStrategyStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const existing = report.pass.pilotStrategy;
  const approved = !!existing?.approvedAt;
  const [strategy, setStrategy] = useState<Omit<RedevPilotStrategy, "approvedAt">>(
    existing
      ? {
          whatMustChange: existing.whatMustChange ?? [],
          whatMustRemain: existing.whatMustRemain ?? [],
          newSeedsToPlant: existing.newSeedsToPlant ?? [],
          oldBeatsToRemove: existing.oldBeatsToRemove ?? [],
          characterIntroAdjustments: existing.characterIntroAdjustments ?? [],
          protocolPhilosophyMoments: existing.protocolPhilosophyMoments ?? [],
          mysteryPlants: existing.mysteryPlants ?? [],
          characterArcPlants: existing.characterArcPlants ?? [],
          finalHookOptions: existing.finalHookOptions ?? [],
          steeringNote: existing.steeringNote,
          anchorScriptId: existing.anchorScriptId,
        }
      : { ...EMPTY_STRATEGY }
  );
  const [steeringNote, setSteeringNote] = useState(existing?.steeringNote ?? "");
  const [justSaved, setJustSaved] = useState(false);
  const [justSavedSteering, setJustSavedSteering] = useState(false);
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [reviewAudit, setReviewAudit] = useState<RedevAuditReport | null>(null);
  const [pilotContext, setPilotContext] = useState<{
    hasDraft: boolean;
    draftNumber: number | null;
    sceneCount: number;
  } | null>(null);

  // Suggested Strategy Brief — deterministically composed from approved
  // R1-R4 + EP01. Fetched on mount so the user sees the recommended
  // steering text immediately. The user can: Use → drops it into the
  // steering field; Regenerate → re-fetches (cheap, no LLM); Edit
  // Manually → toggles the brief panel into edit mode; Clear → wipes the
  // steering field.
  const [suggestedBrief, setSuggestedBrief] = useState<string>("");
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefVisible, setBriefVisible] = useState(true);
  const suggestQuery = useQuery({
    queryKey: ["redev-suggested-brief", projectId, passId],
    queryFn: () => api.suggestRedevPilotStrategyBrief(projectId, passId),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (suggestQuery.data?.brief && !suggestedBrief) {
      setSuggestedBrief(suggestQuery.data.brief);
    }
    // We want the fetched brief to seed the local copy ONCE per mount —
    // subsequent regenerations are handled by `regenSuggestedBrief`
    // below. (Don't depend on suggestedBrief; that would re-run.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestQuery.data?.brief]);
  const regenSuggestedBrief = useMutation({
    mutationFn: () => api.suggestRedevPilotStrategyBrief(projectId, passId),
    onSuccess: (data) => {
      setSuggestedBrief(data.brief);
      setBriefEditing(false);
    },
  });

  const generate = useMutation({
    // If the steering note is empty, fall back to the suggested brief.
    // This is the user's spec: "the user should never have to manually
    // type obvious context that already exists in the project."
    mutationFn: () => {
      const note =
        steeringNote.trim() || suggestedBrief.trim() || undefined;
      return api.generateRedevPilotStrategy(projectId, passId, {
        notes: note,
      });
    },
    onSuccess: async (data) => {
      setStrategy(data.strategy);
      setLastAudit(data.audit ?? null);
      setPilotContext(data.pilotContext);
      // Persist the freshly-generated strategy, carrying steeringNote
      // through so the metadata field isn't wiped by the immediate save.
      await api.saveRedevPilotStrategy(projectId, passId, {
        ...data.strategy,
        steeringNote,
      });
      onChange();
    },
  });

  const saveDraft = useMutation({
    mutationFn: () =>
      api.saveRedevPilotStrategy(projectId, passId, {
        ...strategy,
        steeringNote,
      }),
    onSuccess: () => {
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
      onChange();
    },
  });

  // Metadata-only steering save — sends the CURRENT strategy content so
  // the server's structural-equality check preserves approval.
  const saveSteeringNote = useMutation({
    mutationFn: () =>
      api.saveRedevPilotStrategy(projectId, passId, {
        ...strategy,
        steeringNote,
      }),
    onSuccess: () => {
      setJustSavedSteering(true);
      setTimeout(() => setJustSavedSteering(false), 2500);
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevPilotStrategy(projectId, passId),
    onSuccess: (data) => {
      setReviewAudit(data.audit);
      setLastAudit(null);
    },
  });

  const approve = useMutation({
    mutationFn: async () => {
      await saveDraft.mutateAsync();
      return api.approveRedevPilotStrategy(projectId, passId);
    },
    onSuccess: onChange,
  });

  const populated = R5_BUCKETS.some(
    (b) => (strategy[b.key] as string[]).length > 0
  );

  // Has the user made content edits since the last server save? Compare
  // the nine content lists (key-order-independent). Metadata fields
  // (steeringNote / anchorScriptId) are excluded — they have their own
  // Save button. Drives both the auto-save effect and the inline
  // status indicator next to the buckets.
  const hasUnsavedEdits = useMemo(() => {
    if (!existing) return populated;
    for (const b of R5_BUCKETS) {
      const cur = strategy[b.key] as string[];
      const sav = (existing as unknown as Record<string, string[]>)[
        b.key as string
      ] ?? [];
      if (cur.length !== sav.length) return true;
      for (let i = 0; i < cur.length; i++) {
        if ((cur[i] ?? "") !== (sav[i] ?? "")) return true;
      }
    }
    return false;
  }, [strategy, existing, populated]);

  // Debounced auto-save. Fires ~1.2s after the user stops editing.
  // Safe because:
  //   • Buckets are locked in BucketCard when `approved`, so no auto-save
  //     can happen on an approved strategy → no approval gets dropped.
  //   • The save mutation is idempotent — sending the same content twice
  //     is a no-op on the server.
  //   • The effect re-runs whenever strategy changes, so each keystroke
  //     resets the timer (true debounce).
  // We track auto-save status separately so the indicator can show
  // "Saving…", "Auto-saved", or "Unsaved edits" — but never "missing
  // save click" because the click is no longer required.
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  const autoSaveMutate = saveDraft.mutate;
  useEffect(() => {
    if (approved) return;
    if (!hasUnsavedEdits) return;
    const t = setTimeout(() => {
      autoSaveMutate(undefined, {
        onSuccess: () => setAutoSavedAt(Date.now()),
      });
    }, 1200);
    return () => clearTimeout(t);
    // Only re-run when the content or approval flag changes — we want
    // the timer to reset on each keystroke, but not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy, approved]);
  // Fade the "Auto-saved" pill after a few seconds so the UI doesn't
  // permanently advertise a stale save.
  useEffect(() => {
    if (autoSavedAt === null) return;
    const t = setTimeout(() => setAutoSavedAt(null), 3500);
    return () => clearTimeout(t);
  }, [autoSavedAt]);

  return (
    <div className="space-y-4">
      <Panel
        eyebrow={STAGE_LABEL["r5_pilot_strategy"]}
        title="Pilot Rewrite Strategy"
        actions={
          <div className="flex items-center gap-3">
            {populated && (
              <CopyButton
                variant="outline"
                label="Copy strategy"
                successLabel="Copied strategy"
                title="Copy the full strategy as Markdown — paste into Notion / Docs / Slack."
                text={formatPilotStrategyAsMarkdown(strategy, existing?.approvedAt)}
              />
            )}
            <div className="text-[11px]">
              {approved ? (
                <span className="text-emerald-300 inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" /> Strategy approved
                </span>
              ) : populated ? (
                <span className="text-amber-300">Drafted — not yet approved</span>
              ) : (
                <span className="text-bone-500">Not yet generated</span>
              )}
            </div>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Generate a strategic plan for rewriting the pilot. R5 reads your
          approved R1 brief, R2 character bibles, R3 protocol modules, and R4
          season arc — plus the live EP01 draft when one exists — and produces
          nine prioritized lists (what to change, what to keep, where to plant,
          where to land the hook). R6 will execute these lists; R5 plans them.
        </p>
        <div className="mt-3 rounded border border-sky-700/30 bg-sky-900/10 px-3 py-2 text-[11px] text-sky-100">
          <strong>Gate:</strong> R6 Pilot Rewrite unlocks only when this strategy is approved.
        </div>

        {pilotContext && (
          <div
            className={`mt-3 rounded border px-3 py-2 text-[11px] ${
              pilotContext.hasDraft
                ? "border-emerald-700/30 bg-emerald-900/10 text-emerald-100"
                : "border-amber-700/30 bg-amber-900/10 text-amber-100"
            }`}
          >
            {pilotContext.hasDraft ? (
              <>
                Grounded in EP01 Draft {pilotContext.draftNumber ?? "?"} —{" "}
                {pilotContext.sceneCount} scene
                {pilotContext.sceneCount === 1 ? "" : "s"} read. Specific scene
                callouts in the lists below reference that draft.
              </>
            ) : (
              <>
                No EP01 draft found. Recommendations will be principle-level —
                generate a pilot first if you want specific scene callouts.
              </>
            )}
          </div>
        )}

        <div className="mt-4 space-y-2">
          {/* Suggested Strategy Brief — deterministically composed from
              approved R1-R4 + EP01 context. The user never has to retype
              what they already approved. */}
          <div className="rounded border border-violet-700/40 bg-violet-900/10 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-300" />
                <span className="text-violet-200 uppercase tracking-wide font-medium text-[11px]">
                  Suggested Strategy Brief
                </span>
                {suggestQuery.isLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />
                )}
              </div>
              <button
                type="button"
                onClick={() => setBriefVisible((v) => !v)}
                className="text-[11px] text-violet-300 hover:text-violet-100 underline"
              >
                {briefVisible ? "hide" : "show"}
              </button>
            </div>
            <div className="mt-1 text-[11px] text-violet-200/80">
              Generated from your approved redevelopment architecture. You can
              edit this, but you do not need to.
            </div>
            {briefVisible && (
              <>
                {briefEditing ? (
                  <textarea
                    value={suggestedBrief}
                    onChange={(e) => setSuggestedBrief(e.target.value)}
                    rows={14}
                    className="mt-2 w-full rounded border border-violet-700/30 bg-black/30 px-2 py-1.5 text-sm text-bone-100 font-mono leading-snug"
                  />
                ) : (
                  <pre className="mt-2 max-h-72 overflow-auto rounded border border-violet-700/20 bg-black/20 px-3 py-2 text-[12px] text-bone-200 whitespace-pre-wrap leading-snug">
                    {suggestedBrief ||
                      (suggestQuery.isLoading
                        ? "Composing brief from R1-R4…"
                        : suggestQuery.data?.reason ??
                          "No brief available yet — approve R1 first.")}
                  </pre>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSteeringNote(suggestedBrief);
                      setBriefEditing(false);
                    }}
                    disabled={!suggestedBrief.trim()}
                    title="Drop the suggested brief into the steering note field below — that's what the next Generate will use."
                  >
                    <Check className="h-4 w-4" />
                    Use suggested brief
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => regenSuggestedBrief.mutate()}
                    disabled={regenSuggestedBrief.isPending}
                    title="Recompose the brief from the latest R1-R4 + EP01 state. Cheap — no LLM call."
                  >
                    {regenSuggestedBrief.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Regenerate brief
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setBriefEditing((v) => !v)}
                    title="Edit the suggested brief inline before using it."
                  >
                    <Pencil className="h-4 w-4" />
                    {briefEditing ? "Done editing" : "Edit manually"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setSuggestedBrief("")}
                    disabled={!suggestedBrief}
                    title="Clear the suggested brief. The next Generate will fall back to whatever's in the steering note (or nothing)."
                  >
                    Clear
                  </Button>
                </div>
                <div className="mt-2 text-[11px] text-violet-200/70 leading-snug">
                  Tip: if you leave the steering note empty below and click
                  Generate, the system will use this brief automatically — you
                  do not have to click "Use" first.
                </div>
              </>
            )}
          </div>

          {/* Persistent steering note — optional user override.
              Doesn't drop approval. */}
          <div className="rounded border border-amber-700/30 bg-amber-900/10 p-3">
            <label className="text-[11px] block">
              <span className="text-amber-200 uppercase tracking-wide font-medium">
                Steering notes for next regeneration
              </span>
              <span className="text-amber-200/70 ml-2 normal-case tracking-normal">
                — optional user override. If empty, Generate uses the suggested brief.
              </span>
              <textarea
                value={steeringNote}
                onChange={(e) => setSteeringNote(e.target.value)}
                rows={3}
                placeholder="(Leave empty to use the suggested brief above.) Or add a specific override, e.g. 'Lean harder on Margot reading the room before she sits.'"
                className="mt-1 w-full rounded border border-amber-700/30 bg-black/30 px-2 py-1.5 text-sm text-bone-100 placeholder:text-bone-500"
              />
            </label>
            <div className="mt-1 flex items-center gap-2">
              <Button
                variant={justSavedSteering ? "primary" : "outline"}
                onClick={() => saveSteeringNote.mutate()}
                disabled={
                  saveSteeringNote.isPending ||
                  justSavedSteering ||
                  steeringNote === (existing?.steeringNote ?? "")
                }
                className={
                  justSavedSteering
                    ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                    : undefined
                }
                title="Persist the steering note. Doesn't touch the strategy's approval — just saves the note for the next Regenerate."
              >
                {saveSteeringNote.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : justSavedSteering ? (
                  <Check className="h-4 w-4 text-emerald-200" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {saveSteeringNote.isPending
                  ? "Saving note…"
                  : justSavedSteering
                    ? "Note saved"
                    : "Save steering note"}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || approved}
              variant={populated ? "outline" : "primary"}
            >
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {populated ? "Regenerate pilot strategy" : "Generate pilot strategy"}
            </Button>
            {populated && (
              <Button
                variant="outline"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                title="Run the R5 validator against the currently-saved strategy WITHOUT regenerating."
              >
                {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                {auditCurrent.isPending ? "Auditing…" : "Audit current strategy"}
              </Button>
            )}
            {populated && !approved && (
              <>
                <Button
                  variant={justSaved ? "primary" : hasUnsavedEdits ? "primary" : "outline"}
                  onClick={() => saveDraft.mutate()}
                  disabled={saveDraft.isPending || justSaved}
                  className={
                    justSaved
                      ? "ring-1 ring-emerald-500/40 bg-emerald-700/20 text-emerald-100 border-emerald-700/40"
                      : hasUnsavedEdits
                        ? "ring-1 ring-amber-500/40"
                        : undefined
                  }
                >
                  {saveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : justSaved ? <Check className="h-4 w-4 text-emerald-200" /> : <RefreshCw className="h-4 w-4" />}
                  {saveDraft.isPending ? "Saving…" : justSaved ? "Saved" : "Save edits"}
                </Button>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                  {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve pilot strategy
                </Button>
                {/* Auto-save status pill. Three states:
                    • Saving — the debounced save is in flight
                    • Auto-saved — just persisted (fades after ~3.5s)
                    • Editing — user is mid-edit, save will fire ~1.2s after last keystroke
                    The explicit Save edits button remains as a save-now
                    fallback (and always reflects the same state). */}
                {saveDraft.isPending ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-amber-200">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving edits…
                  </span>
                ) : autoSavedAt !== null ? (
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                    Auto-saved
                  </span>
                ) : hasUnsavedEdits ? (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] text-amber-200"
                    title="Edits auto-save about a second after you stop typing. You can also click Save edits to save now."
                  >
                    <Loader2 className="h-3.5 w-3.5 opacity-60" />
                    Editing… (auto-saves in ~1s)
                  </span>
                ) : null}
              </>
            )}
            {(generate.error || saveDraft.error || approve.error || saveSteeringNote.error) && (
              <div className="w-full text-xs text-red-300">
                {((generate.error || saveDraft.error || approve.error || saveSteeringNote.error) as Error).message}
              </div>
            )}
          </div>
        </div>
      </Panel>

      {reviewAudit ? (
        <div className="space-y-2">
          <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-2 text-[11px] text-bone-300">
            Quality Check on the <strong>currently saved strategy</strong>. Read-only —
            nothing was regenerated.
            <button
              type="button"
              onClick={() => setReviewAudit(null)}
              className="ml-2 underline text-bone-400 hover:text-bone-100"
            >
              dismiss
            </button>
          </div>
          <QualityCheckPanel audit={reviewAudit} collapsedByDefault={false} />
        </div>
      ) : lastAudit ? (
        <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
      ) : null}

      {!approved && (
        <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-2 text-[11px] text-bone-400">
          Edits to the buckets below <strong>auto-save about a second after you
          stop typing</strong>. The "Save edits" button up top is a save-now
          fallback — you don't need to scroll back to use it. Approving the
          strategy locks all buckets.
        </div>
      )}

      {R5_BUCKETS.map((b) => (
        <BucketCard
          key={b.key as string}
          label={b.label}
          hint={b.hint}
          items={strategy[b.key] as string[]}
          locked={approved}
          onChange={(next) => setStrategy({ ...strategy, [b.key]: next })}
        />
      ))}
    </div>
  );
}

/** Editable list bucket. Each item is a one-or-multi-line strategy note.
 *  Locked when the strategy is approved — the user can still copy but not
 *  edit (matches the R4 episode-card pattern). */
function BucketCard({
  label,
  hint,
  items,
  locked,
  onChange,
}: {
  label: string;
  hint: string;
  items: string[];
  locked: boolean;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(items.length === 0 ? false : true);
  const populated = items.length > 0;
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="w-full flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
        >
          <div className="text-base text-bone-50 truncate">{label}</div>
          <span className="text-[11px] text-bone-500">
            {populated ? `${items.length} item${items.length === 1 ? "" : "s"}` : "empty"}
          </span>
        </button>
        {populated && (
          <CopyButton
            text={`## ${label}\n${items.map((i) => `- ${i}`).join("\n")}\n`}
            title={`Copy "${label}" as Markdown.`}
          />
        )}
      </div>
      <div className="mt-1 text-[11px] text-bone-500">{hint}</div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-white/8 pt-3">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <textarea
                value={item}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = e.target.value;
                  onChange(next);
                }}
                rows={Math.max(2, Math.ceil(item.length / 80))}
                disabled={locked}
                className="w-full rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-sm leading-snug disabled:opacity-70"
              />
              {!locked && (
                <button
                  type="button"
                  onClick={() => {
                    const next = items.filter((_, j) => j !== i);
                    onChange(next);
                  }}
                  className="shrink-0 text-[11px] text-bone-400 hover:text-red-300 underline px-1 py-1"
                  title="Remove this item"
                >
                  remove
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <Button
              variant="outline"
              onClick={() => onChange([...items, ""])}
              title="Add a new strategy item to this bucket."
            >
              <Plus className="h-4 w-4" />
              Add item
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// R6 — Guardrails Setup (rewrite generator not yet built)
// ---------------------------------------------------------------------------
//
// What this screen IS: a workflow for generating + reviewing +
// approving the per-character protection contracts (plants, do-not-
// reveal, do-not-do, execution rule) plus a global rewrite rule that
// the R6 rewrite generator will honor when it ships.
//
// What this screen is NOT: the actual pilot rewrite. R6 rewrite
// generation is intentionally NOT built yet — the user explicitly
// asked us to fix the guardrail UX before building the rewriter.
//
// The system already has R1 (brief), R2 (bibles), R3 (modules), R4
// (arc), R5 (strategy). The "Generate guardrails from approved
// strategy" button deterministically composes the bundle from all of
// that — the showrunner reviews & edits, then Approves. Manual
// construction is the fallback, not the default.

/** Format the full R6 guardrails bundle as portable Markdown — global
 *  rule + global plants + every per-character contract. Pastes cleanly
 *  into Notion / Docs / Slack / email. Empty sections are dropped. */
function formatR6GuardrailsAsMarkdown(
  bundle: {
    perCharacter: RedevR6Guardrail[];
    globalRule: string;
    globalPlants?: string[];
  },
  approvedAt?: string | null
): string {
  const lines: string[] = [];
  lines.push("# R6 — Pilot Rewrite Guardrails");
  if (approvedAt) {
    lines.push(`*Approved ${new Date(approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");

  if (bundle.globalRule.trim()) {
    lines.push("## Global rewrite rule");
    lines.push(bundle.globalRule.trim());
    lines.push("");
  }

  if ((bundle.globalPlants ?? []).length > 0) {
    lines.push("## Pilot-Level Guardrails (Global Plants)");
    lines.push(
      "_Concrete pilot-level plants not owned by any single character — archive room, transparent case, photograph wall, etc._"
    );
    for (const p of bundle.globalPlants!) lines.push(`- ${p}`);
    lines.push("");
  }

  for (const g of bundle.perCharacter) {
    const name = g.characterName.trim() || "(unnamed)";
    lines.push(`## ${name}`);
    if (g.plants.length > 0) {
      lines.push("### Plant in pilot");
      for (const p of g.plants) lines.push(`- ${p}`);
    }
    if (g.doNotReveal.length > 0) {
      lines.push("### Do NOT reveal");
      for (const p of g.doNotReveal) lines.push(`- ${p}`);
    }
    if (g.doNotDo.length > 0) {
      lines.push("### Do NOT do");
      for (const p of g.doNotDo) lines.push(`- ${p}`);
    }
    if (g.executionRule.trim()) {
      lines.push("### Execution rule");
      lines.push(g.executionRule.trim());
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

function R6PreRewriteStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  // R5 must be approved before R6 unlocks. The pass-report-level gate
  // is enforced server-side too — this is just a clearer client UX.
  const r5Approved = !!report.pass.pilotStrategy?.approvedAt;

  // Seed local state from server (normalized to bundle shape so we
  // handle the old bare-array storage gracefully).
  const storedBundle = useMemo(
    () => normalizeR6Guardrails(report.pass.r6Guardrails),
    [report.pass.r6Guardrails]
  );
  const [perCharacter, setPerCharacter] = useState<RedevR6Guardrail[]>(
    storedBundle.perCharacter
  );
  const [globalRule, setGlobalRule] = useState<string>(storedBundle.globalRule);
  const [globalPlants, setGlobalPlants] = useState<string[]>(
    storedBundle.globalPlants ?? []
  );
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const approved = !!storedBundle.approvedAt;

  // Has the user edited since the server's last copy?
  const hasUnsavedEdits = useMemo(() => {
    const storedPlants = storedBundle.globalPlants ?? [];
    if (
      perCharacter.length !== storedBundle.perCharacter.length ||
      globalRule !== storedBundle.globalRule ||
      globalPlants.length !== storedPlants.length
    ) {
      return true;
    }
    if (JSON.stringify(perCharacter) !== JSON.stringify(storedBundle.perCharacter)) return true;
    if (JSON.stringify(globalPlants) !== JSON.stringify(storedPlants)) return true;
    return false;
  }, [perCharacter, globalRule, globalPlants, storedBundle]);

  const save = useMutation({
    mutationFn: () =>
      api.saveRedevR6Guardrails(projectId, passId, {
        perCharacter,
        globalRule,
        globalPlants,
      }),
    onSuccess: () => {
      setAutoSavedAt(Date.now());
      onChange();
    },
  });

  // Debounced auto-save (matches the R5 pattern). Disabled while
  // approved so post-approval edits don't silently drop approval.
  const saveMutate = save.mutate;
  useEffect(() => {
    if (approved) return;
    if (!hasUnsavedEdits) return;
    const t = setTimeout(() => saveMutate(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perCharacter, globalRule, globalPlants, approved]);
  useEffect(() => {
    if (autoSavedAt === null) return;
    const t = setTimeout(() => setAutoSavedAt(null), 3500);
    return () => clearTimeout(t);
  }, [autoSavedAt]);

  // ----- mutations: generate / approve / audit ------------------------

  const generate = useMutation({
    mutationFn: () => api.generateRedevR6Guardrails(projectId, passId),
    onSuccess: async (data) => {
      setPerCharacter(data.bundle.perCharacter);
      setGlobalRule(data.bundle.globalRule);
      setGlobalPlants(data.bundle.globalPlants ?? []);
      // Persist the freshly-generated bundle so a reload sees it.
      await api.saveRedevR6Guardrails(projectId, passId, {
        perCharacter: data.bundle.perCharacter,
        globalRule: data.bundle.globalRule,
        globalPlants: data.bundle.globalPlants ?? [],
      });
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR6Guardrails(projectId, passId),
    onSuccess: (data) => setLastAudit(data.audit),
  });

  const approveBundle = useMutation({
    mutationFn: async () => {
      // Save any pending edits first; THEN approve. Approving with
      // unsaved edits would lock the on-disk version, not what the
      // user sees.
      if (hasUnsavedEdits) {
        await api.saveRedevR6Guardrails(projectId, passId, {
          perCharacter,
          globalRule,
        });
      }
      return api.approveRedevR6Guardrails(projectId, passId);
    },
    onSuccess: onChange,
  });

  // ----- R5-not-approved gate -----------------------------------------

  if (!r5Approved) {
    return (
      <Panel eyebrow={STAGE_LABEL["r6_pilot_rewrite"]} title="R6 — Locked">
        <div className="os-banner os-banner-locked">
          <div className="os-banner-icon">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="os-banner-title">Locked until R5 is approved</div>
            <div className="os-banner-sub">
              R6 unlocks when R5 Pilot Strategy is approved. Approve the
              strategy first, then return here to generate the per-character
              protection contracts the rewrite must honor.
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  // ----- render --------------------------------------------------------

  return (
    <div className="space-y-4">
      <Panel
        eyebrow={STAGE_LABEL["r6_pilot_rewrite"]}
        title={
          approved
            ? "R6 — Guardrails Approved"
            : "R6 — Guardrails Setup"
        }
        actions={
          <div className="flex items-center gap-3">
            {(perCharacter.length > 0 ||
              globalRule.trim() ||
              globalPlants.length > 0) && (
              <CopyButton
                variant="outline"
                label="Copy all guardrails"
                successLabel="Copied guardrails"
                title="Copy the whole bundle (global rule + global plants + every character contract) as Markdown — paste into Notion / Docs / Slack / email."
                text={formatR6GuardrailsAsMarkdown(
                  { perCharacter, globalRule, globalPlants },
                  storedBundle.approvedAt
                )}
              />
            )}
            {save.isPending ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-200">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving guardrails…
              </span>
            ) : autoSavedAt !== null ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                <Check className="h-3.5 w-3.5" />
                Auto-saved
              </span>
            ) : hasUnsavedEdits && !approved ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-200">
                <Loader2 className="h-3.5 w-3.5 opacity-60" />
                Editing… (auto-saves in ~1s)
              </span>
            ) : approved ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300">
                <Check className="h-3.5 w-3.5" /> Guardrails approved
              </span>
            ) : (
              <span className="text-[11px] text-bone-500">
                {perCharacter.length} character contract{perCharacter.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        }
      >
        {/* Top status card — explains exactly what state R6 is in. */}
        <div className="rounded border border-amber-700/30 bg-amber-900/10 p-3 text-[12px] text-amber-100 leading-snug">
          <strong>R6 rewrite generator is not built yet.</strong> This screen
          currently prepares the per-character protection contracts and the
          global rewrite rule that the rewrite generator will honor when it
          ships. {approved ? (
            <>The contracts are approved — the rewriter will read them as locked policy.</>
          ) : (
            <>Generate guardrails from your approved R1–R5 architecture, review,
            then Approve.</>
          )}
        </div>

        {/* Primary actions row. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || approved}
            variant={perCharacter.length === 0 ? "primary" : "outline"}
            title="Deterministically compose guardrails from approved R1 brief, R2 bibles, R3 modules, R4 arc, R5 strategy. No LLM cost. Replaces current draft."
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {perCharacter.length === 0
              ? "Generate guardrails from approved strategy"
              : "Regenerate guardrails"}
          </Button>
          {perCharacter.length > 0 && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
              title="Run the R6 guardrail validator against the currently-saved bundle. Read-only."
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit guardrails"}
            </Button>
          )}
          {perCharacter.length > 0 && !approved && (
            <Button
              onClick={() => approveBundle.mutate()}
              disabled={approveBundle.isPending}
              title="Lock the guardrails as policy. The rewrite generator will read approved guardrails when it runs."
            >
              {approveBundle.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve guardrails
            </Button>
          )}
          {/* Pass 1 generator — wired below in <R6RewritePlanSection />.
              The button there lives in its own panel so the user has a
              clear entrypoint distinct from the guardrails workflow. */}
          {(generate.error || approveBundle.error || auditCurrent.error || save.error) && (
            <div className="w-full text-xs text-red-300">
              {((generate.error || approveBundle.error || auditCurrent.error || save.error) as Error).message}
            </div>
          )}
        </div>

        {approved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Guardrails approved.</strong> R6 rewrite generator pending
            implementation. When it ships, it will read these contracts and
            forbid the items in <code>do NOT reveal</code> /{" "}
            <code>do NOT do</code> outright.
          </div>
        )}
      </Panel>

      {lastAudit && (
        <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
      )}

      {/* Global rewrite rule — applies to the whole pilot. */}
      <div className="rounded-lg border border-violet-700/30 bg-violet-900/10 p-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-violet-200 font-medium">
          <Sparkles className="h-4 w-4" />
          Global rewrite rule
        </div>
        <div className="mt-1 text-[11px] text-bone-400">
          Whole-pilot rule the rewrite must honor (engine, tone, hook direction, forbidden moves).
        </div>
        <textarea
          value={globalRule}
          onChange={(e) => setGlobalRule(e.target.value)}
          rows={7}
          disabled={approved}
          placeholder="Click 'Generate guardrails' to populate from approved R1–R5."
          className="mt-2 w-full rounded border border-violet-700/30 bg-black/30 text-bone-100 px-2 py-1.5 text-sm leading-snug disabled:opacity-70"
        />
      </div>

      {/* Pilot-Level Guardrails / Global Plants — concrete plants not
          owned by any single character. The strict generator routes
          architectural beats (archive room, transparent case, photograph
          wall) AND cross-character items here so per-character cards
          don't get polluted. */}
      <div className="rounded-lg border border-sky-700/30 bg-sky-900/10 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-sky-200 font-medium">
            <Sparkles className="h-4 w-4" />
            Pilot-Level Guardrails (Global Plants)
          </div>
          {globalPlants.length > 0 && (
            <CopyButton
              text={
                "## Pilot-Level Guardrails (Global Plants)\n" +
                globalPlants.map((p) => `- ${p}`).join("\n") +
                "\n"
              }
              title="Copy the Global Plants section as Markdown."
            />
          )}
        </div>
        <div className="mt-1 text-[11px] text-bone-400">
          Concrete pilot-level plants that aren't owned by any single
          character — archive room, transparent case, photograph wall, etc.
          Engine declarations and forbidden moves live in Global Rewrite Rule above.
        </div>
        <div className="mt-3 space-y-1.5">
          {globalPlants.map((p, i) => (
            <div key={i} className="flex items-start gap-2">
              <textarea
                value={p}
                onChange={(e) => {
                  const next = [...globalPlants];
                  next[i] = e.target.value;
                  setGlobalPlants(next);
                }}
                rows={2}
                disabled={approved}
                className="flex-1 rounded border border-sky-700/30 bg-black/20 text-bone-100 px-2 py-1 text-sm leading-snug disabled:opacity-70"
              />
              {!approved && (
                <button
                  type="button"
                  onClick={() =>
                    setGlobalPlants(globalPlants.filter((_, j) => j !== i))
                  }
                  className="shrink-0 text-[11px] text-bone-400 hover:text-red-300 underline px-1 py-1"
                >
                  remove
                </button>
              )}
            </div>
          ))}
          {globalPlants.length === 0 && (
            <div className="text-[11px] text-bone-500 italic">
              No global plants yet. Click "Generate guardrails" — architectural
              plants from R5 will land here automatically.
            </div>
          )}
          {!approved && (
            <button
              type="button"
              onClick={() => setGlobalPlants([...globalPlants, ""])}
              className="text-[11px] text-sky-300 underline"
            >
              + add global plant
            </button>
          )}
        </div>
      </div>

      {/* Per-character contracts. */}
      {perCharacter.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-bone-400">
          No guardrails yet. Click <strong className="text-bone-100">Generate
          guardrails from approved strategy</strong> above — the system will
          build contracts for every approved principal using R2 + R5 in seconds.
        </div>
      ) : (
        perCharacter.map((g, i) => (
          <GuardrailCard
            key={i}
            g={g}
            locked={approved}
            onChange={(next) => {
              const arr = [...perCharacter];
              arr[i] = next;
              setPerCharacter(arr);
            }}
            onRemove={() =>
              setPerCharacter(perCharacter.filter((_, j) => j !== i))
            }
          />
        ))
      )}

      {/* Manual-add escape hatch (still available, just not the
          primary path). */}
      {!approved && perCharacter.length > 0 && (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.01] p-4">
          <Button
            variant="outline"
            onClick={() =>
              setPerCharacter([
                ...perCharacter,
                {
                  characterName: "",
                  plants: [],
                  doNotReveal: [],
                  doNotDo: [],
                  executionRule: "",
                },
              ])
            }
          >
            <Plus className="h-4 w-4" />
            Add character guardrail (manual)
          </Button>
          <div className="mt-2 text-[11px] text-bone-500">
            Use this only if you need a contract for a character the auto-generator missed.
          </div>
        </div>
      )}

      {/* Pass 1 — Rewrite Plan. Lives at the bottom of R6 because it
          requires R6 guardrails approved before it can run. The section
          renders its own gate banner when guardrails aren't approved. */}
      <R6RewritePlanSection
        projectId={projectId}
        passId={passId}
        report={report}
        onChange={onChange}
      />
    </div>
  );
}

function GuardrailCard({
  g,
  locked = false,
  onChange,
  onRemove,
}: {
  g: RedevR6Guardrail;
  /** When approved, the card becomes read-only and the remove button hides. */
  locked?: boolean;
  onChange: (next: RedevR6Guardrail) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <input
          value={g.characterName}
          onChange={(e) => onChange({ ...g, characterName: e.target.value })}
          placeholder="Character name (e.g. Paul Beaumont)"
          disabled={locked}
          className="flex-1 rounded border border-white/10 bg-white/[0.04] text-bone-100 px-2 py-1 text-base font-medium disabled:opacity-70"
        />
        <div className="flex items-center gap-2 shrink-0 mt-1">
          <CopyButton
            text={formatR6GuardrailsAsMarkdown(
              { perCharacter: [g], globalRule: "" }
            )}
            title={`Copy ${g.characterName || "this contract"} as Markdown.`}
          />
          {!locked && (
            <button
              type="button"
              onClick={onRemove}
              className="text-[11px] text-bone-400 hover:text-red-300 underline px-1 py-1"
              title="Remove this guardrail entirely."
            >
              remove
            </button>
          )}
        </div>
      </div>

      <GuardrailList
        label="Plant in pilot"
        sub="Camera-visible behaviors the rewrite SHOULD plant."
        tone="emerald"
        items={g.plants}
        locked={locked}
        onChange={(next) => onChange({ ...g, plants: next })}
      />
      <GuardrailList
        label="Do NOT reveal"
        sub="Facts / reveals the rewrite must not expose in the pilot."
        tone="red"
        items={g.doNotReveal}
        locked={locked}
        onChange={(next) => onChange({ ...g, doNotReveal: next })}
      />
      <GuardrailList
        label="Do NOT do"
        sub="Executional moves the rewrite is forbidden from making."
        tone="red"
        items={g.doNotDo}
        locked={locked}
        onChange={(next) => onChange({ ...g, doNotDo: next })}
      />
      <label className="block">
        <div className="text-[11px] uppercase tracking-wide text-violet-300">
          Execution rule
        </div>
        <div className="text-[11px] text-bone-500 mb-1">
          One-line tonal instruction (e.g. "execute unease only").
        </div>
        <input
          value={g.executionRule}
          onChange={(e) => onChange({ ...g, executionRule: e.target.value })}
          disabled={locked}
          className="w-full rounded border border-violet-700/30 bg-black/30 text-bone-100 px-2 py-1 text-sm disabled:opacity-70"
        />
      </label>
    </div>
  );
}

function GuardrailList({
  label,
  sub,
  tone,
  items,
  locked = false,
  onChange,
}: {
  label: string;
  sub: string;
  tone: "emerald" | "red";
  items: string[];
  locked?: boolean;
  onChange: (next: string[]) => void;
}) {
  const labelColor =
    tone === "emerald" ? "text-emerald-300" : "text-red-300";
  const borderColor =
    tone === "emerald" ? "border-emerald-700/30" : "border-red-700/30";
  return (
    <div>
      <div className={`text-[11px] uppercase tracking-wide ${labelColor}`}>
        {label}
      </div>
      <div className="text-[11px] text-bone-500 mb-1">{sub}</div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2">
            <input
              value={it}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              disabled={locked}
              className={`flex-1 rounded border ${borderColor} bg-black/20 text-bone-100 px-2 py-1 text-sm disabled:opacity-70`}
            />
            {!locked && (
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="shrink-0 text-[11px] text-bone-400 hover:text-red-300 underline px-1 py-1"
              >
                remove
              </button>
            )}
          </div>
        ))}
        {!locked && (
          <button
            type="button"
            onClick={() => onChange([...items, ""])}
            className={`text-[11px] ${labelColor} underline`}
          >
            + add item
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// R6 Pass 1 — Rewrite Plan section
// ---------------------------------------------------------------------------
//
// Lives at the bottom of the R6 stage. Requires R6 guardrails approved
// before it can run. Workflow:
//   1. Click "Generate rewrite plan" → backend runs LLM agent with
//      R1-R5 + R6 + existing EP01 scenes → returns structured plan.
//   2. Review per-scene cards (action badge, change notes, targets,
//      character it serves).
//   3. Run audit (target coverage, Paul/Elena/Solano protections,
//      Surrender + final hook present, no screenplay text).
//   4. Approve plan → unlocks Pass 2 (scene-text generator, follow-up).

const ACTION_TONE: Record<RedevR6RewriteAction, { label: string; bg: string; text: string; border: string }> = {
  keep:   { label: "KEEP",   bg: "bg-bone-900/30",  text: "text-bone-300",     border: "border-bone-700/40" },
  revise: { label: "REVISE", bg: "bg-amber-900/20", text: "text-amber-200",    border: "border-amber-700/40" },
  move:   { label: "MOVE",   bg: "bg-sky-900/20",   text: "text-sky-200",      border: "border-sky-700/40" },
  merge:  { label: "MERGE",  bg: "bg-violet-900/20",text: "text-violet-200",   border: "border-violet-700/40" },
  cut:    { label: "CUT",    bg: "bg-red-900/20",   text: "text-red-200",      border: "border-red-700/40" },
  add:    { label: "ADD",    bg: "bg-emerald-900/20",text: "text-emerald-200", border: "border-emerald-700/40" },
};

function R6RewritePlanSection({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const guardrailsBundle = useMemo(
    () => normalizeR6Guardrails(report.pass.r6Guardrails),
    [report.pass.r6Guardrails]
  );
  const guardrailsApproved = !!guardrailsBundle.approvedAt;
  const storedRewrite = (report.pass as { pilotRewrite?: {
    priorScriptId?: string;
    plan?: RedevR6RewriteScenePlan[];
    approachSummary?: string;
    planApprovedAt?: string | null;
  } }).pilotRewrite ?? {};

  const [plan, setPlan] = useState<RedevR6RewriteScenePlan[]>(
    storedRewrite.plan ?? []
  );
  const [approachSummary, setApproachSummary] = useState<string>(
    storedRewrite.approachSummary ?? ""
  );
  const [priorScriptId, setPriorScriptId] = useState<string | null>(
    storedRewrite.priorScriptId ?? null
  );
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const planApproved = !!storedRewrite.planApprovedAt;

  // Coverage stats — counts of seen targets vs total.
  const totalTargets = Object.keys(R6_REWRITE_TARGET_LABEL).length;
  const seenTargets = useMemo(() => {
    const set = new Set<RedevR6RewriteTarget>();
    for (const p of plan) for (const t of p.targets ?? []) set.add(t);
    return set;
  }, [plan]);

  const generate = useMutation({
    mutationFn: () => api.generateRedevR6RewritePlan(projectId, passId, {}),
    onSuccess: async (data) => {
      setPlan(data.plan);
      setApproachSummary(data.approachSummary);
      setPriorScriptId(data.priorScriptId);
      setLastAudit(data.audit);
      await api.saveRedevR6RewritePlan(projectId, passId, {
        plan: data.plan,
        approachSummary: data.approachSummary,
        priorScriptId: data.priorScriptId,
      });
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR6RewritePlan(projectId, passId),
    onSuccess: (data) => setLastAudit(data.audit),
  });

  const approvePlan = useMutation({
    mutationFn: () => api.approveRedevR6RewritePlan(projectId, passId),
    onSuccess: onChange,
  });

  if (!guardrailsApproved) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-start gap-3">
          <Lock className="h-5 w-5 text-bone-400 mt-0.5 shrink-0" />
          <div className="text-sm text-bone-300 leading-relaxed">
            <strong>Rewrite generator (Pass 1) locked.</strong> Approve R6
            Guardrails above to unlock the plan generator. Pass 1 produces a
            scene-by-scene rewrite plan; Pass 2 (scene text) follows once the
            plan is approved.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="R6 · Pass 1"
        title={planApproved ? "Rewrite plan — Approved" : "Rewrite plan"}
        actions={
          <div className="flex items-center gap-3">
            {plan.length > 0 && (
              <CopyButton
                variant="outline"
                label="Copy plan"
                successLabel="Copied plan"
                title="Copy the rewrite plan as Markdown."
                text={formatR6RewritePlanAsMarkdown(plan, approachSummary, storedRewrite.planApprovedAt ?? null)}
              />
            )}
            <span className="text-[11px] text-bone-500">
              {plan.length} scene{plan.length === 1 ? "" : "s"} ·{" "}
              {seenTargets.size}/{totalTargets} targets covered
            </span>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Pass 1 produces a structural plan, not screenplay text. The LLM reads
          the existing EP01 + approved R1–R5 + approved R6 guardrails and decides
          for each scene whether to KEEP, REVISE, MOVE, MERGE, CUT, or ADD —
          plus which architectural targets each scene serves. Review the plan,
          run the audit, then Approve. Pass 2 (scene text) is locked until the
          plan is approved.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || planApproved}
            variant={plan.length === 0 ? "primary" : "outline"}
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {plan.length === 0 ? "Generate rewrite plan" : "Regenerate plan"}
          </Button>
          {plan.length > 0 && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit plan"}
            </Button>
          )}
          {plan.length > 0 && !planApproved && (
            <Button
              onClick={() => approvePlan.mutate()}
              disabled={approvePlan.isPending}
              title="Lock the plan. Pass 2 (scene text generator) will read this approved plan."
            >
              {approvePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve plan
            </Button>
          )}
          {(generate.error || auditCurrent.error || approvePlan.error) && (
            <div className="w-full text-xs text-red-300">
              {((generate.error || auditCurrent.error || approvePlan.error) as Error).message}
            </div>
          )}
        </div>

        {planApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Pass 1 plan approved.</strong> Generate the rewritten
            pilot in the Pass 2 section below.
          </div>
        )}

        {approachSummary && (
          <div className="mt-3 rounded border border-violet-700/30 bg-violet-900/10 px-3 py-2 text-[12px] text-bone-200">
            <div className="text-[11px] uppercase tracking-wide text-violet-300 mb-1">
              Approach summary
            </div>
            {approachSummary}
          </div>
        )}
      </Panel>

      {/* Target-coverage grid — quick visual of which architectural
          targets are covered by ≥1 scene. */}
      {plan.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="text-[11px] uppercase tracking-wide text-bone-400 mb-2">
            Architectural target coverage
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(R6_REWRITE_TARGET_LABEL) as RedevR6RewriteTarget[]).map((t) => {
              const covered = seenTargets.has(t);
              return (
                <span
                  key={t}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
                    covered
                      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
                      : "border-red-700/40 bg-red-900/20 text-red-200"
                  }`}
                  title={covered ? "Covered by at least one scene" : "Not yet covered — audit will warn"}
                >
                  {covered ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {R6_REWRITE_TARGET_LABEL[t]}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {lastAudit && (
        <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
      )}

      {plan.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-bone-400">
          No rewrite plan yet. Click <strong className="text-bone-100">Generate rewrite plan</strong> to compose one from your approved R1–R5 + R6 guardrails.
        </div>
      ) : (
        <div className="space-y-2">
          {plan.map((p, i) => (
            <PlanSceneCard key={i} p={p} />
          ))}
        </div>
      )}
      {/* Pass 2 — scene text generator. Only renders when Pass 1 plan
          is approved (the section enforces its own gate inside). */}
      <R6Pass2Section
        projectId={projectId}
        passId={passId}
        report={report}
        onChange={onChange}
        planApproved={planApproved}
        priorScriptId={priorScriptId}
      />
    </div>
  );
}

function PlanSceneCard({ p }: { p: RedevR6RewriteScenePlan }) {
  const tone = ACTION_TONE[p.action];
  const targetLabels = (p.targets ?? []).map(
    (t) => R6_REWRITE_TARGET_LABEL[t]
  );
  const sluglineToShow =
    p.action === "add"
      ? p.newSlugline ?? "(new scene)"
      : p.newSlugline ?? p.existingSlugline ?? "(no slug)";
  return (
    <div className={`rounded-lg border ${tone.border} bg-white/[0.02] p-3`}>
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center rounded ${tone.bg} ${tone.text} ${tone.border} border px-2 py-0.5 text-[11px] font-medium tracking-wide`}
        >
          {tone.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-bone-100 font-medium truncate">
            {p.existingSceneOrd != null && (
              <span className="text-bone-500 mr-2">
                #{p.existingSceneOrd}
              </span>
            )}
            {sluglineToShow}
          </div>
          {p.changeNotes && (
            <div className="mt-1 text-[12px] text-bone-300 leading-snug">
              {p.changeNotes}
            </div>
          )}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.action === "add" && p.insertAfterOrd != null && (
              <span className="text-[11px] text-bone-500">
                Insert after #{p.insertAfterOrd}
              </span>
            )}
            {p.action === "move" && p.insertAfterOrd != null && (
              <span className="text-[11px] text-bone-500">
                Move after #{p.insertAfterOrd}
              </span>
            )}
            {p.action === "merge" && p.mergeIntoOrd != null && (
              <span className="text-[11px] text-bone-500">
                Merge into #{p.mergeIntoOrd}
              </span>
            )}
            {targetLabels.map((t) => (
              <span
                key={t}
                className="inline-flex rounded bg-emerald-900/20 text-emerald-200 border border-emerald-700/40 px-1.5 py-0.5 text-[10px]"
              >
                {t}
              </span>
            ))}
            {(p.serves ?? []).map((s) => (
              <span
                key={s}
                className="inline-flex rounded bg-sky-900/20 text-sky-200 border border-sky-700/40 px-1.5 py-0.5 text-[10px]"
              >
                serves {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatR6RewritePlanAsMarkdown(
  plan: RedevR6RewriteScenePlan[],
  approachSummary: string,
  approvedAt?: string | null
): string {
  const lines: string[] = [];
  lines.push("# R6 Pass 1 — Pilot Rewrite Plan");
  if (approvedAt) {
    lines.push(`*Approved ${new Date(approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  if (approachSummary) {
    lines.push("## Approach summary");
    lines.push(approachSummary);
    lines.push("");
  }
  lines.push("## Plan (in pilot order)");
  for (const p of plan) {
    const head =
      p.action === "add"
        ? `**ADD** — ${p.newSlugline ?? "(new scene)"}`
        : `**${ACTION_TONE[p.action].label}** — #${p.existingSceneOrd ?? "?"} ${p.existingSlugline ?? ""}`;
    lines.push(`### ${head}`);
    if (p.changeNotes) lines.push(p.changeNotes);
    if (p.action === "add" && p.insertAfterOrd != null) {
      lines.push(`_Insert after #${p.insertAfterOrd}_`);
    }
    if (p.action === "move" && p.insertAfterOrd != null) {
      lines.push(`_Move after #${p.insertAfterOrd}_`);
    }
    if (p.action === "merge" && p.mergeIntoOrd != null) {
      lines.push(`_Merge into #${p.mergeIntoOrd}_`);
    }
    if (p.targets?.length) {
      lines.push(
        "Targets: " +
          p.targets.map((t) => R6_REWRITE_TARGET_LABEL[t]).join(", ")
      );
    }
    if (p.serves?.length) {
      lines.push("Serves: " + p.serves.join(", "));
    }
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// R6 Pass 2 — Scene text generator section
// ---------------------------------------------------------------------------
//
// Runs once Pass 1 plan is approved. One LLM call generates Fountain
// text for every REVISE/ADD/MERGE scene; KEEP/MOVE copy verbatim from
// the existing pilot; CUT drops. Server compiles + stores the proposed
// draft. Audit runs on the compiled text. Approve = insert as a new
// `scripts` row (Draft N+1) — the existing EP01 stays intact.

function R6Pass2Section({
  projectId,
  passId,
  report,
  onChange,
  planApproved,
  priorScriptId,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
  planApproved: boolean;
  priorScriptId: string | null;
}) {
  const rewrite = (report.pass as { pilotRewrite?: {
    proposedDraftText?: string | null;
    proposedDraftAt?: string | null;
    sceneActionSummary?: {
      kept: number;
      revised: number;
      moved: number;
      merged: number;
      cut: number;
      added: number;
    };
    approvedAt?: string | null;
    promotedScriptId?: string | null;
    promotedDraftNumber?: number | null;
  } }).pilotRewrite ?? {};

  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [missingPlanIndices, setMissingPlanIndices] = useState<number[] | null>(
    null
  );
  const [showFullDraft, setShowFullDraft] = useState(false);
  // Audit provenance — tells the showrunner exactly what the rendered
  // audit was generated FROM, so they can never confuse pre/post-repair
  // audits. Set every time `lastAudit` changes.
  const [auditMeta, setAuditMeta] = useState<{
    auditedAt: string;
    source: "generation" | "current_stored" | "repair";
    fountainLen?: number;
    bytesDelta?: number;
  } | null>(null);
  // Approve is gated by the audit. The user can explicitly override the
  // gate by toggling "I accept the remaining warnings" — that's the
  // explicit-approval-of-warnings path the showrunner spec requires.
  const [acceptWarnings, setAcceptWarnings] = useState(false);
  const auditWarningCount = (lastAudit?.checks ?? []).filter(
    (c) => c.status === "warning"
  ).length;
  const auditIsClean = lastAudit !== null && auditWarningCount === 0;
  const approveGated = !auditIsClean && !acceptWarnings;

  const generate = useMutation({
    mutationFn: () => api.generateRedevR6Pass2Draft(projectId, passId, {}),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: new Date().toISOString(),
        source: "generation",
      });
      setMissingPlanIndices(data.missingPlanIndices);
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR6Pass2Draft(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "current_stored",
        fountainLen: data.fountainLen,
      });
    },
  });

  const approveDraft = useMutation({
    mutationFn: () => api.approveRedevR6Pass2Draft(projectId, passId),
    onSuccess: () => onChange(),
  });

  if (!planApproved) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-start gap-3">
          <Lock className="h-5 w-5 text-bone-400 mt-0.5 shrink-0" />
          <div className="text-sm text-bone-300 leading-relaxed">
            <strong>Pass 2 locked.</strong> Approve the Pass 1 plan above to
            unlock scene-text generation. Pass 2 produces the compiled
            Fountain draft; approve to promote it as Draft N+1 (the existing
            EP01 stays intact).
          </div>
        </div>
      </div>
    );
  }

  const draft = rewrite.proposedDraftText ?? "";
  const summary = rewrite.sceneActionSummary;
  const draftApproved = !!rewrite.approvedAt;
  const promotedDraft = rewrite.promotedDraftNumber;

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="R6 · Pass 2"
        title={
          draftApproved
            ? `Pilot rewrite — Promoted as Draft ${promotedDraft ?? "?"}`
            : "Pilot rewrite — Scene text"
        }
        actions={
          <div className="flex items-center gap-3">
            {draft && (
              <CopyButton
                variant="outline"
                label="Copy draft"
                successLabel="Copied draft"
                title="Copy the rewritten pilot as Fountain text."
                text={draft}
              />
            )}
            {summary && (
              <span className="text-[11px] text-bone-500">
                K{summary.kept} R{summary.revised} M{summary.moved} ⇆{summary.merged} ✕{summary.cut} +{summary.added}
              </span>
            )}
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Pass 2 reads your approved Pass 1 plan + the existing EP01 +
          approved R1–R6 architecture. KEEP and MOVE scenes copy verbatim
          from the existing pilot; REVISE / ADD / MERGE scenes are generated
          by the agent; CUT scenes are dropped. The compiled draft is
          stored as a proposal — approving it inserts a new <code>scripts</code>
          row (Draft N+1). The original EP01 is preserved.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || draftApproved}
            variant={draft ? "outline" : "primary"}
            title="Run Pass 2 — generate scene text for REVISE/ADD/MERGE, copy KEEP/MOVE verbatim, compile to Fountain."
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {draft ? "Regenerate scene text" : "Generate scene text (Pass 2)"}
          </Button>
          {draft && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit rewritten pilot"}
            </Button>
          )}
          {draft && !draftApproved && (
            <Button
              onClick={() => approveDraft.mutate()}
              disabled={approveDraft.isPending || approveGated}
              title={
                approveGated
                  ? lastAudit
                    ? `${auditWarningCount} audit warning(s) outstanding. Run repair, or tick "Accept remaining warnings" to override.`
                    : "Run 'Audit rewritten pilot' first."
                  : "Promote the rewritten pilot to a new draft (Draft N+1). Does not touch the existing EP01."
              }
            >
              {approveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve & save as new draft
            </Button>
          )}
          {draft && !draftApproved && lastAudit && auditWarningCount > 0 && (
            <label
              className="inline-flex items-center gap-2 text-[11px] text-amber-200 cursor-pointer"
              title="Override the audit gate. Use this when warnings have been reviewed and accepted by the showrunner."
            >
              <input
                type="checkbox"
                checked={acceptWarnings}
                onChange={(e) => setAcceptWarnings(e.target.checked)}
              />
              Accept remaining {auditWarningCount} warning{auditWarningCount === 1 ? "" : "s"}
            </label>
          )}
          {(generate.error || auditCurrent.error || approveDraft.error) && (
            <div className="w-full text-xs text-red-300">
              {((generate.error || auditCurrent.error || approveDraft.error) as Error).message}
            </div>
          )}
        </div>

        {draftApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Rewritten pilot promoted.</strong> Saved as Draft{" "}
            {promotedDraft ?? "?"} on EP01. The original draft is preserved
            (not deleted — just marked non-current). Open Drafts to compare.
          </div>
        )}

        {missingPlanIndices && missingPlanIndices.length > 0 && (
          <div className="mt-3 rounded border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-100">
            <strong>Heads up:</strong> {missingPlanIndices.length} plan
            entries produced no scene text (likely truncation). Regenerate
            scene text or edit the missing scenes manually.
          </div>
        )}

        {summary && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-2 text-[12px]">
            <div className="rounded border border-bone-700/40 bg-bone-900/30 px-2 py-1.5 text-bone-300">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Kept</div>
              <div className="text-base font-medium text-bone-100">{summary.kept}</div>
            </div>
            <div className="rounded border border-amber-700/40 bg-amber-900/20 px-2 py-1.5 text-amber-200">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Revised</div>
              <div className="text-base font-medium text-amber-100">{summary.revised}</div>
            </div>
            <div className="rounded border border-sky-700/40 bg-sky-900/20 px-2 py-1.5 text-sky-200">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Moved</div>
              <div className="text-base font-medium text-sky-100">{summary.moved}</div>
            </div>
            <div className="rounded border border-violet-700/40 bg-violet-900/20 px-2 py-1.5 text-violet-200">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Merged</div>
              <div className="text-base font-medium text-violet-100">{summary.merged}</div>
            </div>
            <div className="rounded border border-red-700/40 bg-red-900/20 px-2 py-1.5 text-red-200">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Cut</div>
              <div className="text-base font-medium text-red-100">{summary.cut}</div>
            </div>
            <div className="rounded border border-emerald-700/40 bg-emerald-900/20 px-2 py-1.5 text-emerald-200">
              <div className="text-[10px] uppercase tracking-wide opacity-70">Added</div>
              <div className="text-base font-medium text-emerald-100">{summary.added}</div>
            </div>
          </div>
        )}
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {/* Audit source label — the showrunner asked for this so it's
              always obvious WHAT the audit was generated from. */}
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">
                Audit source:
              </strong>
              <span>
                {auditMeta.source === "repair"
                  ? "current repaired proposed draft"
                  : auditMeta.source === "current_stored"
                    ? "current stored proposed draft"
                    : "freshly-generated draft"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              {typeof auditMeta.fountainLen === "number" && (
                <>
                  <span className="text-bone-500">·</span>
                  <span>
                    {auditMeta.fountainLen.toLocaleString()} chars
                  </span>
                </>
              )}
              {typeof auditMeta.bytesDelta === "number" &&
                auditMeta.bytesDelta !== 0 && (
                  <>
                    <span className="text-bone-500">·</span>
                    <span
                      className={
                        auditMeta.bytesDelta > 0
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      Δ {auditMeta.bytesDelta > 0 ? "+" : ""}
                      {auditMeta.bytesDelta.toLocaleString()}
                    </span>
                  </>
                )}
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
                title="Reload the current stored proposed draft from the server and re-run the 15-check audit fresh."
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit current draft"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {/* Repair workflow — surgical injection of missing character
          plants. Lives between the audit panel and the draft preview so
          the user sees the failing checks above and the repair controls
          immediately below them. The approve button is intentionally
          gated by the audit state, so this panel is the natural next
          step when the audit reports missing plants. */}
      {draft && (
        <R6Pass2RepairPanel
          projectId={projectId}
          passId={passId}
          audit={lastAudit}
          onRepairComplete={(newAudit, meta) => {
            setLastAudit(newAudit);
            setAuditMeta({
              auditedAt: meta.auditedAt,
              source: "repair",
              fountainLen: meta.newLen,
              bytesDelta: meta.bytesDelta,
            });
          }}
          onChange={onChange}
        />
      )}

      {draft && (
        <DraftPreviewPanel
          title="Rewritten pilot — Fountain preview"
          text={draft}
          state={draftApproved ? "promoted" : "proposed"}
          draftNumber={promotedDraft ?? null}
          startExpanded={showFullDraft}
          footerHint={`Approving inserts as Draft N+1; existing EP01 preserved.${
            priorScriptId
              ? ` Anchored to prior script ${priorScriptId.slice(0, 8)}…`
              : ""
          }`}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// R6 Pass 2 Repair panel — surgical character-plant injection
// ---------------------------------------------------------------------------
//
// Maps the four warning audit checks onto the four locked repair target
// IDs and lets the showrunner pick which to repair. Calls the surgical
// repair endpoint; persists the result; re-runs the audit. Does NOT
// promote — promotion stays gated behind the Approve button in the
// parent section.

type R6Pass2RepairTargetId =
  | "margot_professional_structure"
  | "nadia_searching_behavior"
  | "claire_ritualized_grief"
  | "dean_usefulness";

const REPAIR_TARGET_BY_AUDIT_CHECK: Record<string, R6Pass2RepairTargetId> = {
  r6draft_margot_planted: "margot_professional_structure",
  r6draft_nadia_planted: "nadia_searching_behavior",
  r6draft_claire_planted: "claire_ritualized_grief",
  r6draft_dean_planted: "dean_usefulness",
};

const REPAIR_TARGET_LABEL: Record<R6Pass2RepairTargetId, string> = {
  margot_professional_structure: "Margot — professional / analytical structure",
  nadia_searching_behavior: "Nadia — searching behavior (no Elena reveal)",
  claire_ritualized_grief: "Claire — ritualized grief (no Marcus)",
  dean_usefulness: "Dean — usefulness / performed success",
};

const REPAIR_TARGET_SHORT: Record<R6Pass2RepairTargetId, string> = {
  margot_professional_structure:
    "Recorder, notebook, files, diagnostic observation. Analyze before feeling.",
  nadia_searching_behavior:
    "Scans rooms, studies staff boards, notices photograph wall, tracks Solano. No exposition.",
  claire_ritualized_grief:
    "Private ritual: folded object, careful handling, past-tense correction. No speech.",
  dean_usefulness:
    "Orients toward distress before it shows. Refills, manages the room with charm. Likable, not suspicious.",
};

function R6Pass2RepairPanel({
  projectId,
  passId,
  audit,
  onRepairComplete,
  onChange,
}: {
  projectId: string;
  passId: string;
  audit: RedevAuditReport | null;
  onRepairComplete: (
    newAudit: RedevAuditReport,
    meta: {
      auditedAt: string;
      newLen: number;
      bytesDelta: number;
    }
  ) => void;
  onChange: () => void;
}) {
  // Map audit warnings onto the 4 known repair targets. Only show
  // targets whose corresponding audit check is currently a warning.
  const warningTargetIds: R6Pass2RepairTargetId[] = useMemo(() => {
    if (!audit) return [];
    const set = new Set<R6Pass2RepairTargetId>();
    for (const c of audit.checks) {
      if (c.status === "warning" && REPAIR_TARGET_BY_AUDIT_CHECK[c.id]) {
        set.add(REPAIR_TARGET_BY_AUDIT_CHECK[c.id]);
      }
    }
    return Array.from(set);
  }, [audit]);

  // Selected repair targets — default to every warning target.
  const [selected, setSelected] = useState<Set<R6Pass2RepairTargetId>>(
    () => new Set(warningTargetIds)
  );
  // Keep the selection in sync if audit warnings change (e.g. after a
  // repair pass eliminates some warnings).
  useEffect(() => {
    setSelected(new Set(warningTargetIds));
  }, [warningTargetIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const [lastRepairResult, setLastRepairResult] = useState<{
    repairs: Array<{
      target: string;
      location: string;
      summary: string;
      verified: boolean;
    }>;
    unrepaired: string[];
    fullyRepaired: boolean;
    fountainChanged: boolean;
    bytesDelta: number;
    verification: Array<{
      target: string;
      claimed: boolean;
      verified: boolean;
      reason?: string;
    }>;
    auditedAt: string;
  } | null>(null);

  const repair = useMutation({
    mutationFn: () =>
      api.repairRedevR6Pass2Draft(projectId, passId, {
        targets: Array.from(selected),
      }),
    onSuccess: (data) => {
      // Defensive defaults — if the backend running is older than the
      // verification/transparency build, these fields will be missing.
      // Coalesce so the UI still renders instead of crashing on
      // undefined.toLocaleString().
      const safeBytesDelta =
        typeof data.bytesDelta === "number" ? data.bytesDelta : 0;
      const safeAuditedAt = data.auditedAt ?? new Date().toISOString();
      const safeNewLen =
        typeof data.newLen === "number"
          ? data.newLen
          : (data.compiledFountain?.length ?? 0);
      setLastRepairResult({
        repairs: data.repairs ?? [],
        unrepaired: data.unrepaired ?? [],
        fullyRepaired: !!data.fullyRepaired,
        fountainChanged: data.fountainChanged ?? safeBytesDelta !== 0,
        bytesDelta: safeBytesDelta,
        verification: data.verification ?? [],
        auditedAt: safeAuditedAt,
      });
      onRepairComplete(data.audit, {
        auditedAt: safeAuditedAt,
        newLen: safeNewLen,
        bytesDelta: safeBytesDelta,
      });
      onChange();
    },
  });

  // Nothing to render when there are no warnings AND no recent repair.
  if (warningTargetIds.length === 0 && !lastRepairResult) return null;

  return (
    <div className="os-banner os-banner-attn p-4 space-y-3 flex-col">
      <div className="flex items-center gap-2 w-full">
        <div className="os-banner-icon">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="os-banner-title flex-1">Surgical Plant Repair</div>
      </div>
      <div className="text-[12.5px] text-bone-300 leading-relaxed">
        Hard protections passed. These character plants are missing. Repair
        is <strong className="text-bone-100">surgical</strong> — only the
        selected plants get added; every passing protection (Paul, Elena,
        Solano, Surrender, final hook, no flashbacks / confession / therapy)
        stays locked. The audit re-runs automatically. The draft is NOT
        promoted — Approve stays gated.
      </div>

      {warningTargetIds.length > 0 ? (
        <div className="space-y-2 w-full">
          {warningTargetIds.map((t) => (
            <label
              key={t}
              className="flex items-start gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 cursor-pointer hover:bg-black/30 transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.has(t)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(t);
                  else next.delete(t);
                  setSelected(next);
                }}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-[12px] text-amber-100 font-medium">
                  {REPAIR_TARGET_LABEL[t]}
                </div>
                <div className="text-[11px] text-bone-400 mt-0.5">
                  {REPAIR_TARGET_SHORT[t]}
                </div>
              </div>
            </label>
          ))}
        </div>
      ) : (
        <div className="rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[12px] text-emerald-100">
          No outstanding plant warnings. All four character plants are
          satisfied.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => repair.mutate()}
          disabled={
            repair.isPending || selected.size === 0 || warningTargetIds.length === 0
          }
          variant="primary"
          title="Run the surgical repair LLM call on the CURRENT proposed draft. Adds only the selected plants. Does not promote the draft."
        >
          {repair.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {repair.isPending
            ? "Repairing…"
            : `Repair ${selected.size} selected plant${selected.size === 1 ? "" : "s"}`}
        </Button>
        {repair.error && (
          <div className="w-full text-xs text-red-300">
            {(repair.error as Error).message}
          </div>
        )}
      </div>

      {lastRepairResult && (
        <div className="space-y-2 border-t border-amber-700/30 pt-3">
          <div className="text-[11px] uppercase tracking-wide text-amber-200">
            Repair result
          </div>

          {/* Top-line draft-change signal — fountainChanged + bytesDelta.
              If the LLM returned the original document, the backend now
              throws and this won't render at all (handled by repair.error). */}
          <div className="rounded border border-bone-700/30 bg-black/20 px-3 py-2 text-[12px] text-bone-200">
            <strong className="text-bone-100">Proposed draft updated.</strong>{" "}
            {lastRepairResult.fountainChanged ? "Yes" : "No"} ·{" "}
            <span
              className={
                lastRepairResult.bytesDelta >= 0
                  ? "text-emerald-300"
                  : "text-amber-300"
              }
            >
              {lastRepairResult.bytesDelta >= 0 ? "+" : ""}
              {lastRepairResult.bytesDelta.toLocaleString()} chars
            </span>{" "}
            · audit re-run at{" "}
            <code>{new Date(lastRepairResult.auditedAt).toLocaleTimeString()}</code>
          </div>

          {/* Verification rows — one per requested target. Tells the
              showrunner which LLM claims passed deterministic verification
              and which didn't, so they're never told a repair succeeded
              when the document doesn't reflect it. */}
          {lastRepairResult.verification.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] uppercase tracking-wide text-amber-200">
                Per-target verification
              </div>
              {lastRepairResult.verification.map((v) => {
                const claim = lastRepairResult.repairs.find((r) => r.target === v.target);
                return (
                  <div
                    key={v.target}
                    className={`rounded border px-3 py-2 text-[12px] ${
                      v.verified
                        ? "border-emerald-700/30 bg-emerald-900/10 text-emerald-100"
                        : "border-red-700/30 bg-red-900/10 text-red-100"
                    }`}
                  >
                    <div className="font-medium flex items-center gap-2">
                      {v.verified ? (
                        <Check className="h-3.5 w-3.5 text-emerald-300" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-300" />
                      )}
                      {REPAIR_TARGET_LABEL[v.target as R6Pass2RepairTargetId] ?? v.target}
                    </div>
                    <div className="text-[11px] mt-0.5">
                      LLM claim: {v.claimed ? "applied" : "not reported"} ·
                      {" "}Audit verification: {v.verified ? "passed" : "FAILED"}
                    </div>
                    {claim?.location && v.verified && (
                      <div className="text-[11px] text-bone-400 mt-0.5">
                        Location: <code>{claim.location}</code>
                      </div>
                    )}
                    {claim?.summary && v.verified && (
                      <div className="text-[11px] text-bone-300 mt-1 leading-snug">
                        {claim.summary}
                      </div>
                    )}
                    {!v.verified && v.reason && (
                      <div className="text-[11px] mt-1 leading-snug">
                        {v.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {lastRepairResult.unrepaired.length > 0 && (
            <div className="rounded border border-red-700/30 bg-red-900/10 px-3 py-2 text-[12px] text-red-100">
              <div className="font-medium">
                {lastRepairResult.unrepaired.length} target(s) still unrepaired
                after this pass:
              </div>
              <ul className="mt-1 list-disc list-inside text-[11px]">
                {lastRepairResult.unrepaired.map((u) => (
                  <li key={u}>
                    {REPAIR_TARGET_LABEL[u as R6Pass2RepairTargetId] ?? u}
                  </li>
                ))}
              </ul>
              <div className="text-[11px] mt-1">
                Re-run the repair with a steering note naming a specific scene
                to host the plant, or edit the Fountain preview manually.
              </div>
            </div>
          )}
          <div className="text-[11px] text-bone-500">
            The audit panel above has been refreshed against the repaired draft.
            Approve stays disabled until the audit is clean — or until you
            explicitly accept the remaining warnings.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// R7 — Pilot Polish Pass (plan-only; apply ships next)
// ---------------------------------------------------------------------------
//
// R7 does NOT touch R1–R6. It diagnoses targeted polish opportunities
// on the PROMOTED EP01 draft so the showrunner can review + approve
// before Pass 2 (apply) generates the polished Fountain text.

const R7_CATEGORY_TONE: Record<RedevR7PolishCategory, { bg: string; text: string; border: string }> = {
  surrender_continuity:           { bg: "bg-amber-900/20",   text: "text-amber-200",   border: "border-amber-700/40" },
  notebook_recorder_object_logic: { bg: "bg-sky-900/20",     text: "text-sky-200",     border: "border-sky-700/40"   },
  dialogue_polish:                { bg: "bg-violet-900/20",  text: "text-violet-200",  border: "border-violet-700/40" },
  showrunner_note_prose:          { bg: "bg-red-900/20",     text: "text-red-200",     border: "border-red-700/40"   },
  episode_2_hook:                 { bg: "bg-emerald-900/20", text: "text-emerald-200", border: "border-emerald-700/40" },
};

function R7PolishStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  // Gate — R7 requires R6 Pass 2 promoted (approvedAt + promotedScriptId).
  const rewrite = (report.pass as { pilotRewrite?: {
    approvedAt?: string | null;
    promotedScriptId?: string | null;
    promotedDraftNumber?: number | null;
  } }).pilotRewrite ?? {};
  const r6Promoted = !!rewrite.approvedAt && !!rewrite.promotedScriptId;

  const stored = (report.pass as { r7Polish?: import("@/lib/api").RedevR7PolishPlan | null }).r7Polish ?? null;
  const [approachSummary, setApproachSummary] = useState<string>(
    stored?.approachSummary ?? ""
  );
  const [items, setItems] = useState<RedevR7PolishItem[]>(stored?.items ?? []);
  const [priorScriptId, setPriorScriptId] = useState<string>(
    stored?.priorScriptId ?? rewrite.promotedScriptId ?? ""
  );
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [auditMeta, setAuditMeta] = useState<{ auditedAt: string; source: "generation" | "current_stored" } | null>(null);
  const planApproved = !!stored?.planApprovedAt;

  const hasItems = items.length > 0;

  const generate = useMutation({
    mutationFn: () => api.generateRedevR7PolishPlan(projectId, passId, {}),
    onSuccess: async (data) => {
      setApproachSummary(data.approachSummary);
      setItems(data.items);
      setPriorScriptId(data.priorScriptId);
      setLastAudit(data.audit);
      setAuditMeta({ auditedAt: new Date().toISOString(), source: "generation" });
      await api.saveRedevR7PolishPlan(projectId, passId, {
        approachSummary: data.approachSummary,
        items: data.items,
        priorScriptId: data.priorScriptId,
      });
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR7PolishPlan(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "current_stored",
      });
    },
  });

  const approvePlan = useMutation({
    mutationFn: () => api.approveRedevR7PolishPlan(projectId, passId),
    onSuccess: onChange,
  });

  if (!r6Promoted) {
    return (
      <Panel eyebrow={STAGE_LABEL["r7_pilot_polish"]} title="R7 — Locked">
        <div className="os-banner os-banner-locked">
          <div className="os-banner-icon">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="os-banner-title">Awaiting R6 promotion</div>
            <div className="os-banner-sub">
              R7 unlocks after R6 Pass 2 is approved AND promoted as a new
              EP01 draft. Promote the rewrite first; then return here for
              the polish pass.
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <Panel
        eyebrow={STAGE_LABEL["r7_pilot_polish"]}
        title={planApproved ? "Polish plan — Approved" : "Pilot Polish Pass"}
        actions={
          <div className="flex items-center gap-3">
            {hasItems && (
              <CopyButton
                variant="outline"
                label="Copy plan"
                successLabel="Copied plan"
                title="Copy the polish plan as Markdown."
                text={formatR7PolishPlanAsMarkdown(items, approachSummary, stored?.planApprovedAt ?? null)}
              />
            )}
            <span className="text-[11px] text-bone-500">
              {hasItems
                ? `${items.length} polish item${items.length === 1 ? "" : "s"}`
                : "no plan yet"}
            </span>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          R7 polishes the promoted EP01 draft. It does <strong>not</strong>{" "}
          change R1–R6 architecture — no series rewrites, no module changes,
          no guardrail edits. It diagnoses targeted improvements in five
          areas: Surrender continuity, notebook/recorder object logic,
          dialogue polish, showrunner-note prose removal, and Episode 2
          hook strength. Pass 1 is plan-only — Pass 2 (scene-text apply)
          ships next, after you approve this plan.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || planApproved}
            variant={hasItems ? "outline" : "primary"}
            title="Run the R7 polish-plan agent on the promoted EP01 draft. Plan-level only — no screenplay text."
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {hasItems ? "Regenerate polish plan" : "Generate polish plan"}
          </Button>
          {hasItems && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit plan"}
            </Button>
          )}
          {hasItems && !planApproved && (
            <Button
              onClick={() => approvePlan.mutate()}
              disabled={approvePlan.isPending}
              title="Lock the polish plan. Pass 2 (scene-text apply) will read it."
            >
              {approvePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve polish plan
            </Button>
          )}
          {/* Pass 2 (apply) is wired in <R7Pass2Section /> below — that
              section is gated on planApproved and has its own buttons. */}
          {(generate.error || auditCurrent.error || approvePlan.error) && (
            <div className="w-full text-xs text-red-300">
              {((generate.error || auditCurrent.error || approvePlan.error) as Error).message}
            </div>
          )}
        </div>

        {planApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Polish plan approved.</strong> Apply the polish below to
            generate a new draft. Architecture stays locked.
          </div>
        )}

        {approachSummary && (
          <div className="mt-3 rounded border border-violet-700/30 bg-violet-900/10 px-3 py-2 text-[12px] text-bone-200">
            <div className="text-[11px] uppercase tracking-wide text-violet-300 mb-1">
              Approach summary
            </div>
            {approachSummary}
          </div>
        )}

        <div className="mt-2 text-[11px] text-bone-500">
          Anchored to script <code>{priorScriptId.slice(0, 8) || "?"}…</code>
          {rewrite.promotedDraftNumber != null && (
            <> · Draft {rewrite.promotedDraftNumber}</>
          )}
        </div>
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">Audit source:</strong>
              <span>
                {auditMeta.source === "current_stored"
                  ? "current stored polish plan"
                  : "freshly-generated polish plan"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {!hasItems ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-bone-400">
          No polish plan yet. Click <strong className="text-bone-100">Generate polish plan</strong> to diagnose touch-ups against the promoted EP01.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <R7PolishItemCard key={i} item={it} />
          ))}
        </div>
      )}

      {/* Pass 2 (apply) — runs only when plan is approved. Section
          enforces its own gate inside. */}
      <R7Pass2Section
        projectId={projectId}
        passId={passId}
        report={report}
        onChange={onChange}
        planApproved={planApproved}
      />
    </div>
  );
}

function R7PolishItemCard({ item }: { item: RedevR7PolishItem }) {
  const tone = R7_CATEGORY_TONE[item.category];
  return (
    <div className={`rounded-lg border ${tone.border} bg-white/[0.02] p-3`}>
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center rounded ${tone.bg} ${tone.text} ${tone.border} border px-2 py-0.5 text-[11px] font-medium tracking-wide`}
        >
          {R7_POLISH_CATEGORY_LABEL[item.category]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-bone-100 font-medium truncate">
            {item.existingSceneOrd != null && (
              <span className="text-bone-500 mr-2">#{item.existingSceneOrd}</span>
            )}
            {item.existingSlugline ?? (item.existingSceneOrd == null ? "(pilot-level)" : "(no slug)")}
          </div>
          <div className="mt-1 text-[12px] text-bone-300 leading-snug">
            <strong className="text-amber-200">Diagnosis: </strong>
            {item.diagnosis}
          </div>
          <div className="mt-1 text-[12px] text-bone-200 leading-snug">
            <strong className="text-emerald-300">Fix direction: </strong>
            {item.fixDirection}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {item.severity && (
              <span
                className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${
                  item.severity === "high"
                    ? "border-red-700/40 bg-red-900/20 text-red-200"
                    : item.severity === "medium"
                      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
                      : "border-bone-700/40 bg-bone-900/30 text-bone-300"
                }`}
              >
                {item.severity}
              </span>
            )}
            {item.scope && (
              <span className="inline-flex rounded bg-sky-900/20 text-sky-200 border border-sky-700/40 px-1.5 py-0.5 text-[10px]">
                {item.scope}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatR7PolishPlanAsMarkdown(
  items: RedevR7PolishItem[],
  approachSummary: string,
  approvedAt?: string | null
): string {
  const lines: string[] = [];
  lines.push("# R7 — Pilot Polish Plan");
  if (approvedAt) {
    lines.push(`*Approved ${new Date(approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  if (approachSummary) {
    lines.push("## Approach summary");
    lines.push(approachSummary);
    lines.push("");
  }
  lines.push("## Polish items");
  for (const it of items) {
    const head = it.existingSceneOrd != null
      ? `**[#${it.existingSceneOrd}]** ${it.existingSlugline ?? ""}`
      : `**[pilot-level]**`;
    const cat = R7_POLISH_CATEGORY_LABEL[it.category];
    lines.push(`### ${head} — ${cat}`);
    lines.push(`**Diagnosis.** ${it.diagnosis}`);
    lines.push(`**Fix direction.** ${it.fixDirection}`);
    if (it.severity) lines.push(`_Severity: ${it.severity}_`);
    if (it.scope) lines.push(`_Scope: ${it.scope}_`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// R7 Pass 2 — Apply polish plan as Draft N+1
// ---------------------------------------------------------------------------

const R7_REPLACEMENT_KIND_LABEL: Record<
  "action" | "dialogue" | "continuity_correction" | "removal",
  string
> = {
  action: "action",
  dialogue: "dialogue",
  continuity_correction: "continuity fix",
  removal: "removal",
};

const R7_REPLACEMENT_KIND_TONE: Record<
  "action" | "dialogue" | "continuity_correction" | "removal",
  string
> = {
  action: "border-emerald-700/40 bg-emerald-900/20 text-emerald-200",
  dialogue: "border-sky-700/40 bg-sky-900/20 text-sky-200",
  continuity_correction: "border-violet-700/40 bg-violet-900/20 text-violet-200",
  removal: "border-red-700/40 bg-red-900/20 text-red-200",
};

function R7Pass2Section({
  projectId,
  passId,
  report,
  onChange,
  planApproved,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
  planApproved: boolean;
}) {
  const polish = (report.pass as { r7Polish?: {
    polishedDraftText?: string | null;
    polishedDraftAt?: string | null;
    approvedAt?: string | null;
    promotedScriptId?: string | null;
    promotedDraftNumber?: number | null;
  } }).r7Polish ?? {};

  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [auditMeta, setAuditMeta] = useState<{
    auditedAt: string;
    source: "apply" | "current_stored";
    fountainLen?: number;
    bytesDelta?: number;
  } | null>(null);
  const [appliedRows, setAppliedRows] = useState<Array<{
    category: string;
    location: string;
    before: string;
    after: string;
    replacementKind: "action" | "dialogue" | "continuity_correction" | "removal";
  }> | null>(null);
  const [unappliedRows, setUnappliedRows] = useState<
    Array<{ itemIndex: number; reason: string }> | null
  >(null);
  const [showFullDraft, setShowFullDraft] = useState(false);
  const [acceptWarnings, setAcceptWarnings] = useState(false);

  const auditWarningCount = (lastAudit?.checks ?? []).filter(
    (c) => c.status === "warning"
  ).length;
  const auditIsClean = lastAudit !== null && auditWarningCount === 0;
  const approveGated = !auditIsClean && !acceptWarnings;

  const applyPolish = useMutation({
    mutationFn: () => api.applyRedevR7Polish(projectId, passId, {}),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "apply",
        fountainLen: data.newLen,
        bytesDelta: data.bytesDelta,
      });
      setAppliedRows(data.applied ?? []);
      setUnappliedRows(data.unapplied ?? []);
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR7PolishedDraft(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "current_stored",
      });
    },
  });

  const approveDraft = useMutation({
    mutationFn: () => api.approveRedevR7PolishedDraft(projectId, passId),
    onSuccess: () => onChange(),
  });

  if (!planApproved) {
    return (
      <div className="os-banner os-banner-locked">
        <div className="os-banner-icon">
          <Lock className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="os-banner-title">R7 Pass 2 locked</div>
          <div className="os-banner-sub">
            Approve the polish plan above to unlock apply. Pass 2 produces a
            new polished Fountain draft; approve to promote it as Draft N+1
            (the R6 rewrite stays intact).
          </div>
        </div>
      </div>
    );
  }

  const draft = polish.polishedDraftText ?? "";
  const draftApproved = !!polish.approvedAt;
  const promotedDraft = polish.promotedDraftNumber;

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="R7 · Pass 2"
        title={
          draftApproved
            ? `Polished pilot — Promoted as Draft ${promotedDraft ?? "?"}`
            : "Polished pilot — Apply polish plan"
        }
        actions={
          <div className="flex items-center gap-3">
            {draft && (
              <CopyButton
                variant="outline"
                label="Copy draft"
                successLabel="Copied draft"
                title="Copy the polished pilot as Fountain text."
                text={draft}
              />
            )}
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Pass 2 reads your approved polish plan + the promoted R6 rewrite +
          locked architecture. It applies ONLY the approved polish items —
          every replacement is filmable action, short character-specific
          dialogue, a cleaner continuity correction, or a removal. It does
          NOT replace showrunner-note prose with new showrunner-note prose.
          Approve to promote as Draft N+1; the R6 draft stays preserved.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => applyPolish.mutate()}
            disabled={applyPolish.isPending || draftApproved}
            variant={draft ? "outline" : "primary"}
            title="Apply the approved polish items — generates the polished Fountain draft and runs the R7 apply audit."
          >
            {applyPolish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {draft ? "Regenerate polish" : "Apply polish (Pass 2)"}
          </Button>
          {draft && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit polished draft"}
            </Button>
          )}
          {draft && !draftApproved && (
            <Button
              onClick={() => approveDraft.mutate()}
              disabled={approveDraft.isPending || approveGated}
              title={
                approveGated
                  ? lastAudit
                    ? `${auditWarningCount} audit warning(s) outstanding. Regenerate, or tick "Accept remaining warnings" to override.`
                    : "Run 'Audit polished draft' first."
                  : "Promote the polished pilot to a new draft (Draft N+1). Does not touch the R6 draft."
              }
            >
              {approveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve & save as Draft N+1
            </Button>
          )}
          {draft && !draftApproved && lastAudit && auditWarningCount > 0 && (
            <label
              className="inline-flex items-center gap-2 text-[11px] text-amber-200 cursor-pointer"
              title="Override the audit gate. Use this only when warnings have been reviewed and accepted by the showrunner."
            >
              <input
                type="checkbox"
                checked={acceptWarnings}
                onChange={(e) => setAcceptWarnings(e.target.checked)}
              />
              Accept remaining {auditWarningCount} warning{auditWarningCount === 1 ? "" : "s"}
            </label>
          )}
          {(applyPolish.error || auditCurrent.error || approveDraft.error) && (
            <div className="w-full text-xs text-red-300">
              {((applyPolish.error || auditCurrent.error || approveDraft.error) as Error).message}
            </div>
          )}
        </div>

        {draftApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Polished pilot promoted.</strong> Saved as Draft{" "}
            {promotedDraft ?? "?"} on EP01. The R6 draft is preserved (not
            deleted — just marked non-current). Open Drafts to compare.
          </div>
        )}

        {unappliedRows && unappliedRows.length > 0 && (
          <div className="mt-3 rounded border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-100">
            <strong>Heads up:</strong> {unappliedRows.length} polish item
            {unappliedRows.length === 1 ? "" : "s"} could not be applied
            cleanly. They are listed below — regenerate or address them
            manually before approving.
          </div>
        )}
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">Audit source:</strong>
              <span>
                {auditMeta.source === "current_stored"
                  ? "current stored polished draft"
                  : "freshly-applied polished draft"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              {typeof auditMeta.fountainLen === "number" && (
                <>
                  <span className="text-bone-500">·</span>
                  <span>{auditMeta.fountainLen.toLocaleString()} chars</span>
                </>
              )}
              {typeof auditMeta.bytesDelta === "number" &&
                auditMeta.bytesDelta !== 0 && (
                  <>
                    <span className="text-bone-500">·</span>
                    <span
                      className={
                        auditMeta.bytesDelta > 0
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      Δ {auditMeta.bytesDelta > 0 ? "+" : ""}
                      {auditMeta.bytesDelta.toLocaleString()}
                    </span>
                  </>
                )}
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
                title="Reload the current stored polished draft from the server and re-run the R7 apply audit."
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {appliedRows && appliedRows.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="text-[11px] uppercase tracking-wide text-bone-400 mb-2">
            Applied polish ({appliedRows.length})
          </div>
          <div className="space-y-2">
            {appliedRows.map((row, i) => (
              <div
                key={i}
                className="rounded border border-bone-700/40 bg-bone-900/30 p-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${R7_REPLACEMENT_KIND_TONE[row.replacementKind]}`}
                  >
                    {R7_REPLACEMENT_KIND_LABEL[row.replacementKind]}
                  </span>
                  <span className="text-[11px] text-bone-300">
                    {row.category}
                  </span>
                  <span className="text-[11px] text-bone-500">·</span>
                  <span className="text-[11px] text-bone-400 truncate">
                    {row.location}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-bone-500 mb-0.5">Before</div>
                    <div className="text-bone-300 whitespace-pre-wrap leading-snug">
                      {row.before || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-bone-500 mb-0.5">After</div>
                    <div className="text-emerald-200 whitespace-pre-wrap leading-snug">
                      {row.after || "(removed)"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {unappliedRows && unappliedRows.length > 0 && (
        <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 p-3">
          <div className="text-[11px] uppercase tracking-wide text-amber-300 mb-2">
            Unapplied items ({unappliedRows.length})
          </div>
          <ul className="space-y-1 text-[11px] text-amber-100">
            {unappliedRows.map((row, i) => (
              <li key={i}>
                <strong>Item #{row.itemIndex + 1}:</strong> {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && (
        <DraftPreviewPanel
          title="Polished pilot — Fountain preview"
          text={draft}
          state={draftApproved ? "promoted" : "proposed"}
          draftNumber={promotedDraft ?? null}
          startExpanded={showFullDraft}
          footerHint="Approving inserts as Draft N+1; R6 draft preserved."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// R8 — Character Voice & Scene Life Pass
// ---------------------------------------------------------------------------

const R8_VOICE_CATEGORY_TONE: Record<
  RedevR8VoicePolishCategory,
  { bg: string; text: string; border: string }
> = {
  dialogue_naturalness:       { bg: "bg-sky-900/20",     text: "text-sky-200",     border: "border-sky-700/40"    },
  character_voice:            { bg: "bg-indigo-900/20",  text: "text-indigo-200",  border: "border-indigo-700/40" },
  emotional_tension:          { bg: "bg-rose-900/20",    text: "text-rose-200",    border: "border-rose-700/40"   },
  scene_rhythm:               { bg: "bg-amber-900/20",   text: "text-amber-200",   border: "border-amber-700/40"  },
  subtext_moment:             { bg: "bg-violet-900/20",  text: "text-violet-200",  border: "border-violet-700/40" },
  behavioral_de_repetition:   { bg: "bg-bone-900/30",    text: "text-bone-200",    border: "border-bone-700/40"   },
};

function R8VoicePolishStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const r7 = (report.pass as { r7Polish?: import("@/lib/api").RedevR7PolishPlan | null }).r7Polish ?? null;
  const r7Promoted = !!r7?.approvedAt && !!r7?.promotedScriptId;

  const stored = (report.pass as { r8VoicePolish?: import("@/lib/api").RedevR8VoicePolishPlan | null }).r8VoicePolish ?? null;
  const [approachSummary, setApproachSummary] = useState<string>(
    stored?.approachSummary ?? ""
  );
  const [items, setItems] = useState<RedevR8VoicePolishItem[]>(stored?.items ?? []);
  const [priorScriptId, setPriorScriptId] = useState<string>(
    stored?.priorScriptId ?? r7?.promotedScriptId ?? ""
  );
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [auditMeta, setAuditMeta] = useState<{ auditedAt: string; source: "generation" | "current_stored" } | null>(null);
  const planApproved = !!stored?.planApprovedAt;
  const hasItems = items.length > 0;

  const generate = useMutation({
    mutationFn: () => api.generateRedevR8VoicePlan(projectId, passId, {}),
    onSuccess: async (data) => {
      setApproachSummary(data.plan.approachSummary);
      setItems(data.plan.items);
      setPriorScriptId(data.plan.priorScriptId);
      setLastAudit(data.audit);
      setAuditMeta({ auditedAt: data.auditedAt, source: "generation" });
      await api.saveRedevR8VoicePlan(projectId, passId, {
        approachSummary: data.plan.approachSummary,
        items: data.plan.items,
        priorScriptId: data.plan.priorScriptId,
      });
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR8VoicePlan(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({ auditedAt: data.auditedAt, source: "current_stored" });
    },
  });

  const approvePlan = useMutation({
    mutationFn: () => api.approveRedevR8VoicePlan(projectId, passId),
    onSuccess: onChange,
  });

  if (!r7Promoted) {
    return (
      <Panel eyebrow={STAGE_LABEL["r8_voice_polish"]} title="R8 — Locked">
        <div className="os-banner os-banner-locked">
          <div className="os-banner-icon">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="os-banner-title">Awaiting R7 promotion</div>
            <div className="os-banner-sub">
              R8 unlocks after R7 is approved AND promoted as a new EP01
              draft. Promote the R7 polish first; then return here for the
              voice & scene-life pass.
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <Panel
        eyebrow={STAGE_LABEL["r8_voice_polish"]}
        title={planApproved ? "Voice plan — Approved" : "Character Voice & Scene Life"}
        actions={
          <div className="flex items-center gap-3">
            {hasItems && (
              <CopyButton
                variant="outline"
                label="Copy plan"
                successLabel="Copied plan"
                title="Copy the voice plan as Markdown."
                text={formatR8VoicePlanAsMarkdown(items, approachSummary, stored?.planApprovedAt ?? null)}
              />
            )}
            <span className="text-[11px] text-bone-500">
              {hasItems
                ? `${items.length} voice item${items.length === 1 ? "" : "s"}`
                : "no plan yet"}
            </span>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          R8 makes the promoted R7 draft feel less engineered and more
          alive. Six lenses: dialogue naturalness, character-specific
          voice, emotional tension micro-beats, scene rhythm, subtext
          moments, and behavioral de-repetition. Architecture stays
          locked — no series changes, no new backstory, no exposition.
          Pass 1 is plan-only; Pass 2 (apply) ships after you approve
          this plan.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || planApproved}
            variant={hasItems ? "outline" : "primary"}
            title="Run the R8 voice-plan agent on the promoted R7 draft. Plan-level only — no screenplay text."
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {hasItems ? "Regenerate voice plan" : "Generate voice plan"}
          </Button>
          {hasItems && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit plan"}
            </Button>
          )}
          {hasItems && !planApproved && (
            <Button
              onClick={() => approvePlan.mutate()}
              disabled={approvePlan.isPending}
              title="Lock the voice plan. Pass 2 (apply) will read it."
            >
              {approvePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve voice plan
            </Button>
          )}
          {(generate.error || auditCurrent.error || approvePlan.error) && (
            <div className="w-full text-xs text-red-300">
              {((generate.error || auditCurrent.error || approvePlan.error) as Error).message}
            </div>
          )}
        </div>

        {planApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Voice plan approved.</strong> Apply the polish below to
            generate Draft N+1. Architecture stays locked.
          </div>
        )}

        {approachSummary && (
          <div className="mt-3 rounded border border-indigo-700/30 bg-indigo-900/10 px-3 py-2 text-[12px] text-bone-200">
            <div className="text-[11px] uppercase tracking-wide text-indigo-300 mb-1">
              Approach summary
            </div>
            {approachSummary}
          </div>
        )}

        <div className="mt-2 text-[11px] text-bone-500">
          Anchored to script <code>{priorScriptId.slice(0, 8) || "?"}…</code>
        </div>
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">Audit source:</strong>
              <span>
                {auditMeta.source === "current_stored"
                  ? "current stored voice plan"
                  : "freshly-generated voice plan"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {!hasItems ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-bone-400">
          No voice plan yet. Click <strong className="text-bone-100">Generate voice plan</strong> to diagnose voice & scene-life opportunities on the promoted R7 draft.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <R8VoiceItemCard key={i} item={it} />
          ))}
        </div>
      )}

      <R8Pass2Section
        projectId={projectId}
        passId={passId}
        report={report}
        onChange={onChange}
        planApproved={planApproved}
      />
    </div>
  );
}

function R8VoiceItemCard({ item }: { item: RedevR8VoicePolishItem }) {
  const tone = R8_VOICE_CATEGORY_TONE[item.category];
  return (
    <div className={`rounded-lg border ${tone.border} bg-white/[0.02] p-3`}>
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center rounded ${tone.bg} ${tone.text} ${tone.border} border px-2 py-0.5 text-[11px] font-medium tracking-wide`}
        >
          {R8_VOICE_CATEGORY_LABEL[item.category]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-bone-100 font-medium truncate">
            {item.existingSceneOrd != null && (
              <span className="text-bone-500 mr-2">#{item.existingSceneOrd}</span>
            )}
            {item.existingSlugline ?? (item.existingSceneOrd == null ? "(pilot-level)" : "(no slug)")}
            {item.character && (
              <span className="ml-2 text-[11px] text-indigo-300">· {item.character}</span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-bone-300 leading-snug">
            <strong className="text-amber-200">Diagnosis: </strong>
            {item.diagnosis}
          </div>
          <div className="mt-1 text-[12px] text-bone-200 leading-snug">
            <strong className="text-emerald-300">Fix direction: </strong>
            {item.fixDirection}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {item.severity && (
              <span
                className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${
                  item.severity === "high"
                    ? "border-red-700/40 bg-red-900/20 text-red-200"
                    : item.severity === "medium"
                      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
                      : "border-bone-700/40 bg-bone-900/30 text-bone-300"
                }`}
              >
                {item.severity}
              </span>
            )}
            {item.scope && (
              <span className="inline-flex rounded bg-sky-900/20 text-sky-200 border border-sky-700/40 px-1.5 py-0.5 text-[10px]">
                {item.scope}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatR8VoicePlanAsMarkdown(
  items: RedevR8VoicePolishItem[],
  approachSummary: string,
  approvedAt?: string | null
): string {
  const lines: string[] = [];
  lines.push("# R8 — Character Voice & Scene Life Plan");
  if (approvedAt) {
    lines.push(`*Approved ${new Date(approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  if (approachSummary) {
    lines.push("## Approach summary");
    lines.push(approachSummary);
    lines.push("");
  }
  lines.push("## Voice items");
  for (const it of items) {
    const head = it.existingSceneOrd != null
      ? `**[#${it.existingSceneOrd}]** ${it.existingSlugline ?? ""}`
      : `**[pilot-level]**`;
    const cat = R8_VOICE_CATEGORY_LABEL[it.category];
    const charBit = it.character ? ` — _${it.character}_` : "";
    lines.push(`### ${head} — ${cat}${charBit}`);
    lines.push(`**Diagnosis.** ${it.diagnosis}`);
    lines.push(`**Fix direction.** ${it.fixDirection}`);
    if (it.severity) lines.push(`_Severity: ${it.severity}_`);
    if (it.scope) lines.push(`_Scope: ${it.scope}_`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function R8Pass2Section({
  projectId,
  passId,
  report,
  onChange,
  planApproved,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
  planApproved: boolean;
}) {
  const polish = (report.pass as { r8VoicePolish?: {
    polishedDraftText?: string | null;
    polishedDraftAt?: string | null;
    approvedAt?: string | null;
    promotedScriptId?: string | null;
    promotedDraftNumber?: number | null;
  } }).r8VoicePolish ?? {};

  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [auditMeta, setAuditMeta] = useState<{
    auditedAt: string;
    source: "apply" | "current_stored";
    fountainLen?: number;
    bytesDelta?: number;
  } | null>(null);
  const [appliedRows, setAppliedRows] = useState<Array<{
    category: string;
    location: string;
    before: string;
    after: string;
    replacementKind: "action" | "dialogue" | "continuity_correction" | "removal";
  }> | null>(null);
  const [unappliedRows, setUnappliedRows] = useState<
    Array<{ itemIndex: number; reason: string }> | null
  >(null);
  const [showFullDraft, setShowFullDraft] = useState(false);
  const [acceptWarnings, setAcceptWarnings] = useState(false);

  const auditWarningCount = (lastAudit?.checks ?? []).filter(
    (c) => c.status === "warning"
  ).length;
  const auditIsClean = lastAudit !== null && auditWarningCount === 0;
  const approveGated = !auditIsClean && !acceptWarnings;

  const applyPolish = useMutation({
    mutationFn: () => api.applyRedevR8Voice(projectId, passId, {}),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "apply",
        fountainLen: data.newLen,
        bytesDelta: data.bytesDelta,
      });
      setAppliedRows(data.applied ?? []);
      setUnappliedRows(data.unapplied ?? []);
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR8PolishedDraft(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "current_stored",
      });
    },
  });

  const approveDraft = useMutation({
    mutationFn: () => api.approveRedevR8PolishedDraft(projectId, passId),
    onSuccess: () => onChange(),
  });

  if (!planApproved) {
    return (
      <div className="os-banner os-banner-locked">
        <div className="os-banner-icon">
          <Lock className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="os-banner-title">R8 Pass 2 locked</div>
          <div className="os-banner-sub">
            Approve the voice plan above to unlock apply. Pass 2 produces a
            new polished Fountain draft; approve to promote it as Draft N+1
            (the R7 draft stays intact).
          </div>
        </div>
      </div>
    );
  }

  const draft = polish.polishedDraftText ?? "";
  const draftApproved = !!polish.approvedAt;
  const promotedDraft = polish.promotedDraftNumber;

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="R8 · Pass 2"
        title={
          draftApproved
            ? `Voice-polished pilot — Promoted as Draft ${promotedDraft ?? "?"}`
            : "Voice-polished pilot — Apply voice plan"
        }
        actions={
          <div className="flex items-center gap-3">
            {draft && (
              <CopyButton
                variant="outline"
                label="Copy draft"
                successLabel="Copied draft"
                title="Copy the voice-polished pilot as Fountain text."
                text={draft}
              />
            )}
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Pass 2 reads your approved voice plan + the promoted R7 draft +
          locked architecture. It applies ONLY the approved voice items —
          every replacement is filmable action, short character-specific
          dialogue, or removal. It does NOT add new backstory, exposition,
          or showrunner-note prose. Approve to promote as Draft N+1; the
          R7 draft stays preserved.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => applyPolish.mutate()}
            disabled={applyPolish.isPending || draftApproved}
            variant={draft ? "outline" : "primary"}
            title="Apply the approved voice items — generates the polished Fountain draft and runs the R8 apply audit."
          >
            {applyPolish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {draft ? "Regenerate voice polish" : "Apply voice polish (Pass 2)"}
          </Button>
          {draft && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit polished draft"}
            </Button>
          )}
          {draft && !draftApproved && (
            <Button
              onClick={() => approveDraft.mutate()}
              disabled={approveDraft.isPending || approveGated}
              title={
                approveGated
                  ? lastAudit
                    ? `${auditWarningCount} audit warning(s) outstanding. Regenerate, or tick "Accept remaining warnings" to override.`
                    : "Run 'Audit polished draft' first."
                  : "Promote the voice-polished pilot to a new draft (Draft N+1). Does not touch the R7 draft."
              }
            >
              {approveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve & save as Draft N+1
            </Button>
          )}
          {draft && !draftApproved && lastAudit && auditWarningCount > 0 && (
            <label
              className="inline-flex items-center gap-2 text-[11px] text-amber-200 cursor-pointer"
              title="Override the audit gate. Use only when warnings have been reviewed and accepted by the showrunner."
            >
              <input
                type="checkbox"
                checked={acceptWarnings}
                onChange={(e) => setAcceptWarnings(e.target.checked)}
              />
              Accept remaining {auditWarningCount} warning{auditWarningCount === 1 ? "" : "s"}
            </label>
          )}
          {(applyPolish.error || auditCurrent.error || approveDraft.error) && (
            <div className="w-full text-xs text-red-300">
              {((applyPolish.error || auditCurrent.error || approveDraft.error) as Error).message}
            </div>
          )}
        </div>

        {draftApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Voice-polished pilot promoted.</strong> Saved as Draft{" "}
            {promotedDraft ?? "?"} on EP01. The R7 draft is preserved.
          </div>
        )}

        {unappliedRows && unappliedRows.length > 0 && (
          <div className="mt-3 rounded border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-100">
            <strong>Heads up:</strong> {unappliedRows.length} voice item
            {unappliedRows.length === 1 ? "" : "s"} could not be applied
            cleanly. Listed below — regenerate or address manually.
          </div>
        )}
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">Audit source:</strong>
              <span>
                {auditMeta.source === "current_stored"
                  ? "current stored polished draft"
                  : "freshly-applied polished draft"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              {typeof auditMeta.fountainLen === "number" && (
                <>
                  <span className="text-bone-500">·</span>
                  <span>{auditMeta.fountainLen.toLocaleString()} chars</span>
                </>
              )}
              {typeof auditMeta.bytesDelta === "number" &&
                auditMeta.bytesDelta !== 0 && (
                  <>
                    <span className="text-bone-500">·</span>
                    <span
                      className={
                        auditMeta.bytesDelta > 0
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      Δ {auditMeta.bytesDelta > 0 ? "+" : ""}
                      {auditMeta.bytesDelta.toLocaleString()}
                    </span>
                  </>
                )}
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
                title="Reload the current stored polished draft and re-run the R8 audit."
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {appliedRows && appliedRows.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="text-[11px] uppercase tracking-wide text-bone-400 mb-2">
            Applied voice items ({appliedRows.length})
          </div>
          <div className="space-y-2">
            {appliedRows.map((row, i) => (
              <div
                key={i}
                className="rounded border border-bone-700/40 bg-bone-900/30 p-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${
                      row.replacementKind === "action"
                        ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
                        : row.replacementKind === "dialogue"
                          ? "border-sky-700/40 bg-sky-900/20 text-sky-200"
                          : row.replacementKind === "continuity_correction"
                            ? "border-violet-700/40 bg-violet-900/20 text-violet-200"
                            : "border-red-700/40 bg-red-900/20 text-red-200"
                    }`}
                  >
                    {row.replacementKind === "continuity_correction"
                      ? "continuity fix"
                      : row.replacementKind}
                  </span>
                  <span className="text-[11px] text-bone-300">
                    {row.category}
                  </span>
                  <span className="text-[11px] text-bone-500">·</span>
                  <span className="text-[11px] text-bone-400 truncate">
                    {row.location}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-bone-500 mb-0.5">Before</div>
                    <div className="text-bone-300 whitespace-pre-wrap leading-snug">
                      {row.before || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-bone-500 mb-0.5">After</div>
                    <div className="text-emerald-200 whitespace-pre-wrap leading-snug">
                      {row.after || "(removed)"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {unappliedRows && unappliedRows.length > 0 && (
        <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 p-3">
          <div className="text-[11px] uppercase tracking-wide text-amber-300 mb-2">
            Unapplied items ({unappliedRows.length})
          </div>
          <ul className="space-y-1 text-[11px] text-amber-100">
            {unappliedRows.map((row, i) => (
              <li key={i}>
                <strong>Item #{row.itemIndex + 1}:</strong> {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && (
        <DraftPreviewPanel
          title="Voice-polished pilot — Fountain preview"
          text={draft}
          state={draftApproved ? "promoted" : "proposed"}
          draftNumber={promotedDraft ?? null}
          startExpanded={showFullDraft}
          footerHint="Approving inserts as Draft N+1; R7 draft preserved."
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// R9 — Final Hook & Emotional Anchor Pass
// ---------------------------------------------------------------------------

const R9_FINAL_CATEGORY_TONE: Record<
  RedevR9FinalPolishCategory,
  { bg: string; text: string; border: string }
> = {
  margot_emotional_anchor:    { bg: "bg-rose-900/20",    text: "text-rose-200",    border: "border-rose-700/40"   },
  archive_visual_mystery:     { bg: "bg-violet-900/20",  text: "text-violet-200",  border: "border-violet-700/40" },
  sound_design:               { bg: "bg-sky-900/20",     text: "text-sky-200",     border: "border-sky-700/40"    },
  pacing_economy:             { bg: "bg-amber-900/20",   text: "text-amber-200",   border: "border-amber-700/40"  },
  final_hook_polish:          { bg: "bg-emerald-900/20", text: "text-emerald-200", border: "border-emerald-700/40" },
};

function R9FinalPolishStage({
  projectId,
  passId,
  report,
  onChange,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
}) {
  const r8 = (report.pass as { r8VoicePolish?: import("@/lib/api").RedevR8VoicePolishPlan | null }).r8VoicePolish ?? null;
  const r8Promoted = !!r8?.approvedAt && !!r8?.promotedScriptId;

  const stored = (report.pass as { r9FinalPolish?: import("@/lib/api").RedevR9FinalPolishPlan | null }).r9FinalPolish ?? null;
  const [approachSummary, setApproachSummary] = useState<string>(
    stored?.approachSummary ?? ""
  );
  const [items, setItems] = useState<RedevR9FinalPolishItem[]>(stored?.items ?? []);
  const [priorScriptId, setPriorScriptId] = useState<string>(
    stored?.priorScriptId ?? r8?.promotedScriptId ?? ""
  );
  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [auditMeta, setAuditMeta] = useState<{ auditedAt: string; source: "generation" | "current_stored" } | null>(null);
  const planApproved = !!stored?.planApprovedAt;
  const hasItems = items.length > 0;

  const generate = useMutation({
    mutationFn: () => api.generateRedevR9FinalPlan(projectId, passId, {}),
    onSuccess: async (data) => {
      setApproachSummary(data.plan.approachSummary);
      setItems(data.plan.items);
      setPriorScriptId(data.plan.priorScriptId);
      setLastAudit(data.audit);
      setAuditMeta({ auditedAt: data.auditedAt, source: "generation" });
      await api.saveRedevR9FinalPlan(projectId, passId, {
        approachSummary: data.plan.approachSummary,
        items: data.plan.items,
        priorScriptId: data.plan.priorScriptId,
      });
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR9FinalPlan(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({ auditedAt: data.auditedAt, source: "current_stored" });
    },
  });

  const approvePlan = useMutation({
    mutationFn: () => api.approveRedevR9FinalPlan(projectId, passId),
    onSuccess: onChange,
  });

  if (!r8Promoted) {
    return (
      <Panel eyebrow={STAGE_LABEL["r9_final_polish"]} title="R9 — Locked">
        <div className="os-banner os-banner-locked">
          <div className="os-banner-icon">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="os-banner-title">Awaiting R8 promotion</div>
            <div className="os-banner-sub">
              R9 unlocks after R8 is approved AND promoted as Draft 4.
              Promote the R8 voice polish first; then return here for the
              final hook &amp; emotional anchor pass.
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <Panel
        eyebrow={STAGE_LABEL["r9_final_polish"]}
        title={planApproved ? "Final plan — Approved" : "Final Hook & Emotional Anchor"}
        actions={
          <div className="flex items-center gap-3">
            {hasItems && (
              <CopyButton
                variant="outline"
                label="Copy plan"
                successLabel="Copied plan"
                title="Copy the final plan as Markdown."
                text={formatR9FinalPlanAsMarkdown(items, approachSummary, stored?.planApprovedAt ?? null)}
              />
            )}
            <span className="text-[11px] text-bone-500">
              {hasItems
                ? `${items.length} final item${items.length === 1 ? "" : "s"}`
                : "no plan yet"}
            </span>
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          R9 is the final automated rewrite pass. It does <strong>not</strong>{" "}
          redevelop the series, change episode structure, or rewrite the
          pilot from scratch. It applies five tightly-scoped lenses to
          Draft 4: one private Margot emotional crack tied to the
          unlabeled file (behavior only — no Cass reveal, no grief
          speech); one stronger visual plant in Solano's archive room
          (no Elena reveal, no "younger version" clue); strengthened
          sound motifs (recorder, rain, jungle, lock, chime); 1–2 pages
          of pacing tightening; and one restrained extra beat on the
          closing transparent-case / Paul chime hook. Architecture stays
          locked. Pass 1 is plan-only; Pass 2 produces Draft 5 — the
          locked Episode 1 writing draft.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || planApproved}
            variant={hasItems ? "outline" : "primary"}
            title="Run the R9 plan agent on Draft 4. Plan-level only — no screenplay text."
          >
            {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {hasItems ? "Regenerate final plan" : "Generate final plan"}
          </Button>
          {hasItems && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit plan"}
            </Button>
          )}
          {hasItems && !planApproved && (
            <Button
              onClick={() => approvePlan.mutate()}
              disabled={approvePlan.isPending}
              title="Lock the final plan. Pass 2 (apply) will read it."
            >
              {approvePlan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve final plan
            </Button>
          )}
          {(generate.error || auditCurrent.error || approvePlan.error) && (
            <div className="w-full text-xs text-red-300">
              {((generate.error || auditCurrent.error || approvePlan.error) as Error).message}
            </div>
          )}
        </div>

        {planApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Final plan approved.</strong> Apply the polish below to
            generate Draft 5. Architecture stays locked.
          </div>
        )}

        {approachSummary && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[12px] text-bone-200">
            <div className="text-[11px] uppercase tracking-wide text-emerald-300 mb-1">
              Approach summary
            </div>
            {approachSummary}
          </div>
        )}

        <div className="mt-2 text-[11px] text-bone-500">
          Anchored to Draft 4 <code>{priorScriptId.slice(0, 8) || "?"}…</code>
        </div>
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">Audit source:</strong>
              <span>
                {auditMeta.source === "current_stored"
                  ? "current stored final plan"
                  : "freshly-generated final plan"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {!hasItems ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-sm text-bone-400">
          No final plan yet. Click <strong className="text-bone-100">Generate final plan</strong> to diagnose the five R9 lenses on Draft 4.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => (
            <R9FinalItemCard key={i} item={it} />
          ))}
        </div>
      )}

      <R9Pass2Section
        projectId={projectId}
        passId={passId}
        report={report}
        onChange={onChange}
        planApproved={planApproved}
      />
    </div>
  );
}

function R9FinalItemCard({ item }: { item: RedevR9FinalPolishItem }) {
  const tone = R9_FINAL_CATEGORY_TONE[item.category];
  return (
    <div className={`rounded-lg border ${tone.border} bg-white/[0.02] p-3`}>
      <div className="flex items-start gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center rounded ${tone.bg} ${tone.text} ${tone.border} border px-2 py-0.5 text-[11px] font-medium tracking-wide`}
        >
          {R9_FINAL_CATEGORY_LABEL[item.category]}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-bone-100 font-medium truncate">
            {item.existingSceneOrd != null && (
              <span className="text-bone-500 mr-2">#{item.existingSceneOrd}</span>
            )}
            {item.existingSlugline ?? (item.existingSceneOrd == null ? "(pilot-level)" : "(no slug)")}
            {item.character && (
              <span className="ml-2 text-[11px] text-emerald-300">· {item.character}</span>
            )}
          </div>
          <div className="mt-1 text-[12px] text-bone-300 leading-snug">
            <strong className="text-amber-200">Diagnosis: </strong>
            {item.diagnosis}
          </div>
          <div className="mt-1 text-[12px] text-bone-200 leading-snug">
            <strong className="text-emerald-300">Fix direction: </strong>
            {item.fixDirection}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {item.severity && (
              <span
                className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${
                  item.severity === "high"
                    ? "border-red-700/40 bg-red-900/20 text-red-200"
                    : item.severity === "medium"
                      ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
                      : "border-bone-700/40 bg-bone-900/30 text-bone-300"
                }`}
              >
                {item.severity}
              </span>
            )}
            {item.scope && (
              <span className="inline-flex rounded bg-sky-900/20 text-sky-200 border border-sky-700/40 px-1.5 py-0.5 text-[10px]">
                {item.scope}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatR9FinalPlanAsMarkdown(
  items: RedevR9FinalPolishItem[],
  approachSummary: string,
  approvedAt?: string | null
): string {
  const lines: string[] = [];
  lines.push("# R9 — Final Hook & Emotional Anchor Plan");
  if (approvedAt) {
    lines.push(`*Approved ${new Date(approvedAt).toLocaleDateString()}*`);
  }
  lines.push("");
  if (approachSummary) {
    lines.push("## Approach summary");
    lines.push(approachSummary);
    lines.push("");
  }
  lines.push("## Final polish items");
  for (const it of items) {
    const head = it.existingSceneOrd != null
      ? `**[#${it.existingSceneOrd}]** ${it.existingSlugline ?? ""}`
      : `**[pilot-level]**`;
    const cat = R9_FINAL_CATEGORY_LABEL[it.category];
    const charBit = it.character ? ` — _${it.character}_` : "";
    lines.push(`### ${head} — ${cat}${charBit}`);
    lines.push(`**Diagnosis.** ${it.diagnosis}`);
    lines.push(`**Fix direction.** ${it.fixDirection}`);
    if (it.severity) lines.push(`_Severity: ${it.severity}_`);
    if (it.scope) lines.push(`_Scope: ${it.scope}_`);
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}

function R9Pass2Section({
  projectId,
  passId,
  report,
  onChange,
  planApproved,
}: {
  projectId: string;
  passId: string;
  report: RedevPassReport;
  onChange: () => void;
  planApproved: boolean;
}) {
  const polish = (report.pass as { r9FinalPolish?: {
    polishedDraftText?: string | null;
    polishedDraftAt?: string | null;
    approvedAt?: string | null;
    promotedScriptId?: string | null;
    promotedDraftNumber?: number | null;
  } }).r9FinalPolish ?? {};

  const [lastAudit, setLastAudit] = useState<RedevAuditReport | null>(null);
  const [auditMeta, setAuditMeta] = useState<{
    auditedAt: string;
    source: "apply" | "current_stored";
    fountainLen?: number;
    bytesDelta?: number;
  } | null>(null);
  const [appliedRows, setAppliedRows] = useState<Array<{
    category: string;
    location: string;
    before: string;
    after: string;
    replacementKind: "action" | "dialogue" | "continuity_correction" | "removal" | "sound" | "insertion";
  }> | null>(null);
  const [unappliedRows, setUnappliedRows] = useState<
    Array<{ itemIndex: number; reason: string }> | null
  >(null);
  const [acceptWarnings, setAcceptWarnings] = useState(false);

  const auditWarningCount = (lastAudit?.checks ?? []).filter(
    (c) => c.status === "warning"
  ).length;
  const auditIsClean = lastAudit !== null && auditWarningCount === 0;
  const approveGated = !auditIsClean && !acceptWarnings;

  const applyPolish = useMutation({
    mutationFn: () => api.applyRedevR9Final(projectId, passId, {}),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({
        auditedAt: data.auditedAt,
        source: "apply",
        fountainLen: data.newLen,
        bytesDelta: data.bytesDelta,
      });
      setAppliedRows(data.applied ?? []);
      setUnappliedRows(data.unapplied ?? []);
      onChange();
    },
  });

  const auditCurrent = useMutation({
    mutationFn: () => api.auditRedevR9PolishedDraft(projectId, passId),
    onSuccess: (data) => {
      setLastAudit(data.audit);
      setAuditMeta({ auditedAt: data.auditedAt, source: "current_stored" });
    },
  });

  const approveDraft = useMutation({
    mutationFn: () => api.approveRedevR9PolishedDraft(projectId, passId),
    onSuccess: () => onChange(),
  });

  if (!planApproved) {
    return (
      <div className="os-banner os-banner-locked">
        <div className="os-banner-icon">
          <Lock className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="os-banner-title">R9 Pass 2 locked</div>
          <div className="os-banner-sub">
            Approve the final plan above to unlock apply. Pass 2 produces
            Draft 5 — the locked Episode 1 writing draft.
          </div>
        </div>
      </div>
    );
  }

  const draft = polish.polishedDraftText ?? "";
  const draftApproved = !!polish.approvedAt;
  const promotedDraft = polish.promotedDraftNumber;

  return (
    <div className="space-y-3">
      <Panel
        eyebrow="R9 · Pass 2"
        title={
          draftApproved
            ? `Locked writing draft — Promoted as Draft ${promotedDraft ?? "?"}`
            : "Final-polished pilot — Apply final plan"
        }
        actions={
          <div className="flex items-center gap-3">
            {draft && (
              <CopyButton
                variant="outline"
                label="Copy draft"
                successLabel="Copied draft"
                title="Copy Draft 5 as Fountain text."
                text={draft}
              />
            )}
          </div>
        }
      >
        <p className="text-sm text-bone-300 leading-relaxed">
          Pass 2 reads your approved final plan + Draft 4 + locked
          architecture. It applies ONLY the approved items. No new
          backstory, no exposition, no meta-narration, no Cass reveal,
          no "younger version" archive clue, no shown phone message.
          Approve to promote Draft 5 as the locked Episode 1 writing
          draft; Draft 4 stays preserved.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            onClick={() => applyPolish.mutate()}
            disabled={applyPolish.isPending || draftApproved}
            variant={draft ? "outline" : "primary"}
            title="Apply the approved final items — generates Draft 5 and runs the R9 apply audit."
          >
            {applyPolish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {draft ? "Regenerate final polish" : "Apply final polish (Pass 2)"}
          </Button>
          {draft && (
            <Button
              variant="outline"
              onClick={() => auditCurrent.mutate()}
              disabled={auditCurrent.isPending}
            >
              {auditCurrent.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              {auditCurrent.isPending ? "Auditing…" : "Audit polished draft"}
            </Button>
          )}
          {draft && !draftApproved && (
            <Button
              onClick={() => approveDraft.mutate()}
              disabled={approveDraft.isPending || approveGated}
              title={
                approveGated
                  ? lastAudit
                    ? `${auditWarningCount} audit warning(s) outstanding. Regenerate, or tick "Accept remaining warnings" to override.`
                    : "Run 'Audit polished draft' first."
                  : "Promote Draft 5 as the locked Episode 1 writing draft. Draft 4 stays preserved."
              }
            >
              {approveDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve & lock as Draft 5
            </Button>
          )}
          {draft && !draftApproved && lastAudit && auditWarningCount > 0 && (
            <label
              className="inline-flex items-center gap-2 text-[11px] text-amber-200 cursor-pointer"
              title="Override the audit gate. Use only when warnings have been reviewed and accepted by the showrunner."
            >
              <input
                type="checkbox"
                checked={acceptWarnings}
                onChange={(e) => setAcceptWarnings(e.target.checked)}
              />
              Accept remaining {auditWarningCount} warning{auditWarningCount === 1 ? "" : "s"}
            </label>
          )}
          {(applyPolish.error || auditCurrent.error || approveDraft.error) && (
            <div className="w-full text-xs text-red-300">
              {((applyPolish.error || auditCurrent.error || approveDraft.error) as Error).message}
            </div>
          )}
        </div>

        {draftApproved && (
          <div className="mt-3 rounded border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[11px] text-emerald-100">
            <strong>Draft 5 locked.</strong> Saved as the locked Episode 1
            writing draft. Draft 4 is preserved (not deleted — just marked
            non-current). Open Drafts to compare.
          </div>
        )}

        {unappliedRows && unappliedRows.length > 0 && (
          <div className="mt-3 rounded border border-amber-700/30 bg-amber-900/10 px-3 py-2 text-[11px] text-amber-100">
            <strong>Heads up:</strong> {unappliedRows.length} final item
            {unappliedRows.length === 1 ? "" : "s"} could not be applied
            cleanly. Listed below — regenerate or address manually.
          </div>
        )}
      </Panel>

      {lastAudit && (
        <div className="space-y-1">
          {auditMeta && (
            <div className="rounded border border-bone-700/30 bg-white/[0.02] px-3 py-1.5 text-[11px] text-bone-300 flex flex-wrap items-center gap-2">
              <strong className="text-bone-100">Audit source:</strong>
              <span>
                {auditMeta.source === "current_stored"
                  ? "current stored Draft 5"
                  : "freshly-applied Draft 5"}
              </span>
              <span className="text-bone-500">·</span>
              <span>
                run at <code>{new Date(auditMeta.auditedAt).toLocaleTimeString()}</code>
              </span>
              {typeof auditMeta.fountainLen === "number" && (
                <>
                  <span className="text-bone-500">·</span>
                  <span>{auditMeta.fountainLen.toLocaleString()} chars</span>
                </>
              )}
              {typeof auditMeta.bytesDelta === "number" &&
                auditMeta.bytesDelta !== 0 && (
                  <>
                    <span className="text-bone-500">·</span>
                    <span
                      className={
                        auditMeta.bytesDelta > 0
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      Δ {auditMeta.bytesDelta > 0 ? "+" : ""}
                      {auditMeta.bytesDelta.toLocaleString()}
                    </span>
                  </>
                )}
              <button
                type="button"
                onClick={() => auditCurrent.mutate()}
                disabled={auditCurrent.isPending}
                className="ml-auto text-[11px] underline text-bone-300 hover:text-bone-100 disabled:opacity-50"
                title="Reload the current stored Draft 5 and re-run the R9 audit."
              >
                {auditCurrent.isPending ? "Re-auditing…" : "Force re-audit"}
              </button>
            </div>
          )}
          <QualityCheckPanel audit={lastAudit} collapsedByDefault={false} />
        </div>
      )}

      {appliedRows && appliedRows.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <div className="text-[11px] uppercase tracking-wide text-bone-400 mb-2">
            Applied final items ({appliedRows.length})
          </div>
          <div className="space-y-2">
            {appliedRows.map((row, i) => (
              <div
                key={i}
                className="rounded border border-bone-700/40 bg-bone-900/30 p-2"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${
                      row.replacementKind === "action"
                        ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
                        : row.replacementKind === "dialogue"
                          ? "border-sky-700/40 bg-sky-900/20 text-sky-200"
                          : row.replacementKind === "continuity_correction"
                            ? "border-violet-700/40 bg-violet-900/20 text-violet-200"
                            : row.replacementKind === "sound"
                              ? "border-indigo-700/40 bg-indigo-900/20 text-indigo-200"
                              : row.replacementKind === "insertion"
                                ? "border-amber-700/40 bg-amber-900/20 text-amber-200"
                                : "border-red-700/40 bg-red-900/20 text-red-200"
                    }`}
                  >
                    {row.replacementKind === "continuity_correction"
                      ? "continuity fix"
                      : row.replacementKind}
                  </span>
                  <span className="text-[11px] text-bone-300">
                    {row.category}
                  </span>
                  <span className="text-[11px] text-bone-500">·</span>
                  <span className="text-[11px] text-bone-400 truncate">
                    {row.location}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-bone-500 mb-0.5">Before</div>
                    <div className="text-bone-300 whitespace-pre-wrap leading-snug">
                      {row.before || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-bone-500 mb-0.5">After</div>
                    <div className="text-emerald-200 whitespace-pre-wrap leading-snug">
                      {row.after || "(removed)"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {unappliedRows && unappliedRows.length > 0 && (
        <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 p-3">
          <div className="text-[11px] uppercase tracking-wide text-amber-300 mb-2">
            Unapplied items ({unappliedRows.length})
          </div>
          <ul className="space-y-1 text-[11px] text-amber-100">
            {unappliedRows.map((row, i) => (
              <li key={i}>
                <strong>Item #{row.itemIndex + 1}:</strong> {row.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {draft && (
        <DraftPreviewPanel
          title="Draft 5 — locked Episode 1 writing draft"
          text={draft}
          state={draftApproved ? "promoted" : "proposed"}
          draftNumber={promotedDraft ?? null}
          footerHint="Approving locks Draft 5 as the Episode 1 writing draft; Draft 4 stays preserved."
        />
      )}
    </div>
  );
}
