import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export function RewritesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const scripts = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => api.listScripts(projectId),
  });

  const [scriptId, setScriptId] = useState<string>("");
  const [focus, setFocus] = useState<"all" | "pacing" | "cliché" | "structure" | "emotional_impact">("all");
  const [report, setReport] = useState<unknown>(null);
  const run = useMutation({
    mutationFn: () =>
      api.invokeAgent({
        projectId,
        role: "script_doctor",
        input: { scriptId, focus },
      }),
    onSuccess: (r) => setReport(r.output),
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Rewrites"
        title="Script Doctor"
        description="Diagnose pacing, clichés, structural weaknesses, emotional arc. The Script Doctor runs on the selected draft."
      />
      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel eyebrow="Setup" title="Run a pass">
          <div className="space-y-3">
            <div>
              <label className="label-eyebrow mb-1 block">Draft</label>
              <select className="input" value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
                <option value="">Select a draft…</option>
                {(scripts.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-eyebrow mb-1 block">Focus</label>
              <select className="input" value={focus} onChange={(e) => setFocus(e.target.value as typeof focus)}>
                <option value="all">All</option>
                <option value="pacing">Pacing</option>
                <option value="cliché">Cliché</option>
                <option value="structure">Structure</option>
                <option value="emotional_impact">Emotional impact</option>
              </select>
            </div>
            <Button onClick={() => run.mutate()} disabled={!scriptId || run.isPending}>
              <Wand2 className="h-4 w-4" /> Diagnose
            </Button>
          </div>
        </Panel>

        <Panel eyebrow="Report" title="Diagnoses">
          {!report ? (
            <EmptyState Icon={Wand2} title="No report yet" description="Pick a draft and click Diagnose." />
          ) : (
            <pre className="max-h-[60vh] overflow-auto rounded-md bg-black/40 p-3 text-xs text-bone-200">
              {JSON.stringify(report, null, 2)}
            </pre>
          )}
        </Panel>
      </div>
    </div>
  );
}
