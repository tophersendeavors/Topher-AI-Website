import type { AgentRole, ShowrunnerDecision } from "@toburt/shared";
import { writeMemory } from "../memory/index.js";
import { postRoomMessage } from "../orchestrator/room.js";
import { runAgent } from "./runner.js";
import { showrunnerAgent } from "./showrunner.js";
import type { Agent, AgentContext } from "./types.js";

export interface ArbitrationStep<TOut = unknown> {
  kind:
    | "recommend"
    | "review"
    | "revise"
    | "approve"
    | "veto"
    | "reject"
    | "exhausted";
  role: AgentRole;
  body: string;
  payload?: unknown;
  decision?: ShowrunnerDecision;
  output?: TOut;
  attempt: number;
}

export interface ArbitrationResult<TOut> {
  output: TOut;
  decision: ShowrunnerDecision;
  approved: boolean;
  revisions: number;
  trail: ArbitrationStep<TOut>[];
  memoryEntryId?: string;
}

/**
 * Drive an agent through the full Showrunner arbitration loop.
 *
 *   1. Agent produces a recommendation (a "submission").
 *   2. Showrunner reviews it (intent: "arbitrate").
 *   3. Decision branches:
 *        - approve  → persist as canon memory, return.
 *        - reject   → persist as un-approved memory note, return.
 *        - revise   → critique is fed back to the agent (as `critique` on
 *                     the input), the agent re-submits, and we loop.
 *   4. After `maxRevisions` revise rounds the last submission is returned
 *      with `decision="revise"` and an `exhausted` trail entry.
 *
 *   Every step is broadcast to the Writers Room (`room_messages`) so the
 *   UI can render the debate in real time (Supabase Realtime).
 */
export async function runWithArbitration<TIn, TOut>(
  agent: Agent<TIn, TOut>,
  input: TIn,
  ctx: AgentContext,
  opts: { maxRevisions?: number; persistToMemory?: boolean } = {}
): Promise<ArbitrationResult<TOut>> {
  const maxRevisions = opts.maxRevisions ?? 2;
  const persist = opts.persistToMemory !== false;
  const trail: ArbitrationStep<TOut>[] = [];

  // Make Showrunner visible as a collaborator so each agent's prompt knows
  // the room composition.
  const arbCtx: AgentContext = {
    ...ctx,
    collaborators: dedupe([...ctx.collaborators, agent.role, "showrunner"]),
  };

  let currentInput = input;
  let lastOutput: TOut | undefined;
  let lastDecision: ShowrunnerDecision | undefined;
  let revisions = 0;

  for (let attempt = 0; attempt <= maxRevisions; attempt++) {
    // ---- 1. Agent produces a recommendation ----
    const run = await runAgent(agent, currentInput, arbCtx);
    lastOutput = run.output;

    await postRoomMessage({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId ?? null,
      stageId: ctx.stage ?? null,
      authorKind: "agent",
      authorRole: agent.role,
      kind: "suggestion",
      body: `${agent.label} submits ${attempt === 0 ? "a recommendation" : `revision #${attempt}`}.`,
      payload: { output: run.output, attempt },
    });
    trail.push({
      kind: "recommend",
      role: agent.role,
      body: `${agent.label} submits ${attempt === 0 ? "a recommendation" : `revision #${attempt}`}.`,
      payload: run.output,
      output: run.output,
      attempt,
    });

    // ---- 2. Showrunner reviews ----
    const verdict = await runAgent(
      showrunnerAgent,
      {
        intent: "arbitrate",
        candidate: run.output,
        critiques:
          revisions > 0
            ? [{ role: "showrunner", note: "previous revision rationale" }]
            : [],
      },
      arbCtx
    );
    lastDecision = verdict.output;

    const decision = verdict.output.decision;
    const decisionKind: ArbitrationStep["kind"] =
      decision === "approve"
        ? "approve"
        : decision === "reject"
          ? "veto"
          : "revise";
    const messageKind =
      decision === "approve"
        ? "approval"
        : decision === "reject"
          ? "critique"
          : "critique";

    await postRoomMessage({
      projectId: ctx.projectId,
      workflowId: ctx.workflowId ?? null,
      stageId: ctx.stage ?? null,
      authorKind: "agent",
      authorRole: "showrunner",
      kind: messageKind,
      body: `Showrunner ${decision}s: ${verdict.output.rationale}`,
      payload: { decision: verdict.output, attempt },
    });
    trail.push({
      kind: decisionKind,
      role: "showrunner",
      body: verdict.output.rationale,
      payload: verdict.output,
      decision: verdict.output,
      attempt,
    });

    // ---- 3. Terminal decisions ----
    if (decision === "approve" || decision === "reject") {
      break;
    }

    // ---- 4. Revise: feed the critique back to the agent ----
    if (attempt >= maxRevisions) {
      trail.push({
        kind: "exhausted",
        role: "showrunner",
        body: `Revision budget exhausted after ${maxRevisions} round(s).`,
        attempt,
      });
      break;
    }
    revisions++;
    currentInput = injectCritique<TIn>(
      currentInput,
      verdict.output.rationale,
      verdict.output.notes
    );
  }

  // ---- 5. Persist decisions to project memory ----
  let memoryEntryId: string | undefined;
  if (persist) {
    const approved = lastDecision?.decision === "approve";

    // The "what" — only stored as approved canon if the Showrunner approved.
    if (approved && lastOutput !== undefined) {
      const row = await writeMemory({
        projectId: ctx.projectId,
        scope: "project",
        kind: "note",
        text: `[${agent.role}] ${lastDecision!.rationale}`,
        body: {
          agent: agent.role,
          output: lastOutput,
          decision: lastDecision,
          revisions,
        },
        approved: true,
        authoredBy: ctx.user?.id ?? null,
        authoredRole: "showrunner",
      });
      memoryEntryId = row.id;
    }

    // The "what was decided" — always recorded, approved=false, so the
    // arbitration history is queryable from project memory.
    await writeMemory({
      projectId: ctx.projectId,
      scope: "project",
      kind: "note",
      text: `Showrunner ${lastDecision?.decision ?? "unknown"}: ${
        lastDecision?.rationale ?? "(no rationale)"
      }`,
      body: {
        kind: "arbitration_record",
        agent: agent.role,
        decision: lastDecision,
        revisions,
        trail: trail.map((s) => ({
          kind: s.kind,
          role: s.role,
          body: s.body,
          attempt: s.attempt,
        })),
      },
      approved: false,
      authoredBy: ctx.user?.id ?? null,
      authoredRole: "showrunner",
    });
  }

  return {
    output: lastOutput as TOut,
    decision: lastDecision as ShowrunnerDecision,
    approved: lastDecision?.decision === "approve",
    revisions,
    trail,
    memoryEntryId,
  };
}

/**
 * Add the Showrunner critique into the next agent input. Most agent input
 * shapes are objects — we just attach a `critique` field and a `revision`
 * counter. Agents are prompted to honor `critique` in their system prompt.
 */
function injectCritique<T>(input: T, rationale: string, notes?: string[]): T {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      ...(input as Record<string, unknown>),
      critique: rationale,
      critiqueNotes: notes ?? [],
    } as T;
  }
  return input;
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
