// "Approved canon flowing into this shot" diagnostic.
//
// Answers "where is the canon I just approved?" by showing exactly
// what the prompt composer will see when it regenerates THIS shot's
// prompt. Distinguishes:
//   • APPROVED  — wrote a textOverride on canonSources. Flows in.
//   • DRAFT     — only saved as an edit on workflowAIProposals (the AI
//                 proposal cache). Does NOT flow in until approved.
//   • BIBLE     — value present on the bible but never explicitly
//                 approved. Composer reads it but it's not locked.
//
// Embed in the AI Video Prompts panel for each selected shot.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, Eye, Info, Loader2,
} from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
}

export function AppliedCanonPanel({ scriptId, sceneOrd, shotIndex }: Props) {
  const q = useQuery({
    queryKey: ["applied-canon", scriptId, sceneOrd, shotIndex],
    queryFn: () => api.getAppliedCanonForShot(scriptId, sceneOrd, shotIndex),
  });
  // Default open — the whole point of this panel is to surface what
  // canon is flowing in. A collapsed row reads as "nothing here" to
  // most users (per actual user report). Keep the toggle so you can
  // hide it after a glance, but open it on first load.
  const [open, setOpen] = useState(true);

  if (q.isLoading) {
    return (
      <div className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-bone-400">
        <Loader2 size={10} className="inline animate-spin mr-1" /> Checking what canon flows into this shot…
      </div>
    );
  }
  if (q.error || !q.data) return null;
  const d = q.data;

  // Quick at-a-glance status counts.
  const summary = {
    dpBriefApproved: !!d.dpBrief.approved,
    dpBriefDraft: !!d.dpBrief.draft,
    directorBriefApproved: !!d.directorBrief.approved,
    directorBriefDraft: !!d.directorBrief.draft,
    locationLighting: d.location?.lightingConstraints.length ?? 0,
    locationFraming: d.location?.framingRules.length ?? 0,
    refsCount: d.approvedReferences.length,
  };
  const someDrift =
    summary.dpBriefDraft ||
    summary.directorBriefDraft ||
    (!summary.dpBriefApproved && !!d.dpBrief.briefValue) ||
    (!summary.directorBriefApproved && !!d.directorBrief.briefValue);

  return (
    <div
      className={
        "rounded border " +
        (someDrift
          ? "border-amber-700/30 bg-amber-900/10"
          : "border-sky-700/30 bg-sky-900/10")
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-2.5 py-1.5 flex items-center justify-between text-left"
      >
        <span className="text-[11px] text-bone-100 inline-flex items-center gap-1.5">
          {someDrift ? (
            <AlertTriangle size={11} className="text-amber-300" />
          ) : (
            <Eye size={11} className="text-sky-200" />
          )}
          Approved canon flowing into this shot
          {someDrift && (
            <span className="ml-1 text-[10px] text-amber-200">
              (drafts present — won't flow until you Approve as canon)
            </span>
          )}
        </span>
        {open ? (
          <ChevronDown size={11} className="text-bone-400" />
        ) : (
          <ChevronRight size={11} className="text-bone-400" />
        )}
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 pt-1 space-y-2 text-[11px]">
          {/* DP brief */}
          <FieldRow
            label="DP brief"
            approved={d.dpBrief.approved}
            draft={d.dpBrief.draft}
            briefValue={d.dpBrief.briefValue}
          />

          {/* Director's blocking brief */}
          <FieldRow
            label="Director's blocking brief"
            approved={d.directorBrief.approved}
            draft={d.directorBrief.draft}
            briefValue={d.directorBrief.briefValue}
          />

          {/* Location-level DP constraints */}
          {d.location && (
            <div className="rounded border border-white/8 bg-black/20 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">
                Location-level constraints — {d.location.name}
              </div>
              {d.location.lightingConstraints.length === 0 &&
              d.location.framingRules.length === 0 ? (
                <div className="text-[11px] text-bone-500">(none set)</div>
              ) : (
                <>
                  {d.location.lightingConstraints.length > 0 && (
                    <div>
                      <div className="text-[10px] text-sky-200 mt-1">
                        Lighting ({d.location.lightingConstraints.length})
                      </div>
                      <ul className="list-disc pl-4 text-bone-200">
                        {d.location.lightingConstraints.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {d.location.framingRules.length > 0 && (
                    <div>
                      <div className="text-[10px] text-sky-200 mt-1">
                        Framing ({d.location.framingRules.length})
                      </div>
                      <ul className="list-disc pl-4 text-bone-200">
                        {d.location.framingRules.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Approved canon references (location / props / characters) */}
          <div className="rounded border border-white/8 bg-black/20 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-bone-500 mb-0.5">
              Approved references in scope ({d.approvedReferences.length})
            </div>
            {d.approvedReferences.length === 0 ? (
              <div className="text-[11px] text-bone-500">
                No approved image / URL / material references match this shot's
                location, visible props, or characters.
              </div>
            ) : (
              <ul className="list-disc pl-4 text-bone-200 space-y-0.5">
                {d.approvedReferences.slice(0, 8).map((r, i) => (
                  <li key={i}>
                    <span className="text-bone-100">{r.title ?? r.kind}</span>
                    <span className="text-bone-500 ml-1.5">
                      · {humanFieldPath(r.fieldPath)}
                    </span>
                  </li>
                ))}
                {d.approvedReferences.length > 8 && (
                  <li className="text-bone-500">…and {d.approvedReferences.length - 8} more</li>
                )}
              </ul>
            )}
          </div>

          <div className="text-[10px] text-bone-400 inline-flex items-start gap-1.5">
            <Info size={10} className="mt-0.5 shrink-0" />
            Only items shown as <strong className="text-emerald-300">Approved</strong>{" "}
            flow into the regenerated prompt. Drafts (saved edits without "Approve as canon") do not.
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  approved,
  draft,
  briefValue,
}: {
  label: string;
  approved: { value: string; approvedAt: string } | null;
  draft: { value: string; editedAt?: string } | null;
  briefValue: string | null;
}) {
  const tone = approved
    ? "border-emerald-700/30 bg-emerald-900/10"
    : draft
      ? "border-amber-700/30 bg-amber-900/10"
      : "border-white/8 bg-black/20";
  return (
    <div className={`rounded border ${tone} px-2 py-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wide text-bone-300">
          {label}
        </div>
        <div className="text-[10px]">
          {approved ? (
            <span className="text-emerald-300 inline-flex items-center gap-1">
              <Check size={10} /> Approved as canon
            </span>
          ) : draft ? (
            <span className="text-amber-300 inline-flex items-center gap-1">
              <AlertTriangle size={10} /> Draft saved — NOT in prompt yet
            </span>
          ) : briefValue ? (
            <span className="text-bone-400">Bible value only — no human approval</span>
          ) : (
            <span className="text-bone-500">(no value)</span>
          )}
        </div>
      </div>
      {(approved?.value || draft?.value || briefValue) && (
        <div className="mt-1 text-[11px] text-bone-100 whitespace-pre-wrap break-words leading-snug max-h-32 overflow-y-auto">
          {approved?.value ?? draft?.value ?? briefValue}
        </div>
      )}
    </div>
  );
}

function humanFieldPath(p: string): string {
  if (p.startsWith("locationBibles.")) {
    const parts = p.split(".");
    return `${parts[1]?.replace(/_/g, " ") ?? ""} › ${parts.slice(2).join(" › ")}`;
  }
  if (p.startsWith("propBibles.")) {
    return `Prop: ${p.split(".")[1]?.replace(/_/g, " ") ?? ""}`;
  }
  if (p.startsWith("characters.")) return "Character";
  return p;
}
