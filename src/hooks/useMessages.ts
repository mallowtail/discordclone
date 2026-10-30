"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { MESSAGE_PAGE, mergeMessages, nextHasMore, reconcileNewestPage } from "@/lib/messagePaging";
import type { Message } from "@/types/db";

type Target =
  | { channelId: string; anchorId?: string | null }
  | { conversationId: string; anchorId?: string | null };

type State = {
  /** `column:value:anchorId` this state belongs to; a mismatch means "target changed → empty". */
  key: string;
  messages: Message[];
  hasMore: boolean;
  loadingOlder: boolean;
  /** The last older-page fetch failed; MessageList stops AUTO-retrying (fill-viewport) until a
   * user scroll retries successfully or the target changes. */
  olderFailed: boolean;
  anchorFound: boolean;
  /** A server page has landed; later (reconnect) loads keep the paged `hasMore` instead. */
  loaded: boolean;
};

// One stable empty array: MessageList treats "still the very first instance and empty" as
// loading, so every real data/realtime update must hand back a NEW array (mergeMessages does).
const EMPTY: Message[] = [];

function fresh(key: string): State {
  return { key, messages: EMPTY, hasMore: true, loadingOlder: false, olderFailed: false, anchorFound: false, loaded: false };
}

export function useMessages(target: Target) {
  const supabase = createClient();
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;
  const anchorId = target.anchorId ?? null;
  const key = `${column}:${value}:${anchorId ?? ""}`;

  const [state, setState] = useState<State>(() => fresh(key));
  // Derived reset: when the target changes we show a fresh empty state until the new target's
  // first write lands (no setState-in-effect needed).
  const current = state.key === key ? state : fresh(key);

  // Latest target key, for discarding async results that resolve after a chat switch.
  const keyRef = useRef(key);
  // Guards concurrent loadOlder calls before `loadingOlder` state has re-rendered.
  const olderInFlight = useRef<string | null>(null);
  // Realtime topic must be unique per hook instance AND per effect run: supabase-js hands back an
  // existing channel for a reused topic, and `removeChannel` is async, so an effect re-run (anchor
  // change, StrictMode) could get the still-closing old channel and `.on()` after subscribe()
  // throws. Same fix as useMemberRoleColors.ts / useServers.ts, plus a run counter.
  const instanceId = useId();
  const runRef = useRef(0);

  /** Apply `fn` to the state for target `k`, starting from fresh if the stored state is another target's. */
  const update = useCallback((k: string, fn: (s: State) => State) => {
    setState((prev) => fn(prev.key === k ? prev : fresh(k)));
  }, []);

  const addPending = useCallback(
    (m: Message) => {
      update(key, (s) =>
        s.messages.some((x) => x.id === m.id) ? s : { ...s, messages: [...s.messages, m] }
      );
    },
    [update, key]
  );
  const removePending = useCallback(
    (id: string) => {
      update(key, (s) => ({ ...s, messages: s.messages.filter((m) => m.id !== id) }));
    },
    [update, key]
  );

  useEffect(() => {
    keyRef.current = key;
    let active = true;
    const run = ++runRef.current;

    // Fetches the newest page (or the anchored window) and MERGES it into existing state, so a
    // realtime reconnect (SUBSCRIBED fires again) never wipes history paged in via loadOlder.
    async function load() {
      if (anchorId) {
        const { data: anchor } = await supabase
          .from("messages").select("created_at").eq("id", anchorId).eq(column, value).maybeSingle();
        if (anchor?.created_at) {
          const at = anchor.created_at as string;
          const [before, after] = await Promise.all([
            supabase.from("messages").select("*").eq(column, value)
              .lte("created_at", at).order("created_at", { ascending: false }).limit(MESSAGE_PAGE),
            supabase.from("messages").select("*").eq(column, value)
              .gt("created_at", at).order("created_at", { ascending: true }).limit(MESSAGE_PAGE),
          ]);
          if (!active) return;
          const beforeRows = ((before.data ?? []) as Message[]).reverse();
          const afterRows = (after.data ?? []) as Message[];
          // A failed "before" fetch says nothing about older history: keep hasMore and leave
          // `loaded` unset so the next successful load (e.g. realtime re-SUBSCRIBED) decides it.
          const beforeOk = !before.error && !!before.data;
          update(key, (s) => ({
            ...s,
            messages: mergeMessages(s.messages, [...beforeRows, ...afterRows]),
            hasMore: s.loaded ? s.hasMore : nextHasMore(s.hasMore, before, MESSAGE_PAGE),
            anchorFound: true,
            loaded: s.loaded || beforeOk,
            // a successful (re)load — e.g. realtime reconnect — re-enables auto fill-viewport
            olderFailed: beforeOk ? false : s.olderFailed,
          }));
          return;
        }
        // anchor not readable → fall through to recent load
      }
      const recent = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE);
      if (!active) return;
      const page = ((recent.data ?? []) as Message[]).reverse();
      const ok = !recent.error && !!recent.data;
      update(key, (s) => {
        // Reconnect after a long outage: a full newest page disjoint from what we hold means a
        // hole loadOlder could never fill → reconcileNewestPage replaces the list and we reset
        // hasMore so scrolling up pages back through the missed messages.
        const r = s.loaded && ok
          ? reconcileNewestPage(s.messages, page, MESSAGE_PAGE)
          : { messages: mergeMessages(s.messages, page), replaced: false };
        return {
          ...s,
          messages: r.messages,
          hasMore: r.replaced ? true : s.loaded ? s.hasMore : nextHasMore(s.hasMore, recent, MESSAGE_PAGE),
          anchorFound: false,
          loaded: s.loaded || ok,
          olderFailed: ok ? false : s.olderFailed,
        };
      });
    }
    load();

    const channel = supabase
      .channel(`messages:${column}:${value}:${instanceId}:${run}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) => {
          if (!active) return;
          // replaces an existing id (clears an optimistic `pending` row) or inserts in order
          const row = payload.new as Message;
          update(key, (s) => ({ ...s, messages: mergeMessages(s.messages, [row]) }));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) => {
          if (!active) return;
          const row = payload.new as Message;
          update(key, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === row.id ? row : m)) }));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          if (!active) return;
          const id = (payload.old as { id: string }).id;
          update(key, (s) => ({ ...s, messages: s.messages.filter((m) => m.id !== id) }));
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, column, value, anchorId, key, update, instanceId]);

  const loadOlder = useCallback(async () => {
    const callKey = key;
    if (current.loadingOlder || !current.hasMore || olderInFlight.current === callKey) return;
    const oldest = current.messages.find((m) => !m.pending);
    if (!oldest) return;

    olderInFlight.current = callKey;
    update(callKey, (s) => ({ ...s, loadingOlder: true }));
    // Assume failure until a response is applied; a thrown error (network) also counts.
    let failed = true;
    try {
      const result = await supabase
        .from("messages")
        .select("*")
        .eq(column, value)
        .lt("created_at", oldest.created_at)
        .order("created_at", { ascending: false })
        .limit(MESSAGE_PAGE);
      // Stale guard: the user switched chats while this page was in flight → drop it.
      if (keyRef.current !== callKey) return;
      // On error leave messages/hasMore untouched (only the flags change below), so a later
      // user scroll can retry; `olderFailed` stops the automatic fill-viewport retry.
      if (result.error || !result.data) return;
      failed = false;
      const page = (result.data as Message[]).reverse();
      update(callKey, (s) =>
        // The list was replaced meanwhile (reconnect gap reset) — this page belongs below rows we
        // no longer hold and would re-open the gap; drop it (a later scroll pages from the new oldest).
        !s.messages.some((m) => m.id === oldest.id)
          ? s
          : {
              ...s,
              messages: mergeMessages(s.messages, page),
              hasMore: nextHasMore(s.hasMore, result, MESSAGE_PAGE),
            }
      );
    } catch {
      // network/client throw → treated as a failed page (failed stays true)
    } finally {
      if (olderInFlight.current === callKey) olderInFlight.current = null;
      // Clear the flag on whatever state still belongs to this target (never seed a fresh one).
      setState((prev) =>
        prev.key === callKey ? { ...prev, loadingOlder: false, olderFailed: failed } : prev
      );
    }
  }, [key, current.loadingOlder, current.hasMore, current.messages, supabase, column, value, update]);

  return {
    messages: current.messages,
    addPending,
    removePending,
    anchored: !!anchorId && current.anchorFound,
    loadOlder,
    loadingOlder: current.loadingOlder,
    olderFailed: current.olderFailed,
    hasMore: current.hasMore,
  };
}
