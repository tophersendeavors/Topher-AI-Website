import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Lock, Unlock, Check, CircleDashed, Loader2, ShieldCheck } from "lucide-react";
import type { LockRequirement } from "@toburt/shared";
import { api } from "@/lib/api";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

export function FinalDraftDrawer({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const lockQ = useQuery({ queryKey: ["final-lock", projectId], queryFn: () => api.getFinalLock(projectId) });
  const status = lockQ.data?.status;
  const seed = (s: NonNullable<typeof status>) => qc.setQueryData(["final-lock", projectId], { status: s });

  const settings = useMutation({
    mutationFn: (patch: Parameters<typeof api.updateFinalLockSettings>[1]) => api.updateFinalLockSettings(projectId, patch),
    onSuccess: (r) => seed(r.status),
  });
  const lock = useMutation({ mutationFn: () => api.lockFinalDraft(projectId), onSuccess: (r) => seed(r.status) });
  const unlock = useMutation({ mutationFn: () => api.unlockFinalDraft(projectId), onSuccess: (r) => seed(r.status) });

  const locked = status?.lock.locked ?? false;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[#26262c] bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#26262c] px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Writers Room</div>
            <div className="font-apple text-lg text-bone-50">Final Draft Lock</div>
            <div className="mt-0.5 text-[11.5px] text-bone-400">The formal gate before the Creative Room. Everything below must be done or intentionally waived — then you lock a versioned draft.</div>
          </div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {lockQ.isLoading || !status ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-bone-500" /></div>
          ) : locked ? (
            <LockedState
              version={status.lock.version}
              draftLabel={status.draftLabel}
              lockedAt={status.lock.lockedAt}
              onUnlock={() => unlock.mutate()}
              unlocking={unlock.isPending}
            />
          ) : (
            <div className="space-y-2">
              {status.requirements.map((r) => (
                <RequirementRow
                  key={r.key}
                  req={r}
                  busy={settings.isPending}
                  humanReadStatus={status.lock.humanReadStatus}
                  notesWaived={status.lock.notesWaived}
                  creatorApproved={status.lock.creatorApproved}
                  onSetting={(patch) => settings.mutate(patch)}
                />
              ))}
            </div>
          )}
        </div>

        {!locked && status && (
          <div className="border-t border-[#26262c] p-4">
            {lock.isError && <p className="mb-2 text-[12px] text-red-300">{(lock.error as Error).message}</p>}
            <button
              onClick={() => lock.mutate()}
              disabled={!status.canLock || lock.isPending}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium text-black disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: GOLD }}
            >
              {lock.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Lock final draft
            </button>
            {!status.canLock && <p className="mt-2 text-center text-[11px] text-bone-500">Complete or waive every item above to lock.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function RequirementRow({
  req, busy, humanReadStatus, notesWaived, creatorApproved, onSetting,
}: {
  req: LockRequirement;
  busy: boolean;
  humanReadStatus: "pending" | "complete" | "skipped";
  notesWaived: boolean;
  creatorApproved: boolean;
  onSetting: (patch: { humanReadStatus?: "pending" | "complete" | "skipped"; notesWaived?: boolean; creatorApproved?: boolean }) => void;
}) {
  return (
    <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
      <div className="flex items-start gap-2.5">
        {req.met ? <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#7fd1a4" }} /> : <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-bone-500" />}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-bone-50">{req.label}</div>
          <div className="text-[11px] text-bone-400">{req.detail}</div>

          {/* per-requirement actions */}
          {req.key === "creator_approval" && (
            <button
              onClick={() => onSetting({ creatorApproved: !creatorApproved })}
              disabled={busy}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] disabled:opacity-50"
              style={creatorApproved ? { borderColor: "#7fd1a4", color: "#7fd1a4" } : { borderColor: "#26262c", color: GOLD }}
            >
              <ShieldCheck className="h-3 w-3" /> {creatorApproved ? "Approved — undo" : "Give creator approval"}
            </button>
          )}

          {req.key === "human_read" && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(["complete", "skipped", "pending"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => onSetting({ humanReadStatus: v })}
                  disabled={busy}
                  className="rounded-md border px-2 py-0.5 text-[10.5px] capitalize disabled:opacity-50"
                  style={humanReadStatus === v ? { borderColor: `${GOLD}88`, color: GOLD } : { borderColor: "#26262c", color: "#9a927e" }}
                >
                  {v === "complete" ? "Mark complete" : v === "skipped" ? "Skip" : "Reset"}
                </button>
              ))}
            </div>
          )}

          {req.key === "blocking_notes" && !req.met && (
            <button
              onClick={() => onSetting({ notesWaived: true })}
              disabled={busy}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-300 hover:border-bone-600 disabled:opacity-50"
            >
              Waive remaining notes
            </button>
          )}
          {req.key === "blocking_notes" && notesWaived && (
            <button onClick={() => onSetting({ notesWaived: false })} disabled={busy} className="mt-1.5 text-[10.5px] text-bone-500 underline">un-waive</button>
          )}
        </div>
      </div>
    </div>
  );
}

function LockedState({ version, draftLabel, lockedAt, onUnlock, unlocking }: { version: number | null; draftLabel: string | null; lockedAt: string | null; onUnlock: () => void; unlocking: boolean }) {
  return (
    <div className="grid place-items-center gap-3 py-8 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-full border" style={{ borderColor: `${GOLD}66`, color: GOLD, boxShadow: `0 0 24px ${GOLD}33` }}>
        <Lock className="h-6 w-6" />
      </div>
      <div className="font-apple text-lg text-bone-50">Final draft locked</div>
      <div className="text-[12px] text-bone-300">{draftLabel ?? "Draft"} · locked as <span style={gold}>v{version ?? 1}</span></div>
      {lockedAt && <div className="text-[11px] text-bone-500">{new Date(lockedAt).toLocaleString()}</div>}
      <p className="max-w-xs text-[11.5px] leading-relaxed text-bone-400">This draft is locked and ready for the Creative Room handoff. Unlock if you need to revise further.</p>
      <button onClick={onUnlock} disabled={unlocking} className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-4 py-2 text-[12.5px] text-bone-200 hover:bg-white/5 disabled:opacity-50">
        {unlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />} Unlock to revise
      </button>
    </div>
  );
}
