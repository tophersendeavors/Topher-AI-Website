// Sound / Music / Atmosphere Bible page.
//
// Per-episode. Reads the current draft (often locked) as SOURCE and
// writes to projects.metadata.soundBibles[episodeId]. The page surfaces:
//   • DraftWritingContext banner — "Reading from Draft N — locked. Sound
//     Bible writes to project metadata only."
//   • Per-section generate / regen-with-notes / approve controls.
//   • Composer-injection visibility: scene rows show whether the
//     composer will inject their canon (only when approved).
//   • Markdown copy + JSON download.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  AudioLines,
  Check,
  Copy,
  Download,
  FileText,
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
import { DraftWritingContext } from "@/components/ui/DraftWritingContext";
import { WayfinderPanel } from "@/components/ui/WayfinderPanel";
import type {
  MusicAdapter,
  MusicPromptPack,
  SoundBible,
  SoundBibleResponse,
  SoundSceneBreakdown,
  SoundSection,
} from "@toburt/shared";

export function SoundBiblePage() {
  const { projectId, episodeId } = useParams<{ projectId: string; episodeId: string }>();
  if (!projectId || !episodeId) return null;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["sound-bible", projectId, episodeId],
    queryFn: () => api.getSoundBible(projectId, episodeId),
  });

  const audit = useQuery({
    queryKey: ["sound-bible-audit", projectId, episodeId],
    queryFn: () => api.auditSoundBible(projectId, episodeId),
    enabled: !!q.data,
  });

  const generateFull = useMutation({
    mutationFn: () => api.generateSoundBible(projectId, episodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] });
      qc.invalidateQueries({ queryKey: ["sound-bible-audit", projectId, episodeId] });
    },
  });

  const data = q.data;

  if (q.isLoading) {
    return <div className="p-8 text-bone-300">Loading Sound Bible…</div>;
  }
  if (!data) {
    return <div className="p-8 text-red-300">Failed to load Sound Bible.</div>;
  }

  const { bible, source } = data;
  const episodeLabel = source.episodeTitle
    ? `Episode ${source.episodeNumber}: ${source.episodeTitle}`
    : source.episodeNumber
    ? `Episode ${source.episodeNumber}`
    : "Episode";

  // v0 with no content means the bible has never been generated. The
  // server returns an emptySoundBible() default, but treating that as a
  // real bible misleads the user. Show a "not generated yet" state with a
  // Generate CTA instead of the empty editor.
  const hasContent =
    bible.version > 0 ||
    Object.keys(bible.scenes ?? {}).length > 0 ||
    (bible.episodeSoundIdentity?.sonicPhilosophy ?? "").trim().length > 0 ||
    (bible.musicGuidance?.scorePhilosophy ?? "").trim().length > 0 ||
    (bible.motifs ?? []).length > 0;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Production · Sound Department"
        title={`Sound, Music & Atmosphere — ${episodeLabel}`}
        description="Per-episode sound canon. Approved rows feed AI video prompt audio direction."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/episodes`}>
              <Button variant="outline">All episodes</Button>
            </Link>
            <a
              href={api.exportSoundBibleUrl(projectId, episodeId, "markdown")}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline">
                <Copy className="h-4 w-4" /> Copy markdown
              </Button>
            </a>
            <a
              href={api.exportSoundBibleUrl(projectId, episodeId, "json")}
              download={`sound-bible-${episodeLabel.replace(/\s+/g, "_")}.json`}
            >
              <Button variant="outline">
                <Download className="h-4 w-4" /> Export JSON
              </Button>
            </a>
            <Button onClick={() => generateFull.mutate()} disabled={generateFull.isPending}>
              {generateFull.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {bible.version === 0 ? "Generate full Sound Bible" : "Regenerate full Sound Bible"}
            </Button>
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <WayfinderPanel projectId={projectId} episodeId={episodeId} scope="production" />
        <SourceBanner data={data} />
        <CoverageBanner data={data} />
        <Explainer>
          The Sound Bible is its own department. It reads from the current draft (you can read a
          locked draft — you just can't modify it). All sound canon writes to project metadata.
          AI Video Prompts read <strong>only approved</strong> scene rows and sections. Drafts
          stay invisible to the composer until you approve them. Validator blocks copyrighted
          references — composer names, score titles, "in the style of…" — descriptive style
          language only.
        </Explainer>

        {!hasContent && (
          <NotGeneratedYet
            busy={generateFull.isPending}
            onGenerate={() => generateFull.mutate()}
          />
        )}

        <AuditSummary audit={audit.data?.audit} />

        <EpisodeIdentitySection
          projectId={projectId}
          episodeId={episodeId}
          bible={bible}
          onChange={() => qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] })}
        />
        <MusicGuidanceSection
          projectId={projectId}
          episodeId={episodeId}
          bible={bible}
          onChange={() => qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] })}
        />
        <MotifsSection
          projectId={projectId}
          episodeId={episodeId}
          bible={bible}
          onChange={() => qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] })}
        />
        <CharacterSignaturesSection
          projectId={projectId}
          episodeId={episodeId}
          bible={bible}
          onChange={() => qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] })}
        />
        <LocationSignaturesSection
          projectId={projectId}
          episodeId={episodeId}
          bible={bible}
          onChange={() => qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] })}
        />
        <ScenesSection
          projectId={projectId}
          episodeId={episodeId}
          bible={bible}
          onChange={() => qc.invalidateQueries({ queryKey: ["sound-bible", projectId, episodeId] })}
        />
        <MusicGenerationSection projectId={projectId} episodeId={episodeId} bible={bible} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Not-generated-yet state — shown when bible is the emptySoundBible default
// ---------------------------------------------------------------------------

function NotGeneratedYet({
  busy,
  onGenerate,
}: {
  busy: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-900/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-lg text-bone-50">
            Sound Bible not generated yet
          </h3>
          <p className="mt-1 text-[12.5px] text-bone-300">
            Nothing here is real canon — the empty editor below is a template.
            Generate the full Sound Bible to populate identity, music guidance,
            motifs, and per-scene rows from the current draft. You'll review
            and approve each section before the composer reads it.
          </p>
          <ul className="mt-2 space-y-0.5 text-[11.5px] text-bone-400">
            <li>· Reads the current draft; never modifies it</li>
            <li>· Writes only to <code>projects.metadata.soundBibles[ep]</code></li>
            <li>· Composer reads only <strong>approved</strong> sections + scene rows</li>
          </ul>
        </div>
        <Button onClick={onGenerate} disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate Sound Bible
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source draft banner — requirement #2 from the build approval
// ---------------------------------------------------------------------------

function SourceBanner({ data }: { data: SoundBibleResponse }) {
  const { source } = data;
  const draftLabel = source.scriptDraftNumber
    ? `Draft ${source.scriptDraftNumber}`
    : "(no current draft)";
  return (
    <DraftWritingContext
      current={{
        draftNumber: source.scriptDraftNumber,
        title: draftLabel,
        isLocked: source.scriptIsLocked,
        sourceLabel: source.scriptIsLocked ? "locked writing draft" : null,
      }}
      // We always READ from this draft and WRITE to project metadata, so
      // the relationship is non-mutating — render the outline_only mode
      // which already says "creates / writes elsewhere, doesn't mutate
      // the source." That's exactly the Sound Bible contract.
      mode="outline_only"
      outlineKind="scene_list"
    />
  );
}

// ---------------------------------------------------------------------------
// Coverage banner — non-blocking note when bible covers every locked
// scene, blocking warning when scenes are missing or extra.
// ---------------------------------------------------------------------------

function CoverageBanner({ data }: { data: SoundBibleResponse }) {
  const { coverage, bible } = data;
  if (!coverage || bible.version === 0) return null;
  if (coverage.isFullyCovered) {
    return (
      <div className="rounded-md border border-emerald-700/30 bg-emerald-900/10 px-3 py-2 text-[12.5px] text-bone-200">
        <span className="text-emerald-200">Coverage complete:</span>{" "}
        {coverage.presentOrds.length} of {coverage.expectedOrds.length}{" "}
        locked scenes covered ·{" "}
        {coverage.approvedSceneCount} of {coverage.expectedOrds.length}{" "}
        approved.
        {bible.sourceDraftLabel && (
          <span className="text-bone-400">
            {" "}· source: {bible.sourceDraftLabel}
            {bible.sourceWasLocked ? " (locked)" : ""}
          </span>
        )}
      </div>
    );
  }
  const missingNote =
    coverage.missingOrds.length > 0
      ? ` Missing scene${coverage.missingOrds.length === 1 ? "" : "s"} ${coverage.missingOrds.join(", ")}.`
      : "";
  const extraNote =
    coverage.extraOrds.length > 0
      ? ` Extra row${coverage.extraOrds.length === 1 ? "" : "s"} for scene${coverage.extraOrds.length === 1 ? "" : "s"} ${coverage.extraOrds.join(", ")} (no longer in script).`
      : "";
  return (
    <div className="rounded-lg border border-amber-700/40 bg-amber-900/15 p-3.5">
      <div className="flex items-start gap-2 text-[10.5px] uppercase tracking-[0.18em] text-amber-200">
        Sound Bible incomplete
      </div>
      <div className="mt-1 text-[13.5px] text-bone-50">
        {coverage.presentOrds.length} of {coverage.expectedOrds.length}{" "}
        locked scenes covered.{missingNote}{extraNote}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-bone-300">
        The whole-bible approval is blocked until coverage is complete. Use{" "}
        <strong>Regenerate</strong> on the Scenes section to fill the missing
        row{coverage.missingOrds.length === 1 ? "" : "s"}, or prune the extra
        row{coverage.extraOrds.length === 1 ? "" : "s"} if scenes have been
        removed from the script.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit summary panel
// ---------------------------------------------------------------------------

function AuditSummary({ audit }: { audit: SoundBibleResponse["bible"] extends never ? never : import("@toburt/shared").SoundAuditResult | undefined }) {
  if (!audit) return null;
  const totals = Object.values(audit.summary).reduce(
    (acc, s) => ({ pass: acc.pass + s.pass, warning: acc.warning + s.warning, fail: acc.fail + s.fail }),
    { pass: 0, warning: 0, fail: 0 }
  );
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="text-bone-50 font-serif">Audit</div>
        <div className="flex items-center gap-3 text-xs text-bone-400">
          <span className={totals.fail > 0 ? "text-red-300" : "text-bone-400"}>
            {totals.fail} fail
          </span>
          <span className={totals.warning > 0 ? "text-amber-300" : "text-bone-400"}>
            {totals.warning} warning
          </span>
        </div>
      </div>
      {audit.checks.length === 0 ? (
        <div className="mt-2 text-sm text-bone-400">No issues found.</div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {audit.checks.slice(0, 12).map((c) => (
            <li key={c.id} className="text-sm">
              <span
                className={`mr-2 inline-block rounded px-1.5 py-0.5 text-xs ${
                  c.severity === "fail"
                    ? "bg-red-900/40 text-red-200"
                    : c.severity === "warning"
                    ? "bg-amber-900/30 text-amber-200"
                    : "bg-emerald-900/30 text-emerald-200"
                }`}
              >
                {c.severity}
              </span>
              <span className="text-bone-100">{c.message}</span>
              {c.suggestedFix && (
                <span className="ml-2 text-xs text-bone-400">{c.suggestedFix}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable section header with regen + approve
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  approvedAt,
  projectId,
  episodeId,
  section,
  onChange,
}: {
  icon: React.ElementType;
  title: string;
  approvedAt: string | null;
  projectId: string;
  episodeId: string;
  section: SoundSection;
  onChange: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const regen = useMutation({
    mutationFn: (n?: string) => api.generateSoundBibleSection(projectId, episodeId, section, n),
    onSuccess: () => {
      setNotes("");
      setShowNotes(false);
      onChange();
    },
  });
  const approve = useMutation({
    mutationFn: () => api.approveSoundSection(projectId, episodeId, section),
    onSuccess: () => onChange(),
  });
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-bone-50">
          <Icon className="h-4 w-4" /> {title}
          {approvedAt ? (
            <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-100">
              <Check className="h-3 w-3" /> approved · composer reads this
            </span>
          ) : (
            <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-100">
              draft · composer does NOT read this
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => regen.mutate(undefined)}
            disabled={regen.isPending}
          >
            {regen.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Regenerate
          </Button>
          <Button variant="ghost" onClick={() => setShowNotes((x) => !x)}>
            Regenerate with notes
          </Button>
          {!approvedAt && (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve
            </Button>
          )}
        </div>
      </div>
      {showNotes && (
        <div className="mt-2 flex gap-2">
          <textarea
            className="input flex-1"
            placeholder="Notes for this regeneration (e.g. 'silence on Margot is louder; no score in the casita')"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
          <Button
            onClick={() => regen.mutate(notes)}
            disabled={regen.isPending || !notes.trim()}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §1 Episode identity
// ---------------------------------------------------------------------------

function EpisodeIdentitySection({
  projectId,
  episodeId,
  bible,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
  onChange: () => void;
}) {
  const id = bible.episodeSoundIdentity;
  return (
    <Panel eyebrow="§1" title="Episode Sound Identity">
      <SectionHeader
        icon={AudioLines}
        title="Sonic identity"
        approvedAt={id.sectionApprovedAt}
        projectId={projectId}
        episodeId={episodeId}
        section="episodeSoundIdentity"
        onChange={onChange}
      />
      <div className="mt-3 space-y-2 text-sm">
        <Field label="Sonic philosophy">{id.sonicPhilosophy || <em className="text-bone-400">(not generated)</em>}</Field>
        <ChipList label="Silence rules" items={id.silenceRules} />
        <ChipList label="Music restraint rules" items={id.musicRestraintRules} />
        <ChipList label="Atmosphere palette" items={id.atmospherePalette} />
        <ChipList label="Recurring motifs" items={id.recurringMotifIds} mono />
        <Field label="Emotional use of sound">{id.emotionalUseOfSound || <em className="text-bone-400">(not generated)</em>}</Field>
        <ChipList label="Forbidden sound clichés" items={id.forbiddenSoundCliches} />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// §6 Music guidance
// ---------------------------------------------------------------------------

function MusicGuidanceSection({
  projectId,
  episodeId,
  bible,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
  onChange: () => void;
}) {
  const m = bible.musicGuidance;
  return (
    <Panel eyebrow="§2" title="Music Guidance">
      <SectionHeader
        icon={Music}
        title="Score philosophy"
        approvedAt={m.sectionApprovedAt}
        projectId={projectId}
        episodeId={episodeId}
        section="musicGuidance"
        onChange={onChange}
      />
      <div className="mt-3 space-y-2 text-sm">
        <Field label="Score philosophy">{m.scorePhilosophy || <em className="text-bone-400">(not generated)</em>}</Field>
        <ChipList label="Forbidden music moments" items={m.forbiddenMusicMoments} />
        <ChipList label="Permitted tonal underscore moments" items={m.permittedTonalUnderscoreMoments} />
        <Field label="Trailer music direction">{m.trailerMusicDirection || <em className="text-bone-400">(not generated)</em>}</Field>
        <Field label="Reference style language (descriptive only)">
          {m.referenceStyleLanguage || <em className="text-bone-400">(not generated)</em>}
        </Field>
        <ChipList label="Emotional restraint rules" items={m.emotionalRestraintRules} />
      </div>
      <div className="mt-3 text-xs text-amber-300">
        Validator blocks composer names, film score titles, song titles, "in the style of [X]".
        Use descriptive style language only — e.g. <em>"sparse strings, low sub-bass pulse, dry
        room tone, distant insects, no melodic line."</em>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// §3 Motifs
// ---------------------------------------------------------------------------

function MotifsSection({
  projectId,
  episodeId,
  bible,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
  onChange: () => void;
}) {
  return (
    <Panel eyebrow="§3" title="Motifs">
      <SectionHeader
        icon={Volume2}
        title="Recurring sound motifs"
        approvedAt={null}
        projectId={projectId}
        episodeId={episodeId}
        section="motifs"
        onChange={onChange}
      />
      <div className="mt-3 space-y-2">
        {bible.motifs.length === 0 ? (
          <div className="text-sm text-bone-400">(no motifs yet)</div>
        ) : (
          <ul className="space-y-2">
            {bible.motifs.map((m) => (
              <li key={m.id} className="rounded-md border border-white/8 bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <span className="font-serif text-bone-50">{m.label}</span>
                  <span className="font-mono text-xs text-bone-500">{m.id}</span>
                </div>
                <div className="mt-1 text-sm text-bone-200">{m.description}</div>
                <div className="mt-1 text-xs text-bone-500">
                  Introduced @ scene {m.introducedAtSceneOrd ?? "?"} · Recurs @{" "}
                  {m.recurringAtSceneOrds.join(", ") || "—"}
                </div>
                <div className="mt-1 text-xs text-bone-300">
                  <strong>Function.</strong> {m.emotionalFunction}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// §4 Character signatures
// ---------------------------------------------------------------------------

function CharacterSignaturesSection({
  projectId,
  episodeId,
  bible,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
  onChange: () => void;
}) {
  const entries = Object.entries(bible.characterSignatures);
  return (
    <Panel eyebrow="§4" title="Character Sound Signatures">
      <SectionHeader
        icon={Volume2}
        title="Per-character sound"
        approvedAt={null}
        projectId={projectId}
        episodeId={episodeId}
        section="characterSignatures"
        onChange={onChange}
      />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {entries.length === 0 ? (
          <div className="text-sm text-bone-400">(no character signatures yet)</div>
        ) : (
          entries.map(([name, s]) => (
            <div key={name} className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm">
              <div className="font-serif text-bone-50">{s.characterName}</div>
              <ChipList label="Associated sounds" items={s.associatedSounds} />
              <Field label="Silence pattern">{s.silencePattern}</Field>
              <ChipList label="Object sounds" items={s.objectSounds} />
              <Field label="Sound disappearance">{s.soundDisappearance}</Field>
              <ChipList label="Avoidance signals" items={s.avoidanceSignals} />
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// §5 Location signatures
// ---------------------------------------------------------------------------

function LocationSignaturesSection({
  projectId,
  episodeId,
  bible,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
  onChange: () => void;
}) {
  const entries = Object.entries(bible.locationSignatures);
  return (
    <Panel eyebrow="§5" title="Location Sound Signatures">
      <SectionHeader
        icon={Volume2}
        title="Per-location sound"
        approvedAt={null}
        projectId={projectId}
        episodeId={episodeId}
        section="locationSignatures"
        onChange={onChange}
      />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {entries.length === 0 ? (
          <div className="text-sm text-bone-400">(no location signatures yet)</div>
        ) : (
          entries.map(([key, s]) => (
            <div key={key} className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-serif text-bone-50">{s.locationName}</span>
                <span className="font-mono text-xs text-bone-500">{s.locationKey}</span>
                {s.musicProhibited && (
                  <span className="chip border-red-700/40 bg-red-900/20 text-red-200">no music</span>
                )}
              </div>
              <Field label="Ambient bed">{s.ambientBed}</Field>
              <ChipList label="Key diegetic present" items={s.keyDiegeticPresent} />
              <ChipList label="Anchored motifs" items={s.anchoredMotifIds} mono />
              {s.notes && <Field label="Notes">{s.notes}</Field>}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// §2 Per-scene breakdown — composer gate is per-row here
// ---------------------------------------------------------------------------

function ScenesSection({
  projectId,
  episodeId,
  bible,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
  onChange: () => void;
}) {
  const ords = Object.keys(bible.scenes)
    .map((k) => parseInt(k, 10))
    .sort((a, b) => a - b);
  return (
    <Panel eyebrow="§6" title="Per-Scene Breakdown">
      <SectionHeader
        icon={FileText}
        title="Scene-by-scene"
        approvedAt={null /* always shown; per-scene approval handled inline */}
        projectId={projectId}
        episodeId={episodeId}
        section="scenes"
        onChange={onChange}
      />
      <div className="mt-3 space-y-2">
        {ords.length === 0 ? (
          <div className="text-sm text-bone-400">
            (no scenes yet — generate the per-scene section)
          </div>
        ) : (
          ords.map((ord) => (
            <SceneRow
              key={ord}
              projectId={projectId}
              episodeId={episodeId}
              row={bible.scenes[String(ord)]}
              onChange={onChange}
            />
          ))
        )}
      </div>
    </Panel>
  );
}

function SceneRow({
  projectId,
  episodeId,
  row,
  onChange,
}: {
  projectId: string;
  episodeId: string;
  row: SoundSceneBreakdown;
  onChange: () => void;
}) {
  const approve = useMutation({
    mutationFn: () => api.approveSoundScene(projectId, episodeId, row.ord),
    onSuccess: () => onChange(),
  });
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="font-serif text-bone-50">
          Scene {row.ord} — <span className="text-bone-300">{row.sceneHeading}</span>
        </div>
        <div className="flex items-center gap-2">
          {row.approvedAt ? (
            <span className="chip border-emerald-700/50 bg-emerald-900/30 text-emerald-100">
              <Lock className="h-3 w-3" /> approved · composer reads
            </span>
          ) : (
            <span className="chip border-amber-700/50 bg-amber-900/30 text-amber-100">
              draft · composer does NOT read
            </span>
          )}
          {!row.approvedAt && (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve scene
            </Button>
          )}
        </div>
      </div>
      <div className="mt-1 grid gap-2 md:grid-cols-2">
        <Field label="Ambient bed">{row.ambientBed || <em className="text-bone-400">—</em>}</Field>
        <Field label="Non-diegetic music">{row.nonDiegeticMusic || <em className="text-bone-400">—</em>}</Field>
        <ChipList label="Key diegetic" items={row.keyDiegetic} />
        <ChipList label="Motifs" items={row.motifIds} mono />
        {row.silenceNotes && <Field label="Silence">{row.silenceNotes}</Field>}
        {row.transitionSound && <Field label="Transition">{row.transitionSound}</Field>}
        {row.aiVideoPromptAudioNotes && (
          <Field label="AI-video audio">{row.aiVideoPromptAudioNotes}</Field>
        )}
        {Object.keys(row.characterSounds).length > 0 && (
          <div className="md:col-span-2">
            <div className="label-eyebrow mb-0.5">Character sounds</div>
            <ul className="text-bone-200">
              {Object.entries(row.characterSounds).map(([name, sound]) => (
                <li key={name}>
                  <span className="text-bone-400">{name}:</span> {sound}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny reusable bits
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label-eyebrow mb-0.5">{label}</div>
      <div className="text-bone-100">{children}</div>
    </div>
  );
}

function ChipList({ label, items, mono = false }: { label: string; items: string[]; mono?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <div className="label-eyebrow mb-0.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <span
            key={i}
            className={`chip border-white/10 bg-white/[0.04] text-bone-100 ${mono ? "font-mono text-xs" : ""}`}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Music Generation / Export — Suno + Udio + Composer Brief adapters
// ---------------------------------------------------------------------------

function MusicGenerationSection({
  projectId,
  episodeId,
  bible,
}: {
  projectId: string;
  episodeId: string;
  bible: SoundBible;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["music-pack", projectId, episodeId],
    queryFn: () => api.getMusicPack(projectId, episodeId),
  });
  const generate = useMutation({
    mutationFn: () => api.generateMusicPack(projectId, episodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["music-pack", projectId, episodeId] }),
  });
  const regen = useMutation({
    mutationFn: (slot: "episode" | "scenes" | "trailer" | "motifs") =>
      api.generateMusicSlot(projectId, episodeId, slot),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["music-pack", projectId, episodeId] }),
  });
  const approve = useMutation({
    mutationFn: () => api.approveMusicPack(projectId, episodeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["music-pack", projectId, episodeId] }),
  });

  const pack = q.data?.pack ?? null;
  const readiness = q.data?.canonReadiness;
  const ready = readiness
    ? readiness.episodeIdentityApproved || readiness.musicGuidanceApproved || readiness.approvedSceneCount > 0
    : false;

  return (
    <Panel eyebrow="§7" title="Music Generation — Suno · Udio · Composer Brief">
      <div className="flex items-start gap-2">
        <Music className="mt-0.5 h-4 w-4 text-bone-200" />
        <div className="flex-1 text-sm text-bone-300">
          Derived view of the Sound Bible canon. Generates tool-agnostic music prompts and
          renders them through Suno, Udio, or Composer Brief adapters at copy time. <strong>Only
          approved Sound Bible canon flows in</strong> — drafts are skipped. No copyrighted
          composer / score / song references. Default: instrumental only, no vocals.
        </div>
      </div>

      {readiness && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
          <ReadinessTile label="Episode identity" ok={readiness.episodeIdentityApproved} />
          <ReadinessTile label="Music guidance" ok={readiness.musicGuidanceApproved} />
          <ReadinessTile
            label={`Scenes approved`}
            ok={readiness.approvedSceneCount === readiness.totalSceneCount && readiness.totalSceneCount > 0}
            note={`${readiness.approvedSceneCount}/${readiness.totalSceneCount}`}
          />
          <ReadinessTile label={`Motifs`} ok={readiness.motifCount > 0} note={`${readiness.motifCount}`} />
          <ReadinessTile
            label="Pack approved"
            ok={!!pack?.approvedAt}
            note={pack?.derivedFromApprovedCanon ? "from approved canon" : "from draft canon"}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => generate.mutate()} disabled={!ready || generate.isPending}>
          {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {pack ? "Regenerate full pack" : "Generate music pack"}
        </Button>
        {pack && !pack.approvedAt && (
          <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Approve pack
          </Button>
        )}
        <a href={api.musicPackJsonUrl(projectId, episodeId)} download>
          <Button variant="outline">
            <Download className="h-4 w-4" /> Export JSON
          </Button>
        </a>
      </div>

      {!ready && (
        <div className="mt-3 rounded-md border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">
          Approve at least one Sound Bible section first — Episode Identity, Music Guidance, or
          a per-scene row. Music prompts are derived ONLY from approved canon.
        </div>
      )}

      {pack && (
        <div className="mt-4 space-y-4">
          {/* Episode soundtrack */}
          {pack.episodeSoundtrack && (
            <MusicPromptCard
              title="Episode soundtrack"
              projectId={projectId}
              episodeId={episodeId}
              scope="episode"
              onRegen={() => regen.mutate("episode")}
              regenLabel="Regenerate episode soundtrack"
              prompt={pack.episodeSoundtrack}
            />
          )}
          {/* Trailer */}
          {pack.trailer && (
            <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-serif text-bone-50">Trailer music</div>
                <Button variant="outline" onClick={() => regen.mutate("trailer")} disabled={regen.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate trailer
                </Button>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                {(["15", "30", "60"] as const).map((v) => (
                  <div key={v} className="rounded border border-white/8 bg-white/[0.02] p-2 text-xs">
                    <div className="text-bone-200">Trailer · {v}s</div>
                    <CopyRow
                      projectId={projectId}
                      episodeId={episodeId}
                      scope={`trailer:${v}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-bone-300 md:grid-cols-4">
                <div><span className="text-bone-500">Start.</span> {pack.trailer.buildStructure.start}</div>
                <div><span className="text-bone-500">Rise.</span> {pack.trailer.buildStructure.rise}</div>
                <div><span className="text-bone-500">Break.</span> {pack.trailer.buildStructure.break}</div>
                <div><span className="text-bone-500">Final hit.</span> {pack.trailer.buildStructure.finalHit}</div>
              </div>
            </div>
          )}
          {/* Scenes */}
          {Object.keys(pack.scenePrompts).length > 0 && (
            <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-serif text-bone-50">
                  Per-scene music prompts ({Object.keys(pack.scenePrompts).length})
                </div>
                <Button variant="outline" onClick={() => regen.mutate("scenes")} disabled={regen.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate scenes
                </Button>
              </div>
              <ul className="mt-2 space-y-2">
                {Object.entries(pack.scenePrompts)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([ord, p]) => (
                    <li key={ord} className="rounded border border-white/8 bg-white/[0.02] p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-bone-100">
                          Scene {ord}
                          {p.noMusic && (
                            <span className="ml-2 chip border-red-700/40 bg-red-900/20 text-red-200">no music</span>
                          )}
                        </div>
                        <CopyRow projectId={projectId} episodeId={episodeId} scope={`scene:${ord}`} />
                      </div>
                      <div className="mt-1 text-bone-300">{p.description}</div>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {/* Motifs */}
          {pack.motifFragments.length > 0 && (
            <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-serif text-bone-50">Motif fragments ({pack.motifFragments.length})</div>
                <Button variant="outline" onClick={() => regen.mutate("motifs")} disabled={regen.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" /> Regenerate motifs
                </Button>
              </div>
              <ul className="mt-2 grid gap-2 md:grid-cols-2">
                {pack.motifFragments.map((f) => (
                  <li key={f.motifId} className="rounded border border-white/8 bg-white/[0.02] p-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-bone-100">
                        <span className="font-serif">{f.motifLabel}</span>{" "}
                        <span className="font-mono text-bone-500">{f.motifId}</span>
                      </div>
                      <CopyRow projectId={projectId} episodeId={episodeId} scope={`motif:${f.motifId}`} />
                    </div>
                    <div className="mt-1 text-bone-300">{f.prompt}</div>
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

function ReadinessTile({ label, ok, note }: { label: string; ok: boolean; note?: string }) {
  return (
    <div
      className={`rounded border p-2 text-center ${
        ok
          ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-100"
          : "border-amber-700/40 bg-amber-900/15 text-amber-100"
      }`}
    >
      <div className="text-bone-500">{label}</div>
      <div>
        {ok ? "approved" : "draft"}
        {note ? ` · ${note}` : ""}
      </div>
    </div>
  );
}

function MusicPromptCard({
  title,
  projectId,
  episodeId,
  scope,
  onRegen,
  regenLabel,
  prompt,
}: {
  title: string;
  projectId: string;
  episodeId: string;
  scope: string;
  onRegen: () => void;
  regenLabel: string;
  prompt: MusicPromptPack["episodeSoundtrack"];
}) {
  if (!prompt) return null;
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-serif text-bone-50">{title}</div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onRegen}>
            <RefreshCw className="h-3.5 w-3.5" /> {regenLabel}
          </Button>
        </div>
      </div>
      <div className="mt-2 text-sm text-bone-200">{prompt.description}</div>
      <div className="mt-2">
        <CopyRow projectId={projectId} episodeId={episodeId} scope={scope} />
      </div>
    </div>
  );
}

function CopyRow({
  projectId,
  episodeId,
  scope,
}: {
  projectId: string;
  episodeId: string;
  scope: string;
}) {
  const [copied, setCopied] = useState<MusicAdapter | null>(null);
  async function copy(adapter: MusicAdapter) {
    try {
      const text = await api.exportMusicPack(projectId, episodeId, adapter, scope);
      await navigator.clipboard.writeText(text);
      setCopied(adapter);
      setTimeout(() => setCopied(null), 1400);
    } catch (e) {
      // surface a simple inline failure
      alert(`Copy failed: ${(e as Error).message}`);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button variant="outline" onClick={() => copy("suno")}>
        {copied === "suno" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        Suno
      </Button>
      <Button variant="outline" onClick={() => copy("udio")}>
        {copied === "udio" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        Udio
      </Button>
      <Button variant="outline" onClick={() => copy("composer_brief")}>
        {copied === "composer_brief" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        Composer Brief
      </Button>
    </div>
  );
}
