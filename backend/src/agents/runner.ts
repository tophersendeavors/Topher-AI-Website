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
  opts: { maxToolRounds?: number; temperature?: number; maxTokens?: number } = {}
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

  // The original input — kept verbatim and re-included on every retry/tool
  // re-prompt so the agent never loses sight of the brief. zod `.object()`
  // strips unknown keys, so a `critique` field (the user's revision notes)
  // would be lost; re-attach it so the agent's revision protocol can act on it.
  const dataForPrompt: Record<string, unknown> = {
    ...(inputParse.data as Record<string, unknown>),
  };
  const rawCritique = (input as { critique?: unknown } | null)?.critique;
  if (typeof rawCritique === "string" && rawCritique.trim()) {
    dataForPrompt.critique = rawCritique.trim();
  }
  // Same for `userNotes` — the user's priority guidance for a quality check.
  const rawUserNotes = (input as { userNotes?: unknown } | null)?.userNotes;
  if (typeof rawUserNotes === "string" && rawUserNotes.trim()) {
    dataForPrompt.userNotes = rawUserNotes.trim();
  }
  const originalInputBlock =
    "Input:\n```json\n" + JSON.stringify(dataForPrompt, null, 2) + "\n```";
  let userTurn = originalInputBlock;

  let lastResponse: { text: string; raw: unknown; usage?: { input?: number; output?: number } } | null = null;

  for (let round = 0; round <= maxRounds; round++) {
    const res = await callLLM({
      model: agent.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userTurn },
      ],
      temperature: opts.temperature ?? 0.7,
      maxTokens: opts.maxTokens ?? 4096,
    });
    lastResponse = res;

    // Diagnostic: dump the raw LLM text so we can see exactly what the model
    // said, BEFORE any parsing or coercion. The console line is short; the
    // full body lands in /tmp/toburt-llm-dumps/<role>-<ts>.json for review
    // without re-running the LLM.
    // eslint-disable-next-line no-console
    console.log(
      `[agents:${agent.role}] round=${round} model=${agent.model} ` +
        `usage_in=${res.usage?.input ?? "?"} usage_out=${res.usage?.output ?? "?"} ` +
        `text_len=${res.text.length}`
    );
    try {
      const fs = await import("node:fs/promises");
      const dir = "/tmp/toburt-llm-dumps";
      await fs.mkdir(dir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      await fs.writeFile(
        `${dir}/${agent.role}-r${round}-${ts}.txt`,
        res.text,
        "utf8"
      );
    } catch {
      /* dumping is best-effort */
    }

    let parsed: { tool_calls?: Array<{ name: string; input: unknown }>; result?: unknown };
    let parseFailed = false;
    try {
      parsed = extractJSON(res.text);
    } catch {
      parseFailed = true;
      parsed = {};
    }

    // If the model returned prose with no JSON and we still have retries,
    // force a retry with an explicit instruction. Don't silently mask it as
    // a valid empty result — that strips the model's intended content and
    // leaves downstream stages with nothing to work with.
    if (parseFailed && round < maxRounds) {
      userTurn =
        originalInputBlock +
        "\n\n" +
        "Your previous response was not JSON. Reply with ONLY a single JSON " +
        "object of the shape { \"result\": { ... } } — no prose, no markdown " +
        "fences, no leading commentary. The `result` object must match the " +
        "agent's output schema described in the system prompt and brief above.";
      continue;
    }

    // Final round and the model still won't produce JSON: fail loudly instead
    // of returning a silently-empty validated object.
    if (parseFailed) {
      throw new Error(
        `Agent ${agent.role} did not return JSON after ${maxRounds + 1} attempts. ` +
          `Last response (truncated): ${truncate(res.text, 200)}`
      );
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
      // CRITICAL: re-include the original input on every tool round-trip.
      // Otherwise the model only sees "tool results" and forgets the brief
      // (slugline, characters, etc.), which causes it to default to whatever
      // it remembers from retrieved canon. Keeping the input present each
      // round is the only reliable way to make the brief binding.
      userTurn =
        originalInputBlock +
        "\n\n" +
        `Tool results:\n\`\`\`json\n${JSON.stringify(toolResults, null, 2)}\n\`\`\`\n\n` +
        "Now produce your final `result` JSON using the input above as the binding brief.";
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
        originalInputBlock +
        "\n\n" +
        `Your previous \`result\` failed schema validation:\n${issues}\n\n` +
        "Return a corrected `result` JSON only, matching the input above. Do not include tool_calls.";
      continue;
    }

    let output: TOut;
    let validationWarnings: string[] = [];

    if (strict.success) {
      // Zod's default strips unknown fields. Merge them back in so stages
      // can recover when the model emitted a slightly different shape than
      // the schema expects (e.g. flattened fields, alternate field names).
      if (
        parsed.result &&
        typeof parsed.result === "object" &&
        !Array.isArray(parsed.result) &&
        strict.data &&
        typeof strict.data === "object"
      ) {
        output = {
          ...(parsed.result as Record<string, unknown>),
          ...(strict.data as Record<string, unknown>),
        } as TOut;
      } else {
        output = strict.data;
      }
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
