// Production Preflight Aggregator (Stage 1).
//
// Reads the existing department state for a single script (typically the
// current=true draft for an episode) and returns a 10-department report.
// No mutations. No LLM calls. Heuristic only.
//
// The aggregator is intentionally lenient: each department reports its
// OWN status; overall is the worst non-stageTwoPlanned dept. Stage-2
// departments (Art Department, Wardrobe-by-Episode) report partial without
// causing overall=missing/fail, so EP01 can ship today.

import { supabase } from "../db/client.js";
import {
  resolveProjectTypeConfig,
  isScriptApprovedForProduction,
  isScriptSpinePresent,
} from "@toburt/shared";
import {
  normalizeKey as upstreamNormalizeKey,
} from "../continuity/types.js";
import type {
  LocationBible,
  PropBible,
} from "../continuity/types.js";
import type {
  VisualWorldRules,
  ProductionDesignPassResult,
} from "../productionDesign/types.js";
import type {
  DepartmentDetails,
  DepartmentKey,
  DepartmentReport,
  DepartmentStatus,
  DraftSourceCheck,
  PreflightReport,
} from "./types.js";

// ----- helpers ------------------------------------------------------------

// Mirrors `resolveShotContinuity` in continuity/loader.ts: exact key
// match first, then a "every key-word is in slug-words" fuzzy fallback
// so "INT. MAYA'S BEDROOM - NIGHT" matches a bible stored as
// "INT_MAYA_BEDROOM_NIGHT" (no apostrophe S).
function findLocationBibleForSlugline(
  slugline: string,
  bibles: Record<string, LocationBible>
): LocationBible | null {
  const norm = upstreamNormalizeKey(slugline);
  if (!norm) return null;
  if (bibles[norm]) return bibles[norm];
  const slugWords = norm.split("_").filter(Boolean);
  for (const [k, b] of Object.entries(bibles)) {
    const kWords = k.split("_").filter(Boolean);
    if (kWords.length > 0 && kWords.every((w) => slugWords.includes(w))) {
      return b;
    }
  }
  return null;
}

function propKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function pickWorst(a: DepartmentStatus, b: DepartmentStatus): DepartmentStatus {
  const rank: Record<DepartmentStatus, number> = {
    ready: 0,
    partial: 1,
    missing: 2,
    fail: 3,
  };
  return rank[a] >= rank[b] ? a : b;
}

function statusFromCounts(args: {
  total: number;
  populated: number;
  /** When true, missing fields are a fail, not partial. */
  required?: boolean;
}): DepartmentStatus {
  if (args.total === 0) return "missing";
  if (args.populated === args.total) return "ready";
  if (args.populated === 0) return args.required ? "fail" : "missing";
  return "partial";
}

// ----- main aggregator ----------------------------------------------------

export async function runPreflight(scriptId: string): Promise<PreflightReport> {
  // 1. Load the script row + project + episodes for draft-source check.
  const { data: script, error: scriptErr } = await supabase
    .from("scripts")
    .select("id, project_id, episode_id, current, draft_number, title, metadata")
    .eq("id", scriptId)
    .single();
  if (scriptErr) throw new Error(`Script ${scriptId} not found: ${scriptErr.message}`);

  const projectId = script.project_id as string;
  const episodeId = (script.episode_id as string | null) ?? null;
  const inspectedDraftLabel =
    script.draft_number != null ? `Draft ${script.draft_number}` : (script.title as string | null) ?? null;

  const { data: project } = await supabase
    .from("projects")
    .select("metadata, kind")
    .eq("id", projectId)
    .single();
  const projectMeta = (project?.metadata ?? {}) as Record<string, unknown>;
  // Project-type adapter — drives Stage 1 (Story) approval logic.
  const ptConfig = resolveProjectTypeConfig(
    projectMeta.projectType as string | undefined,
    project?.kind as string | undefined
  );

  // Episode row for label (optional — null for non-episode scripts).
  let episodeNumber: number | null = null;
  let episodeTitle: string | null = null;
  if (episodeId) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number, title")
      .eq("id", episodeId)
      .maybeSingle();
    episodeNumber = (ep?.number as number | undefined) ?? null;
    episodeTitle = (ep?.title as string | null) ?? null;
  }

  // Draft-source check: find the current=true script for this episode and
  // compare. If episode_id is null we treat the inspected script as the
  // current one (no notion of older drafts for non-episode scripts).
  const draftSource = await computeDraftSource({
    scriptId,
    episodeId,
    inspectedDraftLabel,
  });

  const scriptMeta = (script.metadata ?? {}) as Record<string, unknown>;
  const aiPrompts = (scriptMeta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefsByScene = (aiPrompts.briefs as Record<string, Record<string, BriefLike>> | undefined) ?? {};
  const promptsByScene = (aiPrompts.prompts as Record<string, Record<string, Record<string, PromptSlot>>> | undefined) ?? {};

  // Flatten briefs for departments that walk every shot.
  const allBriefs: BriefLike[] = [];
  for (const byShot of Object.values(briefsByScene)) {
    for (const brief of Object.values(byShot ?? {})) {
      if (brief) allBriefs.push(brief);
    }
  }

  // Load scenes for the script so we can resolve LocationBibles.
  const { data: sceneRows } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", scriptId)
    .order("ord");
  const sceneSluglines = (sceneRows ?? []).map(
    (s) => (s.slugline as string | null) ?? ""
  );

  // Load all characters for the project (wardrobe / consistency-prompt check).
  const { data: chars } = await supabase
    .from("characters")
    .select("name, metadata")
    .eq("project_id", projectId);

  const departments: DepartmentReport[] = [
    checkStory({ scriptMeta, ptConfig }),
    checkScriptSupervisor({ scriptMeta, briefs: allBriefs }),
    checkProductionDesign({ projectMeta, scriptMeta, sceneSluglines }),
    checkArtDepartment({ projectMeta, sceneSluglines }),
    checkProps({ projectMeta, briefs: allBriefs }),
    checkWardrobeHmu({ characters: chars ?? [], briefs: allBriefs, episodeNumber }),
    checkCinematography({ briefs: allBriefs }),
    checkBlocking({ briefs: allBriefs }),
    checkPromptSupervisor({ briefs: allBriefs, prompts: promptsByScene }),
    checkQualityGate({ prompts: promptsByScene }),
  ];

  // Overall = worst non-stage-2 department status. Stage-2 partials
  // do not block — they're a "next stage" pill, not a "this is broken" call.
  let overall: DepartmentStatus = "ready";
  for (const d of departments) {
    if (d.stageTwoPlanned && d.status === "partial") continue;
    overall = pickWorst(overall, d.status);
  }

  // Draft-source check rolls into overall: stale draft assets bump status
  // to at least "fail" because the writer is looking at the wrong draft.
  if (!draftSource.isCurrentDraft) {
    overall = pickWorst(overall, "fail");
  }

  const allowPromptGeneration =
    overall === "ready" && draftSource.isCurrentDraft;

  return {
    scriptId,
    episodeNumber,
    episodeTitle,
    generatedAt: new Date().toISOString(),
    overall,
    departments,
    draftSource,
    allowPromptGeneration,
    notes: [],
  };
}

// ----- shared mini-types --------------------------------------------------

interface BriefLike {
  id?: string;
  primaryImage?: string;
  characters?: Array<{ name: string }>;
  shotTags?: string[];
  cameraAwareness?: string;
  eyeline?: string;
  eyelineTarget?: string;
  frame?: string;
  cameraFraming?: string;
  cameraSees?: string;
  lensSuggestion?: string;
  cameraMovement?: string;
  cameraViewZone?: string;
  visibleSetElements?: string[];
  forbiddenSetElements?: string[];
  lightingContinuity?: string;
  characterStartPosition?: string;
  characterEndPosition?: string;
  movementPath?: string;
  propPositions?: string;
  props?: string[];
  sceneOrd?: number;
  shotIndex?: number;
}

interface PromptSlot {
  current?: {
    mainPrompt?: string;
    negativePrompt?: string;
    readiness?: { ok?: boolean; issues?: string[]; score?: number };
    referenceMetadata?: unknown;
  };
}

// ----- draft-source check -------------------------------------------------

async function computeDraftSource(args: {
  scriptId: string;
  episodeId: string | null;
  inspectedDraftLabel: string | null;
}): Promise<DraftSourceCheck> {
  if (!args.episodeId) {
    return {
      isCurrentDraft: true,
      inspectedDraftLabel: args.inspectedDraftLabel,
      currentDraftLabel: args.inspectedDraftLabel,
      staleAssets: [],
    };
  }
  const { data: currentRow } = await supabase
    .from("scripts")
    .select("id, draft_number, title")
    .eq("episode_id", args.episodeId)
    .eq("current", true)
    .maybeSingle();
  const currentDraftLabel =
    currentRow?.draft_number != null
      ? `Draft ${currentRow.draft_number}`
      : (currentRow?.title as string | null) ?? null;
  const isCurrent = currentRow?.id === args.scriptId;
  return {
    isCurrentDraft: isCurrent,
    inspectedDraftLabel: args.inspectedDraftLabel,
    currentDraftLabel,
    staleAssets: isCurrent
      ? []
      : [
          `Inspected script is ${args.inspectedDraftLabel ?? "(unknown)"} but current draft for this episode is ${currentDraftLabel ?? "(unknown)"}. All briefs and prompts shown here belong to the older draft.`,
        ],
  };
}

// ----- 1. Story / Showrunner ----------------------------------------------

function checkStory(args: {
  scriptMeta: Record<string, unknown>;
  ptConfig?: ReturnType<typeof resolveProjectTypeConfig>;
}): DepartmentReport {
  const meta = args.scriptMeta;
  // Project-type adapter — micro uses `microDramaApproval` + chain;
  // prestige/mini/feature/pilot use `draftApproval` only.
  const cfg = args.ptConfig ?? resolveProjectTypeConfig(undefined, undefined);
  const stage1 = isScriptApprovedForProduction(meta, cfg);
  const spinePresent = isScriptSpinePresent(meta, cfg);
  const validation = meta.screenplayValidation as
    | {
        ok?: boolean;
        issues?: string[];
        warnings?: string[];
        notes?: string[];
      }
    | undefined;

  const reasons: string[] = [];
  const missing: string[] = [];

  const approved = stage1.approved;
  const requiresChain = cfg.scriptApprovalSource === "micro_drama_approval";

  if (!approved) {
    missing.push(
      requiresChain
        ? "Screenplay approval (Micro Drama)"
        : "Screenplay approval (writer sign-off)"
    );
  }
  if (requiresChain && !spinePresent) {
    missing.push("Story spine (hook · setup · twist · cliffhanger)");
  }
  if (!validation) missing.push("screenplayValidation");

  if (approved) reasons.push("Screenplay approved");
  if (requiresChain && spinePresent)
    reasons.push("Chain snapshot complete (spine present)");
  if (!requiresChain && approved)
    reasons.push(`${cfg.label} draft locked`);
  if (validation?.ok) reasons.push("Screenplay validator: clean");
  else if (validation && (validation.issues?.length ?? 0) > 0)
    reasons.push(`Screenplay validator: ${validation.issues!.length} issue(s)`);

  let status: DepartmentStatus;
  const spineOk = !requiresChain || spinePresent;
  if (approved && spineOk && validation?.ok !== false) status = "ready";
  else if (approved) status = "partial";
  else status = "missing";

  // Details: show the dramatic-spine fields from the chain snapshot
  // (micro only — prestige/mini have treatment/outline elsewhere).
  const details: DepartmentDetails = {};
  const chain = meta.chainSnapshot as
    | { hook?: string; setup?: string; twist?: string; cliffhanger?: string; withheldFromAudience?: string }
    | undefined;
  if (requiresChain && chain) {
    details.fields = [
      chain.hook && { label: "Hook", value: chain.hook },
      chain.setup && { label: "Setup", value: chain.setup },
      chain.twist && { label: "Twist", value: chain.twist },
      chain.cliffhanger && { label: "Cliffhanger", value: chain.cliffhanger },
      chain.withheldFromAudience && {
        label: "Withheld",
        value: chain.withheldFromAudience,
      },
    ].filter(Boolean) as Array<{ label: string; value: string }>;
  }
  if (validation?.notes?.length) {
    (details.blocks ??= []).push({
      heading: "Screenplay validator",
      body: validation.notes,
    });
  }

  return {
    key: "story",
    label: "Story / Showrunner",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 2. Script Supervisor / Continuity ----------------------------------

// Adjacent-shot continuity (Stage 2). Walks consecutive briefs and
// flags when one shot's characterEndPosition disagrees with the next
// shot's characterStartPosition. Pure heuristic: when both fields are
// populated and share NO distinctive tokens, the writer's blocking has
// a teleport. Skips pairs where either side is empty.
function checkAdjacentBlocking(briefs: BriefLike[]): { mismatches: string[] } {
  const sorted = [...briefs].sort((a, b) => {
    const sa = (a.sceneOrd ?? 0) - (b.sceneOrd ?? 0);
    if (sa !== 0) return sa;
    return (a.shotIndex ?? 0) - (b.shotIndex ?? 0);
  });
  const STOP = new Set(
    "the and with from into onto over under near her his their its them this that maya she he they a an of in on at to is are was were be been being one two three some many".split(
      /\s+/
    )
  );
  const distinctive = (s: string): Set<string> =>
    new Set(
      (s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 5 && !STOP.has(w))
    );
  const mismatches: string[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const end = (a.characterEndPosition ?? "").trim();
    const start = (b.characterStartPosition ?? "").trim();
    if (!end || !start) continue;
    const ea = distinctive(end);
    const sb = distinctive(start);
    let shared = 0;
    for (const w of ea) if (sb.has(w)) shared++;
    if (shared === 0 && ea.size >= 3 && sb.size >= 3) {
      mismatches.push(
        `Shot #${a.sceneOrd}.${a.shotIndex} → #${b.sceneOrd}.${b.shotIndex}: end "${end.slice(0, 60)}…" does not match start "${start.slice(0, 60)}…"`
      );
    }
  }
  return { mismatches };
}

function checkScriptSupervisor(args: {
  scriptMeta: Record<string, unknown>;
  briefs: BriefLike[];
}): DepartmentReport {
  const pass = args.scriptMeta.continuity as
    | { runAt?: string; summary?: Record<string, { pass: number; warning: number; fail: number }>; issues?: unknown[] }
    | undefined;

  const reasons: string[] = [];
  const missing: string[] = [];

  // Eyeline anchor required (either explicit `eyeline` or directional
  // `eyelineTarget`). cameraAwareness is OPTIONAL on the brief — the
  // composer falls back to "observational_default", which is correct
  // for prestige-drama shots. Only require an explicit cameraAwareness
  // when the brief is a phone insert / direct-to-cam / POV shot.
  const briefsWithEyeline = args.briefs.filter(
    (b) => !!(b.eyeline?.trim() || b.eyelineTarget?.trim())
  ).length;
  const total = args.briefs.length;

  if (!pass) missing.push("script.metadata.continuity (Continuity pass)");
  if (total === 0) missing.push("briefs");

  if (briefsWithEyeline < total) {
    missing.push(
      `${total - briefsWithEyeline} brief(s) missing eyeline / eyelineTarget`
    );
  }

  let fails = 0;
  let warnings = 0;
  if (pass?.summary) {
    for (const v of Object.values(pass.summary)) {
      fails += v.fail ?? 0;
      warnings += v.warning ?? 0;
    }
    reasons.push(
      `Continuity pass: ${fails} fail / ${warnings} warning across categories`
    );
  }
  reasons.push(`Eyeline + camera-awareness on ${briefsWithEyeline}/${total} briefs`);

  // Adjacent-shot continuity (Stage 2). Pure heuristic over end → start.
  const adj = checkAdjacentBlocking(args.briefs);
  if (adj.mismatches.length === 0) {
    reasons.push("Adjacent-shot blocking: continuous");
  } else {
    reasons.push(`Adjacent-shot blocking: ${adj.mismatches.length} possible mismatch(es)`);
    for (const m of adj.mismatches.slice(0, 3)) missing.push(m);
  }

  let status: DepartmentStatus;
  if (!pass || total === 0) status = "missing";
  else if (fails > 0) status = "fail";
  else if (warnings > 0 || briefsWithEyeline < total || adj.mismatches.length > 0)
    status = "partial";
  else status = "ready";

  return {
    key: "scriptSupervisor",
    label: "Script Supervisor / Continuity",
    status,
    reasons,
    missingFields: missing,
  };
}

// ----- 3. Production Designer ---------------------------------------------

function checkProductionDesign(args: {
  projectMeta: Record<string, unknown>;
  scriptMeta: Record<string, unknown>;
  sceneSluglines: string[];
}): DepartmentReport {
  const vwr = args.projectMeta.visualWorldRules as VisualWorldRules | undefined;
  const pdPass = args.scriptMeta.productionDesign as
    | ProductionDesignPassResult
    | undefined;
  const locBibles = (args.projectMeta.locationBibles as Record<string, LocationBible> | undefined) ?? {};

  const reasons: string[] = [];
  const missing: string[] = [];

  // VWR fields.
  const vwrReady =
    !!vwr &&
    (vwr.aesthetic?.length ?? 0) > 0 &&
    (vwr.lighting?.length ?? 0) > 0 &&
    (vwr.texture?.length ?? 0) > 0;
  if (!vwr) missing.push("project.metadata.visualWorldRules");
  else {
    if (!(vwr.aesthetic?.length ?? 0)) missing.push("visualWorldRules.aesthetic");
    if (!(vwr.lighting?.length ?? 0)) missing.push("visualWorldRules.lighting");
    if (!(vwr.texture?.length ?? 0)) missing.push("visualWorldRules.texture");
  }
  if (vwrReady) reasons.push("Visual World Rules complete");

  // Each scene's LocationBible (exact OR fuzzy match).
  const uniqueSluglines = [...new Set(args.sceneSluglines)].filter(
    (s) => s.length > 0
  );
  const locResolved = uniqueSluglines.filter(
    (slug) => !!findLocationBibleForSlugline(slug, locBibles)
  ).length;
  if (locResolved < uniqueSluglines.length) {
    missing.push(
      `${uniqueSluglines.length - locResolved} scene(s) without a Location Bible match`
    );
  }
  reasons.push(
    `Location Bibles resolved: ${locResolved}/${uniqueSluglines.length}`
  );

  // PD pass.
  if (!pdPass) missing.push("script.metadata.productionDesign (PD pass)");
  else
    reasons.push(
      `PD pass: ${pdPass.summary.scenesReady}/${pdPass.summary.scenesTotal} scenes ready`
    );

  let status: DepartmentStatus;
  if (!vwr) status = "missing";
  else if (!vwrReady || locResolved < uniqueSluglines.length || !pdPass) status = "partial";
  else status = "ready";

  // Details: VWR contents + per-location continuity prompt.
  const details: DepartmentDetails = {};
  if (vwr) {
    details.blocks = [];
    if (vwr.aesthetic?.length)
      details.blocks.push({ heading: "Visual World — aesthetic", body: vwr.aesthetic });
    if (vwr.forbidden?.length)
      details.blocks.push({ heading: "Visual World — forbidden", body: vwr.forbidden });
    if (vwr.lighting?.length)
      details.blocks.push({ heading: "Visual World — lighting", body: vwr.lighting });
    if (vwr.texture?.length)
      details.blocks.push({ heading: "Visual World — texture / palette", body: vwr.texture });
  }
  for (const slug of uniqueSluglines) {
    const bible = findLocationBibleForSlugline(slug, locBibles);
    if (bible) {
      (details.blocks ??= []).push({
        heading: `Location — ${bible.name}`,
        body: bible.continuityPrompt || bible.layout || "(no continuity prompt set)",
      });
    }
  }

  return {
    key: "productionDesign",
    label: "Production Designer",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 4. Art Director / Set Decorator (Stage 2 — partial by design) ------

function checkArtDepartment(args: {
  projectMeta: Record<string, unknown>;
  sceneSluglines: string[];
}): DepartmentReport {
  const locBibles = (args.projectMeta.locationBibles as Record<string, LocationBible> | undefined) ?? {};

  const reasons: string[] = [];
  const missing: string[] = [];

  // Stage 2 — now reads the structured fields directly. A bible is
  // Art-Dept ready when it has architecture, furnitureDesign, AND
  // setDressing populated (each is a discrete object with at least one
  // non-empty key). Partial when at least one block exists; missing when
  // none do.
  const uniqueSluglines = [...new Set(args.sceneSluglines)].filter(
    (s) => s.length > 0
  );
  let ready = 0;
  let partial = 0;
  const incomplete: string[] = [];
  for (const slug of uniqueSluglines) {
    const bible = findLocationBibleForSlugline(slug, locBibles);
    if (!bible) {
      incomplete.push(`${slug} (no bible)`);
      continue;
    }
    const a = (bible as unknown as { architecture?: Record<string, unknown> }).architecture;
    const f = (bible as unknown as { furnitureDesign?: Record<string, unknown> }).furnitureDesign;
    const s = (bible as unknown as { setDressing?: Record<string, unknown> }).setDressing;
    const hasA = !!a && Object.keys(a).length > 0;
    const hasF = !!f && Object.keys(f).length > 0;
    const hasS = !!s && Object.keys(s).length > 0;
    if (hasA && hasF && hasS) ready++;
    else if (hasA || hasF || hasS) {
      partial++;
      const need = [!hasA && "architecture", !hasF && "furnitureDesign", !hasS && "setDressing"]
        .filter(Boolean)
        .join(", ");
      incomplete.push(`${bible.name} (missing ${need})`);
    } else {
      incomplete.push(`${bible.name} (no Stage-2 structured fields)`);
    }
  }
  reasons.push(
    `Location Bibles with architecture + furnitureDesign + setDressing: ${ready}/${uniqueSluglines.length}`
  );
  if (incomplete.length) {
    missing.push(`Art-Dept fields incomplete on: ${incomplete.slice(0, 4).join("; ")}`);
  }

  let status: DepartmentStatus;
  if (uniqueSluglines.length === 0) status = "missing";
  else if (ready === uniqueSluglines.length) status = "ready";
  else if (ready > 0 || partial > 0) status = "partial";
  else status = "missing";

  // Details: surface the actual structured fields per location so the
  // writer can read what's been approved.
  const details: DepartmentDetails = { blocks: [] };
  for (const slug of uniqueSluglines) {
    const bible = findLocationBibleForSlugline(slug, locBibles);
    if (!bible) continue;
    const arch = (bible as unknown as { architecture?: Record<string, string> }).architecture;
    if (arch && Object.keys(arch).length > 0) {
      const lines: string[] = [];
      for (const [k, v] of Object.entries(arch)) {
        if (v && String(v).trim()) lines.push(`${k}: ${v}`);
      }
      if (lines.length)
        details.blocks!.push({ heading: `${bible.name} — Architecture`, body: lines });
    }
    const fd = (bible as unknown as { furnitureDesign?: Record<string, string> }).furnitureDesign;
    if (fd && Object.keys(fd).length > 0) {
      const lines: string[] = [];
      for (const [k, v] of Object.entries(fd)) {
        if (v && String(v).trim()) lines.push(`${k}: ${v}`);
      }
      if (lines.length)
        details.blocks!.push({ heading: `${bible.name} — Furniture design`, body: lines });
    }
    const sd = (bible as unknown as { setDressing?: Record<string, unknown> }).setDressing;
    if (sd && Object.keys(sd).length > 0) {
      const lines: string[] = [];
      const bedding = sd.bedding as Record<string, unknown> | undefined;
      if (bedding) {
        const bits: string[] = [];
        for (const [k, v] of Object.entries(bedding)) {
          if (v != null && String(v).trim()) bits.push(`${k}: ${v}`);
        }
        if (bits.length) lines.push(`bedding — ${bits.join("; ")}`);
      }
      for (const key of [
        "wallDecor",
        "personalObjects",
        "clutterLevel",
        "lamps",
        "curtains",
        "mirrors",
        "books",
      ]) {
        const v = sd[key];
        if (v && String(v).trim()) lines.push(`${key}: ${v}`);
      }
      const forbiddenDressing = Array.isArray(sd.forbiddenDressing)
        ? (sd.forbiddenDressing as string[])
        : [];
      if (forbiddenDressing.length) {
        lines.push(
          `forbiddenDressing (${forbiddenDressing.length} entries): ${forbiddenDressing.slice(0, 8).join(", ")}${
            forbiddenDressing.length > 8 ? "…" : ""
          }`
        );
      }
      if (lines.length)
        details.blocks!.push({ heading: `${bible.name} — Set dressing`, body: lines });
    }
  }

  return {
    key: "artDepartment",
    label: "Art Director / Set Decorator",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 5. Props -----------------------------------------------------------

function checkProps(args: {
  projectMeta: Record<string, unknown>;
  briefs: BriefLike[];
}): DepartmentReport {
  const propBibles = (args.projectMeta.propBibles as Record<string, PropBible> | undefined) ?? {};
  const reasons: string[] = [];
  const missing: string[] = [];

  // Collect every prop name referenced by any brief. We ONLY look at
  // brief.props — visibleSetElements is a free-form set-dressing list
  // (e.g. "bedding", "faint edge of nightstand if needed") and conflating
  // it with prop bibles produces dozens of spurious "missing prop" hits.
  const referenced = new Set<string>();
  for (const b of args.briefs) {
    for (const p of b.props ?? []) referenced.add(p);
  }

  // Match each referenced token to a PropBible by key OR contained name.
  const bibleNames = Object.values(propBibles).map((p) => (p.name ?? "").toLowerCase());
  const bibleKeys = new Set(Object.keys(propBibles));
  const matched: string[] = [];
  const orphans: string[] = [];
  for (const r of referenced) {
    const k = propKey(r);
    const lower = r.toLowerCase();
    if (bibleKeys.has(k)) matched.push(r);
    else if (bibleNames.some((n) => n.length > 0 && (n.includes(lower) || lower.includes(n))))
      matched.push(r);
    else orphans.push(r);
  }

  reasons.push(
    `Prop bibles: ${Object.keys(propBibles).length} entries`
  );
  reasons.push(`Referenced props with a bible: ${matched.length}/${referenced.size}`);
  if (orphans.length) {
    missing.push(
      `${orphans.length} referenced prop(s) without a bible: ${orphans.slice(0, 5).join(", ")}${orphans.length > 5 ? "…" : ""}`
    );
  }

  let status: DepartmentStatus;
  if (Object.keys(propBibles).length === 0 && referenced.size > 0) status = "missing";
  else if (orphans.length > 0) status = "partial";
  else status = "ready";

  // Details: table of every prop bible. Compact one-row-per-prop.
  const details: DepartmentDetails = {};
  const propRows: string[][] = [];
  for (const [k, p] of Object.entries(propBibles)) {
    propRows.push([
      p.name || k,
      p.homeLocation || "—",
      (p.doNotChange ?? []).length ? `${(p.doNotChange ?? []).length} locks` : "—",
      (p.episodesPresent ?? []).join(", ") || "—",
    ]);
  }
  if (propRows.length > 0) {
    details.table = {
      headers: ["Prop", "Home location", "do-not-change", "Episodes"],
      rows: propRows,
    };
  }

  return {
    key: "props",
    label: "Props",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 6. Wardrobe / Hair / Makeup (Stage 2 — partial flag) ---------------

function checkWardrobeHmu(args: {
  characters: Array<{ name: string; metadata: Record<string, unknown> | null }>;
  briefs: BriefLike[];
  episodeNumber: number | null;
}): DepartmentReport {
  const reasons: string[] = [];
  const missing: string[] = [];

  // Cast referenced across this script's briefs.
  const referenced = new Set<string>();
  for (const b of args.briefs)
    for (const c of b.characters ?? []) referenced.add(c.name.toUpperCase());

  interface VBEntry {
    wardrobe?: string;
    consistency?: string;
    wardrobeByEp?: Record<string, Record<string, unknown>>;
    hmuByEp?: Record<string, Record<string, unknown>>;
    presenceType?: string;
  }
  const byName = new Map<string, VBEntry>();
  for (const c of args.characters) {
    const vb = (c.metadata?.visualBible as Record<string, unknown> | undefined) ?? {};
    byName.set((c.name as string).toUpperCase(), {
      wardrobe: vb.wardrobe as string | undefined,
      consistency: vb.characterConsistencyPrompt as string | undefined,
      wardrobeByEp: vb.wardrobeByEpisode as Record<string, Record<string, unknown>> | undefined,
      hmuByEp: vb.hmuByEpisode as Record<string, Record<string, unknown>> | undefined,
      presenceType: vb.presenceType as string | undefined,
    });
  }

  // Voice-only / text-only characters are intentionally invisible — they
  // do not need wardrobe or HMU fields.
  const isInvisibleByDesign = (e?: VBEntry): boolean =>
    e?.presenceType === "voice_only" || e?.presenceType === "text_only";

  const epKey = args.episodeNumber != null ? String(args.episodeNumber) : null;

  let baselineReady = 0;
  let perEpReady = 0;
  const baselineMissing: string[] = [];
  const perEpMissing: string[] = [];
  let visibleConsidered = 0;
  for (const name of referenced) {
    const e = byName.get(name);
    if (isInvisibleByDesign(e)) continue;
    visibleConsidered++;
    const baseOk =
      !!e &&
      !!(e.wardrobe && e.wardrobe.trim()) &&
      !!(e.consistency && e.consistency.trim());
    if (baseOk) baselineReady++;
    else baselineMissing.push(name);
    // Per-episode block — required when we know the episode number.
    if (epKey) {
      const w = e?.wardrobeByEp?.[epKey];
      const h = e?.hmuByEp?.[epKey];
      const epOk =
        !!w &&
        Object.keys(w).length > 0 &&
        !!h &&
        Object.keys(h).length > 0;
      if (epOk) perEpReady++;
      else perEpMissing.push(name);
    }
  }

  reasons.push(
    `Visible characters w/ wardrobe + consistency: ${baselineReady}/${visibleConsidered}`
  );
  if (epKey) {
    reasons.push(
      `Visible characters w/ wardrobeByEpisode["${epKey}"] + hmuByEpisode["${epKey}"]: ${perEpReady}/${visibleConsidered}`
    );
  }
  if (baselineMissing.length)
    missing.push(`Wardrobe/consistency incomplete for: ${baselineMissing.join(", ")}`);
  if (epKey && perEpMissing.length)
    missing.push(`Per-episode wardrobe/HMU missing for: ${perEpMissing.join(", ")}`);

  let status: DepartmentStatus;
  if (visibleConsidered === 0) status = "missing";
  else if (
    baselineReady === visibleConsidered &&
    (!epKey || perEpReady === visibleConsidered)
  )
    status = "ready";
  else status = "partial";

  // Details: per-character wardrobe + HMU for THIS episode.
  const details: DepartmentDetails = { blocks: [] };
  for (const name of referenced) {
    const e = byName.get(name);
    if (!e) continue;
    if (isInvisibleByDesign(e)) {
      details.blocks!.push({
        heading: `${name} — ${e.presenceType ?? "invisible"}`,
        body: "Character is invisible by design (voice / text only). Wardrobe + HMU intentionally omitted.",
      });
      continue;
    }
    if (epKey) {
      const w = e.wardrobeByEp?.[epKey];
      const h = e.hmuByEp?.[epKey];
      const lines: string[] = [];
      if (w) {
        const bits: string[] = [];
        for (const [k, v] of Object.entries(w)) {
          if (v == null) continue;
          if (Array.isArray(v))
            bits.push(`${k}: ${v.length === 0 ? "—" : v.join(", ")}`);
          else if (String(v).trim()) bits.push(`${k}: ${v}`);
        }
        if (bits.length) lines.push(`Wardrobe (EP${epKey}) — ${bits.join("; ")}`);
      }
      if (h) {
        const bits: string[] = [];
        for (const [k, v] of Object.entries(h)) {
          if (v == null) continue;
          if (Array.isArray(v))
            bits.push(`${k}: ${v.length === 0 ? "—" : v.join(", ")}`);
          else if (String(v).trim()) bits.push(`${k}: ${v}`);
        }
        if (bits.length) lines.push(`HMU (EP${epKey}) — ${bits.join("; ")}`);
      }
      if (lines.length === 0 && e.wardrobe) lines.push(`Project wardrobe: ${e.wardrobe}`);
      details.blocks!.push({ heading: name, body: lines });
    } else if (e.wardrobe || e.consistency) {
      const lines: string[] = [];
      if (e.wardrobe) lines.push(`Wardrobe: ${e.wardrobe}`);
      if (e.consistency)
        lines.push(`Consistency: ${e.consistency.slice(0, 240)}${e.consistency.length > 240 ? "…" : ""}`);
      details.blocks!.push({ heading: name, body: lines });
    }
  }

  return {
    key: "wardrobeHmu",
    label: "Wardrobe / Hair / Makeup",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 7. Cinematographer -------------------------------------------------

function checkCinematography(args: { briefs: BriefLike[] }): DepartmentReport {
  const reasons: string[] = [];
  const missing: string[] = [];
  const total = args.briefs.length;
  let cinemaOk = 0;
  let viewZoneOk = 0;
  for (const b of args.briefs) {
    const hasCamera =
      !!(b.frame?.trim() || b.cameraFraming?.trim() || b.cameraSees?.trim()) &&
      !!b.lensSuggestion?.trim();
    if (hasCamera) cinemaOk++;
    const hasViewZone =
      !!b.cameraViewZone?.trim() &&
      (b.visibleSetElements?.length ?? 0) > 0 &&
      !!b.lightingContinuity?.trim();
    if (hasViewZone) viewZoneOk++;
  }
  reasons.push(`Briefs with camera + lens + framing: ${cinemaOk}/${total}`);
  reasons.push(`Briefs with V4.4 view-zone metadata: ${viewZoneOk}/${total}`);
  if (cinemaOk < total)
    missing.push(`${total - cinemaOk} brief(s) missing frame/lens/cameraSees`);
  if (viewZoneOk < total)
    missing.push(
      `${total - viewZoneOk} brief(s) missing cameraViewZone/visibleSetElements/lightingContinuity`
    );

  let status: DepartmentStatus;
  if (total === 0) status = "missing";
  else if (cinemaOk === total && viewZoneOk === total) status = "ready";
  else status = "partial";

  // Details: per-brief view-zone table.
  const cineRows: string[][] = [];
  for (const b of args.briefs) {
    cineRows.push([
      `#${b.sceneOrd}.${b.shotIndex}`,
      [b.frame, b.cameraFraming].filter(Boolean).join(" / ") || "—",
      b.lensSuggestion || "—",
      b.cameraMovement || "static",
      b.cameraViewZone || "—",
    ]);
  }
  const details: DepartmentDetails = {
    table:
      cineRows.length > 0
        ? {
            headers: ["Shot", "Frame / framing", "Lens", "Movement", "View zone"],
            rows: cineRows,
          }
        : undefined,
  };

  return {
    key: "cinematography",
    label: "Cinematographer / Shot Designer",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 8. Blocking / Movement ---------------------------------------------

function checkBlocking(args: { briefs: BriefLike[] }): DepartmentReport {
  const reasons: string[] = [];
  const missing: string[] = [];
  const total = args.briefs.length;
  // Required on every shot: where the subject is and where their eyeline
  // points. characterEndPosition + movementPath are only required when
  // the shot has motion — for a static reaction CU they're naturally
  // empty, and demanding them creates noise.
  let staticOk = 0;
  let motionOk = 0;
  let motionShots = 0;
  const fieldShortage: Record<string, number> = {};
  const hasText = (v: unknown) =>
    typeof v === "string" && v.trim().length > 0;
  for (const b of args.briefs) {
    const hasStart = hasText(b.characterStartPosition);
    const hasEyeline = hasText(b.eyelineTarget);
    const hasEnd = hasText(b.characterEndPosition);
    const hasMovement = hasText(b.movementPath);

    // Heuristic: a brief has motion if movementPath OR characterEnd
    // differs from start, OR if the action mentions motion verbs.
    const hasMotion =
      hasMovement ||
      (hasEnd && b.characterEndPosition !== b.characterStartPosition);
    if (hasMotion) motionShots++;

    if (hasStart && hasEyeline) {
      if (!hasMotion) staticOk++;
      else if (hasEnd && hasMovement) motionOk++;
    }
    if (!hasStart) fieldShortage["characterStartPosition"] = (fieldShortage["characterStartPosition"] ?? 0) + 1;
    if (!hasEyeline) fieldShortage["eyelineTarget"] = (fieldShortage["eyelineTarget"] ?? 0) + 1;
    if (hasMotion && !hasEnd)
      fieldShortage["characterEndPosition (motion shot)"] = (fieldShortage["characterEndPosition (motion shot)"] ?? 0) + 1;
    if (hasMotion && !hasMovement)
      fieldShortage["movementPath (motion shot)"] = (fieldShortage["movementPath (motion shot)"] ?? 0) + 1;
  }
  const okTotal = staticOk + motionOk;
  reasons.push(
    `Blocking complete on ${okTotal}/${total} briefs (${staticOk} static, ${motionOk} with motion of ${motionShots} flagged motion shots)`
  );
  for (const [f, n] of Object.entries(fieldShortage)) {
    if (n > 0) missing.push(`${n} brief(s) missing ${f}`);
  }

  let status: DepartmentStatus;
  if (total === 0) status = "missing";
  else if (okTotal === total) status = "ready";
  else status = "partial";

  // Details: per-brief blocking — start → end + eyeline.
  const blockRows: string[][] = [];
  const sortedBriefs = [...args.briefs].sort((a, b) => {
    const sa = (a.sceneOrd ?? 0) - (b.sceneOrd ?? 0);
    if (sa !== 0) return sa;
    return (a.shotIndex ?? 0) - (b.shotIndex ?? 0);
  });
  for (const b of sortedBriefs) {
    blockRows.push([
      `#${b.sceneOrd}.${b.shotIndex}`,
      (b.characterStartPosition ?? "—").slice(0, 80),
      (b.characterEndPosition ?? "—").slice(0, 80),
      (b.movementPath ?? "static").slice(0, 80),
      (b.eyelineTarget ?? "—").slice(0, 80),
    ]);
  }
  const details: DepartmentDetails = {
    table:
      blockRows.length > 0
        ? {
            headers: ["Shot", "Start", "End", "Movement", "Eyeline"],
            rows: blockRows,
          }
        : undefined,
  };

  return {
    key: "blocking",
    label: "Blocking / Movement",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}

// ----- 9. AI Video Prompt Supervisor --------------------------------------

function checkPromptSupervisor(args: {
  briefs: BriefLike[];
  prompts: Record<string, Record<string, Record<string, PromptSlot>>>;
}): DepartmentReport {
  const REQUIRED_MODELS = ["veo", "kling"];
  const reasons: string[] = [];
  const missing: string[] = [];
  const total = args.briefs.length;
  let pairsComplete = 0;
  let promptsCount = 0;
  for (const b of args.briefs) {
    const sceneOrd = b.sceneOrd ?? 0;
    const shotIndex = b.shotIndex ?? 0;
    const slot = args.prompts?.[sceneOrd]?.[shotIndex];
    const hasAll = REQUIRED_MODELS.every(
      (m) => !!slot?.[m]?.current?.mainPrompt?.trim()
    );
    if (hasAll) pairsComplete++;
    for (const m of REQUIRED_MODELS) {
      if (slot?.[m]?.current?.mainPrompt?.trim()) promptsCount++;
    }
  }
  reasons.push(`Briefs with both Veo + Kling prompts: ${pairsComplete}/${total}`);
  reasons.push(`Prompt instances persisted: ${promptsCount}`);
  if (pairsComplete < total) {
    missing.push(
      `${total - pairsComplete} brief(s) missing Veo or Kling prompt`
    );
  }

  let status: DepartmentStatus;
  if (total === 0) status = "missing";
  else if (pairsComplete === total) status = "ready";
  else status = "partial";

  return {
    key: "promptSupervisor",
    label: "AI Video Prompt Supervisor",
    status,
    reasons,
    missingFields: missing,
  };
}

// ----- 10. Quality Gate ---------------------------------------------------

function checkQualityGate(args: {
  prompts: Record<string, Record<string, Record<string, PromptSlot>>>;
}): DepartmentReport {
  const reasons: string[] = [];
  const missing: string[] = [];
  let total = 0;
  let ready = 0;
  let warnings = 0;
  let missingReadiness = 0;
  const flaggedRows: string[][] = [];
  for (const [sceneOrd, byShot] of Object.entries(args.prompts)) {
    for (const [shotIndex, byModel] of Object.entries(byShot ?? {})) {
      for (const [model, slot] of Object.entries(byModel ?? {})) {
        total++;
        const r = slot.current?.readiness;
        if (!r) {
          missingReadiness++;
          flaggedRows.push([
            `#${sceneOrd}.${shotIndex}`,
            model,
            "no readiness check stored",
          ]);
        } else if (r.ok === true) {
          ready++;
        } else {
          warnings++;
          flaggedRows.push([
            `#${sceneOrd}.${shotIndex}`,
            model,
            (r.issues ?? []).slice(0, 2).join(" · ") || "ok:false, no issues",
          ]);
        }
      }
    }
  }
  reasons.push(`Prompts passing readiness: ${ready}/${total}`);
  if (warnings > 0) reasons.push(`Prompts with readiness issues: ${warnings}`);
  if (missingReadiness > 0)
    reasons.push(`Prompts without readiness check: ${missingReadiness}`);
  if (warnings > 0)
    missing.push(`${warnings} prompt(s) flagged by the readiness gate`);

  let status: DepartmentStatus;
  if (total === 0) status = "missing";
  else if (ready === total) status = "ready";
  else if (warnings > 0) status = "partial";
  else status = "partial";

  const details: DepartmentDetails = {};
  if (flaggedRows.length > 0) {
    details.table = {
      headers: ["Shot", "Model", "Issues (first 2)"],
      rows: flaggedRows,
    };
  }

  return {
    key: "qualityGate",
    label: "Quality Gate",
    status,
    reasons,
    missingFields: missing,
    details,
  };
}
