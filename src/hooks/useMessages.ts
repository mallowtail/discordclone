"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/db";

type Target = { channelId: string } | { conversationId: string };

export function useMessages(target: Target) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;

  const addPending = useCallback((m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);
  const removePending = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: true })
        .limit(200);
      if (active) setMessages(data ?? []);
    }
    load();

    const channel = supabase
      .channel(`messages:${column}:${value}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) => {
            const row = payload.new as Message;
            // replace an existing id (clears an optimistic `pending` row) or append
            return prev.some((m) => m.id === row.id)
              ? prev.map((m) => (m.id === row.id ? row : m))
              : [...prev, row];
          })
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === (payload.new as Message).id ? (payload.new as Message) : m))
          )
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) =>
          setMessages((prev) => prev.filter((m) => m.id !== (payload.old as { id: string }).id))
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, column, value]);

  return { messages, addPending, removePending };
}
