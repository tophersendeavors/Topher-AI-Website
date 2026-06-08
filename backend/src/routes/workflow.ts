// Guided Production Workflow routes (Stage 5).
//
//   GET   /scripts/:id/workflow                — full workflow report
//   POST  /scripts/:id/workflow/stages/:key/approve         — approve a stage
//   POST  /scripts/:id/workflow/stages/:key/request-changes — bounce back
//   POST  /scripts/:id/workflow/roles/:roleKey              — set role assignment
//   POST  /scripts/:id/workflow/roles-confirm               — Stage 2 confirm
//   GET   /projects/:id/canon-catalog                       — picker entries
//   GET   /workflow/creative-influences                     — preset list

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  approveStage,
  computeReviewStageGate,
  confirmRolesAssigned,
  getWorkflowReport,
  requestStageChanges,
  ROLE_REGISTRY,
  ALL_ROLE_KEYS,
  setRoleAssignment,
} from "../workflow/state.js";
import { ALL_STAGE_KEYS, type RoleKey, type StageKey } from "../workflow/types.js";
import { buildCanonCatalog } from "../workflow/canonCatalog.js";
import { extractCanonFromImage } from "../vision/extract.js";
import { computePromptImpact } from "../workflow/promptImpact.js";
import { loadResolvedCanon } from "../departments/canonResolver.js";
import {
  CREATIVE_INFLUENCES,
  influencesForRole,
} from "../workflow/creativeInfluences.js";
import { detectStalePrompts } from "../workflow/stalePrompts.js";
import { generatePromptForModel } from "../draft/aiPrompts/engine.js";
import type { ModelKey } from "@toburt/shared/aiVideoPrompts";
import {
  approveDeliverable,
  rejectDeliverable,
  regenDeliverableProposal,
  autoProposeStage,
} from "../workflow/deliverables.js";
import type { DepartmentKey } from "../departments/registry.js";

const Z_STAGE = z.enum(ALL_STAGE_KEYS as [StageKey, ...StageKey[]]);
const Z_ROLE = z.enum(ALL_ROLE_KEYS as [RoleKey, ...RoleKey[]]);

export default async function workflowRoutes(app: FastifyInstance) {
  // GET workflow report
  app.get("/scripts/:id/workflow", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    return getWorkflowReport(id);
  });

  // Approve stage
  app.post("/scripts/:id/workflow/stages/:stageKey/approve", async (req) => {
    const user = await requireUser(req);
    const { id, stageKey } = req.params as { id: string; stageKey: string };
    const k = Z_STAGE.parse(stageKey);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({ force: z.boolean().optional() })
      .parse(req.body ?? {});
    return approveStage({
      scriptId: id,
      stageKey: k,
      actorId: user.id,
      force: body.force,
    });
  });

  // Read review-stage gate status (used by frontend to disable Approve
  // and to populate the gate banner).
  app.get("/scripts/:id/workflow/stages/:stageKey/review-gate", async (req) => {
    const user = await requireUser(req);
    const { id, stageKey } = req.params as { id: string; stageKey: string };
    const k = Z_STAGE.parse(stageKey);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const gate = await computeReviewStageGate(id, k);
    return gate ?? { blockers: [], warnings: [] };
  });

  // Request changes
  app.post("/scripts/:id/workflow/stages/:stageKey/request-changes", async (req) => {
    const user = await requireUser(req);
    const { id, stageKey } = req.params as { id: string; stageKey: string };
    const k = Z_STAGE.parse(stageKey);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z.object({ notes: z.string().optional() }).parse(req.body ?? {});
    return requestStageChanges({
      scriptId: id,
      stageKey: k,
      actorId: user.id,
      notes: body.notes,
    });
  });

  // Patch role assignment
  app.post("/scripts/:id/workflow/roles/:roleKey", async (req) => {
    const user = await requireUser(req);
    const { id, roleKey } = req.params as { id: string; roleKey: string };
    const k = Z_ROLE.parse(roleKey);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        assignmentType: z.enum(["ai_generic", "ai_influence", "live_person"]),
        influenceKey: z.string().nullable().optional(),
        assigneeUserId: z.string().nullable().optional(),
        assigneeName: z.string().nullable().optional(),
      })
      .parse(req.body ?? {});
    return setRoleAssignment({ scriptId: id, roleKey: k, patch: body });
  });

  // Stage-2 confirm
  app.post("/scripts/:id/workflow/roles-confirm", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    return confirmRolesAssigned({ scriptId: id, actorId: user.id });
  });

  // Vision Extraction — given an image URL + a canon field path, run
  // Claude vision and return a short editable suggestion the user can
  // approve as canon. The picker provides friendly labels; we look the
  // catalog entry up server-side so the user never types a raw path.
  app.post("/projects/:id/vision/extract", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        imageUrl: z.string().url(),
        canonFieldPath: z.string().min(1),
      })
      .parse(req.body ?? {});
    const catalog = await buildCanonCatalog(id);
    const entry = catalog.entries.find((e) => e.fieldPath === body.canonFieldPath);
    if (!entry) {
      throw new Error(
        `Unknown canon field path. Pick a target from the Canon Target Picker.`
      );
    }
    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", id)
      .single();
    const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
    const vwr = (meta.visualWorldRules ?? {}) as {
      aesthetic?: string[];
      forbidden?: string[];
    };
    const targetLabel = [entry.item, entry.field].filter(Boolean).join(" ");
    const out = await extractCanonFromImage({
      imageUrl: body.imageUrl,
      targetLabel,
      targetDescription: entry.description,
      subjectContext: entry.location ?? undefined,
      worldRulesAesthetic: vwr.aesthetic,
      worldRulesForbidden: vwr.forbidden,
    });
    return {
      target: {
        location: entry.location,
        category: entry.category,
        item: entry.item,
        field: entry.field,
        description: entry.description,
      },
      observed: out.observed,
      suggestedValue: out.suggestedValue,
    };
  });

  // Canon catalog (picker entries)
  app.get("/projects/:id/canon-catalog", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    return buildCanonCatalog(id);
  });

  // Creative-influence presets
  app.get("/workflow/creative-influences", async () => {
    return { presets: CREATIVE_INFLUENCES };
  });

  // Role registry (label + responsibility per role)
  app.get("/workflow/roles", async () => {
    return {
      roles: ALL_ROLE_KEYS.map((k) => ({
        ...ROLE_REGISTRY[k],
        influences: influencesForRole(k).map((i) => ({
          key: i.key,
          label: i.label,
          caption: i.caption,
        })),
      })),
    };
  });

  // Approve a single deliverable (AI-Proposal flow) — writes a
  // textOverride on canonSources with the supplied value.
  app.post("/scripts/:id/workflow/deliverables/approve", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        canonFieldPath: z.string().min(1),
        value: z.string().min(1),
        departmentKey: z.string().min(1),
      })
      .parse(req.body ?? {});
    await approveDeliverable({
      scriptId: id,
      projectId: script.project_id as string,
      actorId: user.id,
      canonFieldPath: body.canonFieldPath,
      value: body.value,
      departmentKey: body.departmentKey as DepartmentKey,
    });
    return { ok: true };
  });

  // Reject a deliverable's current approval (clears textOverride).
  app.post("/scripts/:id/workflow/deliverables/reject", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        canonFieldPath: z.string().min(1),
        departmentKey: z.string().min(1),
        notes: z.string().optional(),
      })
      .parse(req.body ?? {});
    await rejectDeliverable({
      scriptId: id,
      projectId: script.project_id as string,
      actorId: user.id,
      canonFieldPath: body.canonFieldPath,
      departmentKey: body.departmentKey as DepartmentKey,
      notes: body.notes,
    });
    return { ok: true };
  });

  // Hand-edit the cached AI proposal at a canon field path. Used when
  // the AI got most of the brief right and the user just needs to fix
  // a sentence or two. Persists so edits survive reload. Does NOT
  // approve — the user must still click Approve as canon for the
  // edited value to become locked canon.
  app.post("/scripts/:id/workflow/deliverables/edit-proposal", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        canonFieldPath: z.string().min(1),
        value: z.string().min(1),
      })
      .parse(req.body ?? {});
    const meta = (script.metadata ?? {}) as Record<string, unknown>;
    const cache = (meta.workflowAIProposals ?? {}) as Record<string, {
      value: string;
      generatedAt: string;
      editedBy?: string;
      editedAt?: string;
    }>;
    cache[body.canonFieldPath] = {
      value: body.value,
      generatedAt: cache[body.canonFieldPath]?.generatedAt ?? new Date().toISOString(),
      editedBy: user.id,
      editedAt: new Date().toISOString(),
    };
    meta.workflowAIProposals = cache;
    await supabase.from("scripts").update({ metadata: meta }).eq("id", id);
    return { ok: true };
  });

  // Regen a deliverable's value via LLM. Returns the new proposal —
  // does NOT write it (the user must explicitly Approve).
  app.post("/scripts/:id/workflow/deliverables/regen", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        canonFieldPath: z.string().min(1),
        deliverableLabel: z.string().min(1),
        deliverableDescription: z.string().optional(),
        currentValue: z.string().optional(),
        influenceKey: z.string().nullable().optional(),
        notes: z.string().optional(),
      })
      .parse(req.body ?? {});
    const out = await regenDeliverableProposal({
      scriptId: id,
      projectId: script.project_id as string,
      canonFieldPath: body.canonFieldPath,
      deliverableLabel: body.deliverableLabel,
      deliverableDescription: body.deliverableDescription,
      currentValue: body.currentValue,
      influenceKey: body.influenceKey ?? null,
      notes: body.notes,
    });
    return out;
  });

  // Auto-propose all empty AI deliverables in a stage (Stage 7 A). Loops
  // over the stage's deliverables, regenerates any without a cached
  // proposal or human approval, and writes results to script metadata.
  // Returns a per-field result so the UI can show partial successes.
  app.post("/scripts/:id/workflow/stages/:stageKey/auto-propose", async (req) => {
    const user = await requireUser(req);
    const { id, stageKey } = req.params as { id: string; stageKey: string };
    const k = Z_STAGE.parse(stageKey);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const report = await getWorkflowReport(id);
    const dels = report.deliverables[k] ?? [];
    // Only deliverables that:
    //   (a) have a canon field path (i.e. are approveable)
    //   (b) don't already have a human approval (hasApprovedCanon)
    //   (c) don't already have a cached AI proposal (hasAIProposal)
    const needs = dels.filter(
      (d) => !!d.canonFieldPath && !d.hasApprovedCanon && !d.hasAIProposal
    );
    if (needs.length === 0) {
      return { skipped: true, reason: "all-deliverables-have-proposals", proposed: 0 };
    }
    // Use the role assignment's influence (if any).
    const stagePrimaryRole: Partial<Record<string, string>> = {
      production_design: "production_designer",
      art_dept: "art_director",
      props: "propmaster",
      wardrobe_hmu: "wardrobe",
      blocking: "blocking",
      cinematography: "cinematographer",
      continuity: "script_supervisor",
      prompt_supervisor: "prompt_supervisor",
      preflight: "quality_control",
    };
    const roleKey = stagePrimaryRole[k];
    const influenceKey = roleKey
      ? (report.state.roleAssignments[roleKey as RoleKey]?.influenceKey ?? null)
      : null;
    const out = await autoProposeStage({
      scriptId: id,
      projectId: script.project_id as string,
      influenceKey,
      deliverables: needs.map((d) => ({
        canonFieldPath: d.canonFieldPath!,
        deliverableLabel: d.label,
        deliverableDescription: d.description,
        currentValue: d.currentValue,
      })),
    });
    return {
      proposed: out.results.filter((r) => r.ok).length,
      total: needs.length,
      results: out.results,
    };
  });

  // Prompt Impact Preview — given a canon field that's about to change,
  // list which scenes / shots will be affected in friendly labels.
  app.get("/scripts/:id/canon-impact", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const q = z.object({ fieldPath: z.string().min(1) }).parse(req.query ?? {});
    return computePromptImpact({
      projectId: script.project_id as string,
      scriptId: id,
      fieldPath: q.fieldPath,
    });
  });

  // Location-level DP constraints (Stage 8). Persistent rules the DP
  // regen honors on EVERY shot in a given location. Stored as canon
  // textOverrides at synthetic paths so they round-trip through the
  // existing canon system. Friendly UI: list locations in scope for a
  // given script + their current lighting + framing constraint lines.
  app.get("/scripts/:id/dp-location-constraints", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", script.project_id as string)
      .maybeSingle();
    const meta = (proj?.metadata ?? {}) as Record<string, unknown>;
    const locBibles = (meta.locationBibles ?? {}) as Record<string, Record<string, unknown>>;
    const canon = (meta.canonSources ?? {}) as Record<
      string,
      { textOverride?: { value: string } }
    >;
    // Filter to locations actually used in this script's scenes.
    const { data: scenes } = await supabase
      .from("script_scenes")
      .select("slugline")
      .eq("script_id", id);
    const slugTokens = new Set<string>();
    for (const s of scenes ?? []) {
      const slug = (s.slugline as string | null) ?? "";
      if (slug) slugTokens.add(slug.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim());
    }
    const locations: Array<{
      key: string;
      name: string;
      lightingConstraints: string;
      framingRules: string;
    }> = [];
    for (const [key, bible] of Object.entries(locBibles)) {
      const name = (bible.name as string) || key;
      const nameTok = name.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
      let inScope = slugTokens.size === 0;
      for (const tok of slugTokens) {
        if (tok === nameTok || tok.includes(nameTok) || nameTok.includes(tok)) {
          inScope = true;
          break;
        }
      }
      if (!inScope) continue;
      locations.push({
        key,
        name,
        lightingConstraints:
          canon[`locationBibles.${key}.dpLightingConstraints`]?.textOverride?.value ?? "",
        framingRules:
          canon[`locationBibles.${key}.dpFramingRules`]?.textOverride?.value ?? "",
      });
    }
    return { locations };
  });

  app.post("/scripts/:id/dp-location-constraints", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        locationKey: z.string().min(1),
        lightingConstraints: z.string(),
        framingRules: z.string(),
      })
      .parse(req.body ?? {});
    // Write both as canon textOverrides. Empty string clears the value.
    const writes: Array<{ path: string; value: string }> = [
      {
        path: `locationBibles.${body.locationKey}.dpLightingConstraints`,
        value: body.lightingConstraints,
      },
      {
        path: `locationBibles.${body.locationKey}.dpFramingRules`,
        value: body.framingRules,
      },
    ];
    for (const w of writes) {
      if (w.value.trim()) {
        await approveDeliverable({
          scriptId: id,
          projectId: script.project_id as string,
          actorId: user.id,
          canonFieldPath: w.path,
          value: w.value,
          departmentKey: "cinematography" as DepartmentKey,
        });
      } else {
        await rejectDeliverable({
          scriptId: id,
          projectId: script.project_id as string,
          actorId: user.id,
          canonFieldPath: w.path,
          departmentKey: "cinematography" as DepartmentKey,
        });
      }
    }
    return { ok: true };
  });

  // Diagnostic: what approved canon actually flows into a given shot's
  // prompt regen. Answers "where is the canon I just approved?" by
  // explicitly listing what the composer sees vs what's still only a
  // draft. Used by the AI Video Prompts panel.
  app.get("/scripts/:id/shots/:sceneOrd/:shotIndex/applied-canon", async (req) => {
    const user = await requireUser(req);
    const { id, sceneOrd, shotIndex } = req.params as {
      id: string;
      sceneOrd: string;
      shotIndex: string;
    };
    const sceneOrdN = Number(sceneOrd);
    const shotIndexN = Number(shotIndex);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, episode_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);

    const meta = (script.metadata ?? {}) as Record<string, unknown>;
    const briefs = ((meta.aiPrompts as Record<string, unknown> | undefined)
      ?.briefs as Record<string, Record<string, Record<string, unknown>>> | undefined) ?? {};
    const brief = briefs[String(sceneOrdN)]?.[String(shotIndexN)] as Record<string, unknown> | undefined;

    const draftCache = (meta.workflowAIProposals ?? {}) as Record<
      string,
      { value: string; editedAt?: string; generatedAt?: string }
    >;

    const { data: sceneRow } = await supabase
      .from("script_scenes")
      .select("slugline")
      .eq("script_id", id)
      .eq("ord", sceneOrdN)
      .maybeSingle();
    const slugline = (sceneRow?.slugline as string | null) ?? "";

    const canon = await loadResolvedCanon(script.project_id as string);
    const shotPrefix = `shotBriefs.${sceneOrdN}.${shotIndexN}.`;

    const summarizeField = (field: string) => {
      const path = `${shotPrefix}${field}`;
      const approved = canon.textOverrides.get(path);
      const draft = draftCache[path];
      const briefVal = brief ? (brief[field] as string | undefined) : undefined;
      return {
        approved: approved
          ? { value: approved.value, approvedAt: approved.approvedAt }
          : null,
        draft:
          draft && draft.value && (!approved || draft.value !== approved.value)
            ? { value: draft.value, editedAt: draft.editedAt }
            : null,
        briefValue: briefVal && String(briefVal).trim() ? String(briefVal) : null,
      };
    };

    const dpBrief = summarizeField("dpBrief");
    const directorBrief = summarizeField("directorBrief");

    // Location-level constraints (apply on every shot in the location).
    const slugTok = slugline
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
    const locBibles = (((await (async () => {
      const { data } = await supabase
        .from("projects")
        .select("metadata")
        .eq("id", script.project_id as string)
        .maybeSingle();
      return (data?.metadata ?? {}) as Record<string, unknown>;
    })()).locationBibles ?? {}) as Record<string, Record<string, unknown>>);
    let matchedKey: string | null = null;
    let matchedName: string | null = null;
    for (const [key, bible] of Object.entries(locBibles)) {
      const nameTok = ((bible.name as string) || key)
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, " ")
        .trim();
      if (
        slugTok === nameTok ||
        slugTok.includes(nameTok) ||
        nameTok.includes(slugTok)
      ) {
        matchedKey = key;
        matchedName = (bible.name as string) || key;
        break;
      }
    }
    const lightingConstraintsValue = matchedKey
      ? canon.textOverrides.get(`locationBibles.${matchedKey}.dpLightingConstraints`)?.value
      : null;
    const framingRulesValue = matchedKey
      ? canon.textOverrides.get(`locationBibles.${matchedKey}.dpFramingRules`)?.value
      : null;
    const splitLines = (s: string | undefined | null): string[] => {
      if (!s) return [];
      return s
        .split(/\r?\n/)
        .map((l) => l.replace(/^[-•*]\s*/, "").trim())
        .filter((l) => l.length > 0);
    };

    // Approved canon references that touch this shot's location / visible props.
    const visibleRaw = (brief
      ? (brief.visibleSetElements as string[] | undefined) ?? []
      : [])
      .join(" ")
      .toLowerCase();
    const charsInShot = brief
      ? ((brief.characters as Array<{ name?: string }> | undefined) ?? [])
        .map((c) => (c.name ?? "").toLowerCase())
      : [];
    const matchingRefs = canon.references.filter((r) => {
      if (matchedKey && r.fieldPath.startsWith(`locationBibles.${matchedKey}.`)) return true;
      if (r.fieldPath.startsWith("propBibles.")) {
        const propKey = r.fieldPath.split(".")[1] ?? "";
        const propWords = propKey
          .split("_")
          .filter((w) => w.length >= 4)
          .map((w) => w.toLowerCase());
        return propWords.some((w) => visibleRaw.includes(w));
      }
      if (r.fieldPath.startsWith("characters.")) {
        const fieldLower = r.fieldPath.toLowerCase();
        return charsInShot.some((n) => n && fieldLower.includes(n.split(" ")[0]));
      }
      return false;
    });

    return {
      shot: {
        sceneOrd: sceneOrdN,
        shotIndex: shotIndexN,
        slugline,
      },
      dpBrief,
      directorBrief,
      location: matchedName
        ? {
            name: matchedName,
            lightingConstraints: splitLines(lightingConstraintsValue),
            framingRules: splitLines(framingRulesValue),
          }
        : null,
      approvedReferences: matchingRefs.map((r) => ({
        fieldPath: r.fieldPath,
        kind: r.kind,
        title: r.title ?? null,
      })),
    };
  });

  // Stale-prompt detection
  app.get("/scripts/:id/stale-prompts", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    return detectStalePrompts(id);
  });

  // Bulk-regen stale prompts
  app.post("/scripts/:id/regenerate-stale", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        targets: z
          .array(
            z.object({
              sceneOrd: z.number().int().min(0),
              shotIndex: z.number().int().min(0),
              model: z.string(),
            })
          )
          .optional(),
      })
      .parse(req.body ?? {});
    // If no targets list provided, regen everything currently flagged stale.
    const targets =
      body.targets ??
      (await detectStalePrompts(id)).stale.map((s) => ({
        sceneOrd: s.sceneOrd,
        shotIndex: s.shotIndex,
        model: s.model,
      }));
    const results: Array<{ sceneOrd: number; shotIndex: number; model: string; ok: boolean; error?: string }> = [];
    for (const t of targets) {
      try {
        await generatePromptForModel({
          scriptId: id,
          sceneOrd: t.sceneOrd,
          shotIndex: t.shotIndex,
          model: t.model as ModelKey,
        });
        results.push({ ...t, ok: true });
      } catch (err) {
        results.push({ ...t, ok: false, error: (err as Error).message });
      }
    }
    return { regenerated: results.length, results };
  });

  // Project members — for live_person assignment picker
  app.get("/projects/:id/members", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const { data } = await supabase
      .from("project_members")
      .select("user_id, role, created_at, profiles(name, email)")
      .eq("project_id", id);
    return { members: data ?? [] };
  });
}
