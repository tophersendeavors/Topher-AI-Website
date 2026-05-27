import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Bot,
  Download,
  FileText,
  Save,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { AgentBadge } from "@/components/agents/AgentAvatar";
import {
  FOUNTAIN_LANG_ID,
  FOUNTAIN_THEME,
  fountainLanguageDef,
} from "./fountain";

export function ScriptEditorPage() {
  const { projectId, scriptId } = useParams<{
    projectId: string;
    scriptId: string;
  }>();
  if (!projectId || !scriptId) return null;
  const qc = useQueryClient();

  const script = useQuery({
    queryKey: ["script", scriptId],
    queryFn: () => api.getScript(scriptId),
  });

  const [body, setBody] = useState<string>("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (script.data) {
      setBody(script.data.fountain ?? "");
      setDirty(false);
    }
  }, [script.data?.id]);

  const save = useMutation({
    mutationFn: () => api.updateScript(scriptId, { fountain: body }),
    onSuccess: () => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["script", scriptId] });
    },
  });

  const onMount: OnMount = (_editor, monaco) => {
    if (!monaco.languages.getLanguages().some((l) => l.id === FOUNTAIN_LANG_ID)) {
      monaco.languages.register({ id: FOUNTAIN_LANG_ID });
      monaco.languages.setMonarchTokensProvider(
        FOUNTAIN_LANG_ID,
        fountainLanguageDef()
      );
    }
    monaco.editor.defineTheme("toburt", FOUNTAIN_THEME);
    monaco.editor.setTheme("toburt");
  };

  const sceneCount = useMemo(
    () =>
      body
        .split(/\r?\n/)
        .filter((l) => /^(\.|INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\b/i.test(l))
        .length,
    [body]
  );

  return (
    <div className="space-y-4 pb-10">
      <PageHeader
        eyebrow="Screenplay"
        title={script.data?.title ?? "—"}
        description={`Draft ${script.data?.draft_number ?? 1} • ${sceneCount} scenes${dirty ? " • unsaved" : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <ExportMenu scriptId={scriptId} />
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 px-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          eyebrow="Editor"
          title={
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-ember-400" />
              Fountain
            </span>
          }
          className="overflow-hidden p-0"
        >
          <div className="h-[72vh] border-t border-white/[0.06]">
            <Editor
              language={FOUNTAIN_LANG_ID}
              theme="toburt"
              value={body}
              onMount={onMount}
              onChange={(v) => {
                setBody(v ?? "");
                setDirty(true);
              }}
              options={{
                fontFamily:
                  '"Courier Prime", "Courier New", Courier, monospace',
                fontSize: 14,
                lineNumbers: "on",
                minimap: { enabled: false },
                renderLineHighlight: "all",
                wordWrap: "on",
                padding: { top: 24, bottom: 80 },
                scrollBeyondLastLine: true,
                smoothScrolling: true,
              }}
            />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel
            eyebrow="Co-write"
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-ember-400" /> AI assists
              </span>
            }
          >
            <ul className="space-y-2">
              <AssistButton
                label="Pass for dialogue voice"
                desc="Run the Dialogue agent over the current scene."
                role="dialogue"
                projectId={projectId}
                input={() => ({
                  intent: "pass",
                  sceneFountain: extractCurrentScene(body),
                  characters: [],
                })}
              />
              <AssistButton
                label="Punch up scene"
                desc="Tighten action lines & sharpen the turn."
                role="scene"
                projectId={projectId}
                input={() => ({
                  intent: "refine",
                  brief: {
                    slugline: extractCurrentSlugline(body),
                    goal: "punch up",
                    conflict: "auto",
                    turn: "auto",
                    characters: [],
                  },
                })}
              />
              <AssistButton
                label="Continuity check"
                desc="Continuity agent scans this script for conflicts."
                role="continuity"
                projectId={projectId}
                input={() => ({ scope: { scriptId } })}
              />
              <AssistButton
                label="Behavior pass"
                desc="Convert stated emotions into physical action / silence / tells."
                role="behavior"
                projectId={projectId}
                input={() => ({
                  sceneFountain: extractCurrentScene(body),
                  characters: [],
                  replaceStatedEmotion: true,
                })}
              />
              <AssistButton
                label="Subtext pass"
                desc="Rewrite on-the-nose lines into indirect, layered ones."
                role="subtext"
                projectId={projectId}
                input={() => ({
                  sceneFountain: extractCurrentScene(body),
                  characters: [],
                  preferAction: true,
                })}
              />
              <AssistButton
                label="Emotional truth"
                desc="Score the scene & extract the ten emotional fields."
                role="emotional_truth"
                projectId={projectId}
                input={() => ({
                  sceneFountain: extractCurrentScene(body),
                  characters: [],
                  scriptId,
                  allowStylistic: false,
                })}
              />
            </ul>
          </Panel>

          <EmotionalPanel scriptId={scriptId} />
        </div>
      </div>
    </div>
  );
}

function AssistButton({
  label,
  desc,
  role,
  projectId,
  input,
}: {
  label: string;
  desc: string;
  role: import("@toburt/shared").AgentRole;
  projectId: string;
  input: () => unknown;
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.invokeAgent({ projectId, role, input: input() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["room", projectId] }),
  });
  return (
    <li className="rounded-md border border-white/8 bg-white/[0.02] p-3">
      <div className="mb-1 flex items-center justify-between">
        <AgentBadge role={role} />
        <button
          className="rounded-md border border-white/10 px-2 py-1 text-xs text-bone-100 hover:bg-white/[0.04]"
          onClick={() => m.mutate()}
          disabled={m.isPending}
        >
          <Bot className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
          Run
        </button>
      </div>
      <div className="text-sm text-bone-100">{label}</div>
      <div className="text-xs text-bone-400">{desc}</div>
    </li>
  );
}

function ExportMenu({ scriptId }: { scriptId: string }) {
  const formats = ["pdf", "fdx", "fountain", "markdown"] as const;
  return (
    <details className="relative">
      <summary className="btn-outline cursor-pointer list-none">
        <Download className="h-4 w-4" />
        Export
      </summary>
      <div className="absolute right-0 mt-2 w-44 rounded-md border border-white/10 bg-ink-800 p-1 shadow-glass">
        {formats.map((f) => (
          <a
            key={f}
            href={api.exportScriptUrl(scriptId, f)}
            className="block rounded px-2.5 py-1.5 text-sm text-bone-100 hover:bg-white/[0.06]"
            target="_blank"
            rel="noreferrer"
          >
            .{f}
          </a>
        ))}
      </div>
    </details>
  );
}

function extractCurrentScene(text: string): string {
  // Naive: the last scene heading onward.
  const lines = text.split(/\r?\n/);
  let start = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^(\.|INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\b/i.test(lines[i])) {
      start = i;
      break;
    }
  }
  return lines.slice(start).join("\n");
}

function extractCurrentSlugline(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^(\.|INT\.?|EXT\.?|EST\.?|INT\.?\/EXT\.?|I\/E\.?)\b/i.test(lines[i])) {
      return lines[i];
    }
  }
  return "INT. UNKNOWN - DAY";
}

function EmotionalPanel({ scriptId }: { scriptId: string }) {
  const qc = useQueryClient();
  const states = useQuery({
    queryKey: ["emotional-states", scriptId],
    queryFn: () => api.listScriptEmotionalStates(scriptId),
  });
  const directness = useQuery({
    queryKey: ["directness", scriptId],
    queryFn: () => api.validateDirectness(scriptId),
  });
  const runPass = useMutation({
    mutationFn: () => api.runScriptEmotionalPass(scriptId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["emotional-states", scriptId] });
      qc.invalidateQueries({ queryKey: ["directness", scriptId] });
    },
  });

  const directViolations = (directness.data ?? []).reduce(
    (sum, s) => sum + s.report.violations.length,
    0
  );
  const rejected = (states.data ?? []).filter((s) => s.rejected).length;

  return (
    <Panel eyebrow="Emotional Intelligence" title="Scene EI state">
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="chip">{directViolations} directness flag(s)</span>
        <span
          className={`chip ${
            rejected > 0 ? "border-red-700/50 text-red-200" : ""
          }`}
        >
          {rejected} rejected scene(s)
        </span>
      </div>
      <Button
        variant="outline"
        onClick={() => runPass.mutate()}
        disabled={runPass.isPending}
      >
        <Sparkles className="h-4 w-4" />
        {runPass.isPending ? "Running…" : "Run EI pass"}
      </Button>
      {(states.data ?? []).length > 0 && (
        <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1 text-xs">
          {states.data!.map((s, i) => (
            <li
              key={s.id}
              className={`rounded-md border p-2 ${
                s.rejected ? "border-red-700/50 bg-red-950/20" : "border-white/8 bg-white/[0.02]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-bone-200">Scene {i + 1}</span>
                {s.truth_score != null && (
                  <span className="text-bone-400">truth {s.truth_score.toFixed(2)}</span>
                )}
              </div>
              <div className="mt-1 text-bone-300">
                {s.emotionalEntryState} → {s.emotionalExitState}
              </div>
              {s.rejection_reason && (
                <div className="mt-1 text-red-200">{s.rejection_reason}</div>
              )}
            </li>
          ))}
        </ul>
      )}
      {directViolations === 0 && (states.data ?? []).length === 0 && (
        <p className="mt-3 text-xs text-bone-400">
          Run an EI pass to score this script's scenes against the ten
          required emotional fields, and to catch on-the-nose dialogue.
        </p>
      )}
    </Panel>
  );
}
