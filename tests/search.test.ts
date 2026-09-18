import { describe, it, expect } from "vitest";
import { searchMessages } from "@/lib/search";
import { parseSearchQuery } from "@/lib/searchQuery";
import { fakeSupabase } from "./_fakeSupabase";

describe("searchMessages", () => {
  it("calls the RPC with srv, paging (off_n), and the mapped operator args", async () => {
    const { supabase, calls } = fakeSupabase((c) =>
      c.table === "rpc:search_messages" ? { data: [{ id: "m1", total_count: 3 }] } : {}
    );
    const rows = await searchMessages(
      supabase,
      "srv1",
      parseSearchQuery("hello from:alex has:image"),
      { lim: 25, off: 50 }
    );
    expect(rows).toEqual([{ id: "m1", total_count: 3 }]);

    const call = calls.find((c) => c.table === "rpc:search_messages");
    expect(call?.payload).toMatchObject({
      srv: "srv1",
      lim: 25,
      off_n: 50, // paging uses off_n, not off
      text_query: "hello",
      from_user: "alex",
      has_type: "image",
      only_pinned: false,
    });
  });

  it("returns an empty array when the RPC yields null data", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null }));
    const rows = await searchMessages(supabase, "srv", parseSearchQuery("x"), { lim: 25, off: 0 });
    expect(rows).toEqual([]);
  });

  it("throws when the RPC returns an error", async () => {
    const { supabase } = fakeSupabase(() => ({ error: { message: "boom" } }));
    await expect(
      searchMessages(supabase, "srv", parseSearchQuery("x"), { lim: 25, off: 0 })
    ).rejects.toEqual({ message: "boom" });
  });
});
