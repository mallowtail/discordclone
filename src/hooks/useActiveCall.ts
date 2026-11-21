"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type ActiveCall = { id: string; started_by: string | null; started_at: string };

/** The call going on in a conversation (null if none), kept live. Calls older than 12h count as over. */
export function useActiveCall(conversationId: string) {
  const supabase = useMemo(() => createClient(), []);
  const instanceId = useId();
  const [state, setState] = useState<{ conv: string; call: ActiveCall | null } | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data } = await supabase.from("calls").select("id, started_by, started_at")
      .eq("conversation_id", conversationId).is("ended_at", null).gt("started_at", since).limit(1).maybeSingle();
    setState({ conv: conversationId, call: (data as ActiveCall | null) ?? null });
  }, [supabase, conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this conversation's call
    load();
    const ch = supabase.channel(`call:${conversationId}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `conversation_id=eq.${conversationId}` }, () => load())
      .subscribe((s) => { if (s === "SUBSCRIBED") load(); });
    return () => { supabase.removeChannel(ch); };
  }, [supabase, conversationId, instanceId, load]);

  return state?.conv === conversationId ? state.call : null;
}
