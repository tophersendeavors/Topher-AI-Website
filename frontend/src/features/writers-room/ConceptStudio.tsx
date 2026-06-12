import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Wand2, Bot, Lightbulb, PencilLine, ArrowRight, ArrowLeft, Loader2, Check, RefreshCw, Sparkles } from "lucide-react";
import type { ConceptBrief, WritersRoomResponse } from "@toburt/shared";
import { api } from "@/lib/api";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

type Stage = "concept" | "team" | "outline" | "draft";
const STAGES: { key: Stage; label: string }[] = [
  { key: "concept", label: "Concept" },
  { key: "team", label: "Team" },
  { key: "outline", label: "Outline" },
  { key: "draft", label: "Draft" },
];

export function ConceptStudio({
  projectId, room, firstEmptySeat, onState, onOpenEditor, onWriteManually, onClose,
}: {
  projectId: string;
  room: WritersRoomResponse;
  firstEmptySeat: string;
  onState: (state: WritersRoomResponse["state"]) => void;
  onOpenEditor: (scriptId: string) => void;
  onWriteManually: () => void;
  onClose: () => void;
}) {
  const wf = room.state.writeFlow;
  const collabSeat = room.state.seats.find((s) => s.kind === "ai_creative" || s.kind === "ai_writer") ?? null;
  const creative = collabSeat?.kind === "ai_creative" ? room.creatives.find((c) => c.id === collabSeat.ref.id) ?? null : null;
  const collabName = wf.outline?.collaborator?.name ?? collabSeat?.name ?? null;
  const lens = creative ? creative.style : collabSeat?.kind === "ai_writer" ? "Project foundation + your Creative DNA" : null;

  const initial: Stage = !wf.concept ? "concept" : !collabSeat ? "team" : wf.outline?.approved ? "draft" : "outline";
  const [stage, setStage] = useState<Stage>(initial);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#d8b15a]/25 bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#26262c] px-6 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Writers Room · Develop the concept</div>
            <div className="font-apple text-xl text-bone-50">Concept Studio</div>
            <div className="mt-0.5 text-[11.5px] text-bone-400">{collabName ? `${collabName} develops your idea into an outline, then drafts it — you approve every step.` : "Bring an idea; the studio builds it into an outline, then a draft."}</div>
          </div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>

        {/* stepper */}
        <div className="flex items-center gap-1 border-b border-[#26262c] px-5 py-2.5">
          {STAGES.map((s, i) => {
            const active = s.key === stage;
            const done = STAGES.findIndex((x) => x.key === stage) > i;
            return (
              <div key={s.key} className="flex items-center gap-1">
                <button
                  onClick={() => (done || active) && setStage(s.key)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px]"
                  style={active ? { color: GOLD } : done ? { color: "#7fd1a4" } : { color: "#5f5a5e" }}
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full border text-[10px]" style={{ borderColor: active ? GOLD : done ? "#7fd1a4" : "#33333a", color: active ? GOLD : done ? "#7fd1a4" : "#6b6660" }}>
                    {done ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {s.label}
                </button>
                {i < STAGES.length - 1 && <span className="text-bone-700">·</span>}
              </div>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {stage === "concept" && (
            <ConceptStep projectId={projectId} initial={wf.concept} onSaved={(state) => { onState(state); setStage(collabSeat ? "outline" : "team"); }} />
          )}
          {stage === "team" && (
            <TeamStep
              projectId={projectId} room={room} firstEmptySeat={firstEmptySeat} collabName={collabName} lens={lens}
              onSeated={(state) => { onState(state); setStage("outline"); }}
              onWriteManually={onWriteManually}
              onBack={() => setStage("concept")}
            />
          )}
          {stage === "outline" && (
            <OutlineStep
              projectId={projectId} room={room} collabName={collabName} lens={lens} seatId={collabSeat?.seatId}
              onState={onState}
              onApproved={(state) => { onState(state); setStage("draft"); }}
              onBack={() => setStage(collabSeat ? "team" : "concept")}
            />
          )}
          {stage === "draft" && (
            <DraftStep projectId={projectId} collabName={collabName} drafted={wf.status === "drafted"} draftScriptId={wf.draftScriptId} onState={onState} onOpenEditor={onOpenEditor} onBack={() => setStage("outline")} />
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, area }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; area?: boolean }) {
  const cls = "w-full rounded-md border border-[#26262c] bg-black/30 px-3 py-2 text-[13px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none";
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wide text-bone-500">{label}</span>
      {area
        ? <textarea className={cls + " mt-1 min-h-[64px] resize-y"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        : <input className={cls + " mt-1"} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function ConceptStep({ projectId, initial, onSaved }: { projectId: string; initial: ConceptBrief | null; onSaved: (state: WritersRoomResponse["state"]) => void }) {
  const [c, setC] = useState<ConceptBrief>(initial ?? { title: "", format: "", genre: "", tone: "", logline: "", premise: "", targetLength: "" });
  const defaults = useMutation({ mutationFn: () => api.getWriteFlowDefaults(projectId), onSuccess: (r) => setC((prev) => ({ ...r.concept, ...stripEmpty(prev) })) });
  useEffect(() => { if (!initial) defaults.mutate(); }, []); // prefill from project once
  const save = useMutation({ mutationFn: () => api.saveWriteConcept(projectId, c), onSuccess: (r) => onSaved(r.state) });
  const set = (k: keyof ConceptBrief) => (v: string) => setC((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-bone-400">Confirm the concept. Prefilled from your project — edit anything. This is what your collaborator writes from.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" value={c.title} onChange={set("title")} placeholder="Working title" />
        <Field label="Format" value={c.format} onChange={set("format")} placeholder="series · feature · micro_drama" />
        <Field label="Genre" value={c.genre} onChange={set("genre")} placeholder="prestige drama, thriller" />
        <Field label="Tone" value={c.tone} onChange={set("tone")} placeholder="cold, precise, haunting" />
      </div>
      <Field label="Logline" value={c.logline} onChange={set("logline")} placeholder="One sentence: who wants what, and what's in the way." area />
      <Field label="Premise" value={c.premise} onChange={set("premise")} placeholder="A short paragraph on the world and the engine of the story." area />
      <Field label="Target length" value={c.targetLength} onChange={set("targetLength")} placeholder="e.g. 8 × 3-min episodes, or 100 pages" />
      {save.isError && <p className="text-[12px] text-red-300">{(save.error as Error).message}</p>}
      <div className="flex justify-end">
        <button onClick={() => save.mutate()} disabled={save.isPending || !c.title.trim()} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Save & continue
        </button>
      </div>
    </div>
  );
}
function stripEmpty(c: ConceptBrief): Partial<ConceptBrief> {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v && String(v).trim())) as Partial<ConceptBrief>;
}

function TeamStep({ projectId, room, firstEmptySeat, collabName, lens, onSeated, onWriteManually, onBack }: {
  projectId: string; room: WritersRoomResponse; firstEmptySeat: string; collabName: string | null; lens: string | null;
  onSeated: (state: WritersRoomResponse["state"]) => void; onWriteManually: () => void; onBack: () => void;
}) {
  const seat = useMutation({
    mutationFn: (body: Parameters<typeof api.assignWritersRoomSeat>[2]) => api.assignWritersRoomSeat(projectId, firstEmptySeat, body),
    onSuccess: (r) => onSeated(r.state),
  });
  if (collabName) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-[#d8b15a]/25 bg-[#d8b15a]/[0.05] p-4">
          <div className="flex items-center gap-2 text-[13px] text-bone-50"><Sparkles className="h-4 w-4" style={gold} /> {collabName} is on the table</div>
          {lens && <div className="mt-1 text-[11.5px] text-bone-300">Creative lens: {lens}</div>}
        </div>
        <div className="flex justify-between">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-bone-400 hover:text-bone-100"><ArrowLeft className="h-4 w-4" /> Concept</button>
          <button onClick={() => onSeated(room.state)} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black" style={{ background: GOLD }}><ArrowRight className="h-4 w-4" /> Continue to outline</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-bone-400">Who writes this with you? Seat an AI collaborator to develop the outline, or write it yourself.</p>
      <button onClick={() => seat.mutate({ kind: "ai_writer" })} disabled={seat.isPending} className="flex w-full items-center gap-3 rounded-xl border border-[#26262c] bg-white/[0.015] p-3 text-left hover:border-[#d8b15a]/45 disabled:opacity-60">
        <span className="grid h-9 w-9 place-items-center rounded-lg border" style={{ borderColor: `${GOLD}40`, color: GOLD }}><Bot className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1"><div className="text-[13px] text-bone-50">{room.aiWriter.name}</div><div className="text-[11px] text-bone-400">{room.aiWriter.description}</div></div>
      </button>
      <div className="text-[10px] uppercase tracking-wide text-bone-500">AI Creative — a specific lens</div>
      <div className="grid gap-2">
        {room.creatives.map((c) => (
          <button key={c.id} onClick={() => seat.mutate({ kind: "ai_creative", profileId: c.id })} disabled={seat.isPending} className="flex items-start gap-3 rounded-xl border border-[#26262c] bg-white/[0.015] p-2.5 text-left hover:border-[#d8b15a]/45 disabled:opacity-60">
            <span className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg border" style={{ borderColor: `${GOLD}40`, color: GOLD }}><Wand2 className="h-3.5 w-3.5" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2"><span className="text-[13px] text-bone-50">{c.name}</span><span className="text-[10.5px]" style={gold}>{c.role}</span></div>
              <div className="truncate text-[11px] text-bone-400">{c.style}</div>
            </div>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-bone-400 hover:text-bone-100"><ArrowLeft className="h-4 w-4" /> Concept</button>
        <button onClick={onWriteManually} className="inline-flex items-center gap-1.5 rounded-lg border border-[#26262c] px-3 py-2 text-[12px] text-bone-300 hover:border-bone-600"><PencilLine className="h-3.5 w-3.5" /> Write manually instead</button>
      </div>
    </div>
  );
}

function OutlineStep({ projectId, room, collabName, lens, seatId, onState, onApproved, onBack }: {
  projectId: string; room: WritersRoomResponse; collabName: string | null; lens: string | null; seatId?: string;
  onState: (state: WritersRoomResponse["state"]) => void; onApproved: (state: WritersRoomResponse["state"]) => void; onBack: () => void;
}) {
  const outline = room.state.writeFlow.outline;
  const gen = useMutation({ mutationFn: () => api.generateWriteOutline(projectId, seatId), onSuccess: (r) => onState(r.state) });
  const approve = useMutation({ mutationFn: () => api.approveWriteOutline(projectId), onSuccess: (r) => onApproved(r.state) });

  if (gen.isPending) {
    return <div className="grid place-items-center gap-3 py-12 text-center"><Loader2 className="h-6 w-6 animate-spin" style={gold} /><div className="text-[13px] text-bone-200">{collabName ?? "The studio"} is preparing an outline…</div>{lens && <div className="text-[11px] text-bone-500">through the lens: {lens}</div>}</div>;
  }
  if (!outline) {
    return (
      <div className="grid place-items-center gap-3 py-10 text-center">
        <Lightbulb className="h-7 w-7" style={gold} />
        <div className="font-apple text-[16px] text-bone-100">Develop this into a beat outline</div>
        {lens && <div className="max-w-md text-[11.5px] text-bone-400">{collabName}'s lens: {lens}</div>}
        {gen.isError && <p className="text-[12px] text-red-300">{(gen.error as Error).message}</p>}
        <button onClick={() => gen.mutate()} className="mt-1 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black" style={{ background: GOLD }}><Wand2 className="h-4 w-4" /> Generate outline with {collabName ?? "AI"}</button>
        <button onClick={onBack} className="text-[12px] text-bone-500 hover:text-bone-300">Back</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-bone-400">Outline by <span style={gold}>{outline.collaborator?.name ?? collabName}</span> · {outline.beats.length} beats. Review, then approve to draft.</div>
        <button onClick={() => gen.mutate()} disabled={gen.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-[#26262c] px-2.5 py-1 text-[11px] text-bone-300 hover:border-[#d8b15a]/45"><RefreshCw className="h-3 w-3" /> Regenerate</button>
      </div>
      <ol className="space-y-2">
        {outline.beats.map((b, i) => (
          <li key={b.id} className="rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
            <div className="text-[13px] text-bone-50"><span style={gold}>{i + 1}.</span> {b.heading}</div>
            <div className="mt-0.5 text-[11.5px] text-bone-300">{b.summary}</div>
          </li>
        ))}
      </ol>
      {approve.isError && <p className="text-[12px] text-red-300">{(approve.error as Error).message}</p>}
      <div className="flex items-center justify-between pt-1">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[12px] text-bone-400 hover:text-bone-100"><ArrowLeft className="h-4 w-4" /> Back</button>
        <button onClick={() => approve.mutate()} disabled={approve.isPending} className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50" style={{ background: GOLD }}>
          {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve outline & continue
        </button>
      </div>
    </div>
  );
}

function DraftStep({ projectId, collabName, drafted, draftScriptId, onState, onOpenEditor, onBack }: {
  projectId: string; collabName: string | null; drafted: boolean; draftScriptId: string | null;
  onState: (state: WritersRoomResponse["state"]) => void; onOpenEditor: (scriptId: string) => void; onBack: () => void;
}) {
  const gen = useMutation({ mutationFn: () => api.generateWriteDraft(projectId), onSuccess: (r) => { onState(r.state); onOpenEditor(r.scriptId); } });
  if (gen.isPending) {
    return <div className="grid place-items-center gap-3 py-12 text-center"><Loader2 className="h-6 w-6 animate-spin" style={gold} /><div className="text-[13px] text-bone-200">{collabName ?? "The studio"} is writing the first draft from your approved outline…</div><div className="text-[11px] text-bone-500">This can take a moment.</div></div>;
  }
  if (drafted && draftScriptId) {
    return (
      <div className="grid place-items-center gap-3 py-10 text-center">
        <Check className="h-7 w-7" style={{ color: "#7fd1a4" }} />
        <div className="font-apple text-[16px] text-bone-100">First draft is ready</div>
        <p className="max-w-md text-[11.5px] text-bone-400">{collabName} drafted from your approved outline. Open it in the editor to keep writing, then run the Review Bench to refine.</p>
        <button onClick={() => onOpenEditor(draftScriptId)} className="mt-1 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black" style={{ background: GOLD }}><ArrowRight className="h-4 w-4" /> Open in editor</button>
        <button onClick={() => gen.mutate()} className="text-[12px] text-bone-500 hover:text-bone-300">Regenerate draft</button>
      </div>
    );
  }
  return (
    <div className="grid place-items-center gap-3 py-10 text-center">
      <PencilLine className="h-7 w-7" style={gold} />
      <div className="font-apple text-[16px] text-bone-100">Draft from the approved outline</div>
      <p className="max-w-md text-[11.5px] text-bone-400">{collabName} writes the first draft in screenplay format, covering every approved beat. You can keep writing manually after.</p>
      {gen.isError && <p className="text-[12px] text-red-300">{(gen.error as Error).message}</p>}
      <button onClick={() => gen.mutate()} className="mt-1 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black" style={{ background: GOLD }}><Wand2 className="h-4 w-4" /> Generate first draft with {collabName ?? "AI"}</button>
      <button onClick={onBack} className="text-[12px] text-bone-500 hover:text-bone-300">Back to outline</button>
    </div>
  );
}
