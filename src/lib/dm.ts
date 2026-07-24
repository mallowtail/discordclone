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

  let convId: string | null = null;
  if (myIds.length) {
    const { data: shared } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", otherId)
      .in("conversation_id", myIds);
    convId = shared?.[0]?.conversation_id ?? null;
  }

  if (!convId) {
    // Generate the id client-side: RLS only lets members read a conversation, so we
    // can't select-after-insert before becoming a member.
    const newId = crypto.randomUUID();
    const { error: convErr } = await supabase.from("conversations").insert({ id: newId, is_group: false });
    if (convErr) return null;
    const { error: memErr } = await supabase.from("conversation_members").insert([
      { conversation_id: newId, user_id: myId },
      { conversation_id: newId, user_id: otherId },
    ]);
    if (memErr) return null;
    convId = newId;
  }
  return convId;
}
