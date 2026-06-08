// Production Design tab — sits alongside Characters / Relationships /
// Continuity on the Character Bible page.
//
// Responsibilities (distinct from Continuity):
//   • Edit Visual World Rules (project-level aesthetic anchors).
//   • Run the per-script Production Design Pass and view per-scene
//     output: design summary, spatial / prop / lighting / dressing maps,
//     the unified continuity-prompt block the composer injects, and
//     pre-production warnings.
//   • Cross-link to Continuity → Locations / Props (the bibles
//     themselves live there; PD reads them).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import type {
  PDWarning,
  ProductionDesignPassResult,
  ProductionDesignSceneResult,
  VisualWorldRules,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";

type Section = "rules" | "pass";

export function ProductionDesignTab({ projectId }: { projectId: string }) {
  const [section, setSection] = useState<Section>("rules");
  return (
    <div className="space-y-3">
      <nav className="flex gap-1 border-b border-white/8">
        <TabBtn active={section === "rules"} onClick={() => setSection("rules")}>
          Visual World Rules
        </TabBtn>
        <TabBtn active={section === "pass"} onClick={() => setSection("pass")}>
          Run Production Design Pass
        </TabBtn>
        <div className="ml-auto pb-1.5 pt-2 text-[10px] text-bone-500">
          Location + Prop Bibles live in{" "}
          <Link
            to={`/projects/${projectId}/character-bible?tab=continuity`}
            className="text-sky-300 hover:underline"
          >
            Continuity →
          </Link>
        </div>
      </nav>
      {section === "rules" && <VisualWorldRulesEditor projectId={projectId} />}
      {section === "pass" && <ProductionDesignPassSection projectId={projectId} />}
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
//  Visual World Rules editor
// ---------------------------------------------------------------------------

function VisualWorldRulesEditor({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["visualWorldRules", projectId],
    queryFn: () => api.getVisualWorldRules(projectId),
  });
  const save = useMutation({
    mutationFn: (body: Partial<VisualWorldRules>) =>
      api.upsertVisualWorldRules(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["visualWorldRules", projectId] }),
  });
  const v = q.data;
  const [draft, setDraft] = useState<{
    aesthetic: string;
    forbidden: string;
    lighting: string;
    texture: string;
    notes: string;
  } | null>(null);
  // Lazy-init draft from server data on first render after fetch.
  if (v && !draft) {
    setDraft({
      aesthetic: v.aesthetic.join("\n"),
      forbidden: v.forbidden.join("\n"),
      lighting: v.lighting.join("\n"),
      texture: v.texture.join("\n"),
      notes: v.notes ?? "",
    });
  } else if (!v && !draft) {
    setDraft({
      aesthetic: "",
      forbidden: "",
      lighting: "",
      texture: "",
      notes: "",
    });
  }
  const toList = (s: string): string[] =>
    s
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <Panel
      eyebrow="Project aesthetic"
      title="Visual World Rules"
      actions={
        <Button
          onClick={() =>
            save.mutate({
              aesthetic: toList(draft?.aesthetic ?? ""),
              forbidden: toList(draft?.forbidden ?? ""),
              lighting: toList(draft?.lighting ?? ""),
              texture: toList(draft?.texture ?? ""),
              notes: draft?.notes || undefined,
              approved: v?.approved,
            })
          }
          disabled={save.isPending}
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save rules
        </Button>
      }
    >
      {q.isLoading ? (
        <div className="h-20 animate-pulse-soft rounded bg-white/[0.03]" />
      ) : (
        <div className="space-y-3 text-xs">
          <p className="rounded border border-white/8 bg-white/[0.02] p-2 text-[11px] text-bone-400">
            One entry per line. These flow into every prompt across the project
            as the locked aesthetic frame — every shot in every episode reads
            these rules before the location and prop bibles. The Continuity
            Pass + readiness gate also consult them.
          </p>
          <Field
            label="Aesthetic anchors (positive — what this project IS)"
            value={draft?.aesthetic ?? ""}
            onChange={(v) => setDraft((s) => ({ ...(s ?? blankDraft()), aesthetic: v }))}
            placeholder={"Grounded realism\nPhone-era thriller\nObservational camera"}
          />
          <Field
            label="Forbidden / out-of-bounds aesthetic moves"
            value={draft?.forbidden ?? ""}
            onChange={(v) => setDraft((s) => ({ ...(s ?? blankDraft()), forbidden: v }))}
            placeholder={"Glam lighting\nGeneric horror fog\nFantasy stylization"}
          />
          <Field
            label="Lighting anchors (practical sources only)"
            value={draft?.lighting ?? ""}
            onChange={(v) => setDraft((s) => ({ ...(s ?? blankDraft()), lighting: v }))}
            placeholder={"Cold blue-white phone glow\nFaint red clock glow\nMinimal practical light"}
          />
          <Field
            label="Texture / palette anchors"
            value={draft?.texture ?? ""}
            onChange={(v) => setDraft((s) => ({ ...(s ?? blankDraft()), texture: v }))}
            placeholder={"Dark negative space dominates wide frames\nPhotographic / realistic textures"}
          />
          <Field
            label="Notes (optional)"
            value={draft?.notes ?? ""}
            onChange={(v) => setDraft((s) => ({ ...(s ?? blankDraft()), notes: v }))}
            placeholder="Free-form designer's notes."
          />
          {save.error && (
            <div className="text-[10px] text-red-300">
              {(save.error as Error).message}
            </div>
          )}
          {save.isSuccess && !save.error && (
            <div className="text-[10px] text-emerald-300">
              Saved. Will apply to every NEW prompt going forward.
            </div>
          )}
          {v && (
            <div className="text-[10px] text-bone-500">
              Last updated {new Date(v.updatedAt).toLocaleString()}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
function blankDraft() {
  return { aesthetic: "", forbidden: "", lighting: "", texture: "", notes: "" };
}
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <div className="label-eyebrow mb-1">{label}</div>
      <textarea
        className="input min-h-[80px] w-full font-mono text-[11px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
//  Run-the-Pass section
// ---------------------------------------------------------------------------

function ProductionDesignPassSection({ projectId }: { projectId: string }) {
  const episodes = useQuery({
    queryKey: ["episodes", projectId],
    queryFn: () => api.listEpisodes(projectId),
  });
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
  const [scriptId, setScriptId] = useState<string | null>(null);
  const status = useQuery({
    queryKey: ["pdStatus", scriptId],
    queryFn: () =>
      scriptId ? api.getProductionDesignStatus(scriptId) : Promise.resolve(null),
    enabled: !!scriptId,
  });
  const run = useMutation({
    mutationFn: () => api.runProductionDesignPass(scriptId!),
    onSuccess: () => status.refetch(),
  });
  return (
    <Panel
      eyebrow="Production Design Pass"
      title="Per-scene production design output"
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
        <Button onClick={() => run.mutate()} disabled={!scriptId || run.isPending}>
          {run.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wand2 className="h-4 w-4" />
          )}
          Run Production Design Pass
        </Button>
        {run.error && (
          <div className="text-red-300">{(run.error as Error).message}</div>
        )}
        {status.data && <PDResultView result={status.data} />}
      </div>
    </Panel>
  );
}

function PDResultView({ result }: { result: ProductionDesignPassResult }) {
  return (
    <div className="space-y-3">
      <div className="rounded border border-white/8 bg-black/30 p-2 text-[11px]">
        <div className="text-[10px] uppercase tracking-wide text-bone-500">
          Roll-up — last run {new Date(result.runAt).toLocaleString()}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          <span className="chip border-white/10 bg-white/[0.04] text-bone-300">
            {result.summary.scenesTotal} scene{result.summary.scenesTotal === 1 ? "" : "s"}
          </span>
          {result.summary.scenesReady > 0 && (
            <span className="chip border-emerald-700/40 bg-emerald-900/20 text-emerald-200">
              {result.summary.scenesReady} ready
            </span>
          )}
          {result.summary.scenesWarning > 0 && (
            <span className="chip border-amber-700/40 bg-amber-900/20 text-amber-100">
              {result.summary.scenesWarning} warning
            </span>
          )}
          {result.summary.scenesFail > 0 && (
            <span className="chip border-red-800/40 bg-red-950/20 text-red-200">
              {result.summary.scenesFail} fail
            </span>
          )}
        </div>
      </div>
      {Object.values(result.scenes).map((s) => (
        <PDSceneCard key={s.sceneOrd} scene={s} />
      ))}
    </div>
  );
}

function PDSceneCard({ scene }: { scene: ProductionDesignSceneResult }) {
  const sev = scene.warnings.some((w) => w.severity === "fail")
    ? "fail"
    : scene.warnings.some((w) => w.severity === "warning")
    ? "warning"
    : "pass";
  const tone =
    sev === "fail"
      ? "border-red-800/40 bg-red-950/15"
      : sev === "warning"
      ? "border-amber-700/40 bg-amber-900/10"
      : "border-emerald-700/40 bg-emerald-900/10";
  return (
    <div className={"rounded border p-3 text-[11px] " + tone}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-serif text-base text-bone-50">
          Scene {scene.sceneOrd} — {scene.slugline}
        </h3>
        <span
          className={
            "chip " +
            (sev === "fail"
              ? "border-red-800/40 bg-red-950/20 text-red-200"
              : sev === "warning"
              ? "border-amber-700/40 bg-amber-900/20 text-amber-100"
              : "border-emerald-700/40 bg-emerald-900/20 text-emerald-200")
          }
        >
          {sev}
        </span>
      </div>
      <p className="mt-1 text-bone-200">{scene.designSummary}</p>
      {scene.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {scene.warnings.map((w, i) => (
            <PDWarningRow key={i} w={w} />
          ))}
        </ul>
      )}
      <PDBlock label="Spatial map" text={scene.spatialMap} />
      <PDBlock label="Prop map" text={scene.propMap} />
      <PDBlock label="Lighting map" text={scene.lightingMap} />
      <PDBlock label="Set dressing" text={scene.setDressing} />
      <PDBlock
        label="Unified continuity prompt (injected into every shot in this scene)"
        text={scene.continuityPrompt}
        highlight
      />
    </div>
  );
}

function PDWarningRow({ w }: { w: PDWarning }) {
  const tone =
    w.severity === "fail"
      ? "text-red-200"
      : w.severity === "warning"
      ? "text-amber-100"
      : "text-bone-300";
  const Icon = w.severity === "info" ? Check : AlertTriangle;
  return (
    <li className={"flex items-start gap-1.5 text-[10px] " + tone}>
      <Icon className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{w.message}</span>
    </li>
  );
}

function PDBlock({
  label,
  text,
  highlight,
}: {
  label: string;
  text: string;
  highlight?: boolean;
}) {
  if (!text || !text.trim()) return null;
  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wide text-bone-500">{label}</div>
      <pre
        className={
          "mt-0.5 whitespace-pre-wrap rounded border p-2 font-mono text-[10px] " +
          (highlight
            ? "border-ember-700/40 bg-ember-900/10 text-bone-100"
            : "border-white/8 bg-black/20 text-bone-200")
        }
      >
        {text}
      </pre>
    </div>
  );
}
