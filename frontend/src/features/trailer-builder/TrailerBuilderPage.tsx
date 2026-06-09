// Trailer / Teaser Builder — reusable page for every project type.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  Film,
  Loader2,
  Lock,
  Music,
  RefreshCw,
  Sparkles,
  Volume2,
} from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Explainer } from "@/components/ui/Explainer";
import { WayfinderPanel } from "@/components/ui/WayfinderPanel";
import type {
  TrailerBeat,
  TrailerPack,
  TrailerPackResponse,
  TrailerPlan,
  TrailerVariantKey,
} from "@toburt/shared";

const VARIANT_LABELS: Record<TrailerVariantKey, string> = {
  teaser15: "15-second teaser",
  teaser30: "30-second teaser",
  trailer60: "60-second trailer",
  social: "Social cutdown",
};

export function TrailerBuilderPage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  if (!projectId || !episodeId) return null;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["trailer-pack", projectId, episodeId],
    queryFn: () => api.getTrailerPack(projectId, episodeId),
  });

  const [activeVariant, setActiveVariant] = useState<TrailerVariantKey>("teaser30");
  const [includeSocial, setIncludeSocial] = useState(false);

  const generateAll = useMutation({
    mutationFn: () => api.generateTrailerPack(projectId, episodeId, includeSocial),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trailer-pack", projectId, episodeId] }),
  });
  const approvePack = useMutation({
    mutationFn: () => api.approveTrailerPack(projectId, episodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trailer-pack", projectId, episodeId] }),
  });

  if (q.isLoading) return <div className="p-8 text-bone-300">Loading trailer builder…</div>;
  if (!q.data) return <div className="p-8 text-red-300">Failed to load trailer pack.</div>;

  const { pack, source } = q.data;
  const variants: TrailerVariantKey[] = ["teaser15", "teaser30", "trailer60", "social"];
  const epLabel = source.episodeNumber
    ? `Episode ${source.episodeNumber}${source.episodeTitle ? `: ${source.episodeTitle}` : ""}`
    : "Episode";

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow={`Production · ${source.projectTypeLabel} trailer builder`}
        title={`${epLabel} — Trailer & Teaser`}
        description={`Generate 15s / 30s / 60s plans grounded in approved shot briefs, sound canon, and the episode chain. ${source.approvedShotCount} of ${source.totalShotCount} shots approved · music ${source.approvedMusic ? "approved" : "draft"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/episodes`}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Episodes
              </Button>
            </Link>
            <a href={api.exportTrailerUrl(projectId, episodeId, { format: "markdown" })} target="_blank" rel="noreferrer">
              <Button variant="outline">
                <Copy className="h-4 w-4" /> Markdown
              </Button>
            </a>
            <a
              href={api.exportTrailerUrl(projectId, episodeId, { format: "json" })}
              download={`trailer-${source.episodeNumber ?? episodeId}.json`}
            >
              <Button variant="outline">
                <Download className="h-4 w-4" /> JSON
              </Button>
            </a>
            <label className="flex items-center gap-1 text-xs text-bone-300">
              <input
                type="checkbox"
                checked={includeSocial}
                onChange={(e) => setIncludeSocial(e.target.checked)}
              />
              Include social cutdown
            </label>
            <Button onClick={() => generateAll.mutate()} disabled={generateAll.isPending}>
              {generateAll.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {pack.version === 0 ? "Generate trailer pack" : "Regenerate full pack"}
            </Button>
            {!pack.approvedAt && (
              <Button onClick={() => approvePack.mutate()} disabled={approvePack.isPending || pack.version === 0}>
                {approvePack.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve pack
              </Button>
            )}
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <WayfinderPanel projectId={projectId} episodeId={episodeId} />
        <SourceBanner source={source} pack={pack} />
        <Explainer>
          The Trailer Builder is purely a derived view. It reads the
          approved Curated Shot List, the approved Sound Bible music guidance,
          the episode chain (when present), and the redev "do not reveal" rules,
          then produces per-variant plans with beat-by-beat video prompts,
          title-card copy, music fragments, and editing notes. <strong>No
          script writes.</strong> Approval-gated: when a beat references an
          unapproved shot brief, the export tags it <em>"UNAPPROVED"</em>.
        </Explainer>

        <VariantTabs
          variants={variants}
          active={activeVariant}
          pack={pack}
          onChange={setActiveVariant}
        />

        <VariantPanel
          projectId={projectId}
          episodeId={episodeId}
          variant={activeVariant}
          plan={pack.variants[activeVariant]}
        />
      </div>
    </div>
  );
}

function SourceBanner({
  source,
  pack,
}: {
  source: TrailerPackResponse["source"];
  pack: TrailerPack;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 text-xs text-bone-300">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-bone-500">Reading from:</span>
        <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
          {source.projectTypeLabel}
        </span>
        {source.scriptDraftNumber != null && (
          <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
            Draft {source.scriptDraftNumber}
            {source.scriptIsLocked && (
              <>
                {" "}
                <Lock className="ml-1 inline h-3 w-3 text-ember-300" />
              </>
            )}
          </span>
        )}
        <span
          className={`chip ${
            source.approvedShotCount > 0
              ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-100"
              : "border-amber-700/40 bg-amber-900/20 text-amber-200"
          }`}
        >
          {source.approvedShotCount > 0 ? "approved shots available" : "using unapproved shot briefs"}
        </span>
        <span
          className={`chip ${
            source.approvedMusic
              ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-100"
              : "border-amber-700/40 bg-amber-900/20 text-amber-200"
          }`}
        >
          {source.approvedMusic ? "music approved" : "music guidance draft"}
        </span>
        {source.hasEpisodeChain && (
          <span className="chip border-white/10 bg-white/[0.04] text-bone-100">
            episode chain present
          </span>
        )}
        {source.whatNotToReveal.length > 0 && (
          <span className="chip border-ember-700/60 bg-ember-900/40 text-ember-50">
            withholding {source.whatNotToReveal.length} reveal{source.whatNotToReveal.length === 1 ? "" : "s"}
          </span>
        )}
        {pack.derivedFromApprovedShots === false && pack.version > 0 && (
          <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-100">
            ⚠ pack was generated from draft shot briefs
          </span>
        )}
      </div>
    </div>
  );
}

function VariantTabs({
  variants,
  active,
  pack,
  onChange,
}: {
  variants: TrailerVariantKey[];
  active: TrailerVariantKey;
  pack: TrailerPack;
  onChange: (v: TrailerVariantKey) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {variants.map((v) => {
        const plan = pack.variants[v];
        const has = !!plan;
        const approved = !!plan?.approvedAt;
        return (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={`rounded-md border px-3 py-2 text-sm transition-colors ${
              v === active
                ? "border-ember-700/60 bg-ember-900/30 text-bone-50"
                : "border-white/10 bg-white/[0.02] text-bone-300 hover:bg-white/[0.05]"
            }`}
          >
            {VARIANT_LABELS[v]}
            {has && (
              <span
                className={`ml-2 chip ${approved ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-100" : "border-white/10 bg-white/[0.04] text-bone-300"}`}
              >
                {approved ? "approved" : "draft"}
              </span>
            )}
            {!has && <span className="ml-2 text-xs text-bone-500">(not generated)</span>}
          </button>
        );
      })}
    </div>
  );
}

function VariantPanel({
  projectId,
  episodeId,
  variant,
  plan,
}: {
  projectId: string;
  episodeId: string;
  variant: TrailerVariantKey;
  plan: TrailerPlan | null;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const regen = useMutation({
    mutationFn: (n: string) => api.generateTrailerVariant(projectId, episodeId, variant, n || undefined),
    onSuccess: () => {
      setNotes("");
      setShowNotes(false);
      qc.invalidateQueries({ queryKey: ["trailer-pack", projectId, episodeId] });
    },
  });
  const approve = useMutation({
    mutationFn: () => api.approveTrailerVariant(projectId, episodeId, variant),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trailer-pack", projectId, episodeId] }),
  });

  if (!plan) {
    return (
      <Panel eyebrow="Variant" title={VARIANT_LABELS[variant]}>
        <div className="text-sm text-bone-400">
          This variant hasn't been generated yet. Use <strong>Generate trailer pack</strong> above
          or:
        </div>
        <div className="mt-3">
          <Button onClick={() => regen.mutate("")} disabled={regen.isPending}>
            {regen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate this variant
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      eyebrow={`${VARIANT_LABELS[variant]} · ${plan.durationSec}s`}
      title="Structure"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {plan.approvedAt ? (
          <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-100">
            <Check className="mr-1 inline h-3 w-3" /> approved
          </span>
        ) : (
          <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-100">draft</span>
        )}
        <Button variant="outline" onClick={() => setShowNotes((x) => !x)}>
          <RefreshCw className="h-3.5 w-3.5" /> Regenerate with notes
        </Button>
        {!plan.approvedAt && (
          <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Approve variant
          </Button>
        )}
        <a
          href={api.exportTrailerUrl(projectId, episodeId, { variant, kind: "video_prompts" })}
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="outline">
            <Film className="h-3.5 w-3.5" /> Video prompts
          </Button>
        </a>
        <a
          href={api.exportTrailerUrl(projectId, episodeId, { variant, kind: "music_prompt" })}
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="outline">
            <Music className="h-3.5 w-3.5" /> Music brief
          </Button>
        </a>
        <a
          href={api.exportTrailerUrl(projectId, episodeId, { variant })}
          target="_blank"
          rel="noreferrer"
        >
          <Button variant="outline">
            <Copy className="h-3.5 w-3.5" /> Variant markdown
          </Button>
        </a>
      </div>

      {showNotes && (
        <div className="mb-3 flex gap-2">
          <textarea
            className="input flex-1"
            placeholder="Notes for this variant (e.g. 'keep Solano silent until the final hook; trim title card to 2s')"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <Button onClick={() => regen.mutate(notes)} disabled={regen.isPending}>
            {regen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Apply
          </Button>
        </div>
      )}

      <div className="grid gap-2 text-sm md:grid-cols-2">
        <Field label="Opening image">{plan.structure.openingImage || em("—")}</Field>
        <Field label="Escalation">{plan.structure.escalation || em("—")}</Field>
        <Field label="Reveal · withheld">{plan.structure.revealWithheld || em("—")}</Field>
        <Field label="Final hook">{plan.structure.finalHook || em("—")}</Field>
        <Field label="Ending button">{plan.endingButton || em("—")}</Field>
        <Field label="Ending image">{plan.endingImage || em("—")}</Field>
        {plan.voDirection && <Field label="VO direction">{plan.voDirection}</Field>}
      </div>

      {plan.whatNotToReveal.length > 0 && (
        <div className="mt-3 rounded-md border border-ember-700/40 bg-ember-950/30 p-2 text-xs text-ember-100">
          <strong>Do not reveal:</strong> {plan.whatNotToReveal.join("; ")}
        </div>
      )}

      <div className="mt-4">
        <div className="font-serif text-bone-50">Beats ({plan.beats.length})</div>
        <ul className="mt-2 space-y-2">
          {plan.beats.length === 0 ? (
            <li className="text-sm text-bone-400">No beats yet.</li>
          ) : (
            plan.beats.map((b) => <BeatRow key={b.index} beat={b} />)
          )}
        </ul>
      </div>

      {plan.titleCardBeats.length > 0 && (
        <div className="mt-4">
          <div className="font-serif text-bone-50">Title cards</div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {plan.titleCardBeats.map((tc) => (
              <li key={tc.index} className="rounded border border-white/8 bg-white/[0.02] p-2">
                <span className="text-bone-500">{tc.position} · {tc.durationSec}s</span>
                <span className="mx-1">·</span>
                <strong className="text-bone-50">"{tc.text}"</strong>
                <div className="text-bone-300 text-xs mt-0.5">{tc.imagePrompt}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-md border border-white/8 bg-white/[0.02] p-3">
        <div className="flex items-center gap-2 text-xs text-bone-500">
          <Music className="h-3 w-3" />
          Music guidance
        </div>
        <div className="mt-1 text-sm text-bone-200">{plan.musicGuidance}</div>
      </div>
    </Panel>
  );
}

function BeatRow({ beat }: { beat: TrailerBeat }) {
  const sourceTag =
    beat.sourceSceneOrd != null && beat.sourceShotIndex != null
      ? `Scene ${beat.sourceSceneOrd} · Shot ${beat.sourceShotIndex}`
      : "standalone";
  return (
    <li className="rounded border border-white/8 bg-white/[0.02] p-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="text-bone-100">
          <span className="font-serif">Beat {beat.index}</span>{" "}
          <span className="text-bone-500">· {beat.durationSec}s · {sourceTag}</span>
        </div>
        <div className="flex items-center gap-1">
          {beat.sourceApprovedAt ? (
            <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-100">approved source</span>
          ) : beat.sourceSceneOrd != null ? (
            <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-200">unapproved source</span>
          ) : null}
          {!beat.isWithheldSafe && (
            <span className="chip border-red-700/40 bg-red-900/30 text-red-200">⚠ reveals withheld</span>
          )}
        </div>
      </div>
      <div className="mt-1 grid gap-1 md:grid-cols-2 text-bone-200 text-xs">
        <Field label="Video prompt">{beat.videoPrompt || em("—")}</Field>
        {beat.imagePrompt && <Field label="Image prompt">{beat.imagePrompt}</Field>}
        {beat.textOverlay && <Field label="Text overlay">"{beat.textOverlay}"</Field>}
        <Field label="Music">
          <Volume2 className="mr-1 inline h-3 w-3" />
          {beat.musicFragment || em("—")}
        </Field>
        <Field label="Edit">{beat.editingNote || em("—")}</Field>
      </div>
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
function em(s: string) {
  return <em className="text-bone-500">{s}</em>;
}
