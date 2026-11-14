import { describe, it, expect, beforeEach } from "vitest";
import { navCache } from "@/lib/cache/navCache";
import type { Channel } from "@/types/db";

const ch = (id: string, server_id: string, position: number): Channel =>
  ({ id, name: id, position, server_id, category_id: null, created_at: "2026-01-01T00:00:00Z" });

beforeEach(() => navCache.setOwner(null));

describe("navCache", () => {
  it("knows each server's first channel and the last one you opened", () => {
    navCache.setOwner("u1");
    navCache.rememberChannels([ch("b", "s1", 2), ch("a", "s1", 1), ch("x", "s2", 0)]);
    expect(navCache.channelToOpen("s1")).toBe("a");
    navCache.visitChannel(ch("b", "s1", 2));
    expect(navCache.channelToOpen("s1")).toBe("b");
    expect(navCache.channelToOpen("s2")).toBe("x");
    expect(navCache.channelToOpen("unknown")).toBeNull();
    expect(navCache.getChannel("x")?.server_id).toBe("s2");
  });
  it("forgets a last-opened channel that's since been deleted", () => {
    navCache.setOwner("u1");
    navCache.rememberChannels([ch("a", "s1", 1), ch("b", "s1", 2)]);
    navCache.visitChannel(ch("b", "s1", 2));
    navCache.rememberChannels([ch("a", "s1", 1)], "s1"); // fresh full list for s1 without b
    expect(navCache.channelToOpen("s1")).toBe("a");
  });
  it("wipes everything when a different account signs in", () => {
    navCache.setOwner("u1");
    navCache.rememberChannels([ch("a", "s1", 1)]);
    navCache.setMessages("channel_id:a:", { key: "channel_id:a:" } as never);
    navCache.setOwner("u2");
    expect(navCache.getChannel("a")).toBeUndefined();
    expect(navCache.getMessages("channel_id:a:")).toBeUndefined();
    expect(navCache.channelToOpen("s1")).toBeNull();
  });
  it("keeps messages for at most 30 chats, dropping the least recently used", () => {
    navCache.setOwner("u1");
    for (let i = 0; i < 31; i++) navCache.setMessages(`k${i}`, { key: `k${i}` } as never);
    expect(navCache.getMessages("k0")).toBeUndefined();
    expect(navCache.getMessages("k30")).toBeDefined();
  });
});
