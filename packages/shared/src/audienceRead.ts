// Audience Read — the post-final-draft "emotional / bingeability" stage.
// A read-only analysis: an LLM reads the locked draft as a first-time
// bingeing viewer and scores it against a comps-grounded rubric (distilled
// from real reviews of comparable shows). It never mutates the draft.

export type AudienceVerdict = "strong" | "solid" | "at_risk";

/** One rubric lever — what "binge" looks like for this genre, and the
 *  comparable-show signal it was distilled from. */
export interface AudienceReadRubricLever {
  key: string;
  label: string;
  bingeLooksLike: string;
  compSignal: string;
}

/** The comps-grounded rubric. Versioned so reports record which rubric
 *  scored them. Produced by research (real reviews of comparable shows). */
export interface AudienceReadRubric {
  version: string;
  genre: string;
  comps: string[];
  levers: AudienceReadRubricLever[];
  /** The genre's signature failure modes to watch for. */
  failureModes: string[];
  /** Review URLs the rubric was distilled from. */
  sources: string[];
}

/** Per-lever verdict on the draft. */
export interface AudienceReadDimension {
  key: string;
  label: string;
  verdict: AudienceVerdict;
  /** 1-3 sentences, anchored to specific scenes. */
  note: string;
}

/** One point on the engagement curve — a scene and how hard it grips. */
export interface AudienceSceneBeat {
  ord: number;
  heading: string;
  /** 0 (inert) … 5 (can't look away). */
  grip: number;
  note: string;
}

/** An actionable note to raise bingeability. */
export interface AudienceReadNote {
  title: string;
  detail: string;
  sceneRefs: number[];
}

export interface AudienceReadReport {
  /** Provenance — the locked draft this read scored. */
  sourceScriptId: string;
  sourceDraftLabel: string;
  sourceFountainHash: string;
  rubricVersion: string;
  /** 0-100 overall bingeability. */
  bingeScore: number;
  bingeVerdict: string;
  hookVerdict: string;
  endingVerdict: string;
  engagementCurve: AudienceSceneBeat[];
  dimensions: AudienceReadDimension[];
  topNotes: AudienceReadNote[];
  generatedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface AudienceReadResponse {
  report: AudienceReadReport | null;
  /** Current locked-draft context for the episode. */
  source: {
    scriptId: string | null;
    draftLabel: string | null;
    isLocked: boolean;
    sceneCount: number;
  };
  rubric: AudienceReadRubric;
}
