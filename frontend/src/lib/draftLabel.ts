// Uniform draft-picker label formatting.
//
// Before: every draft dropdown showed only `script.title`, which means
// four "Episode 1 — 3:17 AM" entries in EP01's history were
// indistinguishable. This helper renders a single human-readable line:
//
//   "Episode 1 — 3:17 AM · Draft 4 (current) · 6/3/26 11:47 PM"
//   "Episode 1 — 3:17 AM · Draft 3 · 6/2/26 3:14 PM"
//
// Used by ProductionPage, RewritesPage, EmotionalIntelligencePage, and
// ExportCenterPage so the picker UX is consistent across the app.

interface DraftLike {
  title: string;
  draft_number: number;
  current: boolean;
  updated_at: string;
}

export function formatDraftLabel(s: DraftLike): string {
  // Short timestamp: "6/3/26 11:47 PM" — short enough to fit in a select option.
  const d = new Date(s.updated_at);
  const ts = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)} ${d.toLocaleTimeString(
    undefined,
    { hour: "numeric", minute: "2-digit" }
  )}`;
  const draftLabel = s.current ? `Draft ${s.draft_number} (current)` : `Draft ${s.draft_number}`;
  return `${s.title} · ${draftLabel} · ${ts}`;
}
