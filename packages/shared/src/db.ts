import type { AgentRole, MemoryKind, MemoryScope, ProjectKind } from "./agents";
import type { WorkflowStageId, WorkflowStageStatus } from "./workflow";

export type ProjectStatus =
  | "ideation"
  | "development"
  | "draft"
  | "production"
  | "archived";

export interface Project {
  id: string;
  owner_id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  logline: string | null;
  genre: string[] | null;
  tone: string[] | null;
  references: string[] | null;
  showrunner_notes: string | null;
  cover_url: string | null;
  allow_stylistic_directness?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: string;
  project_id: string;
  name: string;
  archetype: string | null;
  role: string | null;
  biography: string | null;
  wants: string | null;
  needs: string | null;
  flaw: string | null;
  voice_notes: string | null;
  arc: { act1?: string; act2?: string; act3?: string } | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Relationship {
  id: string;
  project_id: string;
  a_id: string;
  b_id: string;
  nature: string | null;
  tension: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Location {
  id: string;
  project_id: string;
  name: string;
  kind: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Season {
  id: string;
  project_id: string;
  number: number;
  title: string | null;
  premise: string | null;
  arc: unknown;
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: string;
  project_id: string;
  season_id: string | null;
  number: number;
  title: string | null;
  logline: string | null;
  outline: unknown;
  beat_sheet: unknown;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Script {
  id: string;
  project_id: string;
  episode_id: string | null;
  title: string;
  draft_number: number;
  fountain: string;
  metadata: Record<string, unknown>;
  current: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScriptScene {
  id: string;
  script_id: string;
  ord: number;
  slugline: string;
  location_id: string | null;
  int_ext: string | null;
  time_of_day: string | null;
  characters: string[];
  summary: string | null;
  fountain: string | null;
  tags: string[];
  created_at: string;
}

export interface MemoryEntry {
  id: string;
  project_id: string;
  scope: MemoryScope;
  scope_ref: string | null;
  kind: MemoryKind;
  body: unknown;
  text: string;
  approved: boolean;
  version: number;
  supersedes_id: string | null;
  authored_by: string | null;
  authored_role: string | null;
  created_at: string;
}

export interface MemoryHit extends MemoryEntry {
  similarity: number;
}

export interface Approval {
  id: string;
  project_id: string;
  workflow_id: string | null;
  stage_id: WorkflowStageId | null;
  target_kind: "artifact" | "canon_change" | "tool_call";
  target_id: string | null;
  payload: unknown;
  status: "pending" | "approved" | "rejected" | "revised";
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  rationale: string | null;
  created_at: string;
}

export interface ContinuityIssueRow {
  id: string;
  project_id: string;
  script_id: string | null;
  episode_id: string | null;
  kind: "wardrobe" | "location" | "timeline" | "relationship" | "prop";
  severity: "info" | "warn" | "critical";
  scene_ids: string[];
  note: string;
  suggested_fix: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

export interface ProductionAsset {
  id: string;
  project_id: string;
  script_id: string | null;
  scene_id: string | null;
  kind: "shotlist" | "storyboard_prompt" | "flow_prompt" | "design_note";
  body: unknown;
  storage_path: string | null;
  created_at: string;
}

export interface WorkflowStageArtifact {
  id: string;
  workflow_id: string;
  stage_id: WorkflowStageId;
  revision: number;
  body: unknown;
  storage_path: string | null;
  created_by: string | null;
  created_at: string;
}

export type { AgentRole, WorkflowStageId, WorkflowStageStatus };
