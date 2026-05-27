import { callLLM, extractJSON } from "../llm/provider.js";
import { buildContextBlock } from "./prompts.js";
import { TOOLBELT } from "./toolbelt.js";
import type { Agent, AgentContext, AgentRunResult } from "./types.js";

/**
 * Run a single agent end-to-end.
 *
 * The runner:
 *   - validates input against the agent's input schema
 *   - assembles the system + context prompt
 *   - calls the LLM with JSON-schema output
 *   - parses + validates the response
 *   - invokes any post-run hook (e.g. canon writes)
 *
 * Tool use is deliberately kept simple in this runner: agents can call tools
 * by emitting a `tool_calls` array inside their JSON response, which the
 * runner executes and re-calls the model with the results. This mirrors the
 * core LangGraph "tool" node pattern without the dependency.
 */
export async function runAgent<TIn, TOut>(
  agent: Agent<TIn, TOut>,
  input: TIn,
  ctx: AgentContext,
  opts: { maxToolRounds?: number; temperature?: number } = {}
): Promise<AgentRunResult<TOut>> {
  const inputParse = agent.inputSchema.safeParse(input);
  if (!inputParse.success) {
    throw new Error(
      `Agent ${agent.role} input invalid: ${inputParse.error.message}`
    );
  }

  const toolDescriptions = agent.toolNames
    .map((n) => TOOLBELT[n])
    .filter(Boolean)
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  input: ${schemaSummary(t.inputSchema)}`
    )
    .join("\n");

  const systemPrompt = [
    agent.systemPrompt(ctx),
    "",
    "## Available tools",
    toolDescriptions || "(none)",
    "",
    "## Output format",
    "Respond with a single JSON object of the shape:",
    `{
  "tool_calls": [{"name": "<tool>", "input": { ... }}],  // optional; runner executes and re-prompts you
  "result": { ... }                                       // required when you are done
}`,
    "",
    "When you include any `tool_calls`, omit `result`. Once you have what",
    "you need, respond again with just `result` (and no tool_calls).",
    "",
    buildContextBlock(ctx),
  ].join("\n");

  const maxRounds = opts.maxToolRounds ?? 3;
  const toolCalls: Array<{ name: string; input: unknown; output: unknown }> = [];

  let userTurn =
    "Input:\n```json\n" + JSON.stringify(inputParse.data, null, 2) + "\n```";

  let lastResponse: { text: string; raw: unknown; usage?: { input?: number; output?: number } } | null = null;

  for (let round = 0; round <= maxRounds; round++) {
    const res = await callLLM({
      model: agent.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userTurn },
      ],
      temperature: opts.temperature ?? 0.7,
      maxTokens: 4096,
    });
    lastResponse = res;

    let parsed: { tool_calls?: Array<{ name: string; input: unknown }>; result?: unknown };
    try {
      parsed = extractJSON(res.text);
    } catch {
      // If the model returned plain prose, wrap it as a result so we don't
      // crash — the agent's outputSchema will reject if it's invalid.
      parsed = { result: { _raw: res.text } };
    }

    const requested = parsed.tool_calls ?? [];
    if (requested.length && round < maxRounds) {
      const toolResults: Array<{ name: string; output: unknown }> = [];
      for (const call of requested) {
        const tool = TOOLBELT[call.name];
        if (!tool) {
          toolResults.push({ name: call.name, output: { error: "unknown_tool" } });
          continue;
        }
        if (tool.allowedRoles && !tool.allowedRoles.includes(agent.role)) {
          toolResults.push({ name: call.name, output: { error: "forbidden_for_role" } });
          continue;
        }
        try {
          const validated = tool.inputSchema.parse(call.input);
          const output = await tool.execute(validated, ctx);
          toolResults.push({ name: call.name, output });
          toolCalls.push({ name: call.name, input: validated, output });
        } catch (err) {
          toolResults.push({
            name: call.name,
            output: { error: (err as Error).message },
          });
        }
      }
      userTurn = `Tool results:\n\`\`\`json\n${JSON.stringify(
        toolResults,
        null,
        2
      )}\n\`\`\`\n\nNow produce your final \`result\` JSON.`;
      continue;
    }

    // Schema validation. On failure, try one self-correction round: tell the
    // model exactly which fields were wrong and re-prompt for the result only.
    let outParse = agent.outputSchema.safeParse(parsed.result);
    if (!outParse.success && round < maxRounds) {
      const issues = outParse.error.issues
        .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      userTurn =
        `Your previous \`result\` failed schema validation:\n${issues}\n\n` +
        `Return a corrected \`result\` JSON only. Do not include tool_calls.`;
      continue;
    }
    if (!outParse.success) {
      throw new Error(
        `Agent ${agent.role} output invalid after ${maxRounds} attempt(s): ${outParse.error.message}\n` +
          `Raw output: ${truncate(JSON.stringify(parsed.result), 500)}`
      );
    }

    if (agent.afterRun) await agent.afterRun(outParse.data, ctx);

    return {
      output: outParse.data,
      toolCalls,
      usage: res.usage,
      raw: res.raw,
    };
  }

  throw new Error(
    `Agent ${agent.role} exceeded ${maxRounds} tool rounds without final result`
  );
}

function schemaSummary(s: unknown): string {
  // The zod type has a `_def` but we don't need full JSON-schema generation
  // for the prompt — a short string is plenty.
  try {
    const def = (s as { _def?: { typeName?: string } })._def;
    return def?.typeName ?? "object";
  } catch {
    return "object";
  }
}

function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
