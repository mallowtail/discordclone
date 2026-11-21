"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import type { HiddenKind } from "@/lib/users/safety";

type Entry = { userId: string; kind: HiddenKind };

type Ctx = {
  loaded: boolean;
  entries: Entry[];
  kindOf: (userId: string) => HiddenKind | null;
  /** Block or ignore; resolves to an error message if it failed. */
  setKind: (userId: string, kind: HiddenKind) => Promise<string | null>;
  clear: (userId: string) => Promise<string | null>;
};

const SafetyContext = createContext<Ctx>({
  loaded: false, entries: [], kindOf: () => null, setKind: async () => null, clear: async () => null,
});

/**
 * Who the signed-in user has blocked or ignored (their own list only; nobody can see who blocked
 * them). The database enforces what blocking stops; this drives hiding messages and the UI.
 */
export function SafetyProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [state, setState] = useState<{ owner: string; entries: Entry[] } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase.from("user_blocks").select("blocked, kind");
    if (data) setState({ owner: user.id, entries: data.map((r) => ({ userId: r.blocked as string, kind: r.kind as HiddenKind })) });
  }, [supabase, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of my block list
    load();
  }, [load]);

  const entries = useMemo(() => (state && user && state.owner === user.id ? state.entries : []), [state, user]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.userId, e.kind])), [entries]);
  const kindOf = useCallback((id: string) => byId.get(id) ?? null, [byId]);

  const setKind = useCallback(async (userId: string, kind: HiddenKind) => {
    const { error } = await supabase.rpc("block_user", { target: userId, block_kind: kind });
    await load();
    return error ? "Couldn't save that — try again" : null;
  }, [supabase, load]);

  const clear = useCallback(async (userId: string) => {
    const { error } = await supabase.rpc("unblock_user", { target: userId });
    await load();
    return error ? "Couldn't save that — try again" : null;
  }, [supabase, load]);

  return (
    <SafetyContext.Provider value={{ loaded: !!state && state.owner === user?.id, entries, kindOf, setKind, clear }}>
      {children}
    </SafetyContext.Provider>
  );
}

export const useSafety = () => useContext(SafetyContext);
