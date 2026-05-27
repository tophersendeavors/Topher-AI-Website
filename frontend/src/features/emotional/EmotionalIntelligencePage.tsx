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
        description="Wounds, tensions, scene-by-scene emotional state. Scenes that explain their feelings get rejected unless stylistic mode is on."
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
        <Stat label="Wounds tracked" value={(wounds.data ?? []).length} Icon={Heart} accent="text-pink-300" />
        <Stat label="Relationship tensions" value={(tensions.data ?? []).length} Icon={Link2} accent="text-amber-300" />
        <Stat label="Scenes scored" value={(states.data ?? []).length} Icon={Sparkles} accent="text-ember-300" />
        <Stat
          label="Avg truth score"
          value={isFinite(avgTruth) ? avgTruth.toFixed(2) : "—"}
          Icon={ShieldAlert}
          accent={avgTruth < 0.5 ? "text-red-300" : avgTruth < 0.7 ? "text-amber-300" : "text-emerald-300"}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel eyebrow="Scan" title="Run an EI pass">
          <div className="space-y-3">
            <div>
              <label className="label-eyebrow mb-1 block">Script</label>
              <select className="input" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">Select a draft…</option>
                {(scripts.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
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
              description="Invoke the Wound agent from the Writers Room with a character's name."
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
              description="Invoke the Relationship Tension agent to map who isn't saying what."
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
}: {
  label: string;
  value: number | string;
  accent: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between">
        <div className="label-eyebrow">{label}</div>
        <Icon className={`h-4 w-4 ${accent}`} />
      </div>
      <div className={`mt-2 font-serif text-3xl ${accent}`}>{value}</div>
    </div>
  );
}

import type { SceneEmotionalState } from "@toburt/shared";

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

  return (
    <li
      className={`rounded-md border bg-white/[0.02] p-3 ${
        state.rejected ? "border-red-700/50" : "border-white/8"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {state.rejected && (
          <span className="chip border-red-700/50 text-red-200">
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
          >
            truth {truth.toFixed(2)}
          </span>
        )}
      </div>
      {state.rejection_reason && (
        <div className="mb-2 rounded-md border border-red-700/40 bg-red-950/20 p-2 text-xs text-red-200">
          {state.rejection_reason}
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {fields.map(([k, v]) => (
          <div key={k} className="rounded-md border border-white/8 bg-white/[0.02] p-2">
            <div className="label-eyebrow mb-1">{k}</div>
            <div className="text-sm text-bone-200">
              {Array.isArray(v)
                ? v.length === 0
                  ? "—"
                  : v.map((b, i) => <div key={i}>• {b}</div>)
                : v ?? "—"}
            </div>
          </div>
        ))}
      </div>
    </li>
  );
}
