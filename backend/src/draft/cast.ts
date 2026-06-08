import { supabase } from "../db/client.js";

export type CastMember = {
  name: string;
  role: string;
  note?: string;
  age?: number | null;
  occupation?: string | null;
  backstory?: string | null;
  biography?: string | null;
};

/**
 * The canonical cast for a project, from the character bible. This is the
 * locked list of named characters every scene generation must use — no
 * invented or drifted names, ages, jobs, or backstories allowed.
 */
export async function getCanonicalCast(projectId: string): Promise<CastMember[]> {
  const { data } = await supabase
    .from("characters")
    .select("name, role, archetype, age, occupation, backstory, biography")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  return (data ?? []).map((c) => ({
    name: c.name as string,
    role: (c.role as string) ?? "supporting",
    note: (c.archetype as string) ?? undefined,
    age: (c.age as number) ?? null,
    occupation: (c.occupation as string) ?? null,
    backstory: (c.backstory as string) ?? null,
    biography: (c.biography as string) ?? null,
  }));
}

/**
 * Persist a treatment's protagonists into the `characters` table so the
 * Character Bible auto-populates and a canonical cast exists to lock against.
 * Idempotent: skips if the project already has characters, and skips any
 * individual name that already exists.
 */
export async function persistCastFromTreatment(
  projectId: string,
  treatment: { protagonists?: Array<{ name?: string; role?: string; summary?: string }> }
): Promise<number> {
  const prot = treatment?.protagonists ?? [];
  if (prot.length === 0) return 0;

  const { data: existing } = await supabase
    .from("characters")
    .select("name")
    .eq("project_id", projectId);
  const have = new Set((existing ?? []).map((c) => (c.name as string).toLowerCase()));

  const roleOf = (r?: string) => {
    const s = (r ?? "").toLowerCase();
    if (s.includes("antagonist")) return "antagonist";
    if (s.includes("lead") || s.includes("protagonist")) return "protagonist";
    return "supporting";
  };

  const rows = prot
    .filter((p) => p.name && !have.has(p.name.toLowerCase()))
    .map((p) => ({
      project_id: projectId,
      name: p.name!.trim(),
      archetype: p.role ?? null,
      role: roleOf(p.role),
      biography: p.summary ?? null,
      metadata: { source: "treatment_protagonists" },
    }));
  if (rows.length === 0) return 0;

  const { error } = await supabase.from("characters").insert(rows);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn("[cast] failed to persist treatment protagonists:", error.message);
    return 0;
  }
  return rows.length;
}

/** Render the locked cast — full identity — as an instruction block. */
export function castInstruction(cast: CastMember[]): string {
  if (cast.length === 0) return "";
  const lines = cast.map((c) => {
    const id = c.backstory || c.biography || "";
    const bits = [
      c.note ? `[${c.note}]` : "",
      c.age != null ? `age ${c.age}` : "",
      c.occupation ? c.occupation : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const detail = [bits, id ? `— ${truncate(id, 220)}` : ""].filter(Boolean).join(" ");
    return `- ${c.name}${detail ? `: ${detail}` : ""}`;
  });
  return [
    "CANONICAL CAST — the ONLY named characters in this project, with their",
    "LOCKED identities. Use each name EXACTLY. Do NOT invent new named",
    "characters, rename/respell anyone, or alter any character's age, job,",
    "relationships, or backstory. These facts are fixed. Unnamed background",
    "roles (NURSE, DRIVER) are fine.",
    ...lines,
  ].join("\n");
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
