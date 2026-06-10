// Unit-style check for the tightened copyrighted-reference regex.
// Common English-word titles (Arrival, Drive, etc) must only fire on
// unambiguous film/score references. Bare prose use must pass.

import { containsCopyrightedReference } from "../src/sound/validator.js";

interface Case {
  text: string;
  expect: boolean;
  label: string;
}

const CASES: Case[] = [
  // Should PASS (no flag) — legitimate prose use
  { text: "Guests arrival at the resort entrance.", expect: false, label: "prose: guest arrival" },
  { text: "Distant rumble of an SUV arrival on gravel.", expect: false, label: "prose: arrival on gravel" },
  { text: "Quiet drive up the mountain road.", expect: false, label: "prose: quiet drive" },
  { text: "Severance pay was discussed.", expect: false, label: "prose: severance pay" },

  // Should FLAG — explicit film / score reference
  { text: '"Arrival" score, sparse and clean.', expect: true, label: "quoted Arrival" },
  { text: "Arrival (2016) main theme.", expect: true, label: "Arrival (YYYY)" },
  { text: "Arrival soundtrack-style strings.", expect: true, label: "Arrival soundtrack" },
  { text: "in the style of Arrival.", expect: true, label: "style-cued Arrival" },
  { text: "Hans Zimmer-style synth bed.", expect: true, label: "composer name" },
  { text: "reminiscent of Trent Reznor.", expect: true, label: "composer style-cued" },
];

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

console.log("=== Sound validator denylist — regex sanity ===\n");
for (const c of CASES) {
  const got = containsCopyrightedReference(c.text);
  assert(got === c.expect, `${c.label} → ${c.expect ? "flag" : "pass"} · text=${JSON.stringify(c.text)}`);
}
console.log("\nAll regex cases PASSED.");
