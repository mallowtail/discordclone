import { describe, it, expect, vi } from "vitest";
import { announceMessageDeleted, onMessageDeleted, withoutMessage } from "@/lib/messages/localDeletes";

describe("announceMessageDeleted / onMessageDeleted", () => {
  it("tells every listener the id", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onMessageDeleted(a);
    const offB = onMessageDeleted(b);
    announceMessageDeleted("m1");
    expect(a).toHaveBeenCalledWith("m1");
    expect(b).toHaveBeenCalledWith("m1");
    offA();
    offB();
  });
  it("stops after unsubscribing", () => {
    const a = vi.fn();
    const off = onMessageDeleted(a);
    off();
    announceMessageDeleted("m2");
    expect(a).not.toHaveBeenCalled();
  });
  it("copes with a listener unsubscribing while being called", () => {
    const b = vi.fn();
    const off = onMessageDeleted(() => off());
    const offB = onMessageDeleted(b);
    announceMessageDeleted("m3");
    expect(b).toHaveBeenCalledWith("m3");
    offB();
  });
});

describe("withoutMessage", () => {
  it("drops the message with that id", () => {
    expect(withoutMessage([{ id: "a" }, { id: "b" }], "a")).toEqual([{ id: "b" }]);
  });
  it("returns the same array when the id isn't there", () => {
    const list = [{ id: "a" }];
    expect(withoutMessage(list, "x")).toBe(list);
  });
});
