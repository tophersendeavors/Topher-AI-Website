// Quick inspector: what does the Studio Timeline show for SELVAJE right now?
// Run: node_modules/.bin/tsx backend/scripts/inspectStudioTimeline.ts

import { resolveStudioTimeline } from "../src/studio/timeline.js";

const SELVAJE = "6cd65896-9649-4438-b29a-079b3dfa07b4";

async function main() {
  const tl = await resolveStudioTimeline(SELVAJE);
  if (!tl) {
    console.error("Project not found");
    process.exit(1);
  }
  console.log(`=== ${tl.projectTitle} (${tl.projectType}) ===`);
  console.log(
    `Representative episode: ${tl.representativeEpisodeNumber !== null ? `EP${String(tl.representativeEpisodeNumber).padStart(2, "0")}` : "—"} ${tl.representativeEpisodeTitle ?? ""}`
  );
  console.log(
    `Progress: ${tl.summary.completeStages}/${tl.summary.totalStages} (${tl.summary.progressPct}%) · current = ${tl.summary.currentStageKey ?? "all complete"}\n`
  );
  for (const s of tl.stages) {
    const icon =
      s.status === "complete"
        ? "✓"
        : s.status === "in_progress"
          ? "•"
          : s.status === "blocked"
            ? "!"
            : "○";
    console.log(
      `  ${icon} ${String(s.number).padStart(2, "0")}. ${s.title.padEnd(28)} [${s.phase.padEnd(10)}] [${s.status.padEnd(11)}] ${s.statusDetail}`
    );
    console.log(`        → ${s.nextAction}`);
    console.log(`        primary: ${s.primary.label} (${s.primary.toRel})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
