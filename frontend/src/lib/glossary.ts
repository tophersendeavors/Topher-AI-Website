// Plain-language glossary. The OS uses professional development
// terminology in its data model — wound, scene turn, subtext, power
// shift, source-strict, master shot brief — and a non-expert user
// shouldn't be expected to know what those mean. The Explainer component
// pulls entries from this map.

export interface GlossaryEntry {
  /** Stable id used by Explainer (e.g. "character_wound"). */
  id: string;
  /** The term as it appears in the UI. */
  term: string;
  /** Plain-English explanation, 1–3 sentences. No jargon. */
  description: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  character_wound: {
    id: "character_wound",
    term: "Character wound",
    description:
      "The unresolved emotional injury that shapes how the character protects themselves, lies, loves, and reacts under pressure. Most prestige drama is built on these.",
  },
  character_dna: {
    id: "character_dna",
    term: "Character DNA",
    description:
      "A condensed sheet of what makes a character tick: core wound, public mask, private fear, speech rhythm, behavioural tics, what they refuse to say, how they lie, how they show vulnerability. Used by the scene + dialogue agents to keep voices distinct.",
  },
  relationship_dynamics: {
    id: "relationship_dynamics",
    term: "Relationship dynamics",
    description:
      "What happens emotionally when two characters share a scene — what they each want, what they withhold, where power sits, what's at stake. Drives subtext, dialogue, scene tension, pitch deck copy, and rewrite notes.",
  },
  scene_turn: {
    id: "scene_turn",
    term: "Scene turn",
    description:
      "What changes from the beginning of the scene to the end. A decision, a revelation, a shift in leverage, a new problem. If nothing changes, the scene probably doesn't need to exist.",
  },
  subtext: {
    id: "subtext",
    term: "Subtext",
    description:
      "What characters mean without saying it. A line is 'on the nose' when it states the emotion directly. Subtext means the audience reads the meaning through behaviour, silence, props, misdirection.",
  },
  power_shift: {
    id: "power_shift",
    term: "Power shift",
    description:
      "Who has leverage at the start of the scene vs. who has it at the end. Could be information, vulnerability, refusal, or an action that can't be undone.",
  },
  visual_behavior: {
    id: "visual_behavior",
    term: "Visual behaviour",
    description:
      "Emotion shown through what a character does with their hands, eyes, breath, or objects — not through what they say. The difference between 'I'm scared' and folding a letter too precisely.",
  },
  source_strict: {
    id: "source_strict",
    term: "Source-strict",
    description:
      "A regeneration mode that forbids the AI from inventing specifics — pseudonyms, off-screen events, scripted episode beats, future canon. Only approved story data is used. Anything speculative gets moved to Internal Notes as a 'possible future story idea.'",
  },
  master_shot_brief: {
    id: "master_shot_brief",
    term: "Master Shot Brief",
    description:
      "The universal description of one shot — purpose, action, framing, performance, props, dialogue — written once. Different AI video models then translate the brief into their own prompt language.",
  },
  visual_weight: {
    id: "visual_weight",
    term: "Visual weight",
    description:
      "What the shot actually needs the AI to render well — environment, character, motion, dialogue, object, atmosphere. The router routes by visual weight, not by how dramatically important the scene is.",
  },
  model_router: {
    id: "model_router",
    term: "Model router",
    description:
      "The system that picks which AI video model is best for THIS shot — by weighting the shot's visual needs (atmosphere, character, motion, dialogue) against each model's reliability. You can always override the recommendation.",
  },
  quality_gate: {
    id: "quality_gate",
    term: "Quality gate",
    description:
      "After a clip is generated, score it 1–10 on ten categories (behaviour, motion, character consistency, prompt adherence, safety, …). The system recommends Accept / Accept with notes / Regenerate / Use as pre-viz. The writer decides.",
  },
  shot_tags: {
    id: "shot_tags",
    term: "Shot tags",
    description:
      "Production categories per shot: ENV (environment), BEH (behavioural insert), CHAR (character performance), TRANS (transition), PRE (pre-viz), VO (voiceover), KEY (keyframe), ACT (action), INT (interior), EXT (exterior). A shot can carry several.",
  },
  pitch_buyer_summary: {
    id: "pitch_buyer_summary",
    term: "Buyer-facing summary",
    description:
      "The paragraph a network reader sees on the deck. Restrained, premium, no spoilers in the closing line, no clichés like 'a rollercoaster ride.' Names the engine and the cost.",
  },
  approval_status: {
    id: "approval_status",
    term: "Approval status",
    description:
      "Where this piece sits in the review chain. AI can draft and recommend; only the writer marks something approved. Approved content is what feeds the pitch deck, exports, and scene generators.",
  },
  importance_levels: {
    id: "importance_levels",
    term: "Importance levels",
    description:
      "Core = drives the show's spine. Secondary = matters in the season but isn't the engine. Optional = ensemble overlap only. Background = present but rarely on-page. Only approved Core + Secondary relationships feed the Pitch Materials slide.",
  },
  spec_format: {
    id: "spec_format",
    term: "Spec format",
    description:
      "Professional screenplay formatting — slugline, character cues in caps, action lines kept tight (≤3 lines), parentheticals minimal. The 95% audit checks this automatically.",
  },
  emotional_residue: {
    id: "emotional_residue",
    term: "Emotional residue",
    description:
      "What the scene leaves behind in the audience — dread, curiosity, intimacy, consequence. A scene that resolves itself cleanly has no residue.",
  },
  ninety_five_protocol: {
    id: "ninety_five_protocol",
    term: "95% Script Quality Protocol",
    description:
      "Every scene is scored across ten craft categories. A scene passes only when the weighted average is ≥ 8.5 AND no critical category drops below 8. AI never auto-approves — only the writer can mark Spec Ready.",
  },
};

export function explainerFor(id: string): GlossaryEntry | null {
  return GLOSSARY[id] ?? null;
}
