import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Find the existing 1-on-1 conversation between `myId` and `otherId`, or create one.
 * Returns the conversation id, or null on error.
 */
export async function openDmWith(
  supabase: SupabaseClient,
  myId: string,
  otherId: string
): Promise<string | null> {
  const { data: mine } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", myId);
  const myIds = (mine ?? []).map((m) => m.conversation_id);

  if (myIds.length) {
    const { data: shared } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", otherId)
      .in("conversation_id", myIds);
    const sharedIds = (shared ?? []).map((s) => s.conversation_id);
    if (sharedIds.length) {
      // Only a 1-on-1 (non-group) conversation is "the DM" — a group both users happen to be
      // in must not be returned here, or messaging someone would drop you into a group chat.
      const { data: convs } = await supabase
        .from("conversations")
        .select("id")
        .in("id", sharedIds)
        .eq("is_group", false)
        .limit(1);
      const existing = convs?.[0]?.id ?? null;
      if (existing) return existing;
    }
  }

  // None exists — create it. Generate the id client-side: RLS only lets members read a
  // conversation, so we can't select-after-insert before becoming a member.
  const newId = crypto.randomUUID();
  const { error: convErr } = await supabase.from("conversations").insert({ id: newId, is_group: false });
  if (convErr) return null;
  const { error: memErr } = await supabase.from("conversation_members").insert([
    { conversation_id: newId, user_id: myId },
    { conversation_id: newId, user_id: otherId },
  ]);
  if (memErr) return null;
  return newId;
}
