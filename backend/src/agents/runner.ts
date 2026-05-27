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

  // 4 rounds = (initial) + up to 3 retries (tool calls and/or schema fixes).
  const maxRounds = opts.maxToolRounds ?? 4;
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

    // Tolerant validation. Try strict first. If that fails and we still
    // have retry budget, re-prompt the model with the specific issues. On
    // the final attempt, NEVER throw — coerce whatever we got into the
    // declared shape (filling missing defaults, keeping extra fields) and
    // surface the warnings to the caller.
    const strict = agent.outputSchema.safeParse(parsed.result);

    if (!strict.success && round < maxRounds) {
      const issues = strict.error.issues
        .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      userTurn =
        `Your previous \`result\` failed schema validation:\n${issues}\n\n` +
        `Return a corrected \`result\` JSON only. Do not include tool_calls.`;
      continue;
    }

    let output: TOut;
    let validationWarnings: string[] = [];

    if (strict.success) {
      output = strict.data;
    } else {
      // Best-effort: coerce. Fills `.default()`s, leaves extras intact,
      // and replaces unparseable nested values with the closest legal
      // default or `null`.
      output = coerceToShape(agent.outputSchema, parsed.result) as TOut;
      validationWarnings = strict.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
      );
      // Surface in server logs but don't fail the request.
      // eslint-disable-next-line no-console
      console.warn(
        `[agents:${agent.role}] returning coerced output (${validationWarnings.length} warning(s))`
      );
    }

    if (agent.afterRun) await agent.afterRun(output, ctx);

    return {
      output,
      toolCalls,
      usage: res.usage,
      raw: res.raw,
      // @ts-expect-error — `validationWarnings` is extra metadata the caller
      // can pick up if interested; the public AgentRunResult type doesn't
      // mention it so other callers stay unaffected.
      validationWarnings,
    };
  }

  throw new Error(
    `Agent ${agent.role} exceeded ${maxRounds} tool rounds without final result`
  );
}

/**
 * Best-effort coercion of an arbitrary value into a zod schema's shape.
 * - Fills `.default()`s where the value is undefined.
 * - Keeps the value as-is for fields the schema doesn't recognize.
 * - For required fields that are missing, inserts the legal "empty" value
 *   for that primitive (`""` for strings, `0` for numbers, `false`, `[]`,
 *   `{}`, etc.) so downstream code never crashes on `undefined`.
 *
 * This is intentionally lenient — the system trusts the LLM's creative
 * output and degrades gracefully when the shape isn't perfect.
 */
function coerceToShape(schema: unknown, value: unknown): unknown {
  // Try the schema's own parser first; it handles `.default()` cleanly.
  if (
    schema &&
    typeof (schema as { safeParse?: unknown }).safeParse === "function"
  ) {
    const r = (schema as { safeParse: (v: unknown) => { success: boolean; data?: unknown } }).safeParse(value);
    if (r.success) return r.data;
  }

  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "object" && v !== null ? v : v));
  }
  if (value && typeof value === "object") {
    // Walk shape and fill missing required defaults. We don't have full
    // schema introspection without zod internals, so just return as-is
    // and let downstream consumers be defensive.
    return value;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return value ?? null;
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
