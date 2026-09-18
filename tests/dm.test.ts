import { describe, it, expect } from "vitest";
import { openDmWith } from "@/lib/dm";
import { fakeSupabase, type FakeCall } from "./_fakeSupabase";

// Handler that answers the queries openDmWith makes. `myConvs`/`otherConvs` are the
// conversation ids each user belongs to; `groupIds` are the ones that are group chats.
function handlerFor(opts: {
  myConvs: string[];
  otherConvs: string[];
  groupIds?: string[];
  convInsertError?: unknown;
  memberInsertError?: unknown;
}) {
  const groups = new Set(opts.groupIds ?? []);
  return (c: FakeCall) => {
    if (c.table === "conversation_members" && c.method === "select") {
      if (c.filters["eq:user_id"] && !c.filters["in:conversation_id"]) {
        // "my conversations" lookup
        return { data: opts.myConvs.map((id) => ({ conversation_id: id })) };
      }
      // "shared with other" lookup: other's convs intersected with the given id list
      const within = new Set(c.filters["in:conversation_id"] as string[]);
      return { data: opts.otherConvs.filter((id) => within.has(id)).map((id) => ({ conversation_id: id })) };
    }
    if (c.table === "conversations" && c.method === "select") {
      // 1:1 lookup: the shared ids that are NOT groups
      const within = new Set(c.filters["in:id"] as string[]);
      return { data: [...within].filter((id) => !groups.has(id)).map((id) => ({ id })) };
    }
    if (c.table === "conversations" && c.method === "insert") return { error: opts.convInsertError ?? null };
    if (c.table === "conversation_members" && c.method === "insert") return { error: opts.memberInsertError ?? null };
    return {};
  };
}

describe("openDmWith", () => {
  it("reuses an existing 1:1 conversation and does not create one", async () => {
    const { supabase, calls } = fakeSupabase(handlerFor({ myConvs: ["c1", "c2"], otherConvs: ["c1"] }));
    const id = await openDmWith(supabase, "me", "other");
    expect(id).toBe("c1");
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("ignores a shared GROUP conversation and creates a real 1:1 instead", async () => {
    // me and other both belong to group g1, but no 1:1 exists yet.
    const { supabase, calls } = fakeSupabase(handlerFor({ myConvs: ["g1"], otherConvs: ["g1"], groupIds: ["g1"] }));
    const id = await openDmWith(supabase, "me", "other");
    expect(id).not.toBe("g1"); // the group must not be treated as the DM
    expect(typeof id).toBe("string");
    expect(calls.some((c) => c.table === "conversations" && c.method === "insert")).toBe(true);
  });

  it("creates a conversation when none is shared", async () => {
    const { supabase, calls } = fakeSupabase(handlerFor({ myConvs: [], otherConvs: [] }));
    const id = await openDmWith(supabase, "me", "other");
    expect(typeof id).toBe("string");
    const convInsert = calls.find((c) => c.table === "conversations" && c.method === "insert");
    expect(convInsert?.payload).toMatchObject({ id, is_group: false });
    const memberInsert = calls.find((c) => c.table === "conversation_members" && c.method === "insert");
    expect(memberInsert?.payload).toEqual([
      { conversation_id: id, user_id: "me" },
      { conversation_id: id, user_id: "other" },
    ]);
  });

  it("returns null when the conversation insert fails", async () => {
    const { supabase } = fakeSupabase(handlerFor({ myConvs: [], otherConvs: [], convInsertError: { message: "x" } }));
    expect(await openDmWith(supabase, "me", "other")).toBeNull();
  });

  it("returns null when the member insert fails", async () => {
    const { supabase } = fakeSupabase(handlerFor({ myConvs: [], otherConvs: [], memberInsertError: { message: "x" } }));
    expect(await openDmWith(supabase, "me", "other")).toBeNull();
  });
});
