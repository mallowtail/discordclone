import { describe, it, expect } from "vitest";
import { clampProfileText, STATUS_MAX, BIO_MAX, DISPLAY_MAX, validateDisplayName } from "@/lib/profile";

describe("clampProfileText", () => {
  it("trims surrounding whitespace", () => {
    expect(clampProfileText("  hi there  ", 190)).toBe("hi there");
  });
  it("collapses blank input to an empty string", () => {
    expect(clampProfileText("     ", 190)).toBe("");
  });
  it("truncates to the max length", () => {
    expect(clampProfileText("a".repeat(300), 190)).toHaveLength(190);
  });
  it("leaves within-limit text unchanged", () => {
    expect(clampProfileText("hello", 128)).toBe("hello");
  });
  it("exposes the limit constants", () => {
    expect(STATUS_MAX).toBe(128);
    expect(BIO_MAX).toBe(190);
  });
});

describe("validateDisplayName", () => {
  it("trims and accepts a normal name", () => {
    expect(validateDisplayName("  Alex  ")).toEqual({ ok: true, value: "Alex" });
  });
  it("rejects empty / whitespace-only", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: false, error: "Display name can't be empty" });
  });
  it("rejects over DISPLAY_MAX characters", () => {
    const res = validateDisplayName("x".repeat(DISPLAY_MAX + 1));
    expect(res.ok).toBe(false);
  });
  it("accepts exactly DISPLAY_MAX characters", () => {
    const name = "x".repeat(DISPLAY_MAX);
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });
});
