import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Clapperboard, Film } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

const TOOLS = [
  { id: "shotlist", label: "Shotlist", Icon: Camera, desc: "Per-scene coverage breakdown." },
  { id: "storyboard", label: "Storyboard prompts", Icon: Film, desc: "Image-gen prompts per shot." },
  { id: "flow", label: "Flow video prompts", Icon: Clapperboard, desc: "Cinematic video-gen prompts per scene." },
] as const;

export function ProductionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });
  const [scriptId, setScriptId] = useState<string>("");
  const [tool, setTool] = useState<(typeof TOOLS)[number]["id"]>("shotlist");
  const [out, setOut] = useState<unknown>(null);
  const run = useMutation({
    mutationFn: () => api.productionFor(scriptId, tool),
    onSuccess: (r) => setOut(r),
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Production"
        title="Pipeline tools"
        description="Generate shotlists, storyboard prompts, and cinematic video-gen prompts."
      />
      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel eyebrow="Setup" title="Pick a script & tool">
          <div className="space-y-3">
            <div>
              <label className="label-eyebrow mb-1 block">Draft</label>
              <select className="input" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">Select a draft…</option>
                {(scripts.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
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
            <Button onClick={() => run.mutate()} disabled={!scriptId || run.isPending}>
              Generate
            </Button>
          </div>
        </Panel>

        <Panel eyebrow="Output" title={tool}>
          {!out ? (
            <EmptyState
              Icon={Camera}
              title="Nothing yet"
              description="Pick a draft and a tool, then Generate."
            />
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-black/40 p-3 text-xs text-bone-200">
              {JSON.stringify(out, null, 2)}
            </pre>
          )}
        </Panel>
      </div>
    </div>
  );
}
