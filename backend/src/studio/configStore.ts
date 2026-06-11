// Studio Builder config store. Persists the creator's studio design +
// generated concepts + the approved choice in auth user_metadata.studioConfig
// (account-level, migration-free).

import { randomUUID } from "node:crypto";
import { supabase } from "../db/client.js";
import type { StudioConfig, StudioConcept, StudioPreferences } from "@toburt/shared";
import type { ConceptDraft } from "./conceptGenerator.js";

async function loadMeta(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(`load user failed: ${error.message}`);
  return (data?.user?.user_metadata as Record<string, unknown> | null) ?? {};
}

export async function getStudioConfig(userId: string): Promise<StudioConfig | null> {
  const meta = await loadMeta(userId);
  return (meta.studioConfig as StudioConfig | undefined) ?? null;
}

async function writeConfig(userId: string, config: StudioConfig): Promise<StudioConfig> {
  const meta = await loadMeta(userId);
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, studioConfig: config },
  });
  if (error) throw new Error(`save studio config failed: ${error.message}`);
  return config;
}

/** Save preferences + a fresh batch of generated concepts. Regenerating
 *  clears the prior approval (the lot must be re-approved). */
export async function saveGeneratedConcepts(
  userId: string,
  preferences: StudioPreferences,
  drafts: ConceptDraft[]
): Promise<StudioConfig> {
  const concepts: StudioConcept[] = drafts.map((d) => ({ id: randomUUID(), ...d }));
  const prior = await getStudioConfig(userId);
  const config: StudioConfig = {
    preferences,
    concepts,
    approvedConceptId: null,
    approvedAt: null,
    logoUrl: prior?.logoUrl ?? null,
    heroImageUrl: null, // a new design invalidates the old render
    updatedAt: new Date().toISOString(),
  };
  return writeConfig(userId, config);
}

export async function approveStudioConcept(
  userId: string,
  conceptId: string
): Promise<StudioConfig> {
  const config = await getStudioConfig(userId);
  if (!config) throw new Error("No studio design yet — generate concepts first.");
  if (!config.concepts.some((c) => c.id === conceptId)) {
    throw new Error("That concept is not part of the current design.");
  }
  const next: StudioConfig = {
    ...config,
    approvedConceptId: conceptId,
    approvedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return writeConfig(userId, next);
}
