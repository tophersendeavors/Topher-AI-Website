// Production Hub — project-level bird's-eye view of every episode's
// production readiness. Read-only dashboard; every cell links to the
// existing per-feature surface where edits actually happen.

import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Boxes,
  Camera,
  Check,
  ExternalLink,
  FileText,
  Film,
  Lock,
  MapPin,
  Package,
  Sparkles,
  Users,
} from "lucide-react";

import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Explainer } from "@/components/ui/Explainer";
import type {
  ProductionHubEpisodeRow,
  ProductionHubResponse,
  ProductionHubSectionStatus,
} from "@toburt/shared";

export function ProductionHubPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const q = useQuery({
    queryKey: ["production-hub", projectId],
    queryFn: () => api.getProductionHub(projectId),
  });

  if (q.isLoading) return <div className="p-8 text-bone-300">Loading production hub…</div>;
  if (!q.data) return <div className="p-8 text-red-300">Failed to load production hub.</div>;

  const data = q.data;
  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow={`Production · ${data.projectType.replace(/_/g, " ")}`}
        title={`${data.projectTitle ?? "Production"} — Production Hub`}
        description={`Every episode's readiness across the production pipeline. ${data.summary.overallReadinessPct}% overall.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/projects/${projectId}`}>
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4" /> Project overview
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/episodes`}>
              <Button variant="outline">
                Episodes <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/pitch`}>
              <Button variant="outline">
                Pitch <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to={`/projects/${projectId}/exports`}>
              <Button variant="outline">
                Export Center <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        }
      />

      <div className="px-8 space-y-6">
        <SummaryCard data={data} projectId={projectId} />
        <Explainer>
          Read-only dashboard. Every cell links to the place where edits actually happen — the
          hub doesn't change anything itself. Status chips: <strong>locked</strong> /{" "}
          <strong>approved</strong> / <strong>complete</strong> = ready ·{" "}
          <strong>partial</strong> = generated but not approved · <strong>missing</strong> =
          not generated yet.
        </Explainer>

        {data.rows.length === 0 ? (
          <Panel>
            <div className="text-sm text-bone-300">
              No episodes yet. Open the project overview and approve a Season Arc — the hub will
              populate one row per episode automatically.
            </div>
          </Panel>
        ) : (
          <Panel eyebrow={`${data.rows.length} episode${data.rows.length === 1 ? "" : "s"}`} title="Per-episode readiness">
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-xs">
                <thead className="text-bone-500">
                  <tr className="border-b border-white/8">
                    <th className="py-2 pl-2 pr-3 font-normal">Episode</th>
                    <th className="px-2 py-2 font-normal">Screenplay</th>
                    <th className="px-2 py-2 font-normal">Characters</th>
                    <th className="px-2 py-2 font-normal">Locations</th>
                    <th className="px-2 py-2 font-normal">Props</th>
                    <th className="px-2 py-2 font-normal">Sound</th>
                    <th className="px-2 py-2 font-normal">Shot list</th>
                    <th className="px-2 py-2 font-normal">AI prompts</th>
                    <th className="px-2 py-2 font-normal">Trailer</th>
                    <th className="px-2 py-2 font-normal">Package</th>
                    <th className="px-2 py-2 pr-2 font-normal">Ready</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <EpisodeRow key={row.episodeId} row={row} projectId={projectId} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ data, projectId }: { data: ProductionHubResponse; projectId: string }) {
  const s = data.summary;
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <SummaryTile label="Episodes" value={s.episodeCount} accent="bone" />
      <SummaryTile
        label="Locked scripts"
        value={`${s.lockedScripts} / ${s.episodeCount}`}
        accent={s.lockedScripts === s.episodeCount && s.episodeCount > 0 ? "emerald" : "amber"}
      />
      <SummaryTile
        label="Approved sound bibles"
        value={`${s.approvedSoundBibles} / ${s.episodeCount}`}
        accent={s.approvedSoundBibles > 0 ? "emerald" : "bone"}
      />
      <SummaryTile
        label="Approved shot lists"
        value={`${s.approvedShotLists} / ${s.episodeCount}`}
        accent={s.approvedShotLists > 0 ? "emerald" : "bone"}
      />
      <SummaryTile
        label="Generated trailers"
        value={`${s.generatedTrailers} / ${s.episodeCount}`}
        accent={s.generatedTrailers > 0 ? "emerald" : "bone"}
      />
      <SummaryTile
        label="Packages ready"
        value={`${s.packagesReady} / ${s.episodeCount}`}
        accent={s.packagesReady > 0 ? "emerald" : "bone"}
      />
      <SummaryTile
        label={
          <span className="inline-flex items-center gap-1">
            Pitch
            <StatusChip status={data.pitchStatus} />
          </span>
        }
        value={data.pitchDetail}
        accent="bone"
        link={`/projects/${projectId}/pitch`}
      />
      <SummaryTile
        label="Overall readiness"
        value={`${s.overallReadinessPct}%`}
        accent={s.overallReadinessPct >= 70 ? "emerald" : s.overallReadinessPct >= 35 ? "amber" : "ember"}
      />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  accent,
  link,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  accent: "bone" | "ember" | "amber" | "emerald";
  link?: string;
}) {
  const accentBorder =
    accent === "emerald"
      ? "border-emerald-700/50"
      : accent === "amber"
      ? "border-amber-700/50"
      : accent === "ember"
      ? "border-ember-700/50"
      : "border-white/10";
  const accentText =
    accent === "emerald"
      ? "text-emerald-200"
      : accent === "amber"
      ? "text-amber-200"
      : accent === "ember"
      ? "text-ember-200"
      : "text-bone-100";
  const Inner = (
    <>
      <div className="text-[10px] uppercase tracking-wide text-bone-500">{label}</div>
      <div className={`mt-1 font-serif text-lg ${accentText}`}>{value}</div>
    </>
  );
  return link ? (
    <Link to={link} className={`rounded-md border ${accentBorder} bg-white/[0.02] p-3 hover:bg-white/[0.04]`}>
      {Inner}
    </Link>
  ) : (
    <div className={`rounded-md border ${accentBorder} bg-white/[0.02] p-3`}>{Inner}</div>
  );
}

function EpisodeRow({
  row,
  projectId,
}: {
  row: ProductionHubEpisodeRow;
  projectId: string;
}) {
  const epPath = (suffix: string) =>
    `/projects/${projectId}/episodes/${row.episodeId}${suffix}`;
  const scriptPath = row.scriptId
    ? `/projects/${projectId}/drafts/${row.scriptId}`
    : `/projects/${projectId}/drafts`;

  return (
    <tr className="border-b border-white/8 align-top">
      <td className="py-2 pl-2 pr-3">
        <div className="flex items-center gap-1.5">
          <span className="font-serif text-bone-50">
            EP{String(row.episodeNumber ?? "?").padStart(2, "0")}
          </span>
          {row.lockedWritingDraft && <Lock className="h-3 w-3 text-ember-300" />}
          <ReadinessBar pct={row.readinessPct} />
        </div>
        {row.episodeTitle && (
          <div className="text-[11px] text-bone-400 line-clamp-1">{row.episodeTitle}</div>
        )}
        <MissingHint row={row} />
      </td>
      <Cell
        status={row.sections.screenplay.status}
        detail={row.sections.screenplay.detail}
        icon={FileText}
        href={scriptPath}
      />
      <Cell
        status={row.sections.characters.status}
        detail={row.sections.characters.detail}
        icon={Users}
        href={`/projects/${projectId}/character-bible`}
      />
      <Cell
        status={row.sections.locations.status}
        detail={row.sections.locations.detail}
        icon={MapPin}
        href={`/projects/${projectId}/character-bible`}
      />
      <Cell
        status={row.sections.props.status}
        detail={row.sections.props.detail}
        icon={Boxes}
        href={`/projects/${projectId}/character-bible`}
      />
      <Cell
        status={row.sections.soundBible.status}
        detail={row.sections.soundBible.detail}
        icon={AudioLines}
        href={epPath("/sound-bible")}
      />
      <Cell
        status={row.sections.shotList.status}
        detail={row.sections.shotList.detail}
        icon={Camera}
        href={epPath("/shot-list")}
        extra={
          row.sections.shotList.totalCount > 0
            ? `${row.sections.shotList.approvedCount}/${row.sections.shotList.totalCount}`
            : undefined
        }
      />
      <Cell
        status={row.sections.aiVideoPrompts.status}
        detail={row.sections.aiVideoPrompts.detail}
        icon={Sparkles}
        href={row.scriptId ? `/projects/${projectId}/drafts/${row.scriptId}` : scriptPath}
      />
      <Cell
        status={row.sections.trailerPack.status}
        detail={row.sections.trailerPack.detail}
        icon={Film}
        href={epPath("/trailer-builder")}
      />
      <Cell
        status={row.sections.packageReady.status}
        detail={row.sections.packageReady.detail}
        icon={Package}
        href={epPath("/episodes")}
        downloadHref={
          row.sections.packageReady.status !== "missing"
            ? api.productionPackageUrl(projectId, row.episodeId)
            : undefined
        }
        downloadLabel="Download ZIP"
      />
      <td className="px-2 py-2 pr-2 text-right">
        <Link
          to={`/projects/${projectId}/episodes`}
          className="inline-flex items-center gap-1 text-xs text-bone-200 hover:text-bone-50"
        >
          Open <ExternalLink className="h-3 w-3" />
        </Link>
      </td>
    </tr>
  );
}

function Cell({
  status,
  detail,
  icon: Icon,
  href,
  extra,
  downloadHref,
  downloadLabel,
}: {
  status: ProductionHubSectionStatus;
  detail: string;
  icon: React.ElementType;
  href: string;
  extra?: string;
  downloadHref?: string;
  downloadLabel?: string;
}) {
  return (
    <td className="px-2 py-2">
      <Link to={href} className="block rounded p-1 hover:bg-white/[0.04]">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-bone-400" />
          <StatusChip status={status} />
          {extra && <span className="text-[10px] text-bone-400">{extra}</span>}
        </div>
        <div className="mt-0.5 text-[10px] text-bone-500 line-clamp-2">{detail}</div>
      </Link>
      {downloadHref && (
        <a
          href={downloadHref}
          download
          className="mt-1 inline-flex items-center gap-1 text-[10px] text-ember-200 hover:text-ember-100"
        >
          <Package className="h-3 w-3" /> {downloadLabel ?? "Download"}
        </a>
      )}
    </td>
  );
}

function StatusChip({ status }: { status: ProductionHubSectionStatus }) {
  const cls =
    status === "locked"
      ? "border-ember-700/60 bg-ember-900/40 text-ember-100"
      : status === "approved" || status === "complete"
      ? "border-emerald-700/50 bg-emerald-900/30 text-emerald-100"
      : status === "partial"
      ? "border-amber-700/50 bg-amber-900/30 text-amber-100"
      : "border-white/10 bg-white/[0.04] text-bone-400";
  const label =
    status === "locked"
      ? "Locked"
      : status === "approved"
      ? "Ready"
      : status === "complete"
      ? "Ready"
      : status === "partial"
      ? "Partial"
      : "Missing";
  return (
    <span className={`chip ${cls} px-1.5 py-0 text-[10px]`}>
      {status === "approved" || status === "complete" || status === "locked" ? (
        <Check className="mr-0.5 inline h-2.5 w-2.5" />
      ) : null}
      {label}
    </span>
  );
}

// Show the top 2–3 sections that are blocking this episode's readiness.
// Pulls labels + status from the same row data the cells render, so the
// text matches what the user sees in the row.
const SECTION_LABEL: Record<keyof ProductionHubEpisodeRow["sections"], string> = {
  screenplay: "Screenplay",
  characters: "Characters",
  locations: "Locations",
  props: "Props",
  soundBible: "Sound Bible",
  shotList: "Shot List",
  aiVideoPrompts: "AI Prompts",
  trailerPack: "Trailer",
  packageReady: "Package",
};

function MissingHint({ row }: { row: ProductionHubEpisodeRow }) {
  // Rank: missing first, then partial. Cap at 3.
  const entries = (Object.entries(row.sections) as Array<
    [keyof ProductionHubEpisodeRow["sections"], { status: ProductionHubSectionStatus }]
  >).filter(([, s]) => s.status === "missing" || s.status === "partial");
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    const rank = (s: ProductionHubSectionStatus) => (s === "missing" ? 0 : 1);
    return rank(a[1].status) - rank(b[1].status);
  });
  const missingOnly = entries.filter(([, s]) => s.status === "missing");
  const partialOnly = entries.filter(([, s]) => s.status === "partial");
  const labelMissing = missingOnly
    .slice(0, 3)
    .map(([k]) => SECTION_LABEL[k])
    .join(", ");
  const labelPartial = partialOnly
    .slice(0, 3)
    .map(([k]) => SECTION_LABEL[k])
    .join(", ");
  return (
    <div className="mt-0.5 space-y-0.5 text-[10.5px] text-bone-400">
      {labelMissing && (
        <div>
          <span className="text-bone-500">Missing:</span>{" "}
          <span className="text-amber-200/90">{labelMissing}</span>
          {missingOnly.length > 3 ? ` +${missingOnly.length - 3} more` : ""}
        </div>
      )}
      {labelPartial && (
        <div>
          <span className="text-bone-500">Needs approval:</span>{" "}
          <span className="text-bone-300">{labelPartial}</span>
          {partialOnly.length > 3 ? ` +${partialOnly.length - 3} more` : ""}
        </div>
      )}
    </div>
  );
}

function ReadinessBar({ pct }: { pct: number }) {
  const color =
    pct >= 70 ? "bg-emerald-400" : pct >= 35 ? "bg-amber-400" : "bg-ember-400";
  return (
    <span
      title={`Readiness ${pct}%`}
      className="ml-1 inline-flex h-1.5 w-12 overflow-hidden rounded-full bg-white/8"
    >
      <span className={`${color} h-full`} style={{ width: `${Math.max(2, pct)}%` }} />
    </span>
  );
}
