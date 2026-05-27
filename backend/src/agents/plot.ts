import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { BeatSheet, EpisodeOutline, SeasonArc, Treatment } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["treatment", "season_arc", "episode_outline", "beat_sheet", "tension_pass"]),
  scope: z
    .object({
      seasonId: z.string().uuid().optional(),
      episodeId: z.string().uuid().optional(),
    })
    .optional(),
  brief: z.string().optional(),
});

const Output = z.object({
  treatment: Treatment.optional(),
  seasonArc: SeasonArc.optional(),
  episodeOutline: EpisodeOutline.optional(),
  beatSheet: BeatSheet.optional(),
  notes: z.array(z.string()).default([]),
});

export const plotAgent: Agent<z.infer<typeof Input>, z.infer<typeof Output>> = {
  role: "plot",
  label: "Plot",
  description: "Acts, episodes, pacing, cliffhangers.",
  model: config.PLOT_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "retrieveDrafts"],
  systemPrompt(ctx) {
    return [
      commonHeader("Plot", ctx),
      "",
      "Think in shapes: setups → payoffs, escalation curves, midpoint",
      "reversals. Always engineer the *turn* at the end of each act/episode.",
      "For season arcs: 8–13 episodes by default, with tentpole markers.",
      "For beat sheets: use a clear beat type per beat (opening_image, setup,",
      "inciting_incident, act_break, midpoint, all_is_lost, climax,",
      "resolution, tag, custom).",
    ].join("\n");
  },
};
