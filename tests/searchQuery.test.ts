import { describe, it, expect } from "vitest";
import { parseSearchQuery, toRpcArgs } from "@/lib/searchQuery";

describe("parseSearchQuery", () => {
  it("plain words become text", () => {
    expect(parseSearchQuery("pizza friday").text).toBe("pizza friday");
  });
  it("keeps a quoted phrase intact as text", () => {
    expect(parseSearchQuery('"pizza friday" soon').text).toBe("pizza friday soon");
  });
  it("parses from/in/has/mentions/pinned and strips @ #", () => {
    const p = parseSearchQuery("from:@alex in:#random has:image mentions:@bea pinned:true hi");
    expect(p.from).toBe("alex");
    expect(p.in).toBe("random");
    expect(p.has).toBe("image");
    expect(p.mentions).toBe("bea");
    expect(p.pinned).toBe(true);
    expect(p.text).toBe("hi");
  });
  it("ignores an invalid has: value (treats as text)", () => {
    const p = parseSearchQuery("has:banana");
    expect(p.has).toBeUndefined();
    expect(p.text).toBe("has:banana");
  });
  it("pinned is only true for true/yes/1", () => {
    expect(parseSearchQuery("pinned:false").pinned).toBeUndefined();
    expect(parseSearchQuery("pinned:yes").pinned).toBe(true);
  });
  it("before/after/during produce day bounds (YYYY-MM-DD)", () => {
    expect(parseSearchQuery("before:2026-09-04").beforeTs).toBe("2026-09-04T00:00:00.000Z");
    expect(parseSearchQuery("after:2026-09-04").afterTs).toBe("2026-09-05T00:00:00.000Z");
    const d = parseSearchQuery("during:2026-09-04");
    expect(d.afterTs).toBe("2026-09-04T00:00:00.000Z");
    expect(d.beforeTs).toBe("2026-09-05T00:00:00.000Z");
  });
  it("during a month spans the whole month (YYYY-MM)", () => {
    const d = parseSearchQuery("during:2026-09");
    expect(d.afterTs).toBe("2026-09-01T00:00:00.000Z");
    expect(d.beforeTs).toBe("2026-10-01T00:00:00.000Z");
  });
  it("drops an invalid date (token becomes text)", () => {
    const p = parseSearchQuery("before:nope");
    expect(p.beforeTs).toBeUndefined();
    expect(p.text).toBe("before:nope");
  });
  it("rejects impossible dates that pass the regex (calendar rollover)", () => {
    const p1 = parseSearchQuery("before:2026-02-30");
    expect(p1.beforeTs).toBeUndefined();
    expect(p1.text).toBe("before:2026-02-30");
    const p2 = parseSearchQuery("during:2026-13-01");
    expect(p2.beforeTs).toBeUndefined();
    expect(p2.afterTs).toBeUndefined();
    expect(p2.text).toBe("during:2026-13-01");
    const p3 = parseSearchQuery("after:0050-01");
    expect(p3.afterTs).toBeUndefined();
    expect(p3.text).toBe("after:0050-01");
  });
  it("before/after with month form (YYYY-MM) set day bounds", () => {
    expect(parseSearchQuery("before:2026-09").beforeTs).toBe("2026-09-01T00:00:00.000Z");
    expect(parseSearchQuery("after:2026-09").afterTs).toBe("2026-10-01T00:00:00.000Z");
  });
  it("quoted phrase that looks like an operator stays literal text", () => {
    const p = parseSearchQuery('"from:@alex"');
    expect(p.from).toBeUndefined();
    expect(p.text).toBe("from:@alex");
  });
  it("pinned:1 is accepted", () => {
    expect(parseSearchQuery("pinned:1").pinned).toBe(true);
  });
  it("empty input yields empty text and no operators", () => {
    const p = parseSearchQuery("   ");
    expect(p).toEqual({ text: "" });
  });
});

describe("toRpcArgs", () => {
  it("maps fields and nulls an empty text", () => {
    expect(toRpcArgs({ text: "", from: "alex", pinned: true })).toEqual({
      text_query: null, from_user: "alex", in_channel: null, has_type: null,
      before_ts: null, after_ts: null, mentions_user: null, only_pinned: true,
    });
  });
  it("passes text and date bounds through", () => {
    expect(toRpcArgs({ text: "hi", beforeTs: "2026-09-04T00:00:00.000Z" })).toMatchObject({
      text_query: "hi", before_ts: "2026-09-04T00:00:00.000Z", only_pinned: false,
    });
  });
});
