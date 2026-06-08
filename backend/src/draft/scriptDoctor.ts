import { runAgent } from "../agents/runner.js";
import { scriptDoctorAgent } from "../agents/scriptDoctor.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { supabase } from "../db/client.js";
import type { ScriptDoctorReport } from "@toburt/shared";

export type Diagnosis = {
  sceneId?: string;
  sceneRef?: string;       // slugline / scene number reference if no UUID
  severity: "info" | "warn" | "critical";
  kind: "pacing" | "cliché" | "weak_scene" | "structure" | "emotion";
  note: string;
  suggestion?: string;
};

export type DoctorResult = {
  diagnoses: Diagnosis[];
  emotionalArcScore: number;
  scriptId: string;
  ranAt: string;
};

/**
 * Run Script Doctor against a saved script. Returns a structured report
 * with per-issue cards + an overall emotional arc score (0..1).
 *
 * The model is permitted to identify scenes by slugline ("INT. CEDARVIEW
 * HOSPICE - ..." or "#3") rather than UUID — anything in `sceneRef` lands
 * verbatim in the UI for human review.
 */
export async function runScriptDoctor(
  scriptId: string,
  user?: { id: string; name?: string },
  focus: "all" | "pacing" | "cliché" | "structure" | "emotional_impact" = "all",
  notes?: string
): Promise<DoctorResult> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("id, project_id, title, fountain")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  if (!script.fountain || script.fountain.trim().length < 50) {
    throw new Error(
      "Script is empty or near-empty. Generate at least one scene before running Script Doctor."
    );
  }

  const aCtx = await hydrateContext({
    projectId: script.project_id,
    stage: "rewrite",
    collaborators: ["script_doctor", "showrunner"],
    query: script.title,
    user,
  });

  // Analyze the provided draft only — strip stale retrieved snapshots that
  // would otherwise contaminate the critique with pre-edit content.
  aCtx.retrievedDrafts = [];
  aCtx.retrievedCanon = [];

  const { output } = await runAgent(
    scriptDoctorAgent,
    {
      scriptId,
      focus: focus === "all" ? undefined : (focus as "pacing" | "cliché" | "structure" | "emotional_impact"),
      draftFountain: script.fountain,
      userNotes: notes,
    },
    aCtx,
    { maxTokens: 6000, maxToolRounds: 1 }
  );

  const report = normalizeReport(output, scriptId);

  // Persist as a memory entry so subsequent stages can retrieve diagnoses
  // when they hydrate context.
  await supabase.from("memory_entries").insert({
    project_id: script.project_id,
    scope: "project" as const,
    scope_ref: scriptId,
    kind: "note" as const,
    body: {
      kind: "script_doctor_report",
      diagnoses: report.diagnoses,
      emotionalArcScore: report.emotionalArcScore,
      script_title: script.title,
    },
    approved: false,
  });

  return report;
}

/**
 * Coerce whatever the Script Doctor produced into a stable DoctorResult.
 * Model variations:
 *   - sceneId may be a UUID, a slugline, "Scene 3", or omitted entirely.
 *   - emotionalArcScore may be 0..1 or 0..10.
 *   - diagnoses may be flat at top level instead of nested.
 */
function normalizeReport(output: ScriptDoctorReport | unknown, scriptId: string): DoctorResult {
  const flat = (output ?? {}) as Record<string, unknown>;
  const rawDiag = (flat.diagnoses ?? flat.issues ?? flat.notes ?? []) as unknown[];
  const arr = Array.isArray(rawDiag) ? rawDiag : [];
  const diagnoses: Diagnosis[] = arr
    .map((raw): Diagnosis | null => {
      const d = (raw ?? {}) as Record<string, unknown>;
      const severityRaw = String(d.severity ?? "info").toLowerCase();
      const severity =
        severityRaw === "critical" || severityRaw === "warn" || severityRaw === "info"
          ? (severityRaw as Diagnosis["severity"])
          : "info";
      const kindRaw = String(d.kind ?? "structure").toLowerCase();
      const kind =
        kindRaw === "pacing" || kindRaw === "cliché" || kindRaw === "weak_scene" || kindRaw === "structure" || kindRaw === "emotion"
          ? (kindRaw as Diagnosis["kind"])
          : "structure";
      const note =
        typeof d.note === "string" ? d.note :
        typeof d.body === "string" ? d.body :
        typeof d.description === "string" ? d.description : "";
      if (!note) return null;
      const sceneRef =
        typeof d.sceneId === "string" && !/^[0-9a-f-]{36}$/i.test(d.sceneId)
          ? d.sceneId
          : typeof d.scene === "string" ? d.scene :
            typeof d.sceneRef === "string" ? d.sceneRef :
            typeof d.slugline === "string" ? d.slugline : undefined;
      const sceneId =
        typeof d.sceneId === "string" && /^[0-9a-f-]{36}$/i.test(d.sceneId)
          ? d.sceneId
          : undefined;
      const suggestion =
        typeof d.suggestion === "string" ? d.suggestion :
        typeof d.fix === "string" ? d.fix :
        typeof d.action === "string" ? d.action : undefined;
      return { sceneId, sceneRef, severity, kind, note, suggestion };
    })
    .filter((d): d is Diagnosis => d !== null);

  // Score may come as 0..1 or 0..10.
  let score = typeof flat.emotionalArcScore === "number" ? flat.emotionalArcScore
    : typeof flat.score === "number" ? flat.score
    : typeof flat.arcScore === "number" ? flat.arcScore : 0.5;
  if (score > 1) score = Math.min(1, score / 10);
  if (score < 0) score = 0;

  return {
    diagnoses,
    emotionalArcScore: score,
    scriptId,
    ranAt: new Date().toISOString(),
  };
}
