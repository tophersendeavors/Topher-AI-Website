import { supabase } from "../db/client.js";
import { runAgent } from "../agents/runner.js";
import { characterWoundAgent } from "../agents/characterWound.js";
import { relationshipTensionAgent } from "../agents/relationshipTension.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { parseFountain } from "../screenplay/fountain.js";

type Resolved = { name: string; id: string };

type ProjChar = { id: string; name: string };

/** Normalize a character name/cue: lowercase, strip honorifics + punctuation. */
function normName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(dr|mr|mrs|ms|miss|prof|sir|madam|capt|capt\.|lt)\.?\s+/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a fuzzy resolver from project characters. Maps a scene dialogue cue
 * (often a SHORT/UPPERCASE name like "MARGOT" or "SOLANO") to the canonical
 * full-name character id ("Margot Ellison", "Dr. Izel Solano") via token
 * overlap. THIS is the fix for Wound/Tension always reading 0: cues never
 * exact-matched the stored full names before.
 */
export function buildNameResolver(
  projectChars: ProjChar[]
): (cue: string) => string | null {
  const entries = projectChars.map((c) => {
    const full = normName(c.name);
    return { id: c.id, full, tokens: full.split(" ").filter(Boolean) };
  });
  return (cue: string): string | null => {
    const q = normName(cue);
    if (!q) return null;
    const qTokens = q.split(" ").filter(Boolean);
    const exact = entries.find((e) => e.full === q);
    if (exact) return exact.id;
    if (qTokens.length === 1) {
      const byToken = entries.find((e) => e.tokens.includes(qTokens[0]));
      if (byToken) return byToken.id;
    }
    const subset = entries.find(
      (e) =>
        qTokens.every((t) => e.tokens.includes(t)) ||
        e.tokens.every((t) => qTokens.includes(t))
    );
    if (subset) return subset.id;
    const shared = entries.find((e) => qTokens.some((t) => e.tokens.includes(t)));
    return shared ? shared.id : null;
  };
}

/**
 * Pull the relationship-tension fields out of the agent output tolerantly. The
 * model often nests them under `relationship` (or top-level) instead of the
 * schema's `tension` key, and mixes camelCase/snake_case — handle all shapes.
 */
function extractTensionFields(output: unknown): {
  unsaid: string;
  history: string | null;
  currentPower: string | null;
  tensionScore: number;
  pressurePoints: string[];
} | null {
  const o = (output ?? {}) as Record<string, unknown>;
  const t = (o.tension ?? o.relationship ?? o.relationshipTension ?? o) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const unsaid = str(t.unsaid) ?? str(t.unsaidSentence) ?? str(t.unsaid_sentence) ?? str(o.unsaid);
  if (!unsaid) return null;
  const score =
    typeof t.tensionScore === "number"
      ? t.tensionScore
      : typeof t.tension_score === "number"
      ? t.tension_score
      : 0.5;
  const pp = Array.isArray(t.pressurePoints)
    ? t.pressurePoints
    : Array.isArray(t.pressure_points)
    ? t.pressure_points
    : [];
  return {
    unsaid,
    history: str(t.history),
    currentPower: str(t.currentPower) ?? str(t.current_power),
    tensionScore: Math.max(0, Math.min(1, score)),
    pressurePoints: (pp as unknown[]).filter((x): x is string => typeof x === "string"),
  };
}

/**
 * Resolve a scene's character NAMES to project character ids (the same mapping
 * the emotional scorer uses), creating a character row for any name not yet in
 * the cast so generated wounds/tensions are findable by the scorer.
 */
async function resolveSceneCharacters(
  projectId: string,
  scriptId: string,
  ord: number
): Promise<{ resolved: Resolved[]; fountain: string }> {
  const { data: scene } = await supabase
    .from("script_scenes")
    .select("tags, fountain")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  const fountain = (scene?.fountain as string) ?? "";
  let names = ((scene?.tags as string[]) ?? []).filter(Boolean);
  if (names.length === 0) {
    // Fall back to dialogue cue names parsed from the body.
    const parsed = parseFountain(fountain);
    names = [...new Set(parsed.scenes.flatMap((s) => s.characters ?? []))];
  }
  names = [...new Set(names.map((n) => n.trim()).filter(Boolean))];

  const { data: chars } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  const projChars = (chars ?? []).map((c) => ({ id: c.id as string, name: c.name as string }));
  const resolve = buildNameResolver(projChars);
  const idToName = new Map(projChars.map((c) => [c.id, c.name]));

  const resolved: Resolved[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    // Skip combined tags like "Claire and Paul Beaumont" — they resolve to a
    // real character via the fuzzy matcher; don't create a junk row.
    const id = resolve(name);
    if (id) {
      if (!seen.has(id)) {
        seen.add(id);
        resolved.push({ name: idToName.get(id) ?? name, id });
      }
      continue;
    }
    // No match and a single, plausible name → create a character row.
    if (/\band\b/i.test(name)) continue;
    const { data: created, error } = await supabase
      .from("characters")
      .insert({ project_id: projectId, name, metadata: { source: "emotional_metadata" } })
      .select("id")
      .single();
    if (error || !created) continue;
    resolved.push({ name, id: created.id as string });
    seen.add(created.id as string);
  }
  return { resolved, fountain };
}

/**
 * Generate Character Wound profiles for the characters in a scene that don't
 * have one yet. Writes approved rows to character_wounds so the emotional
 * scorer's wound dimension can find them. Never touches scene prose.
 */
export async function generateSceneWounds(args: {
  scriptId: string;
  ord: number;
  user?: { id: string };
}): Promise<{ created: string[]; alreadyHad: string[] }> {
  const { scriptId, ord, user } = args;
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;

  const { resolved, fountain } = await resolveSceneCharacters(projectId, scriptId, ord);
  if (resolved.length === 0) {
    throw new Error("No characters found on this scene to give a wound to.");
  }

  const aCtx = await hydrateContext({
    projectId,
    collaborators: ["character_wound"],
    query: "character wound",
    user,
  });

  const created: string[] = [];
  const alreadyHad: string[] = [];
  for (const c of resolved) {
    const { data: existing } = await supabase
      .from("character_wounds")
      .select("id")
      .eq("project_id", projectId)
      .eq("character_id", c.id)
      .eq("approved", true)
      .limit(1);
    if (existing && existing.length > 0) {
      alreadyHad.push(c.name);
      continue;
    }
    const run = await runAgent(
      characterWoundAgent,
      {
        intent: "create" as const,
        characterId: c.id,
        seed: `Character: ${c.name}\n\nGround the wound in this scene:\n${fountain}`,
      },
      aCtx,
      { maxToolRounds: 1, maxTokens: 2048 }
    );
    const w = run.output?.wound;
    if (!w?.wound || !w.fear || !w.unmetNeed || !w.shameTrigger) continue;
    await supabase.from("character_wounds").insert({
      project_id: projectId,
      character_id: c.id,
      kind: w.kind ?? "custom",
      wound: w.wound,
      fear: w.fear,
      unmet_need: w.unmetNeed,
      shame_trigger: w.shameTrigger,
      defenses: Array.isArray(w.defenses) ? w.defenses : [],
      behavioral_signatures: Array.isArray(w.behavioralSignatures) ? w.behavioralSignatures : [],
      approved: true,
      authored_by: user?.id ?? null,
      authored_role: "character_wound",
    });
    created.push(c.name);
  }
  return { created, alreadyHad };
}

/**
 * Generate Relationship Tension ("the sentence neither will say") for the
 * character pairs present in a scene. Writes approved rows to
 * relationship_tensions so the scorer's tension dimension can find them.
 */
export async function generateSceneTension(args: {
  scriptId: string;
  ord: number;
  user?: { id: string };
}): Promise<{ created: string[]; alreadyHad: string[] }> {
  const { scriptId, ord, user } = args;
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;

  const { resolved, fountain } = await resolveSceneCharacters(projectId, scriptId, ord);
  if (resolved.length < 2) {
    throw new Error("This scene has fewer than two characters — no relationship tension to map.");
  }

  // Existing tensions (either ordering) so we don't duplicate.
  const { data: existing } = await supabase
    .from("relationship_tensions")
    .select("a_id, b_id")
    .eq("project_id", projectId)
    .eq("approved", true);
  const haveKey = new Set<string>();
  for (const r of existing ?? []) {
    const a = r.a_id as string;
    const b = r.b_id as string;
    if (a && b) haveKey.add([a, b].sort().join("|"));
  }

  const aCtx = await hydrateContext({
    projectId,
    collaborators: ["relationship_tension"],
    query: "relationship tension",
    user,
  });

  const created: string[] = [];
  const alreadyHad: string[] = [];
  let pairCount = 0;
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      if (pairCount >= 10) break; // safety cap
      pairCount++;
      const a = resolved[i];
      const b = resolved[j];
      const key = [a.id, b.id].sort().join("|");
      const label = `${a.name} ↔ ${b.name}`;
      if (haveKey.has(key)) {
        alreadyHad.push(label);
        continue;
      }
      // Ensure a relationships row exists (idempotent on the unique key).
      await supabase
        .from("relationships")
        .upsert(
          { project_id: projectId, a_id: a.id, b_id: b.id },
          { onConflict: "project_id,a_id,b_id", ignoreDuplicates: true }
        );
      const run = await runAgent(
        relationshipTensionAgent,
        {
          intent: "map" as const,
          aId: a.id,
          bId: b.id,
          sceneFountain: fountain,
        },
        aCtx,
        { maxToolRounds: 1, maxTokens: 2048 }
      );
      const t = run.output?.tension;
      if (!t?.unsaid) continue;
      await supabase.from("relationship_tensions").insert({
        project_id: projectId,
        a_id: a.id,
        b_id: b.id,
        unsaid: t.unsaid,
        history: t.history ?? null,
        current_power: t.currentPower ?? null,
        tension_score: typeof t.tensionScore === "number" ? t.tensionScore : 0.5,
        pressure_points: Array.isArray(t.pressurePoints) ? t.pressurePoints : [],
        approved: true,
        authored_by: user?.id ?? null,
        authored_role: "relationship_tension",
      });
      created.push(label);
    }
  }
  return { created, alreadyHad };
}

/** A "main" character worth scoring — excludes combined/junk entries. */
function isMainName(name: string): boolean {
  return !!name && !/\band\b/i.test(name);
}

/**
 * Project-level metadata status — used to gate scoring with "Setup required"
 * and to power the debug readout.
 */
export async function getEmotionalMetadataStatus(projectId: string): Promise<{
  mainCharacters: string[];
  charactersWithWound: number;
  missingWounds: string[];
  woundsCount: number;
  tensionsCount: number;
  ready: boolean;
}> {
  const { data: chars } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  const main = (chars ?? []).filter((c) => isMainName(c.name as string));
  const { data: wounds } = await supabase
    .from("character_wounds")
    .select("character_id")
    .eq("project_id", projectId)
    .eq("approved", true);
  const withWound = new Set((wounds ?? []).map((w) => w.character_id as string));
  const { count: tensionsCount } = await supabase
    .from("relationship_tensions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("approved", true);
  const missingWounds = main
    .filter((c) => !withWound.has(c.id as string))
    .map((c) => c.name as string);
  return {
    mainCharacters: main.map((c) => c.name as string),
    charactersWithWound: main.filter((c) => withWound.has(c.id as string)).length,
    missingWounds,
    woundsCount: (wounds ?? []).length,
    tensionsCount: tensionsCount ?? 0,
    // Ready only when BOTH wounds (for all mains) AND tensions exist — the
    // hard rule: no metadata, no emotional score.
    ready: main.length > 0 && missingWounds.length === 0 && (tensionsCount ?? 0) > 0,
  };
}

/**
 * One-shot project setup: generate a Character Wound for every main character
 * that lacks one, plus a Relationship Tension for every key (co-occurring)
 * pair. Saves approved rows at project/character/relationship level so the
 * scorer finds them. Never touches scene prose.
 */
export async function generateProjectEmotionalMetadata(args: {
  scriptId: string;
  user?: { id: string };
}): Promise<{
  woundsCreated: string[];
  woundsExisting: string[];
  tensionsCreated: string[];
  tensionsExisting: string[];
}> {
  const { scriptId, user } = args;
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, fountain")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;
  const fountain = (script.fountain as string) ?? "";

  const { data: charsRaw } = await supabase
    .from("characters")
    .select("id, name, biography")
    .eq("project_id", projectId);
  const chars = (charsRaw ?? []).filter((c) => isMainName(c.name as string));
  const resolve = buildNameResolver(
    chars.map((c) => ({ id: c.id as string, name: c.name as string }))
  );
  const idToName = new Map(chars.map((c) => [c.id as string, c.name as string]));

  const aCtx = await hydrateContext({
    projectId,
    collaborators: ["character_wound", "relationship_tension"],
    query: "emotional metadata",
    user,
  });

  // --- Wounds for every main character ---
  const { data: existingWounds } = await supabase
    .from("character_wounds")
    .select("character_id")
    .eq("project_id", projectId)
    .eq("approved", true);
  const haveWound = new Set((existingWounds ?? []).map((w) => w.character_id as string));
  const woundsCreated: string[] = [];
  const woundsExisting: string[] = [];
  for (const c of chars) {
    if (haveWound.has(c.id as string)) {
      woundsExisting.push(c.name as string);
      continue;
    }
    const run = await runAgent(
      characterWoundAgent,
      {
        intent: "create" as const,
        characterId: c.id as string,
        seed: `Character: ${c.name}${
          c.biography ? `\nBio: ${c.biography}` : ""
        }\n\nGround the wound in this draft:\n${fountain.slice(0, 6000)}`,
      },
      aCtx,
      { maxToolRounds: 1, maxTokens: 2048 }
    );
    const w = run.output?.wound;
    if (!w?.wound || !w.fear || !w.unmetNeed || !w.shameTrigger) continue;
    await supabase.from("character_wounds").insert({
      project_id: projectId,
      character_id: c.id,
      kind: w.kind ?? "custom",
      wound: w.wound,
      fear: w.fear,
      unmet_need: w.unmetNeed,
      shame_trigger: w.shameTrigger,
      defenses: Array.isArray(w.defenses) ? w.defenses : [],
      behavioral_signatures: Array.isArray(w.behavioralSignatures) ? w.behavioralSignatures : [],
      approved: true,
      authored_by: user?.id ?? null,
      authored_role: "character_wound",
    });
    woundsCreated.push(c.name as string);
  }

  // --- Tension for key (co-occurring) pairs ---
  // Derive co-occurring pairs from FOUNTAIN cues (what the scorer reads) —
  // script_scenes.tags are often empty, which silently produced 0 pairs.
  const pairSet = new Set<string>();
  const pairs: [string, string][] = [];
  for (const scene of parseFountain(fountain).scenes) {
    const ids = [
      ...new Set((scene.characters ?? []).map(resolve).filter((x): x is string => !!x)),
    ];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("|");
        if (!pairSet.has(key)) {
          pairSet.add(key);
          pairs.push([ids[i], ids[j]]);
        }
      }
  }
  const { data: existingTensions } = await supabase
    .from("relationship_tensions")
    .select("a_id, b_id")
    .eq("project_id", projectId)
    .eq("approved", true);
  const haveTension = new Set(
    (existingTensions ?? []).map((t) => [t.a_id, t.b_id].sort().join("|"))
  );
  const tensionsCreated: string[] = [];
  const tensionsExisting: string[] = [];
  for (const [aId, bId] of pairs.slice(0, 12)) {
    const label = `${idToName.get(aId) ?? aId} ↔ ${idToName.get(bId) ?? bId}`;
    if (haveTension.has([aId, bId].sort().join("|"))) {
      tensionsExisting.push(label);
      continue;
    }
    await supabase
      .from("relationships")
      .upsert(
        { project_id: projectId, a_id: aId, b_id: bId },
        { onConflict: "project_id,a_id,b_id", ignoreDuplicates: true }
      );
    const run = await runAgent(
      relationshipTensionAgent,
      { intent: "map" as const, aId, bId, sceneFountain: fountain.slice(0, 6000) },
      aCtx,
      { maxToolRounds: 1, maxTokens: 2048 }
    );
    const t = extractTensionFields(run.output);
    if (!t?.unsaid) continue;
    await supabase.from("relationship_tensions").insert({
      project_id: projectId,
      a_id: aId,
      b_id: bId,
      unsaid: t.unsaid,
      history: t.history ?? null,
      current_power: t.currentPower ?? null,
      tension_score: typeof t.tensionScore === "number" ? t.tensionScore : 0.5,
      pressure_points: Array.isArray(t.pressurePoints) ? t.pressurePoints : [],
      approved: true,
      authored_by: user?.id ?? null,
      authored_role: "relationship_tension",
    });
    tensionsCreated.push(label);
  }

  return { woundsCreated, woundsExisting, tensionsCreated, tensionsExisting };
}

/**
 * Generate ONLY the relationship tensions for key (co-occurring) pairs that
 * don't have one yet. Project-level — never scene-by-scene. Used by the
 * "Generate missing relationship tensions" action.
 */
export async function generateProjectTensions(args: {
  scriptId: string;
  user?: { id: string };
}): Promise<{ tensionsCreated: string[]; tensionsExisting: string[] }> {
  const { scriptId, user } = args;
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, fountain")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;
  const fountain = (script.fountain as string) ?? "";

  const { data: charsRaw } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  const chars = (charsRaw ?? []).filter((c) => isMainName(c.name as string));
  const resolve = buildNameResolver(
    chars.map((c) => ({ id: c.id as string, name: c.name as string }))
  );
  const idToName = new Map(chars.map((c) => [c.id as string, c.name as string]));

  // Derive co-occurring pairs from FOUNTAIN cues (what the scorer reads) —
  // script_scenes.tags are often empty, which silently produced 0 pairs.
  const pairSet = new Set<string>();
  const pairs: [string, string][] = [];
  for (const scene of parseFountain(fountain).scenes) {
    const ids = [
      ...new Set((scene.characters ?? []).map(resolve).filter((x): x is string => !!x)),
    ];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const key = [ids[i], ids[j]].sort().join("|");
        if (!pairSet.has(key)) {
          pairSet.add(key);
          pairs.push([ids[i], ids[j]]);
        }
      }
  }
  const { data: existingTensions } = await supabase
    .from("relationship_tensions")
    .select("a_id, b_id")
    .eq("project_id", projectId)
    .eq("approved", true);
  const haveTension = new Set(
    (existingTensions ?? []).map((t) => [t.a_id, t.b_id].sort().join("|"))
  );

  const aCtx = await hydrateContext({
    projectId,
    collaborators: ["relationship_tension"],
    query: "relationship tension",
    user,
  });

  const tensionsCreated: string[] = [];
  const tensionsExisting: string[] = [];
  for (const [aId, bId] of pairs.slice(0, 12)) {
    const label = `${idToName.get(aId) ?? aId} ↔ ${idToName.get(bId) ?? bId}`;
    if (haveTension.has([aId, bId].sort().join("|"))) {
      tensionsExisting.push(label);
      continue;
    }
    await supabase
      .from("relationships")
      .upsert(
        { project_id: projectId, a_id: aId, b_id: bId },
        { onConflict: "project_id,a_id,b_id", ignoreDuplicates: true }
      );
    const run = await runAgent(
      relationshipTensionAgent,
      { intent: "map" as const, aId, bId, sceneFountain: fountain.slice(0, 6000) },
      aCtx,
      { maxToolRounds: 1, maxTokens: 2048 }
    );
    const t = extractTensionFields(run.output);
    if (!t?.unsaid) continue;
    await supabase.from("relationship_tensions").insert({
      project_id: projectId,
      a_id: aId,
      b_id: bId,
      unsaid: t.unsaid,
      history: t.history ?? null,
      current_power: t.currentPower ?? null,
      tension_score: typeof t.tensionScore === "number" ? t.tensionScore : 0.5,
      pressure_points: Array.isArray(t.pressurePoints) ? t.pressurePoints : [],
      approved: true,
      authored_by: user?.id ?? null,
      authored_role: "relationship_tension",
    });
    tensionsCreated.push(label);
  }
  return { tensionsCreated, tensionsExisting };
}
