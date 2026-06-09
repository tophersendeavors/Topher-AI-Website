// Phase A verification: shotPolicy is wired correctly + micro-drama
// directive block lands verbatim from config (no behavior change).

import {
  PROJECT_TYPE_CONFIGS,
  isMicroDramaProject,
  resolveShotPolicy,
  resolveProjectTypeConfig,
} from "@toburt/shared";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("PASS:", msg);
}

// 1. All 5 project types present
const types = Object.keys(PROJECT_TYPE_CONFIGS).sort();
assert(
  types.join(",") === "anthology,feature,micro_drama,mini_series,prestige_series",
  `All 5 project types present (got: ${types.join(", ")})`
);

// 2. Every config has a shotPolicy with all 9 required fields
for (const [k, cfg] of Object.entries(PROJECT_TYPE_CONFIGS)) {
  assert(cfg.shotPolicy, `${k} has shotPolicy`);
  assert(cfg.shotPolicy.defaultAspectRatio, `${k}.shotPolicy.defaultAspectRatio set`);
  assert(typeof cfg.shotPolicy.defaultDurationSec === "number", `${k} defaultDurationSec is number`);
  assert(typeof cfg.shotPolicy.minDurationSec === "number", `${k} minDurationSec is number`);
  assert(typeof cfg.shotPolicy.maxDurationSec === "number", `${k} maxDurationSec is number`);
  assert(cfg.shotPolicy.coverageDensity, `${k} coverageDensity set`);
  assert(typeof cfg.shotPolicy.shotlistDirectives === "string", `${k} shotlistDirectives is string`);
  assert(
    cfg.shotPolicy.composerKey === "generic" || cfg.shotPolicy.composerKey === "vertical_micro",
    `${k} composerKey valid`
  );
  assert(Array.isArray(cfg.shotPolicy.promptCharacterFocus), `${k} promptCharacterFocus is array`);
  assert(Array.isArray(cfg.shotPolicy.promptAvoidList), `${k} promptAvoidList is array`);
  assert(typeof cfg.shotPolicy.isMicroDramaTier === "boolean", `${k} isMicroDramaTier is boolean`);
}

// 3. Micro-drama tier flag is true ONLY for micro_drama
assert(PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.isMicroDramaTier === true, "micro_drama.isMicroDramaTier === true");
assert(PROJECT_TYPE_CONFIGS.prestige_series.shotPolicy.isMicroDramaTier === false, "prestige_series.isMicroDramaTier === false");
assert(PROJECT_TYPE_CONFIGS.mini_series.shotPolicy.isMicroDramaTier === false, "mini_series.isMicroDramaTier === false");
assert(PROJECT_TYPE_CONFIGS.feature.shotPolicy.isMicroDramaTier === false, "feature.isMicroDramaTier === false");
assert(PROJECT_TYPE_CONFIGS.anthology.shotPolicy.isMicroDramaTier === false, "anthology.isMicroDramaTier === false");

// 4. Micro-drama composer is vertical_micro; others are generic
assert(PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.composerKey === "vertical_micro", "micro_drama uses vertical_micro composer");
assert(PROJECT_TYPE_CONFIGS.prestige_series.shotPolicy.composerKey === "generic", "prestige_series uses generic composer");
assert(PROJECT_TYPE_CONFIGS.mini_series.shotPolicy.composerKey === "generic", "mini_series uses generic composer");
assert(PROJECT_TYPE_CONFIGS.feature.shotPolicy.composerKey === "generic", "feature uses generic composer");
assert(PROJECT_TYPE_CONFIGS.anthology.shotPolicy.composerKey === "generic", "anthology uses generic composer");

// 5. Aspect ratios match the existing pre-Phase-A defaults
assert(PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.defaultAspectRatio === "9:16", "micro_drama 9:16");
assert(PROJECT_TYPE_CONFIGS.prestige_series.shotPolicy.defaultAspectRatio === "2.39:1", "prestige_series 2.39:1");
assert(PROJECT_TYPE_CONFIGS.mini_series.shotPolicy.defaultAspectRatio === "16:9", "mini_series 16:9");
assert(PROJECT_TYPE_CONFIGS.feature.shotPolicy.defaultAspectRatio === "2.39:1", "feature 2.39:1");
assert(PROJECT_TYPE_CONFIGS.anthology.shotPolicy.defaultAspectRatio === "16:9", "anthology 16:9");

// 6. Micro-drama duration range honors the 3-5s window
assert(PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.minDurationSec === 3, "micro_drama min 3s");
assert(PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.maxDurationSec === 5, "micro_drama max 5s");

// 7. Prestige durations are longer than micro
assert(
  PROJECT_TYPE_CONFIGS.prestige_series.shotPolicy.maxDurationSec >
    PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.maxDurationSec,
  "prestige max > micro max"
);

// 8. resolveShotPolicy + isMicroDramaProject helpers work
assert(resolveShotPolicy("micro_drama").isMicroDramaTier === true, "resolveShotPolicy('micro_drama') is micro tier");
assert(resolveShotPolicy("prestige_series").isMicroDramaTier === false, "resolveShotPolicy('prestige_series') is not micro tier");
assert(resolveShotPolicy("feature").isMicroDramaTier === false, "resolveShotPolicy('feature') is not micro tier");
assert(resolveShotPolicy(null).isMicroDramaTier === false, "resolveShotPolicy(null) falls back safely (not micro)");
assert(resolveShotPolicy(undefined).isMicroDramaTier === false, "resolveShotPolicy(undefined) falls back safely");
assert(resolveShotPolicy("unknown_type").isMicroDramaTier === false, "resolveShotPolicy(unknown) falls back to prestige");
assert(isMicroDramaProject("micro_drama") === true, "isMicroDramaProject micro");
assert(isMicroDramaProject("prestige_series") === false, "isMicroDramaProject prestige");
assert(isMicroDramaProject(undefined) === false, "isMicroDramaProject undefined → false");
assert(isMicroDramaProject("anthology") === false, "isMicroDramaProject anthology → false");

// 9. Micro-drama directive contains the four critical retention rules
const mdDir = PROJECT_TYPE_CONFIGS.micro_drama.shotPolicy.shotlistDirectives;
assert(mdDir.includes("MICRO-DRAMA MODE"), "micro directive carries the MODE header");
assert(mdDir.includes("9:16"), "micro directive mentions 9:16");
assert(mdDir.includes("3–5 seconds"), "micro directive mentions 3-5 seconds");
assert(mdDir.includes("HOOK / TWIST"), "micro directive mentions HOOK / TWIST retention");
assert(mdDir.includes("AVOID wide establishing"), "micro directive forbids wide establishing");

// 10. Prestige directive is the cinematic-restraint variant
const psDir = PROJECT_TYPE_CONFIGS.prestige_series.shotPolicy.shotlistDirectives;
assert(psDir.includes("PRESTIGE SERIES MODE"), "prestige directive carries the MODE header");
assert(!psDir.includes("9:16"), "prestige directive does NOT mention 9:16");
assert(!psDir.includes("HOOK / TWIST"), "prestige directive does NOT mention HOOK / TWIST viral language");
assert(!psDir.includes("TikTok"), "prestige directive does NOT mention TikTok");

// 11. Feature + anthology directives are present and don't leak micro vocabulary
const ftDir = PROJECT_TYPE_CONFIGS.feature.shotPolicy.shotlistDirectives;
assert(ftDir.includes("FEATURE FILM MODE"), "feature directive present");
assert(!ftDir.includes("HOOK / TWIST"), "feature directive does NOT mention HOOK / TWIST");
const atDir = PROJECT_TYPE_CONFIGS.anthology.shotPolicy.shotlistDirectives;
assert(atDir.includes("ANTHOLOGY EPISODE MODE"), "anthology directive present");
assert(!atDir.includes("HOOK / TWIST"), "anthology directive does NOT mention HOOK / TWIST");

// 12. The kind fallback for "miniseries" still resolves to mini_series
assert(
  resolveProjectTypeConfig(null, "miniseries").label === "Mini Series",
  "kind='miniseries' fallback → Mini Series"
);

// 13. Legacy projects (no projectType, no kind) default to prestige_series
assert(
  resolveProjectTypeConfig(null).label === "Prestige Series",
  "no projectType + no kind → prestige_series default"
);

console.log("\nPhase A verification complete — ALL CHECKS PASS.");
