import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchResult } from "@/types/db";
import { toRpcArgs, type ParsedQuery } from "@/lib/search/searchQuery";
import { DELETED_USER_NAME, deletedUsernameFor } from "@/lib/users/account";

/** Results by site-banned authors, dressed as "Deleted User" (like deleted accounts' messages). */
export function maskBannedAuthors(rows: SearchResult[], bannedIds: ReadonlySet<string>): SearchResult[] {
  if (bannedIds.size === 0) return rows;
  return rows.map((r) =>
    bannedIds.has(r.author_id)
      ? { ...r, author_username: deletedUsernameFor(r.author_id), author_display_name: DELETED_USER_NAME, author_avatar_url: null }
      : r
  );
}

export async function searchMessages(
  supabase: SupabaseClient,
  serverId: string,
  parsed: ParsedQuery,
  page: { lim: number; off: number }
): Promise<SearchResult[]> {
  const args = toRpcArgs(parsed);
  const { data, error } = await supabase.rpc("search_messages", {
    srv: serverId,
    ...args,
    lim: page.lim,
    off_n: page.off,
  });
  if (error) throw error;
  const rows = (data as SearchResult[]) ?? [];
  // The search returns authors' stored names; look up who is banned so they show as "Deleted User".
  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  if (authorIds.length === 0) return rows;
  const { data: profiles } = await supabase.from("profiles").select("id, banned_at").in("id", authorIds);
  const banned = new Set(((profiles ?? []) as { id: string; banned_at: string | null }[]).filter((p) => p.banned_at).map((p) => p.id));
  return maskBannedAuthors(rows, banned);
}
