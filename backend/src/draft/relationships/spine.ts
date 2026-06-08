// Story-spine candidate generator — shared by /suggest-preview and the
// one-click /generate-map flow. Returns the same shape both endpoints
// need: candidates ranked by story-spine importance (not role labels
// alone) + a count of skipped non-individual entries.

import { supabase } from "../../db/client.js";

export type Importance = "core" | "secondary" | "optional" | "background";

export interface SpineCandidate {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  pairingName: string;
  importance: Importance;
  nature: string;
  reason: string;
}

export interface SpineResult {
  candidates: SpineCandidate[];
  skippedNonIndividuals: number;
  /** Whether previously-deleted pairings were re-included. */
  includesDeleted: boolean;
}

const STRONG_ENGINE = /(engine|drives|spine|central|core|throughline|defines)/i;
const MARITAL = /\b(spouse|husband|wife|married|marriage|partner|fianc)/i;

function firstName(full: string): string {
  return (full.split(/\s+/)[0] ?? "").replace(/[^a-zA-Z]/g, "").toLowerCase();
}

async function loadSourceText(projectId: string): Promise<string> {
  let text = "";
  const { data: proj } = await supabase
    .from("projects")
    .select("showrunner_notes")
    .eq("id", projectId)
    .maybeSingle();
  text += (proj?.showrunner_notes as string) ?? "";
  text += "\n";
  const { data: wfs } = await supabase
    .from("workflows")
    .select("id, episode_id")
    .eq("project_id", projectId);
  const projWf = (wfs ?? []).find((w) => !w.episode_id) ?? (wfs ?? [])[0];
  if (projWf) {
    const { data: art } = await supabase
      .from("workflow_stage_artifacts")
      .select("body")
      .eq("workflow_id", projWf.id)
      .eq("stage_id", "treatment")
      .order("revision", { ascending: false })
      .limit(1);
    const t = (art?.[0]?.body as Record<string, unknown> | undefined) ?? {};
    text += `${(t.treatmentProse as string) ?? ""}\n${(t.shortSynopsis as string) ?? ""}\n${(t.worldStatement as string) ?? ""}\n${(t.emotionalEngine as string) ?? ""}\n`;
    if (Array.isArray(t.themes)) text += (t.themes as string[]).join(" ") + "\n";
  }
  const { data: season } = await supabase
    .from("seasons")
    .select("arc")
    .eq("project_id", projectId)
    .order("number", { ascending: true })
    .limit(1);
  const arc = (season?.[0]?.arc as Record<string, unknown> | null) ?? null;
  if (arc) text += `${(arc.premise as string) ?? ""}\n${(arc.throughline as string) ?? ""}\n`;
  const { data: eps } = await supabase
    .from("episodes")
    .select("title, logline, outline")
    .eq("project_id", projectId);
  for (const e of eps ?? []) {
    text += `${(e.title as string) ?? ""} ${(e.logline as string) ?? ""}\n`;
    const o = (e.outline as Record<string, unknown> | null) ?? null;
    if (o) {
      if (Array.isArray(o.acts)) {
        for (const a of o.acts as unknown[]) {
          const ac = (a ?? {}) as Record<string, unknown>;
          text += `${(ac.summary as string) ?? ""} ${(ac.turn as string) ?? ""}\n`;
        }
      }
      if (o.cold_open) text += (o.cold_open as string) + "\n";
    }
  }
  return text.toLowerCase();
}

/**
 * Read all the inputs and produce ranked candidate pairings. This is the
 * single source of truth — both the suggest-preview UI and the one-click
 * generate-map flow call this.
 */
export async function suggestSpineCandidates(
  projectId: string,
  opts: { includeDeleted?: boolean } = {}
): Promise<SpineResult> {
  const [{ data: chars }, { data: existing }, { data: proj }] = await Promise.all([
    supabase
      .from("characters")
      .select("id, name, role, biography, metadata")
      .eq("project_id", projectId),
    supabase
      .from("relationships")
      .select("a_id, b_id")
      .eq("project_id", projectId),
    supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .maybeSingle(),
  ]);
  const cast = chars ?? [];
  const have = new Set<string>();
  for (const r of existing ?? []) {
    have.add([(r.a_id as string), (r.b_id as string)].sort().join("|"));
  }
  const projMeta = ((proj?.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const deletedPairs = new Set<string>(
    Array.isArray(projMeta.relationshipsDeleted)
      ? (projMeta.relationshipsDeleted as string[])
      : []
  );

  // Eligibility: individuals only.
  const eligible = cast.filter((c) => {
    const meta = ((c.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    const type = (meta.entityType as string) ?? "individual";
    if (type !== "individual") return false;
    if (/ and | & /i.test(c.name as string)) return false;
    return true;
  });
  const roleOf = (c: { role: string | null }) =>
    ((c.role as string) ?? "").toLowerCase().trim();
  const isProtag = (c: { role: string | null }) => roleOf(c) === "protagonist";
  const isMajor = (c: { role: string | null }) => {
    const r = roleOf(c);
    return !r || /protag|antag|support|lead|co-?lead|mirror|rival/.test(r);
  };
  const primaryProtag = eligible.find(isProtag) ?? eligible[0] ?? null;

  // Source text (treatment + arc + episodes + showrunner notes) — drives
  // the "explicitly named" core / secondary bumps.
  const sourceText = await loadSourceText(projectId);
  const coMentioned = (aName: string, bName: string): boolean => {
    const a = firstName(aName);
    const b = firstName(bName);
    if (a.length < 3 || b.length < 3) return false;
    const aRe = new RegExp(`\\b${a}\\b`, "i");
    const bRe = new RegExp(`\\b${b}\\b`, "i");
    let idx = 0;
    while (idx < sourceText.length) {
      const win = sourceText.slice(idx, idx + 240);
      if (aRe.test(win) && bRe.test(win)) return true;
      idx += 120;
    }
    return false;
  };
  const stronglyMentioned = (aName: string, bName: string): boolean => {
    const a = firstName(aName);
    const b = firstName(bName);
    if (a.length < 3 || b.length < 3) return false;
    const aRe = new RegExp(`\\b${a}\\b`, "i");
    const bRe = new RegExp(`\\b${b}\\b`, "i");
    let idx = 0;
    while (idx < sourceText.length) {
      const win = sourceText.slice(idx, idx + 280);
      if (aRe.test(win) && bRe.test(win) && STRONG_ENGINE.test(win)) return true;
      idx += 120;
    }
    return false;
  };

  const candidates: SpineCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: SpineCandidate) => {
    const key = [c.aId, c.bId].sort().join("|");
    if (have.has(key) || seen.has(key)) return;
    if (!opts.includeDeleted && deletedPairs.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  const labelMirror = (m: { role: string | null }) => {
    const r = roleOf(m);
    if (/antag/.test(r)) return { nature: "adversarial", noun: "antagonist" };
    if (/mirror/.test(r)) return { nature: "mirror", noun: "mirror" };
    if (/rival/.test(r)) return { nature: "rivalry", noun: "rival" };
    if (/lead/.test(r)) return { nature: "investigative", noun: "co-lead" };
    if (/protag/.test(r)) return { nature: "investigative", noun: "protagonist" };
    return { nature: "investigative", noun: "major supporting" };
  };

  // Marital pairs.
  interface MaritalEdge { aId: string; bId: string; aName: string; bName: string }
  const marital: MaritalEdge[] = [];
  const maritalKeys = new Set<string>();
  for (const c of eligible) {
    const bio = ((c.biography as string) ?? "").toLowerCase();
    if (!MARITAL.test(bio)) continue;
    for (const other of eligible) {
      if (other.id === c.id) continue;
      const fn = firstName(other.name as string);
      if (!fn || fn.length < 3) continue;
      if (new RegExp(`\\b${fn}\\b`, "i").test(bio)) {
        const key = [c.id as string, other.id as string].sort().join("|");
        if (maritalKeys.has(key)) continue;
        maritalKeys.add(key);
        marital.push({
          aId: c.id as string,
          bId: other.id as string,
          aName: c.name as string,
          bName: other.name as string,
        });
      }
    }
  }

  // Tier 1: primary protagonist × every other major → CORE.
  if (primaryProtag) {
    for (const m of eligible) {
      if (m.id === primaryProtag.id) continue;
      if (!isMajor(m)) continue;
      const tag = labelMirror(m);
      push({
        aId: primaryProtag.id as string,
        bId: m.id as string,
        aName: primaryProtag.name as string,
        bName: m.name as string,
        pairingName: `${primaryProtag.name} ↔ ${m.name}`,
        importance: "core",
        nature: tag.nature,
        reason: `Core: protagonist ↔ ${tag.noun}`,
      });
    }
  }

  // Marital → CORE marriage engine.
  for (const edge of marital) {
    const involvesProtag =
      primaryProtag && (edge.aId === primaryProtag.id || edge.bId === primaryProtag.id);
    push({
      aId: edge.aId,
      bId: edge.bId,
      aName: edge.aName,
      bName: edge.bName,
      pairingName: `${edge.aName} ↔ ${edge.bName}`,
      importance: "core",
      nature: "marriage",
      reason: involvesProtag
        ? "Core: marriage engine (involves protagonist)"
        : "Core: marriage engine",
    });
  }

  // Tier 2: non-protagonist pairs the source actually names.
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      if (primaryProtag && (a.id === primaryProtag.id || b.id === primaryProtag.id)) continue;
      const pairKey = [a.id as string, b.id as string].sort().join("|");
      if (maritalKeys.has(pairKey)) continue;
      if (have.has(pairKey)) continue;
      const aName = a.name as string;
      const bName = b.name as string;
      const tag = labelMirror(a);
      const tagB = labelMirror(b);
      const nature =
        tag.nature === "adversarial" || tagB.nature === "adversarial"
          ? "adversarial"
          : tag.nature === "mirror" || tagB.nature === "mirror"
          ? "mirror"
          : "investigative";
      const strong = stronglyMentioned(aName, bName);
      const co = strong || coMentioned(aName, bName);
      if (strong) {
        push({
          aId: a.id as string,
          bId: b.id as string,
          aName, bName,
          pairingName: `${aName} ↔ ${bName}`,
          importance: "core",
          nature,
          reason: "Core: explicitly named as an engine in the source",
        });
      } else if (co) {
        push({
          aId: a.id as string,
          bId: b.id as string,
          aName, bName,
          pairingName: `${aName} ↔ ${bName}`,
          importance: "secondary",
          nature,
          reason: `Secondary: ${
            nature === "adversarial"
              ? "adversarial tension"
              : nature === "mirror"
              ? "mirror pairing"
              : "investigative tension"
          }`,
        });
      } else {
        push({
          aId: a.id as string,
          bId: b.id as string,
          aName, bName,
          pairingName: `${aName} ↔ ${bName}`,
          importance: "optional",
          nature,
          reason: "Optional: ensemble overlap only",
        });
      }
    }
  }

  return {
    candidates,
    skippedNonIndividuals: cast.length - eligible.length,
    includesDeleted: !!opts.includeDeleted,
  };
}
