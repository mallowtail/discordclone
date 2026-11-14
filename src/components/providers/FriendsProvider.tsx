"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  FRIENDSHIP_SELECT,
  relationTo,
  sortFriendships,
  type FriendshipRow,
  type Relation,
  type SendResult,
} from "@/lib/users/friends";
import type { Profile } from "@/types/db";

type Ctx = {
  loaded: boolean;
  friends: Profile[];
  incoming: Profile[];
  outgoing: Profile[];
  relationTo: (otherId: string) => Relation;
  /** Resolves to the outcome, or throws with a user-facing message. */
  sendRequest: (otherId: string) => Promise<SendResult>;
  accept: (otherId: string) => Promise<boolean>;
  /** Decline, cancel or unfriend. */
  remove: (otherId: string) => Promise<boolean>;
};

const EMPTY: Profile[] = [];
const NO_ROWS: FriendshipRow[] = [];

const FriendsContext = createContext<Ctx>({
  loaded: false,
  friends: EMPTY,
  incoming: EMPTY,
  outgoing: EMPTY,
  relationTo: () => "none",
  sendRequest: async () => { throw new Error("Friends aren't available here"); },
  accept: async () => false,
  remove: async () => false,
});

/**
 * Owns the signed-in user's friendships for the whole app (Friends page, request badges, friend
 * buttons on profiles), so they share one fetch and one Realtime subscription. Any change to a
 * row the user is part of (someone sends, accepts, cancels, unfriends) triggers a refetch.
 */
export function FriendsProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const instanceId = useId();
  const [rows, setRows] = useState<FriendshipRow[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.from("friendships").select(FRIENDSHIP_SELECT);
    if (error) return;
    setRows((data as unknown as FriendshipRow[]) ?? []);
    setLoadedFor(user.id);
  }, [supabase, user]);

  useEffect(() => {
    if (!user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch of this user's friendships
    load();
    // RLS limits inserts/updates to rows the user is in; deletes arrive unfiltered but only
    // trigger a cheap refetch.
    const channel = supabase
      .channel(`friendships:${user.id}:${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, () => { load(); })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, user, load, instanceId]);

  const myId = user?.id ?? "";
  const mine = user && loadedFor === user.id ? rows : NO_ROWS;
  const sorted = useMemo(() => sortFriendships(mine, myId), [mine, myId]);

  const value = useMemo<Ctx>(() => ({
    loaded: !!user && loadedFor === user.id,
    ...sorted,
    relationTo: (otherId) => relationTo(mine, myId, otherId),
    sendRequest: async (otherId) => {
      const { data, error } = await supabase.rpc("send_friend_request", { target: otherId });
      if (error) {
        throw new Error(
          error.message.includes("yourself") ? "That's you!"
            : error.message.includes("not found") ? "Couldn't find that user."
            : "Couldn't send the request — try again."
        );
      }
      await load();
      return data as SendResult;
    },
    accept: async (otherId) => {
      const { error } = await supabase.rpc("accept_friend_request", { requester_id: otherId });
      await load();
      return !error;
    },
    remove: async (otherId) => {
      const { error } = await supabase.rpc("remove_friend", { other: otherId });
      await load();
      return !error;
    },
  }), [user, loadedFor, sorted, mine, myId, supabase, load]);

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export const useFriends = () => useContext(FriendsContext);
