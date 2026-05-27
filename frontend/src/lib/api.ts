import type {
  AgentRole,
  Approval,
  Character,
  Episode,
  Location,
  MemoryHit,
  Project,
  RoomMessage,
  Script,
  Season,
  WorkflowStageId,
  WorkflowSummary,
} from "@toburt/shared";
import { hasSupabaseEnv, supabase } from "./supabase";

const BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "";

async function authHeader(): Promise<HeadersInit> {
  if (!hasSupabaseEnv()) return {};
  const {
    data: { session },
  } = await supabase().auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...auth,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} — ${body.slice(0, 240)}`);
  }
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const api = {
  // Projects
  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (body: Partial<Project>) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  updateProject: (id: string, body: Partial<Project>) =>
    request<Project>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // Workflows
  listWorkflows: (projectId: string) =>
    request<WorkflowSummary[]>(`/projects/${projectId}/workflows`),
  createWorkflow: (body: { projectId: string; title: string; prompt?: string }) =>
    request<WorkflowSummary>(`/workflows`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  advanceWorkflow: (id: string, prompt?: string) =>
    request<{ status: string }>(`/workflows/${id}/advance`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  workflowArtifacts: (id: string) =>
    request<
      Array<{
        id: string;
        stage_id: WorkflowStageId;
        revision: number;
        body: unknown;
        created_at: string;
      }>
    >(`/workflows/${id}/artifacts`),

  // Approvals
  listApprovals: (projectId: string) =>
    request<Approval[]>(`/projects/${projectId}/approvals`),
  decideApproval: (
    id: string,
    decision: "approved" | "rejected" | "revised",
    rationale?: string
  ) =>
    request<{ status: string }>(`/approvals/${id}/decide`, {
      method: "POST",
      body: JSON.stringify({ decision, rationale }),
    }),

  // Agents / Room
  listAgents: () =>
    request<Array<{ role: AgentRole; label: string; description: string; accent: string }>>(
      `/agents`
    ),
  invokeAgent: (body: {
    projectId: string;
    role: AgentRole;
    input: unknown;
    workflowId?: string;
    stage?: string;
  }) =>
    request<{ output: unknown; toolCalls: unknown[]; usage?: unknown }>(
      `/agents/invoke`,
      { method: "POST", body: JSON.stringify(body) }
    ),
  listRoomMessages: (projectId: string) =>
    request<RoomMessage[]>(`/projects/${projectId}/room`),
  postRoomMessage: (projectId: string, body: { body: string; workflowId?: string; stage?: string }) =>
    request<RoomMessage>(`/projects/${projectId}/room`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Memory
  searchMemory: (body: {
    projectId: string;
    query: string;
    approvedOnly?: boolean;
    k?: number;
  }) =>
    request<MemoryHit[]>(`/memory/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Entities
  listCharacters: (projectId: string) =>
    request<Character[]>(`/projects/${projectId}/characters`),
  createCharacter: (body: Partial<Character> & { projectId: string; name: string }) =>
    request<Character>(`/characters`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateCharacter: (id: string, body: Partial<Character>) =>
    request<Character>(`/characters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  listSeasons: (projectId: string) =>
    request<Season[]>(`/projects/${projectId}/seasons`),
  listEpisodes: (projectId: string) =>
    request<Episode[]>(`/projects/${projectId}/episodes`),
  createEpisode: (body: Partial<Episode> & { projectId: string; number: number }) =>
    request<Episode>(`/episodes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listLocations: (projectId: string) =>
    request<Location[]>(`/projects/${projectId}/locations`),

  listContinuity: (projectId: string) =>
    request<unknown[]>(`/projects/${projectId}/continuity`),

  // Scripts
  listScripts: (projectId: string) =>
    request<Script[]>(`/projects/${projectId}/scripts`),
  getScript: (id: string) => request<Script>(`/scripts/${id}`),
  createScript: (body: { projectId: string; title: string; fountain?: string }) =>
    request<Script>(`/scripts`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateScript: (id: string, body: { fountain?: string; title?: string }) =>
    request<Script>(`/scripts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  exportScriptUrl: (id: string, format: "pdf" | "fdx" | "fountain" | "markdown") =>
    `${BASE}/api/scripts/${id}/export/${format}`,

  // Production
  productionFor: (scriptId: string, tool: "shotlist" | "storyboard" | "flow") =>
    request<unknown>(`/scripts/${scriptId}/production/${tool}`),
};
