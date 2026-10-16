import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Find the existing 1-on-1 conversation between the caller and `otherId`, or create one.
 * Delegates to the `get_or_create_dm` RPC, which does the find-or-create atomically under a
 * per-pair advisory lock — so a double-click can't spawn duplicate conversations, and a shared
 * group chat is never mistaken for the DM. Returns the conversation id, or null on error.
 *
 * `myId` is kept for the call sites' convenience but unused: the RPC identifies the caller via
 * `auth.uid()`, which is the same signed-in user.
 */
export async function openDmWith(
  supabase: SupabaseClient,
  _myId: string,
  otherId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_or_create_dm", { other: otherId });
  if (error) return null;
  return (data as string | null) ?? null;
}
