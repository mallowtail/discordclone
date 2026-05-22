import { describe, it, expect } from "vitest";
import { validateMessage, validateUsername } from "@/lib/validation";

describe("validateMessage", () => {
  it("accepts normal text", () => {
    expect(validateMessage("hello")).toEqual({ ok: true, value: "hello" });
  });
  it("trims surrounding whitespace", () => {
    expect(validateMessage("  hi  ")).toEqual({ ok: true, value: "hi" });
  });
  it("rejects empty / whitespace-only", () => {
    expect(validateMessage("   ").ok).toBe(false);
  });
  it("rejects over 2000 chars", () => {
    expect(validateMessage("a".repeat(2001)).ok).toBe(false);
  });
});

describe("validateUsername", () => {
  it("accepts 3-20 chars of letters, digits, underscore", () => {
    expect(validateUsername("cool_kid7").ok).toBe(true);
  });
  it("rejects too short", () => {
    expect(validateUsername("ab").ok).toBe(false);
  });
  it("rejects spaces and symbols", () => {
    expect(validateUsername("bad name!").ok).toBe(false);
  });
  it("accepts the minimum length (3)", () => {
    expect(validateUsername("abc").ok).toBe(true);
  });
  it("accepts the maximum length (20)", () => {
    expect(validateUsername("a".repeat(20)).ok).toBe(true);
  });
  it("rejects one over the maximum (21)", () => {
    expect(validateUsername("a".repeat(21)).ok).toBe(false);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(validateUsername("  abc  ")).toEqual({ ok: true, value: "abc" });
  });
});
