import { describe, it, expect } from "vitest";
import { searchMessages } from "@/lib/search/search";
import { parseSearchQuery } from "@/lib/search/searchQuery";
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

describe("banned authors in search results", () => {
  const row = (id: string, author_id: string) => ({
    id, channel_id: "c", channel_name: "general", author_id, author_username: "sam", author_display_name: "Sam",
    author_avatar_url: "https://x/a.png", content: "hi", image_url: null, file_url: null, file_name: null, pinned: false,
    created_at: "2026-11-21T00:00:00Z", total_count: 2,
  });

  it("maskBannedAuthors shows banned authors as Deleted User", async () => {
    const { maskBannedAuthors } = await import("@/lib/search/search");
    const out = maskBannedAuthors([row("m1", "a1b2c3d4-0000"), row("m2", "live")], new Set(["a1b2c3d4-0000"]));
    expect(out[0]).toMatchObject({ author_display_name: "Deleted User", author_username: "deleted_a1b2c3d4", author_avatar_url: null });
    expect(out[1].author_display_name).toBe("Sam");
  });

  it("searchMessages looks up banned authors and masks them", async () => {
    const { supabase, calls } = fakeSupabase((c) => {
      if (c.table === "rpc:search_messages") return { data: [row("m1", "bad"), row("m2", "ok")] };
      if (c.table === "profiles") return { data: [{ id: "bad", banned_at: "2026-11-21T00:00:00Z" }, { id: "ok", banned_at: null }] };
    });
    const rows = await searchMessages(supabase, "srv", parseSearchQuery("hi"), { lim: 25, off: 0 });
    expect(rows.map((r) => r.author_display_name)).toEqual(["Deleted User", "Sam"]);
    expect(calls.find((c) => c.table === "profiles")?.filters).toEqual({ "in:id": ["bad", "ok"] });
  });
});
