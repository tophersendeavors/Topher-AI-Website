import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft, Plus, X, PenLine, Wand2, UserPlus, ArrowRight, Loader2,
  ClipboardCheck, Crosshair,
} from "lucide-react";
import type {
  AiCreativeProfile,
  AiWriterProfile,
  LivePermission,
  QualityAgent,
  SeatKind,
  TalentProfile,
  WritersRoomResponse,
  WritersRoomSeat,
} from "@toburt/shared";
import { LIVE_PERMISSION_LABELS, LIVE_PERMISSIONS, TALENT_CATEGORY_LABELS, TALENT_INVITE_LABELS } from "@toburt/shared";
import { api } from "@/lib/api";

const GOLD = "#d8b15a";
const gold = { color: GOLD };

// Natural size of writers-room.jpg — the stage locks to this ratio so seat
// percentages map to fixed points on the plate regardless of window size.
const PLATE_W = 2200;
const PLATE_H = 1242;

// Chair positions over /studio/rooms/writers-room.jpg, as % of the frame.
// HEAD = the lit executive chair at the far end (the lead writer).
// SEATS = the six dark chairs down the two long sides of the table.
// Tune these live with the debug overlay (Crosshair button, bottom-right).
const HEAD = { top: "53%", left: "50%" };
const SEATS: Array<{ seatId: string; top: string; left: string }> = [
  // Image-space %, anchored to the plate (stage-locked). Paired rows share a
  // top so each side aligns: 1/2, 3/4, 5/6 — equal 8.5% spacing down the table.
  { seatId: "seat-1", top: "56.5%", left: "29.1%" }, // left, nearest head
  { seatId: "seat-2", top: "56.5%", left: "72.2%" }, // right, nearest head
  { seatId: "seat-3", top: "65%", left: "25.1%" },   // left, middle
  { seatId: "seat-4", top: "65%", left: "75.6%" },   // right, middle
  { seatId: "seat-5", top: "73.5%", left: "20.6%" }, // left, near
  { seatId: "seat-6", top: "73.5%", left: "80.7%" }, // right, near
];

export function WritersRoomPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();
  const projectQ = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const roomQ = useQuery({ queryKey: ["writers-room", projectId], queryFn: () => api.getWritersRoom(projectId) });
  const [assigning, setAssigning] = useState<string | null>(null);
  const [bench, setBench] = useState(false);
  const [debug, setDebug] = useState(typeof window !== "undefined" && window.location.search.includes("debug"));
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const seed = (state: WritersRoomResponse["state"]) =>
    qc.setQueryData(["writers-room", projectId], (prev: WritersRoomResponse | undefined) =>
      prev ? { ...prev, state } : prev
    );
  const clearSeat = useMutation({
    mutationFn: (seatId: string) => api.clearWritersRoomSeat(projectId, seatId),
    onSuccess: (r) => seed(r.state),
  });

  const room = roomQ.data;
  const seatById = new Map((room?.state.seats ?? []).map((s) => [s.seatId, s]));

  const onRoomClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!debug) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = +(((e.clientX - r.left) / r.width) * 100).toFixed(1);
    const y = +(((e.clientY - r.top) / r.height) * 100).toFixed(1);
    setCursor({ x, y });
    // eslint-disable-next-line no-console
    console.log(`[writers-room seat] left: "${x}%", top: "${y}%"`);
  };

  return (
    <div className="relative h-screen w-full overflow-hidden bg-black">
      {/* Aspect-locked stage: covers the viewport but keeps the plate's ratio,
          so seat percentages always map to the SAME point on the image no
          matter the window size (object-cover on the bare viewport would crop
          and drift the seats off the chairs). Head + seats live in here. */}
      <div
        onClick={onRoomClick}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: `max(100vw, calc(100vh * ${PLATE_W} / ${PLATE_H}))`,
          height: `max(100vh, calc(100vw * ${PLATE_H} / ${PLATE_W}))`,
        }}
      >
        <img src="/studio/rooms/writers-room.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 50% 30%, transparent 40%, rgba(0,0,0,0.55))" }} />

        {/* head seat — the lead writer */}
        <HeadSeat head={room?.head ?? null} />

        {/* assignable co-writer seats */}
        {SEATS.map((slot) => (
          <ChairMarker
            key={slot.seatId}
            slot={slot}
            seat={seatById.get(slot.seatId) ?? null}
            debug={debug}
            onAssign={() => setAssigning(slot.seatId)}
            onClear={() => clearSeat.mutate(slot.seatId)}
            clearing={clearSeat.isPending}
          />
        ))}
      </div>

      {/* breadcrumb / exit */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-5">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-black/35 px-3 py-1.5 backdrop-blur-sm">
          <Link to="/studio/projects" className="text-bone-300 hover:text-bone-100"><ChevronLeft className="h-4 w-4" /></Link>
          <div className="leading-tight">
            <div className="text-[9px] uppercase tracking-[0.28em]" style={gold}>Writers Room</div>
            <div className="text-[12.5px] text-bone-50">{projectQ.data?.title ?? "—"}</div>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setBench(true); }}
            className="flex items-center gap-1.5 rounded-lg border border-[#26262c] bg-black/40 px-3 py-1.5 text-[11.5px] text-bone-200 backdrop-blur-sm hover:border-[#d8b15a]/45"
          >
            <ClipboardCheck className="h-3.5 w-3.5" style={gold} /> Review Bench
          </button>
        </div>
      </div>

      {/* objective strip */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-5">
        <div className="pointer-events-auto flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-[#26262c] bg-black/45 px-5 py-2.5 text-[11.5px] backdrop-blur-md">
          <span><span className="text-bone-500">Current Room · </span><span style={gold}>Writers Room</span></span>
          <span className="text-bone-300"><span className="text-bone-500">Objective · </span>Reach a final approved draft</span>
          <span className="inline-flex items-center gap-1 text-bone-300"><span className="text-bone-500">Next ·</span> Creative Room <ArrowRight className="h-3 w-3" style={gold} /></span>
        </div>
      </div>

      {/* debug toggle + HUD */}
      <button
        onClick={(e) => { e.stopPropagation(); setDebug((d) => !d); }}
        className="absolute bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] backdrop-blur-sm"
        style={debug ? { borderColor: GOLD, color: GOLD, background: "rgba(0,0,0,0.5)" } : { borderColor: "#26262c", color: "#9a927e", background: "rgba(0,0,0,0.4)" }}
        title="Toggle seat-tuning overlay"
      >
        <Crosshair className="h-3.5 w-3.5" /> Seats
      </button>
      {debug && (
        <div className="pointer-events-none absolute bottom-16 right-5 z-40 rounded-lg border border-[#d8b15a]/40 bg-black/70 px-3 py-2 font-mono text-[11px] text-bone-200 backdrop-blur-sm">
          <div style={gold}>SEAT TUNING — click a chair to read its %</div>
          <div>head left: {HEAD.left} top: {HEAD.top}</div>
          {cursor && <div className="mt-1 text-bone-50">clicked → left: "{cursor.x}%", top: "{cursor.y}%"</div>}
          <div className="mt-1 text-bone-500">value also copied to console on click</div>
        </div>
      )}

      {/* assign modal — writing team only */}
      {assigning && room && (
        <AssignModal
          seatId={assigning}
          aiWriter={room.aiWriter}
          creatives={room.creatives}
          talent={room.talent}
          projectId={projectId}
          onClose={() => setAssigning(null)}
          onAssigned={(state) => { seed(state); setAssigning(null); }}
        />
      )}

      {/* review bench drawer — quality staff, NOT table writers */}
      {bench && room && <ReviewBench staff={room.qualityStaff} onClose={() => setBench(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function HeadSeat({ head }: { head: WritersRoomResponse["head"] }) {
  return (
    <div className="absolute z-20 -translate-x-1/2 -translate-y-1/2 text-center" style={HEAD}>
      <Avatar name={head?.name ?? "You"} url={head?.avatarUrl ?? null} size={56} ring />
      <div className="mt-1 rounded-md bg-black/45 px-2 py-1 backdrop-blur-sm">
        <div className="text-[12px] font-medium text-bone-50">{head?.name ?? "You"}</div>
        <div className="text-[9px] uppercase tracking-wide" style={gold}>{head?.roleLabel ?? "Lead Writer"}</div>
      </div>
    </div>
  );
}

function ChairMarker({
  slot, seat, debug, onAssign, onClear, clearing,
}: {
  slot: { seatId: string; top: string; left: string };
  seat: WritersRoomSeat | null;
  debug: boolean;
  onAssign: () => void;
  onClear: () => void;
  clearing: boolean;
}) {
  const debugBadge = debug && (
    <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1 font-mono text-[9px]" style={gold}>
      {slot.seatId} · {slot.left},{slot.top}
    </span>
  );

  if (!seat) {
    // The icon is centered exactly on the chair coordinate; the label floats
    // below without shifting the icon off-center.
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onAssign(); }}
        className="group absolute z-20 -translate-x-1/2 -translate-y-1/2"
        style={{ top: slot.top, left: slot.left }}
      >
        {debugBadge}
        <span className="grid h-14 w-14 place-items-center rounded-full border-2 border-dashed transition-all group-hover:scale-110" style={{ borderColor: `${GOLD}99`, color: GOLD, boxShadow: `0 0 22px ${GOLD}66` }}>
          <Plus className="h-7 w-7" />
        </span>
        <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/55 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-bone-300 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          Add co-writer
        </span>
      </button>
    );
  }
  // Filled: avatar centered on the chair, name card floats below.
  return (
    <div className="group absolute z-20 -translate-x-1/2 -translate-y-1/2" style={{ top: slot.top, left: slot.left }}>
      {debugBadge}
      <div className="relative">
        <Avatar name={seat.name} url={seat.avatarUrl} size={56} ring />
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          disabled={clearing}
          className="absolute -right-1.5 -top-1.5 hidden rounded-full border border-white/20 bg-black/70 p-0.5 text-bone-300 hover:text-red-300 group-hover:block"
          title="Remove from seat"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="absolute left-1/2 top-full mt-1 min-w-[120px] -translate-x-1/2 rounded-md bg-black/55 px-2 py-1 text-center backdrop-blur-sm">
        <div className="truncate text-[11.5px] font-medium text-bone-50">{seat.name}</div>
        <div className="truncate text-[9px] uppercase tracking-wide" style={gold}>{seat.roleLabel}</div>
        <div className="truncate text-[9px] text-bone-400">{seat.status}</div>
      </div>
    </div>
  );
}

function Avatar({ name, url, size, ring }: { name: string; url: string | null; size: number; ring?: boolean }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, borderColor: `${GOLD}88` } as React.CSSProperties;
  if (url && !failed) {
    return <img src={url} alt="" onError={() => setFailed(true)} className={"rounded-full border-2 object-cover " + (ring ? "shadow-[0_0_22px_rgba(216,177,90,0.4)]" : "")} style={style} />;
  }
  return (
    <div className={"grid place-items-center rounded-full border-2 font-apple " + (ring ? "shadow-[0_0_22px_rgba(216,177,90,0.4)]" : "")} style={{ ...style, color: GOLD, background: "rgba(0,0,0,0.55)", fontSize: size * 0.4 }}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign modal — the WRITING TEAM only (AI Writer · AI Creative · Live Co-Writer).
// Quality/checks agents are NOT here; they live on the Review Bench.

function AssignModal({
  seatId, aiWriter, creatives, talent, projectId, onClose, onAssigned,
}: {
  seatId: string;
  aiWriter: AiWriterProfile;
  creatives: AiCreativeProfile[];
  talent: TalentProfile[];
  projectId: string;
  onClose: () => void;
  onAssigned: (state: WritersRoomResponse["state"]) => void;
}) {
  const [tab, setTab] = useState<SeatKind>("ai_writer");
  const assign = useMutation({
    mutationFn: (body: Parameters<typeof api.assignWritersRoomSeat>[2]) =>
      api.assignWritersRoomSeat(projectId, seatId, body),
    onSuccess: (r) => onAssigned(r.state),
  });

  const TABS: Array<{ k: SeatKind; label: string; Icon: typeof PenLine }> = [
    { k: "ai_writer", label: "AI Writer", Icon: PenLine },
    { k: "ai_creative", label: "AI Creative", Icon: Wand2 },
    { k: "live_person", label: "Live Co-Writer", Icon: UserPlus },
  ];
  const prompt =
    tab === "ai_writer" ? "Let the studio write with you."
    : tab === "ai_creative" ? "Choose a creative writing lens."
    : "Invite or select a writer.";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#d8b15a]/25 bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#26262c] px-5 py-3.5">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Writing Team</div>
            <div className="font-apple text-lg text-bone-50">Who is writing with you?</div>
            <div className="text-[11.5px] text-bone-400">{prompt}</div>
          </div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex gap-1 border-b border-[#26262c] px-3 pt-2">
          {TABS.map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className="flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[12.5px] transition-colors"
              style={tab === t.k ? { color: GOLD, borderBottom: `2px solid ${GOLD}` } : { color: "#9a927e" }}
            >
              <t.Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {assign.isError && <p className="mb-2 text-[12px] text-red-300">{(assign.error as Error).message}</p>}

          {tab === "ai_writer" && (
            <button
              onClick={() => assign.mutate({ kind: "ai_writer" })}
              disabled={assign.isPending}
              className="flex w-full items-start gap-3 rounded-xl border border-[#26262c] bg-white/[0.015] p-4 text-left transition-colors hover:border-[#d8b15a]/45 disabled:opacity-60"
            >
              <Avatar name={aiWriter.name} url={aiWriter.avatarUrl} size={48} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] text-bone-50">{aiWriter.name}</div>
                <div className="text-[11px]" style={gold}>{aiWriter.role}</div>
                <div className="mt-1 text-[12px] text-bone-300">{aiWriter.description}</div>
              </div>
              {assign.isPending ? <Loader2 className="mt-1 h-4 w-4 animate-spin text-bone-400" /> : <ArrowRight className="mt-1 h-4 w-4" style={gold} />}
            </button>
          )}

          {tab === "ai_creative" && (
            <div className="grid gap-2">
              {creatives.map((c) => (
                <CreativeRow key={c.id} c={c} busy={assign.isPending} onPick={() => assign.mutate({ kind: "ai_creative", profileId: c.id })} />
              ))}
            </div>
          )}

          {tab === "live_person" && (
            <LivePersonPicker
              talent={talent}
              busy={assign.isPending}
              onPickExisting={(talentId) => assign.mutate({ kind: "live_person", talentId })}
              onInvite={(body) => assign.mutate(body)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CreativeRow({ c, busy, onPick }: { c: AiCreativeProfile; busy: boolean; onPick: () => void }) {
  return (
    <button onClick={onPick} disabled={busy} className="flex items-start gap-3 rounded-xl border border-[#26262c] bg-white/[0.015] p-3 text-left transition-colors hover:border-[#d8b15a]/45 disabled:opacity-60">
      <Avatar name={c.name} url={c.avatarUrl} size={44} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] text-bone-50">{c.name}</span>
          <span className="text-[10.5px]" style={gold}>{c.role}</span>
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-bone-300">{c.style}</div>
        <div className="mt-1 text-[11px] italic text-bone-400">{c.sampleVoice}</div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.strengths.slice(0, 4).map((s) => (
            <span key={s} className="rounded-full border border-[#26262c] px-1.5 py-0.5 text-[9.5px] text-bone-400">{s}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

function LivePersonPicker({
  talent, busy, onPickExisting, onInvite,
}: {
  talent: TalentProfile[];
  busy: boolean;
  onPickExisting: (talentId: string) => void;
  onInvite: (body: { kind: "live_person"; name: string; email?: string; role?: string; permission?: LivePermission }) => void;
}) {
  const [mode, setMode] = useState<"existing" | "invite">(talent.length ? "existing" : "invite");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [permission, setPermission] = useState<LivePermission>("co_writer");
  const input = "w-full rounded-md border border-[#26262c] bg-black/30 px-3 py-2 text-[13px] text-bone-50 placeholder:text-bone-600 focus:border-[#d8b15a]/60 focus:outline-none";

  return (
    <div className="space-y-3">
      {talent.length > 0 && (
        <div className="flex gap-1 rounded-lg border border-[#26262c] p-0.5 text-[12px]">
          {(["existing", "invite"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 rounded-md px-3 py-1.5 transition-colors"
              style={mode === m ? { background: "rgba(216,177,90,0.14)", color: GOLD } : { color: "#9a927e" }}
            >
              {m === "existing" ? `From your directory (${talent.length})` : "Invite someone new"}
            </button>
          ))}
        </div>
      )}

      {mode === "existing" && talent.length > 0 ? (
        <div className="grid gap-2">
          {talent.map((t) => (
            <button
              key={t.id}
              onClick={() => onPickExisting(t.id)}
              disabled={busy}
              className="flex items-center gap-3 rounded-xl border border-[#26262c] bg-white/[0.015] p-2.5 text-left transition-colors hover:border-[#d8b15a]/45 disabled:opacity-60"
            >
              <Avatar name={t.name} url={t.avatarUrl} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-bone-50">{t.name}</div>
                <div className="truncate text-[10.5px]" style={gold}>{TALENT_CATEGORY_LABELS[t.category]}{t.role ? ` · ${t.role}` : ""}</div>
                {t.specialties.length > 0 && <div className="truncate text-[10.5px] text-bone-400">{t.specialties.slice(0, 3).join(", ")}</div>}
              </div>
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[9.5px]" style={{ color: "#9a927e", background: "rgba(154,146,126,0.12)" }}>
                {TALENT_INVITE_LABELS[t.inviteStatus]}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="text-[11.5px] text-bone-400">
            Invite a real writer. They become a reusable profile in your Writer Directory — usable on every future project. Photo, credits and specialties fill in when they accept.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={input} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={input} placeholder="Email (for invite)" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <input className={input} placeholder="Role — e.g. Co-writer, Staff Writer" value={role} onChange={(e) => setRole(e.target.value)} />
          <div>
            <label className="text-[10px] uppercase tracking-wide text-bone-500">Permission</label>
            <select className={input + " mt-1"} value={permission} onChange={(e) => setPermission(e.target.value as LivePermission)}>
              {LIVE_PERMISSIONS.map((p) => <option key={p} value={p} className="bg-[#0b0b0e]">{LIVE_PERMISSION_LABELS[p]}</option>)}
            </select>
          </div>
          <button
            onClick={() => onInvite({ kind: "live_person", name: name.trim(), email: email.trim() || undefined, role: role.trim() || undefined, permission })}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium text-black disabled:opacity-50"
            style={{ background: GOLD }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Invite to the team
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review Bench — the studio's quality / script-improvement staff. These are
// checks that activate along the pipeline; they are NOT co-writers.

function ReviewBench({ staff, onClose }: { staff: QualityAgent[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[#26262c] bg-[#0b0b0e]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-[#26262c] px-5 py-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.28em]" style={gold}>Studio Script Staff</div>
            <div className="font-apple text-lg text-bone-50">Review Bench</div>
            <div className="mt-0.5 text-[11.5px] text-bone-400">Which studio specialists will review this draft? They activate during the writing pipeline — they don't sit at the table.</div>
          </div>
          <button onClick={onClose} className="text-bone-400 hover:text-bone-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {staff.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-xl border border-[#26262c] bg-white/[0.015] p-3">
              <Avatar name={a.name} url={a.avatarUrl} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-bone-50">{a.name}</div>
                <div className="truncate text-[10.5px]" style={gold}>{a.role} · activates in {a.stage}</div>
                <div className="truncate text-[10.5px] text-bone-400">{a.specialty}</div>
              </div>
              <StatusPill status={a.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: QualityAgent["status"] }) {
  const map = {
    pending: { label: "Pending", color: "#9a927e", bg: "rgba(154,146,126,0.12)" },
    active: { label: "Active", color: GOLD, bg: "rgba(216,177,90,0.14)" },
    complete: { label: "Done", color: "#7fd1a4", bg: "rgba(127,209,164,0.12)" },
  }[status];
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ color: map.color, background: map.bg }}>
      {map.label}
    </span>
  );
}
