"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/db";

type Target = { channelId: string } | { conversationId: string };

export function useMessages(target: Target) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: true })
        .limit(200);
      // replace state from source of truth — covers both first load and reconnect,
      // and naturally de-dupes anything the INSERT handler already appended
      if (active) setMessages(data ?? []);
    }
    load();

    const channel = supabase
      .channel(`messages:${column}:${value}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) =>
            prev.some((m) => m.id === (payload.new as Message).id)
              ? prev
              : [...prev, payload.new as Message]
          )
      )
      .subscribe((status) => {
        // on (re)subscribe — including automatic reconnect after a drop —
        // reload recent history so no messages are missed during the gap
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, column, value]);

  return messages;
}
