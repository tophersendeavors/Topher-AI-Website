// One-shot driver: runs the full production pipeline against EP01.
//
// Stages:
//   1. Load EP01 (script id 2d46587a-65b8-4980-9d13-5354ae4518f8) +
//      its single indexed scene + chain snapshot.
//   2. Cast extractor → upsert into `characters` table.
//   3. Location extractor → upsert into `locations` table.
//   4. autoBuildBriefs (existing engine) → writes briefs into
//      script.metadata.aiPrompts.briefs[1][...].
//   5. Micro-drama prompt composer → writes per-shot prompts into
//      script.metadata.aiPrompts.prompts[1][shotIndex].microDrama.
//
// Run with: npx tsx backend/scripts/runEP01ProductionPipeline.ts
//
// Prints the produced assets to stdout so the writer can verify content
// before deciding whether to batch-run EP02–EP10.

import { extractCast } from "../src/microDrama/castExtractor.js";
import { extractLocations } from "../src/microDrama/locationExtractor.js";
import { composeMicroDramaPrompt } from "../src/microDrama/promptComposer.js";
import { autoBuildBriefs } from "../src/draft/aiPrompts/engine.js";
import { supabase } from "../src/db/client.js";

const PROJECT_ID = "cbbb5f89-6e17-4b3e-bc00-2dbb55243000";
const SCRIPT_ID = "2d46587a-65b8-4980-9d13-5354ae4518f8";

async function main() {
  console.log("══════════════════════════════════════════════════════════");
  console.log("EP01 PRODUCTION PIPELINE");
  console.log("══════════════════════════════════════════════════════════\n");

  // -------- STAGE 0: load source --------
  const { data: script, error: scriptErr } = await supabase
    .from("scripts")
    .select("id, episode_id, title, fountain, metadata")
    .eq("id", SCRIPT_ID)
    .single();
  if (scriptErr) throw scriptErr;
  const chain = (script.metadata as any).chainSnapshot;
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline, int_ext, time_of_day, fountain")
    .eq("script_id", SCRIPT_ID)
    .order("ord");
  if (!scenes || scenes.length === 0) throw new Error("No scenes for EP01.");

  const { data: ep } = await supabase
    .from("episodes")
    .select("number, title")
    .eq("id", script.episode_id)
    .single();

  console.log(`Script: ${script.title}`);
  console.log(`Scenes: ${scenes.length}`);
  console.log(`Fountain: ${(script.fountain ?? "").length} chars\n`);

  // -------- STAGE 2: cast extraction --------
  console.log("─── Stage 2: Cast extractor (LLM call) ───");
  const cast = await extractCast({
    episodeNumber: ep!.number as number,
    episodeTitle: (ep!.title as string) ?? "",
    fountain: script.fountain ?? "",
    chain: {
      hook: chain.hook,
      setup: chain.setup,
      twist: chain.twist,
      cliffhanger: chain.cliffhanger,
      revealedToAudience: chain.revealedToAudience,
      withheldFromAudience: chain.withheldFromAudience,
    },
    knownCast: [],
  });
  // Defensive defaults — LLM occasionally omits fields. We backfill the
  // full extended schema so persistence + the consistency-prompt assembly
  // never see undefined.
  for (const c of cast.characters as unknown as Record<string, unknown>[]) {
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
  console.log(`Extracted ${cast.characters.length} characters.\n`);
  for (const c of cast.characters) {
    console.log(`  • ${c.name} (${c.presence})`);
    console.log(`    archetype: ${c.archetype || "(unset)"}`);
    console.log(`    visual: ${c.visualCanon || "(unset)"}`);
    console.log(`    wardrobe: ${c.wardrobe || "(unset)"}`);
    console.log(`    do-not-change: ${c.doNotChangeTraits.join("; ") || "(unset)"}`);
  }
  console.log("");

  // Build a clean Character Consistency Prompt without the "Wardrobe: ."
  // bug — only append sentences for fields that are non-empty.
  const buildConsistencyPrompt = (
    c: import("../src/microDrama/castExtractor.js").ExtractedCharacter
  ): string => {
    // If the LLM already produced a polished consistency prompt, prefer it.
    if (c.characterConsistencyPrompt && c.characterConsistencyPrompt.trim()) {
      return c.characterConsistencyPrompt.trim();
    }
    // Otherwise assemble defensively from parts.
    const parts: string[] = [];
    if (c.visualCanon?.trim()) parts.push(c.visualCanon.trim());
    if (c.wardrobe?.trim()) parts.push(`Wardrobe: ${c.wardrobe.trim()}`);
    if (c.doNotChangeTraits.length > 0) {
      parts.push(`Locked: ${c.doNotChangeTraits.join("; ")}`);
    }
    return parts.join(". ");
  };

  // Upsert into characters table — match by name within this project.
  // Top-level columns mirror the prestige Character Bible columns so the
  // existing UI surfaces all fields. metadata.dna uses snake_case keys
  // exactly as the existing PATCH /characters/:id/dna route expects.
  // metadata.visualBible holds the V2 visual structure + the new wardrobe,
  // doNotChangeTraits, negativeContinuity additions.
  const characterIds: Record<string, string> = {};
  for (const c of cast.characters) {
    const isPrincipal = c.presence === "principal";
    const consistencyPrompt = buildConsistencyPrompt(c);

    const visualBible = {
      visualCanon: {
        ageRange: c.ageRange,
        description: c.visualCanon,
      },
      movementCanon: c.movementCanon,
      characterConsistencyPrompt: consistencyPrompt,
      wardrobe: c.wardrobe,
      doNotChangeTraits: c.doNotChangeTraits,
      negativeContinuity: c.negativeContinuity,
    };
    const dna = {
      core_wound: c.coreWound,
      public_mask: c.publicMask,
      private_fear: c.privateFear,
      speech_cadence: c.speechCadence,
      how_lies: c.howLies,
      shows_vulnerability: c.showsVulnerability,
      behavioral_tics: c.behavioralTics,
      emotional_triggers: c.emotionalTriggers,
      defensive_strategies: c.defensiveStrategies,
      avoids_saying: c.avoidsSaying,
    };

    const { data: existing } = await supabase
      .from("characters")
      .select("id, metadata")
      .eq("project_id", PROJECT_ID)
      .eq("name", c.name)
      .maybeSingle();

    const updateColumns: Record<string, unknown> = {
      archetype: c.archetype,
      role: c.role || (isPrincipal ? "principal" : "voice / text"),
    };
    // Don't blow away top-level story fields when an existing row already
    // has user-written biography/wants/needs/flaw/voice_notes. Only fill
    // empty fields. This protects manually-edited profiles like Maya's.
    if (isPrincipal) {
      if (c.biography) updateColumns.biography = c.biography;
      if (c.want) updateColumns.wants = c.want;
      if (c.need) updateColumns.needs = c.need;
      if (c.flaw) updateColumns.flaw = c.flaw;
      if (c.voiceNotes) updateColumns.voice_notes = c.voiceNotes;
    }

    if (existing) {
      const meta = (existing.metadata as Record<string, unknown>) ?? {};
      const prevDna = (meta.dna as Record<string, unknown>) ?? {};
      const prevVB = (meta.visualBible as Record<string, unknown>) ?? {};
      // Only fill DNA fields that were empty before — don't overwrite the
      // writer's manual edits. For arrays, treat [] as empty.
      const mergedDna: Record<string, unknown> = { ...prevDna };
      for (const [k, v] of Object.entries(dna)) {
        const prev = prevDna[k];
        const prevEmpty =
          prev == null ||
          (typeof prev === "string" && prev.trim() === "") ||
          (Array.isArray(prev) && prev.length === 0);
        if (prevEmpty) mergedDna[k] = v;
      }
      meta.dna = mergedDna;
      meta.visualBible = { ...prevVB, ...visualBible };
      meta.entityType = (meta.entityType as string) ?? "individual";
      await supabase
        .from("characters")
        .update({ ...updateColumns, metadata: meta })
        .eq("id", existing.id);
      characterIds[c.name] = existing.id;
    } else {
      const { data: created, error: cerr } = await supabase
        .from("characters")
        .insert({
          project_id: PROJECT_ID,
          name: c.name,
          archetype: c.archetype,
          role: c.role || (isPrincipal ? "principal" : "voice / text"),
          biography: isPrincipal ? c.biography || null : null,
          wants: isPrincipal ? c.want || null : null,
          needs: isPrincipal ? c.need || null : null,
          flaw: isPrincipal ? c.flaw || null : null,
          voice_notes: c.voiceNotes || null,
          metadata: {
            entityType: "individual",
            dna,
            visualBible,
          },
        })
        .select("id")
        .single();
      if (cerr) throw cerr;
      characterIds[c.name] = created.id;
    }
  }
  console.log(`Persisted ${Object.keys(characterIds).length} character records.\n`);

  // -------- STAGE 3: location extraction --------
  console.log("─── Stage 3: Location extractor (LLM call) ───");
  const loc = await extractLocations({
    episodeNumber: ep!.number as number,
    episodeTitle: (ep!.title as string) ?? "",
    fountain: script.fountain ?? "",
    chain: {
      hook: chain.hook,
      setup: chain.setup,
      twist: chain.twist,
      cliffhanger: chain.cliffhanger,
      revealedToAudience: chain.revealedToAudience,
      withheldFromAudience: chain.withheldFromAudience,
    },
    knownLocations: [],
  });
  // Defensive defaults — the LLM occasionally omits fields. We backfill
  // empty values so the rest of the pipeline doesn't crash; the writer
  // sees the partial output and can fix it in the UI.
  for (const l of loc.locations) {
    l.kind = l.kind ?? "interior";
    l.timeOfDay = l.timeOfDay ?? "";
    l.roomLayout = l.roomLayout ?? "";
    l.lighting = l.lighting ?? "";
    l.props = Array.isArray(l.props) ? l.props : [];
    l.continuityAnchors = Array.isArray(l.continuityAnchors) ? l.continuityAnchors : [];
    l.cameraAngleOpportunities = Array.isArray(l.cameraAngleOpportunities)
      ? l.cameraAngleOpportunities
      : [];
    l.continuityNotes = l.continuityNotes ?? "";
  }
  console.log(`Extracted ${loc.locations.length} location(s).\n`);
  for (const l of loc.locations) {
    console.log(`  • ${l.name} (${l.kind} · ${l.timeOfDay})`);
    console.log(`    layout: ${l.roomLayout}`);
    console.log(`    lighting: ${l.lighting}`);
    console.log(`    props: ${l.props.map((p) => `${p.prop} (${p.position})`).join("; ")}`);
    console.log(`    continuity: ${l.continuityAnchors.join("; ")}`);
    console.log(`    angles: ${l.cameraAngleOpportunities.join("; ")}`);
  }
  console.log("");

  const locationIds: Record<string, string> = {};
  for (const l of loc.locations) {
    const { data: existing } = await supabase
      .from("locations")
      .select("id, metadata")
      .eq("project_id", PROJECT_ID)
      .eq("name", l.name)
      .maybeSingle();
    const locMeta = {
      kind: l.kind,
      timeOfDay: l.timeOfDay,
      roomLayout: l.roomLayout,
      lighting: l.lighting,
      props: l.props,
      continuityAnchors: l.continuityAnchors,
      cameraAngleOpportunities: l.cameraAngleOpportunities,
      continuityNotes: l.continuityNotes,
    };
    if (existing) {
      const meta = (existing.metadata as Record<string, unknown>) ?? {};
      meta.microDrama = locMeta;
      await supabase.from("locations").update({ metadata: meta }).eq("id", existing.id);
      locationIds[l.name] = existing.id;
    } else {
      const { data: created, error: lerr } = await supabase
        .from("locations")
        .insert({
          project_id: PROJECT_ID,
          name: l.name,
          kind: l.kind,
          description: l.roomLayout,
          metadata: { microDrama: locMeta },
        })
        .select("id")
        .single();
      if (lerr) throw lerr;
      locationIds[l.name] = created.id;
    }
  }
  console.log(`Persisted ${Object.keys(locationIds).length} location records.\n`);

  // -------- STAGE 4: shot briefs via existing autoBuildBriefs --------
  console.log("─── Stage 4: Shot briefs via autoBuildBriefs (LLM call) ───");
  const briefReport = await autoBuildBriefs({
    scriptId: SCRIPT_ID,
    sceneOrd: 1,
    opts: {
      mode: "replace",
      confirmOverwriteUserEdits: true,
      sourceStrict: true,
    },
  });
  // The engine writes briefs into script.metadata.aiPrompts.briefs[1].
  const { data: scriptAfterBriefs } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", SCRIPT_ID)
    .single();
  const briefsByShot: Record<string, any> =
    (scriptAfterBriefs?.metadata as any)?.aiPrompts?.briefs?.[1] ?? {};
  const briefList = Object.entries(briefsByShot)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => ({ shotIndex: Number(k), brief: v }));
  console.log(`Generated ${briefList.length} shot briefs.\n`);
  for (const { shotIndex, brief } of briefList) {
    console.log(`  SH${String(shotIndex + 1).padStart(2, "0")} — ${brief.primaryImage ?? "(no primary image)"}`);
    if (brief.frame) console.log(`     frame: ${brief.frame}`);
  }
  console.log("");
  console.log(`Auto-build report: ${(briefReport as any).report ?? "(none)"}\n`);

  // -------- STAGE 5: micro-drama prompts --------
  console.log("─── Stage 5: Micro-drama prompt composer (LLM call per shot) ───");
  const prompts: Array<{ shotIndex: number; output: any }> = [];
  for (const { shotIndex, brief } of briefList) {
    const out = await composeMicroDramaPrompt({
      brief: {
        id: brief.id,
        primaryImage: brief.primaryImage ?? "",
        cameraSees: brief.cameraSees ?? "",
        frame: brief.frame ?? "",
        light: brief.light ?? "",
        texture: brief.texture ?? "",
        lockedDetails: brief.lockedDetails ?? "",
        action: brief.action ?? "",
        dialogue: brief.dialogue,
        emotionalBeat: brief.emotionalBeat,
      },
      cast: cast.characters,
      location: loc.locations[0],
      withheldFromAudience: chain.withheldFromAudience,
      durationSec: 4,
    });
    prompts.push({ shotIndex, output: out });
  }
  for (const p of prompts) {
    console.log(`\n  SH${String(p.shotIndex + 1).padStart(2, "0")} (${p.output.aspectRatio}, ${p.output.durationSec}s):`);
    console.log(`  PROMPT:`);
    console.log(`    ${p.output.prompt}`);
    console.log(`  NEGATIVE:`);
    console.log(`    ${p.output.negativePrompt}`);
  }

  // Persist prompts into script.metadata.aiPrompts.prompts[1][shotIndex].microDrama
  const meta = (scriptAfterBriefs?.metadata as Record<string, unknown>) ?? {};
  const ap = ((meta as any).aiPrompts ?? {}) as Record<string, unknown>;
  const promptsMap: Record<string, Record<string, unknown>> = (ap.prompts as any) ?? {};
  promptsMap["1"] = promptsMap["1"] ?? {};
  for (const p of prompts) {
    const shotMap: Record<string, unknown> = (promptsMap["1"][String(p.shotIndex)] as any) ?? {};
    shotMap.microDrama = {
      prompt: p.output.prompt,
      negativePrompt: p.output.negativePrompt,
      aspectRatio: p.output.aspectRatio,
      durationSec: p.output.durationSec,
      generatedAt: new Date().toISOString(),
      model: "micro_drama_composer",
    };
    promptsMap["1"][String(p.shotIndex)] = shotMap;
  }
  ap.prompts = promptsMap;
  (meta as any).aiPrompts = ap;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", SCRIPT_ID);

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("PIPELINE COMPLETE");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`Characters persisted:  ${Object.keys(characterIds).length}`);
  console.log(`Locations persisted:   ${Object.keys(locationIds).length}`);
  console.log(`Shot briefs persisted: ${briefList.length}`);
  console.log(`Prompts persisted:     ${prompts.length}`);
}

main().catch((err) => {
  console.error("PIPELINE FAILED:", err);
  process.exit(1);
});
