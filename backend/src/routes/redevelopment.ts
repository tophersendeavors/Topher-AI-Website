// Series Redevelopment Mode routes (Phase 1).
//
//   GET   /projects/:id/redevelopment                    — list passes
//   POST  /projects/:id/redevelopment                    — create a pass
//   GET   /projects/:id/redevelopment/:passId            — full pass report
//   POST  /projects/:id/redevelopment/:passId/abandon    — abandon pass
//
//   PUT   /projects/:id/redevelopment/:passId/brief      — save R1 brief
//   POST  /projects/:id/redevelopment/:passId/brief/approve
//
//   POST  /projects/:id/redevelopment/:passId/character-bibles/generate
//                                                        — generate one bible
//   PUT   /projects/:id/redevelopment/:passId/character-bibles
//                                                        — save the bibles list
//   POST  /projects/:id/redevelopment/:passId/character-bibles/:name/approve

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import {
  abandonPass,
  approveBrief,
  approveCharacterBible,
  approvePilotStrategy,
  approveProtocolModule,
  approveR6Guardrails,
  approveSeasonArc,
  computePassReport,
  createPass,
  getPass,
  listPasses,
  saveBrief,
  setCharacterBibles,
  setPilotStrategy,
  setProtocolModules,
  setR6Guardrails,
  setR6Pass2Draft,
  setR6RewritePlan,
  approveR6RewritePlan,
  promoteR6Pass2Draft,
  setR7PolishPlan,
  approveR7PolishPlan,
  setR7Pass2Draft,
  promoteR7Pass2Draft,
  setR8VoicePolishPlan,
  approveR8VoicePolishPlan,
  setR8Pass2Draft,
  promoteR8Pass2Draft,
  setR9FinalPolishPlan,
  approveR9FinalPolishPlan,
  setR9Pass2Draft,
  promoteR9Pass2Draft,
  setSeasonArc,
} from "../redevelopment/store.js";
import { generateCharacterBible } from "../redevelopment/characterBibleAgent.js";
import { generateProtocolModule } from "../redevelopment/protocolModuleAgent.js";
import { generateSeasonArc } from "../redevelopment/seasonArcAgent.js";
import {
  generatePilotStrategy,
  loadExistingPilotContext,
} from "../redevelopment/pilotStrategyAgent.js";
import { composeSuggestedBrief } from "../redevelopment/suggestedBrief.js";
import {
  auditAndRepairPilotStrategy,
  auditAndRepairR6Guardrails,
  auditAndRepairR6Pass2Draft,
  auditAndRepairR6RewritePlan,
  auditAndRepairR7PolishPlan,
  auditAndRepairR7Pass2Draft,
  auditAndRepairR8VoicePolishPlan,
  auditAndRepairR8Pass2Draft,
  auditAndRepairR9FinalPolishPlan,
  auditAndRepairR9Pass2Draft,
  auditAndRepairSeasonArc,
} from "../redevelopment/validators.js";
import { generateR6Guardrails } from "../redevelopment/r6GuardrailsAgent.js";
import { generateR6RewritePlan } from "../redevelopment/r6RewriteAgent.js";
import { generateR6Pass2 } from "../redevelopment/r6Pass2Agent.js";
import { repairR6Pass2 } from "../redevelopment/r6Pass2RepairAgent.js";
import { generateR7PolishPlan } from "../redevelopment/r7PolishAgent.js";
import { applyR7Pass2 } from "../redevelopment/r7Pass2Agent.js";
import { generateR8VoicePolishPlan } from "../redevelopment/r8VoicePolishAgent.js";
import { applyR8Pass2 } from "../redevelopment/r8Pass2Agent.js";
import { generateR9FinalPolishPlan } from "../redevelopment/r9FinalPolishAgent.js";
import { applyR9Pass2 } from "../redevelopment/r9Pass2Agent.js";
import { indexScenes } from "../screenplay/sceneIndex.js";
import { supabase } from "../db/client.js";
import type {
  RedevCharacterBible,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevR6GuardrailsBundle,
  RedevSeasonArcEpisode,
  RedevelopmentPass,
} from "../redevelopment/types.js";
import { normalizeR6Guardrails } from "../redevelopment/types.js";

export default async function redevelopmentRoutes(app: FastifyInstance) {
  // ----- pass lifecycle ----------------------------------------------------

  app.get("/projects/:id/redevelopment", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    return listPasses(id);
  });

  app.post("/projects/:id/redevelopment", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({ title: z.string().min(1).max(120) })
      .parse(req.body ?? {});
    const pass = await createPass({
      projectId: id,
      title: body.title,
      createdBy: user.id,
    });
    return pass;
  });

  app.get("/projects/:id/redevelopment/:passId", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    const pass = await getPass(id, passId);
    if (!pass) throw new Error("pass not found");
    return computePassReport(pass);
  });

  app.post("/projects/:id/redevelopment/:passId/abandon", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    await abandonPass(id, passId);
    return { ok: true };
  });

  // ----- R1 — Brief --------------------------------------------------------

  app.put("/projects/:id/redevelopment/:passId/brief", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        whatChanged: z.string(),
        newCorePrinciple: z.string(),
        newSeasonQuestion: z.string(),
        primaryMystery: z.string(),
        secondaryMystery: z.string(),
        mustNotChange: z.string(),
        targetsForRedevelopment: z.string(),
        // New in v2 — optional so older clients still work, but the R1
        // form sends them. These shape every downstream agent.
        audiencePromise: z.string().optional(),
        protocolPhilosophy: z.string().optional(),
        solanoRule: z.string().optional(),
        forbiddenTones: z.string().optional(),
      })
      .parse(req.body ?? {});
    // Preserve approval state across PUTs so re-saving fields doesn't
    // silently un-approve the brief. (Approve is a separate endpoint.)
    const existing = await getPass(id, passId);
    const prevApprovedAt = existing?.brief?.approvedAt ?? null;
    const prevApprovedBy = existing?.brief?.approvedBy ?? null;
    const pass = await saveBrief({
      projectId: id,
      passId,
      brief: {
        whatChanged: body.whatChanged,
        newCorePrinciple: body.newCorePrinciple,
        newSeasonQuestion: body.newSeasonQuestion,
        primaryMystery: body.primaryMystery,
        secondaryMystery: body.secondaryMystery,
        mustNotChange: body.mustNotChange,
        targetsForRedevelopment: body.targetsForRedevelopment,
        audiencePromise: body.audiencePromise,
        protocolPhilosophy: body.protocolPhilosophy,
        solanoRule: body.solanoRule,
        forbiddenTones: body.forbiddenTones,
        approvedAt: prevApprovedAt,
        approvedBy: prevApprovedBy,
      },
    });
    return computePassReport(pass);
  });

  app.post("/projects/:id/redevelopment/:passId/brief/approve", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    const pass = await approveBrief({
      projectId: id,
      passId,
      approvedBy: user.id,
    });
    return computePassReport(pass);
  });

  // ----- R2 — Character Bibles --------------------------------------------

  // Generate one bible. Does NOT persist on its own — frontend collects
  // the result, lets the user edit, then PUTs the full bibles array.
  app.post(
    "/projects/:id/redevelopment/:passId/character-bibles/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          characterName: z.string().min(1).max(120),
          showrunnerSeed: z.string().optional(),
          livePriorBible: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before generating bibles");
      }
      const proposed = await generateCharacterBible({
        brief: pass.brief,
        characterName: body.characterName,
        showrunnerSeed: body.showrunnerSeed,
        livePriorBible: body.livePriorBible,
        notes: body.notes,
      });
      return { characterName: body.characterName, proposed };
    }
  );

  // Save the full list of character bibles (after the user has edited
  // them inline). Replaces the array. Preserves any previously-set
  // approvedAt by character name.
  app.put("/projects/:id/redevelopment/:passId/character-bibles", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        bibles: z.array(
          z.object({
            liveCharacterId: z.string().nullable(),
            characterName: z.string().min(1),
            proposed: z.object({
              publicIdentity: z.string(),
              privateIdentity: z.string(),
              coreWound: z.string(),
              avoidanceStrategy: z.string(),
              hiddenTruth: z.string(),
              whatTheyThinkTheyNeed: z.string(),
              whatTheyActuallyNeed: z.string(),
              protocolVulnerability: z.string(),
              seasonRevelation: z.string(),
              finalChoice: z.string(),
            }),
            showrunnerSeed: z.string().optional(),
          })
        ),
      })
      .parse(req.body ?? {});
    // Preserve existing approval state by name.
    const existing = await getPass(id, passId);
    if (!existing) throw new Error("pass not found");
    const byName = new Map(
      existing.characterBibles.map((b) => [b.characterName, b])
    );
    const next: RedevCharacterBible[] = body.bibles.map((b) => {
      const prior = byName.get(b.characterName);
      return {
        liveCharacterId: b.liveCharacterId,
        characterName: b.characterName,
        proposed: b.proposed,
        showrunnerSeed: b.showrunnerSeed,
        // If a bible's proposed text changed AND it was approved, drop
        // the approval — the showrunner must re-approve the new text.
        approvedAt: prior && deepEqual(prior.proposed, b.proposed)
          ? prior.approvedAt
          : null,
        approvedBy: prior && deepEqual(prior.proposed, b.proposed)
          ? prior.approvedBy
          : null,
      };
    });
    const pass = await setCharacterBibles({
      projectId: id,
      passId,
      bibles: next,
    });
    return computePassReport(pass);
  });

  app.post(
    "/projects/:id/redevelopment/:passId/character-bibles/:name/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId, name } = req.params as {
        id: string;
        passId: string;
        name: string;
      };
      await assertProjectMember(user.id, id);
      const pass = await approveCharacterBible({
        projectId: id,
        passId,
        characterName: decodeURIComponent(name),
        approvedBy: user.id,
      });
      return computePassReport(pass);
    }
  );

  // ----- R3 — Protocol Modules --------------------------------------------

  // Generate one module's structured fields. Does NOT persist on its own —
  // the frontend collects the result, lets the user edit, then PUTs the
  // full modules array.
  app.post(
    "/projects/:id/redevelopment/:passId/protocol-modules/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          moduleName: z.string().min(1).max(120),
          showrunnerSeed: z.string().optional(),
          notes: z.string().optional(),
        })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before generating modules");
      }
      const { module: proposed, validatorNotes, audit } = await generateProtocolModule({
        brief: pass.brief,
        characterBibles: pass.characterBibles,
        siblingModules: pass.protocolModules,
        moduleName: body.moduleName,
        showrunnerSeed: body.showrunnerSeed,
        notes: body.notes,
      });
      return { module: proposed, validatorNotes, audit };
    }
  );

  // Save the full list of modules. Replaces the array. Preserves any
  // approvedAt by id when the module's content is structurally unchanged.
  app.put("/projects/:id/redevelopment/:passId/protocol-modules", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        modules: z.array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            purpose: z.string(),
            psychologicalTarget: z.string(),
            avoidanceBehaviorStripped: z.string(),
            physicalSomaticExercise: z.string(),
            visualExecution: z.string(),
            dramaticRisks: z.string(),
            affectedCharacterNames: z.array(z.string()),
            truthPressured: z.string(),
            possibleEpisodePlacement: z.string(),
            // Persistent steering note for the next regeneration.
            // EXCLUDED from approval-preservation comparison below —
            // changing the note never drops the module's approval.
            steeringNote: z.string().optional(),
            // EXPLICIT preserve-approval flag: when true, the server
            // keeps any existing `approvedAt` on this module REGARDLESS
            // of whether the content changed. Used for surgical
            // post-approval edits — e.g., adding a missing character
            // name to affectedCharacterNames without re-approving the
            // whole module. The flag itself is never persisted.
            preserveApproval: z.boolean().optional(),
          })
        ),
      })
      .parse(req.body ?? {});
    const existing = await getPass(id, passId);
    if (!existing) throw new Error("pass not found");
    const byId = new Map(existing.protocolModules.map((m) => [m.id, m]));
    const next: RedevProtocolModule[] = body.modules.map((m) => {
      const prior = byId.get(m.id);
      // Preserve approval only when the STRUCTURAL payload is unchanged.
      // `steeringNote` is intentionally excluded from this comparison —
      // it's editable metadata for future regens, not part of the
      // approved module's content.
      const sameContent =
        prior &&
        deepEqual(
          {
            name: prior.name,
            purpose: prior.purpose,
            psychologicalTarget: prior.psychologicalTarget,
            avoidanceBehaviorStripped: prior.avoidanceBehaviorStripped,
            physicalSomaticExercise: prior.physicalSomaticExercise,
            visualExecution: prior.visualExecution,
            dramaticRisks: prior.dramaticRisks,
            affectedCharacterNames: prior.affectedCharacterNames,
            truthPressured: prior.truthPressured,
            possibleEpisodePlacement: prior.possibleEpisodePlacement,
          },
          {
            name: m.name,
            purpose: m.purpose,
            psychologicalTarget: m.psychologicalTarget,
            avoidanceBehaviorStripped: m.avoidanceBehaviorStripped,
            physicalSomaticExercise: m.physicalSomaticExercise,
            visualExecution: m.visualExecution,
            dramaticRisks: m.dramaticRisks,
            affectedCharacterNames: m.affectedCharacterNames,
            truthPressured: m.truthPressured,
            possibleEpisodePlacement: m.possibleEpisodePlacement,
          }
        );
      // Preserve approval if:
      //   • the structural content is unchanged (normal case), OR
      //   • the client explicitly opted in to preserveApproval (the
      //     "I'm surgically amending an approved module" case).
      // The `preserveApproval` flag is honored ONLY when there IS a
      // prior approval — it can't fabricate one.
      const keepApproval =
        !!prior?.approvedAt && (sameContent || m.preserveApproval === true);
      // Build the persisted module without the transport-only flag.
      const persisted: RedevProtocolModule = {
        id: m.id,
        name: m.name,
        purpose: m.purpose,
        psychologicalTarget: m.psychologicalTarget,
        avoidanceBehaviorStripped: m.avoidanceBehaviorStripped,
        physicalSomaticExercise: m.physicalSomaticExercise,
        visualExecution: m.visualExecution,
        dramaticRisks: m.dramaticRisks,
        affectedCharacterNames: m.affectedCharacterNames,
        truthPressured: m.truthPressured,
        possibleEpisodePlacement: m.possibleEpisodePlacement,
        steeringNote: m.steeringNote,
        approvedAt: keepApproval ? prior!.approvedAt : null,
      };
      return persisted;
    });
    const pass = await setProtocolModules({
      projectId: id,
      passId,
      modules: next,
    });
    return computePassReport(pass);
  });

  app.post(
    "/projects/:id/redevelopment/:passId/protocol-modules/:moduleId/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId, moduleId } = req.params as {
        id: string;
        passId: string;
        moduleId: string;
      };
      await assertProjectMember(user.id, id);
      const pass = await approveProtocolModule({
        projectId: id,
        passId,
        moduleId,
      });
      return computePassReport(pass);
    }
  );

  // ----- R4 — Season Arc --------------------------------------------------

  // Generate all 8 episodes in one cohesive design.
  app.post(
    "/projects/:id/redevelopment/:passId/season-arc/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before generating the season arc");
      }
      const { episodes, audit } = await generateSeasonArc({
        brief: pass.brief,
        characterBibles: pass.characterBibles,
        protocolModules: pass.protocolModules,
        notes: body.notes,
      });
      return { episodes, audit };
    }
  );

  // Save the (possibly edited) episodes array. Preserves approval iff
  // structurally identical to prior — any edit drops the approval and
  // the showrunner must re-approve the whole arc.
  app.put("/projects/:id/redevelopment/:passId/season-arc", async (req) => {
    const user = await requireUser(req);
    const { id, passId } = req.params as { id: string; passId: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        episodes: z.array(
          z.object({
            number: z.number().int(),
            title: z.string(),
            theme: z.string(),
            protocolModule: z.string(),
            characterBreakthrough: z.string(),
            characterCollision: z.string(),
            mysteryProgression: z.string(),
            revelation: z.string(),
            cliffhanger: z.string(),
            episode1Plant: z.string(),
          })
        ).length(8),
        // Metadata — never drops approval. Optional so existing
        // clients still work; new clients can save these via this
        // same endpoint without touching the episode payload.
        supportingModuleUsageNotes: z.string().optional(),
        steeringNote: z.string().optional(),
      })
      .parse(req.body ?? {});
    const pass = await setSeasonArc({
      projectId: id,
      passId,
      episodes: body.episodes as RedevSeasonArcEpisode[],
      supportingModuleUsageNotes: body.supportingModuleUsageNotes,
      steeringNote: body.steeringNote,
    });
    return computePassReport(pass);
  });

  app.post(
    "/projects/:id/redevelopment/:passId/season-arc/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await approveSeasonArc({ projectId: id, passId });
      return computePassReport(pass);
    }
  );

  // Read-only audit of the currently-stored season arc. Runs the full
  // R4 validator pipeline (Paul timing, Elena planting, Solano framing,
  // pilot plant usefulness, finale logic, episode completeness, module
  // usage). Does NOT modify the arc — even though the validator has
  // a deterministic-repair shape, the R4 ruleset is warnings-only, so
  // there's nothing to write back. Returns just the audit report.
  app.get(
    "/projects/:id/redevelopment/:passId/season-arc/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const arc = pass.seasonArc;
      if (!arc || !arc.episodes || arc.episodes.length === 0) {
        return {
          audit: {
            checks: [
              {
                id: "r4_episode_engine",
                label: "Episode engine completeness",
                status: "warning",
                message: "No season arc generated yet. Click Generate season arc first.",
              },
            ],
            repairs: [],
          },
          episodes: 0,
          approvedAt: null,
        };
      }
      const result = auditAndRepairSeasonArc({
        episodes: arc.episodes,
        brief: pass.brief!,
        characterBibles: pass.characterBibles,
        protocolModules: pass.protocolModules,
        supportingModuleUsageNotes: arc.supportingModuleUsageNotes,
      });
      return {
        audit: result.audit,
        episodes: arc.episodes.length,
        approvedAt: arc.approvedAt,
      };
    }
  );

  // ----- R5 — Pilot Rewrite Strategy --------------------------------------

  // Generate the nine strategy buckets, grounded in R1-R4 + the live EP01
  // pilot script when one exists. The agent gracefully degrades to
  // principle-level recommendations if no pilot draft has been written yet.
  app.post(
    "/projects/:id/redevelopment/:passId/pilot-strategy/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before R5");
      }
      if (!pass.seasonArc?.approvedAt) {
        throw new Error("R4 Season Arc must be approved before R5");
      }
      const existingPilot = await loadExistingPilotContext(id);
      const { strategy, audit } = await generatePilotStrategy({
        brief: pass.brief,
        characterBibles: pass.characterBibles,
        protocolModules: pass.protocolModules,
        seasonArc: pass.seasonArc.episodes,
        existingPilot,
        notes: body.notes,
      });
      // Stamp anchorScriptId so we can flag the strategy as stale later
      // if the user updates the underlying EP01 script.
      return {
        strategy: { ...strategy, anchorScriptId: existingPilot.scriptId },
        audit,
        pilotContext: {
          hasDraft: existingPilot.scriptId !== null,
          draftNumber: existingPilot.draftNumber,
          sceneCount: existingPilot.scenes.length,
        },
      };
    }
  );

  // Save the strategy. Approval is preserved iff the nine content lists
  // are structurally unchanged — metadata-only updates (steeringNote,
  // anchorScriptId) NEVER drop approval. Matches the R3/R4 pattern.
  app.put(
    "/projects/:id/redevelopment/:passId/pilot-strategy",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          whatMustChange: z.array(z.string()),
          whatMustRemain: z.array(z.string()),
          newSeedsToPlant: z.array(z.string()),
          oldBeatsToRemove: z.array(z.string()),
          characterIntroAdjustments: z.array(z.string()),
          protocolPhilosophyMoments: z.array(z.string()),
          mysteryPlants: z.array(z.string()),
          characterArcPlants: z.array(z.string()),
          finalHookOptions: z.array(z.string()),
          steeringNote: z.string().optional(),
          anchorScriptId: z.string().nullable().optional(),
        })
        .parse(req.body ?? {});
      const pass = await setPilotStrategy({
        projectId: id,
        passId,
        strategy: body as Omit<RedevPilotStrategy, "approvedAt">,
      });
      return computePassReport(pass);
    }
  );

  app.post(
    "/projects/:id/redevelopment/:passId/pilot-strategy/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await approvePilotStrategy({ projectId: id, passId });
      return computePassReport(pass);
    }
  );

  // Read-only audit of the currently-stored strategy.
  app.get(
    "/projects/:id/redevelopment/:passId/pilot-strategy/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const strat = pass.pilotStrategy;
      if (!strat) {
        return {
          audit: {
            checks: [
              {
                id: "r5_lists_populated",
                label: "Strategy completeness",
                status: "warning",
                message:
                  "No pilot strategy generated yet. Click Generate pilot strategy first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const audit = auditAndRepairPilotStrategy({
        strategy: strat,
        brief: pass.brief!,
        characterBibles: pass.characterBibles,
        seasonArc: pass.seasonArc?.episodes ?? [],
        protocolModules: pass.protocolModules.map((m) => ({
          name: m.name,
          approvedAt: m.approvedAt,
        })),
        // No context here — this is the read-only audit endpoint; the
        // pilot-context flags are only meaningful right after a fresh
        // generation. Validator degrades gracefully (skips those checks).
      });
      return { audit, approvedAt: strat.approvedAt };
    }
  );

  // Suggested Strategy Brief — deterministic composition from approved
  // R1-R4 + EP01 context. No LLM call. Returns a Markdown document the
  // showrunner can paste into the steering note (or use as-is). The UI
  // shows this above the steering field so the user never has to
  // retype context that already exists in the project.
  app.get(
    "/projects/:id/redevelopment/:passId/pilot-strategy/suggested-brief",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief) {
        return {
          brief: "",
          context: { hasDraft: false, draftNumber: null, sceneCount: 0 },
          ready: false,
          reason: "R1 brief not yet saved.",
        };
      }
      const existingPilot = await loadExistingPilotContext(id);
      const brief = composeSuggestedBrief({
        brief: pass.brief,
        characterBibles: pass.characterBibles,
        protocolModules: pass.protocolModules,
        seasonArc: pass.seasonArc?.episodes ?? [],
        existingPilot,
      });
      return {
        brief,
        context: {
          hasDraft: existingPilot.scriptId !== null,
          draftNumber: existingPilot.draftNumber,
          sceneCount: existingPilot.scenes.length,
        },
        ready: true,
      };
    }
  );

  // ----- R6 Guardrails -----------------------------------------------------
  //
  // Per-character protection contract + whole-pilot global rule. Honored
  // by the R6 rewrite generator when it ships. Saving now (during R5
  // approval / before R6 runs) locks the contract so it can't drift in
  // the rewrite prompt.

  const guardrailShape = z.object({
    characterName: z.string().min(1).max(120),
    plants: z.array(z.string()),
    doNotReveal: z.array(z.string()),
    doNotDo: z.array(z.string()),
    executionRule: z.string(),
  });

  // PUT — save full bundle. Edits drop approval; metadata-equality
  // preserves it.
  app.put(
    "/projects/:id/redevelopment/:passId/r6-guardrails",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          perCharacter: z.array(guardrailShape),
          globalRule: z.string(),
          globalPlants: z.array(z.string()).optional(),
        })
        .parse(req.body ?? {});
      const pass = await setR6Guardrails({
        projectId: id,
        passId,
        bundle: {
          perCharacter: body.perCharacter,
          globalRule: body.globalRule,
          globalPlants: body.globalPlants ?? [],
          approvedAt: null,
        },
      });
      return computePassReport(pass);
    }
  );

  // ----- R6 Rewrite — Pass 1 (Plan) ---------------------------------------

  const planEntryShape = z.object({
    existingSceneOrd: z.number().nullable(),
    existingSlugline: z.string().optional(),
    action: z.enum(["keep", "revise", "move", "merge", "cut", "add"]),
    newSlugline: z.string().optional(),
    insertAfterOrd: z.number().optional(),
    mergeIntoOrd: z.number().optional(),
    changeNotes: z.string(),
    targets: z
      .array(
        z.enum([
          "surrender_execution",
          "nadia_elena_plant",
          "paul_phone_driving_plant",
          "margot_professional_structure",
          "claire_ritualized_grief",
          "dean_usefulness",
          "solano_certainty",
          "archive_room",
          "photograph_wall",
          "final_blended_hook",
        ])
      )
      .optional(),
    serves: z.array(z.string()).optional(),
    satisfiesPlants: z.array(z.string()).optional(),
  });

  // Generate — runs the LLM agent and returns the plan + audit.
  // Does NOT persist; the showrunner reviews and saves via PUT.
  app.post(
    "/projects/:id/redevelopment/:passId/r6-rewrite/plan/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before R6 Pass 1");
      }
      if (!pass.pilotStrategy?.approvedAt) {
        throw new Error(
          "R5 Pilot Strategy must be approved before R6 Pass 1"
        );
      }
      const guardrails = (() => {
        const raw = pass.r6Guardrails;
        if (!raw) {
          return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        }
        if (Array.isArray(raw)) {
          return { perCharacter: raw, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: raw.perCharacter ?? [],
          globalRule: raw.globalRule ?? "",
          globalPlants: raw.globalPlants ?? [],
          approvedAt: raw.approvedAt ?? null,
        };
      })();
      if (!guardrails.approvedAt) {
        throw new Error(
          "R6 Guardrails must be approved before R6 Pass 1"
        );
      }
      const { plan, approachSummary, priorScriptId, audit } =
        await generateR6RewritePlan({
          projectId: id,
          brief: pass.brief,
          characterBibles: pass.characterBibles,
          protocolModules: pass.protocolModules,
          seasonArc: pass.seasonArc?.episodes ?? [],
          pilotStrategy: pass.pilotStrategy,
          guardrails,
          notes: body.notes,
        });
      return { plan, approachSummary, priorScriptId, audit };
    }
  );

  // Save — edits to the plan from the UI.
  app.put(
    "/projects/:id/redevelopment/:passId/r6-rewrite/plan",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          plan: z.array(planEntryShape),
          approachSummary: z.string(),
          priorScriptId: z.string().nullable(),
        })
        .parse(req.body ?? {});
      const pass = await setR6RewritePlan({
        projectId: id,
        passId,
        plan: body.plan,
        approachSummary: body.approachSummary,
        priorScriptId: body.priorScriptId ?? "",
      });
      return computePassReport(pass);
    }
  );

  // Approve the plan (Pass 1 gate). Pass 2 runs only after this.
  app.post(
    "/projects/:id/redevelopment/:passId/r6-rewrite/plan/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await approveR6RewritePlan({ projectId: id, passId });
      return computePassReport(pass);
    }
  );

  // Read-only audit of the currently stored plan.
  app.get(
    "/projects/:id/redevelopment/:passId/r6-rewrite/plan/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const rewrite = pass.pilotRewrite;
      if (!rewrite || !rewrite.plan || rewrite.plan.length === 0) {
        return {
          audit: {
            checks: [
              {
                id: "r6plan_existing_scenes_covered",
                label: "Every existing scene has a decision",
                status: "warning",
                message:
                  "No rewrite plan generated yet. Click 'Generate rewrite plan' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const existingPilot = await loadExistingPilotContext(id);
      const guardrails = (() => {
        const raw = pass.r6Guardrails;
        if (!raw) {
          return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        }
        if (Array.isArray(raw)) {
          return { perCharacter: raw, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: raw.perCharacter ?? [],
          globalRule: raw.globalRule ?? "",
          globalPlants: raw.globalPlants ?? [],
          approvedAt: raw.approvedAt ?? null,
        };
      })();
      const audit = auditAndRepairR6RewritePlan({
        plan: rewrite.plan,
        approachSummary: rewrite.approachSummary ?? "",
        existingScenes: existingPilot.scenes,
        guardrails,
      });
      return { audit, approvedAt: rewrite.planApprovedAt ?? null };
    }
  );

  // POST /generate — deterministically compose a fresh bundle from
  // approved R1-R5. Returns the bundle; does NOT persist. Caller
  // (frontend) can review, edit, and save via PUT — or accept as-is.
  // R5 approval is required so we have a strategy to ground on.
  app.post(
    "/projects/:id/redevelopment/:passId/r6-guardrails/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before R6 guardrails");
      }
      if (!pass.pilotStrategy?.approvedAt) {
        throw new Error(
          "R5 Pilot Strategy must be approved before R6 guardrails"
        );
      }
      const bundle = generateR6Guardrails({
        brief: pass.brief,
        characterBibles: pass.characterBibles,
        protocolModules: pass.protocolModules,
        seasonArc: pass.seasonArc?.episodes ?? [],
        pilotStrategy: pass.pilotStrategy,
      });
      return { bundle };
    }
  );

  // POST /approve — sets approvedAt on the currently stored bundle.
  app.post(
    "/projects/:id/redevelopment/:passId/r6-guardrails/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await approveR6Guardrails({ projectId: id, passId });
      return computePassReport(pass);
    }
  );

  // GET /audit — read-only audit of the currently stored bundle.
  app.get(
    "/projects/:id/redevelopment/:passId/r6-guardrails/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const bundle = normalizeR6Guardrails(pass.r6Guardrails);
      if (bundle.perCharacter.length === 0) {
        return {
          audit: {
            checks: [
              {
                id: "r6_all_principals_covered",
                label: "All approved principals have guardrails",
                status: "warning",
                message:
                  "No guardrails generated yet. Click 'Generate guardrails from approved strategy' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const audit = auditAndRepairR6Guardrails({
        bundle,
        brief: pass.brief!,
        characterBibles: pass.characterBibles,
      });
      return { audit, approvedAt: bundle.approvedAt };
    }
  );

  // R6 Pass 2 routes — extracted into a sibling registrar so the
  // route definitions live at the top level. Without this delegation
  // the Pass 2 routes wouldn't be registered on the Fastify instance
  // and every client call would 404.
  registerR6Pass2Routes(app);
}

/** Key-order-independent deep equality.
 *
 *  We can't use plain `JSON.stringify(a) === JSON.stringify(b)` here
 *  because the two sides arrive with different key orders:
 *    • `prior.proposed` was loaded from Postgres `jsonb`, which stores
 *      object keys in normalized (≈ alphabetical) order. When the
 *      driver deserializes the jsonb, the resulting JS object has keys
 *      in that storage order.
 *    • `body.proposed` was just parsed by a zod `z.object({...})`
 *      schema, which emits the output object with keys in SCHEMA order
 *      (publicIdentity, privateIdentity, coreWound, …).
 *  These two orders disagree, so naive JSON.stringify produces
 *  different strings for the same logical object — which meant every
 *  approval-preservation check would falsely return "different" and
 *  drop every previously-approved bible's `approvedAt`. That's the bug
 *  the user hit: approve Margot, then save anything else, and Margot
 *  silently reverted to "Proposed — not yet approved".
 *
 *  Canonicalize both sides (sort keys recursively, stable string form)
 *  before comparing. Now structural equality is what matters, not how
 *  the bytes happened to be laid out on either side of the wire. */
function deepEqual<T>(a: T, b: T): boolean {
  return canonicalize(a) === canonicalize(b);
}

function canonicalize(v: unknown): string {
  if (v === null || v === undefined) return JSON.stringify(v ?? null);
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(canonicalize).join(",") + "]";
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k]))
      .join(",") +
    "}"
  );
}

/** R6 Pass 2 route registrar — called from inside `redevelopmentRoutes`.
 *  Extracted into its own function so the route definitions live at
 *  the top level (where they belong) and the original `redevelopmentRoutes`
 *  function just delegates here.
 *
 *  Implementation note: this block previously lived in the wrong place
 *  (inside `canonicalize`), so the routes never registered and every
 *  client call returned 404. The fix moves them here and wires
 *  `redevelopmentRoutes` to call this registrar before its closing
 *  brace. */
export function registerR6Pass2Routes(app: FastifyInstance) {
  app.post(
    "/projects/:id/redevelopment/:passId/r6-rewrite/draft/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.brief?.approvedAt) {
        throw new Error("R1 Brief must be approved before R6 Pass 2");
      }
      if (!pass.pilotStrategy?.approvedAt) {
        throw new Error("R5 Pilot Strategy must be approved before R6 Pass 2");
      }
      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();
      if (!guardrails.approvedAt) {
        throw new Error("R6 Guardrails must be approved before R6 Pass 2");
      }
      const rewrite = pass.pilotRewrite;
      if (!rewrite || !rewrite.plan || rewrite.plan.length === 0) {
        throw new Error("R6 Pass 1 plan must exist before Pass 2");
      }
      if (!rewrite.planApprovedAt) {
        throw new Error(
          "R6 Pass 1 plan must be APPROVED before generating Pass 2"
        );
      }
      const priorScriptId =
        rewrite.priorScriptId ||
        (await loadExistingPilotContext(id)).scriptId ||
        "";

      const result = await generateR6Pass2({
        brief: pass.brief,
        characterBibles: pass.characterBibles,
        protocolModules: pass.protocolModules,
        seasonArc: pass.seasonArc?.episodes ?? [],
        pilotStrategy: pass.pilotStrategy,
        guardrails,
        plan: rewrite.plan,
        priorScriptId,
        notes: body.notes,
      });

      const updatedPass = await setR6Pass2Draft({
        projectId: id,
        passId,
        compiledFountain: result.compiledFountain,
        sceneActionSummary: result.sceneActionSummary,
      });

      const audit = auditAndRepairR6Pass2Draft({
        compiledFountain: result.compiledFountain,
        guardrails,
        missingPlanIndices: result.missingPlanIndices,
      });

      return {
        compiledFountain: result.compiledFountain,
        sceneActionSummary: result.sceneActionSummary,
        generatedPlanIndices: result.generatedPlanIndices,
        returnedPlanIndices: result.returnedPlanIndices,
        missingPlanIndices: result.missingPlanIndices,
        audit,
        report: computePassReport(updatedPass),
      };
    }
  );

  // GET /audit — read-only audit of the currently stored compiled draft.
  app.get(
    "/projects/:id/redevelopment/:passId/r6-rewrite/draft/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const rewrite = pass.pilotRewrite;
      if (!rewrite || !rewrite.proposedDraftText) {
        return {
          audit: {
            checks: [
              {
                id: "r6draft_paul_protected",
                label: "Paul reveal protected in the rewritten pilot",
                status: "warning",
                message:
                  "No Pass 2 draft generated yet. Click 'Generate scene text (Pass 2)' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();
      const audit = auditAndRepairR6Pass2Draft({
        compiledFountain: rewrite.proposedDraftText,
        guardrails,
      });
      return {
        audit,
        approvedAt: rewrite.approvedAt,
        auditedAt: new Date().toISOString(),
        // Tells the UI exactly what was audited so the showrunner
        // never confuses pre/post-repair audits.
        auditSource: "current_stored_proposed_draft",
        proposedDraftAt: rewrite.proposedDraftAt ?? null,
        fountainLen: rewrite.proposedDraftText.length,
      };
    }
  );

  // POST /approve — promote the proposed Pass 2 draft to a NEW
  // `scripts` row (Draft N+1) and index its scenes. Does NOT touch the
  // existing EP01 draft beyond setting `current = false`.
  app.post(
    "/projects/:id/redevelopment/:passId/r6-rewrite/draft/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const { pass, scriptId, draftNumber } = await promoteR6Pass2Draft({
        projectId: id,
        passId,
        approvedBy: user.id,
      });
      // Populate script_scenes for the new draft so downstream pipelines
      // (production passes, AI video prompts, etc.) have scene rows to
      // operate on. parseFountain + the insert in indexScenes() are
      // idempotent.
      try {
        await indexScenes(scriptId, pass.pilotRewrite?.proposedDraftText ?? "");
      } catch (err) {
        // Don't fail the promotion if scene indexing has trouble — the
        // script row is the source of truth. The user can re-index from
        // the script tools if needed. Surface the issue in the response.
        return {
          report: computePassReport(pass),
          scriptId,
          draftNumber,
          sceneIndexWarning: `Promoted, but scene indexing failed: ${(err as Error).message}. Re-index from script tools.`,
        };
      }
      return {
        report: computePassReport(pass),
        scriptId,
        draftNumber,
      };
    }
  );

  // POST /repair — surgical plant injection on the CURRENT proposedDraftText.
  //
  // Takes a list of target IDs (margot_professional_structure /
  // nadia_searching_behavior / claire_ritualized_grief / dean_usefulness),
  // runs ONE constrained LLM call that injects only those plants, saves
  // the revised draft, and returns the updated 15-check audit + the
  // LLM's per-target summary. Does NOT promote.
  app.post(
    "/projects/:id/redevelopment/:passId/r6-rewrite/draft/repair",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          targets: z.array(
            z.enum([
              "margot_professional_structure",
              "nadia_searching_behavior",
              "claire_ritualized_grief",
              "dean_usefulness",
            ])
          ),
          notes: z.string().optional(),
        })
        .parse(req.body ?? {});
      if (body.targets.length === 0) {
        throw new Error("at least one repair target is required");
      }
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const rewrite = pass.pilotRewrite;
      if (!rewrite || !rewrite.proposedDraftText) {
        throw new Error(
          "no Pass 2 draft to repair — generate the draft first"
        );
      }
      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const baseLen = rewrite.proposedDraftText.length;
      const result = await repairR6Pass2({
        baseFountain: rewrite.proposedDraftText,
        targets: body.targets,
        guardrails,
        notes: body.notes,
      });

      // Persist the repaired draft. Preserve the prior scene-action
      // summary — the repair touches scene CONTENT, not the plan's
      // KEEP/REVISE/MOVE/MERGE/CUT/ADD counts.
      const priorSummary = rewrite.sceneActionSummary ?? {
        kept: 0,
        revised: 0,
        moved: 0,
        merged: 0,
        cut: 0,
        added: 0,
      };
      const updatedPass = await setR6Pass2Draft({
        projectId: id,
        passId,
        compiledFountain: result.fountain,
        sceneActionSummary: priorSummary,
      });

      // Re-read the stored draft from the just-saved pass to GUARANTEE
      // the audit runs against what's actually persisted (not against
      // an in-memory copy that could diverge from disk).
      const persistedFountain =
        updatedPass.pilotRewrite?.proposedDraftText ?? result.fountain;
      const audit = auditAndRepairR6Pass2Draft({
        compiledFountain: persistedFountain,
        guardrails,
      });
      const auditedAt = new Date().toISOString();

      return {
        compiledFountain: persistedFountain,
        repairs: result.repairs,
        unrepaired: result.unrepaired,
        fullyRepaired: result.fullyRepaired,
        fountainChanged: result.fountainChanged,
        bytesDelta: result.bytesDelta,
        verification: result.verification,
        audit,
        auditedAt,
        auditSource: "repaired_proposed_draft",
        baseLen,
        newLen: persistedFountain.length,
        report: computePassReport(updatedPass),
      };
    }
  );

  // ----- R7 Pilot Polish Pass — plan-only (Pass 2 apply ships next) ----

  const r7PolishItemShape = z.object({
    existingSceneOrd: z.number().nullable(),
    existingSlugline: z.string().optional(),
    category: z.enum([
      "surrender_continuity",
      "notebook_recorder_object_logic",
      "dialogue_polish",
      "showrunner_note_prose",
      "episode_2_hook",
    ]),
    diagnosis: z.string(),
    fixDirection: z.string(),
    severity: z.enum(["high", "medium", "low"]).optional(),
    scope: z.enum(["line", "scene", "ending"]).optional(),
  });

  // POST /r7-polish/plan/generate — diagnose polish opportunities on
  // the promoted R6 draft. Runs the LLM, returns the plan, does NOT
  // persist. Caller reviews + edits + saves via PUT.
  app.post(
    "/projects/:id/redevelopment/:passId/r7-polish/plan/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      if (!pass.pilotStrategy?.approvedAt) {
        throw new Error("R5 Pilot Strategy must be approved before R7");
      }
      const rewrite = pass.pilotRewrite;
      if (!rewrite || !rewrite.approvedAt || !rewrite.promotedScriptId) {
        throw new Error(
          "R6 Pass 2 rewrite must be APPROVED and PROMOTED before R7 polish"
        );
      }
      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();
      if (!guardrails.approvedAt) {
        throw new Error("R6 Guardrails must be approved before R7 polish");
      }

      // Load the PROMOTED script's fountain directly from the scripts
      // table — that's the source of truth post-promotion. Fall back
      // to pilotRewrite.proposedDraftText if for some reason the
      // promoted row isn't readable.
      let promotedFountain = "";
      let promotedDraftNumber: number | null = null;
      try {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("fountain, draft_number")
          .eq("id", rewrite.promotedScriptId)
          .single();
        if (scriptRow) {
          promotedFountain = (scriptRow.fountain as string) ?? "";
          promotedDraftNumber = (scriptRow.draft_number as number) ?? null;
        }
      } catch {
        // fall through
      }
      if (!promotedFountain) {
        promotedFountain = rewrite.proposedDraftText ?? "";
      }
      if (!promotedFountain.trim()) {
        throw new Error(
          "Promoted EP01 draft is empty — cannot run R7 polish on nothing"
        );
      }

      const result = await generateR7PolishPlan({
        promotedFountain,
        promotedScriptId: rewrite.promotedScriptId,
        promotedDraftNumber: promotedDraftNumber ?? rewrite.promotedDraftNumber ?? null,
        guardrails,
        pass1Plan: rewrite.plan ?? [],
        pilotStrategy: pass.pilotStrategy,
        notes: body.notes,
      });

      return {
        approachSummary: result.approachSummary,
        items: result.items,
        priorScriptId: result.priorScriptId,
        promotedDraftNumber:
          promotedDraftNumber ?? rewrite.promotedDraftNumber ?? null,
        audit: result.audit,
      };
    }
  );

  // PUT /r7-polish/plan — save edits to the plan.
  app.put(
    "/projects/:id/redevelopment/:passId/r7-polish/plan",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          approachSummary: z.string(),
          items: z.array(r7PolishItemShape),
          priorScriptId: z.string(),
        })
        .parse(req.body ?? {});
      const pass = await setR7PolishPlan({
        projectId: id,
        passId,
        items: body.items,
        approachSummary: body.approachSummary,
        priorScriptId: body.priorScriptId,
      });
      return computePassReport(pass);
    }
  );

  // POST /r7-polish/plan/approve — lock the plan. Pass 2 (apply) reads
  // from the approved plan.
  app.post(
    "/projects/:id/redevelopment/:passId/r7-polish/plan/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await approveR7PolishPlan({ projectId: id, passId });
      return computePassReport(pass);
    }
  );

  // GET /r7-polish/plan/audit — read-only audit of the stored plan.
  app.get(
    "/projects/:id/redevelopment/:passId/r7-polish/plan/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r7Polish;
      if (!plan || !plan.items || plan.items.length === 0) {
        return {
          audit: {
            checks: [
              {
                id: "r7plan_items_present",
                label: "Polish items present",
                status: "warning",
                message:
                  "No polish plan generated yet. Click 'Generate polish plan' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const audit = auditAndRepairR7PolishPlan({
        items: plan.items,
        approachSummary: plan.approachSummary ?? "",
      });
      return {
        audit,
        approvedAt: plan.planApprovedAt ?? null,
        auditedAt: new Date().toISOString(),
        auditSource: "current_stored_polish_plan" as const,
      };
    }
  );

  // ----- R7 Pass 2 — Apply + Audit + Promote ----------------------------

  // POST /apply — runs the polish agent on the approved plan + the
  // promoted EP01 fountain. Stores the polished draft on the pass
  // (NOT promoted yet). Runs the post-apply audit.
  app.post(
    "/projects/:id/redevelopment/:passId/r7-polish/apply",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const polish = pass.r7Polish;
      if (!polish || !polish.planApprovedAt) {
        throw new Error("R7 polish plan must be APPROVED before applying");
      }
      if (!polish.items || polish.items.length === 0) {
        throw new Error("R7 polish plan has zero items — nothing to apply");
      }

      const rewrite = pass.pilotRewrite;
      if (!rewrite || !rewrite.approvedAt || !rewrite.promotedScriptId) {
        throw new Error(
          "R6 Pass 2 rewrite must be approved AND promoted before R7 apply"
        );
      }

      // Load the CURRENT promoted EP01 fountain. Prefer the scripts
      // table (authoritative); fall back to pilotRewrite.proposedDraftText.
      let baseFountain = "";
      try {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("fountain")
          .eq("id", rewrite.promotedScriptId)
          .single();
        if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
      } catch {
        /* fall through */
      }
      if (!baseFountain) baseFountain = rewrite.proposedDraftText ?? "";
      if (!baseFountain.trim()) {
        throw new Error(
          "Promoted EP01 draft is empty — cannot apply polish to nothing"
        );
      }

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const result = await applyR7Pass2({
        baseFountain,
        items: polish.items,
        guardrails,
        notes: body.notes,
      });

      const updatedPass = await setR7Pass2Draft({
        projectId: id,
        passId,
        polishedFountain: result.fountain,
      });

      const audit = auditAndRepairR7Pass2Draft({
        baseFountain,
        polishedFountain: result.fountain,
        guardrails,
        planItems: polish.items,
      });
      const auditedAt = new Date().toISOString();

      return {
        polishedFountain: result.fountain,
        applied: result.applied,
        unapplied: result.unapplied,
        fountainChanged: result.fountainChanged,
        bytesDelta: result.bytesDelta,
        baseLen: baseFountain.length,
        newLen: result.fountain.length,
        audit,
        auditedAt,
        auditSource: "r7_apply_polished_draft" as const,
        report: computePassReport(updatedPass),
      };
    }
  );

  // GET /draft/audit — read-only audit of the currently stored
  // polished draft.
  app.get(
    "/projects/:id/redevelopment/:passId/r7-polish/draft/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const polish = pass.r7Polish;
      if (!polish || !polish.polishedDraftText) {
        return {
          audit: {
            checks: [
              {
                id: "r7apply_draft_changed",
                label: "Draft changed vs. base",
                status: "warning",
                message:
                  "No polished R7 draft yet. Click 'Apply polish' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      // Reload base fountain for audit comparison.
      const rewrite = pass.pilotRewrite;
      let baseFountain = "";
      if (rewrite?.promotedScriptId) {
        try {
          const { data: scriptRow } = await supabase
            .from("scripts")
            .select("fountain")
            .eq("id", rewrite.promotedScriptId)
            .single();
          if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
        } catch {
          /* fall through */
        }
      }
      if (!baseFountain) baseFountain = rewrite?.proposedDraftText ?? "";

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const audit = auditAndRepairR7Pass2Draft({
        baseFountain,
        polishedFountain: polish.polishedDraftText,
        guardrails,
        planItems: polish.items ?? [],
      });
      return {
        audit,
        approvedAt: polish.approvedAt ?? null,
        auditedAt: new Date().toISOString(),
        auditSource: "current_stored_polished_draft" as const,
      };
    }
  );

  // POST /approve — promote the polished draft to a NEW scripts row.
  app.post(
    "/projects/:id/redevelopment/:passId/r7-polish/draft/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const { pass, scriptId, draftNumber } = await promoteR7Pass2Draft({
        projectId: id,
        passId,
        approvedBy: user.id,
      });
      try {
        await indexScenes(scriptId, pass.r7Polish?.polishedDraftText ?? "");
      } catch (err) {
        return {
          report: computePassReport(pass),
          scriptId,
          draftNumber,
          sceneIndexWarning: `Promoted, but scene indexing failed: ${(err as Error).message}.`,
        };
      }
      return {
        report: computePassReport(pass),
        scriptId,
        draftNumber,
      };
    }
  );

  // ====================================================================
  // R8 — Character Voice & Scene Life Pass
  // ====================================================================

  // POST /r8-voice/plan/generate — diagnose voice/life items on the
  // PROMOTED R7 EP01 (Draft 3).
  app.post(
    "/projects/:id/redevelopment/:passId/r8-voice/plan/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");

      const r7 = pass.r7Polish;
      if (!r7 || !r7.approvedAt || !r7.promotedScriptId) {
        throw new Error(
          "R7 must be approved AND promoted before R8 voice polish can plan"
        );
      }
      if (!pass.pilotStrategy) {
        throw new Error("pilot strategy missing — R8 needs R5 context");
      }

      // Load the CURRENT promoted R7 EP01 fountain. Prefer scripts table.
      let baseFountain = "";
      try {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("fountain, draft_number")
          .eq("id", r7.promotedScriptId)
          .single();
        if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
      } catch {
        /* fall through */
      }
      if (!baseFountain) baseFountain = r7.polishedDraftText ?? "";
      if (!baseFountain.trim()) {
        throw new Error(
          "Promoted R7 draft is empty — cannot plan voice polish on nothing"
        );
      }

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const result = await generateR8VoicePolishPlan({
        promotedFountain: baseFountain,
        promotedScriptId: r7.promotedScriptId,
        promotedDraftNumber: r7.promotedDraftNumber ?? null,
        guardrails,
        characterBibles: pass.characterBibles,
        pilotStrategy: pass.pilotStrategy,
        notes: body.notes,
      });

      const updatedPass = await setR8VoicePolishPlan({
        projectId: id,
        passId,
        items: result.items,
        approachSummary: result.approachSummary,
        priorScriptId: result.priorScriptId,
      });

      return {
        plan: {
          approachSummary: result.approachSummary,
          items: result.items,
          priorScriptId: result.priorScriptId,
        },
        audit: result.audit,
        auditedAt: new Date().toISOString(),
        auditSource: "r8_voice_polish_plan_generation" as const,
        report: computePassReport(updatedPass),
      };
    }
  );

  // PUT /r8-voice/plan — save edits to the plan.
  app.put(
    "/projects/:id/redevelopment/:passId/r8-voice/plan",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          approachSummary: z.string(),
          items: z.array(z.any()),
          priorScriptId: z.string().min(1),
        })
        .parse(req.body ?? {});
      const updated = await setR8VoicePolishPlan({
        projectId: id,
        passId,
        items: body.items,
        approachSummary: body.approachSummary,
        priorScriptId: body.priorScriptId,
      });
      return { report: computePassReport(updated) };
    }
  );

  // POST /r8-voice/plan/approve — lock the plan; Pass 2 reads it.
  app.post(
    "/projects/:id/redevelopment/:passId/r8-voice/plan/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const updated = await approveR8VoicePolishPlan({ projectId: id, passId });
      return { report: computePassReport(updated) };
    }
  );

  // GET /r8-voice/plan/audit — read-only audit of the stored plan.
  app.get(
    "/projects/:id/redevelopment/:passId/r8-voice/plan/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r8VoicePolish;
      if (!plan) {
        return {
          audit: {
            checks: [
              {
                id: "r8plan_items_present",
                label: "Voice items present",
                status: "warning",
                message:
                  "No R8 voice plan yet. Click 'Generate voice plan' first.",
              },
            ],
            repairs: [],
          },
          auditedAt: new Date().toISOString(),
        };
      }
      const audit = auditAndRepairR8VoicePolishPlan({
        items: plan.items ?? [],
        approachSummary: plan.approachSummary ?? "",
      });
      return {
        audit,
        auditedAt: new Date().toISOString(),
        auditSource: "current_stored_r8_plan" as const,
      };
    }
  );

  // POST /r8-voice/apply — runs the voice polish agent on the approved
  // plan + the promoted R7 EP01 fountain.
  app.post(
    "/projects/:id/redevelopment/:passId/r8-voice/apply",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r8VoicePolish;
      if (!plan || !plan.planApprovedAt) {
        throw new Error("R8 voice plan must be APPROVED before applying");
      }
      if (!plan.items || plan.items.length === 0) {
        throw new Error("R8 voice plan has zero items — nothing to apply");
      }

      const r7 = pass.r7Polish;
      if (!r7 || !r7.approvedAt || !r7.promotedScriptId) {
        throw new Error(
          "R7 must be approved AND promoted before R8 apply"
        );
      }

      let baseFountain = "";
      try {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("fountain")
          .eq("id", r7.promotedScriptId)
          .single();
        if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
      } catch {
        /* fall through */
      }
      if (!baseFountain) baseFountain = r7.polishedDraftText ?? "";
      if (!baseFountain.trim()) {
        throw new Error(
          "Promoted R7 draft is empty — cannot apply voice polish to nothing"
        );
      }

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const result = await applyR8Pass2({
        baseFountain,
        items: plan.items,
        guardrails,
        characterBibles: pass.characterBibles,
        notes: body.notes,
      });

      const updatedPass = await setR8Pass2Draft({
        projectId: id,
        passId,
        polishedFountain: result.fountain,
      });

      const audit = auditAndRepairR8Pass2Draft({
        baseFountain,
        polishedFountain: result.fountain,
        guardrails,
        planItems: plan.items,
      });
      const auditedAt = new Date().toISOString();

      return {
        polishedFountain: result.fountain,
        applied: result.applied,
        unapplied: result.unapplied,
        fountainChanged: result.fountainChanged,
        bytesDelta: result.bytesDelta,
        baseLen: baseFountain.length,
        newLen: result.fountain.length,
        audit,
        auditedAt,
        auditSource: "r8_apply_polished_draft" as const,
        report: computePassReport(updatedPass),
      };
    }
  );

  // GET /r8-voice/draft/audit — read-only audit of the stored polished draft.
  app.get(
    "/projects/:id/redevelopment/:passId/r8-voice/draft/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r8VoicePolish;
      if (!plan || !plan.polishedDraftText) {
        return {
          audit: {
            checks: [
              {
                id: "r8apply_draft_changed",
                label: "Draft changed vs. base",
                status: "warning",
                message: "No polished R8 draft yet. Click 'Apply voice polish' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const r7 = pass.r7Polish;
      let baseFountain = "";
      if (r7?.promotedScriptId) {
        try {
          const { data: scriptRow } = await supabase
            .from("scripts")
            .select("fountain")
            .eq("id", r7.promotedScriptId)
            .single();
          if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
        } catch {
          /* fall through */
        }
      }
      if (!baseFountain) baseFountain = r7?.polishedDraftText ?? "";

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const audit = auditAndRepairR8Pass2Draft({
        baseFountain,
        polishedFountain: plan.polishedDraftText,
        guardrails,
        planItems: plan.items ?? [],
      });
      return {
        audit,
        approvedAt: plan.approvedAt ?? null,
        auditedAt: new Date().toISOString(),
        auditSource: "current_stored_r8_polished_draft" as const,
      };
    }
  );

  // POST /r8-voice/draft/approve — promote the polished draft to a new
  // scripts row (Draft N+1).
  app.post(
    "/projects/:id/redevelopment/:passId/r8-voice/draft/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const { pass, scriptId, draftNumber } = await promoteR8Pass2Draft({
        projectId: id,
        passId,
        approvedBy: user.id,
      });
      try {
        await indexScenes(scriptId, pass.r8VoicePolish?.polishedDraftText ?? "");
      } catch (err) {
        return {
          report: computePassReport(pass),
          scriptId,
          draftNumber,
          sceneIndexWarning: `Promoted, but scene indexing failed: ${(err as Error).message}.`,
        };
      }
      return {
        report: computePassReport(pass),
        scriptId,
        draftNumber,
      };
    }
  );

  // ====================================================================
  // R9 — Final Hook & Emotional Anchor Pass
  // ====================================================================

  // POST /r9-final/plan/generate — diagnose final polish items on the
  // R8-PROMOTED Draft 4.
  app.post(
    "/projects/:id/redevelopment/:passId/r9-final/plan/generate",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");

      const r8 = pass.r8VoicePolish;
      if (!r8 || !r8.approvedAt || !r8.promotedScriptId) {
        throw new Error(
          "R8 must be approved AND promoted before R9 final polish can plan"
        );
      }
      if (!pass.pilotStrategy) {
        throw new Error("pilot strategy missing — R9 needs R5 context");
      }

      // Load the CURRENT promoted Draft 4 fountain.
      let baseFountain = "";
      try {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("fountain, draft_number")
          .eq("id", r8.promotedScriptId)
          .single();
        if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
      } catch {
        /* fall through */
      }
      if (!baseFountain) baseFountain = r8.polishedDraftText ?? "";
      if (!baseFountain.trim()) {
        throw new Error(
          "Promoted R8 Draft 4 is empty — cannot plan final polish on nothing"
        );
      }

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const result = await generateR9FinalPolishPlan({
        promotedFountain: baseFountain,
        promotedScriptId: r8.promotedScriptId,
        promotedDraftNumber: r8.promotedDraftNumber ?? null,
        guardrails,
        characterBibles: pass.characterBibles,
        pilotStrategy: pass.pilotStrategy,
        notes: body.notes,
      });

      const updatedPass = await setR9FinalPolishPlan({
        projectId: id,
        passId,
        items: result.items,
        approachSummary: result.approachSummary,
        priorScriptId: result.priorScriptId,
      });

      return {
        plan: {
          approachSummary: result.approachSummary,
          items: result.items,
          priorScriptId: result.priorScriptId,
        },
        audit: result.audit,
        auditedAt: new Date().toISOString(),
        auditSource: "r9_final_polish_plan_generation" as const,
        report: computePassReport(updatedPass),
      };
    }
  );

  // PUT /r9-final/plan — save edits to the plan.
  app.put(
    "/projects/:id/redevelopment/:passId/r9-final/plan",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({
          approachSummary: z.string(),
          items: z.array(z.any()),
          priorScriptId: z.string().min(1),
        })
        .parse(req.body ?? {});
      const updated = await setR9FinalPolishPlan({
        projectId: id,
        passId,
        items: body.items,
        approachSummary: body.approachSummary,
        priorScriptId: body.priorScriptId,
      });
      return { report: computePassReport(updated) };
    }
  );

  // POST /r9-final/plan/approve — lock the plan; Pass 2 reads it.
  app.post(
    "/projects/:id/redevelopment/:passId/r9-final/plan/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const updated = await approveR9FinalPolishPlan({ projectId: id, passId });
      return { report: computePassReport(updated) };
    }
  );

  // GET /r9-final/plan/audit — read-only audit of the stored plan.
  app.get(
    "/projects/:id/redevelopment/:passId/r9-final/plan/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r9FinalPolish;
      if (!plan) {
        return {
          audit: {
            checks: [
              {
                id: "r9plan_items_present",
                label: "Final polish items present",
                status: "warning",
                message:
                  "No R9 plan yet. Click 'Generate final plan' first.",
              },
            ],
            repairs: [],
          },
          auditedAt: new Date().toISOString(),
        };
      }
      const audit = auditAndRepairR9FinalPolishPlan({
        items: plan.items ?? [],
        approachSummary: plan.approachSummary ?? "",
      });
      return {
        audit,
        auditedAt: new Date().toISOString(),
        auditSource: "current_stored_r9_plan" as const,
      };
    }
  );

  // POST /r9-final/apply — runs the apply agent on the approved plan +
  // the R8-promoted Draft 4 fountain. Produces Draft 5.
  app.post(
    "/projects/:id/redevelopment/:passId/r9-final/apply",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const body = z
        .object({ notes: z.string().optional() })
        .parse(req.body ?? {});
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r9FinalPolish;
      if (!plan || !plan.planApprovedAt) {
        throw new Error("R9 plan must be APPROVED before applying");
      }
      if (!plan.items || plan.items.length === 0) {
        throw new Error("R9 plan has zero items — nothing to apply");
      }

      const r8 = pass.r8VoicePolish;
      if (!r8 || !r8.approvedAt || !r8.promotedScriptId) {
        throw new Error(
          "R8 must be approved AND promoted before R9 apply"
        );
      }

      let baseFountain = "";
      try {
        const { data: scriptRow } = await supabase
          .from("scripts")
          .select("fountain")
          .eq("id", r8.promotedScriptId)
          .single();
        if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
      } catch {
        /* fall through */
      }
      if (!baseFountain) baseFountain = r8.polishedDraftText ?? "";
      if (!baseFountain.trim()) {
        throw new Error(
          "Promoted R8 Draft 4 is empty — cannot apply final polish to nothing"
        );
      }

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const result = await applyR9Pass2({
        baseFountain,
        items: plan.items,
        guardrails,
        characterBibles: pass.characterBibles,
        notes: body.notes,
      });

      const updatedPass = await setR9Pass2Draft({
        projectId: id,
        passId,
        polishedFountain: result.fountain,
      });

      const audit = auditAndRepairR9Pass2Draft({
        baseFountain,
        polishedFountain: result.fountain,
        guardrails,
        planItems: plan.items,
      });
      const auditedAt = new Date().toISOString();

      return {
        polishedFountain: result.fountain,
        applied: result.applied,
        unapplied: result.unapplied,
        fountainChanged: result.fountainChanged,
        bytesDelta: result.bytesDelta,
        baseLen: baseFountain.length,
        newLen: result.fountain.length,
        audit,
        auditedAt,
        auditSource: "r9_apply_polished_draft" as const,
        report: computePassReport(updatedPass),
      };
    }
  );

  // GET /r9-final/draft/audit — read-only audit of the stored Draft 5.
  app.get(
    "/projects/:id/redevelopment/:passId/r9-final/draft/audit",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const pass = await getPass(id, passId);
      if (!pass) throw new Error("pass not found");
      const plan = pass.r9FinalPolish;
      if (!plan || !plan.polishedDraftText) {
        return {
          audit: {
            checks: [
              {
                id: "r9apply_draft_changed",
                label: "Draft changed vs. base",
                status: "warning",
                message:
                  "No polished R9 draft yet. Click 'Apply final polish' first.",
              },
            ],
            repairs: [],
          },
          approvedAt: null,
        };
      }
      const r8 = pass.r8VoicePolish;
      let baseFountain = "";
      if (r8?.promotedScriptId) {
        try {
          const { data: scriptRow } = await supabase
            .from("scripts")
            .select("fountain")
            .eq("id", r8.promotedScriptId)
            .single();
          if (scriptRow) baseFountain = (scriptRow.fountain as string) ?? "";
        } catch {
          /* fall through */
        }
      }
      if (!baseFountain) baseFountain = r8?.polishedDraftText ?? "";

      const rawGuard = pass.r6Guardrails;
      const guardrails = (() => {
        if (!rawGuard) return { perCharacter: [], globalRule: "", globalPlants: [], approvedAt: null };
        if (Array.isArray(rawGuard)) {
          return { perCharacter: rawGuard, globalRule: "", globalPlants: [], approvedAt: null };
        }
        return {
          perCharacter: rawGuard.perCharacter ?? [],
          globalRule: rawGuard.globalRule ?? "",
          globalPlants: rawGuard.globalPlants ?? [],
          approvedAt: rawGuard.approvedAt ?? null,
        };
      })();

      const audit = auditAndRepairR9Pass2Draft({
        baseFountain,
        polishedFountain: plan.polishedDraftText,
        guardrails,
        planItems: plan.items ?? [],
      });
      return {
        audit,
        approvedAt: plan.approvedAt ?? null,
        auditedAt: new Date().toISOString(),
        auditSource: "current_stored_r9_polished_draft" as const,
      };
    }
  );

  // POST /r9-final/draft/approve — promote Draft 5 to a new scripts row.
  app.post(
    "/projects/:id/redevelopment/:passId/r9-final/draft/approve",
    async (req) => {
      const user = await requireUser(req);
      const { id, passId } = req.params as { id: string; passId: string };
      await assertProjectMember(user.id, id);
      const { pass, scriptId, draftNumber } = await promoteR9Pass2Draft({
        projectId: id,
        passId,
        approvedBy: user.id,
      });
      try {
        await indexScenes(scriptId, pass.r9FinalPolish?.polishedDraftText ?? "");
      } catch (err) {
        return {
          report: computePassReport(pass),
          scriptId,
          draftNumber,
          sceneIndexWarning: `Promoted, but scene indexing failed: ${(err as Error).message}.`,
        };
      }
      return {
        report: computePassReport(pass),
        scriptId,
        draftNumber,
      };
    }
  );
}

// Convenience export for typed responses (used by the frontend client).
export type { RedevelopmentPass };
