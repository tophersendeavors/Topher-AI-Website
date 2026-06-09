// Export Center — central hub for every shippable artifact on a project:
// screenplay drafts, production package, sound bible / music pack, curated
// shot list, AI video prompts, trailer pack, pitch decks, and the package
// manifest preview. Read-only surface: every section links to the page that
// owns the artifact for edits / approvals, and downloads via existing
// backend export endpoints. No new generators, no script mutation.

import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  AudioLines,
  Camera,
  Check,
  Clapperboard,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Film,
  Loader2,
  Lock,
  Megaphone,
  Music,
  Package,
  Presentation,
  Sparkles,
} from "lucide-react";
import {
  EXPORT_FORMATS,
  MUSIC_ADAPTERS,
  TRAILER_VARIANTS,
  type MusicAdapter,
  type ProductionHubEpisodeRow,
  type ProductionHubResponse,
  type ProductionHubSection,
  type ProductionHubSectionStatus,
  type ProductionPackageManifest,
  type TrailerVariantKey,
} from "@toburt/shared";
import { api, DECK_KIND_LABEL, DECK_STATUS_LABEL, type PitchDeck } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function ExportCenterPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const hub = useQuery({
    queryKey: ["production-hub", projectId],
    queryFn: () => api.getProductionHub(projectId),
  });
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });
  const decks = useQuery({
    queryKey: ["pitch-decks", projectId],
    queryFn: () => api.listPitchDecks(projectId),
  });

  const projectTitle = project.data?.title ?? "Project";
  const overallPct = hub.data?.summary.overallReadinessPct ?? null;
  const projectSlug = useMemo(() => slug(projectTitle), [projectTitle]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        eyebrow="Export Center"
        title={`${projectTitle} — Exports`}
        description={
          overallPct === null
            ? "Every shippable artifact on this project, in one place."
            : `Every shippable artifact on this project — screenplays, packages, prompts, pitch. Overall readiness ${overallPct}%.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}/production`}>
              <Button variant="outline">
                Production Hub <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/pitch`}>
              <Button variant="outline">
                Pitch Materials <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/episodes`}>
              <Button variant="outline">
                Episodes <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <div className="rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3 text-[12.5px] text-bone-300">
          The Export Center is the one place to grab everything ready to ship:
          drafts, production packages, sound &amp; music prompts, curated shot
          lists, trailer pack, pitch decks, and the package manifest. Items
          that aren't generated or aren't approved yet are clearly labeled —
          fix those in the linked page, then come back here to download.
        </div>

        <ProjectPackageSection
          projectId={projectId}
          projectSlug={projectSlug}
          hub={hub.data}
          hubLoading={hub.isLoading}
        />

        <PitchSection
          projectId={projectId}
          decks={decks.data ?? []}
          loading={decks.isLoading}
        />

        <EpisodeExports
          projectId={projectId}
          projectSlug={projectSlug}
          hub={hub.data}
          hubLoading={hub.isLoading}
        />

        <ScreenplayDrafts
          scripts={scripts.data ?? []}
          loading={scripts.isLoading}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project-wide production package + manifest preview
// ---------------------------------------------------------------------------

function ProjectPackageSection({
  projectId,
  projectSlug,
  hub,
  hubLoading,
}: {
  projectId: string;
  projectSlug: string;
  hub: ProductionHubResponse | undefined;
  hubLoading: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const filename = `${projectSlug}_production_package.zip`;
  const url = api.productionPackageUrl(projectId, null);

  return (
    <Panel
      eyebrow="Project bundle"
      title={
        <span className="inline-flex items-center gap-2">
          <Package className="h-4 w-4" /> Production Package (project-wide)
        </span>
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-1.5 text-sm text-bone-300">
          <div>
            Single ZIP with every approved artifact across the project:
            screenplays (PDF / Fountain / FDX / Markdown), redev passes,
            character / location / prop bibles, sound bibles, music packs,
            curated shot lists, trailer packs, pitch materials, and the
            production bible. The manifest enumerates every entry.
          </div>
          <div className="text-xs text-bone-400">
            {hubLoading
              ? "Checking readiness…"
              : hub
              ? `${hub.summary.episodeCount} episode${hub.summary.episodeCount === 1 ? "" : "s"} · ${hub.summary.packagesReady} package-ready · overall ${hub.summary.overallReadinessPct}%`
              : "Hub data unavailable — bundle will still build."}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" onClick={() => setPreviewOpen((v) => !v)}>
            <FileText className="h-3.5 w-3.5" />
            {previewOpen ? "Hide manifest" : "Preview manifest"}
          </Button>
          <a
            className="btn-primary"
            href={url}
            download={filename}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-3.5 w-3.5" />
            Download .zip
          </a>
        </div>
      </div>
      {previewOpen && (
        <div className="mt-4 border-t border-white/8 pt-4">
          <ManifestPreview projectId={projectId} episodeId={null} />
        </div>
      )}
    </Panel>
  );
}

function ManifestPreview({
  projectId,
  episodeId,
}: {
  projectId: string;
  episodeId: string | null;
}) {
  const q = useQuery({
    queryKey: ["package-preview", projectId, episodeId ?? "project"],
    queryFn: () => api.previewProductionPackage(projectId, episodeId),
  });
  if (q.isLoading) {
    return <div className="text-xs text-bone-400">Loading manifest…</div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="text-xs text-red-300">
        Could not load manifest. {(q.error as Error | undefined)?.message ?? ""}
      </div>
    );
  }
  const m: ProductionPackageManifest = q.data.manifest;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-bone-400">
        <div>
          <span className="text-bone-200">{q.data.filename}</span>
          {" · "}
          {m.scope} scope · exported {new Date(m.exportedAt).toLocaleString()}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-bone-500">
          Read-only preview
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <ManifestField label="Project">{m.projectTitle ?? "—"}</ManifestField>
        <ManifestField label="Episode">
          {m.episodeNumber !== null
            ? `EP${String(m.episodeNumber).padStart(2, "0")} — ${m.episodeTitle ?? "Untitled"}`
            : "Project-wide"}
        </ManifestField>
        <ManifestField label="Draft">
          {m.draftNumber !== null ? `#${m.draftNumber}` : "—"}
          {m.lockedWritingDraft ? " · locked" : ""}
        </ManifestField>
        <ManifestField label="Source commit">
          {m.sourceCommitHash ? m.sourceCommitHash.slice(0, 10) : "—"}
        </ManifestField>
      </dl>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-bone-500">
          Included sections ({m.includedSections.length})
        </div>
        <div className="flex flex-wrap gap-1">
          {m.includedSections.map((s) => (
            <span
              key={s}
              className="chip border-white/10 bg-white/[0.03] text-bone-300"
            >
              {s}
            </span>
          ))}
          {m.includedSections.length === 0 && (
            <span className="text-[11px] text-bone-400">No sections included.</span>
          )}
        </div>
      </div>
      {m.warnings.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-bone-500">
            Warnings ({m.warnings.length})
          </div>
          <ul className="space-y-1 text-[11px]">
            {m.warnings.map((w, i) => (
              <li
                key={i}
                className={
                  "rounded border px-2 py-1 " +
                  (w.level === "warning"
                    ? "border-amber-700/40 bg-amber-900/15 text-amber-100"
                    : "border-white/10 bg-white/[0.03] text-bone-300")
                }
              >
                <span className="font-medium">{w.section}:</span> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ManifestField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-bone-500">{label}</dt>
      <dd className="text-bone-200">{children}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pitch decks
// ---------------------------------------------------------------------------

function PitchSection({
  projectId,
  decks,
  loading,
}: {
  projectId: string;
  decks: PitchDeck[];
  loading: boolean;
}) {
  const haveDecks = decks.length > 0;
  return (
    <Panel
      eyebrow="Pitch"
      title={
        <span className="inline-flex items-center gap-2">
          <Presentation className="h-4 w-4" /> Pitch Materials
        </span>
      }
    >
      {loading ? (
        <div className="h-16 animate-pulse-soft rounded-lg bg-white/[0.03]" />
      ) : !haveDecks ? (
        <EmptyState
          Icon={Megaphone}
          title="No pitch decks yet"
          description={
            <>
              Build one on the{" "}
              <Link className="underline" to={`/projects/${projectId}/pitch`}>
                Pitch Materials
              </Link>{" "}
              page. Series &amp; film decks, lookbooks, one-sheets and buyer
              treatments will appear here for download once generated.
            </>
          }
        />
      ) : (
        <ul className="space-y-2">
          {decks.map((d) => (
            <PitchDeckRow key={d.id} projectId={projectId} deck={d} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PitchDeckRow({ projectId, deck }: { projectId: string; deck: PitchDeck }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ready = deck.slides.length > 0 && deck.status !== "not_started";
  const safe = slug(`${DECK_KIND_LABEL[deck.kind]}_${deck.title || "deck"}`);
  const download = async (
    format: "pdf" | "markdown" | "html" | "text",
    ext: string
  ) => {
    setErr(null);
    setBusy(format);
    try {
      await api.downloadPitchExport(projectId, deck.id, format, `${safe}.${ext}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-bone-50">
          <span className="truncate">{deck.title || DECK_KIND_LABEL[deck.kind]}</span>
          <StatusChip
            status={mapDeckStatus(deck.status)}
            label={DECK_STATUS_LABEL[deck.status]}
          />
        </div>
        <div className="text-[11px] text-bone-400">
          {DECK_KIND_LABEL[deck.kind]} · {deck.slides.length} slide
          {deck.slides.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { f: "pdf", ext: "pdf" },
              { f: "markdown", ext: "md" },
              { f: "html", ext: "html" },
              { f: "text", ext: "txt" },
            ] as const
          ).map(({ f, ext }) => (
            <button
              key={f}
              className="btn-outline disabled:opacity-50"
              disabled={!ready || busy !== null}
              onClick={() => download(f, ext)}
              title={ready ? `Download .${ext}` : "Generate the deck first"}
            >
              {busy === f ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              .{ext}
            </button>
          ))}
        </div>
        {err && <div className="max-w-xs text-right text-[11px] text-red-300">{err}</div>}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Per-episode exports
// ---------------------------------------------------------------------------

function EpisodeExports({
  projectId,
  projectSlug,
  hub,
  hubLoading,
}: {
  projectId: string;
  projectSlug: string;
  hub: ProductionHubResponse | undefined;
  hubLoading: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (hubLoading) {
    return (
      <Panel eyebrow="Episodes" title="Per-episode exports">
        <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
      </Panel>
    );
  }
  if (!hub || hub.rows.length === 0) {
    return (
      <Panel eyebrow="Episodes" title="Per-episode exports">
        <EmptyState
          Icon={Film}
          title="No episodes yet"
          description={
            <>
              Approve a Season Arc on the{" "}
              <Link className="underline" to={`/projects/${projectId}`}>
                project overview
              </Link>{" "}
              to materialize episodes. Each episode will appear here with its
              full export bundle.
            </>
          }
        />
      </Panel>
    );
  }

  const activeId = openId ?? hub.rows[0].episodeId;
  return (
    <Panel
      eyebrow={`${hub.rows.length} episode${hub.rows.length === 1 ? "" : "s"}`}
      title={
        <span className="inline-flex items-center gap-2">
          <Film className="h-4 w-4" /> Per-episode exports
        </span>
      }
    >
      <div className="space-y-3">
        {hub.rows.map((row) => {
          const open = activeId === row.episodeId;
          return (
            <div
              key={row.episodeId}
              className="rounded-md border border-white/8 bg-white/[0.02]"
            >
              <button
                onClick={() => setOpenId(open ? "__none__" : row.episodeId)}
                className="flex w-full items-center justify-between gap-4 p-3 text-left"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-bone-50">
                    <span>
                      Episode {row.episodeNumber ?? "?"} —{" "}
                      {row.episodeTitle ?? "Untitled"}
                    </span>
                    {row.lockedWritingDraft && (
                      <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                        <Lock className="h-3 w-3" /> draft locked
                      </span>
                    )}
                    <span className="chip border-white/10 bg-white/5 text-bone-300">
                      {row.readinessPct}% ready
                    </span>
                  </div>
                  <div className="text-[11px] text-bone-400">
                    {row.scriptDraftNumber !== null
                      ? `Current draft #${row.scriptDraftNumber}`
                      : "No current draft"}
                  </div>
                </div>
                <ArrowRight
                  className={
                    "h-4 w-4 text-bone-400 transition-transform " +
                    (open ? "rotate-90" : "")
                  }
                />
              </button>
              {open && (
                <EpisodeExportBody
                  projectId={projectId}
                  projectSlug={projectSlug}
                  row={row}
                />
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function EpisodeExportBody({
  projectId,
  projectSlug,
  row,
}: {
  projectId: string;
  projectSlug: string;
  row: ProductionHubEpisodeRow;
}) {
  const epSlug = `${projectSlug}_EP${String(row.episodeNumber ?? 0).padStart(2, "0")}`;
  return (
    <div className="border-t border-white/8 p-3 space-y-3">
      <EpisodePackage projectId={projectId} row={row} epSlug={epSlug} />
      <EpisodeScreenplay projectId={projectId} row={row} epSlug={epSlug} />
      <EpisodeSoundBible projectId={projectId} row={row} epSlug={epSlug} />
      <EpisodeMusicPack projectId={projectId} row={row} epSlug={epSlug} />
      <EpisodeShotList projectId={projectId} row={row} epSlug={epSlug} />
      <EpisodeAIVideoPrompts projectId={projectId} row={row} />
      <EpisodeTrailer projectId={projectId} row={row} epSlug={epSlug} />
      <EpisodeGenerationQueue projectId={projectId} row={row} epSlug={epSlug} />
    </div>
  );
}

function EpisodeGenerationQueue({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  // The queue derives its own status from approvals — we surface it here as
  // a flat block of download links to the existing export endpoints.
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.015] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-bone-100">
        <Sparkles className="h-4 w-4" />
        <span>AI Production Queue</span>
        <Link
          to={`/projects/${projectId}/episodes/${row.episodeId}/generation-queue`}
          className="ml-1 inline-flex items-center gap-1 text-[11px] text-bone-400 hover:text-bone-200"
        >
          <ExternalLink className="h-3 w-3" /> Open Generation Planner
        </Link>
      </div>
      <div className="text-[11px] text-bone-400">
        Hand off the queue to your model of choice. Items mirror approved
        shots — fix upstream and resync from the planner.
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <a
          className="btn-outline"
          href={`/api/projects/${projectId}/episodes/${row.episodeId}/generation-queue/export?format=queue_csv`}
          download={`${epSlug}_generation_queue.csv`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="h-3.5 w-3.5" />
          Queue .csv
        </a>
        <a
          className="btn-outline"
          href={`/api/projects/${projectId}/episodes/${row.episodeId}/generation-queue/export?format=approved_manifest_json`}
          download={`${epSlug}_approved_manifest.json`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="h-3.5 w-3.5" />
          Approved manifest .json
        </a>
        <a
          className="btn-outline"
          href={`/api/projects/${projectId}/episodes/${row.episodeId}/generation-queue/export?format=scene_assembly_checklist_markdown`}
          download={`${epSlug}_scene_assembly_checklist.md`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="h-3.5 w-3.5" />
          Scene checklist .md
        </a>
        <a
          className="btn-outline"
          href={`/api/projects/${projectId}/episodes/${row.episodeId}/generation-queue/export?format=trailer_batch_text`}
          download={`${epSlug}_trailer_batch.txt`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="h-3.5 w-3.5" />
          Trailer batch .txt
        </a>
      </div>
    </div>
  );
}

function ExportRow({
  icon,
  title,
  section,
  helpLink,
  helpLabel,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  section: ProductionHubSection | null;
  helpLink: string;
  helpLabel: string;
  detail?: string;
  children: React.ReactNode;
}) {
  const status = section?.status ?? "missing";
  const ready = status === "approved" || status === "locked" || status === "complete";
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-white/5 bg-white/[0.015] p-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-bone-100">
          <span className="text-bone-300">{icon}</span>
          <span>{title}</span>
          <StatusChip status={status} />
          <Link
            to={helpLink}
            className="ml-1 inline-flex items-center gap-1 text-[11px] text-bone-400 hover:text-bone-200"
          >
            <ExternalLink className="h-3 w-3" /> {helpLabel}
          </Link>
        </div>
        {detail || section?.detail ? (
          <div className="mt-0.5 text-[11px] text-bone-400">
            {detail ?? section?.detail}
          </div>
        ) : null}
      </div>
      <div className={"flex flex-wrap items-center gap-1.5 " + (ready ? "" : "opacity-60")}>
        {children}
      </div>
    </div>
  );
}

function EpisodePackage({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const url = api.productionPackageUrl(projectId, row.episodeId);
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.02] p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-bone-100">
          <Package className="h-4 w-4" />
          <span>Production Package (episode)</span>
          <StatusChip status={row.sections.packageReady.status} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="outline" onClick={() => setOpen((v) => !v)}>
            <FileText className="h-3.5 w-3.5" />
            {open ? "Hide manifest" : "Preview manifest"}
          </Button>
          <a
            className="btn-primary"
            href={url}
            download={`${epSlug}_production_package.zip`}
            target="_blank"
            rel="noreferrer"
          >
            <Download className="h-3.5 w-3.5" />
            Download .zip
          </a>
        </div>
      </div>
      <div className="text-[11px] text-bone-400">
        {row.sections.packageReady.detail}
      </div>
      {open && (
        <div className="border-t border-white/8 pt-2">
          <ManifestPreview projectId={projectId} episodeId={row.episodeId} />
        </div>
      )}
    </div>
  );
}

function EpisodeScreenplay({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const scriptId = row.scriptId;
  const go = async (id: "pdf" | "fdx" | "fountain" | "markdown", ext: string) => {
    if (!scriptId) return;
    setErr(null);
    setBusy(id);
    try {
      await api.downloadExport(scriptId, id, `${epSlug}.${ext}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <ExportRow
      icon={<Clapperboard className="h-4 w-4" />}
      title="Screenplay (current draft)"
      section={row.sections.screenplay}
      helpLink={
        scriptId
          ? `/projects/${projectId}/drafts/${scriptId}`
          : `/projects/${projectId}/drafts`
      }
      helpLabel={scriptId ? "Open draft" : "Drafts"}
      detail={
        scriptId
          ? `Current draft #${row.scriptDraftNumber}`
          : "No current draft for this episode yet"
      }
    >
      {EXPORT_FORMATS.map((f) => (
        <button
          key={f.id}
          className="btn-outline disabled:opacity-50"
          disabled={!scriptId || busy !== null}
          onClick={() =>
            go(f.id as "pdf" | "fdx" | "fountain" | "markdown", f.extension)
          }
          title={`Download .${f.extension}`}
        >
          {busy === f.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          .{f.extension}
        </button>
      ))}
      {err && (
        <div className="basis-full text-right text-[11px] text-red-300">{err}</div>
      )}
    </ExportRow>
  );
}

function EpisodeSoundBible({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  const status = row.sections.soundBible.status;
  const ready = status === "approved" || status === "locked" || status === "complete";
  return (
    <ExportRow
      icon={<AudioLines className="h-4 w-4" />}
      title="Sound & Atmosphere Bible"
      section={row.sections.soundBible}
      helpLink={`/projects/${projectId}/episodes/${row.episodeId}/sound-bible`}
      helpLabel="Open Sound Bible"
    >
      <a
        className={"btn-outline " + (ready ? "" : "pointer-events-none opacity-60")}
        href={api.exportSoundBibleUrl(projectId, row.episodeId, "markdown")}
        download={`${epSlug}_sound_bible.md`}
        target="_blank"
        rel="noreferrer"
        title={ready ? "Download Markdown" : "Approve the Sound Bible to enable export"}
      >
        <Download className="h-3.5 w-3.5" />
        .md
      </a>
      <a
        className={"btn-outline " + (ready ? "" : "pointer-events-none opacity-60")}
        href={api.exportSoundBibleUrl(projectId, row.episodeId, "json")}
        download={`${epSlug}_sound_bible.json`}
        target="_blank"
        rel="noreferrer"
      >
        <Download className="h-3.5 w-3.5" />
        .json
      </a>
    </ExportRow>
  );
}

function EpisodeMusicPack({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  // Music Pack rides on Sound Bible approval — only meaningful when approved.
  const status = row.sections.soundBible.status;
  const ready = status === "approved" || status === "locked" || status === "complete";
  return (
    <ExportRow
      icon={<Music className="h-4 w-4" />}
      title="Music Prompt Pack"
      section={row.sections.soundBible}
      helpLink={`/projects/${projectId}/episodes/${row.episodeId}/sound-bible`}
      helpLabel="Open Music Pack"
      detail={
        ready
          ? "Approved Sound Bible — Suno / Udio / Composer prompts available."
          : "Approve the Sound Bible to unlock the music prompt pack."
      }
    >
      <a
        className={"btn-outline " + (ready ? "" : "pointer-events-none opacity-60")}
        href={api.musicPackJsonUrl(projectId, row.episodeId)}
        download={`${epSlug}_music_pack.json`}
        target="_blank"
        rel="noreferrer"
      >
        <Download className="h-3.5 w-3.5" />
        .json pack
      </a>
      {MUSIC_ADAPTERS.map((a) => (
        <CopyMusicButton
          key={a}
          projectId={projectId}
          episodeId={row.episodeId}
          adapter={a}
          ready={ready}
        />
      ))}
    </ExportRow>
  );
}

function CopyMusicButton({
  projectId,
  episodeId,
  adapter,
  ready,
}: {
  projectId: string;
  episodeId: string;
  adapter: MusicAdapter;
  ready: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const label =
    adapter === "suno"
      ? "Copy Suno"
      : adapter === "udio"
      ? "Copy Udio"
      : "Copy Composer";
  const onClick = async () => {
    setErr(null);
    setBusy(true);
    try {
      const text = await api.exportMusicPack(projectId, episodeId, adapter, "episode");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      className="btn-outline disabled:opacity-50"
      disabled={!ready || busy}
      onClick={onClick}
      title={ready ? `Copy ${adapter} prompt` : "Approve the Sound Bible to enable"}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-300" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : label}
      {err && <span className="ml-2 text-[10px] text-red-300">{err.slice(0, 40)}</span>}
    </button>
  );
}

function EpisodeShotList({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  const scriptId = row.scriptId;
  const status = row.sections.shotList.status;
  const ready = status === "approved" || status === "locked" || status === "complete";
  return (
    <ExportRow
      icon={<Camera className="h-4 w-4" />}
      title="Curated Shot List"
      section={row.sections.shotList}
      helpLink={`/projects/${projectId}/episodes/${row.episodeId}/shot-list`}
      helpLabel="Open Shot List"
    >
      {(["markdown", "csv", "json"] as const).map((f) => (
        <a
          key={f}
          className={
            "btn-outline " +
            (ready && scriptId ? "" : "pointer-events-none opacity-60")
          }
          href={scriptId ? api.exportShotListUrl(scriptId, f) : "#"}
          download={`${epSlug}_shot_list.${f === "markdown" ? "md" : f}`}
          target="_blank"
          rel="noreferrer"
          title={
            !scriptId
              ? "No current draft"
              : ready
              ? `Download .${f}`
              : "Approve the Shot List to enable export"
          }
        >
          <Download className="h-3.5 w-3.5" />.{f === "markdown" ? "md" : f}
        </a>
      ))}
    </ExportRow>
  );
}

function EpisodeAIVideoPrompts({
  projectId,
  row,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
}) {
  // AI Video Prompt packs ride inside the shot list .json + the production
  // package. When the shot list is empty, that's a lie — clearly say so.
  const shotsExist = row.sections.shotList.totalCount > 0;
  return (
    <ExportRow
      icon={<Sparkles className="h-4 w-4" />}
      title="AI Video Prompt Pack"
      section={row.sections.aiVideoPrompts}
      helpLink={`/projects/${projectId}/episodes/${row.episodeId}/shot-list`}
      helpLabel="Open AI Prompts"
      detail={
        shotsExist
          ? row.sections.aiVideoPrompts.detail +
            " Per-shot prompts ship inside the shot list (.json) and production package."
          : "Missing — generate shot briefs first. The shot list has 0 shots, so the prompt pack is empty."
      }
    >
      <span className="text-[11px] text-bone-400">
        {shotsExist
          ? "Included in shot list (.json) + package"
          : "Nothing to download — empty pack"}
      </span>
    </ExportRow>
  );
}

function EpisodeTrailer({
  projectId,
  row,
  epSlug,
}: {
  projectId: string;
  row: ProductionHubEpisodeRow;
  epSlug: string;
}) {
  const status = row.sections.trailerPack.status;
  const ready = status === "approved" || status === "locked" || status === "complete";
  const generated = ready || status === "partial";
  return (
    <div className="rounded-md border border-white/5 bg-white/[0.015] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-bone-100">
        <Megaphone className="h-4 w-4" />
        <span>Trailer / Teaser Pack</span>
        <StatusChip status={status} />
        <Link
          to={`/projects/${projectId}/episodes/${row.episodeId}/trailer-builder`}
          className="ml-1 inline-flex items-center gap-1 text-[11px] text-bone-400 hover:text-bone-200"
        >
          <ExternalLink className="h-3 w-3" /> Open Trailer Builder
        </Link>
      </div>
      <div className="text-[11px] text-bone-400">{row.sections.trailerPack.detail}</div>
      <div
        className={
          "flex flex-wrap items-center gap-1.5 " + (generated ? "" : "opacity-60")
        }
      >
        <a
          className={"btn-outline " + (generated ? "" : "pointer-events-none")}
          href={api.exportTrailerUrl(projectId, row.episodeId, { format: "markdown" })}
          download={`${epSlug}_trailer_pack.md`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="h-3.5 w-3.5" />
          Pack .md
        </a>
        <a
          className={"btn-outline " + (generated ? "" : "pointer-events-none")}
          href={api.exportTrailerUrl(projectId, row.episodeId, { format: "json" })}
          download={`${epSlug}_trailer_pack.json`}
          target="_blank"
          rel="noreferrer"
        >
          <Download className="h-3.5 w-3.5" />
          Pack .json
        </a>
      </div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {TRAILER_VARIANTS.map((v) => (
          <TrailerVariantRow
            key={v}
            projectId={projectId}
            episodeId={row.episodeId}
            variant={v}
            generated={generated}
            epSlug={epSlug}
          />
        ))}
      </div>
    </div>
  );
}

function TrailerVariantRow({
  projectId,
  episodeId,
  variant,
  generated,
  epSlug,
}: {
  projectId: string;
  episodeId: string;
  variant: TrailerVariantKey;
  generated: boolean;
  epSlug: string;
}) {
  const label =
    variant === "teaser15"
      ? "15s Teaser"
      : variant === "teaser30"
      ? "30s Teaser"
      : variant === "trailer60"
      ? "60s Trailer"
      : "Social cut";
  return (
    <div className="flex items-center justify-between rounded-md border border-white/5 bg-black/15 px-2.5 py-1.5 text-[12px]">
      <span className="text-bone-200">{label}</span>
      <div className="flex items-center gap-1.5">
        <a
          className={"btn-outline " + (generated ? "" : "pointer-events-none opacity-60")}
          href={api.exportTrailerUrl(projectId, episodeId, {
            variant,
            kind: "video_prompts",
          })}
          download={`${epSlug}_${variant}_video_prompts.txt`}
          target="_blank"
          rel="noreferrer"
          title="Per-shot video prompts"
        >
          <Download className="h-3.5 w-3.5" />
          Video
        </a>
        <a
          className={"btn-outline " + (generated ? "" : "pointer-events-none opacity-60")}
          href={api.exportTrailerUrl(projectId, episodeId, {
            variant,
            kind: "music_prompt",
          })}
          download={`${epSlug}_${variant}_music_prompt.txt`}
          target="_blank"
          rel="noreferrer"
          title="Music prompt"
        >
          <Download className="h-3.5 w-3.5" />
          Music
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screenplay drafts (per-draft, project-wide)
// ---------------------------------------------------------------------------

function ScreenplayDrafts({
  scripts,
  loading,
}: {
  scripts: Array<{
    id: string;
    title: string;
    draft_number: number;
    current: boolean;
    updated_at: string;
  }>;
  loading: boolean;
}) {
  return (
    <Panel
      eyebrow="Drafts"
      title={
        <span className="inline-flex items-center gap-2">
          <Clapperboard className="h-4 w-4" /> Screenplay drafts ({scripts.length})
        </span>
      }
    >
      {loading ? (
        <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
      ) : scripts.length === 0 ? (
        <EmptyState
          Icon={Clapperboard}
          title="No drafts to export"
          description="Create a draft from the Drafts page first."
        />
      ) : (
        <ul className="space-y-3">
          {scripts
            .slice()
            .sort((a, b) => {
              if (a.current !== b.current) return a.current ? -1 : 1;
              if (a.draft_number !== b.draft_number)
                return b.draft_number - a.draft_number;
              return Date.parse(b.updated_at) - Date.parse(a.updated_at);
            })
            .map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.02] p-4"
              >
                <div>
                  <div className="flex items-center gap-2 text-bone-50">
                    {s.title}
                    {s.current && (
                      <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                        current
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-bone-400">
                    Draft {s.draft_number} · {new Date(s.updated_at).toLocaleString()}
                  </div>
                </div>
                <DraftButtons scriptId={s.id} title={s.title} />
              </li>
            ))}
        </ul>
      )}
    </Panel>
  );
}

function DraftButtons({ scriptId, title }: { scriptId: string; title: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const safe = slug(title) || "draft";
  const go = async (id: "pdf" | "fdx" | "fountain" | "markdown", ext: string) => {
    setError(null);
    setBusy(id);
    try {
      await api.downloadExport(scriptId, id, `${safe}.${ext}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap gap-1.5">
        {EXPORT_FORMATS.map((f) => (
          <button
            key={f.id}
            className="btn-outline disabled:opacity-50"
            disabled={busy !== null}
            onClick={() =>
              go(f.id as "pdf" | "fdx" | "fountain" | "markdown", f.extension)
            }
          >
            {busy === f.id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            .{f.extension}
          </button>
        ))}
      </div>
      {error && (
        <div className="max-w-xs text-right text-xs text-red-300">{error}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function StatusChip({
  status,
  label,
}: {
  status: ProductionHubSectionStatus;
  label?: string;
}) {
  const cls =
    status === "locked"
      ? "border-emerald-700/40 bg-emerald-900/20 text-emerald-200"
      : status === "approved" || status === "complete"
      ? "border-cyan-700/40 bg-cyan-900/15 text-cyan-200"
      : status === "partial"
      ? "border-amber-700/40 bg-amber-900/15 text-amber-200"
      : "border-white/10 bg-white/5 text-bone-400";
  const text =
    label ??
    (status === "locked"
      ? "locked"
      : status === "approved"
      ? "approved"
      : status === "complete"
      ? "complete"
      : status === "partial"
      ? "not approved"
      : "missing");
  return <span className={"chip " + cls}>{text}</span>;
}

function mapDeckStatus(s: PitchDeck["status"]): ProductionHubSectionStatus {
  if (s === "approved" || s === "final_exported") return "approved";
  if (s === "not_started") return "missing";
  return "partial";
}

function slug(s: string): string {
  return (
    s
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_|_$/g, "")
      .toLowerCase() || "project"
  );
}

