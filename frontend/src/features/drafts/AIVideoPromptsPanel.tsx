// AI Video Prompts — Master Shot Brief + Model Router + per-model Adapters.
//
// The brief is the source of truth. Adapters derive per-model prompts. The
// router recommends a model but the writer can always manually override.
// Safety warnings are surfaced — never bypassed.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Copy, Check, RefreshCcw, ShieldAlert, Plus, Trash2, Wand2 } from "lucide-react";
import { api, SHOT_TAG_LABEL, QUALITY_CATEGORY_LABEL, QUALITY_OUTCOME_LABEL } from "@/lib/api";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Explainer } from "@/components/ui/Explainer";
import {
  PreflightCard,
  usePreflight,
  preflightGateMessage,
} from "@/features/preflight/PreflightCard";
import {
  SourceConfidenceBadge,
  type SourceConfidence,
} from "@/components/ui/SourceConfidenceBadge";
import { useUIMode } from "@/lib/uiMode";
import { AppliedCanonPanel } from "@/features/workflow/AppliedCanonPanel";
import type {
  ContinuityCategory,
  FeedbackTag,
  MasterShotBrief,
  ModelKey,
  ProductionResult,
  PromptVersion,
  QualityCategory,
  QualityGateResult,
  RouterResult,
  ShotTag,
  VisualWeight,
} from "@/lib/api";

const SHOT_TAGS: ShotTag[] = ["ENV", "BEH", "CHAR", "TRANS", "PRE", "VO", "KEY", "ACT", "INT", "EXT"];
const VISUAL_AXES: Array<keyof VisualWeight> = [
  "environment",
  "character",
  "object",
  "cameraMovement",
  "dialogue",
  "action",
  "atmosphere",
];
const QUALITY_KEYS: QualityCategory[] = [
  "behavioral_accuracy",
  "character_consistency",
  "atmospheric_fidelity",
  "emotional_subtext",
  "edit_readiness",
  "motion_stability",
  "face_hand_quality",
  "reference_continuity",
  "prompt_adherence",
  "safety_compliance",
];

const MODEL_LIST: ModelKey[] = [
  "veo",
  "kling",
  "runway",
  "pika",
  "luma",
  "midjourney",
  "generic_video",
  "generic_image",
  "custom",
];

const MODEL_LABEL: Record<ModelKey, string> = {
  veo: "Google Flow / Veo",
  kling: "Kling",
  runway: "Runway",
  pika: "Pika",
  luma: "Luma",
  midjourney: "Midjourney",
  generic_video: "Generic Video",
  generic_image: "Generic Image",
  custom: "Custom",
};

const FEEDBACK_LABELS: Record<FeedbackTag, string> = {
  worked: "Worked well",
  needs_camera: "Needs stronger camera",
  character_inconsistent: "Character inconsistent",
  bad_motion: "Bad motion",
  bad_face: "Bad face",
  wrong_mood: "Wrong mood",
  too_stylized: "Too stylized",
  too_generic: "Too generic",
  safety_blocked: "Safety blocked",
  use_as_reference: "Use as reference",
};

export function AIVideoPromptsPanel({
  scriptId,
  ready,
  /** Where the panel is mounted. Controls a small cross-nav line so the
   *  writer can find the same tool from the other context. Defaults to
   *  "draft" because that was the original mount point. */
  originContext = "draft",
}: {
  scriptId: string;
  ready: boolean;
  originContext?: "draft" | "production";
}) {
  const qc = useQueryClient();
  const { isSimple, isAdvanced } = useUIMode();
  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
    enabled: ready,
  });
  const data = useQuery({
    queryKey: ["ai-prompts", scriptId],
    queryFn: () => api.getAiPrompts(scriptId),
    enabled: ready,
  });

  const [selected, setSelected] = useState<{ sceneOrd: number; shotIndex: number } | null>(null);
  // V4.0 — view toggle. "detail" is the historic single-shot view; "storyboard"
  // is the in-app grid of all shots for the current scene.
  const [viewMode, setViewMode] = useState<"detail" | "storyboard">("detail");

  const briefs = data.data?.briefs ?? [];
  const prompts = data.data?.prompts ?? [];

  // Live character overlay for exports + storyboard cards. Looked up once
  // per panel via getScript → projectId → listCharacters.
  const scriptInfoQ = useQuery({
    queryKey: ["script-meta", scriptId],
    queryFn: () => api.getScript(scriptId),
    enabled: ready,
  });
  const projectId = scriptInfoQ.data?.project_id;
  const charactersQ = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.listCharacters(projectId!),
    enabled: !!projectId,
  });

  // Index prompts by (sceneOrd, shotIndex, model).
  const promptIndex = new Map<string, PromptVersion>();
  for (const p of prompts) {
    promptIndex.set(`${p.sceneOrd}|${p.shotIndex}|${p.model}`, p.current);
  }

  // Tier-aware row gate. Prestige scripts only show scenes that have been
  // advanced through the Hollywood Draft Mode statuses. Micro-drama
  // scripts bypass that workflow entirely — the screenplay-approval gate
  // upstream IS the scene-approval gate, so we keep every indexed scene.
  //
  // V4.2 — primary signal is now `script.metadata.source ===
  // "micro_drama_chain"`. The old heuristic (every scene's status is
  // null) failed on freshly-indexed micro-drama scripts where the
  // scene_indexer wrote `status="pending"` — the panel then hid every
  // shot. The source-field check is authoritative regardless of the
  // status value the indexer happens to write.
  const allRows = sceneRows.data ?? [];
  const isMicroDramaByMeta =
    ((scriptInfoQ.data?.metadata as { source?: string } | undefined)?.source ?? "") ===
    "micro_drama_chain";
  const allMicroDrama =
    isMicroDramaByMeta ||
    (allRows.length > 0 &&
      allRows.every((r) => r.status === null || r.status === undefined));
  const rows = allMicroDrama
    ? allRows
    : allRows.filter((r) =>
        ["generated", "revised", "locked"].includes(r.status as string)
      );
  const briefForKey = (sceneOrd: number, shotIndex: number) =>
    briefs.find((b) => b.sceneOrd === sceneOrd && b.shotIndex === shotIndex);

  const [tab, setTab] = useState<"prompts" | "results">("prompts");

  return (
    <Panel eyebrow="Production" title="AI Video Prompts — Model Router + Adapters">
      <div className="text-xs text-bone-400">
        {isSimple ? (
          <>
            The system reads each scene, writes a one-page brief per shot
            <Explainer id="master_shot_brief" />, picks the AI video model best suited
            <Explainer id="model_router" />, and generates a prompt formatted for that model.
            You review, regenerate if needed, and approve. Your screenplay is never modified.
          </>
        ) : (
          <>
            AI-assisted cinematic production pipeline under showrunner control. Build a{" "}
            <strong>Master Shot Brief</strong>
            <Explainer id="master_shot_brief" /> per shot — that's the source of truth. The
            router<Explainer id="model_router" /> recommends a model based on the shot's{" "}
            <strong>visual weight</strong>
            <Explainer id="visual_weight" /> (not narrative importance) and per-model
            reliability scores you can edit. You can always override. Safety warnings are
            surfaced, never bypassed.
          </>
        )}
        {!ready && <span className="ml-2 text-amber-300">— write some of the draft first</span>}
      </div>
      <div className="mt-1 text-[10px] text-bone-500">
        {originContext === "draft"
          ? "Also available from Production Tools → AI Video Prompts."
          : "Built from approved draft scenes in this project."}
      </div>

      {ready && (
        <div className="mt-3">
          <PreflightCard scriptId={scriptId} />
        </div>
      )}

      {ready && (
        <div className="mt-3 flex gap-1 text-xs">
          <button
            onClick={() => setTab("prompts")}
            className={
              "rounded px-2 py-1 " +
              (tab === "prompts" ? "bg-sky-900/40 text-sky-100" : "text-bone-400 hover:bg-white/[0.04]")
            }
          >
            Shots &amp; Prompts
          </button>
          <button
            onClick={() => setTab("results")}
            className={
              "rounded px-2 py-1 " +
              (tab === "results" ? "bg-sky-900/40 text-sky-100" : "text-bone-400 hover:bg-white/[0.04]")
            }
          >
            Production Results
          </button>
        </div>
      )}

      {ready && tab === "results" && <ResultsTab scriptId={scriptId} /> }

      {ready && tab === "prompts" && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <div className="label-eyebrow">Scenes &amp; shots</div>
            <ul className="max-h-[520px] space-y-2 overflow-y-auto rounded border border-white/8 bg-white/[0.02] p-2">
              {rows.map((r) => {
                const sceneBriefs = briefs
                  .filter((b) => b.sceneOrd === r.ord)
                  .sort((a, b) => a.shotIndex - b.shotIndex);
                const scenePrompts = prompts.filter((p) => p.sceneOrd === r.ord);
                const hasFountain = r.status !== "pending";
                return (
                  <li key={r.ord} className="rounded border border-white/8 bg-black/20 p-1.5">
                    <SceneListHeader
                      scriptId={scriptId}
                      sceneOrd={r.ord}
                      slugline={r.slugline}
                      hasFountain={hasFountain}
                      sceneBriefs={sceneBriefs}
                      scenePrompts={scenePrompts}
                      onAutoBuilt={(first) => {
                        if (first) setSelected({ sceneOrd: r.ord, shotIndex: first });
                      }}
                    />
                    {sceneBriefs.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {sceneBriefs.map((b) => {
                          const isSel =
                            selected?.sceneOrd === r.ord && selected?.shotIndex === b.shotIndex;
                          const hasPrompt = scenePrompts.some(
                            (p) => p.shotIndex === b.shotIndex
                          );
                          const approved = scenePrompts.some(
                            (p) => p.shotIndex === b.shotIndex && p.current.approved
                          );
                          return (
                            <li key={b.shotIndex}>
                              <button
                                onClick={() =>
                                  setSelected({ sceneOrd: r.ord, shotIndex: b.shotIndex })
                                }
                                className={
                                  "flex w-full items-center justify-between rounded px-2 py-0.5 text-[11px] " +
                                  (isSel
                                    ? "bg-sky-900/40 text-sky-100"
                                    : "text-bone-300 hover:bg-white/[0.04]")
                                }
                              >
                                <span>
                                  <span className="font-mono text-bone-500">#{r.ord}.{b.shotIndex}</span>
                                  {(b.shotTags ?? []).slice(0, 2).map((t) => (
                                    <span
                                      key={t}
                                      className="ml-1 rounded border border-sky-700/40 bg-sky-900/20 px-1 text-[9px] text-sky-200"
                                    >
                                      {t}
                                    </span>
                                  ))}
                                </span>
                                <span className="flex items-center gap-1">
                                  {b.userEdited ? (
                                    <span
                                      className="rounded border border-amber-700/40 bg-amber-900/20 px-1 text-[9px] text-amber-200"
                                      title="Edited by you"
                                    >
                                      edited
                                    </span>
                                  ) : b.autoGenerated ? (
                                    <span
                                      className="rounded border border-white/10 bg-white/[0.03] px-1 text-[9px] text-bone-400"
                                      title="Auto-generated, untouched"
                                    >
                                      auto
                                    </span>
                                  ) : null}
                                  {approved ? (
                                    <span
                                      className="rounded border border-emerald-700/40 bg-emerald-900/20 px-1 text-[9px] text-emerald-200"
                                      title="Approved prompt"
                                    >
                                      ✓
                                    </span>
                                  ) : hasPrompt ? (
                                    <span
                                      className="rounded border border-sky-700/40 bg-sky-900/20 px-1 text-[9px] text-sky-200"
                                      title="Prompt(s) generated"
                                    >
                                      pr
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {sceneBriefs.length > 0 && (
                      <button
                        onClick={() =>
                          setSelected({
                            sceneOrd: r.ord,
                            shotIndex:
                              Math.max(...sceneBriefs.map((b) => b.shotIndex)) + 1,
                          })
                        }
                        className="mt-1 flex w-full items-center gap-1 rounded border border-dashed border-white/10 px-2 py-0.5 text-[10px] text-bone-500 hover:bg-white/[0.04]"
                      >
                        <Plus className="h-3 w-3" /> Add a shot manually
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <SceneTools
              scriptId={scriptId}
              sceneOrd={selected?.sceneOrd ?? rows[0]?.ord ?? null}
              slugline={
                selected
                  ? rows.find((r) => r.ord === selected.sceneOrd)?.slugline ?? ""
                  : rows[0]?.slugline ?? ""
              }
              briefs={briefs}
              prompts={prompts}
              characters={charactersQ.data ?? []}
              viewMode={viewMode}
              setViewMode={setViewMode}
            />
            {viewMode === "storyboard" && (selected?.sceneOrd ?? rows[0]?.ord) != null ? (
              <StoryboardGrid
                sceneOrd={(selected?.sceneOrd ?? rows[0]?.ord) as number}
                briefs={briefs}
                prompts={prompts}
                characters={charactersQ.data ?? []}
                onPickShot={(shot) =>
                  setSelected({
                    sceneOrd: (selected?.sceneOrd ?? rows[0]?.ord) as number,
                    shotIndex: shot,
                  })
                }
                onExpand={() => setViewMode("detail")}
              />
            ) : selected ? (
              <ShotDetail
                key={`${selected.sceneOrd}-${selected.shotIndex}`}
                scriptId={scriptId}
                sceneOrd={selected.sceneOrd}
                shotIndex={selected.shotIndex}
                brief={briefForKey(selected.sceneOrd, selected.shotIndex)}
                promptByModel={(m) =>
                  promptIndex.get(`${selected.sceneOrd}|${selected.shotIndex}|${m}`)
                }
                onChanged={() => {
                  qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
                }}
                sceneSlugline={
                  (sceneRows.data ?? []).find((r) => r.ord === selected.sceneOrd)?.slugline ?? ""
                }
              />
            ) : (
              <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs text-bone-400">
                Pick a shot from the left, or click the + to start one.
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

// Header row for each scene in the scenes-&-shots list. Carries the
// Auto-build / Regenerate-shot-briefs control, the scene-state badge, and
// a confirmation modal when the writer would overwrite user-edited briefs.
function SceneListHeader({
  scriptId,
  sceneOrd,
  slugline,
  hasFountain,
  sceneBriefs,
  scenePrompts,
  onAutoBuilt,
}: {
  scriptId: string;
  sceneOrd: number;
  slugline: string;
  hasFountain: boolean;
  sceneBriefs: MasterShotBrief[];
  scenePrompts: Array<{ shotIndex: number; current: PromptVersion }>;
  onAutoBuilt: (firstShotIndex?: number) => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [steering, setSteering] = useState("");
  const [strict, setStrict] = useState(false);
  const editedShots = sceneBriefs.filter((b) => b.userEdited).map((b) => b.shotIndex);
  const build = useMutation({
    mutationFn: (opts: {
      mode: "replace" | "fill-empty";
      confirmOverwriteUserEdits?: boolean;
      sourceStrict?: boolean;
    }) =>
      api.autoBuildBriefs(scriptId, sceneOrd, {
        ...opts,
        notes: steering.trim() || undefined,
        sourceStrict: opts.sourceStrict ?? strict,
      }),
    onSuccess: (report) => {
      setConfirm(false);
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onAutoBuilt(report.briefs[0]?.shotIndex);
    },
  });

  // Scene state badge.
  const promptCount = scenePrompts.length;
  const approvedCount = scenePrompts.filter((p) => p.current.approved).length;
  const userEditedCount = editedShots.length;
  let state: {
    label: string;
    color: string;
    title: string;
  };
  if (!hasFountain) {
    state = {
      label: "no script",
      color: "border-white/10 bg-white/[0.02] text-bone-500",
      title: "No approved scene text yet — write the scene first.",
    };
  } else if (sceneBriefs.length === 0) {
    state = {
      label: "no briefs",
      color: "border-amber-700/40 bg-amber-900/20 text-amber-200",
      title: "Scene approved — ready to auto-build the shotlist.",
    };
  } else if (approvedCount > 0 && approvedCount === sceneBriefs.length) {
    state = {
      label: "approved",
      color: "border-emerald-700/40 bg-emerald-900/20 text-emerald-200",
      title: "All briefs have an approved prompt.",
    };
  } else if (promptCount > 0) {
    state = {
      label: "prompts ready",
      color: "border-sky-700/40 bg-sky-900/20 text-sky-200",
      title: `${promptCount} prompt(s) generated; ${approvedCount} approved.`,
    };
  } else if (userEditedCount > 0) {
    state = {
      label: "user-edited",
      color: "border-amber-700/40 bg-amber-900/20 text-amber-200",
      title: `${userEditedCount} brief(s) edited by you.`,
    };
  } else {
    state = {
      label: "auto-generated",
      color: "border-white/10 bg-white/[0.03] text-bone-400",
      title: "Briefs auto-generated from the scene. Ready for the router.",
    };
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] text-bone-500">Scene #{sceneOrd}</div>
          <div className="truncate text-[11px] text-bone-200">{slugline}</div>
        </div>
        <span className={"chip " + state.color} title={state.title}>{state.label}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {sceneBriefs.length === 0 ? (
          <button
            onClick={() => build.mutate({ mode: "replace" })}
            disabled={!hasFountain || build.isPending}
            className="flex items-center gap-1 rounded border border-sky-700/60 bg-sky-900/30 px-2 py-0.5 text-[10px] text-sky-100 hover:bg-sky-900/50 disabled:opacity-40"
            title={hasFountain ? "Auto-build the shotlist + Master Shot Briefs from this scene." : "Approve the scene text first."}
          >
            {build.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            Auto-build from Scene
          </button>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            disabled={!hasFountain}
            className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
            title="Re-derive the shotlist from the current scene text."
          >
            <RefreshCcw className="h-3 w-3" /> Regenerate shot briefs
          </button>
        )}
      </div>
      {build.error && (
        <div className="mt-1 text-[10px] text-red-300">{(build.error as Error).message}</div>
      )}
      {confirm && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setConfirm(false)}
        >
          <div className="panel-strong w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-serif text-lg">Regenerate shot briefs?</h3>
            <p className="mt-1 text-xs text-bone-300">
              This re-derives the shotlist from the current scene text for{" "}
              <span className="font-mono">scene #{sceneOrd}</span>.
            </p>
            {editedShots.length > 0 && (
              <div className="mt-2 rounded border border-amber-700/50 bg-amber-900/20 p-2 text-xs text-amber-100">
                Briefs you edited (shots {editedShots.join(", ")}) will be overwritten in
                "Replace all" mode. Choose "Fill empty only" to keep them.
              </div>
            )}
            <textarea
              value={steering}
              onChange={(e) => setSteering(e.target.value)}
              placeholder="optional steering for this auto-build run…"
              className="input mt-3 min-h-[60px] w-full text-xs"
            />
            <label className="mt-2 flex items-start gap-2 text-[11px] text-bone-300">
              <input
                type="checkbox"
                checked={strict}
                onChange={(e) => setStrict(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-bone-200">Source-strict</span>{" "}
                — the AI must use only details present in the approved scene + cast
                bible. Speculative wardrobe, props, or actions get moved to "Possible
                details — not canon" instead of filling the brief.
              </span>
            </label>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button
                variant="outline"
                onClick={() =>
                  build.mutate({ mode: "fill-empty", sourceStrict: strict })
                }
                disabled={build.isPending}
              >
                Fill empty only
              </Button>
              <Button
                onClick={() =>
                  build.mutate({
                    mode: "replace",
                    confirmOverwriteUserEdits: editedShots.length > 0,
                    sourceStrict: strict,
                  })
                }
                disabled={build.isPending}
              >
                {build.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Replace all
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShotDetail({
  scriptId,
  sceneOrd,
  shotIndex,
  brief,
  promptByModel,
  onChanged,
  sceneSlugline,
}: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  brief?: MasterShotBrief;
  promptByModel: (m: ModelKey) => PromptVersion | undefined;
  onChanged: () => void;
  sceneSlugline: string;
}) {
  const qc = useQueryClient();
  const { isSimple, isAdvanced } = useUIMode();
  const setBrief = useMutation({
    mutationFn: (fields: Partial<MasterShotBrief>) =>
      api.setShotBrief(scriptId, sceneOrd, shotIndex, fields),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });
  const recommend = useQuery({
    queryKey: ["ai-recommend", scriptId, sceneOrd, shotIndex, brief?.updatedAt],
    queryFn: () => api.recommendModel(scriptId, sceneOrd, shotIndex),
    enabled: !!brief,
  });
  const [chosenModel, setChosenModel] = useState<ModelKey | null>(null);
  const [regenNotes, setRegenNotes] = useState("");
  const gen = useMutation({
    mutationFn: (m: ModelKey) => api.generatePrompt(scriptId, sceneOrd, shotIndex, m, regenNotes || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });
  // Regenerate THIS shot's Master Shot Brief. Source-strict mode strips
  // speculative fields and quarantines them under nonCanonNotes.
  const regenBrief = useMutation({
    mutationFn: (v: { sourceStrict?: boolean; fields?: string[] }) =>
      api.regenerateBrief(scriptId, sceneOrd, shotIndex, {
        notes: regenNotes || undefined,
        sourceStrict: v.sourceStrict,
        fields: v.fields,
        force: !!brief?.userEdited,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });
  const genAll = useMutation({
    mutationFn: () =>
      api.generateAllPrompts(scriptId, sceneOrd, shotIndex, {
        notes: regenNotes || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });

  // Stage-1 soft gate. If the preflight isn't green the writer gets a
  // confirmation before any generate / regenerate fires. Returning `true`
  // means "go ahead"; `false` cancels the click.
  const preflight = usePreflight(scriptId);
  const confirmIfPreflightWarns = (): boolean => {
    const msg = preflightGateMessage(preflight.data);
    if (!msg) return true;
    return window.confirm(msg);
  };

  if (!brief) {
    return (
      <BriefEditor
        sceneOrd={sceneOrd}
        shotIndex={shotIndex}
        sceneSlugline={sceneSlugline}
        onSave={(fields) => setBrief.mutate(fields)}
        saving={setBrief.isPending}
      />
    );
  }

  const recommendedModel = recommend.data?.recommended;
  const activeModel: ModelKey = chosenModel ?? recommendedModel ?? "veo";
  const activePrompt = promptByModel(activeModel);

  return (
    <div className="space-y-3">
      {/* Diagnostic — shows what approved canon will actually flow
       *  into THIS shot's prompt when regenerated. Surfaces drafts
       *  saved without "Approve as canon" so the writer isn't
       *  surprised when a regen ignores edits they thought were live. */}
      <AppliedCanonPanel
        scriptId={scriptId}
        sceneOrd={sceneOrd}
        shotIndex={shotIndex}
      />
      <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs">
        <div className="flex items-center justify-between">
          <div className="text-bone-300">
            <span className="font-mono text-bone-500">{brief.id}</span>
            <span className="ml-2">— Shot #{brief.shotIndex} of scene #{brief.sceneOrd}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => confirmIfPreflightWarns() && regenBrief.mutate({})}
              disabled={regenBrief.isPending}
              className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04] disabled:opacity-40"
              title="Regenerate this Master Shot Brief from the scene text."
            >
              {regenBrief.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw className="h-3 w-3" />
              )}
              Regenerate brief
            </button>
            <button
              onClick={() => confirmIfPreflightWarns() && regenBrief.mutate({ sourceStrict: true })}
              disabled={regenBrief.isPending}
              className="flex items-center gap-1 rounded border border-amber-700/40 bg-amber-900/15 px-2 py-0.5 text-[10px] text-amber-100 hover:bg-amber-900/30 disabled:opacity-40"
              title="Regenerate using ONLY details present in the approved scene + cast bible."
            >
              Source-strict
            </button>
            <BriefEditButton brief={brief} onSave={(f) => setBrief.mutate(f)} saving={setBrief.isPending} />
          </div>
        </div>
        {regenBrief.error && (
          <div className="mt-1 text-[10px] text-red-300">
            {(regenBrief.error as Error).message}
          </div>
        )}
        <ContinuityChipsForShot
          scriptId={scriptId}
          sceneOrd={brief.sceneOrd}
          shotIndex={brief.shotIndex}
        />
        <BriefDisplay brief={brief} mode={isSimple ? "simple" : "advanced"} />
      </div>

      <RouterCard
        recommend={recommend.data}
        loading={recommend.isLoading}
        activeModel={activeModel}
        onPick={(m) => setChosenModel(m)}
      />

      <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 space-y-2">
        {/* Stage-3 — always-visible steering notes for ANY regen. The
            buttons below adapt their label + style to show whether they
            will pick up these notes. */}
        <label className="block">
          <span className="flex items-center justify-between text-[10px] uppercase tracking-wide">
            <span className="text-bone-500">
              Steering notes for this regeneration (optional)
            </span>
            {regenNotes.trim().length > 0 && (
              <span className="text-emerald-300 normal-case tracking-normal">
                ✓ {regenNotes.trim().length} chars — Regenerate buttons below will use these
              </span>
            )}
          </span>
          <textarea
            value={regenNotes}
            onChange={(e) => setRegenNotes(e.target.value)}
            placeholder="e.g. 'Trim under 220 words.' 'Lead Sentence 1 with the phone screen, not the character.' 'Strip key-art / publicity-still language.' 'Move the closer crop on the clock.' — applied to whichever Regenerate / Generate button you click."
            className={
              "w-full py-1 text-xs mt-0.5 min-h-[44px] rounded border px-2 text-bone-100 placeholder:text-bone-500 " +
              (regenNotes.trim().length > 0
                ? "border-emerald-700/50 bg-emerald-950/15"
                : "border-white/10 bg-white/[0.04]")
            }
            rows={2}
          />
          {regenNotes.trim().length > 0 && (
            <button
              type="button"
              onClick={() => setRegenNotes("")}
              className="mt-1 text-[10px] uppercase tracking-wide text-bone-400 hover:text-bone-100"
            >
              Clear notes
            </button>
          )}
        </label>
        {(() => {
          const hasNotes = regenNotes.trim().length > 0;
          const withNotes = hasNotes ? " with notes" : "";
          const notesTitle = hasNotes
            ? `Will send your steering notes (${regenNotes.trim().length} chars) to the prompt composer.`
            : "Add steering notes above to bias the regenerated prompt.";
          if (isSimple) {
            // Plain-English primary CTA: one big Generate-for-recommended button.
            // Manual override stays accessible but visually quiet.
            return (
              <div className="space-y-2">
                <Button
                  onClick={() => confirmIfPreflightWarns() && gen.mutate(recommendedModel ?? activeModel)}
                  disabled={gen.isPending}
                  title={notesTitle}
                  className={
                    hasNotes
                      ? "ring-2 ring-emerald-500/40 ring-offset-1 ring-offset-ink-950"
                      : undefined
                  }
                >
                  {gen.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-4 w-4" />
                  )}
                  {activePrompt && activeModel === recommendedModel
                    ? `Regenerate${withNotes} — ${MODEL_LABEL[recommendedModel ?? activeModel]}`
                    : `Generate${withNotes} — ${MODEL_LABEL[recommendedModel ?? activeModel]}`}
                </Button>
                <details className="text-[11px] text-bone-500">
                  <summary className="cursor-pointer hover:text-bone-300">
                    Use a different model
                  </summary>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      className="input py-1 text-xs"
                      value={activeModel}
                      onChange={(e) => setChosenModel(e.target.value as ModelKey)}
                    >
                      {MODEL_LIST.map((m) => (
                        <option key={m} value={m}>
                          {MODEL_LABEL[m]}
                          {recommendedModel === m ? " ★ (recommended)" : ""}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      onClick={() => confirmIfPreflightWarns() && gen.mutate(activeModel)}
                      disabled={gen.isPending}
                      title={notesTitle}
                    >
                      {activePrompt ? `Regenerate${withNotes}` : `Generate${withNotes}`}
                    </Button>
                  </div>
                </details>
              </div>
            );
          }
          // Advanced row — full controls.
          return (
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="input py-1 text-xs"
                value={activeModel}
                onChange={(e) => setChosenModel(e.target.value as ModelKey)}
              >
                {MODEL_LIST.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABEL[m]}
                    {recommendedModel === m ? " ★" : ""}
                  </option>
                ))}
              </select>
              <Button
                variant={hasNotes ? "primary" : "outline"}
                onClick={() => confirmIfPreflightWarns() && gen.mutate(activeModel)}
                disabled={gen.isPending}
                title={notesTitle}
              >
                {gen.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCcw className="h-3 w-3" />}
                {activePrompt ? `Regenerate${withNotes}` : `Generate${withNotes}`}
              </Button>
              <Button
                variant={hasNotes ? "outline" : "ghost"}
                onClick={() => confirmIfPreflightWarns() && genAll.mutate()}
                disabled={genAll.isPending}
                title={notesTitle}
              >
                {genAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Generate all models{withNotes}
              </Button>
            </div>
          );
        })()}
        {activePrompt && (
          <PromptCard
            scriptId={scriptId}
            sceneOrd={sceneOrd}
            shotIndex={shotIndex}
            prompt={activePrompt}
            brief={brief}
            onChanged={onChanged}
          />
        )}
      </div>

      {isAdvanced && (
        <ComparisonGrid
          scriptId={scriptId}
          sceneOrd={sceneOrd}
          shotIndex={shotIndex}
          promptByModel={promptByModel}
        />
      )}
    </div>
  );
}

function RouterCard({
  recommend,
  loading,
  activeModel,
  onPick,
}: {
  recommend?: RouterResult;
  loading: boolean;
  activeModel: ModelKey;
  onPick: (m: ModelKey) => void;
}) {
  const { isAdvanced } = useUIMode();
  if (loading) {
    return <div className="h-16 animate-pulse-soft rounded border border-white/8 bg-white/[0.02]" />;
  }
  if (!recommend) return null;
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="text-bone-300">
          <span className="text-bone-500">Recommended:</span>{" "}
          <strong className="text-emerald-200">{MODEL_LABEL[recommend.recommended]}</strong>
          {isAdvanced && (
            <span className="ml-2 text-bone-500">
              confidence {(recommend.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>
        {activeModel !== recommend.recommended && (
          <button
            onClick={() => onPick(recommend.recommended)}
            className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
          >
            Use recommended
          </button>
        )}
      </div>
      <div className="mt-1 text-bone-300">{recommend.reason}</div>
      {recommend.durationGuidance && (
        <div className="mt-1 text-[11px] text-bone-300">
          <span className="text-bone-500">Clip-length guidance:</span>{" "}
          {recommend.durationGuidance.recommendedMinSec}–{recommend.durationGuidance.recommendedMaxSec}s
          {recommend.durationGuidance.requiresExplicitApproval && (
            <span className="ml-2 chip border-amber-700/40 bg-amber-900/15 text-amber-200">
              longer requires writer approval
            </span>
          )}
          {isAdvanced && (
            <div className="text-[10px] text-bone-500">{recommend.durationGuidance.reason}</div>
          )}
        </div>
      )}
      {/* Alternatives table — full detail in Advanced; condensed chips in Simple. */}
      {recommend.alternatives.length > 0 && isAdvanced && (
        <div className="mt-2">
          <div className="text-bone-500">Alternatives:</div>
          <ul className="mt-1 space-y-1">
            {recommend.alternatives.map((a) => (
              <li key={a.model} className="flex items-baseline gap-2">
                <button
                  className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                  onClick={() => onPick(a.model)}
                >
                  {MODEL_LABEL[a.model]} ({a.score})
                </button>
                <span className="text-bone-400">
                  {a.reasons.slice(0, 1).join("") || (a.risks[0] ? `risk: ${a.risks[0]}` : "")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {recommend.alternatives.length > 0 && !isAdvanced && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
          <span className="text-bone-500">Or try:</span>
          {recommend.alternatives.slice(0, 3).map((a) => (
            <button
              key={a.model}
              onClick={() => onPick(a.model)}
              className="rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.04]"
            >
              {MODEL_LABEL[a.model]}
            </button>
          ))}
        </div>
      )}
      {recommend.safety?.flagged && (
        <div className="mt-2 rounded border border-amber-700/50 bg-amber-900/20 p-2 text-amber-100">
          <div className="flex items-center gap-1 font-semibold">
            <ShieldAlert className="h-3 w-3" /> Safety flags: {recommend.safety.categories.join(", ")}
          </div>
          <div className="mt-1 text-bone-200">
            Compliant alternatives the system suggests (manual override still respects these):
          </div>
          <ul className="mt-1 list-disc pl-4">
            {recommend.safety.suggestedAlternatives.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PromptCard({
  scriptId,
  sceneOrd,
  shotIndex,
  prompt,
  brief,
  onChanged,
}: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  prompt: PromptVersion;
  brief: MasterShotBrief;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const approve = useMutation({
    mutationFn: () =>
      api.approvePrompt(scriptId, sceneOrd, shotIndex, prompt.model, !prompt.approved),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });
  const feedback = useMutation({
    mutationFn: (tags: FeedbackTag[]) =>
      api.setPromptFeedback(scriptId, sceneOrd, shotIndex, prompt.model, { tags }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });
  const copy = () => {
    navigator.clipboard?.writeText(prompt.mainPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  // Kling has multiple model variants (v3.0 has the best element
  // consistency for character-on-screen shots; v2.5 Turbo is the
  // cost-effective default for inserts). Show + persist the selected
  // variant for kling prompts only.
  const klingVariant =
    prompt.model === "kling"
      ? ((prompt as unknown as { klingVariant?: string }).klingVariant ??
        "kling-v2.5-turbo")
      : null;
  const setVariant = useMutation({
    mutationFn: (variant: string) =>
      api.setKlingVariant(scriptId, sceneOrd, shotIndex, variant),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-prompts", scriptId] });
      onChanged();
    },
  });
  const { isAdvanced } = useUIMode();
  const currentTags = new Set(prompt.feedback?.tags ?? []);
  const toggleTag = (t: FeedbackTag) => {
    const next = new Set(currentTags);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    feedback.mutate([...next]);
  };
  return (
    <div className="mt-3 rounded border border-white/8 bg-black/30 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-bone-500">
        {isAdvanced && (
          <span className="font-mono text-sky-300">{prompt.versionLabel}</span>
        )}
        <span className="chip border-white/12 bg-white/[0.04] text-bone-300">
          {prompt.promptType.replace(/_/g, " → ")}
        </span>
        <span>{prompt.aspectRatio}</span>
        {prompt.durationSec ? <span>{prompt.durationSec}s</span> : null}
        {klingVariant && (
          <KlingVariantSelector
            value={klingVariant}
            onChange={(v) => setVariant.mutate(v)}
            saving={setVariant.isPending}
          />
        )}
        <button
          onClick={copy}
          className="ml-auto flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-bone-300 hover:bg-white/[0.06]"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={() => approve.mutate()}
          className={
            "rounded border px-2 py-0.5 " +
            (prompt.approved
              ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-200"
              : "border-white/10 text-bone-300 hover:bg-white/[0.04]")
          }
        >
          {prompt.approved ? "Approved" : "Approve"}
        </button>
        {isAdvanced && (
          <button
            onClick={() => setGateOpen(true)}
            className="rounded border border-amber-700/50 bg-amber-900/20 px-2 py-0.5 text-amber-100 hover:bg-amber-900/40"
          >
            Quality gate &amp; log result
          </button>
        )}
      </div>
      {prompt.readiness && !prompt.readiness.ok && (
        <div className="mt-1 rounded border border-amber-700/50 bg-amber-900/20 p-2 text-[11px] text-amber-100">
          <div className="font-medium">
            Prompt is not ready — review before copying.
          </div>
          <ul className="ml-4 list-disc">
            {prompt.readiness.issues.slice(0, 5).map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-1 text-[10px] uppercase tracking-wide text-bone-500">
        Final prompt
      </div>
      <pre className="whitespace-pre-wrap text-[12px] text-bone-100">{prompt.mainPrompt}</pre>
      {prompt.negativePrompt && (
        <>
          <div className="mt-2 text-[10px] uppercase tracking-wide text-bone-500">
            Avoid / negative
          </div>
          <div className="text-[11px] text-bone-300">{prompt.negativePrompt}</div>
        </>
      )}
      {/* V3.1 — Character reference handoff. Surfaces the structured
          Kling Element ID / approved reference URL / multi-angle list
          that the composer attached to this prompt, with one-click copy
          for each so the writer can paste straight into Kling, Midjourney
          --cref, or Runway. */}
      {prompt.referenceMetadata && prompt.referenceMetadata.characters.length > 0 && (
        <CharacterReferencesLive
          scriptId={scriptId}
          stored={prompt.referenceMetadata.characters}
        />
      )}
      {/* Stage 4 — Approved Canon References (uploaded by department members,
          attached to canon fields visible in this shot, threaded into the
          prompt's referenceMetadata.canonReferences). */}
      {prompt.referenceMetadata?.canonReferences &&
        prompt.referenceMetadata.canonReferences.length > 0 && (
          <CanonReferencesBlock refs={prompt.referenceMetadata.canonReferences} />
        )}
      {(prompt.usageNotes ?? []).length > 0 && (
        <>
          <div className="mt-2 text-[10px] uppercase tracking-wide text-bone-500">
            Notes
          </div>
          <ul className="ml-4 list-disc text-[11px] text-bone-300">
            {(prompt.usageNotes ?? []).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      )}
      {/* Advanced only: prompt-construction details + adapter/model notes. */}
      {isAdvanced && (
        <details className="mt-2 text-[11px]">
          <summary className="cursor-pointer text-bone-400 hover:text-bone-200">
            Prompt construction details
          </summary>
          <div className="mt-1 space-y-1 text-bone-400">
            {prompt.adapterIngredients && (
              <div className="rounded border border-white/8 bg-white/[0.02] p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-bone-500">
                  Adapter ingredients
                </div>
                <table className="w-full text-[11px]">
                  <tbody>
                    {Object.entries(prompt.adapterIngredients).map(([k, v]) =>
                      v ? (
                        <tr key={k}>
                          <td className="w-28 align-top text-bone-500">{k}</td>
                          <td className="text-bone-200">{v}</td>
                        </tr>
                      ) : null
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {prompt.notes.length > 0 && (
              <ul className="ml-4 list-disc">
                {prompt.notes.slice(0, 6).map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
      {prompt.safetyWarnings.length > 0 && (
        <div className="mt-1 rounded border border-amber-700/40 bg-amber-900/15 p-1 text-[10px] text-amber-200">
          {prompt.safetyWarnings.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
      )}
      {isAdvanced && (
        <div className="mt-2">
          <div className="text-[10px] text-bone-500">Feedback (learns for future regens):</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.keys(FEEDBACK_LABELS) as FeedbackTag[]).map((t) => (
              <button
                key={t}
                onClick={() => toggleTag(t)}
                className={
                  "rounded border px-1.5 py-0.5 text-[10px] " +
                  (currentTags.has(t)
                    ? "border-sky-700/60 bg-sky-900/30 text-sky-100"
                    : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
                }
              >
                {FEEDBACK_LABELS[t]}
              </button>
            ))}
          </div>
        </div>
      )}
      <QualityGateDialog
        scriptId={scriptId}
        sceneOrd={sceneOrd}
        shotIndex={shotIndex}
        model={prompt.model}
        promptLabel={prompt.versionLabel}
        open={gateOpen}
        onClose={() => setGateOpen(false)}
        brief={brief}
      />
    </div>
  );
}

function ComparisonGrid({
  scriptId,
  sceneOrd,
  shotIndex,
  promptByModel,
}: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  promptByModel: (m: ModelKey) => PromptVersion | undefined;
}) {
  const filled = MODEL_LIST.map((m) => ({ m, p: promptByModel(m) })).filter((x) => !!x.p);
  if (filled.length < 2) return null;
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="text-xs text-bone-300">Side-by-side comparison</div>
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        {filled.map(({ m, p }) => (
          <div key={m} className="rounded border border-white/8 bg-black/30 p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-bone-200">{MODEL_LABEL[m]}</span>
              <span className="font-mono text-[10px] text-bone-500">{p!.versionLabel}</span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap text-[11px] text-bone-200">{p!.mainPrompt}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefEditor({
  sceneOrd,
  shotIndex,
  sceneSlugline,
  onSave,
  saving,
  initial,
}: {
  sceneOrd: number;
  shotIndex: number;
  sceneSlugline: string;
  onSave: (fields: Partial<MasterShotBrief>) => void;
  saving: boolean;
  initial?: Partial<MasterShotBrief>;
}) {
  const [form, setForm] = useState<Partial<MasterShotBrief>>({
    primaryImage: initial?.primaryImage ?? "",
    shotPurpose: initial?.shotPurpose ?? "",
    storyBeat: initial?.storyBeat ?? "",
    emotionalBeat: initial?.emotionalBeat ?? "",
    action: initial?.action ?? "",
    performanceDirection: initial?.performanceDirection ?? "",
    cameraFraming: initial?.cameraFraming ?? "MS",
    lensSuggestion: initial?.lensSuggestion ?? "35mm",
    cameraMovement: initial?.cameraMovement ?? "static",
    lighting: initial?.lighting ?? "",
    colorPalette: initial?.colorPalette ?? "",
    productionDesign: initial?.productionDesign ?? "",
    visualMotif: initial?.visualMotif ?? "",
    dialogue: initial?.dialogue ?? "",
    durationSec: initial?.durationSec ?? 5,
    aspectRatio: initial?.aspectRatio ?? "16:9",
    outputType: initial?.outputType ?? "video",
    safetyNotes: initial?.safetyNotes ?? "",
    shotTags: initial?.shotTags ?? [],
    visualWeight: initial?.visualWeight,
    longerDurationApproved: initial?.longerDurationApproved ?? false,
    cameraAwareness: initial?.cameraAwareness ?? "observational_default",
    eyeline: initial?.eyeline ?? "",
    phoneInsertMode: initial?.phoneInsertMode ?? "none",
    phoneScreenText: initial?.phoneScreenText ?? "",
    phoneShowSurroundings: initial?.phoneShowSurroundings ?? false,
  });
  const toggleTag = (t: ShotTag) => {
    const cur = new Set(form.shotTags ?? []);
    if (cur.has(t)) cur.delete(t);
    else cur.add(t);
    setForm((s) => ({ ...s, shotTags: [...cur] }));
  };
  const setWeight = (axis: keyof VisualWeight, v: number) => {
    const w: VisualWeight = form.visualWeight ?? {
      environment: 15,
      character: 30,
      object: 10,
      cameraMovement: 15,
      dialogue: 5,
      action: 15,
      atmosphere: 10,
    };
    setForm((s) => ({ ...s, visualWeight: { ...w, [axis]: Math.max(0, Math.min(100, v)) } }));
  };
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-xs">
      <div className="text-bone-300">
        New Master Shot Brief — <span className="font-mono">Scene #{sceneOrd} / Shot #{shotIndex}</span>
      </div>
      {sceneSlugline && (
        <div className="text-[10px] text-bone-500">{sceneSlugline}</div>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
        <Field
          label="Primary Image (one sentence — the image the audience remembers)"
          v={form.primaryImage}
          on={(v) => setForm((s) => ({ ...s, primaryImage: v }))}
          wide
        />
        <Field label="Shot purpose" v={form.shotPurpose} on={(v) => setForm((s) => ({ ...s, shotPurpose: v }))} wide />
        <Field label="Story beat" v={form.storyBeat} on={(v) => setForm((s) => ({ ...s, storyBeat: v }))} />
        <Field label="Emotional beat" v={form.emotionalBeat} on={(v) => setForm((s) => ({ ...s, emotionalBeat: v }))} />
        <Field label="Action (one continuous motion)" v={form.action} on={(v) => setForm((s) => ({ ...s, action: v }))} wide />
        <Field label="Performance direction" v={form.performanceDirection} on={(v) => setForm((s) => ({ ...s, performanceDirection: v }))} />
        <Field label="Dialogue (if any)" v={form.dialogue} on={(v) => setForm((s) => ({ ...s, dialogue: v }))} />
        <Field label="Camera framing (CU / MS / WS)" v={form.cameraFraming} on={(v) => setForm((s) => ({ ...s, cameraFraming: v }))} />
        <Field label="Lens" v={form.lensSuggestion} on={(v) => setForm((s) => ({ ...s, lensSuggestion: v }))} />
        <Field label="Camera movement" v={form.cameraMovement} on={(v) => setForm((s) => ({ ...s, cameraMovement: v }))} />
        <Field label="Lighting" v={form.lighting} on={(v) => setForm((s) => ({ ...s, lighting: v }))} />
        <Field label="Color palette" v={form.colorPalette} on={(v) => setForm((s) => ({ ...s, colorPalette: v }))} />
        <Field label="Production design" v={form.productionDesign} on={(v) => setForm((s) => ({ ...s, productionDesign: v }))} />
        <Field label="Visual motif" v={form.visualMotif} on={(v) => setForm((s) => ({ ...s, visualMotif: v }))} />
        <Field label="Aspect ratio (16:9 / 9:16 / 1:1 / 4:5)" v={form.aspectRatio} on={(v) => setForm((s) => ({ ...s, aspectRatio: v }))} />
        <Field label="Duration (sec)" v={String(form.durationSec ?? 8)} on={(v) => setForm((s) => ({ ...s, durationSec: Number(v) || 8 }))} />
        <label className="block">
          <div className="label-eyebrow mb-1">Output type</div>
          <select
            className="input w-full"
            value={form.outputType}
            onChange={(e) => setForm((s) => ({ ...s, outputType: e.target.value as MasterShotBrief["outputType"] }))}
          >
            <option value="video">video</option>
            <option value="still">still</option>
            <option value="either">either</option>
          </select>
        </label>
        <label className="block">
          <div className="label-eyebrow mb-1">
            Camera awareness{" "}
            <span className="ml-1 text-bone-600">
              — eyeline / lens behavior. Default is observational (no direct gaze).
            </span>
          </div>
          <select
            className="input w-full"
            value={form.cameraAwareness}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                cameraAwareness: e.target
                  .value as MasterShotBrief["cameraAwareness"],
              }))
            }
          >
            <option value="observational_default">
              observational_default (no direct-to-lens)
            </option>
            <option value="direct_to_camera">direct_to_camera</option>
            <option value="POV_character">POV_character</option>
            <option value="surveillance_camera">surveillance_camera</option>
            <option value="phone_selfie">phone_selfie</option>
            <option value="video_call">video_call</option>
            <option value="confession_camera">confession_camera</option>
          </select>
        </label>
        <Field
          label='Eyeline (where the character is looking, e.g. "Maya looks down at the phone screen, not into the lens.")'
          v={form.eyeline}
          on={(v) => setForm((s) => ({ ...s, eyeline: v }))}
          wide
        />
        <label className="block">
          <div className="label-eyebrow mb-1">
            Phone Insert Mode
            <span className="ml-1 text-bone-600">
              — when the main subject is a phone screen
            </span>
          </div>
          <select
            className="input w-full"
            value={form.phoneInsertMode}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                phoneInsertMode: e.target
                  .value as MasterShotBrief["phoneInsertMode"],
              }))
            }
          >
            <option value="none">none (not a phone insert)</option>
            <option value="lock_screen">lock_screen</option>
            <option value="text_thread">text_thread</option>
            <option value="incoming_call">incoming_call</option>
            <option value="outgoing_call">outgoing_call</option>
            <option value="typing_screen">typing_screen</option>
            <option value="photo_attachment_screen">photo_attachment_screen</option>
          </select>
        </label>
        <label className="block">
          <div className="label-eyebrow mb-1">Show surroundings</div>
          <select
            className="input w-full"
            value={form.phoneShowSurroundings ? "yes" : "no"}
            onChange={(e) =>
              setForm((s) => ({
                ...s,
                phoneShowSurroundings: e.target.value === "yes",
              }))
            }
            disabled={form.phoneInsertMode === "none"}
            title="Default no — phone inserts are tight on the screen. Set yes to allow room/hand/body in frame."
          >
            <option value="no">no — tight on screen (default)</option>
            <option value="yes">yes — allow room/hand context</option>
          </select>
        </label>
        {form.phoneInsertMode !== "none" && (
          <label className="block md:col-span-2">
            <div className="label-eyebrow mb-1">
              Verbatim on-screen text (required)
              <span className="ml-1 text-bone-600">
                — exact text the audience reads. Newlines preserved.
              </span>
            </div>
            <textarea
              className="input min-h-[60px] w-full font-mono text-[11px]"
              value={form.phoneScreenText}
              onChange={(e) =>
                setForm((s) => ({ ...s, phoneScreenText: e.target.value }))
              }
              placeholder={
                form.phoneInsertMode === "text_thread"
                  ? "DANIEL\n11:47 PM\nyou up?"
                  : form.phoneInsertMode === "lock_screen"
                  ? "DANIEL\nMessage · now"
                  : form.phoneInsertMode === "incoming_call"
                  ? "DANIEL\nmobile"
                  : "Exact text shown on the phone."
              }
            />
          </label>
        )}
        <Field label="Safety notes (if any)" v={form.safetyNotes} on={(v) => setForm((s) => ({ ...s, safetyNotes: v }))} wide />
        <div className="md:col-span-2">
          <div className="label-eyebrow mb-1 flex items-center">
            Shot tags <Explainer id="shot_tags" />
            <span className="ml-1 text-bone-600">(drives the router)</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {SHOT_TAGS.map((t) => {
              const on = (form.shotTags ?? []).includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTag(t)}
                  className={
                    "rounded border px-2 py-0.5 text-[10px] " +
                    (on
                      ? "border-sky-700/60 bg-sky-900/40 text-sky-100"
                      : "border-white/10 text-bone-400 hover:bg-white/[0.04]")
                  }
                  title={SHOT_TAG_LABEL[t]}
                >
                  {t}
                </button>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-2">
          <div className="label-eyebrow mb-1">
            Visual weight % <Explainer id="visual_weight" />
            <span className="ml-1 text-bone-600">— what does the shot need rendered well?</span>
            <span className="ml-2 text-[10px] text-bone-500">
              Router routes by visual weight × per-model reliability — not narrative importance.
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
            {VISUAL_AXES.map((axis) => {
              const v = (form.visualWeight?.[axis] as number | undefined) ?? "";
              return (
                <label key={axis} className="text-[11px] text-bone-300">
                  <span className="block text-[10px] text-bone-500">{axisLabel(axis)}</span>
                  <input
                    className="input w-full py-0.5"
                    type="number"
                    min={0}
                    max={100}
                    value={v}
                    onChange={(e) => setWeight(axis, Number(e.target.value) || 0)}
                    placeholder="auto"
                  />
                </label>
              );
            })}
          </div>
        </div>
        <label className="md:col-span-2 mt-1 flex items-center gap-2 text-xs text-bone-300">
          <input
            type="checkbox"
            checked={!!form.longerDurationApproved}
            onChange={(e) => setForm((s) => ({ ...s, longerDurationApproved: e.target.checked }))}
            className="h-3.5 w-3.5 accent-emerald-500"
          />
          Approve durations longer than the tag-default (only when low motion + simple hands + no complex dialogue)
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => onSave(form)} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save brief
        </Button>
      </div>
    </div>
  );
}

function axisLabel(a: keyof VisualWeight): string {
  switch (a) {
    case "cameraMovement":
      return "camera move";
    case "object":
      return "object / hand";
    default:
      return a;
  }
}

function BriefEditButton({
  brief,
  onSave,
  saving,
}: {
  brief: MasterShotBrief;
  onSave: (fields: Partial<MasterShotBrief>) => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
      >
        Edit brief
      </button>
    );
  }
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div className="panel-strong w-full max-w-2xl p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif text-lg">Edit Master Shot Brief</h3>
        <BriefEditor
          sceneOrd={brief.sceneOrd}
          shotIndex={brief.shotIndex}
          sceneSlugline=""
          initial={brief}
          onSave={(f) => {
            onSave(f);
            setOpen(false);
          }}
          saving={saving}
        />
      </div>
    </div>
  );
}

function BriefDisplay({
  brief,
  mode,
}: {
  brief: MasterShotBrief;
  mode: "simple" | "advanced";
}) {
  const fc = brief.fieldConfidence ?? {};
  const line = (label: string, val?: string | null, fieldKey?: keyof typeof fc) => {
    if (!val) return null;
    const conf = fieldKey ? fc[fieldKey] : undefined;
    return (
      <div className="flex gap-2">
        <span className="w-24 shrink-0 text-bone-500">{label}</span>
        <span className="flex-1 text-bone-200">{val}</span>
        {mode === "advanced" && conf && (
          <SourceConfidenceBadge confidence={conf as SourceConfidence} />
        )}
      </div>
    );
  };

  // Plain-English summary: count how many fields the AI flagged as
  // speculative / not_enough_source. The writer should sweep these before
  // approving.
  const counts = (Object.values(fc) as (SourceConfidence | undefined)[]).reduce(
    (acc, c) => {
      if (c === "speculative") acc.speculative++;
      else if (c === "conservative_inference") acc.inference++;
      else if (c === "not_enough_source") acc.empty++;
      return acc;
    },
    { speculative: 0, inference: 0, empty: 0 }
  );
  const showSummary =
    counts.speculative > 0 || counts.inference > 0;

  return (
    <div className="mt-1 space-y-0.5 text-[11px]">
      {(brief.shotTags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(brief.shotTags ?? []).map((t) => (
            <span key={t} className="chip border-sky-700/40 bg-sky-900/20 text-sky-200">
              {t}
            </span>
          ))}
        </div>
      )}

      {brief.primaryImage && (
        <div className="mt-1 rounded border border-ember-700/40 bg-ember-900/10 p-2">
          <div className="text-[10px] uppercase tracking-wide text-ember-300">
            Primary Image
          </div>
          <div className="mt-0.5 text-[12px] text-bone-100">
            {brief.primaryImage}
          </div>
          <div className="mt-0.5 text-[10px] text-bone-500">
            The composed prompt opens with this image.
          </div>
        </div>
      )}

      {/* V3.2 — camera awareness + eyeline. Surface them on every brief so
          the writer can see at a glance whether direct-to-lens is allowed
          and where the character is looking. */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <span
          className={
            "chip " +
            ((brief.cameraAwareness ?? "observational_default") === "observational_default"
              ? "border-sky-700/40 bg-sky-900/20 text-sky-200"
              : "border-amber-700/40 bg-amber-900/20 text-amber-100")
          }
          title="Camera awareness — drives the no-direct-lens rule"
        >
          {(brief.cameraAwareness ?? "observational_default").replace(/_/g, " ")}
        </span>
        {brief.phoneInsertMode && brief.phoneInsertMode !== "none" && (
          <span
            className="chip border-violet-700/40 bg-violet-900/20 text-violet-100"
            title="Phone Insert Mode — literal-screen rendering, verbatim text only"
          >
            phone: {brief.phoneInsertMode.replace(/_/g, " ")}
          </span>
        )}
        {brief.eyeline && (
          <span className="text-[11px] text-bone-300">
            <span className="text-bone-500">Eyeline:</span> {brief.eyeline}
          </span>
        )}
      </div>
      {brief.phoneInsertMode && brief.phoneInsertMode !== "none" && brief.phoneScreenText && (
        <div className="mb-2 rounded border border-violet-700/40 bg-violet-900/10 p-2 text-[11px]">
          <div className="text-bone-500">Verbatim screen text:</div>
          <pre className="mt-1 whitespace-pre-wrap font-mono text-bone-100">
            {brief.phoneScreenText}
          </pre>
        </div>
      )}

      {showSummary && (
        <div className="mb-2 rounded border border-amber-700/40 bg-amber-900/15 p-2 text-[11px] text-amber-100">
          {counts.speculative > 0 ? (
            <>
              <span className="font-medium">
                {counts.speculative} visual detail{counts.speculative === 1 ? "" : "s"}{" "}
                were inferred without direct source support.
              </span>{" "}
              Review before approving, or regenerate source-strict to keep only
              details from the approved scene.
            </>
          ) : (
            <>
              {counts.inference} visual detail{counts.inference === 1 ? "" : "s"}{" "}
              were conservative inferences from the scene. Review before approving.
            </>
          )}
        </div>
      )}

      {line("Purpose", brief.shotPurpose, "shotPurpose")}
      {line("Story", brief.storyBeat, "storyBeat")}
      {line("Emotion", brief.emotionalBeat, "emotionalBeat")}
      {line("Action", brief.action, "action")}
      {line("Performance", brief.performanceDirection, "performanceDirection")}
      {line(
        "Framing",
        `${brief.cameraFraming} · ${brief.lensSuggestion} · ${brief.cameraMovement}`,
        "cameraFraming"
      )}
      {line(
        "Light/Color",
        `${brief.lighting}${brief.colorPalette ? " · " + brief.colorPalette : ""}`,
        "lighting"
      )}
      {line(
        "Output",
        `${brief.outputType} · ${brief.aspectRatio} · ${brief.durationSec}s`,
        "outputType"
      )}
      {brief.dialogue && line("Dialogue", brief.dialogue, "dialogue")}
      {brief.props && brief.props.length > 0 && line("Props", brief.props.join(", "), "props")}
      {brief.location && line("Location", brief.location, "location")}

      {brief.visualWeight && (
        <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-bone-400">
          {(Object.keys(brief.visualWeight) as (keyof VisualWeight)[]).map((axis) =>
            brief.visualWeight![axis] > 0 ? (
              <span key={axis} className="chip border-white/10 bg-white/[0.03]">
                {axisLabel(axis)} {brief.visualWeight![axis]}%
              </span>
            ) : null
          )}
        </div>
      )}

      {brief.nonCanonNotes && (
        <div className="mt-2 rounded border border-white/8 bg-white/[0.02] p-2 text-[11px]">
          <div className="mb-1 font-medium text-bone-300">
            Possible details — not canon
          </div>
          <pre className="whitespace-pre-wrap text-bone-400">
            {brief.nonCanonNotes}
          </pre>
          <div className="mt-1 text-[10px] text-bone-500">
            Stripped from the main brief in source-strict mode. Move into the scene
            text and re-run if you want these to become canon.
          </div>
        </div>
      )}
    </div>
  );
}

// Production Results — persistent per-clip records (writer-tracked).
function ResultsTab({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const results = useQuery({
    queryKey: ["production-results", scriptId],
    queryFn: () => api.listProductionResults(scriptId),
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; patch: Partial<ProductionResult> }) =>
      api.patchProductionResult(scriptId, v.id, v.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["production-results", scriptId] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteProductionResult(scriptId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["production-results", scriptId] }),
  });
  if (results.isLoading) {
    return <div className="mt-3 h-24 animate-pulse-soft rounded bg-white/[0.03]" />;
  }
  const rows = results.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="mt-3 rounded border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-bone-400">
        No production results logged yet. Open a generated prompt → "Log result" to start
        tracking what was rendered.
      </div>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="rounded border border-white/8 bg-white/[0.02] p-2 text-[11px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-mono text-bone-500">{r.id}</span>
            <div className="flex items-center gap-1">
              <span className="chip border-white/10 bg-white/[0.04] text-bone-300">{r.model}</span>
              {r.shotTags.map((t) => (
                <span key={t} className="chip border-sky-700/40 bg-sky-900/20 text-sky-200">
                  {t}
                </span>
              ))}
              <button
                onClick={() => del.mutate(r.id)}
                className="ml-1 rounded border border-white/10 px-1 py-0.5 text-bone-400 hover:bg-white/[0.04]"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="text-bone-300">
            Scene #{r.sceneOrd}.{r.shotIndex} — prompt {r.promptVersionLabel}
          </div>
          {r.resultLink && (
            <a href={r.resultLink} target="_blank" rel="noreferrer" className="text-sky-300 underline">
              {r.resultLink}
            </a>
          )}
          {r.qualityGate && (
            <div className="mt-1 text-bone-300">
              <span className="text-bone-500">Quality gate:</span>{" "}
              <strong>{QUALITY_OUTCOME_LABEL[r.qualityGate.outcome]}</strong>{" "}
              <span className="text-bone-400">({r.qualityGate.overall}/10)</span>
            </div>
          )}
          {r.qualityGate?.fixes.length ? (
            <ul className="mt-1 list-disc pl-4 text-[10px] text-bone-400">
              {r.qualityGate.fixes.slice(0, 4).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-1 flex items-center gap-2 text-[10px]">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={r.accepted}
                onChange={(e) => patch.mutate({ id: r.id, patch: { accepted: e.target.checked } })}
                className="h-3 w-3 accent-emerald-500"
              />
              Accepted
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={r.usedInFinalEdit}
                onChange={(e) => patch.mutate({ id: r.id, patch: { usedInFinalEdit: e.target.checked } })}
                className="h-3 w-3 accent-emerald-500"
              />
              Used in final edit
            </label>
            <span className="ml-auto text-bone-500">
              {new Date(r.createdAt).toLocaleString()}
            </span>
          </div>
          {r.postNotes && <div className="mt-1 text-[10px] text-bone-300">{r.postNotes}</div>}
        </li>
      ))}
    </ul>
  );
}

// Quality Gate modal — score 10 categories, get outcome + canned fixes.
function QualityGateDialog({
  scriptId,
  sceneOrd,
  shotIndex,
  model,
  promptLabel,
  open,
  onClose,
  brief,
}: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  model: ModelKey;
  promptLabel: string;
  open: boolean;
  onClose: () => void;
  brief: MasterShotBrief;
}) {
  const qc = useQueryClient();
  const [scores, setScores] = useState<Partial<Record<QualityCategory, number>>>({});
  const [notes, setNotes] = useState("");
  const [resultLink, setResultLink] = useState("");
  const [result, setResult] = useState<QualityGateResult | null>(null);
  const evalGate = useMutation({
    mutationFn: () => api.evaluateQualityGate(scriptId, sceneOrd, shotIndex, model, scores, notes || undefined),
    onSuccess: (r) => setResult(r),
  });
  const persist = useMutation({
    mutationFn: (gate: QualityGateResult) => {
      const id = `${promptLabel}_R${Date.now()}`;
      return api.createProductionResult(scriptId, {
        id,
        scriptId,
        episodeNumber: brief.episodeNumber ?? null,
        sceneOrd,
        shotIndex,
        shotTags: brief.shotTags ?? [],
        model,
        promptVersionLabel: promptLabel,
        referenceAssets: brief.referenceAssets,
        resultLink: resultLink.trim() || undefined,
        rating: Math.round(gate.overall / 2),
        worked: [],
        failed: [],
        accepted: gate.outcome === "accept",
        usedInFinalEdit: false,
        postNotes: notes || undefined,
        qualityGate: gate,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production-results", scriptId] });
      onClose();
    },
  });
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="panel-strong w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-serif text-lg">Generation Quality Gate</h3>
        <p className="mt-1 text-xs text-bone-400">
          Score the generated clip 1–10. Outcome + concrete fixes flow back as steering on the
          next regeneration.
        </p>
        <div className="mt-2 text-[10px] text-bone-500">
          {promptLabel}
        </div>
        <div className="mt-3 grid grid-cols-1 gap-1 md:grid-cols-2">
          {QUALITY_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2 text-[11px] text-bone-300">
              <span className="flex-1">{QUALITY_CATEGORY_LABEL[k]}</span>
              <input
                type="number"
                min={1}
                max={10}
                className="input w-16 py-0.5"
                value={scores[k] ?? ""}
                placeholder="5"
                onChange={(e) =>
                  setScores((s) => ({ ...s, [k]: Number(e.target.value) || undefined }))
                }
              />
            </label>
          ))}
        </div>
        <textarea
          className="input mt-2 w-full min-h-[64px] text-xs"
          placeholder="optional review notes…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <input
          className="input mt-2 w-full text-xs"
          placeholder="optional: link to the rendered clip (URL or file path)"
          value={resultLink}
          onChange={(e) => setResultLink(e.target.value)}
        />
        {result && (
          <div className="mt-3 rounded border border-white/8 bg-black/30 p-2 text-xs">
            <div>
              Outcome: <strong>{QUALITY_OUTCOME_LABEL[result.outcome]}</strong>
              <span className="ml-2 text-bone-400">overall {result.overall}/10</span>
            </div>
            {result.fixes.length > 0 && (
              <>
                <div className="mt-1 text-bone-500">Specific fixes:</div>
                <ul className="list-disc pl-4 text-bone-300">
                  {result.fixes.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {!result ? (
            <Button onClick={() => evalGate.mutate()} disabled={evalGate.isPending}>
              {evalGate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Evaluate
            </Button>
          ) : (
            <Button onClick={() => persist.mutate(result)} disabled={persist.isPending}>
              {persist.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Log as production result
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  v,
  on,
  wide,
}: {
  label: string;
  v?: string | null;
  on: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <label className={"block " + (wide ? "md:col-span-2" : "")}>
      <div className="label-eyebrow mb-1">{label}</div>
      <input className="input w-full" value={v ?? ""} onChange={(e) => on(e.target.value)} />
    </label>
  );
}

// Kling has multiple model variants. We auto-classify each prompt at
// generation time, but the writer can override per shot here. The "info"
// blurb on each option mirrors what shows up in Kling's actual product UI
// so the writer can match decisions across tools.
const KLING_VARIANT_OPTIONS: Array<{ value: string; label: string; blurb: string }> = [
  { value: "kling-v3.0", label: "v3.0 (NEW)", blurb: "Improved element consistency + multi-shot. Best for face / continuity." },
  { value: "kling-v2.6", label: "v2.6", blurb: "Audio-visual sync. Less relevant for silent suspense." },
  { value: "kling-v2.5-turbo", label: "v2.5 Turbo", blurb: "Max creativity at exceptional value. Great for inserts." },
  { value: "kling-v2.1-master", label: "v2.1 Master", blurb: "Superb prompt adherence — best when 'do not show' rules must hold." },
  { value: "kling-v2.1", label: "v2.1", blurb: "Exceptional value & efficiency. Budget tier." },
  { value: "kling-v1.6", label: "v1.6", blurb: "Legacy." },
  { value: "kling-v1.5", label: "v1.5", blurb: "Legacy." },
];

function KlingVariantSelector({
  value,
  onChange,
  saving,
}: {
  value: string;
  onChange: (v: string) => void;
  saving: boolean;
}) {
  const current = KLING_VARIANT_OPTIONS.find((o) => o.value === value) ?? KLING_VARIANT_OPTIONS[2];
  return (
    <label
      className="inline-flex items-center gap-1 rounded border border-violet-700/40 bg-violet-900/15 px-1.5 py-0.5 text-[10px] text-violet-100"
      title={`Kling variant — ${current.blurb} Choose another variant from the dropdown to override.`}
    >
      <span className="font-mono text-violet-200">Kling</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={saving}
        className="bg-transparent text-violet-100 outline-none"
      >
        {KLING_VARIANT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink-900 text-bone-100">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------------------
//  V3.4 — Per-shot Continuity chips. Reads scripts.metadata.continuity (the
//  cached pass result) via api.getContinuityStatus, filters issues to this
//  scene/shot, and renders one chip per category (location · prop · eyeline
//  · reference · story_containment · character). Chip color = worst severity
//  for that category (fail > warning > pass). Click → opens the Continuity
//  Pass tab so the writer can see the full issue + suggested fix.
// ---------------------------------------------------------------------------
function ContinuityChipsForShot({
  scriptId,
  sceneOrd,
  shotIndex,
}: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
}) {
  const status = useQuery({
    queryKey: ["continuityStatus", scriptId],
    queryFn: () => api.getContinuityStatus(scriptId),
  });
  if (!status.data) return null;
  type Cat = ContinuityCategory;
  const CATS: Cat[] = [
    "location",
    "prop",
    "eyeline",
    "reference",
    "story_containment",
    "character",
  ];
  const LABEL: Record<Cat, string> = {
    location: "location",
    prop: "prop",
    eyeline: "eyeline",
    reference: "ref",
    story_containment: "story",
    character: "character",
  };
  const issuesHere = status.data.issues.filter(
    (i) => i.where.sceneOrd === sceneOrd && i.where.shotIndex === shotIndex
  );
  const worst = (cat: Cat): "pass" | "warning" | "fail" => {
    const items = issuesHere.filter((i) => i.category === cat);
    if (items.some((i) => i.severity === "fail")) return "fail";
    if (items.some((i) => i.severity === "warning")) return "warning";
    return "pass";
  };
  const cls = (sev: "pass" | "warning" | "fail") =>
    sev === "fail"
      ? "border-red-800/40 bg-red-950/20 text-red-200"
      : sev === "warning"
      ? "border-amber-700/40 bg-amber-900/20 text-amber-100"
      : "border-emerald-700/40 bg-emerald-900/15 text-emerald-200";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px]">
      <span className="text-bone-500">Continuity:</span>
      {CATS.map((cat) => {
        const sev = worst(cat);
        const items = issuesHere.filter((i) => i.category === cat);
        const tip =
          items.length === 0
            ? `${LABEL[cat]}: pass`
            : items.map((i) => `${i.severity}: ${i.message}`).join("\n");
        return (
          <span key={cat} className={"chip " + cls(sev)} title={tip}>
            {LABEL[cat]}: {sev}
          </span>
        );
      })}
      <span className="ml-1 text-[9px] text-bone-500">
        last run {new Date(status.data.runAt).toLocaleString()}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Stage 4 — Approved Canon References block. Renders the
//  PromptVersion.referenceMetadata.canonReferences[] array attached at
//  regen time: per-shot human-approved bed/clock/phone/etc. references
//  with thumbnail, title, field path, and approval attribution.
// ---------------------------------------------------------------------------
function CanonReferencesBlock({
  refs,
}: {
  refs: NonNullable<NonNullable<PromptVersion["referenceMetadata"]>["canonReferences"]>;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const onCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1200);
    } catch (_) {
      // ignore — copy failures are non-fatal
    }
  };
  return (
    <div className="mt-3 rounded-md border border-emerald-700/30 bg-emerald-900/15 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-emerald-200">
        <Check className="h-3 w-3" /> Approved Canon References — {refs.length}
      </div>
      <p className="mt-0.5 text-[10px] text-bone-400">
        Human-approved by department contributors. Paste these into Kling Element /
        Midjourney <code>--cref</code> / Runway reference slots when generating the video.
      </p>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
        {refs.map((r) => (
          <div
            key={r.contributionId}
            className="rounded border border-white/10 bg-black/30 overflow-hidden flex flex-col"
          >
            {r.kind === "image" && r.url && (
              <a href={r.url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={r.url}
                  alt={r.title}
                  className="aspect-video w-full object-cover"
                />
              </a>
            )}
            {r.kind === "color" && r.color_hex && (
              <div
                className="aspect-video w-full flex items-center justify-center"
                style={{ background: r.color_hex }}
              >
                <code className="bg-black/60 text-bone-100 px-1.5 py-0.5 rounded text-[10px]">
                  {r.color_hex}
                </code>
              </div>
            )}
            {r.kind === "url" && (
              <a
                href={r.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="aspect-video w-full flex items-center justify-center bg-white/[0.04] text-bone-400"
              >
                <span className="text-[10px] line-clamp-2 px-2 text-center">
                  {r.url}
                </span>
              </a>
            )}
            <div className="p-1.5 space-y-0.5">
              <div className="text-[11px] text-bone-100 font-medium line-clamp-1">
                {r.title}
              </div>
              <div className="text-[9px] font-mono text-bone-500 line-clamp-1">
                ↳ {r.fieldPath.replace(/^locationBibles\.[^.]+\./, "")
                  .replace(/^propBibles\.[^.]+\./, "")
                  .replace(/^characters\.[^.]+\.visualBible\./, "")}
              </div>
              {r.approvedAt && (
                <div className="text-[9px] text-emerald-300">
                  ✓ approved {new Date(r.approvedAt).toLocaleDateString()}
                </div>
              )}
              {(r.url || r.color_hex) && (
                <button
                  onClick={() => onCopy(r.url ?? r.color_hex ?? "", r.contributionId)}
                  className="mt-0.5 w-full rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-bone-300 hover:bg-white/[0.05]"
                >
                  {copied === r.contributionId ? "Copied!" : `Copy ${r.kind === "color" ? "hex" : "URL"}`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  V3.9 — Live character-reference overlay. The PromptVersion's
//  referenceMetadata.characters[].imageUrl / klingElementId were captured
//  at PROMPT GENERATION TIME and freeze. When the writer later updates a
//  Character Bible (e.g. pastes a new approved Midjourney URL or binds a
//  Kling Element), the stored prompt still showed the OLD link. We now
//  overlay live values from the current characters list and visibly mark
//  any field that has changed since the prompt was last generated.
// ---------------------------------------------------------------------------
function CharacterReferencesLive({
  scriptId,
  stored,
}: {
  scriptId: string;
  stored: NonNullable<PromptVersion["referenceMetadata"]>["characters"];
}) {
  const scriptQ = useQuery({
    queryKey: ["script-meta", scriptId],
    queryFn: () => api.getScript(scriptId),
  });
  const projectId = scriptQ.data?.project_id;
  const charsQ = useQuery({
    queryKey: ["characters", projectId],
    queryFn: () => api.listCharacters(projectId!),
    enabled: !!projectId,
  });
  // Build a name → live values map. Live always wins for the URL +
  // klingElementId + multiAngle; the stored values are used purely as
  // "these are the characters this shot references."
  const byName = new Map<
    string,
    {
      approvedUrl: string | null;
      anyUrl: string | null;
      klingId: string | null;
      klingName: string | null;
      multi: Array<{ url: string; angle?: string; label?: string }>;
      platform: string | null;
    }
  >();
  for (const c of charsQ.data ?? []) {
    const vb = ((c as unknown as { metadata?: { visualBible?: Record<string, unknown> } })
      .metadata?.visualBible ?? {}) as Record<string, unknown>;
    byName.set(c.name.toUpperCase(), {
      approvedUrl:
        typeof vb.approvedReferenceImageUrl === "string"
          ? (vb.approvedReferenceImageUrl as string)
          : null,
      anyUrl:
        typeof vb.approvedReferenceImageUrl === "string"
          ? (vb.approvedReferenceImageUrl as string)
          : typeof vb.referenceImageUrl === "string"
          ? (vb.referenceImageUrl as string)
          : null,
      klingId: typeof vb.klingElementId === "string" ? (vb.klingElementId as string) : null,
      klingName:
        typeof vb.klingElementName === "string"
          ? (vb.klingElementName as string)
          : null,
      multi: Array.isArray(vb.klingReferenceImages)
        ? ((vb.klingReferenceImages as Array<{ url: string; angle?: string; label?: string }>).filter(
            (r) => r && typeof r.url === "string" && r.url.trim().length > 0
          ) ?? [])
        : [],
      platform:
        typeof vb.referencePlatform === "string"
          ? (vb.referencePlatform as string)
          : null,
    });
  }
  return (
    <>
      <div className="mt-2 text-[10px] uppercase tracking-wide text-bone-500">
        Character references{" "}
        <span className="text-bone-600">
          (live — pulled from Character Bible on render)
        </span>
      </div>
      <ul className="mt-1 space-y-1.5">
        {stored.map((r) => {
          const live = byName.get(r.name.toUpperCase());
          // Live wins; stored is fallback only.
          const imageUrl = live?.anyUrl ?? r.imageUrl ?? null;
          const klingId = live?.klingId ?? r.klingElementId ?? null;
          const klingName = live?.klingName ?? r.klingElementName ?? null;
          const multi = (live?.multi.length ?? 0) > 0 ? live!.multi : r.multiAngle;
          const platform = live?.platform ?? r.platform ?? null;
          const urlChanged =
            r.imageUrl != null && live?.anyUrl != null && r.imageUrl !== live.anyUrl;
          const klingChanged =
            r.klingElementId != null &&
            live?.klingId != null &&
            r.klingElementId !== live.klingId;
          return (
            <li
              key={r.name}
              className="rounded border border-white/8 bg-white/[0.02] p-2 text-[11px]"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-bone-100">{r.name}</span>
                {platform && (
                  <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                    {platform.replace("_", " ")}
                  </span>
                )}
                {(urlChanged || klingChanged) && (
                  <span
                    className="chip border-amber-700/40 bg-amber-900/20 text-amber-100"
                    title="The Character Bible has updated since this prompt was generated. Showing the live value."
                  >
                    bible updated
                  </span>
                )}
              </div>
              {imageUrl && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <a
                    href={imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-sky-300 hover:underline"
                  >
                    {imageUrl}
                  </a>
                  <button
                    onClick={() => navigator.clipboard?.writeText(imageUrl)}
                    className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                  >
                    Copy URL
                  </button>
                </div>
              )}
              {klingId && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-bone-500">Kling Element ID:</span>
                  <code className="rounded bg-black/30 px-1.5 py-0.5 text-bone-100">
                    {klingId}
                  </code>
                  {klingName && (
                    <span className="text-bone-400">({klingName})</span>
                  )}
                  <button
                    onClick={() => navigator.clipboard?.writeText(klingId)}
                    className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                  >
                    Copy Element ID
                  </button>
                </div>
              )}
              {multi.length > 0 && (
                <div className="mt-1">
                  <div className="text-bone-500">Multi-angle ({multi.length}):</div>
                  <ul className="ml-3 list-disc">
                    {multi.map((a, i) => (
                      <li key={`${a.url}-${i}`} className="truncate">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-300 hover:underline"
                        >
                          {a.label || a.angle || a.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
//  V4.0 — Scene Tools (view toggle + bulk export). Sits above the right
//  pane in the AI Video Prompts panel. Two responsibilities:
//
//    1. Switch the right pane between single-shot Detail and the new
//       Storyboard grid.
//    2. Export the WHOLE current scene's shot list in 4 formats:
//         • Copy as plain text (clipboard)
//         • Download as Markdown (.md)
//         • Download as CSV (.csv) — one row per shot × model
//         • Download as JSON (.json) — full structured dump
//
//  Live character refs are overlaid in every export so URLs / Kling
//  Element IDs reflect the CURRENT Character Bible, not the values
//  frozen on the stored PromptVersion.
// ---------------------------------------------------------------------------
type ExportPrompt = { sceneOrd: number; shotIndex: number; model: ModelKey; current: PromptVersion };
type CharLite = { name: string; metadata: Record<string, unknown> };

function liveRefForCharacter(c: CharLite | undefined) {
  const vb = ((c?.metadata?.visualBible as Record<string, unknown> | undefined) ?? {});
  return {
    name: c?.name ?? "",
    platform:
      typeof vb.referencePlatform === "string"
        ? (vb.referencePlatform as string)
        : null,
    approvedUrl:
      typeof vb.approvedReferenceImageUrl === "string"
        ? (vb.approvedReferenceImageUrl as string)
        : null,
    anyUrl:
      typeof vb.approvedReferenceImageUrl === "string"
        ? (vb.approvedReferenceImageUrl as string)
        : typeof vb.referenceImageUrl === "string"
        ? (vb.referenceImageUrl as string)
        : null,
    klingId:
      typeof vb.klingElementId === "string" ? (vb.klingElementId as string) : null,
    klingName:
      typeof vb.klingElementName === "string" ? (vb.klingElementName as string) : null,
  };
}

function buildSceneText(args: {
  sceneOrd: number;
  slugline: string;
  briefs: MasterShotBrief[];
  prompts: ExportPrompt[];
  characters: CharLite[];
}): string {
  const { sceneOrd, slugline, briefs, prompts, characters } = args;
  const charByName = new Map(characters.map((c) => [c.name.toUpperCase(), c]));
  const sceneBriefs = briefs
    .filter((b) => b.sceneOrd === sceneOrd)
    .sort((a, b) => a.shotIndex - b.shotIndex);
  const out: string[] = [];
  out.push(`SCENE ${sceneOrd} — ${slugline}`);
  out.push(`Shots: ${sceneBriefs.length}`);
  out.push("");
  for (const b of sceneBriefs) {
    out.push(`── SH${String(b.shotIndex).padStart(2, "0")} ──`);
    if (b.primaryImage) out.push(`Primary image: ${b.primaryImage}`);
    if (b.heroSubject) out.push(`Hero subject:  ${b.heroSubject}`);
    if (b.cameraFraming || b.frame) out.push(`Frame:         ${b.cameraFraming ?? ""}${b.frame ? ` — ${b.frame}` : ""}`);
    if (b.eyeline) out.push(`Eyeline:       ${b.eyeline}`);
    if (b.cameraAwareness) out.push(`Camera mode:   ${b.cameraAwareness}`);
    if (b.phoneInsertMode && b.phoneInsertMode !== "none")
      out.push(`Phone insert:  ${b.phoneInsertMode}`);
    if (b.phoneScreenText) out.push(`Screen text:   ${b.phoneScreenText}`);
    if (b.props && b.props.length > 0) out.push(`Props:         ${b.props.join(", ")}`);
    out.push(`Duration:      ${b.durationSec ?? 5}s · Aspect ${b.aspectRatio ?? "9:16"}`);
    const shotPrompts = prompts.filter(
      (p) => p.sceneOrd === sceneOrd && p.shotIndex === b.shotIndex
    );
    for (const p of shotPrompts) {
      const cur = p.current;
      out.push("");
      out.push(`>>> ${p.model.toUpperCase()} prompt`);
      out.push(cur.mainPrompt);
      if (cur.negativePrompt) {
        out.push("");
        out.push(`>>> ${p.model.toUpperCase()} negative`);
        out.push(cur.negativePrompt);
      }
      // Live character refs.
      const refs = (cur.referenceMetadata?.characters ?? []).map((r) => {
        const live = liveRefForCharacter(charByName.get(r.name.toUpperCase()));
        return { ...r, imageUrl: live.anyUrl ?? r.imageUrl, klingElementId: live.klingId ?? r.klingElementId, klingElementName: live.klingName ?? r.klingElementName, platform: live.platform ?? r.platform };
      });
      if (refs.length > 0) {
        out.push("");
        out.push(`>>> ${p.model.toUpperCase()} references (live from Character Bible)`);
        for (const r of refs) {
          const bits: string[] = [];
          if (r.platform) bits.push(`platform=${r.platform}`);
          if (r.imageUrl) bits.push(`image=${r.imageUrl}`);
          if (r.klingElementId) bits.push(`kling=${r.klingElementId}${r.klingElementName ? ` (${r.klingElementName})` : ""}`);
          out.push(`  • ${r.name}: ${bits.join(" · ")}`);
        }
      }
    }
    out.push("");
    out.push("");
  }
  return out.join("\n");
}

function buildSceneMarkdown(args: Parameters<typeof buildSceneText>[0]): string {
  const { sceneOrd, slugline, briefs, prompts, characters } = args;
  const charByName = new Map(characters.map((c) => [c.name.toUpperCase(), c]));
  const sceneBriefs = briefs
    .filter((b) => b.sceneOrd === sceneOrd)
    .sort((a, b) => a.shotIndex - b.shotIndex);
  const out: string[] = [];
  out.push(`# Scene ${sceneOrd} — ${slugline}`);
  out.push("");
  out.push(`**Shots:** ${sceneBriefs.length}  ·  **Exported:** ${new Date().toISOString()}`);
  out.push("");
  for (const b of sceneBriefs) {
    out.push(`## SH${String(b.shotIndex).padStart(2, "0")}`);
    out.push("");
    const meta: Array<[string, string | undefined]> = [
      ["Primary image", b.primaryImage],
      ["Hero subject", b.heroSubject],
      ["Frame", [b.cameraFraming, b.frame].filter(Boolean).join(" — ")],
      ["Eyeline", b.eyeline],
      ["Camera mode", b.cameraAwareness],
      ["Phone insert", b.phoneInsertMode && b.phoneInsertMode !== "none" ? b.phoneInsertMode : undefined],
      ["Screen text", b.phoneScreenText],
      ["Props", b.props && b.props.length > 0 ? b.props.join(", ") : undefined],
      ["Duration / Aspect", `${b.durationSec ?? 5}s · ${b.aspectRatio ?? "9:16"}`],
    ];
    for (const [k, v] of meta) if (v) out.push(`- **${k}:** ${v}`);
    out.push("");
    const shotPrompts = prompts.filter(
      (p) => p.sceneOrd === sceneOrd && p.shotIndex === b.shotIndex
    );
    for (const p of shotPrompts) {
      const cur = p.current;
      out.push(`### ${p.model.toUpperCase()}${cur.approved ? " ✓ approved" : ""}`);
      out.push("");
      out.push("**Prompt**");
      out.push("");
      out.push("```");
      out.push(cur.mainPrompt);
      out.push("```");
      if (cur.negativePrompt) {
        out.push("");
        out.push("**Negative**");
        out.push("");
        out.push("```");
        out.push(cur.negativePrompt);
        out.push("```");
      }
      const refs = cur.referenceMetadata?.characters ?? [];
      if (refs.length > 0) {
        out.push("");
        out.push("**References (live)**");
        for (const r of refs) {
          const live = liveRefForCharacter(charByName.get(r.name.toUpperCase()));
          const url = live.anyUrl ?? r.imageUrl;
          const kid = live.klingId ?? r.klingElementId;
          const kname = live.klingName ?? r.klingElementName;
          const parts: string[] = [`- **${r.name}**`];
          if (url) parts.push(`[image](${url})`);
          if (kid) parts.push(`Kling: \`${kid}\`${kname ? ` (${kname})` : ""}`);
          out.push(parts.join(" "));
        }
      }
      out.push("");
    }
    out.push("---");
    out.push("");
  }
  return out.join("\n");
}

function buildSceneCSV(args: Parameters<typeof buildSceneText>[0]): string {
  const { sceneOrd, briefs, prompts, characters } = args;
  const charByName = new Map(characters.map((c) => [c.name.toUpperCase(), c]));
  const esc = (v: string | undefined | null) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const sceneBriefs = briefs
    .filter((b) => b.sceneOrd === sceneOrd)
    .sort((a, b) => a.shotIndex - b.shotIndex);
  const rows: string[] = [];
  rows.push(
    "scene,shot,model,approved,duration_sec,aspect,hero_subject,camera_awareness,eyeline,phone_insert_mode,phone_screen_text,prompt,negative,character_refs"
  );
  for (const b of sceneBriefs) {
    const shotPrompts = prompts.filter(
      (p) => p.sceneOrd === sceneOrd && p.shotIndex === b.shotIndex
    );
    if (shotPrompts.length === 0) {
      rows.push(
        [
          sceneOrd,
          b.shotIndex,
          "(none)",
          "",
          b.durationSec ?? "",
          b.aspectRatio ?? "",
          esc(b.heroSubject ?? ""),
          esc(b.cameraAwareness ?? ""),
          esc(b.eyeline ?? ""),
          esc(b.phoneInsertMode ?? ""),
          esc(b.phoneScreenText ?? ""),
          "",
          "",
          "",
        ].join(",")
      );
      continue;
    }
    for (const p of shotPrompts) {
      const cur = p.current;
      const refs = (cur.referenceMetadata?.characters ?? [])
        .map((r) => {
          const live = liveRefForCharacter(charByName.get(r.name.toUpperCase()));
          return `${r.name}: ${live.anyUrl ?? r.imageUrl ?? ""}${(live.klingId ?? r.klingElementId) ? ` | kling=${live.klingId ?? r.klingElementId}` : ""}`;
        })
        .join(" ; ");
      rows.push(
        [
          sceneOrd,
          b.shotIndex,
          p.model,
          cur.approved ? "yes" : "",
          cur.durationSec ?? b.durationSec ?? "",
          cur.aspectRatio ?? b.aspectRatio ?? "",
          esc(b.heroSubject ?? ""),
          esc(b.cameraAwareness ?? ""),
          esc(b.eyeline ?? ""),
          esc(b.phoneInsertMode ?? ""),
          esc(b.phoneScreenText ?? ""),
          esc(cur.mainPrompt),
          esc(cur.negativePrompt ?? ""),
          esc(refs),
        ].join(",")
      );
    }
  }
  return rows.join("\n");
}

function buildSceneJSON(args: Parameters<typeof buildSceneText>[0]): string {
  const { sceneOrd, slugline, briefs, prompts, characters } = args;
  const charByName = new Map(characters.map((c) => [c.name.toUpperCase(), c]));
  const sceneBriefs = briefs
    .filter((b) => b.sceneOrd === sceneOrd)
    .sort((a, b) => a.shotIndex - b.shotIndex);
  const payload = {
    exportedAt: new Date().toISOString(),
    scene: { ord: sceneOrd, slugline },
    shots: sceneBriefs.map((b) => {
      const shotPrompts = prompts
        .filter((p) => p.sceneOrd === sceneOrd && p.shotIndex === b.shotIndex)
        .map((p) => {
          const cur = p.current;
          const refs = (cur.referenceMetadata?.characters ?? []).map((r) => {
            const live = liveRefForCharacter(charByName.get(r.name.toUpperCase()));
            return {
              name: r.name,
              platform: live.platform ?? r.platform,
              imageUrl: live.anyUrl ?? r.imageUrl,
              klingElementId: live.klingId ?? r.klingElementId,
              klingElementName: live.klingName ?? r.klingElementName,
              multiAngle: r.multiAngle,
            };
          });
          return {
            model: p.model,
            approved: cur.approved,
            mainPrompt: cur.mainPrompt,
            negativePrompt: cur.negativePrompt,
            durationSec: cur.durationSec,
            aspectRatio: cur.aspectRatio,
            usageNotes: cur.usageNotes,
            references: refs,
          };
        });
      return {
        shotIndex: b.shotIndex,
        primaryImage: b.primaryImage,
        heroSubject: b.heroSubject,
        forbiddenDominantDetails: b.forbiddenDominantDetails,
        cameraFraming: b.cameraFraming,
        frame: b.frame,
        eyeline: b.eyeline,
        cameraAwareness: b.cameraAwareness,
        phoneInsertMode: b.phoneInsertMode,
        phoneScreenText: b.phoneScreenText,
        props: b.props,
        durationSec: b.durationSec,
        aspectRatio: b.aspectRatio,
        prompts: shotPrompts,
      };
    }),
  };
  return JSON.stringify(payload, null, 2);
}

function downloadFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function SceneTools({
  scriptId: _scriptId,
  sceneOrd,
  slugline,
  briefs,
  prompts,
  characters,
  viewMode,
  setViewMode,
}: {
  scriptId: string;
  sceneOrd: number | null;
  slugline: string;
  briefs: MasterShotBrief[];
  prompts: ExportPrompt[];
  characters: CharLite[];
  viewMode: "detail" | "storyboard";
  setViewMode: (m: "detail" | "storyboard") => void;
}) {
  const [copied, setCopied] = useState(false);
  if (sceneOrd == null) return null;
  const args = { sceneOrd, slugline, briefs, prompts, characters };
  const shotCount = briefs.filter((b) => b.sceneOrd === sceneOrd).length;
  const slug = (slugline || `scene_${sceneOrd}`)
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-white/8 bg-white/[0.02] p-2 text-[11px]">
      <span className="text-bone-400">
        Scene {sceneOrd} ({shotCount} shot{shotCount === 1 ? "" : "s"})
      </span>
      <div className="ml-1 inline-flex rounded border border-white/10 bg-black/30">
        <button
          onClick={() => setViewMode("detail")}
          className={
            "px-2 py-0.5 text-[10px] " +
            (viewMode === "detail"
              ? "bg-sky-900/40 text-sky-100"
              : "text-bone-300 hover:bg-white/[0.04]")
          }
        >
          Detail
        </button>
        <button
          onClick={() => setViewMode("storyboard")}
          className={
            "px-2 py-0.5 text-[10px] " +
            (viewMode === "storyboard"
              ? "bg-sky-900/40 text-sky-100"
              : "text-bone-300 hover:bg-white/[0.04]")
          }
        >
          Storyboard
        </button>
      </div>
      <span className="ml-auto text-[10px] text-bone-500">Export scene:</span>
      <button
        onClick={async () => {
          const text = buildSceneText(args);
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — silent. */
          }
        }}
        className={
          "rounded border px-2 py-0.5 text-[10px] " +
          (copied
            ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
            : "border-white/10 text-bone-300 hover:bg-white/[0.04]")
        }
        title="Copy the whole scene's shot list to your clipboard as plain text."
      >
        {copied ? "Copied" : "Copy text"}
      </button>
      <button
        onClick={() => downloadFile(`SC${sceneOrd}_${slug}.md`, "text/markdown", buildSceneMarkdown(args))}
        className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
        title="Download the scene as a Markdown file."
      >
        .md
      </button>
      <button
        onClick={() => downloadFile(`SC${sceneOrd}_${slug}.csv`, "text/csv", buildSceneCSV(args))}
        className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
        title="Download the scene as CSV (one row per shot × model). Open in Sheets / Excel."
      >
        .csv
      </button>
      <button
        onClick={() =>
          downloadFile(`SC${sceneOrd}_${slug}.json`, "application/json", buildSceneJSON(args))
        }
        className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
        title="Download the scene as structured JSON."
      >
        .json
      </button>
    </div>
  );
}

function StoryboardGrid({
  sceneOrd,
  briefs,
  prompts,
  characters,
  onPickShot,
  onExpand,
}: {
  sceneOrd: number;
  briefs: MasterShotBrief[];
  prompts: ExportPrompt[];
  characters: CharLite[];
  onPickShot: (shotIndex: number) => void;
  onExpand: () => void;
}) {
  const charByName = new Map(characters.map((c) => [c.name.toUpperCase(), c]));
  const sceneBriefs = briefs
    .filter((b) => b.sceneOrd === sceneOrd)
    .sort((a, b) => a.shotIndex - b.shotIndex);
  if (sceneBriefs.length === 0) {
    return (
      <div className="rounded border border-dashed border-white/10 bg-white/[0.02] p-4 text-center text-xs text-bone-400">
        No briefs in this scene yet.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
      {sceneBriefs.map((b) => {
        const shotPrompts = prompts.filter(
          (p) => p.sceneOrd === sceneOrd && p.shotIndex === b.shotIndex
        );
        // Thumbnail: use the first visible character's live approved URL,
        // or null for a placeholder tile.
        const firstChar = (b.characters ?? [])[0];
        const live = firstChar
          ? liveRefForCharacter(charByName.get(firstChar.name.toUpperCase()))
          : null;
        const thumb = live?.anyUrl ?? null;
        const heroChip =
          b.heroSubject ??
          (b.phoneInsertMode && b.phoneInsertMode !== "none"
            ? `phone:${b.phoneInsertMode}`
            : firstChar?.name ?? "—");
        const promptPreview =
          shotPrompts[0]?.current?.mainPrompt?.slice(0, 200) ?? "(no prompt yet)";
        const approved = shotPrompts.some((p) => p.current.approved);
        return (
          <button
            key={b.shotIndex}
            onClick={() => {
              onPickShot(b.shotIndex);
              onExpand();
            }}
            className="group flex flex-col overflow-hidden rounded border border-white/10 bg-white/[0.02] text-left hover:border-sky-700/40 hover:bg-white/[0.04]"
            title={`Click to open SH${b.shotIndex} in Detail view`}
          >
            <div className="aspect-[9/16] w-full overflow-hidden bg-black/30">
              {thumb ? (
                <img
                  src={thumb}
                  alt={`Reference for SH${b.shotIndex}`}
                  className="h-full w-full object-cover opacity-90 group-hover:opacity-100"
                />
              ) : (
                <div className="grid h-full w-full place-items-center p-2 text-center text-[10px] text-bone-500">
                  {b.phoneInsertMode && b.phoneInsertMode !== "none"
                    ? "📱 phone insert"
                    : b.heroSubject
                    ? `🎯 ${b.heroSubject}`
                    : "shot placeholder"}
                </div>
              )}
            </div>
            <div className="space-y-0.5 p-2 text-[10px]">
              <div className="flex items-center gap-1">
                <span className="font-mono text-bone-500">
                  SH{String(b.shotIndex).padStart(2, "0")}
                </span>
                <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                  {heroChip}
                </span>
                {approved && (
                  <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                    ✓
                  </span>
                )}
                <span className="ml-auto text-bone-500">
                  {b.durationSec ?? 5}s · {b.aspectRatio ?? "9:16"}
                </span>
              </div>
              {b.eyeline && (
                <div className="text-[10px] text-bone-400">
                  <span className="text-bone-500">eyeline:</span>{" "}
                  {b.eyeline.length > 60 ? b.eyeline.slice(0, 58) + "…" : b.eyeline}
                </div>
              )}
              <div className="line-clamp-3 text-[10px] text-bone-300">
                {promptPreview}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
