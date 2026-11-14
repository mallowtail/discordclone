"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  CONVERSATION_SELECT,
  summarizeConversation,
  type ConversationRow,
  type ConversationSummary,
} from "@/lib/users/conversations";

/** All of my DMs and groups, newest first. RLS returns only conversations I'm a member of. */
export async function fetchConversations(supabase: SupabaseClient, myId: string): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as unknown as ConversationRow[]).map((r) => summarizeConversation(r, myId));
}

/**
 * Re-run `reload` whenever a conversation or membership changes anywhere I can see: being added
 * to a group, someone joining or leaving, a rename. Deletes (leaving, being kicked) arrive with only
 * an opaque id, so every change just triggers a refetch rather than being applied in place.
 */
function useConversationChanges(supabase: SupabaseClient, key: string | null, reload: () => void) {
  const instanceId = useId();
  useEffect(() => {
    if (!key) return;
    const channel = supabase
      .channel(`conversations:${key}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, () => reload())
      // Changes made while the channel was still joining (or rejoining after a drop) are never
      // delivered, so catch up once it's live.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") reload();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, key, instanceId, reload]);
}

/** My conversations, kept live. */
export function useConversations() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const next = await fetchConversations(supabase, user.id);
    setList(next);
    setLoadedFor(user.id);
  }, [supabase, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of my conversations
    load();
  }, [load]);
  useConversationChanges(supabase, user?.id ?? null, load);

  const loaded = !!user && loadedFor === user.id;
  return { conversations: loaded ? list : [], loaded };
}

/** One conversation, kept live. `missing` once it's known I'm not in it (never was, left, or kicked). */
export function useConversation(conversationId: string) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [state, setState] = useState<{ id: string; conv: ConversationSummary | null } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .eq("id", conversationId)
      .maybeSingle();
    setState({
      id: conversationId,
      conv: data ? summarizeConversation(data as unknown as ConversationRow, user.id) : null,
    });
  }, [supabase, user, conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this conversation
    load();
  }, [load]);
  useConversationChanges(supabase, user ? `${user.id}:${conversationId}` : null, load);

  const current = state?.id === conversationId ? state : null;
  return { conv: current?.conv ?? null, loaded: !!current, missing: !!current && !current.conv, reload: load };
}
