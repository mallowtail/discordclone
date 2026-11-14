import { describe, it, expect } from "vitest";
import { linkDecision, addTrustedDomain, removeTrustedDomain } from "@/lib/messages/linkGuard";

const ORIGIN = "https://website-mallow1.vercel.app";

describe("linkDecision", () => {
  it("opens links to this app in place, without a warning", () => {
    expect(linkDecision("https://website-mallow1.vercel.app/invite/abc?x=1#y", ORIGIN, []))
      .toEqual({ kind: "internal", path: "/invite/abc?x=1#y" });
  });
  it("asks before opening any other site", () => {
    expect(linkDecision("https://example.com/page", ORIGIN, [])).toEqual({ kind: "confirm", hostname: "example.com", url: "https://example.com/page" });
  });
  it("opens trusted sites directly, matching the exact hostname, any case", () => {
    expect(linkDecision("https://Example.COM/x", ORIGIN, ["example.com"])).toEqual({ kind: "open", url: "https://Example.COM/x" });
    expect(linkDecision("https://evil.example.com/x", ORIGIN, ["example.com"])).toMatchObject({ kind: "confirm", hostname: "evil.example.com" });
    expect(linkDecision("https://example.com.evil.net/", ORIGIN, ["example.com"])).toMatchObject({ kind: "confirm" });
  });
  it("refuses anything that isn't http(s)", () => {
    expect(linkDecision("javascript:alert(1)", ORIGIN, [])).toEqual({ kind: "block" });
    expect(linkDecision("data:text/html,hi", ORIGIN, [])).toEqual({ kind: "block" });
    expect(linkDecision("not a url", ORIGIN, [])).toEqual({ kind: "block" });
  });
});

describe("trusted domain list", () => {
  it("adds lowercase, without duplicates, sorted", () => {
    expect(addTrustedDomain(["b.com"], "A.com")).toEqual(["a.com", "b.com"]);
    expect(addTrustedDomain(["a.com"], "a.com")).toEqual(["a.com"]);
  });
  it("removes", () => {
    expect(removeTrustedDomain(["a.com", "b.com"], "a.com")).toEqual(["b.com"]);
  });
});
