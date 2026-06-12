import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Plus, Loader2, Trash2, CheckCircle2, StickyNote } from "lucide-react";
import type { NoteStatus, NoteTargetType, NoteVisibility, RoomNote } from "@toburt/shared";
import {
  NOTE_STATUSES, NOTE_STATUS_LABELS, NOTE_TARGET_TYPES, NOTE_TARGET_LABELS,
  NOTE_VISIBILITIES, NOTE_VISIBILITY_LABELS, OPEN_NOTE_STATUSES,
} from "@toburt/shared";
import { api } from "@/lib/api";

const GOLD = "#d8b15a";
const gold = { color: GOLD };
const ROOM = "writers";

const STATUS_HUE: Record<NoteStatus, string> = {
  open: "#d8b15a",
  in_review: "#7fb2d1",
  accepted: "#7fd1a4",
  rejected: "#d18f8f",
  applied: "#9a8fd1",
  resolved: "#9a927e",
};

export function NotesDrawer({ projectId, onClose, onCount }: { projectId: string; onClose: () => void; onCount?: (open: number) => void }) {
  const qc = useQueryClient();
  const notesQ = useQuery({
    queryKey: ["room-notes", projectId, ROOM],
    queryFn: () => api.listRoomNotes(projectId, { room: ROOM }),
  });
  const notes = notesQ.data?.notes ?? [];
  const [tab, setTab] = useState<"open" | "all" | "resolved">("open");

  const shown = useMemo(() => {
    if (tab === "open") return notes.filter((n) => OPEN_NOTE_STATUSES.includes(n.status));
    if (tab === "resolved") return notes.filter((n) => !OPEN_NOTE_STATUSES.includes(n.status));
    return notes;
  }, [notes, tab]);

  const openCount = notes.filter((n) => OPEN_NOTE_STATUSES.includes(n.status)).length;
  if (onCount) onCount(openCount);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["room-notes", projectId, ROOM] });
  const create = useMutation({ mutationFn: (b: Parameters<typeof api.createRoomNote>[1]) => api.createRoomNote(projectId, b), onSuccess: invalidate });
  const patch = useMutation({ mutationFn: (a: { id: string; body: Partial<Parameters<typeof api.createRoomNote>[1]> }) => api.updateRoomNote(projectId, a.id, a.body), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteRoomNote(projectId, id), onSuccess: invalidate });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[#26262c] bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#26262c] px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Writers Room</div>
            <div className="font-apple text-lg text-bone-50">Room Notes</div>
            <div className="mt-0.5 text-[11.5px] text-bone-400">Production notes — actionable and resolvable. Not chat. Attach to the room, a scene, a line, a beat, a character or an episode.</div>
          </div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex gap-1 border-b border-[#26262c] px-3 pt-2">
          {(["open", "all", "resolved"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="rounded-t-lg px-3 py-2 text-[12.5px] capitalize transition-colors"
              style={tab === t ? { color: GOLD, borderBottom: `2px solid ${GOLD}` } : { color: "#9a927e" }}>
              {t === "open" ? `Open (${openCount})` : t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {notesQ.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-bone-500" /></div>
          ) : shown.length === 0 ? (
            <div className="grid place-items-center gap-2 py-10 text-center">
              <StickyNote className="h-6 w-6 text-bone-600" />
              <div className="text-[12.5px] text-bone-400">{tab === "open" ? "No open notes." : "No notes here yet."}</div>
            </div>
          ) : (
            <div className="space-y-2">
              {shown.map((n) => (
                <NoteCard key={n.id} note={n} onStatus={(status) => patch.mutate({ id: n.id, body: { status } })} onDelete={() => remove.mutate(n.id)} busy={patch.isPending || remove.isPending} />
              ))}
            </div>
          )}
        </div>

        <Composer busy={create.isPending} error={create.isError ? (create.error as Error).message : null} onAdd={(b) => create.mutate(b)} />
      </div>
    </div>
  );
}

function NoteCard({ note, onStatus, onDelete, busy }: { note: RoomNote; onStatus: (s: NoteStatus) => void; onDelete: () => void; busy: boolean }) {
  return (
    <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-[#26262c] px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide text-bone-400">
          {NOTE_TARGET_LABELS[note.targetType]}{note.targetLabel ? ` · ${note.targetLabel}` : ""}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[9.5px]" style={{ color: STATUS_HUE[note.status], background: `${STATUS_HUE[note.status]}1f` }}>
          {NOTE_STATUS_LABELS[note.status]}
        </span>
        {note.visibility !== "room" && note.visibility !== "project" && (
          <span className="text-[9.5px] text-bone-500">· {note.visibility}</span>
        )}
        <button onClick={onDelete} disabled={busy} className="ml-auto text-bone-500 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-snug text-bone-100">{note.body}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[10px] text-bone-500">{note.authorName ?? "—"}{note.assigneeName ? ` → ${note.assigneeName}` : ""}</span>
        <div className="flex items-center gap-1.5">
          <select
            value={note.status}
            onChange={(e) => onStatus(e.target.value as NoteStatus)}
            disabled={busy}
            className="rounded-md border border-[#26262c] bg-black/40 px-1.5 py-1 text-[10.5px] text-bone-200 focus:border-[#d8b15a]/60 focus:outline-none"
          >
            {NOTE_STATUSES.map((s) => <option key={s} value={s} className="bg-[#0b0b0e]">{NOTE_STATUS_LABELS[s]}</option>)}
          </select>
          {note.status !== "resolved" && (
            <button onClick={() => onStatus("resolved")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2 py-1 text-[10.5px] text-bone-300 hover:border-[#7fd1a4]/50 hover:text-[#7fd1a4]">
              <CheckCircle2 className="h-3 w-3" /> Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Composer({ busy, error, onAdd }: { busy: boolean; error: string | null; onAdd: (b: { room: string; body: string; targetType: NoteTargetType; targetLabel?: string; visibility: NoteVisibility }) => void }) {
  const [body, setBody] = useState("");
  const [targetType, setTargetType] = useState<NoteTargetType>("room");
  const [targetLabel, setTargetLabel] = useState("");
  const [visibility, setVisibility] = useState<NoteVisibility>("room");
  const input = "rounded-md border border-[#26262c] bg-black/30 px-2 py-1.5 text-[12px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none";
  const submit = () => {
    if (!body.trim()) return;
    onAdd({ room: "writers", body: body.trim(), targetType, targetLabel: targetLabel.trim() || undefined, visibility });
    setBody(""); setTargetLabel("");
  };
  return (
    <div className="border-t border-[#26262c] p-3">
      {error && <p className="mb-1 text-[11px] text-red-300">{error}</p>}
      <textarea
        className={input + " min-h-[56px] w-full resize-y"}
        placeholder="Leave a production note — e.g. “Mara's exit in sc.4 doesn't earn the silence; needs a beat of hesitation.”"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <select className={input} value={targetType} onChange={(e) => setTargetType(e.target.value as NoteTargetType)}>
          {NOTE_TARGET_TYPES.map((t) => <option key={t} value={t} className="bg-[#0b0b0e]">{NOTE_TARGET_LABELS[t]}</option>)}
        </select>
        <input className={input} placeholder="What it's about (optional)" value={targetLabel} onChange={(e) => setTargetLabel(e.target.value)} />
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <select className={input + " flex-1"} value={visibility} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
          {NOTE_VISIBILITIES.map((v) => <option key={v} value={v} className="bg-[#0b0b0e]">{NOTE_VISIBILITY_LABELS[v]}</option>)}
        </select>
        <button onClick={submit} disabled={busy || !body.trim()} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add note
        </button>
      </div>
    </div>
  );
}
