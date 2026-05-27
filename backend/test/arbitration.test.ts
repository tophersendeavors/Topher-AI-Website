import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the LLM provider. Each test queues a sequence of responses; the next
// `callLLM` invocation consumes the next response. This lets us script the
// agent → Showrunner → revise → Showrunner loop exactly.
// ---------------------------------------------------------------------------

const responses: string[] = [];
vi.mock("../src/llm/provider.js", () => ({
  callLLM: vi.fn(async () => {
    const text = responses.shift();
    if (text === undefined) {
      throw new Error(
        "Test queued fewer LLM responses than the loop required — check the test."
      );
    }
    return { text, raw: { stub: true } };
  }),
  extractJSON<T = unknown>(text: string): T {
    return JSON.parse(text) as T;
  },
}));

// ---------------------------------------------------------------------------
// Mock the DB client + memory module so arbitration can run without a real
// Supabase. The memory writes return a deterministic id we can assert on.
// ---------------------------------------------------------------------------

const memoryWrites: Array<Record<string, unknown>> = [];
const roomMessages: Array<Record<string, unknown>> = [];

vi.mock("../src/memory/index.js", () => ({
  writeMemory: vi.fn(async (input: Record<string, unknown>) => {
    memoryWrites.push(input);
    return {
      id: `mem-${memoryWrites.length}`,
      project_id: input.projectId,
      scope: input.scope,
      kind: input.kind,
      body: input.body,
      text: input.text,
      approved: input.approved ?? false,
      version: 1,
      supersedes_id: null,
      authored_by: input.authoredBy ?? null,
      authored_role: input.authoredRole ?? null,
      created_at: new Date().toISOString(),
    };
  }),
  searchMemory: vi.fn(async () => []),
  approveMemory: vi.fn(async () => undefined),
}));

vi.mock("../src/orchestrator/room.js", () => ({
  postRoomMessage: vi.fn(async (input: Record<string, unknown>) => {
    roomMessages.push(input);
    return { id: `room-${roomMessages.length}`, ...input };
  }),
}));

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------

import { runWithArbitration } from "../src/agents/arbitration.js";
import { conceptAgent } from "../src/agents/concept.js";
import type { AgentContext } from "../src/agents/types.js";

function ctx(): AgentContext {
  return {
    projectId: "00000000-0000-0000-0000-000000000aaa",
    workflowId: undefined,
    stage: undefined,
    collaborators: ["concept", "showrunner"],
    showrunnerNotes: "Lean noir, restrained.",
    retrievedCanon: [],
    retrievedDrafts: [],
    transcriptWindow: [],
    user: { id: "user-1" },
  };
}

function loglinePackJSON() {
  return JSON.stringify({
    result: {
      loglines: [
        { text: "A retired detective hunts a copycat", hook: "His own crimes copied", theme: "consequence" },
      ],
      premise: "A retired detective is forced back to work.",
      themes: ["consequence"],
    },
  });
}

function showrunner(decision: "approve" | "reject" | "revise", rationale: string) {
  return JSON.stringify({
    result: { decision, rationale, notes: [] },
  });
}

beforeEach(() => {
  responses.length = 0;
  memoryWrites.length = 0;
  roomMessages.length = 0;
});

describe("runWithArbitration", () => {
  it("returns approved=true on first-pass approval and writes canon memory", async () => {
    responses.push(loglinePackJSON());            // concept submission
    responses.push(showrunner("approve", "Sharp."));

    const r = await runWithArbitration(
      conceptAgent,
      { idea: "a detective comes out of retirement" },
      ctx()
    );

    expect(r.approved).toBe(true);
    expect(r.revisions).toBe(0);
    expect(r.decision.decision).toBe("approve");
    expect(r.trail.map((t) => t.kind)).toEqual(["recommend", "approve"]);
    // Two memory rows: approved canon + arbitration record.
    expect(memoryWrites).toHaveLength(2);
    expect(memoryWrites[0].approved).toBe(true);
    expect(memoryWrites[1].approved).toBe(false);
    expect(r.memoryEntryId).toBe("mem-1");
    // Room got both messages.
    expect(roomMessages).toHaveLength(2);
    expect(roomMessages[0]).toMatchObject({ kind: "suggestion", authorRole: "concept" });
    expect(roomMessages[1]).toMatchObject({ kind: "approval", authorRole: "showrunner" });
  });

  it("loops once on revise then approves", async () => {
    responses.push(loglinePackJSON());                 // first submission
    responses.push(showrunner("revise", "Punch up the hook."));
    responses.push(loglinePackJSON());                 // revision
    responses.push(showrunner("approve", "Now we're cooking."));

    const r = await runWithArbitration(
      conceptAgent,
      { idea: "x" },
      ctx(),
      { maxRevisions: 2 }
    );

    expect(r.approved).toBe(true);
    expect(r.revisions).toBe(1);
    expect(r.trail.map((t) => t.kind)).toEqual([
      "recommend",
      "revise",
      "recommend",
      "approve",
    ]);
  });

  it("stops on reject (veto) without writing approved canon", async () => {
    responses.push(loglinePackJSON());
    responses.push(showrunner("reject", "Off-tone."));

    const r = await runWithArbitration(conceptAgent, { idea: "x" }, ctx());

    expect(r.approved).toBe(false);
    expect(r.decision.decision).toBe("reject");
    // Only the un-approved arbitration record — no canon row.
    expect(memoryWrites.filter((m) => m.approved === true)).toHaveLength(0);
    expect(memoryWrites.filter((m) => m.approved === false)).toHaveLength(1);
    expect(r.trail.map((t) => t.kind)).toEqual(["recommend", "veto"]);
  });

  it("exhausts the revision budget when Showrunner keeps asking to revise", async () => {
    // max 1 revision = 2 attempts total, each followed by a revise verdict.
    responses.push(loglinePackJSON());
    responses.push(showrunner("revise", "Again."));
    responses.push(loglinePackJSON());
    responses.push(showrunner("revise", "Still no."));

    const r = await runWithArbitration(conceptAgent, { idea: "x" }, ctx(), {
      maxRevisions: 1,
    });

    expect(r.approved).toBe(false);
    expect(r.decision.decision).toBe("revise");
    expect(r.trail[r.trail.length - 1].kind).toBe("exhausted");
    expect(r.revisions).toBe(1);
    // No canon row when the loop never reached approve.
    expect(memoryWrites.filter((m) => m.approved === true)).toHaveLength(0);
  });

  it("skips memory persistence when persistToMemory=false", async () => {
    responses.push(loglinePackJSON());
    responses.push(showrunner("approve", "ok"));

    const r = await runWithArbitration(conceptAgent, { idea: "x" }, ctx(), {
      persistToMemory: false,
    });

    expect(r.approved).toBe(true);
    expect(memoryWrites).toHaveLength(0);
  });
});
