import type { z } from "zod";
import type {
  AgentRole,
  MemoryHit,
  RoomMessage,
} from "@toburt/shared";
import type { WorkflowStageId } from "@toburt/shared";

export type { AgentRole };

export interface AgentContext {
  projectId: string;
  workflowId?: string;
  stage?: WorkflowStageId;
  showrunnerNotes?: string;
  retrievedCanon: MemoryHit[];
  retrievedDrafts: MemoryHit[];
  collaborators: AgentRole[];
  transcriptWindow: RoomMessage[];
  user?: { id: string; name?: string };
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;
  /** Allowed roles. If undefined, all agents may use it. */
  allowedRoles?: AgentRole[];
  execute(input: TInput, ctx: AgentContext): Promise<TOutput>;
}

export interface Agent<TInput = unknown, TOutput = unknown> {
  role: AgentRole;
  label: string;
  description: string;
  model: string;
  inputSchema: z.ZodSchema<TInput>;
  outputSchema: z.ZodSchema<TOutput>;
  toolNames: string[];
  systemPrompt(ctx: AgentContext): string;
  /** Provide an optional output post-processor (e.g. canon writes). */
  afterRun?(output: TOutput, ctx: AgentContext): Promise<void>;
}

export interface AgentRunResult<TOutput> {
  output: TOutput;
  toolCalls: Array<{ name: string; input: unknown; output: unknown }>;
  usage?: { input?: number; output?: number };
  raw: unknown;
}
