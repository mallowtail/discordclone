"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types/db";

type Target =
  | { channelId: string; anchorId?: string | null }
  | { conversationId: string };

export function useMessages(target: Target) {
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [anchorFound, setAnchorFound] = useState(false);
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;
  const anchorId = "channelId" in target ? target.anchorId ?? null : null;

  const addPending = useCallback((m: Message) => {
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
  }, []);
  const removePending = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      if (anchorId) {
        const { data: anchor } = await supabase
          .from("messages").select("created_at").eq("id", anchorId).eq(column, value).maybeSingle();
        if (anchor?.created_at) {
          const at = anchor.created_at as string;
          const [before, after] = await Promise.all([
            supabase.from("messages").select("*").eq(column, value)
              .lte("created_at", at).order("created_at", { ascending: false }).limit(50),
            supabase.from("messages").select("*").eq(column, value)
              .gt("created_at", at).order("created_at", { ascending: true }).limit(50),
          ]);
          if (active) {
            setMessages([...((before.data ?? []) as Message[]).reverse(), ...((after.data ?? []) as Message[])]);
            setAnchorFound(true);
          }
          return;
        }
        // anchor not readable → fall through to recent load
        if (active) setAnchorFound(false);
      }
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: true })
        .limit(200);
      if (active) {
        setMessages(data ?? []);
        setAnchorFound(false);
      }
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
  }, [supabase, column, value, anchorId]);

  return { messages, addPending, removePending, anchored: !!anchorId && anchorFound };
}
