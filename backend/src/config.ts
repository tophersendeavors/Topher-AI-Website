import "dotenv/config";
import { z } from "zod";

const env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(8787),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  SUPABASE_JWT_SECRET: z.string().min(10),

  EMBEDDING_PROVIDER: z.enum(["openai"]).default("openai"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-large"),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(3072),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  SHOWRUNNER_MODEL: z.string().default("claude-opus-4-7"),
  CONCEPT_MODEL: z.string().default("claude-sonnet-4-6"),
  CHARACTER_MODEL: z.string().default("claude-sonnet-4-6"),
  WORLD_MODEL: z.string().default("claude-sonnet-4-6"),
  PLOT_MODEL: z.string().default("claude-sonnet-4-6"),
  SCENE_MODEL: z.string().default("claude-sonnet-4-6"),
  DIALOGUE_MODEL: z.string().default("claude-sonnet-4-6"),
  SCRIPT_DOCTOR_MODEL: z.string().default("claude-opus-4-7"),
  CONTINUITY_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  PRODUCER_MODEL: z.string().default("claude-sonnet-4-6"),

  // ---------- Emotional Intelligence Layer ----------
  EMOTIONAL_TRUTH_MODEL: z.string().default("claude-opus-4-7"),
  SUBTEXT_MODEL: z.string().default("claude-sonnet-4-6"),
  CHARACTER_WOUND_MODEL: z.string().default("claude-opus-4-7"),
  BEHAVIOR_MODEL: z.string().default("claude-sonnet-4-6"),
  RELATIONSHIP_TENSION_MODEL: z.string().default("claude-sonnet-4-6"),

  /** Reject scenes with > N critical directness violations during draft_v1. */
  EMOTIONAL_REJECTION_THRESHOLD: z.coerce.number().int().nonnegative().default(2),
});

const parsed = env.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.format());
  throw new Error("Invalid env. See backend/.env.example.");
}

export const config = parsed.data;

export const hasAnthropic = !!config.ANTHROPIC_API_KEY;
export const hasOpenAI = !!config.OPENAI_API_KEY;

if (!hasAnthropic && !hasOpenAI) {
  // eslint-disable-next-line no-console
  console.warn(
    "[config] No LLM provider key set. Agents will run in deterministic stub mode."
  );
}
