"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CATCH_UP_DELAY_MS, MESSAGE_PAGE, catchUpDue, mergeMessages, nextHasMore, preferLiveRows, reconcileNewestPage, refreshCachedPage,
} from "@/lib/messages/messagePaging";
import { navCache } from "@/lib/cache/navCache";
import { onMessageDeleted, withoutMessage } from "@/lib/messages/localDeletes";
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
  /** Restored from navCache: shown at once, and the first fresh page reconciles with it. */
  fromCache?: boolean;
};

// One stable empty array: MessageList treats "still the very first instance and empty" as
// loading, so every real data/realtime update must hand back a NEW array (mergeMessages does).
const EMPTY: Message[] = [];

function fresh(key: string): State {
  return { key, messages: EMPTY, hasMore: true, loadingOlder: false, olderFailed: false, anchorFound: false, loaded: false };
}

/** The remembered state for a chat (not for `?msg=` anchored views), else a fresh empty one. */
function initial(key: string, anchored: boolean): State {
  const cached = anchored ? undefined : navCache.getMessages<State>(key);
  return cached ? { ...cached, key, loadingOlder: false, fromCache: true } : fresh(key);
}

export function useMessages(target: Target) {
  const supabase = createClient();
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;
  const anchorId = target.anchorId ?? null;
  const key = `${column}:${value}:${anchorId ?? ""}`;

  const [state, setState] = useState<State>(() => initial(key, !!anchorId));
  // Derived reset: when the target changes we show its remembered state (or a fresh empty one)
  // until the new target's first write lands (no setState-in-effect needed).
  const current = state.key === key ? state : initial(key, !!anchorId);

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
    setState((prev) => fn(prev.key === k ? prev : initial(k, !k.endsWith(":"))));
  }, []);

  // Remember the latest loaded state (minus unsent messages) so reopening this chat is instant.
  useEffect(() => {
    if (anchorId || !current.loaded || current.fromCache) return;
    navCache.setMessages(key, { ...current, messages: current.messages.filter((m) => !m.pending), loadingOlder: false });
  }, [current, key, anchorId]);

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

  // A message this tab just deleted (own delete or a moderator's) leaves the list at once; the
  // realtime DELETE that follows is then a no-op.
  useEffect(() => onMessageDeleted((id) => {
    setState((prev) => {
      const messages = withoutMessage(prev.messages, id);
      return messages === prev.messages ? prev : { ...prev, messages };
    });
  }), []);

  useEffect(() => {
    keyRef.current = key;
    let active = true;
    const run = ++runRef.current;

    // Live events (and this tab's own deletes) numbered as they arrive, so a load can tell which
    // rows changed while its fetch was in flight and keep the live version (preferLiveRows) — more
    // loads now run (catch-ups), and a stale page must never bring back a deleted message or undo
    // an edit. Cleared whenever no load is in flight.
    let eventSeq = 0;
    let loadsInFlight = 0;
    // Deletes are tracked apart from edits/inserts: only a deleted id may be dropped from a page
    // (an edit during the first load touches a row the list doesn't hold yet — it must stay).
    const touchedAt = new Map<string, number>();
    const deletedIds = new Set<string>();
    const latestRows = new Map<string, Message>();
    const touch = (id: string, row?: Message) => {
      if (loadsInFlight === 0) return; // nothing to protect: keep the maps from growing between loads
      touchedAt.set(id, ++eventSeq);
      if (row) latestRows.set(id, row);
    };
    const markDeleted = (id: string) => {
      if (loadsInFlight === 0) return;
      touch(id);
      deletedIds.add(id);
      latestRows.delete(id);
    };
    const touchedSince = (startSeq: number) =>
      new Set([...touchedAt].filter(([, at]) => at > startSeq).map(([id]) => id));
    // Snapshot taken when the fetch lands, BEFORE update(): the state updater may run later (React
    // runs it lazily), after the maps were cleared by the load's `finally`.
    const liveSnapshot = (startSeq: number) => {
      const touched = touchedSince(startSeq);
      const deleted = new Set(deletedIds);
      const latest = new Map(latestRows);
      return (page: Message[], current: Message[]) => preferLiveRows(page, current, touched, deleted, latest);
    };
    const offLocalDelete = onMessageDeleted(markDeleted);
    // Missed-message catch-up (see the subscribe callback and catchUp below).
    let catchUpTimer: ReturnType<typeof setTimeout> | null = null;
    let lastCatchUp = 0;

    // Fetches the newest page (or the anchored window) and MERGES it into existing state, so a
    // realtime reconnect (SUBSCRIBED fires again) never wipes history paged in via loadOlder.
    async function load() {
      loadsInFlight++;
      try {
        await fetchAndMerge(eventSeq);
      } finally {
        if (--loadsInFlight === 0) {
          touchedAt.clear();
          deletedIds.clear();
          latestRows.clear();
        }
      }
    }

    async function fetchAndMerge(startSeq: number) {
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
          const preferLive = liveSnapshot(startSeq);
          update(key, (s) => ({
            ...s,
            messages: mergeMessages(s.messages, preferLive([...beforeRows, ...afterRows], s.messages)),
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
      const fetched = ((recent.data ?? []) as Message[]).reverse();
      const ok = !recent.error && !!recent.data;
      const preferLive = liveSnapshot(startSeq);
      update(key, (s) => {
        const page = preferLive(fetched, s.messages);
        if (s.fromCache && ok) {
          // Reopened chat: the fresh page replaces the remembered one for its time range.
          const r = refreshCachedPage(s.messages, page, MESSAGE_PAGE);
          return { ...s, messages: r.messages, hasMore: r.replaced ? true : s.hasMore, anchorFound: false, loaded: true, fromCache: false, olderFailed: false };
        }
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
          touch(row.id, row);
          update(key, (s) => ({ ...s, messages: mergeMessages(s.messages, [row]) }));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) => {
          if (!active) return;
          const row = payload.new as Message;
          touch(row.id, row);
          update(key, (s) => ({ ...s, messages: s.messages.map((m) => (m.id === row.id ? row : m)) }));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          if (!active) return;
          const id = (payload.old as { id: string }).id;
          markDeleted(id);
          update(key, (s) => ({ ...s, messages: s.messages.filter((m) => m.id !== id) }));
        }
      )
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Fires on the first connect AND on every reconnect: load what we may have missed, then
        // once more shortly after — the server can report SUBSCRIBED a moment before it really
        // streams changes, and a message sent in that moment would otherwise only show on reload.
        load();
        if (catchUpTimer) clearTimeout(catchUpTimer);
        catchUpTimer = setTimeout(() => {
          catchUpTimer = null;
          if (active) load();
        }, CATCH_UP_DELAY_MS);
      });

    // Coming back to the tab (or back online): the live connection may have dozed off (phones
    // suspend background tabs), so look for anything new. Merged by id like every load.
    function catchUp() {
      const now = Date.now();
      if (!active || document.visibilityState === "hidden" || !catchUpDue(lastCatchUp, now)) return;
      lastCatchUp = now;
      load();
    }
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);

    return () => {
      active = false;
      if (catchUpTimer) clearTimeout(catchUpTimer);
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
      offLocalDelete();
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
