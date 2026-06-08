// Production Preflight types.
//
// Stage 1 — the aggregator reads existing department state (LocationBibles,
// PropBibles, Visual World Rules, Character Bibles, MasterShotBriefs, prompt
// slots, readiness results) and reports 10 department statuses without
// mutating any data. No new tables. No new migrations.
//
// Status semantics:
//   ready   — department has everything it needs to ship prompts safely
//   partial — department has SOME of what it needs; soft warning
//   missing — department has none of what it needs; hard warning
//   fail    — department is configured but a check failed (e.g. continuity
//             pass reported issues)
//
// Reasons + missingFields + staleDraftIssues are surfaced to the writer so
// they can click through and fix. fixUrl is a relative SPA route hint —
// the frontend may ignore it and target its own anchors.

export type DepartmentStatus = "ready" | "partial" | "missing" | "fail";

export type DepartmentKey =
  | "story"
  | "scriptSupervisor"
  | "productionDesign"
  | "artDepartment"
  | "props"
  | "wardrobeHmu"
  | "cinematography"
  | "blocking"
  | "promptSupervisor"
  | "qualityGate";

export interface DepartmentReport {
  key: DepartmentKey;
  label: string;
  status: DepartmentStatus;
  reasons: string[];
  missingFields: string[];
  staleDraftIssues?: string[];
  fixUrl?: string;
  /** Stage-2 marker — set when this dept exists in code but the structured
   *  fields the user wants land in the next stage. Renders as a small
   *  "Stage 2" pill in the UI; does NOT cause overall blocking. */
  stageTwoPlanned?: boolean;
  /** Optional rich detail payload. UI renders this in an expandable
   *  disclosure when present. Use when the reasons[] one-liners aren't
   *  enough — e.g. show the actual bedroom architecture / wardrobe /
   *  per-brief blocking the writer just approved. */
  details?: DepartmentDetails;
}

/** Per-department detail shapes. UI renders them with light formatting
 *  (key → value pairs, lists, tables). Each shape is OPTIONAL — only
 *  populated when there's real data to show. */
export interface DepartmentDetails {
  /** Generic key-value bullets — rendered as `label: value`. */
  fields?: Array<{ label: string; value: string }>;
  /** Named sub-blocks — rendered as a small heading + body. */
  blocks?: Array<{ heading: string; body: string | string[] }>;
  /** Tabular data — rendered as a compact table. */
  table?: { headers: string[]; rows: string[][] };
  /** A short call-to-action that points to where the writer should go to
   *  inspect / edit the underlying data. */
  link?: { label: string; href: string };
}

export interface DraftSourceCheck {
  /** True when the script row being inspected is current=true for its episode. */
  isCurrentDraft: boolean;
  /** The draft number/label of the script being inspected. */
  inspectedDraftLabel: string | null;
  /** The current draft for this episode (whichever script has current=true). */
  currentDraftLabel: string | null;
  /** When inspectedDraftLabel != currentDraftLabel, what's stale. */
  staleAssets: string[];
}

export interface PreflightReport {
  scriptId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  generatedAt: string;
  overall: DepartmentStatus;
  departments: DepartmentReport[];
  draftSource: DraftSourceCheck;
  /** Convenience flag: when false the frontend should show the soft
   *  warning + confirmation before Generate / Regenerate. Equivalent to
   *  overall === "ready" AND no stale-draft issues. */
  allowPromptGeneration: boolean;
  /** Optional: any one-off notes the aggregator wants to surface. */
  notes: string[];
}
