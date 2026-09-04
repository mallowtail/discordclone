import type { SupabaseClient } from "@supabase/supabase-js";
import type { SearchResult } from "@/types/db";
import { toRpcArgs, type ParsedQuery } from "@/lib/searchQuery";

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
  return (data as SearchResult[]) ?? [];
}
