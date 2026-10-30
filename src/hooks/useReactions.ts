"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Reaction } from "@/types/db";
import { aggregateReactions, upsertReaction, removeReaction, chunkIds, type ReactionPill } from "@/lib/reactions";

// Short, stable hash so the realtime channel name stays small even when `key`
// is hundreds of joined UUIDs (channel names must not balloon to thousands of chars).
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Returns a map: messageId -> aggregated reaction pills, kept live.
export function useReactions(messageIds: string[], currentUserId: string): Record<string, ReactionPill[]> {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Reaction[]>([]);
  const key = messageIds.join(",");
  // Topic unique per hook instance AND effect run: the id set can go A→B→A (e.g. removePending
  // restoring a prior set), and supabase-js hands back the still-closing channel for a reused
  // topic → `.on()` after subscribe() throws. Same pattern as useMessages.ts.
  const instanceId = useId();
  const runRef = useRef(0);
  // No messages → no reactions. Adjusted during render when the id set changes, not in the effect.
  const [prevKey, setPrevKey] = useState(key);
  if (key !== prevKey) {
    setPrevKey(key);
    if (messageIds.length === 0) setRows([]);
  }

  useEffect(() => {
    if (messageIds.length === 0) return;
    let active = true;
    const run = ++runRef.current;

    // Chunked so the `.in()` list never outgrows the GET URL as infinite scroll loads more history.
    // Any failed chunk → keep the rows we already have rather than blanking every pill in view.
    async function load() {
      const results = await Promise.all(
        chunkIds(messageIds).map((ids) => supabase.from("reactions").select("*").in("message_id", ids))
      );
      if (!active) return;
      if (results.some((r) => r.error || !r.data)) return;
      setRows(results.flatMap((r) => (r.data ?? []) as Reaction[]));
    }
    load();

    const channel = supabase
      .channel(`reactions:${shortHash(key)}:${instanceId}:${run}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions" },
        (payload) => {
          const r = payload.new as Reaction;
          // Dedupe: the SUBSCRIBED reload and this INSERT event can race over the same row.
          if (messageIds.includes(r.message_id)) setRows((prev) => upsertReaction(prev, r));
        }
      )
      .on(
        // reactions PK is (message_id, user_id, emoji), so DELETE payloads carry all three.
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reactions" },
        (payload) => {
          const o = payload.old as Reaction;
          setRows((prev) => removeReaction(prev, o));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, key, instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped: Record<string, Reaction[]> = {};
  for (const r of rows) (grouped[r.message_id] ??= []).push(r);
  const byMessage: Record<string, ReactionPill[]> = {};
  for (const id of messageIds) byMessage[id] = aggregateReactions(grouped[id] ?? [], currentUserId);
  return byMessage;
}
