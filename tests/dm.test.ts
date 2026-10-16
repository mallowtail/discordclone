import { describe, it, expect } from "vitest";
import { openDmWith } from "@/lib/dm";
import { fakeSupabase } from "./_fakeSupabase";

// openDmWith now delegates the find-or-create to the get_or_create_dm RPC (atomic + race-safe;
// the 1:1-vs-group and dedupe logic lives in SQL). These tests pin the wrapper's contract.

describe("openDmWith", () => {
  it("calls get_or_create_dm with the other user and returns its conversation id", async () => {
    const { supabase, calls } = fakeSupabase((c) =>
      c.table === "rpc:get_or_create_dm" ? { data: "conv-1" } : {}
    );
    const id = await openDmWith(supabase, "me", "other");
    expect(id).toBe("conv-1");
    const call = calls.find((c) => c.table === "rpc:get_or_create_dm");
    expect(call?.payload).toEqual({ other: "other" });
  });

  it("returns null when the RPC errors", async () => {
    const { supabase } = fakeSupabase(() => ({ error: { message: "nope" } }));
    expect(await openDmWith(supabase, "me", "other")).toBeNull();
  });

  it("returns null when the RPC yields no id", async () => {
    const { supabase } = fakeSupabase(() => ({ data: null }));
    expect(await openDmWith(supabase, "me", "other")).toBeNull();
  });
});
