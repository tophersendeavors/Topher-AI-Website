import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Gavel, Send, Sparkles } from "lucide-react";
import {
  AGENT_PROFILES,
  AGENT_ROLES,
  type AgentRole,
  type RoomMessage,
} from "@toburt/shared";
import { api } from "@/lib/api";
import { useApprovalsStream, useRoomStream } from "@/lib/realtime";
import { hasSupabaseEnv } from "@/lib/supabase";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { AgentAvatar, AgentBadge } from "@/components/agents/AgentAvatar";

export function WritersRoomPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) return null;
  const qc = useQueryClient();

  const project = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
  });
  const room = useRoomStream(projectId);
  const approvals = useApprovalsStream(projectId);

  const [active, setActive] = useState<AgentRole>("showrunner");
  const [draft, setDraft] = useState("");
  const [arbitrate, setArbitrate] = useState(false);

  const post = useMutation({
    mutationFn: () => api.postRoomMessage(projectId, { body: draft }),
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["room", projectId] });
    },
  });
  const invoke = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      if (arbitrate) {
        return await api.arbitrateAgent({
          projectId,
          role: active,
          input: agentSeedInput(active, draft),
        });
      }
      return await api.invokeAgent({
        projectId,
        role: active,
        input: agentSeedInput(active, draft),
      });
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["room", projectId] });
    },
  });

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        eyebrow="Writers Room"
        title={project.data?.title ?? "Writers Room"}
        description="The agents collaborate live. Pick a participant, post a prompt, or arbitrate."
      />

      <div className="grid grid-cols-1 gap-6 px-8 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <Panel eyebrow="Participants" title="Agents in the room">
          <ul className="space-y-2">
            {AGENT_ROLES.map((r) => (
              <li key={r}>
                <button
                  onClick={() => setActive(r)}
                  className={`flex w-full items-start gap-3 rounded-lg border border-white/8 p-2.5 text-left transition-colors ${
                    active === r
                      ? "bg-white/[0.06]"
                      : "bg-white/[0.02] hover:bg-white/[0.04]"
                  }`}
                >
                  <AgentAvatar role={r} size={32} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-bone-50">
                      {AGENT_PROFILES[r].label}
                    </div>
                    <div className="line-clamp-2 text-xs text-bone-400">
                      {AGENT_PROFILES[r].description}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel
          eyebrow="Transcript"
          title="Live"
          actions={
            <span
              className="chip"
              title={
                hasSupabaseEnv()
                  ? "Subscribed to Supabase Realtime channel room:{projectId}"
                  : "Local dev — polling fallback (Supabase env not set)"
              }
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              {hasSupabaseEnv() ? "streaming" : "polling"}
            </span>
          }
        >
          <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-2">
            {room.isLoading ? (
              <div className="h-24 animate-pulse-soft rounded-lg bg-white/[0.03]" />
            ) : (room.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-bone-400">
                The room is quiet. Send a prompt to {AGENT_PROFILES[active].label} below.
              </div>
            ) : (
              (room.data ?? []).map((m) => <RoomMessageRow key={m.id} m={m} />)
            )}
          </div>

          <div className="mt-4 border-t border-white/[0.06] pt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <AgentBadge role={active} />
              <span className="text-xs text-bone-400">will respond</span>
              <label
                className={`ml-auto flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                  arbitrate
                    ? "border-ember-700/60 bg-ember-950/30 text-ember-100"
                    : "border-white/10 text-bone-300 hover:bg-white/[0.04]"
                }`}
                title="Routes the response through the Showrunner. The agent can be approved, vetoed, or asked to revise — automatically."
              >
                <input
                  type="checkbox"
                  className="hidden"
                  checked={arbitrate}
                  onChange={(e) => setArbitrate(e.target.checked)}
                />
                <Gavel className="h-3.5 w-3.5" />
                Showrunner arbitration {arbitrate ? "on" : "off"}
              </label>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                className="input min-h-[72px] resize-y"
                placeholder={`Prompt ${AGENT_PROFILES[active].label}…`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={() => post.mutate()}
                  disabled={!draft.trim() || post.isPending}
                >
                  <Send className="h-4 w-4" />
                  Post
                </Button>
                <Button
                  onClick={() => invoke.mutate()}
                  disabled={!draft.trim() || invoke.isPending}
                >
                  {arbitrate ? (
                    <Gavel className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {arbitrate ? "Arbitrate" : "Invoke"}
                </Button>
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Decisions" title="Pending approvals">
          {approvals.isLoading ? (
            <div className="h-16 animate-pulse-soft rounded-lg bg-white/[0.03]" />
          ) : (approvals.data ?? []).length === 0 ? (
            <div className="text-sm text-bone-400">No open approvals.</div>
          ) : (
            <ul className="space-y-2.5">
              {approvals.data!.map((a) => (
                <li
                  key={a.id}
                  className="rounded-md border border-amber-700/40 bg-amber-950/20 p-3"
                >
                  <div className="text-sm text-amber-100">
                    {a.target_kind === "artifact"
                      ? `Stage artifact (${a.stage_id})`
                      : a.target_kind}
                  </div>
                  <div className="mt-1 text-xs text-amber-200/70">
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <ApproveBtn id={a.id} projectId={projectId} ok />
                    <ApproveBtn id={a.id} projectId={projectId} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function RoomMessageRow({ m }: { m: RoomMessage }) {
  const isAgent = m.author_kind === "agent";
  const isUser = m.author_kind === "user";
  return (
    <article
      className={`flex gap-3 rounded-lg border border-white/8 bg-white/[0.02] p-3 ${
        m.kind === "approval" ? "border-amber-700/50" : ""
      }`}
    >
      {isAgent && m.author_role ? (
        <AgentAvatar role={m.author_role as AgentRole} size={32} />
      ) : (
        <div className="grid h-8 w-8 place-items-center rounded-md bg-white/[0.06] text-xs text-bone-200">
          {isUser ? "U" : "S"}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs text-bone-400">
          <span className="font-medium text-bone-200">
            {isAgent
              ? AGENT_PROFILES[m.author_role as AgentRole]?.label ?? m.author_role
              : isUser
                ? "You"
                : "System"}
          </span>
          <span>•</span>
          <span>{new Date(m.created_at).toLocaleTimeString()}</span>
          {m.kind !== "message" && <span className="chip">{m.kind}</span>}
        </div>
        {m.body && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-bone-100">
            {m.body}
          </p>
        )}
        {m.payload != null && (
          <details className="mt-2 text-xs text-bone-400">
            <summary className="cursor-pointer">payload</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded-md bg-black/40 p-2 text-[11px] text-bone-200">
              {JSON.stringify(m.payload, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </article>
  );
}

function ApproveBtn({
  id,
  projectId,
  ok,
}: {
  id: string;
  projectId: string;
  ok?: boolean;
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api.decideApproval(id, ok ? "approved" : "rejected"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals", projectId] });
      qc.invalidateQueries({ queryKey: ["room", projectId] });
    },
  });
  return (
    <button
      className={`rounded-md border px-2 py-1 text-xs ${
        ok
          ? "border-emerald-700/50 text-emerald-300 hover:bg-emerald-950/40"
          : "border-red-700/50 text-red-300 hover:bg-red-950/40"
      }`}
      onClick={() => m.mutate()}
      disabled={m.isPending}
    >
      {ok ? "Approve" : "Reject"}
    </button>
  );
}

function agentSeedInput(role: AgentRole, prompt: string): unknown {
  switch (role) {
    case "concept":
      return { idea: prompt };
    case "showrunner":
      return { intent: "respond", candidate: { note: prompt } };
    case "character":
      // Pass the full prompt as `brief` so the agent can extract name +
      // occupation + age etc. from a natural-language description. Also
      // pre-seed `name` with the first comma-separated token as a safety
      // net if `brief` is sparse.
      return {
        intent: "create",
        brief: prompt,
        seed: { name: (prompt.split(",")[0] ?? prompt).trim() || "Unnamed" },
      };
    case "world":
      return { intent: "build", draft: prompt };
    case "plot":
      return { intent: "treatment", brief: prompt };
    case "scene":
      return {
        intent: "draft",
        brief: {
          slugline: "INT. UNKNOWN - DAY",
          goal: prompt,
          conflict: "TBD",
          turn: "TBD",
          characters: [],
        },
      };
    case "dialogue":
      return { intent: "pass", sceneFountain: prompt, characters: [] };
    case "script_doctor":
      return { scriptId: "00000000-0000-0000-0000-000000000000", focus: "all" };
    case "continuity":
      return { scope: {} };
    case "producer":
      return { scriptId: "00000000-0000-0000-0000-000000000000" };
    // -------- Emotional Intelligence Layer --------
    case "emotional_truth":
      return {
        sceneFountain: prompt || "INT. UNKNOWN - DAY\n\nThe room is quiet.",
        characters: [],
        allowStylistic: false,
      };
    case "subtext":
      return {
        sceneFountain: prompt || "JANE\nI feel sad.",
        characters: [],
        preferAction: true,
      };
    case "character_wound":
      return { intent: "create", seed: prompt };
    case "behavior":
      return {
        sceneFountain: prompt || "JANE\nI'm angry.",
        characters: [],
        replaceStatedEmotion: true,
      };
    case "relationship_tension":
      return { intent: "map", sceneFountain: prompt };
  }
}
