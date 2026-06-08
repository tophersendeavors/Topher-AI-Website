// Prompt Impact Preview — shows which scenes/shots a canon change
// affects, in friendly labels (EP01 SC01 SH02). Used inline in the AI
// Proposal view after the user clicks Approve as canon. Also embeddable
// from the Live Person Department Workspace once it knows a canon
// target.

import { useQuery } from "@tanstack/react-query";
import { Loader2, AlertCircle, Film, Camera, User } from "lucide-react";
import { api } from "@/lib/api";

interface Props {
  scriptId: string;
  canonFieldPath: string;
  /** Auto-collapse if no shots are affected. */
  hideWhenEmpty?: boolean;
}

export function ImpactPreview({ scriptId, canonFieldPath, hideWhenEmpty }: Props) {
  const q = useQuery({
    queryKey: ["canon-impact", scriptId, canonFieldPath],
    queryFn: () => api.getCanonImpact(scriptId, canonFieldPath),
    enabled: !!scriptId && !!canonFieldPath,
  });

  if (q.isLoading) {
    return (
      <div className="rounded border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-bone-400">
        <Loader2 size={10} className="inline animate-spin mr-1" /> Computing impact…
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="rounded border border-red-700/30 bg-red-900/10 px-2.5 py-1.5 text-[11px] text-red-200">
        <AlertCircle size={10} className="inline mr-1" />
        Couldn't compute impact: {(q.error as Error).message}
      </div>
    );
  }
  if (!q.data) return null;
  const { scenes, totalShots, affects, category, suggestion } = q.data;
  if (totalShots === 0 && hideWhenEmpty) return null;

  const Icon = category === "location" ? Film : category === "prop" ? Camera : User;

  return (
    <div className="os-impact">
      <div className="os-impact-head">
        <div className="os-impact-icon">
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="os-impact-title">
            {totalShots === 0
              ? "No downstream shots affected"
              : `Approving affects ${totalShots} shot${totalShots === 1 ? "" : "s"} across ${scenes.length} scene${scenes.length === 1 ? "" : "s"}`}
          </div>
          <div className="os-impact-sub">
            {totalShots === 0 ? (
              <>This canon isn't used by any existing shot yet — approving it now won't make anything stale.</>
            ) : (
              <>
                Changes{" "}
                <b>
                  {affects === "promptText"
                    ? "the prompt text"
                    : affects === "reference"
                      ? "the reference metadata"
                      : "the prompt text and reference metadata"}
                </b>{" "}
                downstream.
              </>
            )}
          </div>
          {totalShots > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-bone-400 hover:text-bone-200">
                Show affected shots
              </summary>
              <ul className="mt-2 space-y-1.5">
                {scenes.map((s) => (
                  <li key={s.sceneOrd} className="text-[12px]">
                    <div className="text-bone-100 font-medium">{s.label}</div>
                    <ul className="ml-3 mt-0.5 list-disc pl-3 text-bone-400">
                      {s.shots.map((sh) => (
                        <li key={`${sh.sceneOrd}-${sh.shotIndex}`}>
                          {sh.label} — <span className="text-bone-500">{sh.matchReason}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {suggestion && (
            <div className="mt-3 text-[11px] text-bone-400 italic">{suggestion}</div>
          )}
        </div>
      </div>
    </div>
  );
}
