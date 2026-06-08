// Continuity Department tab inside Character Bible.
// Sub-sections: Locations · Props · Run Pass.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import type {
  ContinuityIssue,
  ContinuityPassResult,
  ContinuitySeverity,
  LocationBible,
  PropBible,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

type Section = "locations" | "props" | "pass";

export function ContinuityTab({ projectId }: { projectId: string }) {
  const [section, setSection] = useState<Section>("locations");
  return (
    <div className="space-y-3">
      <nav className="flex gap-1 border-b border-white/8">
        <TabBtn active={section === "locations"} onClick={() => setSection("locations")}>
          Locations
        </TabBtn>
        <TabBtn active={section === "props"} onClick={() => setSection("props")}>
          Props
        </TabBtn>
        <TabBtn active={section === "pass"} onClick={() => setSection("pass")}>
          Run Continuity Pass
        </TabBtn>
      </nav>
      {section === "locations" && <LocationsSection projectId={projectId} />}
      {section === "props" && <PropsSection projectId={projectId} />}
      {section === "pass" && <PassSection projectId={projectId} />}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "-mb-px border-b-2 px-3 py-2 text-sm " +
        (active
          ? "border-ember-500 text-bone-50"
          : "border-transparent text-bone-400 hover:text-bone-200")
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
//  Locations
// ---------------------------------------------------------------------------

function LocationsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["locationBibles", projectId],
    queryFn: () => api.listLocationBibles(projectId),
  });
  const [editing, setEditing] = useState<LocationBible | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Panel
      eyebrow="Location Spatial Bibles"
      title={`${(list.data ?? []).length} location(s) locked`}
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New location
        </Button>
      }
    >
      {list.isLoading ? (
        <div className="h-20 animate-pulse-soft rounded bg-white/[0.03]" />
      ) : (list.data ?? []).length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/[0.02] p-4 text-xs text-bone-400">
          No location bibles yet. Run the EP01 seed (Maya's Bedroom) or click
          "New location" to lock geometry, camera rules, eyelines, and the
          continuity prompt block.
        </div>
      ) : (
        <ul className="space-y-2">
          {(list.data ?? []).map((l) => (
            <li
              key={l.name}
              className="rounded border border-white/8 bg-white/[0.02] p-3 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-serif text-base text-bone-50">{l.name}</h3>
                <div className="flex items-center gap-1">
                  {l.approved && (
                    <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                      approved
                    </span>
                  )}
                  {l.doNotFlip && (
                    <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-100">
                      do not flip
                    </span>
                  )}
                  <button
                    onClick={() => setEditing(l)}
                    className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                  >
                    Edit
                  </button>
                  <DeleteBtn
                    onClick={async () => {
                      await api.deleteLocationBible(projectId, l.name);
                      qc.invalidateQueries({ queryKey: ["locationBibles", projectId] });
                    }}
                  />
                </div>
              </div>
              {l.layout && (
                <p className="mt-1 text-bone-300">{l.layout}</p>
              )}
              <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {l.furniture.length > 0 && (
                  <Inline label="Furniture" items={l.furniture.map(itemLabel)} />
                )}
                {l.props.length > 0 && (
                  <Inline label="Props" items={l.props.map(itemLabel)} />
                )}
                {l.doors.length > 0 && (
                  <Inline label="Doors" items={l.doors.map(itemLabel)} />
                )}
                {l.cameraSafeAngles.length > 0 && (
                  <Inline
                    label="Safe angles"
                    items={l.cameraSafeAngles.map((a) => a.label)}
                  />
                )}
                {l.forbiddenAngles.length > 0 && (
                  <Inline
                    label="Forbidden angles"
                    items={l.forbiddenAngles.map((a) => a.label)}
                    warn
                  />
                )}
                {l.eyelineRules.length > 0 && (
                  <Inline label="Eyeline rules" items={l.eyelineRules} />
                )}
                {l.lightingSources.length > 0 && (
                  <Inline
                    label="Lighting"
                    items={l.lightingSources.map(
                      (g) => `${g.name}: ${g.color}${g.intensity ? ` (${g.intensity})` : ""}`
                    )}
                  />
                )}
              </div>
              {l.continuityPrompt && (
                <div className="mt-2 rounded border border-ember-700/40 bg-ember-900/10 p-2 text-[11px] text-bone-100">
                  <div className="text-[10px] uppercase tracking-wide text-bone-500">
                    Continuity prompt block
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap">{l.continuityPrompt}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {(editing || creating) && (
        <JsonEditor<LocationBible>
          title={editing ? `Edit: ${editing.name}` : "New location bible"}
          initial={editing ?? emptyLocation()}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={async (v) => {
            await api.upsertLocationBible(projectId, v);
            qc.invalidateQueries({ queryKey: ["locationBibles", projectId] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </Panel>
  );
}

function emptyLocation(): LocationBible {
  return {
    name: "",
    layout: "",
    furniture: [],
    props: [],
    doors: [],
    windows: [],
    cameraSafeAngles: [],
    forbiddenAngles: [],
    eyelineRules: [],
    lightingSources: [],
    continuityAnchors: [],
    doNotFlip: true,
    continuityPrompt: "",
    approved: false,
    createdAt: "",
    updatedAt: "",
  };
}

function itemLabel(p: {
  name: string;
  position?: string;
  orientation?: string;
}): string {
  const parts = [p.name];
  if (p.position) parts.push(`(${p.position})`);
  return parts.join(" ");
}

function Inline({
  label,
  items,
  warn,
}: {
  label: string;
  items: string[];
  warn?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-bone-500">{label}</div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((s, i) => (
          <li
            key={`${s}-${i}`}
            className={
              "rounded px-1.5 py-0.5 " +
              (warn
                ? "border border-amber-700/30 bg-amber-900/10 text-amber-100"
                : "text-bone-200")
            }
          >
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Props
// ---------------------------------------------------------------------------

function PropsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["propBibles", projectId],
    queryFn: () => api.listPropBibles(projectId),
  });
  const [editing, setEditing] = useState<PropBible | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <Panel
      eyebrow="Prop Continuity Bibles"
      title={`${(list.data ?? []).length} prop(s) locked`}
      actions={
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New prop
        </Button>
      }
    >
      {list.isLoading ? (
        <div className="h-20 animate-pulse-soft rounded bg-white/[0.03]" />
      ) : (list.data ?? []).length === 0 ? (
        <div className="rounded border border-dashed border-white/10 bg-white/[0.02] p-4 text-xs text-bone-400">
          No prop bibles yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {(list.data ?? []).map((p) => (
            <li
              key={p.name}
              className="rounded border border-white/8 bg-white/[0.02] p-3 text-xs"
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-serif text-base text-bone-50">{p.name}</h3>
                <div className="flex items-center gap-1">
                  {p.homeLocation && (
                    <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
                      {p.homeLocation}
                    </span>
                  )}
                  {p.approved && (
                    <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
                      approved
                    </span>
                  )}
                  <button
                    onClick={() => setEditing(p)}
                    className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-bone-300 hover:bg-white/[0.04]"
                  >
                    Edit
                  </button>
                  <DeleteBtn
                    onClick={async () => {
                      await api.deletePropBible(projectId, p.name);
                      qc.invalidateQueries({ queryKey: ["propBibles", projectId] });
                    }}
                  />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {p.orientation && <Inline label="Orientation" items={[p.orientation]} />}
                {p.handledBy.length > 0 && (
                  <Inline label="Handled by" items={p.handledBy} />
                )}
                {p.startsAt && <Inline label="Starts at" items={[p.startsAt]} />}
                {p.endsAt && <Inline label="Ends at" items={[p.endsAt]} />}
                {p.episodesPresent.length > 0 && (
                  <Inline
                    label="Episodes"
                    items={[p.episodesPresent.map((n) => `EP${String(n).padStart(2, "0")}`).join(", ")]}
                  />
                )}
                {p.doNotChange.length > 0 && (
                  <Inline label="Do not change" items={p.doNotChange} warn />
                )}
              </div>
              {p.visualDetails && (
                <p className="mt-2 text-bone-300">{p.visualDetails}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {(editing || creating) && (
        <JsonEditor<PropBible>
          title={editing ? `Edit: ${editing.name}` : "New prop bible"}
          initial={editing ?? emptyProp()}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={async (v) => {
            await api.upsertPropBible(projectId, v);
            qc.invalidateQueries({ queryKey: ["propBibles", projectId] });
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </Panel>
  );
}

function emptyProp(): PropBible {
  return {
    name: "",
    homeLocation: "",
    startsAt: "",
    endsAt: "",
    orientation: "",
    handledBy: [],
    visualDetails: "",
    episodesPresent: [],
    doNotChange: [],
    approved: false,
    createdAt: "",
    updatedAt: "",
  };
}

// ---------------------------------------------------------------------------
//  Continuity Pass runner — picks an episode/script and shows results.
// ---------------------------------------------------------------------------

function PassSection({ projectId }: { projectId: string }) {
  const episodes = useQuery({
    queryKey: ["episodes", projectId],
    queryFn: () => api.listEpisodes(projectId),
  });
  const [scriptId, setScriptId] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["continuityStatus", scriptId],
    queryFn: () => (scriptId ? api.getContinuityStatus(scriptId) : Promise.resolve(null)),
    enabled: !!scriptId,
  });
  const run = useMutation({
    mutationFn: () => api.runContinuityPass(scriptId!),
    onSuccess: () => status.refetch(),
  });
  // Map every episode → its current script id (one fetch per episode; only
  // runs after the episodes list resolves).
  const scriptByEp = useQuery({
    queryKey: ["scriptByEpisode", projectId, (episodes.data ?? []).length],
    queryFn: async () => {
      const eps = episodes.data ?? [];
      const map: Record<string, string | null> = {};
      for (const e of eps) {
        try {
          const r = await api.getEpisodeCurrentScreenplay(e.id);
          map[e.id] = r.script?.id ?? null;
        } catch {
          map[e.id] = null;
        }
      }
      return map;
    },
    enabled: !!episodes.data?.length,
  });
  return (
    <Panel
      eyebrow="Run Continuity Pass"
      title="Heuristic validator (no LLM cost)"
    >
      <div className="space-y-2 text-xs">
        <div>
          <div className="label-eyebrow mb-1">Episode</div>
          <select
            className="input"
            value={scriptId ?? ""}
            onChange={(e) => setScriptId(e.target.value || null)}
          >
            <option value="">— pick an episode —</option>
            {(episodes.data ?? []).map((ep) => {
              const sid = scriptByEp.data?.[ep.id];
              if (!sid) return null;
              return (
                <option key={ep.id} value={sid}>
                  EP{String(ep.number).padStart(2, "0")}
                  {ep.title ? ` — ${ep.title}` : ""}
                </option>
              );
            })}
          </select>
        </div>
        <Button
          onClick={() => run.mutate()}
          disabled={!scriptId || run.isPending}
        >
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          Run Continuity Pass
        </Button>
        {run.error && (
          <div className="text-red-300">{(run.error as Error).message}</div>
        )}
        {status.data && <PassResultView result={status.data} />}
      </div>
    </Panel>
  );
}

function PassResultView({ result }: { result: ContinuityPassResult }) {
  const order: ContinuitySeverity[] = ["fail", "warning", "pass"];
  const grouped = order.map((sev) => ({
    sev,
    items: result.issues.filter((i) => i.severity === sev),
  }));
  return (
    <div className="space-y-2">
      <div className="rounded border border-white/8 bg-black/30 p-2">
        <div className="text-[10px] uppercase tracking-wide text-bone-500">
          Summary by category — last run {new Date(result.runAt).toLocaleString()}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1 md:grid-cols-3">
          {Object.entries(result.summary).map(([cat, s]) => {
            const total = s.pass + s.warning + s.fail;
            if (total === 0) return null;
            return (
              <div
                key={cat}
                className="rounded border border-white/8 bg-white/[0.02] p-1.5 text-[11px]"
              >
                <div className="font-medium text-bone-100">
                  {cat.replace("_", " ")}
                </div>
                <div className="flex gap-2 text-[10px]">
                  {s.fail > 0 && (
                    <span className="text-red-300">{s.fail} fail</span>
                  )}
                  {s.warning > 0 && (
                    <span className="text-amber-200">{s.warning} warn</span>
                  )}
                  {s.pass > 0 && (
                    <span className="text-emerald-300">{s.pass} pass</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {grouped.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.sev}>
              <div
                className={
                  "text-[11px] font-medium uppercase tracking-wide " +
                  (g.sev === "fail"
                    ? "text-red-300"
                    : g.sev === "warning"
                    ? "text-amber-200"
                    : "text-emerald-300")
                }
              >
                {g.sev} · {g.items.length}
              </div>
              <ul className="mt-1 space-y-1">
                {g.items.map((i) => (
                  <IssueCard key={i.id} issue={i} />
                ))}
              </ul>
            </div>
          )
      )}
    </div>
  );
}

function IssueCard({ issue }: { issue: ContinuityIssue }) {
  const w = issue.where;
  const loc = [
    w.episodeNumber != null ? `EP${String(w.episodeNumber).padStart(2, "0")}` : null,
    w.sceneOrd != null ? `SC${String(w.sceneOrd).padStart(2, "0")}` : null,
    w.shotIndex != null ? `SH${String(w.shotIndex).padStart(2, "0")}` : null,
    w.characterName,
    w.locationName,
    w.propName,
  ]
    .filter(Boolean)
    .join(" · ");
  const color =
    issue.severity === "fail"
      ? "border-red-800/40 bg-red-950/15"
      : issue.severity === "warning"
      ? "border-amber-700/40 bg-amber-900/10"
      : "border-emerald-700/40 bg-emerald-900/10";
  return (
    <li className={"rounded border p-2 text-[11px] " + color}>
      <div className="flex items-center gap-2">
        {issue.severity === "fail" ? (
          <AlertTriangle className="h-3 w-3 text-red-300" />
        ) : issue.severity === "warning" ? (
          <AlertTriangle className="h-3 w-3 text-amber-200" />
        ) : (
          <Check className="h-3 w-3 text-emerald-300" />
        )}
        <span className="text-bone-500">[{issue.category.replace("_", " ")}]</span>
        <span className="font-mono text-[10px] text-bone-400">{loc || "(global)"}</span>
      </div>
      <div className="mt-1 text-bone-100">{issue.message}</div>
      {issue.suggestedFix && (
        <div className="mt-1 text-bone-400">
          <span className="text-bone-500">fix:</span> {issue.suggestedFix}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
//  Tiny JSON-editor modal — bridge until per-field form is built out.
// ---------------------------------------------------------------------------

function JsonEditor<T>({
  title,
  initial,
  onClose,
  onSave,
}: {
  title: string;
  initial: T;
  onClose: () => void;
  onSave: (v: T) => Promise<void> | void;
}) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel-strong w-full max-w-3xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-lg">{title}</h2>
        <p className="mt-1 text-[11px] text-bone-400">
          Direct JSON edit. Validated server-side; errors surface here.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="input mt-2 h-[60vh] w-full font-mono text-[11px]"
        />
        {err && <div className="mt-2 text-[11px] text-red-300">{err}</div>}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              setErr(null);
              try {
                const v = JSON.parse(text) as T;
                setSaving(true);
                await onSave(v);
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteBtn({ onClick }: { onClick: () => void | Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <button
      onClick={async () => {
        if (!confirming) {
          setConfirming(true);
          setTimeout(() => setConfirming(false), 2500);
          return;
        }
        await onClick();
      }}
      className={
        "rounded border px-2 py-0.5 text-[10px] " +
        (confirming
          ? "border-red-800/60 bg-red-950/40 text-red-100"
          : "border-red-800/40 bg-red-950/20 text-red-200 hover:bg-red-950/40")
      }
      title={confirming ? "Click again to confirm" : "Delete"}
    >
      {confirming ? "Confirm?" : <Trash2 className="h-3 w-3" />}
    </button>
  );
}
