// Role-routed briefs section — drop in on a shot card.
//
// Lazy-loads from /api/.../role-briefs?shotKey=… via TanStack Query so
// any number of these can mount without N+1 fetches blowing up the
// page. Renders three artifact kinds:
//
//   • AI model brief  → prompt + continuity + refs + avoid list
//   • AI creative     → intent + strategy + review + risks
//   • Live person     → context + deliverable + checklist + refs
//
// Each artifact has a Copy button. The Section also surfaces "Skipped"
// roles so the user can see which slots need an assignment in the
// Creative Team page.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import type {
  AICreativeBrief,
  AIModelBrief,
  EpisodeRoleBriefsResponse,
  LivePersonBrief,
  RoleBriefArtifact,
  RoleKind,
  ShotRoleBriefs,
} from "@toburt/shared";
import { ROLE_KIND_LABEL } from "@toburt/shared";
import { api } from "@/lib/api";

interface RoleBriefsSectionProps {
  projectId: string;
  episodeId: string;
  /** Stable shot id: `${sceneOrd}-${shotIndex}`. */
  shotKey: string;
  /** Optional — when omitted, the section is collapsed by default. */
  defaultOpen?: boolean;
  /** Compact density (used inside Generation Queue rows). */
  dense?: boolean;
}

export function RoleBriefsSection({
  projectId,
  episodeId,
  shotKey,
  defaultOpen,
  dense,
}: RoleBriefsSectionProps) {
  const [open, setOpen] = useState<boolean>(!!defaultOpen);
  const q = useQuery({
    queryKey: ["role-briefs", projectId, episodeId, shotKey],
    queryFn: () => api.getEpisodeRoleBriefs(projectId, episodeId, { shotKey }),
    enabled: open,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  return (
    <div
      className={
        "rounded-md border border-white/8 bg-white/[0.015] " +
        (dense ? "px-2.5 py-2" : "px-3 py-2.5")
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-bone-400" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-bone-400" />
          )}
          <span className="text-[12px] font-medium text-bone-100">Role briefs</span>
          {open && q.data && (
            <RoleBriefsCountChip resp={q.data} />
          )}
        </div>
        {open && q.data && q.data.shots[0]?.artifacts.length === 0 && (
          <span className="text-[11px] text-amber-200/90">
            Roles not assigned yet
          </span>
        )}
      </button>
      {open && <Body q={q} projectId={projectId} dense={dense} />}
    </div>
  );
}

function RoleBriefsCountChip({ resp }: { resp: EpisodeRoleBriefsResponse }) {
  const shot = resp.shots[0];
  if (!shot) return null;
  const n = shot.artifacts.length;
  if (n === 0) return null;
  return (
    <span className="chip border-white/10 bg-white/5 text-bone-300">
      {n} brief{n === 1 ? "" : "s"}
    </span>
  );
}

function Body({
  q,
  projectId,
  dense,
}: {
  q: { isLoading: boolean; isError: boolean; data?: EpisodeRoleBriefsResponse; error: unknown };
  projectId: string;
  dense?: boolean;
}) {
  if (q.isLoading) {
    return (
      <div className="mt-2 h-12 animate-pulse-soft rounded bg-white/[0.04]" />
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="mt-2 text-[11.5px] text-red-300">
        Could not load role briefs.{" "}
        {(q.error as Error | undefined)?.message ?? ""}
      </div>
    );
  }
  const shot = q.data.shots[0];
  if (!shot) {
    return (
      <div className="mt-2 text-[11.5px] text-bone-400">
        Shot not found in role-briefs response.
      </div>
    );
  }
  return <ShotBriefList shot={shot} projectId={projectId} dense={dense} />;
}

function ShotBriefList({
  shot,
  projectId,
  dense,
}: {
  shot: ShotRoleBriefs;
  projectId: string;
  dense?: boolean;
}) {
  const haveArtifacts = shot.artifacts.length > 0;
  return (
    <div className={"mt-2 space-y-2 " + (dense ? "text-[11.5px]" : "text-[12px]")}>
      {haveArtifacts && (
        <ul className="space-y-2">
          {shot.artifacts.map((a) => (
            <li key={`${a.roleKey}:${a.shotId}`}>
              <ArtifactCard artifact={a} />
            </li>
          ))}
        </ul>
      )}
      {shot.skipped.length > 0 && (
        <div className="rounded border border-amber-700/30 bg-amber-900/[0.08] px-2.5 py-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wide text-amber-200">
            <AlertCircle className="h-3 w-3" /> Unassigned roles
          </div>
          <ul className="space-y-0.5 text-[11px] text-amber-100/90">
            {shot.skipped.slice(0, 5).map((sk) => (
              <li key={sk.roleKey}>
                <span className="text-bone-200">{sk.roleLabel}</span> — {sk.reason}
              </li>
            ))}
            {shot.skipped.length > 5 && (
              <li className="text-amber-200/80">
                +{shot.skipped.length - 5} more
              </li>
            )}
          </ul>
          <Link
            to={`/projects/${projectId}/team`}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-amber-200 hover:text-amber-100"
          >
            Open Creative Team <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
      {!haveArtifacts && shot.skipped.length === 0 && (
        <div className="text-[11.5px] text-bone-400">
          No relevant roles for this shot.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-artifact card
// ---------------------------------------------------------------------------

function ArtifactCard({ artifact }: { artifact: RoleBriefArtifact }) {
  const tone = kindTone(artifact.roleKind);
  return (
    <div className={"rounded-md border px-2.5 py-2 " + tone.row}>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={
              "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full " +
              tone.icon
            }
          >
            {iconFor(artifact.roleKind)}
          </span>
          <span className="text-[12.5px] font-medium text-bone-50">
            {artifact.roleLabel}
          </span>
          <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
            {ROLE_KIND_LABEL[artifact.roleKind]}
          </span>
        </div>
      </div>
      {artifact.brief.kind === "ai_model" && <AIModelBriefBlock brief={artifact.brief} />}
      {artifact.brief.kind === "ai_creative" && <AICreativeBriefBlock brief={artifact.brief} />}
      {artifact.brief.kind === "live_person" && <LivePersonBriefBlock brief={artifact.brief} />}
    </div>
  );
}

function iconFor(k: RoleKind) {
  if (k === "ai") return <Sparkles className="h-3 w-3" />;
  if (k === "ai_creative") return <Brain className="h-3 w-3" />;
  return <User className="h-3 w-3" />;
}

function kindTone(k: RoleKind): { row: string; icon: string } {
  if (k === "ai")
    return {
      row: "border-violet-700/40 bg-violet-900/[0.10]",
      icon: "bg-violet-900/40 text-violet-200",
    };
  if (k === "ai_creative")
    return {
      row: "border-cyan-700/40 bg-cyan-900/[0.10]",
      icon: "bg-cyan-900/40 text-cyan-200",
    };
  return {
    row: "border-emerald-700/40 bg-emerald-900/[0.10]",
    icon: "bg-emerald-900/40 text-emerald-200",
  };
}

// ---------------------------------------------------------------------------
// AI Model brief block
// ---------------------------------------------------------------------------

function AIModelBriefBlock({ brief }: { brief: AIModelBrief }) {
  return (
    <div className="space-y-1.5">
      <Meta>
        {brief.modelTarget} · {brief.aspectRatio} · {brief.durationSec}s
      </Meta>
      <CopyBlock label="Model prompt" text={brief.promptText} />
      <CopyBlock
        label="Continuity"
        text={[
          ...brief.continuityLocks,
          ...brief.characterRefs.map((r) =>
            r.referenceUrl ? `${r.label} ref: ${r.referenceUrl}` : `${r.label}: ${r.description}`
          ),
          brief.locationRef ? `Location: ${brief.locationRef.label} — ${brief.locationRef.description}` : "",
          ...brief.propRefs.map((p) => `${p.label}: ${p.description}`),
        ]
          .filter(Boolean)
          .join("\n")}
      />
      {brief.avoidList.length > 0 && (
        <CopyBlock label="Avoid list" text={brief.avoidList.join(", ")} />
      )}
      {brief.soundNotes && (
        <CopyBlock
          label="Sound"
          text={[
            brief.soundNotes.audioField ? `Audio: ${brief.soundNotes.audioField}` : "",
            brief.soundNotes.ambientBed ? `Ambient: ${brief.soundNotes.ambientBed}` : "",
            brief.soundNotes.nonDiegeticMusic ? `Music: ${brief.soundNotes.nonDiegeticMusic}` : "",
          ]
            .filter(Boolean)
            .join("\n")}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI Creative brief block
// ---------------------------------------------------------------------------

function AICreativeBriefBlock({ brief }: { brief: AICreativeBrief }) {
  const full = [
    `Style: ${brief.style.replace(/_/g, " ")}`,
    "",
    `Shot intent: ${brief.shotIntent}`,
    `Emotional beat: ${brief.emotionalBeat}`,
    `Visual strategy: ${brief.visualStrategy}`,
    "",
    "Alternates:",
    ...brief.alternateApproaches.map((a) => `  • ${a}`),
    "",
    "Review criteria:",
    ...brief.reviewCriteria.map((r) => `  • ${r}`),
    "",
    "Prompt strategy:",
    brief.promptStrategy,
    "",
    ...(brief.riskNotes.length > 0
      ? ["Risk notes:", ...brief.riskNotes.map((r) => `  • ${r}`), ""]
      : []),
    ...(brief.continuityConcerns.length > 0
      ? ["Continuity concerns:", ...brief.continuityConcerns.map((c) => `  • ${c}`)]
      : []),
  ].join("\n");
  return (
    <div className="space-y-1.5">
      <Meta>{brief.style.replace(/_/g, " ")}</Meta>
      <CopyBlock label="Creative brief" text={full} />
      {brief.riskNotes.length > 0 && (
        <CopyBlock label="Risks" text={brief.riskNotes.join("\n")} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Person brief block
// ---------------------------------------------------------------------------

function LivePersonBriefBlock({ brief }: { brief: LivePersonBrief }) {
  const full = [
    `Format: ${brief.format.replace(/_/g, " ")}`,
    brief.recipient ? `To: ${brief.recipient}${brief.email ? ` <${brief.email}>` : ""}` : "",
    "",
    `Task: ${brief.taskHeadline}`,
    "",
    "Context:",
    brief.context,
    "",
    `Deliverable: ${brief.deliverable}`,
    ...(brief.references.length > 0
      ? ["", "References:", ...brief.references.map((r) => `  • ${r}`)]
      : []),
    ...(brief.departmentNotes.length > 0
      ? ["", "Notes:", ...brief.departmentNotes.map((n) => `  • ${n}`)]
      : []),
    "",
    "Checklist:",
    ...brief.checklist.map((c) => `  [ ] ${c}`),
  ]
    .filter((s) => s !== "")
    .join("\n");
  return (
    <div className="space-y-1.5">
      <Meta>
        {brief.format.replace(/_/g, " ")}
        {brief.recipient ? ` · ${brief.recipient}` : ""}
      </Meta>
      <CopyBlock label="Human brief" text={full} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function Meta({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wide text-bone-500">
      {children}
    </div>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const ready = text.trim().length > 0;
  const onCopy = async () => {
    if (!ready) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="rounded border border-white/8 bg-black/15 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-bone-500">
          {label}
        </span>
        <button
          className="btn-outline disabled:opacity-50"
          disabled={!ready}
          onClick={onCopy}
          title={ready ? `Copy ${label}` : "(empty)"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-300" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div
        className={
          "max-h-44 overflow-y-auto whitespace-pre-wrap text-[11px] " +
          (ready ? "text-bone-200" : "italic text-bone-500")
        }
      >
        {ready ? text : "(empty)"}
      </div>
    </div>
  );
}

// Silence unused-import warning — Users kept for future use.
void Users;
