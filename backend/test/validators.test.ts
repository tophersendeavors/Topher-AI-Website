import { describe, expect, it } from "vitest";
import {
  validateSceneDirectness,
  validateScriptDirectness,
  DIRECTNESS_RULES,
} from "../src/screenplay/emotionalValidator.js";
import { parseFountain, formatFountain } from "../src/screenplay/fountain.js";

// ---------------------------------------------------------------------------
// Directness validator
// ---------------------------------------------------------------------------

const ON_THE_NOSE = `INT. KITCHEN - NIGHT

Jane stares at her cup.

JANE
I feel sad.

JANE
You make me feel small.

JANE
Ever since dad left, I've been broken.
`;

const SUBTEXTUAL = `INT. KITCHEN - NIGHT

Jane stares at her cup. She doesn't drink.

JANE
There's a chip on this.

She puts the cup down. Picks up her coat.
`;

describe("validateSceneDirectness", () => {
  it("flags critical on-the-nose dialogue", () => {
    const report = validateSceneDirectness(ON_THE_NOSE);
    expect(report.violations.length).toBeGreaterThanOrEqual(3);
    expect(
      report.violations.filter((v) => v.severity === "critical").length
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects scenes when critical count > threshold and not stylistic", () => {
    const report = validateSceneDirectness(ON_THE_NOSE, {
      rejectionThreshold: 1,
    });
    expect(report.shouldReject).toBe(true);
  });

  it("does not reject in stylistic mode", () => {
    const report = validateSceneDirectness(ON_THE_NOSE, {
      rejectionThreshold: 1,
      allowStylistic: true,
    });
    expect(report.shouldReject).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it("passes a subtextual scene cleanly", () => {
    const report = validateSceneDirectness(SUBTEXTUAL);
    expect(report.violations).toHaveLength(0);
    expect(report.shouldReject).toBe(false);
  });

  it("includes line numbers and pattern ids", () => {
    const report = validateSceneDirectness(ON_THE_NOSE);
    for (const v of report.violations) {
      expect(typeof v.line).toBe("number");
      expect(typeof v.pattern).toBe("string");
      expect(["info", "warn", "critical"]).toContain(v.severity);
    }
  });

  it("exposes a stable rule set for the UI", () => {
    expect(DIRECTNESS_RULES.length).toBeGreaterThan(5);
    expect(DIRECTNESS_RULES.every((r) => r.id && r.note && r.severity)).toBe(
      true
    );
  });
});

describe("validateScriptDirectness", () => {
  it("returns one report per scene", () => {
    const script = `${ON_THE_NOSE}\n\n${SUBTEXTUAL}`;
    const out = validateScriptDirectness(script);
    expect(out).toHaveLength(2);
    expect(out[0].report.violations.length).toBeGreaterThan(0);
    expect(out[1].report.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fountain parser
// ---------------------------------------------------------------------------

describe("parseFountain", () => {
  it("parses scene headings and characters", () => {
    const parsed = parseFountain(ON_THE_NOSE);
    expect(parsed.scenes).toHaveLength(1);
    expect(parsed.scenes[0].intExt).toBe("INT");
    expect(parsed.scenes[0].timeOfDay).toBe("NIGHT");
    expect(parsed.scenes[0].location).toBe("KITCHEN");
    expect(parsed.scenes[0].characters).toContain("JANE");
  });

  it("ignores boneyard blocks", () => {
    const src = `INT. ROOM - DAY\n\n/* dropped\nplot beat */\n\nShe stands.`;
    const parsed = parseFountain(src);
    expect(
      parsed.elements.some((e) => e.kind === "action" && /dropped/.test(e.text))
    ).toBe(false);
  });

  it("round-trips through formatFountain without losing the slugline", () => {
    const parsed = parseFountain(ON_THE_NOSE);
    const back = formatFountain(parsed);
    expect(back).toContain("INT. KITCHEN - NIGHT");
    expect(back).toContain("JANE");
  });
});
