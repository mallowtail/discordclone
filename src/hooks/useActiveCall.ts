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
    let call = (data as ActiveCall | null) ?? null;
    // The database can't tell when everyone left by closing the tab; ask the server, which checks
    // who's really connected and marks an empty call over.
    if (call) {
      const res = await fetch("/api/voice/call", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversation: conversationId, action: "check" }),
      }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { active?: boolean } | null;
      if (body && body.active === false) call = null;
    }
    setState({ conv: conversationId, call });
  }, [supabase, conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this conversation's call
    load();
    const ch = supabase.channel(`call:${conversationId}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "calls", filter: `conversation_id=eq.${conversationId}` }, () => load())
      .subscribe((s) => { if (s === "SUBSCRIBED") load(); });
    return () => { supabase.removeChannel(ch); };
  }, [supabase, conversationId, instanceId, load]);

  // Nobody's leaving shows up in the database if they just close the tab, so while a call is
  // showing, re-check now and then.
  const showing = state?.conv === conversationId && !!state.call;
  useEffect(() => {
    if (!showing) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [showing, load]);

  return state?.conv === conversationId ? state.call : null;
}
