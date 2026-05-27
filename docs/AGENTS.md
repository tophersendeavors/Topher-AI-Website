# Agents

Every agent is a typed module under `backend/src/agents/`. Each declares a
role, a system prompt builder, an input/output zod schema, an allowed toolset,
and a default model.

This document is the authoritative spec for what each agent *does*, *sees*,
and *produces*. If you change the prompt or schema in code, update this file.

---

## Common context

Every agent receives:

```ts
type AgentContext = {
  projectId: string;
  workflowId?: string;
  stage?: WorkflowStage;
  showrunnerNotes?: string;     // sticky vision/tone overrides
  retrievedCanon: MemoryHit[];  // top-k canon for the current scope
  retrievedDrafts: MemoryHit[]; // top-k working drafts
  collaborators: AgentRole[];   // who else is in the room this turn
  user?: { id: string; name: string };
};
```

The runner hydrates this context before each call by:

1. Loading project + workflow rows.
2. Building a query vector from the current stage's intent + input.
3. Pulling top-k canon and drafts via `memory.search`.
4. Pasting the most recent Writers Room transcript window.

---

## 1. Showrunner

**Goal**: protect the vision. Enforce genre, tone, season arc. Arbitrate when
agents disagree. Approve canon changes.

**Input**

```ts
{
  intent: "approve_treatment" | "approve_season_arc" | "approve_draft" |
          "arbitrate" | "respond" | "set_vision";
  candidate: unknown;          // the artifact under review
  critiques?: { role: AgentRole; note: string }[];
}
```

**Output**

```ts
{
  decision: "approve" | "reject" | "revise";
  rationale: string;
  notes: string[];             // sticky vision notes (appended to project)
  edits?: Patch[];             // optional direct edits
}
```

**Tools**: `retrieveCanon`, `proposeCanonChange`, `vetoOutput`,
`requestApproval`.

**Model**: `SHOWRUNNER_MODEL` (default `claude-opus-4-7`).

---

## 2. Concept

**Goal**: turn an idea into a sharp logline, hook, and premise, with
thematic options.

**Input**

```ts
{ idea: string; constraints?: { genre?: string; tone?: string; length?: string } }
```

**Output**

```ts
{
  loglines: { text: string; hook: string; theme: string }[]; // 3-5 variants
  premise: string;
  themes: string[];
}
```

**Tools**: `retrieveCanon`.

---

## 3. Character

**Goal**: build and maintain character bibles, voice fingerprints, arcs and
relationship graphs.

**Input**

```ts
{
  intent: "create" | "update" | "arc" | "voice" | "relate";
  characterId?: string;
  seed?: { name?: string; archetype?: string; role?: string };
  draftSample?: string;       // dialogue to fingerprint
}
```

**Output**

```ts
{
  character: {
    id?: string; name: string; archetype: string;
    biography: string; wants: string; needs: string; flaw: string;
    voice: { vocabulary: string; rhythm: string; tells: string[] };
  };
  arc?: { act1: string; act2: string; act3: string };
  relationships?: { other: string; nature: string; tension: string }[];
  voiceFingerprint?: number[]; // 1024-dim style vector
}
```

**Tools**: `retrieveCanon`, `getCharacter`, `voiceFingerprint`,
`proposeCanonChange`.

---

## 4. World / Canon

**Goal**: lore, timeline, rules. Detect canon conflicts.

**Input**

```ts
{
  intent: "build" | "extend" | "validate";
  draft?: string;            // text whose canon implications to extract
  range?: { from?: string; to?: string };
}
```

**Output**

```ts
{
  facts: { kind: "rule" | "event" | "place" | "object"; body: string; when?: string }[];
  conflicts: { existingId: string; reason: string }[];
}
```

**Tools**: `retrieveCanon`, `getTimeline`, `proposeCanonChange`.

---

## 5. Plot

**Goal**: act structure, episode breakdowns, pacing, cliffhangers.

**Input**

```ts
{
  intent: "season_arc" | "episode_outline" | "beat_sheet" | "tension_pass";
  scope: { seasonId?: string; episodeId?: string };
  brief?: string;
}
```

**Output**

```ts
{
  acts?: { number: 1|2|3|4|5; goal: string; turn: string }[];
  episodes?: { number: number; title: string; logline: string;
               aBeats: string[]; bBeats?: string[]; tag?: string }[];
  beats?: { id: string; order: number; type: BeatType; body: string }[];
}
```

**Tools**: `retrieveCanon`, `retrieveDrafts`.

---

## 6. Scene

**Goal**: construct, refine and transition scenes.

**Input**

```ts
{
  intent: "draft" | "refine" | "transition";
  sceneId?: string;
  brief: { slugline: string; goal: string; conflict: string; turn: string;
           characters: string[] };
}
```

**Output**

```ts
{
  fountain: string;          // scene as Fountain text
  entities: { characters: string[]; locations: string[]; props: string[] };
  beats: string[];
}
```

**Tools**: `retrieveCanon`, `getCharacter`, `tagSceneEntities`.

---

## 7. Dialogue

**Goal**: line-by-line dialogue with voice, subtext, realism.

**Input**

```ts
{
  intent: "pass" | "punchup" | "voice_fix";
  sceneFountain: string;
  characters: string[];      // ids
}
```

**Output**

```ts
{
  fountain: string;          // modified scene
  voiceWarnings: { character: string; line: number; score: number }[];
  subtextNotes?: string[];
}
```

**Tools**: `getCharacter`, `voiceFingerprint`.

---

## 8. Script Doctor

**Goal**: structural and pacing diagnosis + rewrite suggestions.

**Input**

```ts
{
  scriptId: string;
  focus?: "pacing" | "cliché" | "structure" | "emotional_impact" | "all";
}
```

**Output**

```ts
{
  diagnoses: {
    sceneId?: string; severity: "info" | "warn" | "critical";
    kind: "pacing" | "cliché" | "weak_scene" | "structure" | "emotion";
    note: string; suggestion?: string;
  }[];
  emotionalArcScore: number;     // 0..1
}
```

**Tools**: `retrieveCanon`, `retrieveDrafts`.

**Model**: `SCRIPT_DOCTOR_MODEL` (default `claude-opus-4-7`).

---

## 9. Continuity

**Goal**: validate wardrobe / location / timeline / relationship continuity.

**Input**

```ts
{
  scope: { scriptId?: string; episodeId?: string; seasonId?: string };
}
```

**Output**

```ts
{
  issues: {
    kind: "wardrobe" | "location" | "timeline" | "relationship" | "prop";
    severity: "info" | "warn" | "critical";
    sceneIds: string[];
    note: string;
    suggestedFix?: string;
  }[];
}
```

**Tools**: `retrieveCanon`, `getTimeline`, `getRelationship`,
`tagSceneEntities`.

**Model**: `CONTINUITY_MODEL` (default `claude-haiku-4-5-20251001` — cheap +
fast for the wide canon scans).

---

## 10. Producer

**Goal**: budget / feasibility / VFX / AI-gen practicality assessment.

**Input**

```ts
{ scriptId: string; budgetTier?: "indie" | "mid" | "studio" | "tentpole" }
```

**Output**

```ts
{
  estimate: { tier: string; reasoning: string };
  flags: {
    kind: "vfx" | "stunt" | "location" | "cast" | "ai_gen" | "weather";
    sceneIds: string[]; note: string; mitigation?: string;
  }[];
  aiGen: {
    sceneId: string; suitable: boolean; notes: string;
  }[];
}
```

**Tools**: `retrieveDrafts`, `tagSceneEntities`.

---

# Emotional Intelligence Layer

See [`EMOTIONAL_INTELLIGENCE.md`](./EMOTIONAL_INTELLIGENCE.md) for the full
spec. Quick reference:

## 11. Emotional Truth

**Goal**: audit every scene for believable emotional cause and effect; produce
the ten required emotional fields; reject scenes that explain emotions
directly.

**Input**: `{ sceneFountain, characters[], scriptId?, allowStylistic }`
**Output**: `EmotionalTruthReport` — includes a complete `SceneEmotionalState`,
a `truthScore` (0..1), a list of `causeEffect` judgments, and structured
`rejections[]`.
**Tools**: `retrieveCanon`, `retrieveDrafts`, `getCharacter`.

## 12. Subtext

**Goal**: rewrite on-the-nose lines into indirect, layered ones.

**Input**: `{ sceneFountain, characters[], preferAction }`
**Output**: `{ fountain, replacements: SubtextRewrite[] }`.
**Tools**: `retrieveCanon`, `getCharacter`, `voiceFingerprint`.

## 13. Character Wound

**Goal**: per-character wound, fear, unmet need, shame trigger, defenses.

**Input**: `{ intent: "create"|"refine"|"extract", characterId?, seed? }`
**Output**: `{ wound: CharacterWound, notes[] }`. Promotes to canon via
`proposeCanonChange`.

## 14. Behavior

**Goal**: translate stated emotion into physical action / silence /
contradiction / micro-tells.

**Input**: `{ sceneFountain, characters[], replaceStatedEmotion }`
**Output**: `BehaviorTranslation` — `{ fountain, beats: BehaviorBeat[] }`.

## 15. Relationship Tension

**Goal**: surface the unsaid between two characters and per-scene shifts.

**Input**: `{ intent: "map"|"scene_pass"|"refine", relationshipId?, aId?, bId?, sceneFountain? }`
**Output**: `{ tension: RelationshipTension, sceneEffect? }` where
`sceneEffect` carries the `powerShift` and `relationshipShift` that the
`SceneEmotionalState` requires.
