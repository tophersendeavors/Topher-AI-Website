import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config, hasAnthropic, hasOpenAI } from "../config.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  /** When set, the LLM must return a JSON object matching this schema. */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  text: string;
  raw: unknown;
  usage?: { input?: number; output?: number };
}

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY! });
  }
  return anthropic;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({ apiKey: config.OPENAI_API_KEY! });
  }
  return openai;
}

/**
 * Provider-agnostic LLM call. Picks Anthropic for any model starting with
 * "claude-" and OpenAI for anything else, falling back to whatever is
 * configured.
 */
export async function callLLM(opts: LLMCallOptions): Promise<LLMResponse> {
  const isClaude = opts.model.startsWith("claude-");

  if (isClaude && hasAnthropic) return callAnthropic(opts);
  if (!isClaude && hasOpenAI) return callOpenAI(opts);
  if (hasAnthropic) return callAnthropic({ ...opts, model: bestClaude() });
  if (hasOpenAI) return callOpenAI({ ...opts, model: bestOpenAI() });

  // Deterministic stub for offline/test mode.
  return stubResponse(opts);
}

function bestClaude(): string {
  return config.SHOWRUNNER_MODEL || "claude-sonnet-4-6";
}

function bestOpenAI(): string {
  return "gpt-4o-mini";
}

async function callAnthropic(opts: LLMCallOptions): Promise<LLMResponse> {
  const client = getAnthropic();
  const system = opts.messages.find((m) => m.role === "system")?.content ?? "";
  const turns = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // If structured output is requested, append schema directive to the system
  // prompt — Anthropic does not yet have a native json-schema mode for all
  // models, but this is the most reliable pattern.
  const sys = opts.jsonSchema
    ? `${system}\n\nReturn ONLY a JSON object that matches this JSON Schema:\n${JSON.stringify(
        opts.jsonSchema.schema
      )}`
    : system;

  // Some Anthropic models (Opus 4.7 and later) have deprecated the
  // `temperature` parameter and reject requests that include it. Detect by
  // model id and omit when unsupported.
  const supportsTemperature = !/^claude-opus-4-(7|8|9|\d{2,})/i.test(opts.model);
  const reqBody: Record<string, unknown> = {
    model: opts.model,
    system: sys,
    max_tokens: opts.maxTokens ?? 4096,
    messages: turns,
  };
  if (supportsTemperature) {
    reqBody.temperature = opts.temperature ?? 0.7;
  }
  const res = await client.messages.create(reqBody as Parameters<typeof client.messages.create>[0]);

  const text = res.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("");
  return {
    text,
    raw: res,
    usage: {
      input: res.usage?.input_tokens,
      output: res.usage?.output_tokens,
    },
  };
}

async function callOpenAI(opts: LLMCallOptions): Promise<LLMResponse> {
  const client = getOpenAI();
  const res = await client.chat.completions.create({
    model: opts.model,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
    messages: opts.messages,
    response_format: opts.jsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: opts.jsonSchema.name,
            schema: opts.jsonSchema.schema as Record<string, unknown>,
            strict: false,
          },
        }
      : undefined,
  });

  const text = res.choices[0]?.message?.content ?? "";
  return {
    text,
    raw: res,
    usage: {
      input: res.usage?.prompt_tokens,
      output: res.usage?.completion_tokens,
    },
  };
}

function stubResponse(opts: LLMCallOptions): LLMResponse {
  const head = opts.messages.find((m) => m.role === "user")?.content ?? "";
  const echo = `[stub:${opts.model}] ${head.slice(0, 80)}`;
  // For json calls, return an empty {} so the runner doesn't crash.
  return {
    text: opts.jsonSchema ? "{}" : echo,
    raw: { stub: true },
  };
}

/**
 * Convenience: parse the first JSON object from a model response. Tolerates
 * fenced code blocks and prose around the JSON.
 */
export function extractJSON<T = unknown>(text: string): T {
  const trimmed = text.trim();

  // 1. Whole response is JSON.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return parsePartial(trimmed) as T;
    }
  }

  // 2. One or more fenced ```json ... ``` blocks. When the model emits
  //    multiple blocks (e.g. tool_calls preamble followed by a final result),
  //    we prefer whichever block contains a top-level `result` key — that's
  //    the model's final answer. The closing fence may be missing on the
  //    last block if the model hit max_tokens mid-response; collect the
  //    trailing content with parsePartial so we don't lose its result block.
  type ParsedBlock = { value: unknown };
  const parsedBlocks: ParsedBlock[] = [];

  // Collect both closed `...` blocks and a trailing unclosed `...$ block.
  const fenceOpenRe = /```(?:json)?\s*/g;
  let openMatch: RegExpExecArray | null;
  const openings: { start: number; contentStart: number }[] = [];
  while ((openMatch = fenceOpenRe.exec(trimmed)) !== null) {
    openings.push({
      start: openMatch.index,
      contentStart: openMatch.index + openMatch[0].length,
    });
  }

  if (openings.length > 0) {
    for (let i = 0; i < openings.length; i++) {
      const contentStart = openings[i].contentStart;
      const nextStart =
        i + 1 < openings.length ? openings[i + 1].start : trimmed.length;
      // Trailing closing-fence within this segment, if present.
      const segment = trimmed.slice(contentStart, nextStart);
      const closeIdx = segment.lastIndexOf("```");
      const raw = closeIdx >= 0 ? segment.slice(0, closeIdx) : segment;
      try {
        parsedBlocks.push({ value: JSON.parse(raw) });
      } catch {
        try {
          parsedBlocks.push({ value: parsePartial(raw) });
        } catch {
          /* skip unparseable */
        }
      }
    }
    // Prefer the LAST block containing a `result` key.
    for (let i = parsedBlocks.length - 1; i >= 0; i--) {
      const b = parsedBlocks[i].value;
      if (b && typeof b === "object" && "result" in (b as object)) {
        return b as T;
      }
    }
    // No result block — return the LAST parsed block (likely the final state).
    if (parsedBlocks.length > 0) {
      return parsedBlocks[parsedBlocks.length - 1].value as T;
    }
  }

  // 3. Opening fence with no closing fence (model hit max_tokens mid-output).
  const openFence = trimmed.match(/```(?:json)?\s*([\s\S]*)$/);
  if (openFence) {
    return parsePartial(openFence[1]) as T;
  }

  // 4. Embedded object — find the largest balanced `{...}` we can.
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    return parsePartial(trimmed.slice(firstBrace)) as T;
  }

  throw new Error("No JSON found in model output");
}

/**
 * Attempt to parse a JSON string that may be truncated. Walks the string
 * tracking brace/bracket depth and string state, then truncates after the
 * deepest properly-closed top-level container. As a last resort, closes
 * dangling strings/objects/arrays so the parser at least gets a structurally
 * valid prefix back.
 */
function parsePartial<T = unknown>(s: string): T {
  // Fast path: works as-is.
  try {
    return JSON.parse(s) as T;
  } catch {
    /* fall through */
  }

  let inString = false;
  let escape = false;
  const stack: string[] = []; // contents: '{' or '['
  let lastSafeEnd = -1; // position right after the last fully-closed root container

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      stack.pop();
      if (stack.length === 0) lastSafeEnd = i + 1;
    }
  }

  // We have a clean top-level close — use it.
  if (lastSafeEnd > 0) {
    try {
      return JSON.parse(s.slice(0, lastSafeEnd)) as T;
    } catch {
      /* fall through */
    }
  }

  // Synthesize a close: terminate any open string, then close every
  // outstanding container in the right order.
  let patched = s;
  if (inString) patched += '"';
  for (let i = stack.length - 1; i >= 0; i--) {
    patched += stack[i] === "{" ? "}" : "]";
  }
  try {
    return JSON.parse(patched) as T;
  } catch (err) {
    throw new Error(
      `parsePartial: could not recover JSON (${(err as Error).message})`
    );
  }
}
