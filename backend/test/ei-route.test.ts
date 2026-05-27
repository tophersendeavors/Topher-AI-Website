import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Reusable mock Supabase: every chained method returns `this`, and the
// terminal awaitable methods return canned shapes pulled from `state`.
// ---------------------------------------------------------------------------

interface MockState {
  project: { project_id: string; allow_stylistic_directness?: boolean };
  script: {
    id: string;
    project_id: string;
    fountain: string;
  };
  scenes: Array<{ id: string; ord: number }>;
  characters: Array<{ id: string; name: string }>;
  wounds: Array<{ character_id: string }>;
  tensions: Array<{ a_id: string; b_id: string; tension_score: number }>;
  membership: boolean;
}

const ON_THE_NOSE_FIXTURE = [
  "INT. KITCHEN - NIGHT",
  "",
  "Jane stares at the cup.",
  "",
  "JANE",
  "I feel sad.",
  "",
  "JANE",
  "You make me feel small.",
  "",
  "JANE",
  "Ever since dad left, I've been broken.",
  "",
].join("\n");

const state: MockState = {
  project: { project_id: "p-1", allow_stylistic_directness: false },
  script: {
    id: "s-1",
    project_id: "p-1",
    fountain: ON_THE_NOSE_FIXTURE,
  },
  scenes: [{ id: "sc-1", ord: 1 }],
  characters: [{ id: "ch-1", name: "JANE" }],
  wounds: [{ character_id: "ch-1" }],
  tensions: [],
  membership: true,
};

function buildSupabaseMock() {
  const builder: any = {
    _table: "",
    _filters: {} as Record<string, unknown>,
    from(table: string) {
      builder._table = table;
      builder._filters = {};
      return builder;
    },
    select() {
      return builder;
    },
    eq(col: string, val: unknown) {
      builder._filters[col] = val;
      return builder;
    },
    is() {
      return builder;
    },
    in() {
      return builder;
    },
    or() {
      return builder;
    },
    order() {
      return builder;
    },
    limit() {
      return builder;
    },
    insert(row: unknown) {
      return {
        select() {
          return {
            single: async () => ({ data: { id: "new-id", ...(row as object) }, error: null }),
          };
        },
        async then(resolve: (v: any) => void) {
          resolve({ data: null, error: null });
        },
      };
    },
    update() {
      return builder;
    },
    delete() {
      return builder;
    },
    rpc() {
      return Promise.resolve({ data: [], error: null });
    },
    async maybeSingle() {
      return responseFor(builder._table, builder._filters, true);
    },
    async single() {
      return responseFor(builder._table, builder._filters, false);
    },
    async then(resolve: (v: any) => void) {
      resolve(responseListFor(builder._table, builder._filters));
    },
  };
  return builder;
}

function responseFor(
  table: string,
  filters: Record<string, unknown>,
  maybe: boolean
) {
  if (table === "project_members") {
    return { data: state.membership ? { user_id: filters.user_id } : null, error: null };
  }
  if (table === "projects") {
    return {
      data: {
        id: state.project.project_id,
        allow_stylistic_directness: state.project.allow_stylistic_directness,
      },
      error: null,
    };
  }
  if (table === "scripts") {
    return {
      data: { project_id: state.script.project_id, fountain: state.script.fountain },
      error: null,
    };
  }
  if (table === "script_scenes") {
    const id = filters.id as string | undefined;
    const scene = state.scenes.find((s) => s.id === id) ?? state.scenes[0];
    return {
      data: scene
        ? { id: scene.id, ord: scene.ord, script_id: state.script.id, fountain: state.script.fountain, characters: ["JANE"] }
        : null,
      error: null,
    };
  }
  if (table === "characters") {
    return { data: state.characters[0], error: null };
  }
  return { data: maybe ? null : {}, error: null };
}

function responseListFor(table: string, _filters: Record<string, unknown>) {
  if (table === "script_scenes") return { data: state.scenes.map((s) => ({ id: s.id, ord: s.ord })), error: null };
  if (table === "character_wounds") return { data: state.wounds, error: null };
  if (table === "relationship_tensions") return { data: state.tensions, error: null };
  if (table === "characters") return { data: state.characters, error: null };
  return { data: [], error: null };
}

// ---------------------------------------------------------------------------
// Mocks BEFORE importing the SUT.
// ---------------------------------------------------------------------------

vi.mock("../src/db/client.js", () => {
  const supabase = buildSupabaseMock();
  return { supabase, userClient: () => supabase };
});

vi.mock("../src/auth/verifyJwt.js", () => ({
  registerAuth: async () => {},
  requireUser: async () => ({ id: "user-1", email: "tester@example.com" }),
}));

vi.mock("../src/db/queries.js", () => ({
  assertProjectMember: async () => undefined,
  getProject: async () => state.project,
  listProjectsForUser: async () => [],
}));

vi.mock("../src/llm/provider.js", () => ({
  callLLM: vi.fn(async () => ({
    text: JSON.stringify({
      result: {
        truthScore: 0.4,
        causeEffect: [],
        state: {
          emotionalEntryState: "guarded",
          emotionalExitState: "raw",
          hiddenWant: "to be seen",
          visibleWant: "to be left alone",
          fear: "irrelevance",
          contradiction: "wants closeness, demands distance",
          subtext: "the cup matters because dad's hand was on it",
          behavioralTells: ["does not drink"],
          powerShift: "Jane loses leverage",
          relationshipShift: "distance widens",
        },
        rejections: [],
      },
    }),
    raw: { stub: true },
  })),
  extractJSON<T = unknown>(text: string): T {
    return JSON.parse(text) as T;
  },
}));

// Block the global stages module from registering routes that need DB.
import Fastify from "fastify";
import emotionalRoutes from "../src/routes/emotional.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify();
  await app.register(emotionalRoutes);
  return app;
}

beforeEach(() => {
  // Re-set deterministic state per test.
  state.project.allow_stylistic_directness = false;
  state.script.fountain = ON_THE_NOSE_FIXTURE;
  state.membership = true;
});

describe("emotional routes", () => {
  it("GET /screenplay/directness/rules returns the rule set", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/screenplay/directness/rules",
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(5);
  });

  it("POST /scripts/:id/emotional/validate flags the on-the-nose scene", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/scripts/s-1/emotional/validate`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].report.violations.length).toBeGreaterThan(0);
    expect(body[0].report.shouldReject).toBe(true);
  });

  it("respects stylistic mode and returns shouldReject=false", async () => {
    state.project.allow_stylistic_directness = true;
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/scripts/s-1/emotional/validate`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].report.shouldReject).toBe(false);
  });

  it("POST /scripts/:id/emotional/score returns six-dimensional scores", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/scripts/s-1/emotional/score`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.scriptId).toBe("s-1");
    expect(body.scenes).toHaveLength(1);
    const scene = body.scenes[0];
    expect(Object.keys(scene.scores).sort()).toEqual(
      ["behavior", "powerShift", "subtext", "tension", "truth", "wound"].sort()
    );
    // The on-the-nose scene is weak.
    expect(scene.weak).toBe(true);
    expect(scene.rewriteInstructions.length).toBeGreaterThan(0);
  });
});
