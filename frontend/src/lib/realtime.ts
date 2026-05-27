import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Approval, RoomMessage } from "@toburt/shared";
import { hasSupabaseEnv, supabase } from "./supabase";
import { api } from "./api";

/**
 * Writers Room transcript hook.
 *
 * - Fetches the existing transcript once via the backend (uses our REST
 *   client, so RLS is enforced server-side).
 * - Subscribes to `room:{projectId}` on Supabase Realtime and appends new
 *   `room_messages` INSERTs to the React Query cache.
 * - In local-dev mode (no Supabase env) it falls back to a 3s polling
 *   refetch so the UI still feels live.
 */
export function useRoomStream(projectId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["room", projectId],
    queryFn: () => api.listRoomMessages(projectId!),
    enabled: !!projectId,
    // Polling fallback for dev mode.
    refetchInterval: hasSupabaseEnv() ? false : 3000,
  });

  const seen = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!projectId || !hasSupabaseEnv()) return;
    const client = supabase();
    const channel = client
      .channel(`room:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "room_messages",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          const row = payload.new as RoomMessage;
          if (seen.current.has(row.id)) return;
          seen.current.add(row.id);
          qc.setQueryData<RoomMessage[]>(["room", projectId], (prev) => {
            if (!prev) return [row];
            if (prev.some((m) => m.id === row.id)) return prev;
            return [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [projectId, qc]);

  return query;
}

/**
 * Approvals stream — same pattern but listens to inserts + updates so the
 * UI can hide cards when status flips to approved/rejected.
 */
export function useApprovalsStream(projectId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["approvals", projectId],
    queryFn: () => api.listApprovals(projectId!),
    enabled: !!projectId,
    refetchInterval: hasSupabaseEnv() ? false : 4000,
  });

  useEffect(() => {
    if (!projectId || !hasSupabaseEnv()) return;
    const client = supabase();
    const channel = client
      .channel(`approvals:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "approvals",
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          // The cheap, correct thing: invalidate the list. The list is short
          // and the backend already filters to status=pending.
          qc.invalidateQueries({ queryKey: ["approvals", projectId] });
          // Also flag a refresh for the workflow + room views so approval
          // decisions surface immediately elsewhere.
          if (payload.eventType === "UPDATE") {
            qc.invalidateQueries({ queryKey: ["workflows", projectId] });
          }
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [projectId, qc]);

  return query;
}

/**
 * Per-script scene_emotional_states stream — keeps the EI panel in sync as
 * the EI pass writes rows.
 */
export function useEmotionalStatesStream(scriptId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["emotional-states", scriptId],
    queryFn: () => api.listScriptEmotionalStates(scriptId!),
    enabled: !!scriptId,
    refetchInterval: hasSupabaseEnv() ? false : 5000,
  });

  useEffect(() => {
    if (!scriptId || !hasSupabaseEnv()) return;
    const client = supabase();
    const channel = client
      .channel(`emotional:${scriptId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scene_emotional_states",
          filter: `script_id=eq.${scriptId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["emotional-states", scriptId] });
        }
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [scriptId, qc]);

  return query;
}

export type { Approval, RoomMessage };
