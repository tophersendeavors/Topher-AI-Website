# Emotional Intelligence Layer

The EI Layer is a set of five specialized agents plus a deterministic
directness validator that work together to keep TOBURT's drafts emotionally
truthful — never letting characters announce their feelings when they should
be acting them.

---

## Agents

| Agent | Owns |
|---|---|
| `emotional_truth` | Cause/effect plausibility, the ten emotional fields per scene, `truthScore`, rejection list. |
| `subtext` | Rewrites on-the-nose dialogue into indirect lines with layered meaning. |
| `character_wound` | Per-character: wound, fear, unmet need, shame trigger, defenses, behavioral signatures. |
| `behavior` | Translates stated emotion into physical action, avoidance, contradiction, silence, micro-tells. |
| `relationship_tension` | The unsaid between two characters: history, current power, tension score, pressure points, per-scene shifts. |

Each lives at `backend/src/agents/<name>.ts` and is registered in
`registry.ts`. All five appear in the Writers Room agent picker.

---

## The ten required scene fields

Every scene's `SceneEmotionalState` row has:

```ts
emotionalEntryState   // how the character enters
emotionalExitState    // how the character leaves
hiddenWant            // what they actually want
visibleWant           // what they say they want
fear                  // what they're afraid will happen
contradiction         // a want that contradicts another want/need
subtext               // the meaning under the dialogue
behavioralTells       // small, observable signs
powerShift            // how power moved in this scene
relationshipShift     // how the dynamic changed
```

Persisted in `scene_emotional_states` (one current row per scene, with full
revision history via `supersedes_id` + `version`).

---

## The rejection rule

> The system must reject scenes where characters explain emotions too directly
> unless intentionally stylistic.

Two complementary checks:

1. **Directness validator** (`backend/src/screenplay/emotionalValidator.ts`).
   Deterministic regex rule set with `info | warn | critical` severities.
   Examples of `critical`: `"I feel sad"`, `"You make me feel ..."`,
   `"Ever since X, I've ..."`, `"I'm feeling X because Y"`. Runs without
   touching an LLM.

2. **Emotional Truth agent** also returns a `rejections[]` array with
   structured reasons (`direct_emotion`, `unmotivated_reaction`,
   `missing_contradiction`, `exposition_emotion`, `feelings_as_dialogue`).

A scene is **rejected** when:

- the validator's critical count exceeds `EMOTIONAL_REJECTION_THRESHOLD`
  (default 2), **or**
- the EI agent's critical count exceeds the same threshold,
- **and** the project's `allow_stylistic_directness` flag is false.

Rejection effects:

- The scene's `SceneEmotionalState` is persisted with `rejected = true` and a
  populated `rejection_reason`.
- A `room_messages` critique is posted by the `emotional_truth` agent.
- A `continuity_issues` row (kind=`emotional_directness`, severity=`critical`)
  surfaces on the Continuity page and the Emotional Intelligence page.

---

## Pipeline integration

In `draft_v1`, each scene goes through:
```
Scene → Dialogue → Behavior → Subtext  →  fountain saved
```

After the script is persisted, the EI pass runs (full agents + validator):
```
POST /api/scripts/:id/emotional/pass
```

Which iterates every scene through the full chain and writes a
`SceneEmotionalState`.

For single-scene workflows (the editor's "Behavior pass" / "Subtext pass" /
"Emotional truth" buttons), invoke directly:
```
POST /api/scenes/:sceneId/emotional/pass
```

---

## Stylistic mode

Some projects intentionally use direct emotional dialogue — fables, theatre
adaptations, surrealist work. Toggle:

```
PATCH /api/projects/:id/emotional/settings
{ "allow_stylistic_directness": true }
```

When on, the validator still records flags but does not reject. The Emotional
Truth agent's `direct_emotion` rejections are downgraded from `critical` to
`warn`.

---

## Data model (see `supabase/migrations/0005_emotional_intelligence.sql`)

- `character_wounds` — one per character, append-only.
- `relationship_tensions` — one per pair, append-only.
- `scene_emotional_states` — one current row per scene + version history.
  Unique partial index `(scene_id) WHERE current = true`.
- `projects.allow_stylistic_directness` — boolean toggle.

All tables enforce the standard `is_project_member` RLS policy.
