"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { pruneTypists, TYPING_THROTTLE_MS, type Typists } from "@/lib/typing";

type TypingPayload = { user_id: string; name: string; typing: boolean };

const NONE: Typists = {};

/**
 * Typing indicator for one chat over a PRIVATE Realtime broadcast channel (`typing-channel:<id>` /
 * `typing-dm:<id>`, member-only via RLS on realtime.messages — migration 0026). Call it once per chat
 * view. If the private join fails (policy missing, not a member, offline) it degrades silently:
 * nobody is shown as typing and notify* are no-ops.
 *
 * Topic reuse: broadcast only reaches subscribers of the exact same topic, so (unlike our
 * postgres_changes hooks) no per-instance suffix is possible. supabase-js `channel(topic)` returns
 * an existing, not-yet-removed channel for the same topic, and `removeChannel` is async, so a fast
 * re-run (StrictMode, A→B→A) could get the still-leaving old channel. Each run therefore first
 * awaits removal of any channel already registered under the topic, then creates a brand-new one;
 * a run that was cleaned up meanwhile bails before creating anything.
 *
 * Auth: supabase-js passes its session token to Realtime (`accessToken` callback + setAuth on auth
 * changes), and realtime-js includes it in the join payload and pushes refreshes to joined channels,
 * so no manual `realtime.setAuth()` is needed in this version (2.106.1).
 */
export function useTyping(topic: string | null) {
  const supabase = createClient();
  const { user, profile } = useAuth();
  const userId = user?.id ?? null;
  const selfName = profile?.display_name || profile?.username || "Someone";

  // Typists belong to a topic; a topic mismatch reads as "nobody" (derived reset, no setState in effect).
  const [state, setState] = useState<{ topic: string | null; typists: Typists }>({ topic, typists: NONE });
  const typists = state.topic === topic ? state.typists : NONE;

  const channelRef = useRef<RealtimeChannel | null>(null);
  const joinedRef = useRef(false);
  // When we last broadcast typing:true (ms epoch); 0 = we are not currently "typing".
  const lastSentRef = useRef(0);
  const selfRef = useRef({ id: userId, name: selfName });
  useEffect(() => {
    selfRef.current = { id: userId, name: selfName };
  });

  useEffect(() => {
    if (!topic || !userId) return;
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    const fullTopic = `realtime:${topic}`;
    const stale = supabase.getChannels().filter((c) => c.topic === fullTopic);

    (async () => {
      try {
        await Promise.all(stale.map((c) => supabase.removeChannel(c)));
      } catch {
        // ignore: we only need it gone
      }
      if (cancelled) return;
      // A leave that errored keeps the old channel registered; reusing it would break, so skip.
      if (supabase.getChannels().some((c) => c.topic === fullTopic)) return;

      const ch = supabase.channel(topic, { config: { private: true, broadcast: { self: false } } });
      ch.on("broadcast", { event: "typing" }, (msg) => {
        if (cancelled) return;
        // user_id/name are sender-supplied (members-only via RLS; entries expire after 5 s anyway).
        const p = msg.payload as Partial<TypingPayload> | undefined;
        if (!p || typeof p.user_id !== "string" || p.user_id === userId) return;
        const id = p.user_id;
        const name = typeof p.name === "string" && p.name.trim() ? p.name.trim() : "Someone";
        setState((prev) => {
          const base = prev.topic === topic ? prev.typists : NONE;
          if (p.typing) return { topic, typists: { ...base, [id]: { name, at: Date.now() } } };
          if (!(id in base)) return prev.topic === topic ? prev : { topic, typists: NONE };
          const next = { ...base };
          delete next[id];
          return { topic, typists: next };
        });
      }).subscribe((status) => {
        if (!cancelled) joinedRef.current = status === "SUBSCRIBED";
      });
      channel = ch;
      channelRef.current = ch;
    })();

    const interval = setInterval(() => {
      setState((prev) => {
        if (prev.topic !== topic) return prev;
        const pruned = pruneTypists(prev.typists, Date.now());
        return pruned === prev.typists ? prev : { topic, typists: pruned };
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (channel) {
        if (lastSentRef.current && joinedRef.current) {
          const self = selfRef.current;
          channel
            .send({ type: "broadcast", event: "typing", payload: { user_id: userId, name: self.name, typing: false } })
            .catch(() => {});
        }
        supabase.removeChannel(channel).catch(() => {});
      }
      if (channelRef.current === channel) channelRef.current = null;
      joinedRef.current = false;
      lastSentRef.current = 0;
      // Forget this topic's typists so returning to it (A→B→A) never shows stale entries.
      setState({ topic: null, typists: NONE });
    };
  }, [supabase, topic, userId]);

  const send = useCallback((typing: boolean) => {
    const ch = channelRef.current;
    const self = selfRef.current;
    // Only over the joined socket: send() on an unjoined channel falls back to REST (and warns).
    if (!ch || !joinedRef.current || !self.id) return;
    const payload: TypingPayload = { user_id: self.id, name: self.name, typing };
    ch.send({ type: "broadcast", event: "typing", payload }).catch(() => {});
  }, []);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    if (!channelRef.current || !joinedRef.current) return;
    lastSentRef.current = now;
    send(true);
  }, [send]);

  const notifyStopped = useCallback(() => {
    if (!lastSentRef.current) return; // never announced typing: nothing to retract
    lastSentRef.current = 0;
    send(false);
  }, [send]);

  const names = useMemo(() => {
    const self = userId;
    return Object.entries(typists)
      .filter(([id]) => id !== self)
      .map(([, t]) => t.name);
  }, [typists, userId]);

  return { names, notifyTyping, notifyStopped };
}
