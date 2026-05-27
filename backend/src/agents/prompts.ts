import type { AgentContext } from "./types.js";
import type { MemoryHit } from "@toburt/shared";

/**
 * Shared system-prompt header used by every agent. Establishes the
 * collaborative, structured nature of the writers' room.
 */
export function commonHeader(role: string, ctx: AgentContext): string {
  const lines = [
    `You are the ${role} agent in the TOBURT Studios writers' room.`,
    `You collaborate with: ${ctx.collaborators
      .filter((c) => c !== role)
      .join(", ") || "(solo turn)"}.`,
    `Stay strictly inside your role. Do not write text that another agent owns.`,
    `Always produce structured JSON conforming to the requested schema.`,
    `Never invent canon — only the Showrunner can promote facts to canon.`,
    `Concise, professional, screenwriter-grade prose. No filler.`,
    "",
    "## Revision protocol",
    "If the user input includes a `critique` field, the Showrunner asked you",
    "to revise. Treat the critique as binding. Do not defend your prior",
    "output — change it. Keep what was working, fix what was named.",
  ];
  if (ctx.showrunnerNotes) {
    lines.push(``, `# Showrunner notes (sticky vision):`, ctx.showrunnerNotes);
  }
  return lines.join("\n");
}

export function renderMemory(label: string, hits: MemoryHit[]): string {
  if (!hits.length) return `## ${label}\n(none)`;
  const lines = hits.slice(0, 8).map((h, i) => {
    const sim = (h.similarity ?? 0).toFixed(2);
    return `- [${i + 1}] (${h.scope}/${h.kind}, sim=${sim}, ${
      h.approved ? "CANON" : "draft"
    }) ${truncate(h.text, 220)}`;
  });
  return `## ${label}\n${lines.join("\n")}`;
}

export function renderTranscript(ctx: AgentContext): string {
  if (!ctx.transcriptWindow?.length) return "## Recent room transcript\n(empty)";
  const rows = ctx.transcriptWindow.slice(-12).map((m) => {
    const who =
      m.author_kind === "agent" ? `agent:${m.author_role}` : m.author_kind;
    return `- ${who}: ${truncate(m.body ?? "", 200)}`;
  });
  return `## Recent room transcript\n${rows.join("\n")}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

export function buildContextBlock(ctx: AgentContext): string {
  return [
    renderMemory("Approved canon (top hits)", ctx.retrievedCanon),
    renderMemory("Working drafts (top hits)", ctx.retrievedDrafts),
    renderTranscript(ctx),
  ].join("\n\n");
}
