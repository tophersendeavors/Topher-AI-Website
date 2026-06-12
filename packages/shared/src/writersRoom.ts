// Writers Room — the immersive seating + writing-team layer.
//
// CORE DISTINCTION (do not merge these two systems):
//
//   1. WRITING TEAM — who actually creates the script. These are the chairs at
//      the table. A seat is one of three writing kinds:
//        • ai_writer    — the studio writes it for you (project foundation + DNA)
//        • ai_creative  — a virtual creative lens / archetype writes through a POV
//        • live_person  — a real human writer (you, an upload, or an invited writer)
//
//   2. QUALITY / SCRIPT-IMPROVEMENT STAFF — the studio's built-in checks
//      (Character Architect, Continuity Director, Emotional Truth Editor, …).
//      They are NOT table writers. They review/diagnose/rewrite the draft along
//      the pipeline regardless of who wrote it. They live on the review bench,
//      not in a co-writer chair.
//
// Architecture note: a seat does not store a one-off assignment. It holds a
// ProfileRef pointing at a REUSABLE profile id. In Phase 2 the global Talent /
// Writer Directory becomes the source of these profiles and the seats keep
// referencing them by id — no room refactor needed.

export type SeatKind = "ai_writer" | "ai_creative" | "live_person";

// How the lead writer chooses to begin. This is the FIRST question the room
// asks; it routes them to the right path instead of jumping straight to seats.
export const WRITING_MODES = [
  "upload",      // already wrote a screenplay/draft — bring it in
  "manual",      // write by hand inside the app, no AI drafting
  "concept",     // only an idea/logline — build foundation → bible → draft
  "ai_writer",   // let the studio generate from foundation + Creative DNA
  "ai_creative", // generate through a chosen creative lens
  "co_writer",   // invite/assign another live writer
] as const;
export type WritingMode = (typeof WRITING_MODES)[number];

export const WRITING_MODE_LABELS: Record<WritingMode, string> = {
  upload: "Upload Existing Script",
  manual: "Write Manually",
  concept: "Start From Concept",
  ai_writer: "Use AI Writer",
  ai_creative: "Use AI Creative",
  co_writer: "Add Co-Writer",
};

export const WRITING_MODE_BLURBS: Record<WritingMode, string> = {
  upload: "You already wrote a screenplay or draft — bring it in for review and rewrites.",
  manual: "Write inside Toburt yourself, no AI drafting. The studio's staff still reviews it.",
  concept: "You have an idea, logline or premise. Build the foundation, then the draft.",
  ai_writer: "Let the studio generate the draft using the project foundation and your Creative DNA.",
  ai_creative: "Generate through a chosen creative lens / virtual co-writer archetype.",
  co_writer: "Invite or assign another real writer to the table.",
};

export const LIVE_PERMISSIONS = [
  "view",
  "comment",
  "suggest",
  "write",
  "approve",
  "co_writer",
  "owner",
] as const;
export type LivePermission = (typeof LIVE_PERMISSIONS)[number];
export const LIVE_PERMISSION_LABELS: Record<LivePermission, string> = {
  view: "View only",
  comment: "Comment only",
  suggest: "Suggest edits",
  write: "Write / revise",
  approve: "Approve sections",
  co_writer: "Full co-writer",
  owner: "Producer / owner",
};

/** Authority a pass/agent has over the work (per the rewrite-authority spec). */
export type RewriteAuthority =
  | "observe"
  | "observe_recommend"
  | "observe_rewrite"
  | "observe_rewrite_approve";

// --- WRITING TEAM profiles (Phase-2 directory will become their source) ------

/** The fully-automated studio writer. Not a named outside creative — it writes
 *  using the project concept, the creator's Creative DNA, tone, genre and the
 *  internal TOBURT writing engine. There is one canonical AI Writer. */
export interface AiWriterProfile {
  id: string; // "studio_ai_writer"
  name: string; // "Studio AI Writer"
  role: string; // "Automated Draft Generation"
  description: string; // the "write it for me" pitch
  avatarUrl: string | null;
}

/** A virtual creative collaborator with a defined taste, tone and storytelling
 *  philosophy. Presented as an industry-inspired ARCHETYPE — never as an
 *  impersonation of a real person. */
export interface AiCreativeProfile {
  id: string; // stable creative key
  name: string; // a collaborator name, e.g. "Mara Vane"
  role: string; // archetype, e.g. "Dark Prestige Drama Writer"
  style: string;
  tasteProfile: string; // what they're drawn to / what they reject
  sampleVoice: string; // a short line that demonstrates the voice
  strengths: string[];
  boundaries: string[];
  genres: string[];
  pastProjects: string[]; // illustrative credits for the archetype
  tone: string;
  avatarUrl: string | null;
}

/** A real human writer. Must be a reusable profile before joining the team. */
export interface LivePersonProfile {
  id: string; // stable id (becomes the directory key in Phase 2)
  name: string;
  email: string | null;
  role: string;
  avatarUrl: string | null;
  bio: string | null;
  credits: string[];
  specialties: string[];
  permission: LivePermission;
  inviteStatus: "pending" | "active";
}

// --- QUALITY / SCRIPT-IMPROVEMENT STAFF (the review bench — NOT seats) -------

export type QualityStatus = "pending" | "active" | "complete";

export interface QualityAgent {
  id: string; // agent role key from the registry
  name: string; // "Continuity Director"
  role: string; // short role line
  specialty: string;
  stage: string; // which pipeline stage they activate in
  avatarUrl: string | null;
  rewriteAuthority: RewriteAuthority;
  status: QualityStatus; // pending until their pass begins
}

// --- Review Bench runs (a quality agent actually working on the draft) -------

export type ReviewStatus = "pending" | "active" | "done" | "skipped";

/** What a quality agent is allowed to do with what it finds. */
export type ReviewAuthority =
  | "observe"
  | "recommend"
  | "rewrite"
  | "rewrite_requires_approval";

export const REVIEW_AUTHORITY_LABELS: Record<ReviewAuthority, string> = {
  observe: "Observe",
  recommend: "Recommend",
  rewrite: "Rewrite",
  rewrite_requires_approval: "Rewrite (needs approval)",
};

/** Map the internal rewrite-authority onto the bench's 4 authority levels. */
export function reviewAuthorityOf(a: RewriteAuthority): ReviewAuthority {
  switch (a) {
    case "observe": return "observe";
    case "observe_recommend": return "recommend";
    case "observe_rewrite": return "rewrite";
    case "observe_rewrite_approve": return "rewrite_requires_approval";
  }
}

/** A concrete fix an agent can safely propose (before → after). */
export interface ReviewRewriteOption {
  targetLabel: string; // e.g. "Scene 4 — Mara's exit"
  before: string | null;
  after: string;
  rationale: string;
}

export interface ReviewFinding {
  diagnosis: string;
  notes: string[];
  rewriteOption: ReviewRewriteOption | null;
  confidence: number; // 0..1
}

/** Per-agent run state on the bench (lives in WritersRoomState.reviewBench). */
export interface ReviewRun {
  agentId: string;
  status: ReviewStatus;
  authority: ReviewAuthority;
  finding: ReviewFinding | null;
  applied: boolean; // creator approved + applied the rewrite option
  ranAt: string | null;
  appliedAt: string | null;
}

// --- Final Draft Lock --------------------------------------------------------

/** The formal lock that must happen before the room hands off to Creative. */
export interface FinalLock {
  locked: boolean;
  version: number | null; // assigned at lock (the locked draft's number)
  lockedAt: string | null;
  lockedBy: string | null;
  scriptId: string | null; // the draft that got locked
  // creator-controlled confirmations / waivers
  humanReadStatus: "pending" | "complete" | "skipped";
  notesWaived: boolean; // waive remaining open notes intentionally
  creatorApproved: boolean;
}

export interface LockRequirement {
  key: string;
  label: string;
  met: boolean;
  detail: string;
  waivable: boolean; // can be satisfied by an intentional skip/waive
}

export interface LockStatus {
  requirements: LockRequirement[];
  canLock: boolean;
  lock: FinalLock;
  draftLabel: string | null;
}

// --- Seats -------------------------------------------------------------------

/** A seat's pointer to a reusable profile. */
export interface ProfileRef {
  kind: SeatKind;
  id: string;
}

export interface WritersRoomSeat {
  seatId: string; // chair position id, e.g. "seat-1"
  kind: SeatKind;
  ref: ProfileRef;
  // Denormalized display so the room renders without re-resolving the profile.
  name: string;
  roleLabel: string;
  avatarUrl: string | null;
  status: string; // current task / status line
  // Live-person extras (inline until the directory exists).
  personEmail?: string | null;
  permission?: LivePermission | null;
  inviteStatus?: "pending" | "active" | null;
  assignedAt: string;
  assignedBy: string | null;
}

export interface WritersRoomState {
  seats: WritersRoomSeat[];
  // How the lead writer chose to begin (null until they answer the first
  // "How do you want to begin?" question).
  writingMode: WritingMode | null;
  modeChosenAt: string | null;
  // Review Bench run state, keyed by quality-agent id.
  reviewBench: ReviewRun[];
  // Formal Final Draft Lock — the gate before Creative Room handoff.
  finalLock: FinalLock;
  updatedAt: string | null;
}

/** Everything the room needs in one fetch. The head seat (lead writer) is
 *  derived from the studio owner identity, not stored as a seat. The writing
 *  options (aiWriter, creatives) populate the chair picker; qualityStaff
 *  populates the review bench. */
export interface WritersRoomResponse {
  state: WritersRoomState;
  head: { name: string; roleLabel: string; avatarUrl: string | null } | null;
  aiWriter: AiWriterProfile;
  creatives: AiCreativeProfile[];
  qualityStaff: QualityAgent[];
  // Existing reusable people from the Writer/Talent Directory, so a Live
  // Co-Writer seat can select an existing profile instead of re-creating one.
  talent: import("./talent").TalentProfile[];
}
