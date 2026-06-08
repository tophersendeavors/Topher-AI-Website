import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Heart,
  Link2,
  Play,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDraftLabel } from "@/lib/draftLabel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function EmotionalIntelligencePage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const wounds = useQuery({
    queryKey: ["wounds", projectId],
    queryFn: () => api.listWounds(projectId),
  });
  const tensions = useQuery({
    queryKey: ["tensions", projectId],
    queryFn: () => api.listRelationshipTensions(projectId),
  });
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });

  const [scriptId, setScriptId] = useState<string>("");
  const states = useQuery({
    queryKey: ["emotional-states", scriptId],
    queryFn: () => api.listScriptEmotionalStates(scriptId),
    enabled: !!scriptId,
  });

  const runPass = useMutation({
    mutationFn: () => api.runScriptEmotionalPass(scriptId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emotional-states", scriptId] }),
  });
  const scoreScript = useMutation({
    mutationFn: () => api.scoreScriptEmotional(scriptId),
  });
  const toggleStylistic = useMutation({
    mutationFn: (v: boolean) => api.setStylisticDirectness(projectId, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

  const stylistic = project.data?.allow_stylistic_directness ?? false;
  const rejectedCount = (states.data ?? []).filter((s) => s.rejected).length;
  const avgTruth =
    (states.data ?? []).reduce((sum, s) => sum + (s.truth_score ?? 0), 0) /
    Math.max(1, (states.data ?? []).length);

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Emotional Intelligence"
        title="EI Layer"
        description="A writer/director read on every scene: wounds, tensions, hidden vs visible wants, subtext, and the behavioral tells a director can shoot. Scenes that explain feelings instead of playing them are flagged."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-bone-200">
              <input
                type="checkbox"
                checked={stylistic}
                onChange={(e) => toggleStylistic.mutate(e.target.checked)}
              />
              Allow stylistic directness
            </label>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 px-8 md:grid-cols-4">
        <Stat
          label="Wounds tracked"
          value={(wounds.data ?? []).length}
          Icon={Heart}
          accent="text-pink-300"
          help="The unhealed past hurts driving each character. Wounds are what your character runs from — and what every scene secretly tests."
          emptyHint={(wounds.data ?? []).length === 0 ? "Not generated yet" : undefined}
        />
        <Stat
          label="Relationship tensions"
          value={(tensions.data ?? []).length}
          Icon={Link2}
          accent="text-amber-300"
          help="The unsaid charge between two characters — what one wants but won't ask for, what the other won't admit. Tensions are what makes a scene feel alive without anyone explaining it."
          emptyHint={(tensions.data ?? []).length === 0 ? "Not generated yet" : undefined}
        />
        <Stat
          label="Scenes scored"
          value={(states.data ?? []).length}
          Icon={Sparkles}
          accent="text-ember-300"
          help="How many scenes have run through the EI pass. Each scored scene gets entry/exit states, hidden vs visible want, subtext, and behavioral tells."
          emptyHint={!scriptId ? "Pick a draft" : (states.data ?? []).length === 0 ? "Needs EI pass" : undefined}
        />
        <Stat
          label="Avg truth score"
          value={isFinite(avgTruth) && (states.data ?? []).length > 0 ? avgTruth.toFixed(2) : "—"}
          Icon={ShieldAlert}
          accent={avgTruth < 0.5 ? "text-red-300" : avgTruth < 0.7 ? "text-amber-300" : "text-emerald-300"}
          help="0 to 1. How emotionally honest the scenes read — high = subtext lands, low = characters explain their feelings instead of playing them. Below 0.5 means the scene is on-the-nose."
          emptyHint={(states.data ?? []).length === 0 ? "Needs EI pass" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel eyebrow="Scan" title="Run an EI pass">
          <div className="space-y-3">
            <div>
              <label className="label-eyebrow mb-1 block">Script</label>
              <select className="input" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">Select a draft…</option>
                {(scripts.data ?? [])
                  .slice()
                  .sort((a, b) => {
                    if (a.current !== b.current) return a.current ? -1 : 1;
                    if (a.draft_number !== b.draft_number) return b.draft_number - a.draft_number;
                    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
                  })
                  .map((s) => (
                    <option key={s.id} value={s.id}>{formatDraftLabel(s)}</option>
                  ))}
              </select>
            </div>
            <Button onClick={() => runPass.mutate()} disabled={!scriptId || runPass.isPending}>
              <Play className="h-4 w-4" />
              {runPass.isPending ? "Running…" : "Run EI pass"}
            </Button>
            <Button
              variant="outline"
              onClick={() => scoreScript.mutate()}
              disabled={!scriptId || scoreScript.isPending}
            >
              <Sparkles className="h-4 w-4" />
              {scoreScript.isPending ? "Scoring…" : "Score scenes (read-only)"}
            </Button>
            {scoreScript.data && (
              <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-bone-200">
                    Overall {(scoreScript.data.overall * 100).toFixed(0)}/100
                  </span>
                  <span
                    className={`chip ${
                      scoreScript.data.weakSceneCount > 0
                        ? "border-amber-700/50 text-amber-200"
                        : "border-emerald-700/50 text-emerald-200"
                    }`}
                  >
                    {scoreScript.data.weakSceneCount} weak scene(s)
                  </span>
                </div>
                <ul className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
                  {scoreScript.data.scenes.map((s) => (
                    <li
                      key={`${s.order}-${s.sceneId ?? "x"}`}
                      className={`rounded-md border p-2 ${
                        s.weak
                          ? "border-amber-700/50 bg-amber-950/20"
                          : "border-white/10 bg-white/[0.02]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate text-bone-200">
                          {s.order}. {s.slugline}
                        </span>
                        <span className="text-bone-400">
                          {(s.overall * 100).toFixed(0)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                        {Object.entries(s.scores).map(([k, v]) => (
                          <span
                            key={k}
                            className={`chip ${
                              v.value < 0.5 ? "border-red-700/40 text-red-200" : ""
                            }`}
                          >
                            {k} {(v.value * 100).toFixed(0)}
                          </span>
                        ))}
                      </div>
                      {s.weak && s.rewriteInstructions.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-[11px] text-bone-300">
                          {s.rewriteInstructions.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {rejectedCount > 0 && (
              <div className="rounded-md border border-red-700/50 bg-red-950/30 p-2 text-xs text-red-200">
                <AlertTriangle className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                {rejectedCount} scene(s) rejected for direct emotional explanation.
              </div>
            )}
          </div>
        </Panel>

        <Panel eyebrow="Per-scene" title="Emotional states">
          {!scriptId ? (
            <EmptyState Icon={Heart} title="Pick a draft" description="Select a script to see its scene-by-scene emotional state." />
          ) : (states.data ?? []).length === 0 ? (
            <EmptyState
              Icon={Sparkles}
              title="No EI data yet"
              description="Run an EI pass to compute the ten emotional fields per scene."
            />
          ) : (
            <ul className="space-y-3">
              {states.data!.map((s) => <EmotionalStateRow key={s.id} state={s} />)}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-2">
        <Panel eyebrow="Wounds" title="Character wounds">
          {(wounds.data ?? []).length === 0 ? (
            <EmptyState
              Icon={Heart}
              title="No wounds yet"
              description="A wound is the unhealed past hurt a character carries into every scene. Invoke the Wound agent from the Writers Room with a character's name to start mapping them."
            />
          ) : (
            <ul className="space-y-2">
              {wounds.data!.map((w, i) => (
                <li key={i} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="chip">{w.kind}</span>
                  </div>
                  <div className="text-sm text-bone-100"><span className="label-eyebrow mr-2">Wound</span>{w.wound}</div>
                  <div className="mt-1 text-sm text-bone-200"><span className="label-eyebrow mr-2">Fear</span>{w.fear}</div>
                  <div className="mt-1 text-sm text-bone-200"><span className="label-eyebrow mr-2">Unmet need</span>{w.unmetNeed}</div>
                  <div className="mt-1 text-sm text-bone-200"><span className="label-eyebrow mr-2">Shame trigger</span>{w.shameTrigger}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(w.defenses ?? []).map((d) => <span key={d} className="chip">{d}</span>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel eyebrow="Tensions" title="Relationship tensions">
          {(tensions.data ?? []).length === 0 ? (
            <EmptyState
              Icon={Link2}
              title="No tensions tracked"
              description="A relationship tension is the unsaid charge between two characters — what one wants but won't ask for, what the other won't admit. Invoke the Relationship Tension agent to map them."
            />
          ) : (
            <ul className="space-y-2">
              {tensions.data!.map((t, i) => (
                <li key={i} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                  <div className="text-sm text-bone-100"><span className="label-eyebrow mr-2">Unsaid</span>{t.unsaid}</div>
                  {t.history && (
                    <div className="mt-1 text-sm text-bone-300"><span className="label-eyebrow mr-2">History</span>{t.history}</div>
                  )}
                  <div className="mt-1 text-sm text-bone-300"><span className="label-eyebrow mr-2">Power</span>{t.currentPower}</div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full bg-gradient-to-r from-amber-400 to-red-500" style={{ width: `${(t.tensionScore ?? 0.5) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  Icon,
  help,
  emptyHint,
}: {
  label: string;
  value: number | string;
  accent: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  help?: string;
  emptyHint?: string;
}) {
  const isEmpty = value === 0 || value === "—" || value === "0";
  return (
    <div className="panel p-5" title={help}>
      <div className="flex items-center justify-between">
        <div className="label-eyebrow">{label}</div>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className={`mt-2 font-serif text-3xl ${isEmpty ? "text-bone-500" : accent}`}>{value}</div>
      {emptyHint && isEmpty && (
        <div className="mt-1 text-[11px] text-bone-500">{emptyHint}</div>
      )}
      {help && (
        <div className="mt-2 text-[11px] leading-snug text-bone-500">{help}</div>
      )}
    </div>
  );
}

import type { SceneEmotionalState } from "@toburt/shared";

// Plain-language definitions for every EI field — shown as helper text and
// on hover. Wording is for writers/directors, not for ML engineers.
const EI_FIELD_HELP: Record<string, { help: string; missingHint: string }> = {
  Entry: {
    help: "What the character is feeling as the scene begins — before anyone speaks.",
    missingHint: "Needs EI pass",
  },
  Exit: {
    help: "What the character is feeling as the scene ends. Compare to Entry to feel the arc inside the scene.",
    missingHint: "Needs EI pass",
  },
  "Hidden want": {
    help: "What the character actually wants — the unspoken motive driving every choice in the scene.",
    missingHint: "Needs EI pass",
  },
  "Visible want": {
    help: "The on-the-surface goal the character is allowed to ask for. Often a cover for the hidden want.",
    missingHint: "Needs EI pass",
  },
  Fear: {
    help: "What the character is afraid the scene will reveal or take from them.",
    missingHint: "Needs EI pass",
  },
  Contradiction: {
    help: "The gap between what they say and what they want — where the scene gets interesting.",
    missingHint: "No contradiction detected — could be on-the-nose",
  },
  Subtext: {
    help: "What the scene is really about underneath the dialogue. If a line could be spoken aloud, it's not subtext.",
    missingHint: "Needs EI pass",
  },
  "Behavioral tells": {
    help: "Physical actions that betray the hidden state — a glance, a hand, a silence. The director's hooks.",
    missingHint: "Needs behavioral pass",
  },
  "Power shift": {
    help: "Who has the leverage at scene start vs end. Even a 5% tilt is a real beat.",
    missingHint: "Not applicable to this scene",
  },
  "Relationship shift": {
    help: "How the relationship between the on-screen characters changes by the end of the scene.",
    missingHint: "Not applicable to this scene",
  },
};

function buildSceneSummary(
  state: SceneEmotionalState & { truth_score?: number; rejected?: boolean }
): string {
  const truth = state.truth_score ?? state.truthScore ?? null;
  const hasFields = [
    state.emotionalEntryState,
    state.emotionalExitState,
    state.hiddenWant,
    state.subtext,
  ].filter(Boolean).length;
  const missingTells = !state.behavioralTells || (Array.isArray(state.behavioralTells) && state.behavioralTells.length === 0);
  const missingContradiction = !state.contradiction;
  if (state.rejected) {
    return "This scene reads as on-the-nose — characters are explaining what they feel instead of playing it. Rewriting toward subtext is recommended.";
  }
  if (hasFields === 0) {
    return "This scene hasn't been scored yet. Run an EI pass to see entry/exit states, wants, and subtext.";
  }
  if (truth != null && truth >= 0.7 && !missingTells && !missingContradiction) {
    return "This scene has strong emotional truth and the behavioral fields are populated — it should play well on screen.";
  }
  if (truth != null && truth >= 0.7) {
    const gaps = [missingTells ? "behavioral tells" : null, missingContradiction ? "contradiction" : null].filter(Boolean);
    return `This scene has strong emotional truth, but ${gaps.join(" and ")} ${gaps.length > 1 ? "are" : "is"} missing — directors won't have clear physical hooks.`;
  }
  if (truth != null && truth < 0.5) {
    return "This scene's emotional truth is low — characters are likely saying what they feel rather than acting it out. Consider a subtext pass.";
  }
  return "This scene is partially scored. Some playable fields are present; others are still missing.";
}

function FieldValue({
  label,
  value,
}: {
  label: string;
  value: string | string[] | undefined;
}) {
  const meta = EI_FIELD_HELP[label];
  const isMissing = value == null || value === "" || (Array.isArray(value) && value.length === 0);
  return (
    <div
      className="rounded-md border border-white/8 bg-white/[0.02] p-2"
      title={meta?.help}
    >
      <div className="label-eyebrow mb-1">{label}</div>
      {!isMissing ? (
        <div className="text-sm text-bone-200">
          {Array.isArray(value)
            ? value.map((b, i) => <div key={i}>• {b}</div>)
            : value}
        </div>
      ) : (
        <div className="text-xs italic text-bone-500">
          {meta?.missingHint ?? "Not generated yet"}
        </div>
      )}
      {meta?.help && (
        <div className="mt-1 text-[10px] leading-snug text-bone-600">
          {meta.help}
        </div>
      )}
    </div>
  );
}

function EmotionalStateRow({
  state,
}: {
  state: SceneEmotionalState & {
    scene_id?: string;
    rejected?: boolean;
    rejection_reason?: string;
    truth_score?: number;
  };
}) {
  const fields: Array<[string, string | string[] | undefined]> = [
    ["Entry", state.emotionalEntryState],
    ["Exit", state.emotionalExitState],
    ["Hidden want", state.hiddenWant],
    ["Visible want", state.visibleWant],
    ["Fear", state.fear],
    ["Contradiction", state.contradiction],
    ["Subtext", state.subtext],
    ["Behavioral tells", state.behavioralTells],
    ["Power shift", state.powerShift],
    ["Relationship shift", state.relationshipShift],
  ];
  const truth = state.truth_score ?? state.truthScore;
  const summary = buildSceneSummary(state);

  return (
    <li
      className={`rounded-md border bg-white/[0.02] p-3 ${
        state.rejected ? "border-red-700/50" : "border-white/8"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {state.rejected && (
          <span
            className="chip border-red-700/50 text-red-200"
            title="The scene was flagged as on-the-nose: a character explained their feelings instead of playing them."
          >
            <AlertTriangle className="h-3 w-3" /> rejected
          </span>
        )}
        {truth != null && (
          <span
            className={`chip ${
              truth < 0.5
                ? "border-red-700/50 text-red-200"
                : truth < 0.7
                ? "border-amber-700/50 text-amber-200"
                : "border-emerald-700/50 text-emerald-200"
            }`}
            title="0–1 emotional truth. ≥0.7 plays as subtext; <0.5 is on-the-nose."
          >
            truth {truth.toFixed(2)}
          </span>
        )}
      </div>
      <div className="mb-2 rounded-md border border-white/8 bg-white/[0.015] p-2 text-xs text-bone-300">
        {summary}
      </div>
      {state.rejection_reason && (
        <div className="mb-2 rounded-md border border-red-700/40 bg-red-950/20 p-2 text-xs text-red-200">
          {state.rejection_reason}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {fields.map(([k, v]) => (
          <FieldValue key={k} label={k} value={v} />
        ))}
      </div>
    </li>
  );
}
