import type { Agent, AgentRole } from "./types.js";
import { showrunnerAgent } from "./showrunner.js";
import { conceptAgent } from "./concept.js";
import { characterAgent } from "./character.js";
import { worldAgent } from "./world.js";
import { plotAgent } from "./plot.js";
import { sceneAgent } from "./scene.js";
import { dialogueAgent } from "./dialogue.js";
import { scriptDoctorAgent } from "./scriptDoctor.js";
import { continuityAgent } from "./continuity.js";
import { producerAgent } from "./producer.js";
import { emotionalTruthAgent } from "./emotionalTruth.js";
import { subtextAgent } from "./subtext.js";
import { characterWoundAgent } from "./characterWound.js";
import { behaviorAgent } from "./behavior.js";
import { relationshipTensionAgent } from "./relationshipTension.js";

export const AGENTS: Record<AgentRole, Agent<any, any>> = {
  showrunner: showrunnerAgent,
  concept: conceptAgent,
  character: characterAgent,
  world: worldAgent,
  plot: plotAgent,
  scene: sceneAgent,
  dialogue: dialogueAgent,
  script_doctor: scriptDoctorAgent,
  continuity: continuityAgent,
  producer: producerAgent,
  // -------- Emotional Intelligence Layer --------
  emotional_truth: emotionalTruthAgent,
  subtext: subtextAgent,
  character_wound: characterWoundAgent,
  behavior: behaviorAgent,
  relationship_tension: relationshipTensionAgent,
};

export function getAgent<TIn = unknown, TOut = unknown>(
  role: AgentRole
): Agent<TIn, TOut> {
  const a = AGENTS[role];
  if (!a) throw new Error(`Unknown agent role: ${role}`);
  return a as Agent<TIn, TOut>;
}
