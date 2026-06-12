import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Save, Download, Loader2, Wand2, PencilLine, MessageCircle,
  Sparkles, ClipboardCheck, StickyNote, ListOrdered, Users, Check, ArrowRight,
  CheckCircle2, Play, SkipForward,
} from "lucide-react";
import type { CollabAction, NoteStatus, QualityAgent, ReviewRun, WritersRoomResponse } from "@toburt/shared";
import { reviewAuthorityOf, REVIEW_AUTHORITY_LABELS, OPEN_NOTE_STATUSES } from "@toburt/shared";
import { api } from "@/lib/api";
import { markProjectOpened } from "@/lib/recentProjects";
import { FOUNTAIN_LANG_ID, FOUNTAIN_THEME, fountainLanguageDef } from "./fountain";

const GOLD = "#d8b15a";
const gold = { color: GOLD };
type Tab = "team" | "outline" | "bench" | "notes";

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
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  useEffect(() => { markProjectOpened(projectId); }, [projectId]);
  useEffect(() => { if (scriptQ.data) { setBody(scriptQ.data.fountain ?? ""); setDirty(false); } }, [scriptQ.data?.id]);

  const save = useMutation({
    mutationFn: () => api.updateScript(scriptId, { fountain: body }),
    onSuccess: () => { setDirty(false); qc.invalidateQueries({ queryKey: ["script", scriptId] }); },
  });

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    if (!monaco.languages.getLanguages().some((l) => l.id === FOUNTAIN_LANG_ID)) {
      monaco.languages.register({ id: FOUNTAIN_LANG_ID });
      monaco.languages.setMonarchTokensProvider(FOUNTAIN_LANG_ID, fountainLanguageDef());
    }
    monaco.editor.defineTheme("toburt", FOUNTAIN_THEME);
    monaco.editor.setTheme("toburt");
  };

  const getSelection = (): string => {
    const ed = editorRef.current;
    if (!ed) return "";
    const sel = ed.getSelection();
    return sel ? ed.getModel()?.getValueInRange(sel) ?? "" : "";
  };
  const applyResult = (r: { text: string; mode: "append" | "replace" | "message" }) => {
    if (r.mode === "append") { setBody((b) => `${b.trimEnd()}\n\n${r.text}\n`); setDirty(true); }
    else if (r.mode === "replace") {
      const ed = editorRef.current; const sel = ed?.getSelection();
      if (ed && sel) { ed.executeEdits("collab", [{ range: sel, text: r.text }]); setBody(ed.getValue()); setDirty(true); }
      else { setBody((b) => `${b.trimEnd()}\n\n${r.text}\n`); setDirty(true); }
    }
  };

  const room = roomQ.data;
  const title = scriptQ.data?.title ?? projectQ.data?.title ?? "—";

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
              <span className="ml-2 text-bone-600">Objective · approved draft</span>
              <span className="text-bone-700">·</span><span className="text-bone-600">Next · Review &amp; Lock</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ApproveDraftButton projectId={projectId} approved={room?.state.writeFlow.draftApproved ?? false} hasText={!!body.trim()} onState={() => qc.invalidateQueries({ queryKey: ["writers-room", projectId] })} />
          <ExportMenu scriptId={scriptId} />
          <button onClick={() => save.mutate()} disabled={!dirty || save.isPending} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} {dirty ? "Save Draft" : "Saved"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left: minimal — draft versions */}
        <aside className="hidden w-[200px] shrink-0 flex-col border-r border-[#1c1c20] p-3 md:flex">
          <div className="text-[10px] uppercase tracking-wide text-bone-500">Draft versions</div>
          <div className="mt-2 space-y-1">
            {(draftsQ.data ?? []).map((d) => (
              <Link key={d.id} to={`/projects/${projectId}/drafts/${d.id}/editor`} className="block truncate rounded-md px-2 py-1.5 text-[12px]" style={d.id === scriptId ? { background: "rgba(216,177,90,0.1)", color: GOLD } : { color: "#9a927e" }}>
                Draft {d.draft_number}{d.current ? " · current" : ""}
              </Link>
            ))}
          </div>
          <div className="mt-auto text-[10.5px] text-bone-600">{title}{dirty ? " · unsaved" : ""}</div>
        </aside>

        {/* center: the script paper */}
        <main className="min-w-0 flex-1 overflow-hidden p-3" style={{ background: "radial-gradient(120% 80% at 50% 0%, rgba(216,177,90,0.04), transparent 50%)" }}>
          <div className="mx-auto h-full max-w-3xl overflow-hidden rounded-xl border border-[#26262c]" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
            <Editor
              language={FOUNTAIN_LANG_ID}
              theme="toburt"
              value={body}
              onMount={onMount}
              onChange={(v) => { setBody(v ?? ""); setDirty(true); }}
              options={{
                fontFamily: '"Courier Prime","Courier New",Courier,monospace',
                fontSize: 15, lineNumbers: "off", glyphMargin: false, folding: false,
                lineDecorationsWidth: 0, lineNumbersMinChars: 0,
                minimap: { enabled: false }, renderLineHighlight: "none", wordWrap: "on",
                padding: { top: 36, bottom: 120 }, scrollBeyondLastLine: true, smoothScrolling: true,
                overviewRulerLanes: 0, scrollbar: { verticalScrollbarSize: 8, horizontal: "hidden" },
              }}
            />
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
              : tab === "team" ? <TeamTab projectId={projectId} room={room} getSelection={getSelection} onApply={applyResult} />
              : tab === "outline" ? <OutlineTab room={room} onGoRoom={() => navigate(`/projects/${projectId}/writers-room`)} />
              : tab === "bench" ? <BenchTab projectId={projectId} room={room} hasText={!!body.trim()} onState={() => qc.invalidateQueries({ queryKey: ["writers-room", projectId] })} />
              : <NotesTab projectId={projectId} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ApproveDraftButton({ projectId, approved, hasText, onState }: { projectId: string; approved: boolean; hasText: boolean; onState: () => void }) {
  const m = useMutation({ mutationFn: () => api.approveWriteDraft(projectId, !approved), onSuccess: onState });
  return (
    <button onClick={() => m.mutate()} disabled={m.isPending || (!hasText && !approved)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-50"
      style={approved ? { borderColor: "#7fd1a4", color: "#7fd1a4" } : { borderColor: "#26262c", color: GOLD }}>
      {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {approved ? "Draft approved" : "Approve Draft"}
    </button>
  );
}

// ---- Writing Team ----------------------------------------------------------

function TeamTab({ projectId, room, getSelection, onApply }: { projectId: string; room: WritersRoomResponse; getSelection: () => string; onApply: (r: { text: string; mode: "append" | "replace" | "message" }) => void }) {
  const seats = room.state.seats;
  const aiSeat = seats.find((s) => s.kind === "ai_creative" || s.kind === "ai_writer") ?? null;
  const creative = aiSeat?.kind === "ai_creative" ? room.creatives.find((c) => c.id === aiSeat.ref.id) ?? null : null;
  const liveSeats = seats.filter((s) => s.kind === "live_person");
  const name = aiSeat?.name ?? null;
  const first = name?.split(" ")[0] ?? "AI";

  const [message, setMessage] = useState<{ from: string | null; text: string } | null>(null);
  const [ask, setAsk] = useState("");
  const run = useMutation({
    mutationFn: (v: { action: CollabAction; instruction?: string }) => api.collaborate(projectId, { action: v.action, selection: getSelection() || undefined, instruction: v.instruction }),
    onSuccess: (r) => { if (r.mode === "message") setMessage({ from: r.collaborator, text: r.text }); else onApply(r); },
  });

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

  const actions: { action: CollabAction; label: string; Icon: typeof Wand2 }[] = aiSeat.kind === "ai_creative"
    ? [
        { action: "next_scene", label: `Draft next scene with ${first}`, Icon: Wand2 },
        { action: "continue", label: `Continue scene with ${first}`, Icon: PencilLine },
        { action: "rewrite", label: `Rewrite selected with ${first}`, Icon: Sparkles },
        { action: "subtext", label: "Strengthen subtext", Icon: Sparkles },
        { action: "alt_beat", label: "Suggest an alternate beat", Icon: Sparkles },
      ]
    : [
        { action: "next_scene", label: "Draft next scene", Icon: Wand2 },
        { action: "continue", label: "Continue draft", Icon: PencilLine },
        { action: "rewrite", label: "Rewrite selected passage", Icon: Sparkles },
      ];

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#d8b15a]/25 bg-[#d8b15a]/[0.05] p-3.5">
        <div className="flex items-center gap-2 text-[13.5px] text-bone-50"><Sparkles className="h-4 w-4" style={gold} /> {name}</div>
        <div className="text-[11px]" style={gold}>{aiSeat.kind === "ai_creative" ? `AI Creative · ${creative?.role ?? "Creative lens"}` : "Studio AI Writer · automated draft support"}</div>
        {creative && <div className="mt-1 text-[11px] text-bone-300">Current lens: {creative.style}</div>}
      </div>

      <div className="space-y-1.5">
        {actions.map((a) => (
          <button key={a.action} onClick={() => run.mutate({ action: a.action })} disabled={run.isPending} className="flex w-full items-center gap-2 rounded-lg border border-[#26262c] bg-white/[0.015] px-3 py-2 text-left text-[12.5px] text-bone-100 hover:border-[#d8b15a]/45 disabled:opacity-50">
            {run.isPending && run.variables?.action === a.action ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={gold} /> : <a.Icon className="h-3.5 w-3.5" style={gold} />} {a.label}
          </button>
        ))}
      </div>
      <p className="text-[10.5px] text-bone-600">Tip: select text in the script to rewrite just that passage.</p>

      {/* ask the collaborator */}
      <div className="rounded-xl border border-[#26262c] bg-black/20 p-2.5">
        <div className="text-[10px] uppercase tracking-wide text-bone-500">Ask {first}</div>
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={`e.g. "is the opening landing?", "what's missing in scene 2?"`} className="mt-1 min-h-[44px] w-full resize-y rounded-md border border-[#26262c] bg-black/30 px-2.5 py-1.5 text-[12px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none" />
        <div className="mt-1.5 flex justify-end">
          <button onClick={() => { if (ask.trim()) run.mutate({ action: "ask", instruction: ask.trim() }); }} disabled={run.isPending || !ask.trim()} className="inline-flex items-center gap-1.5 rounded-md border border-[#26262c] px-2.5 py-1 text-[11.5px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">
            <MessageCircle className="h-3 w-3" /> Ask {first}
          </button>
        </div>
      </div>

      {message && (
        <div className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
          <div className="text-[10px] uppercase tracking-wide" style={gold}>{message.from ?? first} says</div>
          <p className="mt-1 whitespace-pre-wrap text-[12px] leading-snug text-bone-100">{message.text}</p>
          <button onClick={() => onApply({ text: message.text.replace(/^\/\/.*$/m, "").trim(), mode: "append" })} className="mt-2 inline-flex items-center gap-1 text-[11px]" style={gold}><ArrowRight className="h-3 w-3" /> Insert into draft</button>
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

function BenchTab({ projectId, room, hasText, onState }: { projectId: string; room: WritersRoomResponse; hasText: boolean; onState: () => void }) {
  const approved = room.state.writeFlow.draftApproved;
  const runById = new Map(room.state.reviewBench.map((r) => [r.agentId, r]));
  const [acting, setActing] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (v: { id: string; action: "run" | "skip" | "apply" }) => api.reviewAgentAction(projectId, v.id, v.action),
    onMutate: (v) => setActing(v.id),
    onSuccess: onState,
    onSettled: () => setActing(null),
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
      <div className="text-[11px] text-bone-400">Script staff — they review and propose rewrites. You approve before anything is applied.</div>
      {room.qualityStaff.map((agent) => (
        <BenchCard key={agent.id} agent={agent} run={runById.get(agent.id) ?? null} busy={acting === agent.id} onAction={(action) => act.mutate({ id: agent.id, action })} />
      ))}
    </div>
  );
}

function BenchCard({ agent, run, busy, onAction }: { agent: QualityAgent; run: ReviewRun | null; busy: boolean; onAction: (a: "run" | "skip" | "apply") => void }) {
  const authority = run?.authority ?? reviewAuthorityOf(agent.rewriteAuthority);
  const f = run?.finding ?? null;
  return (
    <div className="rounded-lg border border-[#26262c] bg-white/[0.015] p-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-[12.5px] text-bone-50">{agent.name}</span>
        <span className="ml-auto rounded border border-[#26262c] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-bone-400">{REVIEW_AUTHORITY_LABELS[authority]}</span>
      </div>
      {f && (
        <div className="mt-1.5 rounded-md border border-[#26262c] bg-black/30 p-2">
          <p className="text-[11.5px] leading-snug text-bone-100">{f.diagnosis}</p>
          {f.rewriteOption && (
            <div className="mt-1.5 rounded border border-[#d8b15a]/25 bg-[#d8b15a]/[0.05] p-1.5">
              <div className="text-[9px] uppercase tracking-wide" style={gold}>Rewrite · {f.rewriteOption.targetLabel}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-bone-50">{f.rewriteOption.after}</p>
              {run?.applied ? <span className="mt-1 inline-flex items-center gap-1 text-[10.5px]" style={{ color: "#7fd1a4" }}><CheckCircle2 className="h-3 w-3" /> Applied</span>
                : <button onClick={() => onAction("apply")} disabled={busy} className="mt-1 inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10.5px] font-medium text-black" style={{ background: GOLD }}><Check className="h-3 w-3" /> Approve &amp; apply</button>}
            </div>
          )}
        </div>
      )}
      <div className="mt-1.5 flex gap-1.5">
        <button onClick={() => onAction("run")} disabled={busy} className="inline-flex items-center gap-1 rounded border border-[#26262c] px-2 py-0.5 text-[10.5px] text-bone-200 hover:border-[#d8b15a]/45 disabled:opacity-50">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} {run ? "Review again" : "Review"}
        </button>
        {run?.status !== "skipped" && <button onClick={() => onAction("skip")} disabled={busy} className="inline-flex items-center gap-1 rounded border border-[#26262c] px-2 py-0.5 text-[10.5px] text-bone-400 hover:border-bone-600 disabled:opacity-50"><SkipForward className="h-3 w-3" /> Skip</button>}
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
