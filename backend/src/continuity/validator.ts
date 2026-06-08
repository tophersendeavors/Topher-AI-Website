// Heuristic Continuity Pass. Pure-TypeScript validator that scans:
//   • characters (visualBible + DNA)
//   • location bibles
//   • prop bibles
//   • script scenes (slug, tags, fountain)
//   • shot briefs
//   • prompt versions
//
// Produces a ContinuityPassResult with severity-tagged issues, no LLM
// calls. Free, deterministic, runnable on every save.

import { supabase } from "../db/client.js";
import type {
  ContinuityIssue,
  ContinuityPassResult,
  ContinuitySeverity,
  ContinuityCategory,
  LocationBible,
  PropBible,
} from "./types.js";
import { normalizeKey } from "./types.js";

function mkIssue(
  category: ContinuityCategory,
  severity: ContinuitySeverity,
  message: string,
  where: ContinuityIssue["where"] = {},
  suggestedFix?: string
): ContinuityIssue {
  const seed = `${category}|${severity}|${message}|${JSON.stringify(where)}`;
  // Tiny deterministic id so the UI can dedupe / track across runs.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return {
    id: `c_${(h >>> 0).toString(36)}`,
    category,
    severity,
    message,
    where,
    suggestedFix,
  };
}

interface PassCtx {
  projectId: string;
  scriptId: string;
  episodeNumber: number | null;
  characters: Array<{
    name: string;
    role: string | null;
    metadata: Record<string, unknown> | null;
  }>;
  locationBibles: Record<string, LocationBible>;
  propBibles: Record<string, PropBible>;
  scenes: Array<{
    ord: number;
    slugline: string;
    fountain: string | null;
    tags: string[] | null;
  }>;
  briefsBySceneShot: Map<string, Record<string, unknown>>;
  promptsBySceneShot: Map<string, Record<string, unknown>>;
}

export async function runContinuityPass(
  scriptId: string
): Promise<ContinuityPassResult> {
  // ---- Load everything in parallel. -----------------------------------------
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, episode_id, metadata")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;

  const [{ data: proj }, { data: chars }, { data: scenes }] = await Promise.all([
    supabase.from("projects").select("metadata").eq("id", projectId).maybeSingle(),
    supabase.from("characters").select("name, role, metadata").eq("project_id", projectId),
    supabase
      .from("script_scenes")
      .select("ord, slugline, fountain, tags")
      .eq("script_id", scriptId)
      .order("ord"),
  ]);

  let episodeNumber: number | null = null;
  if (script.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", script.episode_id)
      .maybeSingle();
    if (ep) episodeNumber = (ep as { number: number }).number;
  }

  // Pull briefs + prompts from script.metadata.aiPrompts.
  const aiPrompts =
    ((script.metadata as Record<string, unknown> | null)?.aiPrompts as
      | Record<string, unknown>
      | undefined) ?? {};
  const briefsRoot = (aiPrompts.briefs as Record<string, unknown>) ?? {};
  const promptsRoot = (aiPrompts.prompts as Record<string, unknown>) ?? {};
  const briefsBySceneShot = new Map<string, Record<string, unknown>>();
  for (const [sceneOrd, byShot] of Object.entries(briefsRoot)) {
    for (const [shotIndex, brief] of Object.entries(
      byShot as Record<string, unknown>
    )) {
      briefsBySceneShot.set(`${sceneOrd}|${shotIndex}`, brief as Record<string, unknown>);
    }
  }
  const promptsBySceneShot = new Map<string, Record<string, unknown>>();
  for (const [sceneOrd, byShot] of Object.entries(promptsRoot)) {
    for (const [shotIndex, slots] of Object.entries(
      byShot as Record<string, unknown>
    )) {
      promptsBySceneShot.set(`${sceneOrd}|${shotIndex}`, slots as Record<string, unknown>);
    }
  }

  const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
  const locationBibles = (projMeta.locationBibles as Record<string, LocationBible>) ?? {};
  const propBibles = (projMeta.propBibles as Record<string, PropBible>) ?? {};

  const ctx: PassCtx = {
    projectId,
    scriptId,
    episodeNumber,
    characters: (chars ?? []) as PassCtx["characters"],
    locationBibles,
    propBibles,
    scenes: (scenes ?? []) as PassCtx["scenes"],
    briefsBySceneShot,
    promptsBySceneShot,
  };

  // ---- Run the six checks. --------------------------------------------------
  const issues: ContinuityIssue[] = [
    ...characterCheck(ctx),
    ...locationCheck(ctx),
    ...propCheck(ctx),
    ...eyelineCheck(ctx),
    ...referenceCheck(ctx),
    ...storyContainmentCheck(ctx),
  ];

  const summary: ContinuityPassResult["summary"] = {
    character: { pass: 0, warning: 0, fail: 0 },
    location: { pass: 0, warning: 0, fail: 0 },
    prop: { pass: 0, warning: 0, fail: 0 },
    eyeline: { pass: 0, warning: 0, fail: 0 },
    reference: { pass: 0, warning: 0, fail: 0 },
    story_containment: { pass: 0, warning: 0, fail: 0 },
  };
  for (const i of issues) summary[i.category][i.severity] += 1;

  return {
    runAt: new Date().toISOString(),
    runner: "heuristic",
    summary,
    issues,
  };
}

// ---------------------------------------------------------------------------
//  Check 1 — Character continuity.
// ---------------------------------------------------------------------------

function characterCheck(ctx: PassCtx): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  const charByName = new Map<string, PassCtx["characters"][number]>();
  for (const c of ctx.characters) charByName.set(c.name.toUpperCase(), c);

  for (const scene of ctx.scenes) {
    const tags = (scene.tags ?? []) as string[];
    for (const tag of tags) {
      // Scene tags include character names — confirm each is in the bible.
      const c = charByName.get(String(tag).toUpperCase());
      if (!c) {
        issues.push(
          mkIssue(
            "character",
            "warning",
            `Scene ${scene.ord} tag references "${tag}" but no character record exists.`,
            { episodeNumber: ctx.episodeNumber, sceneOrd: scene.ord, characterName: tag },
            "Create the character in the Character Bible, or remove the tag."
          )
        );
      }
    }
  }

  // Visible characters that lack ANY reference handoff fail-soft.
  for (const c of ctx.characters) {
    const vb = ((c.metadata as Record<string, unknown> | null)?.visualBible as
      | Record<string, unknown>
      | undefined) ?? {};
    const presence = (vb.presenceType as string | undefined) ?? "visible";
    if (presence !== "visible" && presence !== "physically_present") continue;
    const approvedUrl = String(vb.approvedReferenceImageUrl ?? "").trim();
    const klingId = String(vb.klingElementId ?? "").trim();
    if (!approvedUrl && !klingId) {
      issues.push(
        mkIssue(
          "character",
          "warning",
          `${c.name} is visible but has no approved reference image OR Kling Element ID. Shot generation will drift.`,
          { characterName: c.name },
          "Open Character Bible → Reference workflow and paste an approved URL or bind a Kling Element."
        )
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
//  Check 2 — Location continuity.
// ---------------------------------------------------------------------------

function locationCheck(ctx: PassCtx): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  for (const scene of ctx.scenes) {
    const slugKey = normalizeKey(scene.slugline ?? "");
    if (!slugKey) continue;
    const bible = ctx.locationBibles[slugKey] ?? matchByPartialName(scene.slugline ?? "", ctx.locationBibles);
    if (!bible) {
      issues.push(
        mkIssue(
          "location",
          "warning",
          `Scene ${scene.ord} (${scene.slugline}) has no Location Bible. Geometry will be invented per-shot.`,
          { episodeNumber: ctx.episodeNumber, sceneOrd: scene.ord, locationName: scene.slugline },
          "Open Character Bible → Continuity → Locations and seed a bible for this slugline."
        )
      );
      continue;
    }
    // For every brief in this scene, check forbidden-angle phrases.
    for (const [key, brief] of ctx.briefsBySceneShot) {
      const [sceneOrdStr, shotIdxStr] = key.split("|");
      if (Number(sceneOrdStr) !== scene.ord) continue;
      const cameraText = `${brief.frame ?? ""} ${brief.cameraFraming ?? ""} ${brief.primaryImage ?? ""}`.toLowerCase();
      for (const f of bible.forbiddenAngles ?? []) {
        const re = new RegExp(escapeRe(f.description.toLowerCase().split(/\s+/).slice(0, 3).join(" ")), "i");
        if (re.test(cameraText)) {
          issues.push(
            mkIssue(
              "location",
              "fail",
              `Scene ${scene.ord} shot ${shotIdxStr} uses forbidden camera angle "${f.label}" for ${bible.name}.`,
              {
                episodeNumber: ctx.episodeNumber,
                sceneOrd: scene.ord,
                shotIndex: Number(shotIdxStr),
                locationName: bible.name,
              },
              `Replace with one of: ${(bible.cameraSafeAngles ?? []).map((c) => c.label).join(", ")}.`
            )
          );
        }
      }
    }
  }
  return issues;
}

function matchByPartialName(
  slug: string,
  bibles: Record<string, LocationBible>
): LocationBible | undefined {
  // Allow "INT. MAYA BEDROOM - NIGHT" to find "MAYA BEDROOM" key.
  const slugWords = normalizeKey(slug).split("_").filter(Boolean);
  for (const [k, b] of Object.entries(bibles)) {
    const kWords = k.split("_").filter(Boolean);
    if (kWords.every((w) => slugWords.includes(w))) return b;
  }
  return undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
//  Check 3 — Prop continuity.
// ---------------------------------------------------------------------------

function propCheck(ctx: PassCtx): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  // Any prop mentioned in a brief that has no Prop Bible → warning.
  for (const [key, brief] of ctx.briefsBySceneShot) {
    const [sceneOrdStr, shotIdxStr] = key.split("|");
    const props = (brief.props as string[] | undefined) ?? [];
    for (const p of props) {
      const norm = normalizeKey(p);
      if (!ctx.propBibles[norm] && !matchByPartialKey(norm, ctx.propBibles)) {
        issues.push(
          mkIssue(
            "prop",
            "warning",
            `Prop "${p}" in scene ${sceneOrdStr} shot ${shotIdxStr} has no Prop Bible.`,
            {
              episodeNumber: ctx.episodeNumber,
              sceneOrd: Number(sceneOrdStr),
              shotIndex: Number(shotIdxStr),
              propName: p,
            },
            "Add a Prop Bible entry so orientation + position lock across shots."
          )
        );
      }
    }
    // Orientation mismatch: e.g. clock orientation says "facing Maya" but the
    // brief's lockedDetails / cameraSees says "facing away from Maya".
    for (const propName of Object.keys(ctx.propBibles)) {
      const pb = ctx.propBibles[propName];
      if (!pb.orientation) continue;
      const haystack = `${brief.cameraSees ?? ""} ${brief.lockedDetails ?? ""} ${(brief.props ?? []).join(" ")}`.toLowerCase();
      if (!haystack.includes(pb.name.toLowerCase())) continue;
      // Crude: if brief mentions "facing away" near the prop and bible says
      // orientation contains "facing X", warn.
      if (/facing\s+away|wrong\s+direction|flipped/.test(haystack)) {
        issues.push(
          mkIssue(
            "prop",
            "fail",
            `Brief at scene ${sceneOrdStr} shot ${shotIdxStr} contradicts prop bible orientation for "${pb.name}" (bible: "${pb.orientation}").`,
            {
              episodeNumber: ctx.episodeNumber,
              sceneOrd: Number(sceneOrdStr),
              shotIndex: Number(shotIdxStr),
              propName: pb.name,
            },
            `Restate orientation as "${pb.orientation}" in the brief.`
          )
        );
      }
    }
  }
  return issues;
}

function matchByPartialKey<T>(
  norm: string,
  bibles: Record<string, T>
): T | undefined {
  for (const [k, b] of Object.entries(bibles)) {
    if (k.includes(norm) || norm.includes(k)) return b;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
//  Check 4 — Eyeline.
// ---------------------------------------------------------------------------

function eyelineCheck(ctx: PassCtx): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  for (const [key, brief] of ctx.briefsBySceneShot) {
    const [sceneOrdStr, shotIdxStr] = key.split("|");
    const characters = (brief.characters as Array<{ name: string }> | undefined) ?? [];
    if (characters.length === 0) continue;
    const cameraAwareness = (brief.cameraAwareness as string | undefined) ?? "observational_default";
    if (cameraAwareness !== "observational_default") continue;
    const eyeline = (brief.eyeline as string | undefined) ?? "";
    const frame = `${brief.frame ?? ""} ${brief.cameraFraming ?? ""}`.toLowerCase();
    const isCloseOrEyeLevel = /close[- ]?up|ecu|extreme close|cu\b|eye[- ]?level/.test(frame);
    if (isCloseOrEyeLevel && !eyeline.trim()) {
      issues.push(
        mkIssue(
          "eyeline",
          "warning",
          `Scene ${sceneOrdStr} shot ${shotIdxStr}: close-up / eye-level shot with no eyeline declared. Model may produce direct-to-lens gaze.`,
          {
            episodeNumber: ctx.episodeNumber,
            sceneOrd: Number(sceneOrdStr),
            shotIndex: Number(shotIdxStr),
          },
          "Set brief.eyeline to where the character is looking and what motivates it."
        )
      );
    }
    // Confirm the rendered prompt doesn't contain a lens-meeting line.
    // Scan sentence-by-sentence so we can ignore negated sentences like
    // "She does not look into the lens." which are exactly what we want.
    const slots = ctx.promptsBySceneShot.get(key) ?? {};
    for (const [modelKey, slotUnknown] of Object.entries(slots)) {
      const slot = slotUnknown as { current?: { mainPrompt?: string } };
      const main = String(slot.current?.mainPrompt ?? "");
      if (!main) continue;
      const sentences = main.split(/(?<=[.!?])\s+/);
      for (const sentRaw of sentences) {
        const sent = sentRaw.toLowerCase();
        const meetsLens =
          /looks?\s+(?:directly\s+)?(?:in|into)\s+(?:the\s+)?(?:lens|camera)/.test(sent) ||
          /direct[- ]to[- ]camera/.test(sent);
        if (!meetsLens) continue;
        // Negated? "does not / doesn't / never / not look into …" → skip.
        if (
          /\b(?:does\s+not|doesn'?t|do\s+not|don'?t|never|not\s+look|no\s+direct|avoid)\b/.test(
            sent
          )
        ) {
          continue;
        }
        issues.push(
          mkIssue(
            "eyeline",
            "fail",
            `Scene ${sceneOrdStr} shot ${shotIdxStr} prompt (${modelKey}) describes character meeting the lens despite observational mode.`,
            {
              episodeNumber: ctx.episodeNumber,
              sceneOrd: Number(sceneOrdStr),
              shotIndex: Number(shotIdxStr),
            },
            "Regenerate the prompt, or patch the offending sentence."
          )
        );
        break;
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
//  Check 5 — Reference usage.
// ---------------------------------------------------------------------------

function referenceCheck(ctx: PassCtx): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];

  // Pre-index every character's reference URLs (for start-frame collision).
  const refUrls = new Map<string, string>();
  for (const c of ctx.characters) {
    const vb = ((c.metadata as Record<string, unknown> | null)?.visualBible as
      | Record<string, unknown>
      | undefined) ?? {};
    const url = String(
      vb.approvedReferenceImageUrl ?? vb.referenceImageUrl ?? ""
    ).trim();
    if (url) refUrls.set(url, c.name);
  }

  for (const [key, brief] of ctx.briefsBySceneShot) {
    const [sceneOrdStr, shotIdxStr] = key.split("|");
    const startFrame = String(brief.startFrameImage ?? "").trim();
    const endFrame = String(brief.endFrameImage ?? "").trim();
    if (startFrame && refUrls.has(startFrame)) {
      const cName = refUrls.get(startFrame);
      issues.push(
        mkIssue(
          "reference",
          "fail",
          `Scene ${sceneOrdStr} shot ${shotIdxStr}: startFrameImage points at ${cName}'s character reference image. The character reference must NOT be used as a start frame — the model will treat the portrait as the opening shot.`,
          {
            episodeNumber: ctx.episodeNumber,
            sceneOrd: Number(sceneOrdStr),
            shotIndex: Number(shotIdxStr),
            characterName: cName,
          },
          "Move this URL to characterReferenceImages, and set startFrameImage to a separate frame."
        )
      );
    }
    if (endFrame && refUrls.has(endFrame)) {
      const cName = refUrls.get(endFrame);
      issues.push(
        mkIssue(
          "reference",
          "fail",
          `Scene ${sceneOrdStr} shot ${shotIdxStr}: endFrameImage points at ${cName}'s character reference image.`,
          {
            episodeNumber: ctx.episodeNumber,
            sceneOrd: Number(sceneOrdStr),
            shotIndex: Number(shotIdxStr),
            characterName: cName,
          },
          "Move this URL to characterReferenceImages, and set endFrameImage to a separate frame."
        )
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
//  Check 6 — Story containment.
//
//  Voice-only / text-only / off-screen characters appearing as a visible
//  figure in a brief or prompt is a story-reveal failure. This catches
//  the "Daniel as visible character before reveal" trap.
// ---------------------------------------------------------------------------

function storyContainmentCheck(ctx: PassCtx): ContinuityIssue[] {
  const issues: ContinuityIssue[] = [];
  for (const c of ctx.characters) {
    const vb = ((c.metadata as Record<string, unknown> | null)?.visualBible as
      | Record<string, unknown>
      | undefined) ?? {};
    const presence = (vb.presenceType as string | undefined) ?? "visible";
    if (presence === "visible" || presence === "physically_present") continue;
    const nameUpper = c.name.toUpperCase();

    // Any brief that lists them as a visible character → fail.
    for (const [key, brief] of ctx.briefsBySceneShot) {
      const [sceneOrdStr, shotIdxStr] = key.split("|");
      const chars = (brief.characters as Array<{ name: string }> | undefined) ?? [];
      if (chars.some((ch) => ch.name.toUpperCase() === nameUpper)) {
        issues.push(
          mkIssue(
            "story_containment",
            "fail",
            `${c.name} is marked presenceType="${presence}" but listed as a visible character in scene ${sceneOrdStr} shot ${shotIdxStr}.`,
            {
              episodeNumber: ctx.episodeNumber,
              sceneOrd: Number(sceneOrdStr),
              shotIndex: Number(shotIdxStr),
              characterName: c.name,
            },
            `Remove ${c.name} from the brief's characters list, or update presenceType if the reveal is intended.`
          )
        );
      }
      // Any prompt that physically describes them → fail.
      const slots = ctx.promptsBySceneShot.get(key) ?? {};
      for (const [, slotUnknown] of Object.entries(slots)) {
        const slot = slotUnknown as { current?: { mainPrompt?: string } };
        const main = String(slot.current?.mainPrompt ?? "");
        if (!main) continue;
        // Heuristic: the character's name appearing as a subject + a body/face
        // descriptor word in the same sentence indicates physical presence.
        const sentences = main.split(/(?<=[.!?])\s+/);
        const bodyWords =
          /\b(face|body|figure|man|woman|silhouette|reflection|skin|hair|hands?|arms?|shoulders?|chest)\b/i;
        for (const sent of sentences) {
          if (
            new RegExp(`\\b${escapeRe(c.name)}\\b`, "i").test(sent) &&
            bodyWords.test(sent)
          ) {
            issues.push(
              mkIssue(
                "story_containment",
                "fail",
                `Prompt in scene ${sceneOrdStr} shot ${shotIdxStr} physically depicts ${c.name} (presenceType="${presence}").`,
                {
                  episodeNumber: ctx.episodeNumber,
                  sceneOrd: Number(sceneOrdStr),
                  shotIndex: Number(shotIdxStr),
                  characterName: c.name,
                },
                `Strip the descriptive sentence, or update ${c.name}'s presenceType if the reveal is approved.`
              )
            );
            break;
          }
        }
      }
    }
  }
  return issues;
}
