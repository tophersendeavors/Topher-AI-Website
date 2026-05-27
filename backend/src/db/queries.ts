import { supabase } from "./client.js";

export async function assertProjectMember(
  userId: string,
  projectId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("project_members")
    .select("user_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const err = new Error("Forbidden: not a project member");
    (err as Error & { statusCode?: number }).statusCode = 403;
    throw err;
  }
}

export async function getProject(projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listProjectsForUser(userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("*, project_members!inner(user_id)")
    .eq("project_members.user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(({ project_members: _pm, ...row }) => row);
}
