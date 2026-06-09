// Curated Shot List — reusable page for every project type.
//
// Reads from `scripts.metadata.aiPrompts.briefs` via the new /shot-list
// endpoint. Reuses the existing autoBuild + regenerateOneBrief generators
// for regeneration — does NOT introduce a second shot-list generator.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Volume2,
} from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Explainer } from "@/components/ui/Explainer";
import type {
  ShotEditPatch,
  ShotListResponse,
  ShotListRow,
  ShotListSceneGroup,
} from "@toburt/shared";

export function ShotListPage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  if (!projectId || !episodeId) return null;
  const qc = useQueryClient();

  // Resolve the current script for this episode.
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });
  const targetScript = useMemo(() => {
    if (!scripts.data) return null;
    const eps = scripts.data.filter(
      (s) => ((s as { episode_id?: string | null }).episode_id ?? null) === episodeId
    );
    return eps.find((s) => s.current) ?? eps[0] ?? null;
  }, [scripts.data, episodeId]);

  const shotList = useQuery({
    queryKey: ["shot-list", targetScript?.id],
    queryFn: () => api.getShotList(targetScript!.id),
    enabled: !!targetScript?.id,
  });

  const approveEpisode = useMutation({
    mutationFn: () => api.approveShotList(targetScript!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", targetScript?.id] }),
  });

  if (scripts.isLoading || (!!targetScript && shotList.isLoading)) {
    return <div className="p-8 text-bone-300">Loading shot list…</div>;
  }
  if (!targetScript) {
    return (
      <div className="space-y-4 p-8">
        <PageHeader
          eyebrow="Production · Shot List"
          title="No script for this episode yet"
          description="Approve a screenplay first; the shot list reads from it."
        />
        <Link to={`/projects/${projectId}/episodes`}>
          <Button variant="outline">
            <ArrowLeft className="h-4 w-4" /> Back to episodes
          </Button>
        </Link>
      </div>
    );
  }
  if (!shotList.data) {
    return <div className="p-8 text-red-300">Failed to load shot list.</div>;
  }

  const list = shotList.data;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow={`Production · ${list.policy.label} shot list`}
        title={
          list.episodeNumber
            ? `Episode ${list.episodeNumber}${list.episodeTitle ? ` — ${list.episodeTitle}` : ""}`
            : list.scriptTitle ?? "Shot list"
        }
        description={`${list.approval.shotApprovedCount} of ${list.approval.shotTotalCount} shots approved · ${list.approval.sceneApprovedCount} of ${list.approval.sceneTotalCount} scenes approved`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/episodes`}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Episodes
              </Button>
            </Link>
            <a href={api.exportShotListUrl(targetScript.id, "markdown")} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Copy className="h-4 w-4" /> Markdown
              </Button>
            </a>
            <a
              href={api.exportShotListUrl(targetScript.id, "csv")}
              download={`shot-list-${list.episodeNumber ?? targetScript.id}.csv`}
            >
              <Button variant="outline">
                <Download className="h-4 w-4" /> CSV
              </Button>
            </a>
            <a
              href={api.exportShotListUrl(targetScript.id, "json")}
              download={`shot-list-${list.episodeNumber ?? targetScript.id}.json`}
            >
              <Button variant="outline">
                <Download className="h-4 w-4" /> JSON
              </Button>
            </a>
            {!list.approval.episodeApprovedAt && (
              <Button
                onClick={() => approveEpisode.mutate()}
                disabled={approveEpisode.isPending || list.approval.shotTotalCount === 0}
              >
                {approveEpisode.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Approve full episode
              </Button>
            )}
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <PolicyBanner list={list} />
        <Explainer>
          The Curated Shot List is the human-facing view over the AI shot briefs.
          AI Video Prompts read the SAME briefs — when a shot is approved here,
          the prompt panel treats it as canon; unapproved shots can still be
          composed but the composer marks them <em>"using unapproved brief."</em>{" "}
          This page never writes to the screenplay; it only edits the curated
          brief layer and the approval map.
        </Explainer>

        {list.scenes.length === 0 ? (
          <div className="rounded-md border border-white/8 bg-white/[0.02] p-6 text-sm text-bone-300">
            No shot briefs yet. Open this episode's <strong>AI Video Prompts</strong>{" "}
            panel and run <strong>Auto-build briefs</strong> on each scene; the
            generated briefs will appear here.
          </div>
        ) : (
          list.scenes.map((scene) => (
            <SceneBlock
              key={scene.sceneOrd}
              scriptId={targetScript.id}
              scene={scene}
              policy={list.policy}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PolicyBanner({ list }: { list: ShotListResponse }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs text-bone-300">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-bone-500">Project policy:</span>
        <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
          {list.policy.label}
        </span>
        <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
          {list.policy.defaultAspectRatio}
        </span>
        <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
          {list.policy.minDurationSec}–{list.policy.maxDurationSec}s shots
        </span>
        <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
          {list.policy.coverageDensity} coverage
        </span>
        {list.policy.isMicroDramaTier && (
          <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">
            vertical / retention-first
          </span>
        )}
        {list.scriptIsLocked && (
          <span className="chip border-ember-700/60 bg-ember-900/40 text-ember-100">
            <Lock className="mr-1 inline h-3 w-3" /> source draft locked · curated edits ok
          </span>
        )}
      </div>
    </div>
  );
}

function SceneBlock({
  scriptId,
  scene,
  policy,
}: {
  scriptId: string;
  scene: ShotListSceneGroup;
  policy: ShotListResponse["policy"];
}) {
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [regenNotes, setRegenNotes] = useState("");
  const [showRegen, setShowRegen] = useState(false);
  const regen = useMutation({
    mutationFn: (notes: string) =>
      api.regenerateSceneShotList(scriptId, scene.sceneOrd, {
        notes: notes || undefined,
        mode: "replace",
        confirmOverwriteUserEdits: true,
      }),
    onSuccess: () => {
      setShowRegen(false);
      setRegenNotes("");
      qc.invalidateQueries({ queryKey: ["shot-list", scriptId] });
    },
  });
  const approveScene = useMutation({
    mutationFn: () => api.approveSceneShots(scriptId, scene.sceneOrd),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });
  const addShot = useMutation({
    mutationFn: () =>
      api.addShot(scriptId, scene.sceneOrd, {
        durationSec: policy.defaultDurationSec,
        aspectRatio: policy.defaultAspectRatio,
        productionMode: "ai_video",
        status: "draft",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });

  return (
    <Panel
      eyebrow={`Scene ${scene.sceneOrd} · ${scene.shotCount} shot${scene.shotCount === 1 ? "" : "s"}`}
      title={scene.slugline}
    >
      {scene.summary && (
        <div className="mb-2 text-sm text-bone-300">{scene.summary}</div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {scene.sceneApprovedAt ? (
          <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-100">
            <Check className="mr-1 inline h-3 w-3" /> scene approved
          </span>
        ) : (
          <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-100">
            draft
          </span>
        )}
        <Button variant="outline" onClick={() => setCollapsed((x) => !x)}>
          {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          {collapsed ? "Expand shots" : "Collapse"}
        </Button>
        <Button variant="outline" onClick={() => setShowRegen((x) => !x)}>
          <RefreshCw className="h-3.5 w-3.5" /> Regenerate scene
        </Button>
        <Button variant="outline" onClick={() => addShot.mutate()} disabled={addShot.isPending}>
          {addShot.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add shot
        </Button>
        {!scene.sceneApprovedAt && (
          <Button onClick={() => approveScene.mutate()} disabled={approveScene.isPending}>
            {approveScene.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve scene
          </Button>
        )}
      </div>
      {showRegen && (
        <div className="mb-3 flex gap-2">
          <textarea
            className="input flex-1"
            placeholder="Notes for the shotlist agent (e.g. 'cut the second insert; add a reaction on Margot before the door close')"
            value={regenNotes}
            onChange={(e) => setRegenNotes(e.target.value)}
            rows={2}
          />
          <Button onClick={() => regen.mutate(regenNotes)} disabled={regen.isPending}>
            {regen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Apply
          </Button>
        </div>
      )}
      {!collapsed && (
        <ul className="space-y-2">
          {scene.shots.length === 0 ? (
            <li className="text-sm text-bone-400">No shots yet for this scene.</li>
          ) : (
            scene.shots.map((shot, i) => (
              <ShotCard
                key={shot.id}
                scriptId={scriptId}
                ord={scene.sceneOrd}
                shot={shot}
                isFirst={i === 0}
                isLast={i === scene.shots.length - 1}
                allShots={scene.shots}
              />
            ))
          )}
        </ul>
      )}
    </Panel>
  );
}

function ShotCard({
  scriptId,
  ord,
  shot,
  isFirst,
  isLast,
  allShots,
}: {
  scriptId: string;
  ord: number;
  shot: ShotListRow;
  isFirst: boolean;
  isLast: boolean;
  allShots: ShotListRow[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ShotEditPatch>({});
  const [showRegen, setShowRegen] = useState(false);
  const [regenNotes, setRegenNotes] = useState("");

  const patchMut = useMutation({
    mutationFn: () => api.patchShot(scriptId, ord, shot.shotIndex, draft),
    onSuccess: () => {
      setEditing(false);
      setDraft({});
      qc.invalidateQueries({ queryKey: ["shot-list", scriptId] });
    },
  });
  const approve = useMutation({
    mutationFn: () => api.approveOneShot(scriptId, ord, shot.shotIndex),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });
  const dup = useMutation({
    mutationFn: () => api.duplicateShot(scriptId, ord, shot.shotIndex),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });
  const remove = useMutation({
    mutationFn: () => api.removeShot(scriptId, ord, shot.shotIndex),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });
  const regen = useMutation({
    mutationFn: (notes: string) =>
      api.regenerateOneShot(scriptId, ord, shot.shotIndex, { notes: notes || undefined, force: true }),
    onSuccess: () => {
      setShowRegen(false);
      setRegenNotes("");
      qc.invalidateQueries({ queryKey: ["shot-list", scriptId] });
    },
  });
  const moveUp = useMutation({
    mutationFn: () => {
      const ordering = allShots.map((s) => s.shotIndex);
      const i = ordering.indexOf(shot.shotIndex);
      if (i <= 0) return Promise.resolve({ ok: true } as const);
      [ordering[i - 1], ordering[i]] = [ordering[i], ordering[i - 1]];
      return api.reorderShots(scriptId, ord, ordering);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });
  const moveDown = useMutation({
    mutationFn: () => {
      const ordering = allShots.map((s) => s.shotIndex);
      const i = ordering.indexOf(shot.shotIndex);
      if (i < 0 || i >= ordering.length - 1) return Promise.resolve({ ok: true } as const);
      [ordering[i], ordering[i + 1]] = [ordering[i + 1], ordering[i]];
      return api.reorderShots(scriptId, ord, ordering);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shot-list", scriptId] }),
  });

  const statusChip = shot.approvedAt
    ? <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-100">approved</span>
    : shot.curated.status === "needs_review"
    ? <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-100">needs review</span>
    : <span className="chip border-white/10 bg-white/[0.04] text-bone-200">draft</span>;
  const modeChip = (
    <span className="chip border-white/10 bg-white/[0.04] text-bone-200">
      {shot.curated.productionMode.replace(/_/g, " ")}
    </span>
  );

  return (
    <li className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-serif text-bone-50">Shot {shot.shotIndex}</span>
          {shot.shotType && <span className="text-bone-300">· {shot.shotType}</span>}
          <span className="text-bone-500">· {shot.durationSec}s · {shot.aspectRatio}</span>
          {statusChip}
          {modeChip}
          {shot.aiModelHint && (
            <span className="chip border-white/10 bg-white/[0.04] text-bone-300">{shot.aiModelHint}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" onClick={() => moveUp.mutate()} disabled={isFirst || moveUp.isPending} title="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" onClick={() => moveDown.mutate()} disabled={isLast || moveDown.isPending} title="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" onClick={() => dup.mutate()} disabled={dup.isPending} title="Duplicate">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending} title="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" onClick={() => setShowRegen((x) => !x)}>
            <RefreshCw className="h-3.5 w-3.5" /> Regen
          </Button>
          {editing ? (
            <Button onClick={() => patchMut.mutate()} disabled={patchMut.isPending}>
              {patchMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}>Edit</Button>
          )}
          {!shot.approvedAt && (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve
            </Button>
          )}
        </div>
      </div>

      {showRegen && (
        <div className="mt-2 flex gap-2">
          <textarea
            className="input flex-1"
            placeholder="Notes for the shot regen (e.g. 'tighter on the hands; drop the dialogue beat')"
            value={regenNotes}
            onChange={(e) => setRegenNotes(e.target.value)}
            rows={2}
          />
          <Button onClick={() => regen.mutate(regenNotes)} disabled={regen.isPending}>
            {regen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Apply
          </Button>
        </div>
      )}

      {editing ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <EditField
            label="Primary image"
            value={draft.primaryImage ?? shot.primaryImage}
            onChange={(v) => setDraft((d) => ({ ...d, primaryImage: v }))}
          />
          <EditField
            label="Shot type"
            value={draft.shotType ?? shot.shotType}
            onChange={(v) => setDraft((d) => ({ ...d, shotType: v }))}
          />
          <EditField
            label="Camera language"
            value={draft.cameraLanguage ?? shot.cameraLanguage}
            onChange={(v) => setDraft((d) => ({ ...d, cameraLanguage: v }))}
          />
          <EditField
            label="Action"
            value={draft.action ?? shot.action}
            onChange={(v) => setDraft((d) => ({ ...d, action: v }))}
          />
          <EditField
            label="Emotional beat"
            value={draft.emotionalBeat ?? shot.emotionalBeat}
            onChange={(v) => setDraft((d) => ({ ...d, emotionalBeat: v }))}
          />
          <EditField
            label="Visual motif"
            value={draft.visualMotif ?? shot.visualMotif}
            onChange={(v) => setDraft((d) => ({ ...d, visualMotif: v }))}
          />
          <EditField
            label="Location"
            value={draft.location ?? shot.location}
            onChange={(v) => setDraft((d) => ({ ...d, location: v }))}
          />
          <EditField
            label="Characters (comma-separated)"
            value={(draft.characters ?? shot.characters).join(", ")}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                characters: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
          />
          <EditField
            label="Props (comma-separated)"
            value={(draft.props ?? shot.props).join(", ")}
            onChange={(v) =>
              setDraft((d) => ({
                ...d,
                props: v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              }))
            }
          />
          <EditField
            label="Duration (sec)"
            type="number"
            value={String(draft.durationSec ?? shot.durationSec)}
            onChange={(v) => setDraft((d) => ({ ...d, durationSec: Number(v) }))}
          />
          <EditField
            label="Aspect ratio"
            value={draft.aspectRatio ?? shot.aspectRatio}
            onChange={(v) => setDraft((d) => ({ ...d, aspectRatio: v }))}
          />
          <EditField
            label="AI model hint"
            value={draft.aiModelHint ?? shot.aiModelHint ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, aiModelHint: v || null }))}
          />
          <div>
            <div className="label-eyebrow mb-1">Production mode</div>
            <select
              className="input w-full"
              value={draft.productionMode ?? shot.curated.productionMode}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  productionMode: e.target.value as ShotEditPatch["productionMode"],
                }))
              }
            >
              <option value="ai_video">AI video</option>
              <option value="live_action">Live action</option>
              <option value="hybrid">Hybrid</option>
              <option value="storyboard_only">Storyboard only</option>
            </select>
          </div>
          <div>
            <div className="label-eyebrow mb-1">Status</div>
            <select
              className="input w-full"
              value={draft.status ?? shot.curated.status}
              onChange={(e) =>
                setDraft((d) => ({ ...d, status: e.target.value as ShotEditPatch["status"] }))
              }
            >
              <option value="draft">Draft</option>
              <option value="needs_review">Needs review</option>
              <option value="approved">Approved</option>
            </select>
          </div>
        </div>
      ) : (
        <div className="mt-2 grid gap-2 md:grid-cols-2 text-bone-200">
          <Field label="Primary image">{shot.primaryImage || <em className="text-bone-500">—</em>}</Field>
          <Field label="Camera">{shot.cameraLanguage || <em className="text-bone-500">—</em>}</Field>
          <Field label="Subject">{shot.subject}</Field>
          <Field label="Action">{shot.action || <em className="text-bone-500">—</em>}</Field>
          {shot.emotionalBeat && <Field label="Emotional beat">{shot.emotionalBeat}</Field>}
          {shot.visualMotif && <Field label="Visual motif">{shot.visualMotif}</Field>}
          {shot.location && <Field label="Location">{shot.location}</Field>}
          {shot.characters.length > 0 && <Field label="Characters">{shot.characters.join(", ")}</Field>}
          {shot.props.length > 0 && <Field label="Props">{shot.props.join(", ")}</Field>}
          {shot.soundContext && (
            <div className="md:col-span-2 rounded border border-emerald-700/30 bg-emerald-950/20 p-2 text-xs text-emerald-100">
              <Volume2 className="mr-1 inline h-3 w-3" />
              <strong>Sound (approved canon):</strong> {shot.soundContext.ambientBed}
              {shot.soundContext.nonDiegeticMusic ? ` · music: ${shot.soundContext.nonDiegeticMusic}` : ""}
              {shot.soundContext.audioField ? ` · audio: ${shot.soundContext.audioField}` : ""}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-eyebrow">{label}</div>
      <div className="text-bone-100">{children}</div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <div className="label-eyebrow mb-1">{label}</div>
      <input
        className="input w-full"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
