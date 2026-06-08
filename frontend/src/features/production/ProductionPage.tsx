import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Camera, Clapperboard, Film, Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatDraftLabel } from "@/lib/draftLabel";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { AIVideoPromptsPanel } from "@/features/drafts/AIVideoPromptsPanel";

// Error boundary specifically around the AI Video Prompts panel — the
// panel was built for prestige scripts and occasionally hits a shape
// mismatch on micro-drama data. Without this, the writer sees a silent
// black screen and we cannot diagnose. With it, the actual error message
// + a "report this" hint render so the failure is fixable.
class PanelErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[AIVideoPromptsPanel crash]", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <Panel eyebrow="Production" title="AI Video Prompts — error">
          <div className="rounded-md border border-red-800/50 bg-red-950/30 p-3 text-sm text-red-100">
            <div className="flex items-center gap-2 font-medium text-red-200">
              <AlertTriangle className="h-4 w-4" />
              The AI Video Prompts panel crashed while rendering.
            </div>
            <div className="mt-2 text-xs text-bone-200">
              This usually means a piece of data in the selected script's
              metadata is shaped differently than the panel expects. Your
              data is safe — nothing was written. The exact error is below
              and is also in the browser console.
            </div>
            <pre className="mt-2 max-h-[260px] overflow-auto rounded bg-black/40 p-2 font-mono text-[11px] text-red-100">
              {this.state.error.name}: {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack ?? ""}
            </pre>
            <div className="mt-2 text-[11px] text-bone-400">
              Copy this and send it to Claude. It will tell me exactly which
              line to patch.
            </div>
          </div>
        </Panel>
      );
    }
    return this.props.children;
  }
}

// Tool entries. "ai-video" is the new Model-Router-driven panel; the
// legacy "flow" entry stays around so anyone with bookmarked output from
// the old Flow-only generator can still reach it.
const TOOLS = [
  {
    id: "shotlist",
    label: "Shotlist",
    Icon: Camera,
    desc: "Per-scene coverage breakdown.",
  },
  {
    id: "storyboard",
    label: "Storyboard Prompts",
    Icon: Film,
    desc: "Image-gen prompts per shot.",
  },
  {
    id: "ai-video",
    label: "AI Video Prompts",
    Icon: Wand2,
    desc: "Model Router + adapters. Built from approved scenes.",
  },
  {
    id: "flow",
    label: "Flow video prompts (legacy)",
    Icon: Clapperboard,
    desc: "Older Flow-only generator. Replaced by AI Video Prompts.",
  },
] as const;

type ToolId = (typeof TOOLS)[number]["id"];

export function ProductionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });
  const [scriptId, setScriptId] = useState<string>("");
  // Default tool is AI Video Prompts — the most-used path for non-experts.
  const [tool, setTool] = useState<ToolId>("ai-video");
  const [out, setOut] = useState<unknown>(null);
  const run = useMutation({
    mutationFn: () => api.productionFor(scriptId, tool),
    onSuccess: (r) => setOut(r),
  });

  // Approved-scene detection drives the AI Video Prompts empty state and
  // the panel's `ready` flag.
  const sceneRows = useQuery({
    queryKey: ["scene-rows", scriptId],
    queryFn: () => api.listSceneRows(scriptId),
    enabled: !!scriptId,
  });
  // Tier guard: micro-drama screenplays bypass Hollywood Draft Mode
  // entirely (no scene_status workflow), so their script_scenes rows have
  // status=null. The approved-scene gate below is meant for the prestige
  // flow only — for micro-drama, "screenplay approved" upstream IS scene
  // approval. We detect via scripts.metadata.source.
  const selectedScript = (scripts.data ?? []).find((s) => s.id === scriptId);
  const isMicroDramaScript =
    ((selectedScript?.metadata as { source?: string } | undefined)?.source ?? "") ===
    "micro_drama_chain";
  const approvedCount = (sceneRows.data ?? []).filter((r) =>
    ["generated", "revised", "locked"].includes(r.status)
  ).length;
  const hasApprovedScene =
    isMicroDramaScript
      ? (sceneRows.data ?? []).length > 0
      : approvedCount > 0;

  const isAiVideo = tool === "ai-video";

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Production"
        title="Pipeline tools"
        description="Generate shotlists, storyboard prompts, and per-model AI video prompts."
      />
      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel eyebrow="Setup" title="Pick a script & tool">
          <div className="space-y-3">
            <div>
              <label className="label-eyebrow mb-1 block">Draft</label>
              <select
                className="input"
                value={scriptId}
                onChange={(e) => setScriptId(e.target.value)}
              >
                <option value="">Select a draft…</option>
                {(scripts.data ?? [])
                  .slice()
                  // Current draft first; then newest draft_number; then most-recent update.
                  .sort((a, b) => {
                    if (a.current !== b.current) return a.current ? -1 : 1;
                    if (a.draft_number !== b.draft_number)
                      return b.draft_number - a.draft_number;
                    return (
                      Date.parse(b.updated_at) - Date.parse(a.updated_at)
                    );
                  })
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDraftLabel(s)}
                    </option>
                  ))}
              </select>
            </div>
            <ul className="space-y-2">
              {TOOLS.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setTool(t.id)}
                    className={`flex w-full items-start gap-3 rounded-md border border-white/8 p-3 text-left transition-colors ${
                      tool === t.id ? "bg-white/[0.06]" : "bg-white/[0.02] hover:bg-white/[0.04]"
                    }`}
                  >
                    <t.Icon className="mt-0.5 h-4 w-4 text-ember-400" />
                    <div>
                      <div className="text-sm text-bone-50">{t.label}</div>
                      <div className="text-xs text-bone-400">{t.desc}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {/* Legacy "Generate" button is only meaningful for the
                legacy productionFor() endpoints — the AI Video Prompts
                tool drives its own actions inside the panel. */}
            {!isAiVideo && (
              <Button onClick={() => run.mutate()} disabled={!scriptId || run.isPending}>
                Generate
              </Button>
            )}
          </div>
        </Panel>

        {isAiVideo ? (
          <div className="space-y-3">
            {!scriptId ? (
              // First-run empty state: explain what this tool does and
              // direct the writer to pick a draft on the left.
              <Panel eyebrow="Production" title="AI Video Prompts — Model Router + Adapters">
                <EmptyState
                  Icon={Wand2}
                  title="Open AI Video Prompts"
                  description="Start with an approved script scene. The system can auto-build shot briefs from the scene, recommend the best AI video model, and generate model-specific prompts."
                />
                <div className="mt-2 text-[11px] text-bone-500">
                  Pick a draft on the left to begin. Built from approved draft scenes —
                  AI never modifies your screenplay.
                </div>
              </Panel>
            ) : !hasApprovedScene ? (
              <Panel eyebrow="Production" title="AI Video Prompts — Model Router + Adapters">
                <div className="rounded border border-amber-700/40 bg-amber-900/15 p-3 text-xs text-amber-100">
                  Write and approve a scene before generating AI video prompts. AI Video
                  Prompts pulls every shot brief from your approved scene text — once a
                  scene is approved in Hollywood Draft Mode, it will appear here.
                </div>
                <div className="mt-2 text-[11px] text-bone-500">
                  Built from approved draft scenes. Also available inside the Draft
                  Workspace.
                </div>
              </Panel>
            ) : (
              <PanelErrorBoundary>
                <AIVideoPromptsPanel
                  scriptId={scriptId}
                  ready={hasApprovedScene}
                  originContext="production"
                />
              </PanelErrorBoundary>
            )}
          </div>
        ) : (
          <Panel eyebrow="Output" title={tool}>
            {!out ? (
              <EmptyState
                Icon={Camera}
                title="Nothing yet"
                description={
                  tool === "flow"
                    ? "Legacy Flow generator. For better results use AI Video Prompts — same data, model router, per-model adapters."
                    : "Pick a draft and a tool, then Generate."
                }
              />
            ) : (
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-black/40 p-3 text-xs text-bone-200">
                {JSON.stringify(out, null, 2)}
              </pre>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
