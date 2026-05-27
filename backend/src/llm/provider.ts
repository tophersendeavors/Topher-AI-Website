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

  const res = await client.messages.create({
    model: opts.model,
    system: sys,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.7,
    messages: turns,
  });

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
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as T;
  }
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return JSON.parse(match[1]) as T;
  const obj = trimmed.match(/\{[\s\S]*\}/);
  if (obj) return JSON.parse(obj[0]) as T;
  throw new Error("No JSON found in model output");
}
