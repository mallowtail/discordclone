"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Reaction } from "@/types/db";
import { aggregateReactions, type ReactionPill } from "@/lib/reactions";

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

  useEffect(() => {
    if (messageIds.length === 0) {
      setRows([]);
      return;
    }
    let active = true;

    async function load() {
      const { data } = await supabase.from("reactions").select("*").in("message_id", messageIds);
      if (active) setRows(data ?? []);
    }
    load();

    const channel = supabase
      .channel(`reactions:${shortHash(key)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "reactions" },
        (payload) => {
          const r = payload.new as Reaction;
          if (messageIds.includes(r.message_id)) setRows((prev) => [...prev, r]);
        }
      )
      .on(
        // reactions PK is (message_id, user_id, emoji), so DELETE payloads carry all three.
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "reactions" },
        (payload) => {
          const o = payload.old as Reaction;
          setRows((prev) =>
            prev.filter(
              (x) => !(x.message_id === o.message_id && x.user_id === o.user_id && x.emoji === o.emoji)
            )
          );
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const grouped: Record<string, Reaction[]> = {};
  for (const r of rows) (grouped[r.message_id] ??= []).push(r);
  const byMessage: Record<string, ReactionPill[]> = {};
  for (const id of messageIds) byMessage[id] = aggregateReactions(grouped[id] ?? [], currentUserId);
  return byMessage;
}
