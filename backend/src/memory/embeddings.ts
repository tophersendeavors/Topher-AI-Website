import OpenAI from "openai";
import { config, hasOpenAI } from "../config.js";

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: config.OPENAI_API_KEY! });
  return openai;
}

/**
 * Embed an array of strings. Returns one vector per input. When no embedding
 * provider is configured, returns deterministic pseudo-random vectors so the
 * rest of the pipeline keeps working in dev.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (config.EMBEDDING_PROVIDER === "openai" && hasOpenAI) {
    const client = getOpenAI();
    const res = await client.embeddings.create({
      model: config.EMBEDDING_MODEL,
      input: texts,
      dimensions: config.EMBEDDING_DIMENSIONS,
    });
    return res.data.map((d) => d.embedding);
  }

  return texts.map((t) => pseudoEmbed(t, config.EMBEDDING_DIMENSIONS));
}

/**
 * Deterministic, hash-based pseudo-embedding. Not semantically meaningful —
 * only used in dev/offline mode so the pipeline doesn't crash.
 */
function pseudoEmbed(text: string, dim: number): number[] {
  const v = new Array<number>(dim).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = (h * 16777619) >>> 0;
    v[i % dim] += ((h % 1000) - 500) / 500;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}
