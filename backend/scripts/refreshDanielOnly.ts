// Focused: refresh DANIEL's character record using the upgraded cast
// extractor agent (now producing 22-field principal records / slim voice-
// or-text records). Maya's existing populated fields are merge-protected —
// only Daniel actually gets updated.
//
// Run with: npx tsx backend/scripts/refreshDanielOnly.ts

import { extractCast } from "../src/microDrama/castExtractor.js";
import { supabase } from "../src/db/client.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8"; // EP01 current

const isEmpty = (v: unknown): boolean => {
  if (v == null) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
};

async function main() {
  console.log("═══ Refresh DANIEL ═══\n");

  const { data: script } = await supabase
    .from("scripts")
    .select("fountain, metadata, episode_id")
    .eq("id", SCRIPT_ID)
    .single();
  const chain = (script!.metadata as Record<string, unknown>).chainSnapshot as {
    hook: string;
    setup: string;
    twist: string;
    cliffhanger: string;
    revealedToAudience: string;
    withheldFromAudience: string;
  };
  const { data: ep } = await supabase
    .from("episodes")
    .select("number, title")
    .eq("id", script!.episode_id)
    .single();

  // Existing known cast — so the agent reuses Maya / Daniel verbatim.
  const { data: knownChars } = await supabase
    .from("characters")
    .select("name, role")
    .eq("project_id", PROJECT_ID);

  console.log(`Calling cast extractor on EP${String(ep!.number).padStart(2,"0")} "${ep!.title}"…`);
  const result = await extractCast({
    episodeNumber: ep!.number as number,
    episodeTitle: (ep!.title as string) ?? "",
    fountain: (script!.fountain as string) ?? "",
    chain,
    knownCast: (knownChars ?? []).map((c) => ({ name: c.name, role: c.role ?? undefined })),
  });
  console.log(`Extracted ${result.characters.length} characters.\n`);

  // Defensive defaults — same defaults the pipeline driver applies.
  for (const c of result.characters as unknown as Record<string, unknown>[]) {
    for (const k of [
      "archetype","role","biography","want","need","flaw","voiceNotes",
      "coreWound","publicMask","privateFear","speechCadence","howLies",
      "showsVulnerability","ageRange","visualCanon","characterConsistencyPrompt",
      "wardrobe","negativeContinuity",
    ]) c[k] = (typeof c[k] === "string" ? c[k] : "");
    for (const k of [
      "behavioralTics","emotionalTriggers","defensiveStrategies","avoidsSaying",
      "movementCanon","doNotChangeTraits",
    ]) c[k] = Array.isArray(c[k]) ? c[k] : [];
  }

  // Find Daniel specifically — the LLM may name him DANIEL (all caps) per
  // the chain. Match case-insensitively but compare strict.
  const daniel = result.characters.find((c) =>
    c.name.toUpperCase() === "DANIEL" || c.name === "Daniel"
  );
  if (!daniel) {
    console.error("Extractor returned no DANIEL record. Aborting.");
    process.exit(1);
  }

  // Build a defensive consistency prompt — no "Wardrobe: ." empty period
  // and no double-period seam ("foo.. Locked:").
  const stripTrailingPeriod = (s: string): string => s.replace(/\.\s*$/, "");
  const buildConsistencyPrompt = (c: typeof daniel): string => {
    if (c.characterConsistencyPrompt && c.characterConsistencyPrompt.trim()) {
      return c.characterConsistencyPrompt.trim();
    }
    const parts: string[] = [];
    if (c.visualCanon?.trim()) parts.push(stripTrailingPeriod(c.visualCanon.trim()));
    if (c.wardrobe?.trim()) parts.push(`Wardrobe: ${stripTrailingPeriod(c.wardrobe.trim())}`);
    if (c.doNotChangeTraits.length > 0) parts.push(`Locked: ${c.doNotChangeTraits.join("; ")}`);
    return parts.length > 0 ? parts.join(". ") + "." : "";
  };

  const consistencyPrompt = buildConsistencyPrompt(daniel);
  const isPrincipal = daniel.presence === "principal";
  const visualBible = {
    visualCanon: {
      ageRange: daniel.ageRange,
      description: daniel.visualCanon,
    },
    movementCanon: daniel.movementCanon,
    characterConsistencyPrompt: consistencyPrompt,
    wardrobe: daniel.wardrobe,
    doNotChangeTraits: daniel.doNotChangeTraits,
    negativeContinuity: daniel.negativeContinuity,
  };
  const dna = {
    core_wound: daniel.coreWound,
    public_mask: daniel.publicMask,
    private_fear: daniel.privateFear,
    speech_cadence: daniel.speechCadence,
    how_lies: daniel.howLies,
    shows_vulnerability: daniel.showsVulnerability,
    behavioral_tics: daniel.behavioralTics,
    emotional_triggers: daniel.emotionalTriggers,
    defensive_strategies: daniel.defensiveStrategies,
    avoids_saying: daniel.avoidsSaying,
  };

  // Look up Daniel's existing row.
  const { data: existing } = await supabase
    .from("characters")
    .select("id, metadata, archetype, role, biography, wants, needs, flaw, voice_notes")
    .eq("project_id", PROJECT_ID)
    .eq("name", daniel.name)
    .maybeSingle();

  // Top-level update — REFRESH semantics: overwrite all fields the agent
  // populated, so the latest improved extraction replaces legacy data.
  // (Maya's hand-typed profile lives on a separate character row and is
  // never touched by this script.)
  const update: Record<string, unknown> = {};
  if (existing) {
    if (daniel.archetype) update.archetype = daniel.archetype;
    update.role = isPrincipal ? "principal" : "voice / text";
    if (isPrincipal) {
      if (daniel.biography) update.biography = daniel.biography;
      if (daniel.want) update.wants = daniel.want;
      if (daniel.need) update.needs = daniel.need;
      if (daniel.flaw) update.flaw = daniel.flaw;
      if (daniel.voiceNotes) update.voice_notes = daniel.voiceNotes;
    } else {
      if (daniel.voiceNotes) update.voice_notes = daniel.voiceNotes;
    }
  } else {
    Object.assign(update, {
      archetype: daniel.archetype,
      role: isPrincipal ? "principal" : "voice / text",
      biography: isPrincipal ? daniel.biography || null : null,
      wants: isPrincipal ? daniel.want || null : null,
      needs: isPrincipal ? daniel.need || null : null,
      flaw: isPrincipal ? daniel.flaw || null : null,
      voice_notes: daniel.voiceNotes || null,
    });
  }

  // Strip empty strings out of array fields — sometimes the LLM emits [""]
  // when a field doesn't apply.
  const cleanArr = (a: unknown): string[] =>
    Array.isArray(a) ? (a as string[]).filter((s) => typeof s === "string" && s.trim()) : [];
  visualBible.movementCanon = cleanArr(visualBible.movementCanon);
  visualBible.doNotChangeTraits = cleanArr(visualBible.doNotChangeTraits);

  // Force-overwrite policy:
  //   • Maya is writer-edited → preserved by merge protection in the main
  //     pipeline driver.
  //   • Daniel (voice/text) has no writer-edited content yet — his existing
  //     row is legacy LLM output from the bug-era extractor. Refresh
  //     overwrites all fields directly so the new agent's improved
  //     extraction replaces it. This is correct semantically: a refresh
  //     REQUEST means the writer wants the latest agent output, not the
  //     legacy data. Maya is protected separately because the pipeline
  //     never touches characters it isn't asked to.
  const prevMeta = (existing?.metadata as Record<string, unknown>) ?? {};
  const nextMeta = {
    ...prevMeta,
    entityType: (prevMeta.entityType as string) ?? "individual",
    dna,                  // overwrite — was legacy
    visualBible,          // overwrite — was legacy
  };

  if (existing) {
    await supabase
      .from("characters")
      .update({ ...update, metadata: nextMeta })
      .eq("id", existing.id);
    console.log(`Updated existing Daniel row ${existing.id}`);
  } else {
    const { data: created, error: cerr } = await supabase
      .from("characters")
      .insert({
        project_id: PROJECT_ID,
        name: daniel.name,
        ...update,
        metadata: nextMeta,
      })
      .select("id")
      .single();
    if (cerr) throw cerr;
    console.log(`Inserted new Daniel row ${created.id}`);
  }

  // Confirm Maya was NOT touched.
  const { data: mayaCheck } = await supabase
    .from("characters")
    .select("biography, wants, metadata")
    .eq("project_id", PROJECT_ID)
    .eq("name", "Maya")
    .single();
  const mayaBioLen = (mayaCheck?.biography as string | null)?.length ?? 0;
  const mayaDnaKeys = Object.keys(
    ((mayaCheck?.metadata as Record<string, unknown>)?.dna as Record<string, unknown>) ?? {}
  ).length;
  console.log(`Maya untouched? bio=${mayaBioLen} chars, dna keys=${mayaDnaKeys} (expected: 599, 10)\n`);

  // Read Daniel back + report all fields.
  const { data: report } = await supabase
    .from("characters")
    .select("*")
    .eq("project_id", PROJECT_ID)
    .eq("name", daniel.name)
    .single();
  const m = report!.metadata as Record<string, unknown>;
  const vb = (m.visualBible ?? {}) as Record<string, unknown>;
  const d = (m.dna ?? {}) as Record<string, unknown>;
  console.log("═══ DANIEL — FULL BIBLE ═══");
  console.log(`entityType:    ${m.entityType}`);
  console.log(`archetype:     ${report!.archetype}`);
  console.log(`role:          ${report!.role}`);
  console.log(`want:          ${report!.wants ?? "(unset)"}`);
  console.log(`need:          ${report!.needs ?? "(unset)"}`);
  console.log(`flaw:          ${report!.flaw ?? "(unset)"}`);
  console.log(`voice_notes:   ${report!.voice_notes ?? "(unset)"}`);
  console.log(`biography:     ${report!.biography ?? "(unset)"}`);
  console.log("");
  console.log(`core_wound:           ${d.core_wound ?? "(unset)"}`);
  console.log(`public_mask:          ${d.public_mask ?? "(unset)"}`);
  console.log(`private_fear:         ${d.private_fear ?? "(unset)"}`);
  console.log(`speech_cadence:       ${d.speech_cadence ?? "(unset)"}`);
  console.log(`how_lies:             ${d.how_lies ?? "(unset)"}`);
  console.log(`shows_vulnerability:  ${d.shows_vulnerability ?? "(unset)"}`);
  console.log(`behavioral_tics:      ${JSON.stringify(d.behavioral_tics ?? [])}`);
  console.log(`emotional_triggers:   ${JSON.stringify(d.emotional_triggers ?? [])}`);
  console.log(`defensive_strategies: ${JSON.stringify(d.defensive_strategies ?? [])}`);
  console.log(`avoids_saying:        ${JSON.stringify(d.avoids_saying ?? [])}`);
  console.log("");
  const vc = (vb.visualCanon ?? {}) as Record<string, unknown>;
  console.log(`visualCanon.ageRange:    ${vc.ageRange ?? "(unset)"}`);
  console.log(`visualCanon.description: ${vc.description ?? "(unset)"}`);
  console.log(`movementCanon:           ${JSON.stringify(vb.movementCanon ?? [])}`);
  console.log("");
  console.log("characterConsistencyPrompt:");
  console.log(`  ${vb.characterConsistencyPrompt ?? "(unset)"}`);
  console.log("");
  console.log(`wardrobe:                ${vb.wardrobe ?? "(unset)"}`);
  console.log(`doNotChangeTraits:       ${JSON.stringify(vb.doNotChangeTraits ?? [])}`);
  console.log(`negativeContinuity:`);
  console.log(`  ${vb.negativeContinuity ?? "(unset)"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
