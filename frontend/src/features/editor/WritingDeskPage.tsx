import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Save, Download, Loader2, Wand2, PencilLine, MessageCircle,
  Sparkles, ClipboardCheck, StickyNote, ListOrdered, Users, Check, ArrowRight,
  CheckCircle2, Play, SkipForward, AlertTriangle, Copy, ArrowDownToLine, Trash2, Lock, RefreshCw,
} from "lucide-react";
import type { CollabAction, NoteStatus, QualityAgent, ReviewRun, WritersRoomResponse } from "@toburt/shared";
import { reviewAuthorityOf, REVIEW_AUTHORITY_LABELS, OPEN_NOTE_STATUSES } from "@toburt/shared";
import { api } from "@/lib/api";
import { markProjectOpened } from "@/lib/recentProjects";
import { FinalDraftDrawer } from "@/features/writers-room/FinalDraftDrawer";
import { FOUNTAIN_LANG_ID, FOUNTAIN_THEME, fountainLanguageDef } from "./fountain";

const GOLD = "#d8b15a";
const gold = { color: GOLD };
type Tab = "team" | "outline" | "bench" | "notes";

// Where the writer is in the concept → outline → draft → review → lock journey.
type Stage = "concept_outline" | "outline_review" | "draft_from_outline" | "drafting" | "reviewing" | "locked";
function writingStage(room: WritersRoomResponse, hasText: boolean): Stage {
  const wf = room.state.writeFlow;
  if (room.state.finalLock.locked) return "locked";
  if (wf.draftApproved) return "reviewing";
  if (hasText) return "drafting";
  const mode = room.state.writingMode;
  const generative = mode === "concept" || mode === "ai_writer" || mode === "ai_creative" || (!mode && !!wf.outline);
  if (generative) {
    if (wf.outline?.approved) return "draft_from_outline";
    if (wf.outline) return "outline_review";
    return "concept_outline";
  }
  return "drafting"; // manual / upload with no text yet
}
const HEADING_RE = /^(\.|INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\b/i;
/** Heuristic: does the draft end on something that signals it's incomplete? */
function isUnfinished(body: string): boolean {
  const lines = body.split(/\r?\n/);
  let i = lines.length - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  if (i < 0) return false;
  const last = lines[i].trim();
  if (HEADING_RE.test(last)) return true;                       // ends on a scene heading
  if (/(TO:|FADE OUT\.?|CUT TO:?|SMASH CUT:?)$/i.test(last)) return true; // transition
  if (/^(---|\*\*\*|===|—)$/.test(last)) return true;            // dangling separator
  // bare character cue (short ALL-CAPS line, no sentence punctuation)
  if (/^[A-Z][A-Z0-9 .'()\-]{1,30}$/.test(last) && !/[.!?]$/.test(last) && last.length < 32) return true;
  return false;
}

const STAGE_META: Record<Stage, { objective: string; next: string }> = {
  concept_outline: { objective: "Develop concept into an outline", next: "Draft" },
  outline_review: { objective: "Review & approve the outline", next: "Draft" },
  draft_from_outline: { objective: "Draft from the approved outline", next: "Review Bench" },
  drafting: { objective: "Create approved draft", next: "Review Bench" },
  reviewing: { objective: "Resolve notes", next: "Final Draft Lock" },
  locked: { objective: "Locked draft complete", next: "Creative Room Handoff" },
};

export function WritingDeskPage() {
  const { projectId, scriptId } = useParams<{ projectId: string; scriptId: string }>();
  if (!projectId || !scriptId) return null;
  const qc = useQueryClient();
  const navigate = useNavigate();

  const scriptQ = useQuery({ queryKey: ["script", scriptId], queryFn: () => api.getScript(scriptId) });
  const projectQ = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const roomQ = useQuery({ queryKey: ["writers-room", projectId], queryFn: () => api.getWritersRoom(projectId) });
  const draftsQ = useQuery({ queryKey: ["scripts", projectId], queryFn: () => api.listScripts(projectId) });

  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("team");
  const [lockOpen, setLockOpen] = useState(false);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => { markProjectOpened(projectId); }, [projectId]);
  useEffect(() => { if (scriptQ.data) { setBody(scriptQ.data.fountain ?? ""); setDirty(false); } }, [scriptQ.data?.id]);

  const save = useMutation({
    mutationFn: () => api.updateScript(scriptId, { fountain: body }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ["script", scriptId] }); },
  });
  // Approve = save your text first (so the staff reviews what you see), then pin
  // THIS script as the working/approved draft.
  const approveMut = useMutation({
    mutationFn: async () => {
      if (dirty) await api.updateScript(scriptId, { fountain: body });
      const approving = !(roomQ.data?.state.writeFlow.draftApproved ?? false);
      return api.approveWriteDraft(projectId, approving, scriptId);
    },
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["writers-room", projectId] });
      qc.invalidateQueries({ queryKey: ["scripts", projectId] });
      qc.invalidateQueries({ queryKey: ["script", scriptId] });
    },
  });

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    if (!monaco.languages.getLanguages().some((l) => l.id === FOUNTAIN_LANG_ID)) {
      monaco.languages.register({ id: FOUNTAIN_LANG_ID });
      monaco.languages.setMonarchTokensProvider(FOUNTAIN_LANG_ID, fountainLanguageDef());
    }
    // Warm "script paper" surface — dark/premium, not a black code canvas.
    monaco.editor.defineTheme("toburt-desk", {
      ...FOUNTAIN_THEME,
      colors: {
        ...FOUNTAIN_THEME.colors,
        "editor.background": "#16120d",
        "editor.foreground": "#e7ddc9",
        "editor.lineHighlightBackground": "#1c150e",
        "editorCursor.foreground": "#d8b15a",
        "editor.selectionBackground": "#d8b15a2e",
        "editorGutter.background": "#16120d",
      },
    });
    monaco.editor.setTheme("toburt-desk");
  };

  const getSelection = (): string => {
    const ed = editorRef.current;
    if (!ed) return "";
    const sel = ed.getSelection();
    return sel && !sel.isEmpty() ? ed.getModel()?.getValueInRange(sel) ?? "" : "";
  };
  // Context to continue from: text up to the cursor when the cursor sits inside
  // the draft; otherwise the whole draft. `atCursor` = cursor isn't at the end.
  const getContext = (): { text: string; atCursor: boolean } => {
    const ed = editorRef.current; const model = ed?.getModel();
    if (!ed || !model) return { text: body, atCursor: false };
    const pos = ed.getPosition();
    const end = model.getFullModelRange().getEndPosition();
    const atCursor = !!pos && !(pos.lineNumber === end.lineNumber && pos.column === end.column);
    const text = pos && atCursor
      ? model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: pos.lineNumber, endColumn: pos.column })
      : model.getValue();
    return { text, atCursor };
  };
  // Apply collaborator text where the user chooses.
  const applyText = (text: string, where: "append" | "cursor" | "replace") => {
    const ed = editorRef.current;
    if (where === "append" || !ed) { setBody((b) => `${b.trimEnd()}\n\n${text}\n`); setDirty(true); return; }
    if (where === "cursor") {
      const pos = ed.getPosition();
      if (pos) { ed.executeEdits("collab", [{ range: { startLineNumber: pos.lineNumber, startColumn: pos.column, endLineNumber: pos.lineNumber, endColumn: pos.column }, text: `\n${text}\n` }]); setBody(ed.getValue()); setDirty(true); }
      return;
    }
    const sel = ed.getSelection();
    if (sel && !sel.isEmpty()) { ed.executeEdits("collab", [{ range: sel, text }]); setBody(ed.getValue()); setDirty(true); }
    else { setBody((b) => `${b.trimEnd()}\n\n${text}\n`); setDirty(true); }
  };
  // Make sure the editor's current text is persisted before the server applies a
  // rewrite to it (so the staff edits exactly what you see).
  const ensureSaved = async () => { if (dirty) { await api.updateScript(scriptId, { fountain: body }); setDirty(false); } };
  // The server applied a rewrite and returned the new draft text — sync the editor.
  const onDraftReplaced = (fountain: string) => {
    setBody(fountain);
    setDirty(false);
    qc.invalidateQueries({ queryKey: ["script", scriptId] });
  };

  const room = roomQ.data;
  const title = scriptQ.data?.title ?? projectQ.data?.title ?? "—";
  const hasText = !!body.trim();
  const stage: Stage = room ? writingStage(room, hasText) : "drafting";
  const meta = STAGE_META[stage];
  const showApprove = !!room && (hasText || room.state.writeFlow.draftApproved) && (stage === "drafting" || stage === "reviewing" || stage === "locked");
  const unfinished = hasText && isUnfinished(body);

  return (
    <div className="flex h-screen flex-col bg-[#0a0a0c] text-bone-100">
      {/* context strip — the bridge from the Writers Room */}
      <header className="flex items-center justify-between border-b border-[#1c1c20] px-4 py-2.5" style={{ background: "linear-gradient(180deg,#141016,#0a0a0c)" }}>
        <div className="flex items-center gap-3">
          <Link to={`/projects/${projectId}/writers-room`} className="flex items-center gap-1.5 rounded-lg border border-[#26262c] px-2.5 py-1.5 text-[11.5px] text-bone-200 hover:border-[#d8b15a]/45">
            <ChevronLeft className="h-3.5 w-3.5" /> Writers Room
          </Link>
          <div className="leading-tight">
            <div className="text-[12.5px] font-medium text-bone-50">{projectQ.data?.title ?? "—"}</div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-bone-500">
              <span style={gold}>Writers Room</span> <ArrowRight className="h-2.5 w-2.5" /> Draft
              <span className="ml-2 text-bone-600">Objective · {meta.objective}</span>
              <span className="text-bone-700">·</span><span className="text-bone-600">Next · {meta.next}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showApprove && <ApproveDraftButton approved={room?.state.writeFlow.draftApproved ?? false} hasText={hasText} unfinished={unfinished} pending={approveMut.isPending} onToggle={() => approveMut.mutate()} />}
          {(stage === "reviewing" || stage === "locked") && (
            <button onClick={() => setLockOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#26262c] px-2.5 py-1.5 text-[12px] text-bone-200 hover:border-[#d8b15a]/45">
              <Lock className="h-3.5 w-3.5" style={gold} /> Final Draft Lock
            </button>
          )}
          <ExportMenu scriptId={scriptId} />
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {dirty ? "Save Draft" : "Saved"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left: this draft + other versions */}
        <aside className="hidden w-[210px] shrink-0 flex-col border-r border-[#1c1c20] p-3 md:flex">
          <div className="text-[10px] uppercase tracking-wide text-bone-500">This draft</div>
          <div className="mt-2 rounded-lg border border-[#26262c] bg-white/[0.015] p-2.5">
            <div className="text-[12.5px] text-bone-50">Draft {scriptQ.data?.draft_number ?? 1} · <span style={gold}>Current</span></div>
            <div className="mt-1 text-[11px] text-bone-400">
              Status · {room?.state.finalLock.locked ? "Locked" : room?.state.writeFlow.draftApproved ? "Approved" : "In progress"}
            </div>
            {scriptQ.data?.updated_at && <div className="text-[10.5px] text-bone-500">Saved {new Date(scriptQ.data.updated_at).toLocaleDateString()}</div>}
            {room?.state.writeFlow.outline?.approved && <div className="mt-1 text-[10.5px] text-bone-500">Based on {room.state.writeFlow.outline.collaborator?.name ?? "an"} outline</div>}
          </div>
          {(() => {
            const others = (draftsQ.data ?? []).filter((d) => d.id !== scriptId);
            if (others.length === 0) return null;
            return (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wide text-bone-500">Other versions</div>
                <div className="mt-1.5 space-y-1">
                  {others.map((d) => (
                    <Link key={d.id} to={`/projects/${projectId}/drafts/${d.id}/editor`} className="block truncate rounded-md px-2 py-1 text-[11.5px] text-bone-400 hover:text-bone-100">
                      Draft {d.draft_number}{!d.fountain?.trim() ? " · empty" : ""}{d.updated_at ? ` · ${new Date(d.updated_at).toLocaleDateString()}` : ""}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })()}
        </aside>

        {/* center: the script page on the writing desk */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden p-5" style={{ background: "radial-gradient(130% 85% at 50% -8%, rgba(216,177,90,0.07), transparent 55%), #0a0a0c" }}>
          {unfinished && stage !== "reviewing" && stage !== "locked" && (
            <div className="mx-auto mb-3 flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-[#d8b15a]/30 bg-[#d8b15a]/[0.06] px-4 py-2">
              <span className="text-[11.5px] text-bone-200">This draft appears unfinished — it ends on a heading/cue with nothing after it.</span>
              <button onClick={() => setTab("team")} className="shrink-0 rounded-md px-3 py-1 text-[11.5px] font-medium text-black" style={{ background: GOLD }}>Continue from end</button>
            </div>
          )}
          {stage === "reviewing" && (
            <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 rounded-lg border border-[#7fd1a4]/25 bg-[#7fd1a4]/[0.05] px-4 py-2">
              <span className="text-[11.5px] text-bone-200"><span className="font-medium" style={{ color: "#7fd1a4" }}>Draft approved.</span> Next: run the Review Bench for notes &amp; fixes, then lock the final draft.</span>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => setTab("bench")} className="rounded-md px-3 py-1 text-[11.5px] font-medium text-black" style={{ background: GOLD }}>Open Review Bench</button>
                <button onClick={() => setLockOpen(true)} className="rounded-md border border-[#26262c] px-3 py-1 text-[11.5px] text-bone-200 hover:border-[#d8b15a]/45">Final Draft Lock</button>
              </div>
            </div>
          )}
          {stage === "locked" && (
            <div className="mx-auto mb-3 flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-[#d8b15a]/30 bg-[#d8b15a]/[0.06] px-4 py-2">
              <span className="text-[11.5px] text-bone-200"><span className="font-medium" style={gold}>Draft locked.</span> Ready for the Creative Room handoff.</span>
              <Link to={`/projects/${projectId}/writers-room`} className="shrink-0 rounded-md px-3 py-1 text-[11.5px] font-medium text-black" style={{ background: GOLD }}>Back to Writers Room</Link>
            </div>
          )}
          <div
            className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-2xl"
            style={{ border: "1px solid #2a2118", background: "#16120d", boxShadow: "0 28px 70px rgba(0,0,0,0.6), 0 0 0 1px rgba(216,177,90,0.05), inset 0 1px 0 rgba(255,255,255,0.03)" }}
          >
            <div className="flex items-center justify-between border-b border-[#26201a] px-6 py-2">
              <span className="text-[10px] uppercase tracking-[0.22em] text-bone-500">{title} · Draft {scriptQ.data?.draft_number ?? 1}</span>
              <span className="text-[10px]" style={{ color: dirty ? GOLD : "#6b6660" }}>{dirty ? "Unsaved changes" : "Saved"}</span>
            </div>
            <div className="min-h-0 flex-1">
              <Editor
                language={FOUNTAIN_LANG_ID}
                theme="toburt-desk"
                value={body}
                onMount={onMount}
                onChange={(v) => { setBody(v ?? ""); setDirty(true); }}
                options={{
                  fontFamily: '"Courier Prime","Courier New",Courier,monospace',
                  fontSize: 15, lineHeight: 24, letterSpacing: 0.2,
                  lineNumbers: "off", glyphMargin: false, folding: false,
                  lineDecorationsWidth: 28, lineNumbersMinChars: 0,
                  minimap: { enabled: false }, renderLineHighlight: "none", wordWrap: "on",
                  padding: { top: 40, bottom: 140 }, scrollBeyondLastLine: true, smoothScrolling: true,
                  overviewRulerLanes: 0, scrollbar: { verticalScrollbarSize: 8, horizontal: "hidden" },
                }}
              />
            </div>
          </div>
        </main>

        {/* right: active context */}
        <aside className="flex w-[360px] shrink-0 flex-col border-l border-[#1c1c20] bg-[#0b0b0e]">
          <div className="flex gap-0.5 border-b border-[#1c1c20] px-2 pt-2">
            {([["team", Users, "Writing Team"], ["outline", ListOrdered, "Outline"], ["bench", ClipboardCheck, "Review Bench"], ["notes", StickyNote, "Notes"]] as const).map(([k, Icon, label]) => (
              <button key={k} onClick={() => setTab(k)} className="flex flex-1 items-center justify-center gap-1 rounded-t-lg px-1.5 py-2 text-[10.5px] transition-colors" style={tab === k ? { color: GOLD, borderBottom: `2px solid ${GOLD}` } : { color: "#9a927e" }} title={label}>
                <Icon className="h-3.5 w-3.5" /> <span className="hidden lg:inline">{label}</span>
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!room ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-bone-500" /></div>
              : tab === "team" ? <TeamTab projectId={projectId} room={room} stage={stage} getSelection={getSelection} getContext={getContext} applyText={applyText} onRoomRefresh={() => qc.invalidateQueries({ queryKey: ["writers-room", projectId] })} />
              : tab === "outline" ? <OutlineTab room={room} onGoRoom={() => navigate(`/projects/${projectId}/writers-room`)} />
              : tab === "bench" ? <BenchTab projectId={projectId} room={room} hasText={!!body.trim()} ensureSaved={ensureSaved} onDraftReplaced={onDraftReplaced} onState={() => qc.invalidateQueries({ queryKey: ["writers-room", projectId] })} />
              : <NotesTab projectId={projectId} />}
          </div>
        </aside>
      </div>

      {lockOpen && <FinalDraftDrawer projectId={projectId} onClose={() => { setLockOpen(false); qc.invalidateQueries({ queryKey: ["writers-room", projectId] }); }} />}
    </div>
  );
}

function ApproveDraftButton({ approved, hasText, unfinished, pending, onToggle }: { approved: boolean; hasText: boolean; unfinished: boolean; pending: boolean; onToggle: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const onClick = () => { if (!approved && unfinished && !confirm) { setConfirm(true); return; } setConfirm(false); onToggle(); };
  if (confirm && !approved) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8b15a]/40 bg-black/40 px-2 py-1 text-[11.5px]">
        <AlertTriangle className="h-3.5 w-3.5" style={gold} />
        <span className="text-bone-200">May be incomplete.</span>
        <button onClick={() => { setConfirm(false); onToggle(); }} disabled={pending} className="rounded px-2 py-0.5 font-medium text-black" style={{ background: GOLD }}>Approve anyway</button>
        <button onClick={() => setConfirm(false)} className="px-1 text-bone-400 hover:text-bone-100">Cancel</button>
      </div>
    );
  }
  return (
    <button onClick={onClick} disabled={pending || (!hasText && !approved)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-50"
      style={approved ? { borderColor: "#7fd1a4", color: "#7fd1a4" } : { borderColor: "#26262c", color: GOLD }}>
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {approved ? "Draft approved" : "Approve Draft"}
    </button>
  );
}

// ---- Writing Team ----------------------------------------------------------

function TeamTab({ projectId, room, stage, getSelection, getContext, applyText, onRoomRefresh }: { projectId: string; room: WritersRoomResponse; stage: Stage; getSelection: () => string; getContext: () => { text: string; atCursor: boolean }; applyText: (text: string, where: "append" | "cursor" | "replace") => void; onRoomRefresh: () => void }) {
  const seats = room.state.seats;
  const aiSeat = seats.find((s) => s.kind === "ai_creative" || s.kind === "ai_writer") ?? null;
  const creative = aiSeat?.kind === "ai_creative" ? room.creatives.find((c) => c.id === aiSeat.ref.id) ?? null : null;
  const liveSeats = seats.filter((s) => s.kind === "live_person");
  const name = aiSeat?.name ?? null;
  const first = name?.split(" ")[0] ?? "Studio";

  const [message, setMessage] = useState<{ from: string | null; text: string } | null>(null);
  const [steer, setSteer] = useState("");
  const [continueSteer, setContinueSteer] = useState("");
  const [ask, setAsk] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ text: string } | null>(null);
  const [previewMeta, setPreviewMeta] = useState<{ atCursor: boolean; hadSelection: boolean }>({ atCursor: false, hadSelection: false });

  const collab = useMutation({
    mutationFn: (v: { action: CollabAction; instruction?: string; context?: string; selection?: string }) =>
      api.collaborate(projectId, { action: v.action, selection: (v.selection ?? getSelection()) || undefined, instruction: v.instruction, context: v.context }),
    onSuccess: (r) => { if (r.mode === "message") setMessage({ from: r.collaborator, text: r.text }); else setPreview({ text: r.text }); },
    onSettled: () => setPendingKey(null),
  });
  const outlineGen = useMutation({ mutationFn: (notes?: string) => api.generateWriteOutline(projectId, aiSeat?.seatId, notes), onSuccess: onRoomRefresh, onSettled: () => setPendingKey(null) });
  const outlineApprove = useMutation({ mutationFn: () => api.approveWriteOutline(projectId), onSuccess: onRoomRefresh, onSettled: () => setPendingKey(null) });
  const busy = collab.isPending || outlineGen.isPending || outlineApprove.isPending;

  const runContinue = () => {
    const sel = getSelection();
    setPendingKey("continue");
    if (sel.trim()) { setPreviewMeta({ atCursor: false, hadSelection: true }); collab.mutate({ action: "rewrite", instruction: continueSteer.trim() || undefined, selection: sel }); }
    else { const ctx = getContext(); setPreviewMeta({ atCursor: ctx.atCursor, hadSelection: false }); collab.mutate({ action: "complete", instruction: continueSteer.trim() || undefined, context: ctx.text }); }
  };
  const apply = (where: "append" | "cursor" | "replace") => { if (preview) { applyText(preview.text, where); setPreview(null); } };

  if (!aiSeat) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3.5">
          <div className="flex items-center gap-2 text-[13px] text-bone-50"><PencilLine className="h-4 w-4" style={gold} /> Writing manually</div>
          <p className="mt-1 text-[11.5px] text-bone-400">You're writing this draft yourself. Seat an AI Writer or AI Creative in the Writers Room to write with you, or run the Review Bench when you have pages.</p>
        </div>
        {liveSeats.length > 0 && <LiveSeats seats={liveSeats} />}
      </div>
    );
  }

  // A stage-aware action: either an LLM collab call or an outline op.
  type Act = { key: string; label: string; Icon: typeof Wand2; run: () => void };
  const collabAct = (key: string, action: CollabAction, label: string, Icon: typeof Wand2, instruction?: string): Act =>
    ({ key, label, Icon, run: () => {
      setPendingKey(key);
      const hadSelection = (action === "rewrite" || action === "subtext") && !!getSelection().trim();
      setPreviewMeta({ atCursor: false, hadSelection });
      collab.mutate({ action, instruction });
    } });

  let intro = "";
  let acts: Act[] = [];
  if (stage === "concept_outline") {
    intro = `Develop the concept into a beat outline with ${first}.`;
    acts = [
      { key: "gen", label: `Generate outline with ${first}`, Icon: ListOrdered, run: () => { setPendingKey("gen"); outlineGen.mutate(steer.trim() || undefined); } },
      collabAct("premise", "ask", `Ask ${first} for premise concerns`, MessageCircle, "What are the biggest premise/concept concerns before we outline?"),
      collabAct("tone", "ask", "Ask for tone direction", MessageCircle, "What tone direction would you set for this, and why?"),
      collabAct("open", "ask", "Suggest an opening image", Sparkles, "Suggest a strong opening image for this story."),
      collabAct("shape", "ask", "Suggest the first scene's shape", Sparkles, "Suggest the shape of the very first scene."),
    ];
  } else if (stage === "outline_review") {
    intro = `Outline ready — ${room.state.writeFlow.outline?.beats.length ?? 0} beats. Revise with ${first}, or approve to draft. (See the Outline tab.)`;
    acts = [
      { key: "revise", label: `Revise outline with ${first}`, Icon: ListOrdered, run: () => { setPendingKey("revise"); outlineGen.mutate(steer.trim() || undefined); } },
      collabAct("structure", "ask", "Suggest an alternate structure", Sparkles, "Propose an alternate structure for this outline."),
      collabAct("midpoint", "ask", "Strengthen the midpoint / twist", Sparkles, "How should the midpoint or central twist be strengthened?"),
      { key: "approve", label: "Approve outline", Icon: Check, run: () => { setPendingKey("approve"); outlineApprove.mutate(); } },
    ];
  } else if (stage === "draft_from_outline") {
    intro = `Outline approved. Draft it scene by scene with ${first}.`;
    acts = [
      collabAct("first", "next_scene", `Draft first scene with ${first}`, Wand2),
      collabAct("cont", "continue", "Continue from the outline", PencilLine),
      collabAct("next", "next_scene", `Draft next scene with ${first}`, Wand2),
    ];
  } else {
    // drafting / reviewing / locked — work on existing pages
    intro = stage === "reviewing" ? "Draft approved — the Review Bench is reviewing. You can still revise here." : `Write on with ${first}.`;
    acts = aiSeat.kind === "ai_creative"
      ? [
          collabAct("next", "next_scene", `Draft next scene with ${first}`, Wand2),
          collabAct("rewrite", "rewrite", `Rewrite selected with ${first}`, Sparkles),
          collabAct("subtext", "subtext", "Strengthen subtext", Sparkles),
          collabAct("alt", "alt_beat", "Suggest an alternate beat", Sparkles),
        ]
      : [
          collabAct("next", "next_scene", "Draft next scene", Wand2),
          collabAct("cont", "continue", "Continue draft", PencilLine),
          collabAct("rewrite", "rewrite", "Rewrite selected passage", Sparkles),
        ];
  }

  const showSteer = stage === "concept_outline" || stage === "outline_review";

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#d8b15a]/25 bg-[#d8b15a]/[0.05] p-3.5">
        <div className="flex items-center gap-2 text-[13.5px] text-bone-50"><Sparkles className="h-4 w-4" style={gold} /> {name}</div>
        <div className="text-[11px]" style={gold}>{aiSeat.kind === "ai_creative" ? `AI Creative · ${creative?.role ?? "Creative lens"}` : "Studio AI Writer · automated draft support"}</div>
        {creative && <div className="mt-1 text-[11px] text-bone-300">Current lens: {creative.style}</div>}
      </div>

      <p className="text-[11px] text-bone-400">{intro}</p>

      {showSteer && (
        <textarea value={steer} onChange={(e) => setSteer(e.target.value)} placeholder={`Optional — steer ${first}: "open quieter", "lean into the sister relationship"…`} className="min-h-[44px] w-full resize-y rounded-md border border-[#26262c] bg-black/30 px-2.5 py-1.5 text-[12px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none" />
      )}

      {/* Continue from end / complete the ending — the headline drafting action */}
      {(stage === "draft_from_outline" || stage === "drafting" || stage === "reviewing") && (
        <div className="rounded-xl border border-[#d8b15a]/20 bg-black/20 p-2.5">
          <div className="text-[10px] uppercase tracking-wide" style={gold}>Continue / complete the draft</div>
          <textarea value={continueSteer} onChange={(e) => setContinueSteer(e.target.value)} placeholder={`Tell ${first} how to continue or finish this section…`} className="mt-1 min-h-[40px] w-full resize-y rounded-md border border-[#26262c] bg-black/30 px-2.5 py-1.5 text-[12px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none" />
          <button onClick={runContinue} disabled={busy} className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12.5px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
            {busy && pendingKey === "continue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowDownToLine className="h-4 w-4" />} Continue from end with {first}
          </button>
          <p className="mt-1 text-[10px] text-bone-600">Continues from your cursor (or the end). Select text first to rewrite that passage instead.</p>
        </div>
      )}

      {/* preview / apply — nothing is auto-inserted */}
      {preview && (
        <div className="rounded-xl border border-[#d8b15a]/30 bg-[#16120d] p-2.5">
          <div className="text-[10px] uppercase tracking-wide" style={gold}>{first}'s draft — preview</div>
          <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-[11.5px] leading-snug text-bone-100">{preview.text}</pre>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button onClick={() => apply("append")} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-black" style={{ background: GOLD }}><ArrowDownToLine className="h-3 w-3" /> Append to draft</button>
            {previewMeta.atCursor && <button onClick={() => apply("cursor")} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-200 hover:border-[#d8b15a]/45">Insert at cursor</button>}
            {previewMeta.hadSelection && <button onClick={() => apply("replace")} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-200 hover:border-[#d8b15a]/45">Replace selected</button>}
            <button onClick={() => navigator.clipboard?.writeText(preview.text)} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-300 hover:border-bone-600"><Copy className="h-3 w-3" /> Copy</button>
            <button onClick={() => setPreview(null)} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-400 hover:text-red-300"><Trash2 className="h-3 w-3" /> Discard</button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        {acts.map((a) => (
          <button key={a.key} onClick={a.run} disabled={busy} className="flex w-full items-center gap-2 rounded-lg border border-[#26262c] bg-white/[0.015] px-3 py-2 text-left text-[12.5px] text-bone-100 hover:border-[#d8b15a]/45 disabled:opacity-50">
            {busy && pendingKey === a.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={gold} /> : <a.Icon className="h-3.5 w-3.5" style={gold} />} {a.label}
          </button>
        ))}
      </div>
      {(stage === "drafting" || stage === "reviewing") && <p className="text-[10.5px] text-bone-600">Tip: select text in the script to rewrite just that passage.</p>}

      {/* always: ask the collaborator */}
      <div className="rounded-xl border border-[#26262c] bg-black/20 p-2.5">
        <div className="text-[10px] uppercase tracking-wide text-bone-500">Ask {first}</div>
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={`e.g. "is the opening landing?", "what's missing in scene 2?"`} className="mt-1 min-h-[40px] w-full resize-y rounded-md border border-[#26262c] bg-black/30 px-2.5 py-1.5 text-[12px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none" />
        <div className="mt-1.5 flex justify-end">
          <button onClick={() => { if (ask.trim()) { setPendingKey("ask"); collab.mutate({ action: "ask", instruction: ask.trim() }); } }} disabled={busy || !ask.trim()} className="inline-flex items-center gap-1.5 rounded-md border border-[#26262c] px-2.5 py-1 text-[11.5px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">
            <MessageCircle className="h-3 w-3" /> Ask {first}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
          <div className="text-[10px] uppercase tracking-wide" style={gold}>{message.from ?? first} says</div>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-snug text-bone-100">{message.text}</p>
          <button onClick={() => { applyText(message.text.replace(/^\/\/.*$/m, "").trim(), "append"); setMessage(null); }} className="mt-2 inline-flex items-center gap-1 text-[11px]" style={gold}><ArrowRight className="h-3 w-3" /> Insert into draft</button>
        </div>
      )}

      {liveSeats.length > 0 && <LiveSeats seats={liveSeats} />}
    </div>
  );
}

function LiveSeats({ seats }: { seats: WritersRoomResponse["state"]["seats"] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wide text-bone-500">Live co-writers</div>
      {seats.map((s) => (
        <div key={s.seatId} className="flex items-center justify-between rounded-lg border border-[#26262c] bg-white/[0.015] px-3 py-2">
          <div><div className="text-[12.5px] text-bone-50">{s.name}</div><div className="text-[10.5px] text-bone-400">{s.roleLabel}{s.permission ? ` · ${s.permission}` : ""}</div></div>
          <span className="text-[10px] text-bone-500">{s.status}</span>
        </div>
      ))}
    </div>
  );
}

// ---- Outline ---------------------------------------------------------------

function OutlineTab({ room, onGoRoom }: { room: WritersRoomResponse; onGoRoom: () => void }) {
  const outline = room.state.writeFlow.outline;
  if (!outline || outline.beats.length === 0) {
    return (
      <div className="grid place-items-center gap-2 py-10 text-center">
        <ListOrdered className="h-6 w-6 text-bone-600" />
        <div className="text-[12.5px] text-bone-400">No outline yet.</div>
        <button onClick={onGoRoom} className="text-[11.5px]" style={gold}>Develop one in the Writers Room →</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-bone-400">Outline by <span style={gold}>{outline.collaborator?.name ?? "the studio"}</span> · {outline.beats.length} beats{outline.approved ? " · approved" : ""}</div>
      <ol className="space-y-1.5">
        {outline.beats.map((b, i) => (
          <li key={b.id} className="rounded-lg border border-[#26262c] bg-white/[0.015] p-2.5">
            <div className="text-[12.5px] text-bone-50"><span style={gold}>{i + 1}.</span> {b.heading}</div>
            <div className="mt-0.5 text-[11px] text-bone-400">{b.summary}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---- Review Bench (separate from writing collaborators) --------------------

function BenchTab({ projectId, room, hasText, ensureSaved, onDraftReplaced, onState }: { projectId: string; room: WritersRoomResponse; hasText: boolean; ensureSaved: () => Promise<void>; onDraftReplaced: (fountain: string) => void; onState: () => void }) {
  const approved = room.state.writeFlow.draftApproved;
  const runById = new Map(room.state.reviewBench.map((r) => [r.agentId, r]));
  const [actingId, setActingId] = useState<string | null>(null);
  // Per-agent proof of what apply did (before/after + whether it matched).
  const [applied, setApplied] = useState<Record<string, { before: string | null; after: string; matched: boolean; changed: boolean }>>({});
  const recordApply = (id: string, r: { before: string | null; after: string; matched: boolean; changed: boolean }) => setApplied((m) => ({ ...m, [id]: r }));
  const [auto, setAuto] = useState<Record<string, { status: string; rounds: number }>>({});

  const act = useMutation({
    mutationFn: async (v: { id: string; action: "run" | "skip"; }) => api.reviewAgentAction(projectId, v.id, v.action),
    onMutate: (v) => { setActingId(v.id); if (v.action === "run") setApplied((m) => { const n = { ...m }; delete n[v.id]; return n; }); },
    onSuccess: onState, onSettled: () => setActingId(null),
  });
  const rewrite = useMutation({
    mutationFn: (v: { id: string; notes?: string; regenerate?: boolean }) => api.reviewRewrite(projectId, v.id, v.notes, v.regenerate),
    onMutate: (v) => setActingId(v.id), onSuccess: onState, onSettled: () => setActingId(null),
  });
  // Apply mutates the DRAFT TEXT on the server; sync the editor + record proof.
  const apply = useMutation({
    mutationFn: async (v: { id: string }) => { await ensureSaved(); return api.applyReviewRewrite(projectId, v.id); },
    onMutate: (v) => setActingId(v.id),
    onSuccess: (r, v) => { if (r.changed) onDraftReplaced(r.fountain); recordApply(v.id, r); onState(); },
    onSettled: () => setActingId(null),
  });
  // One step: surgically edit the current fix per the notes, then apply it.
  const approveWithChanges = useMutation({
    mutationFn: async (v: { id: string; notes: string }) => {
      await ensureSaved();
      await api.reviewRewrite(projectId, v.id, v.notes); // targeted edit of the fix
      return api.applyReviewRewrite(projectId, v.id);
    },
    onMutate: (v) => setActingId(v.id),
    onSuccess: (r, v) => { if (r.changed) onDraftReplaced(r.fountain); recordApply(v.id, r); onState(); },
    onSettled: () => setActingId(null),
  });
  // Fix-and-check loop: run → apply → re-check until resolved or capped.
  const autoResolve = useMutation({
    mutationFn: async (v: { id: string }) => { await ensureSaved(); return api.autoResolveReview(projectId, v.id); },
    onMutate: (v) => { setActingId(v.id); setApplied((m) => { const n = { ...m }; delete n[v.id]; return n; }); },
    onSuccess: (r, v) => { if (r.changed) onDraftReplaced(r.fountain); setAuto((m) => ({ ...m, [v.id]: { status: r.status, rounds: r.rounds } })); onState(); },
    onSettled: () => setActingId(null),
  });

  if (!hasText) return <div className="py-8 text-center text-[12px] text-bone-400">Write or generate some pages first — the staff reviews real text.</div>;
  if (!approved) {
    return (
      <div className="grid place-items-center gap-2 py-8 text-center">
        <ClipboardCheck className="h-6 w-6" style={gold} />
        <div className="text-[12.5px] text-bone-100">Approve the draft to begin quality passes</div>
        <p className="max-w-[260px] text-[11px] text-bone-400">The Review Bench is the studio's script staff — they review and propose fixes once you approve the draft (top bar).</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-bone-400">Script staff review your pages and propose fixes. For any note: refine the fix with your own notes, then apply it into the draft.</div>
      {room.qualityStaff.map((agent) => {
        const run = runById.get(agent.id) ?? null;
        return (
          <BenchCard
            key={agent.id}
            agent={agent}
            run={run}
            busy={actingId === agent.id}
            appliedResult={applied[agent.id] ?? null}
            autoResult={auto[agent.id] ?? null}
            onAutoResolve={() => autoResolve.mutate({ id: agent.id })}
            onReview={() => { setAuto((m) => { const n = { ...m }; delete n[agent.id]; return n; }); act.mutate({ id: agent.id, action: "run" }); }}
            onSkip={() => act.mutate({ id: agent.id, action: "skip" })}
            onRewrite={(notes) => rewrite.mutate({ id: agent.id, notes })}
            onRegenerate={(notes) => rewrite.mutate({ id: agent.id, notes, regenerate: true })}
            onApprove={(notes) => approveWithChanges.mutate({ id: agent.id, notes })}
            onApply={() => apply.mutate({ id: agent.id })}
          />
        );
      })}
    </div>
  );
}

const AUTO_MSG: Record<string, { label: string; color: string }> = {
  resolved: { label: "clean — issue resolved", color: "#7fd1a4" },
  maxed: { label: "still finding issues after several rounds — fix manually below", color: "#d8b15a" },
  stuck: { label: "couldn't apply a fix automatically — regenerate or place manually", color: "#d8b15a" },
  needs_manual: { label: "this pass only advises — apply a fix manually", color: "#d8b15a" },
  no_draft: { label: "no draft to review", color: "#9a927e" },
};

function BenchCard({ agent, run, busy, appliedResult, autoResult, onAutoResolve, onReview, onSkip, onRewrite, onRegenerate, onApprove, onApply }: { agent: QualityAgent; run: ReviewRun | null; busy: boolean; appliedResult: { before: string | null; after: string; matched: boolean; changed: boolean } | null; autoResult: { status: string; rounds: number } | null; onAutoResolve: () => void; onReview: () => void; onSkip: () => void; onRewrite: (notes: string) => void; onRegenerate: (notes: string) => void; onApprove: (notes: string) => void; onApply: () => void }) {
  const [notes, setNotes] = useState("");
  const authority = run?.authority ?? reviewAuthorityOf(agent.rewriteAuthority);
  const f = run?.finding ?? null;
  const fix = f?.rewriteOption?.after?.trim() ? f.rewriteOption : null;
  const hasNotes = !!notes.trim();
  const first = agent.name.split(" ")[0];

  return (
    <div className="rounded-lg border border-[#26262c] bg-white/[0.015] p-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[12.5px] text-bone-50">{agent.name}</span>
        {run?.applied && <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: "#7fd1a4" }}><CheckCircle2 className="h-3 w-3" /> applied</span>}
        <span className="ml-auto rounded border border-[#26262c] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-bone-400">{REVIEW_AUTHORITY_LABELS[authority]}</span>
      </div>

      {/* Proof of what apply actually did to the draft text. */}
      {appliedResult && (
        appliedResult.changed ? (
          <div className="mt-1.5 rounded-md border border-[#7fd1a4]/30 bg-[#7fd1a4]/[0.05] p-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide" style={{ color: "#7fd1a4" }}><CheckCircle2 className="h-3 w-3" /> Applied change — draft updated</div>
            {appliedResult.before && <div className="mt-1"><span className="text-[9px] uppercase text-bone-500">Before</span><p className="whitespace-pre-wrap text-[10.5px] text-bone-500 line-through decoration-bone-700">{appliedResult.before}</p></div>}
            <div className="mt-1"><span className="text-[9px] uppercase text-bone-500">After</span><p className="whitespace-pre-wrap text-[11px] text-bone-50">{appliedResult.after}</p></div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-[10px] text-bone-500">{first} will re-check this passage on the next run.</span>
              <button onClick={onReview} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded border border-[#26262c] px-2 py-0.5 text-[10.5px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Re-check</button>
            </div>
          </div>
        ) : (
          <div className="mt-1.5 rounded-md border border-[#d8b15a]/40 bg-[#d8b15a]/[0.06] p-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide" style={gold}><AlertTriangle className="h-3 w-3" /> Couldn't apply automatically</div>
            <p className="mt-0.5 text-[10.5px] text-bone-300">The exact passage to replace wasn't found in the draft, so <span className="text-bone-100">nothing was changed</span>. Regenerate the fix, or copy it and place it yourself.</p>
            <button onClick={() => navigator.clipboard?.writeText(appliedResult.after)} className="mt-1 inline-flex items-center gap-1 rounded border border-[#26262c] px-2 py-0.5 text-[10.5px] text-bone-300 hover:border-bone-600"><Copy className="h-3 w-3" /> Copy fix</button>
          </div>
        )
      )}

      {/* Fix-and-check loop outcome */}
      {autoResult && (
        <div className="mt-1.5 rounded-md border p-2" style={{ borderColor: `${AUTO_MSG[autoResult.status]?.color ?? "#26262c"}55`, background: `${AUTO_MSG[autoResult.status]?.color ?? "#26262c"}14` }}>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide" style={{ color: AUTO_MSG[autoResult.status]?.color ?? "#9a927e" }}>
            {autoResult.status === "resolved" ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            Fix &amp; check · {autoResult.rounds} round{autoResult.rounds === 1 ? "" : "s"}
          </div>
          <p className="mt-0.5 text-[10.5px] text-bone-300">{first} ran the loop — {AUTO_MSG[autoResult.status]?.label ?? autoResult.status}.</p>
        </div>
      )}

      {!f ? (
        <p className="mt-1 text-[10.5px] text-bone-500">Not reviewed yet.</p>
      ) : f.resolved ? (
        <p className="mt-1.5 text-[11px]" style={{ color: "#7fd1a4" }}>✓ Clean on {first}'s dimension — no issues to fix.</p>
      ) : appliedResult?.changed ? null : (
        <div className="mt-1.5 space-y-1.5">
          <div className="rounded-md border border-[#26262c] bg-black/30 p-2">
            <div className="text-[9px] uppercase tracking-wide text-bone-500">What {agent.name.split(" ")[0]} found</div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-bone-100">{f.diagnosis}</p>
          </div>

          {fix && (
            <div className="rounded-md border border-[#d8b15a]/25 bg-[#d8b15a]/[0.05] p-2">
              <div className="text-[9px] uppercase tracking-wide" style={gold}>Proposed fix · {fix.targetLabel}</div>
              {fix.before && <p className="mt-0.5 whitespace-pre-wrap text-[10.5px] text-bone-500 line-through decoration-bone-700">{fix.before}</p>}
              <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-bone-50">{fix.after}</p>
            </div>
          )}

          {/* Targeted: notes change ONLY what you point at, not the whole fix. */}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={fix ? "Change just one thing about this fix… (e.g. 'keep her pen line', 'shorter')" : "How should this be fixed? Add notes (optional)…"}
            className="min-h-[36px] w-full resize-y rounded-md border border-[#26262c] bg-black/30 px-2 py-1.5 text-[11.5px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none"
          />
          <div className="flex flex-wrap gap-1.5">
            {hasNotes ? (
              <>
                <button onClick={() => onApprove(notes)} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Approve with changes
                </button>
                {fix && <button onClick={() => onRewrite(notes)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50"><Sparkles className="h-3 w-3" /> Preview change</button>}
                <button onClick={() => onRegenerate(notes)} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-300 hover:border-[#d8b15a]/45 disabled:opacity-50"><RefreshCw className="h-3 w-3" /> Regenerate with notes</button>
              </>
            ) : fix ? (
              <>
                <button onClick={onApply} disabled={busy} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowDownToLine className="h-3 w-3" />} Apply this fix
                </button>
                <button onClick={() => onRegenerate("")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-300 hover:border-[#d8b15a]/45 disabled:opacity-50"><RefreshCw className="h-3 w-3" /> Regenerate</button>
              </>
            ) : (
              <button onClick={() => onRewrite("")} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Write the fix
              </button>
            )}
          </div>
          {hasNotes && <p className="text-[10px] text-bone-600">Approve with changes = edit only what your note says. Regenerate with notes = a fresh take steered by your note.</p>}
        </div>
      )}

      <div className="mt-1.5 flex flex-wrap gap-1.5 border-t border-[#1c1c20] pt-1.5">
        <button onClick={onReview} disabled={busy} className="inline-flex items-center gap-1 rounded border border-[#26262c] px-2 py-0.5 text-[10.5px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {run ? "Review again" : "Review"}
        </button>
        {(authority === "rewrite" || authority === "rewrite_requires_approval") && (
          <button onClick={onAutoResolve} disabled={busy} className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10.5px] disabled:opacity-50" style={{ borderColor: `${GOLD}55`, color: GOLD }} title="Run, fix, and re-check until it's clean">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Fix until resolved
          </button>
        )}
        {run?.status !== "skipped" && <button onClick={onSkip} disabled={busy} className="inline-flex items-center gap-1 rounded border border-[#26262c] px-2 py-0.5 text-[10.5px] text-bone-400 hover:border-bone-600 disabled:opacity-50"><SkipForward className="h-3 w-3" /> Skip</button>}
      </div>
    </div>
  );
}

// ---- Notes -----------------------------------------------------------------

function NotesTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const notesQ = useQuery({ queryKey: ["room-notes", projectId, "writers"], queryFn: () => api.listRoomNotes(projectId, { room: "writers" }) });
  const notes = notesQ.data?.notes ?? [];
  const [text, setText] = useState("");
  const invalidate = () => qc.invalidateQueries({ queryKey: ["room-notes", projectId, "writers"] });
  const add = useMutation({ mutationFn: () => api.createRoomNote(projectId, { room: "writers", body: text.trim(), targetType: "script", visibility: "room" }), onSuccess: () => { setText(""); invalidate(); } });
  const patch = useMutation({ mutationFn: (v: { id: string; status: NoteStatus }) => api.updateRoomNote(projectId, v.id, { status: v.status }), onSuccess: invalidate });
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {notes.length === 0 ? <div className="py-8 text-center text-[12px] text-bone-500">No notes yet.</div>
          : notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-[#26262c] bg-white/[0.015] p-2.5">
              <p className="whitespace-pre-wrap text-[12px] text-bone-100">{n.body}</p>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-bone-500">{n.authorName ?? "—"} · {n.status}</span>
                {OPEN_NOTE_STATUSES.includes(n.status) && <button onClick={() => patch.mutate({ id: n.id, status: "resolved" })} className="text-[10.5px]" style={gold}>Resolve</button>}
              </div>
            </div>
          ))}
      </div>
      <div className="mt-2 border-t border-[#1c1c20] pt-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave a production note…" className="min-h-[44px] w-full resize-y rounded-md border border-[#26262c] bg-black/30 px-2.5 py-1.5 text-[12px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none" />
        <div className="mt-1.5 flex justify-end">
          <button onClick={() => text.trim() && add.mutate()} disabled={add.isPending || !text.trim()} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>Add note</button>
        </div>
      </div>
    </div>
  );
}

function ExportMenu({ scriptId }: { scriptId: string }) {
  const formats = ["pdf", "fdx", "fountain", "markdown"] as const;
  return (
    <details className="relative">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-[#26262c] px-2.5 py-1.5 text-[12px] text-bone-200 hover:border-[#d8b15a]/45"><Download className="h-3.5 w-3.5" /> Export</summary>
      <div className="absolute right-0 z-20 mt-2 w-40 rounded-lg border border-[#26262c] bg-[#0b0b0e] p-1 shadow-xl">
        {formats.map((f) => (
          <a key={f} href={api.exportScriptUrl(scriptId, f)} target="_blank" rel="noreferrer" className="block rounded px-2.5 py-1.5 text-[12px] text-bone-100 hover:bg-white/[0.05]">.{f}</a>
        ))}
      </div>
    </details>
  );
}
