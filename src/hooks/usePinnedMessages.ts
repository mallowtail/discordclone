"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PIN_PAGE, applyPinUpdate } from "@/lib/pins";
import type { Message } from "@/types/db";

type Target = { channelId: string } | { conversationId: string };

type ListState = {
  /** `column:value` this list belongs to; a mismatch means "target changed → empty". */
  key: string;
  pins: Message[];
  hasMore: boolean;
  loading: boolean;
  /** The first page has landed (successfully or not). */
  loaded: boolean;
};

const EMPTY: Message[] = [];

function fresh(key: string): ListState {
  return { key, pins: EMPTY, hasMore: true, loading: false, loaded: false };
}

/**
 * Pinned messages for a channel or DM, independent of the loaded chat window: newest pinned
 * first, paged PIN_PAGE at a time. `count` is always live; the list itself is only fetched while
 * `open` is true and is reset on close / target change.
 */
export function usePinnedMessages(target: Target, open: boolean) {
  const supabase = createClient();
  const column = "channelId" in target ? "channel_id" : "conversation_id";
  const value = "channelId" in target ? target.channelId : target.conversationId;
  const key = `${column}:${value}`;

  const [count, setCount] = useState<{ key: string; n: number }>({ key, n: 0 });
  const [list, setList] = useState<ListState>(() => fresh(key));

  // Reset the list whenever the panel closes (React's "adjust state while rendering" pattern, so
  // reopening never flashes the previous session's pins and no setState-in-effect is needed).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) setList(fresh(key));
  }
  const current = list.key === key ? list : fresh(key);

  // Latest target key / open flag, for discarding async results that resolve after a switch.
  const keyRef = useRef(key);
  const openRef = useRef(open);
  const inFlight = useRef<string | null>(null);
  // Unique realtime topic per hook instance AND per effect run (see useMessages.ts).
  const instanceId = useId();
  const runRef = useRef(0);

  const update = useCallback((k: string, fn: (s: ListState) => ListState) => {
    setList((prev) => fn(prev.key === k ? prev : fresh(k)));
  }, []);

  useEffect(() => {
    keyRef.current = key;
    openRef.current = open;
  }, [key, open]);

  // Live count + realtime list maintenance (runs regardless of `open`).
  useEffect(() => {
    let active = true;
    const run = ++runRef.current;

    async function refreshCount() {
      const { count: n, error } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq(column, value)
        .eq("pinned", true);
      if (!active || error) return;
      setCount({ key, n: n ?? 0 });
    }
    refreshCount();

    const channel = supabase
      .channel(`pins:${column}:${value}:${instanceId}:${run}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: `${column}=eq.${value}` },
        (payload) => {
          if (!active) return;
          const row = payload.new as Message;
          update(key, (s) => {
            if (!s.loaded) return s;
            const last = s.pins[s.pins.length - 1];
            // A pin older than the loaded tail belongs to an unloaded page: adding it now would
            // move the paging cursor past the pins in between. It arrives when paged in.
            const beyondTail =
              row.pinned && s.hasMore && !!last?.pinned_at && !!row.pinned_at &&
              row.pinned_at < last.pinned_at && !s.pins.some((m) => m.id === row.id);
            if (beyondTail) return s;
            const pins = applyPinUpdate(s.pins, row);
            return pins === s.pins ? s : { ...s, pins };
          });
          refreshCount();
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          if (!active) return;
          const id = (payload.old as { id: string }).id;
          update(key, (s) =>
            s.pins.some((m) => m.id === id) ? { ...s, pins: s.pins.filter((m) => m.id !== id) } : s
          );
          refreshCount();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refreshCount();
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [supabase, column, value, key, update, instanceId]);

  /** Fetch the next page (or the first, when nothing is loaded) and append it. */
  const fetchPage = useCallback(
    async (callKey: string, cursor: string | null) => {
      if (inFlight.current === callKey) return;
      inFlight.current = callKey;
      update(callKey, (s) => ({ ...s, loading: true }));
      let ok = false;
      let rows: Message[] = [];
      try {
        let q = supabase
          .from("messages")
          .select("*")
          .eq(column, value)
          .eq("pinned", true)
          .order("pinned_at", { ascending: false })
          .limit(PIN_PAGE);
        if (cursor) q = q.lt("pinned_at", cursor);
        const result = await q;
        if (!result.error && result.data) {
          ok = true;
          rows = result.data as Message[];
        }
      } catch {
        // network throw → failed page; hasMore kept so a later scroll can retry
      } finally {
        if (inFlight.current === callKey) inFlight.current = null;
      }
      // Stale guard: chat switched or panel closed while in flight → drop it.
      if (keyRef.current !== callKey || !openRef.current) return;
      update(callKey, (s) => ({
        ...s,
        pins: ok ? rows.reduce(applyPinUpdate, s.pins) : s.pins,
        hasMore: ok ? rows.length >= PIN_PAGE : s.hasMore,
        loading: false,
        loaded: true,
      }));
    },
    [supabase, column, value, update]
  );

  // First page whenever the panel opens (or the target changes while open).
  useEffect(() => {
    if (!open) return;
    openRef.current = true;
    keyRef.current = key;
    fetchPage(key, null);
  }, [open, key, fetchPage]);

  const loadMore = useCallback(async () => {
    if (!open || current.loading || !current.hasMore || !current.loaded) return;
    const last = current.pins[current.pins.length - 1];
    if (!last?.pinned_at) return;
    await fetchPage(key, last.pinned_at);
  }, [open, current.loading, current.hasMore, current.loaded, current.pins, fetchPage, key]);

  return {
    pins: open ? current.pins : EMPTY,
    count: count.key === key ? count.n : 0,
    loadMore,
    loading: open && (current.loading || !current.loaded),
    hasMore: current.hasMore,
  };
}
