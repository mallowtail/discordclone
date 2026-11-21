import { describe, it, expect } from "vitest";
import { groupHiddenRuns, hiddenLabel } from "@/lib/users/safety";

const m = (id: string, author: string) => ({ id, author_id: author });
const kindOf = (id: string) => (id === "blk" ? "block" : id === "ign" ? "ignore" : null) as "block" | "ignore" | null;

describe("groupHiddenRuns", () => {
  it("leaves everyone else's messages alone", () => {
    expect(groupHiddenRuns([m("1", "a"), m("2", "b")], kindOf, new Set())).toEqual([
      { type: "message", message: m("1", "a") }, { type: "message", message: m("2", "b") },
    ]);
  });
  it("collapses consecutive hidden messages of the same kind into one row", () => {
    const rows = groupHiddenRuns([m("1", "a"), m("2", "blk"), m("3", "blk"), m("4", "ign"), m("5", "a"), m("6", "blk")], kindOf, new Set());
    expect(rows.map((r) => (r.type === "message" ? r.message.id : r.type === "hidden" ? `${r.kind}:${r.messages.map((x) => x.id).join("")}` : "revealed")))
      .toEqual(["1", "block:23", "ignore:4", "5", "block:6"]);
  });
  it("a revealed run shows its messages, keyed by its first message", () => {
    const rows = groupHiddenRuns([m("1", "blk"), m("2", "blk"), m("3", "a")], kindOf, new Set(["1"]));
    expect(rows.map((r) => r.type)).toEqual(["revealed", "message", "message", "message"]);
    expect(rows[0]).toMatchObject({ type: "revealed", kind: "block", key: "1", count: 2 });
  });
});

describe("hiddenLabel", () => {
  it("counts and names the kind", () => {
    expect(hiddenLabel("block", 1)).toBe("1 blocked message");
    expect(hiddenLabel("block", 3)).toBe("3 blocked messages");
    expect(hiddenLabel("ignore", 2)).toBe("2 messages from someone you ignored");
  });
});
