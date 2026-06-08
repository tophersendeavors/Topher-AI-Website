// Episode-title suggest → approve workflow.
//
// AI proposes a title + reason + alternates and writes it to
// episodes.title_suggestion + sets title_status='suggested'. The episode's
// `title` column is NOT touched until the writer approves a choice via
// approveEpisodeTitle. This keeps AI suggestions out of file names, exports,
// and the dashboard until the writer signs off.

import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";

export interface TitleSuggestion {
  suggested: string;
  reason: string;
  alternates: string[];
  suggestedAt: string;
}

/**
 * Suggest an episode title from the episode's logline / outline + the
 * project's tone. Writes the suggestion into `episodes.title_suggestion`
 * and sets title_status='suggested'. Returns the suggestion.
 */
export async function suggestEpisodeTitle(episodeId: string): Promise<TitleSuggestion> {
  const { data: ep, error } = await supabase
    .from("episodes")
    .select("id, project_id, number, title, logline, outline, beat_sheet")
    .eq("id", episodeId)
    .single();
  if (error) throw error;

  const { data: proj } = await supabase
    .from("projects")
    .select("title, tone, showrunner_notes")
    .eq("id", ep.project_id)
    .maybeSingle();

  const outlineText = (() => {
    const o = ep.outline as Record<string, unknown> | null;
    if (!o) return "";
    const acts = (o.acts as unknown[]) ?? [];
    return acts
      .map((a) => (a as { title?: string; summary?: string }))
      .map((a) => `${a.title ?? ""}: ${a.summary ?? ""}`)
      .join("\n");
  })();

  const system = [
    "You are an episode title doctor for prestige limited series.",
    "Given the episode's logline + outline + the show's tone, propose ONE",
    "evocative, restrained episode title and three alternates.",
    "",
    "RULES:",
    "• Titles are 1–3 words, evocative, image-led, not literal.",
    "• Mirror the show's tone — restraint over melodrama.",
    "• No spoilers in the title. No question marks. No exclamation marks.",
    "• Single common noun or noun phrase is usually right.",
    "• 'Untitled' or 'Pilot' are NOT acceptable suggestions.",
    "",
    "Return ONLY JSON:",
    "{",
    '  "suggested": "<the title you most recommend>",',
    '  "reason": "<one sentence: why this title carries the episode>",',
    '  "alternates": ["<alt 1>", "<alt 2>", "<alt 3>"]',
    "}",
  ].join("\n");

  const tone = ((proj?.tone as string[] | null) ?? []).join(", ") || "(no tone declared)";
  const user = [
    `Series: ${proj?.title ?? "Untitled"}`,
    `Tone: ${tone}`,
    proj?.showrunner_notes ? `Showrunner notes: ${(proj.showrunner_notes as string).slice(0, 400)}` : "",
    "",
    `Episode ${ep.number}${ep.title ? ` (current: "${ep.title}")` : ""}:`,
    `Logline: ${ep.logline ?? "(none)"}`,
    "",
    outlineText ? `Outline:\n${outlineText.slice(0, 1200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.6,
    maxTokens: 400,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    throw new Error("Episode-title agent did not return usable JSON.");
  }

  const suggestion: TitleSuggestion = {
    suggested: String(parsed.suggested ?? "").trim(),
    reason: String(parsed.reason ?? "").trim(),
    alternates: Array.isArray(parsed.alternates)
      ? (parsed.alternates as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 5)
      : [],
    suggestedAt: new Date().toISOString(),
  };
  if (!suggestion.suggested) {
    throw new Error("Episode-title agent returned no title.");
  }

  // Persist the suggestion. Supabase's JS client does NOT throw when a
  // column is missing — it returns an `error` object on the response. The
  // earlier version of this function ignored that, which made it look like
  // the suggestion ran successfully even when migration 0011 hadn't been
  // applied (the columns title_suggestion + title_status didn't exist) —
  // the UI then refetched the same untitled episode and "nothing happened".
  const { error: updateError } = await supabase
    .from("episodes")
    .update({ title_suggestion: suggestion, title_status: "suggested" })
    .eq("id", episodeId);
  if (updateError) {
    const msg = updateError.message || "";
    // Detect the migration-not-applied state and surface a clear fix.
    if (/column .* does not exist/i.test(msg) || /title_suggestion|title_status/i.test(msg)) {
      throw new Error(
        "Couldn't save the title suggestion — the episodes table is missing the title-workflow columns. Apply Supabase migration 0011_episode_titles_and_versioning.sql via the SQL editor and try again."
      );
    }
    throw new Error(`Couldn't save the title suggestion: ${msg}`);
  }

  return suggestion;
}

/**
 * The writer approves a title (either the suggested or one of the alternates,
 * or a fresh title they typed). Writes to `episodes.title` and marks
 * title_status='approved'. THIS is the only path that makes the title show up
 * in display labels, exports, and file names.
 */
export async function approveEpisodeTitle(
  episodeId: string,
  title: string
): Promise<{ id: string; title: string; title_status: string }> {
  const clean = title.trim();
  if (!clean) throw new Error("Title cannot be empty.");
  const { data, error } = await supabase
    .from("episodes")
    .update({ title: clean, title_status: "approved" })
    .eq("id", episodeId)
    .select("id, title, title_status")
    .single();
  if (error) {
    const msg = error.message || "";
    if (/column .* does not exist/i.test(msg) || /title_status/i.test(msg)) {
      throw new Error(
        "Couldn't approve the title — the episodes table is missing the title-workflow columns. Apply Supabase migration 0011_episode_titles_and_versioning.sql via the SQL editor and try again."
      );
    }
    throw new Error(`Couldn't approve the title: ${msg}`);
  }
  return data as { id: string; title: string; title_status: string };
}

/** Wipe approval and any prior suggestion. */
export async function resetEpisodeTitle(episodeId: string): Promise<void> {
  const { error } = await supabase
    .from("episodes")
    .update({ title: null, title_status: "untitled", title_suggestion: null })
    .eq("id", episodeId);
  if (error) {
    const msg = error.message || "";
    if (/column .* does not exist/i.test(msg) || /title_status|title_suggestion/i.test(msg)) {
      throw new Error(
        "Couldn't reset the title — the episodes table is missing the title-workflow columns. Apply Supabase migration 0011_episode_titles_and_versioning.sql via the SQL editor and try again."
      );
    }
    throw new Error(`Couldn't reset the title: ${msg}`);
  }
}
