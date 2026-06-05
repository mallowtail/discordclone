import { describe, it, expect } from "vitest";
import { validateImage } from "@/lib/upload";

const MB = 1024 * 1024;

describe("validateImage", () => {
  it("accepts a small png", () => {
    expect(validateImage({ type: "image/png", size: 2 * MB })).toEqual({ ok: true });
  });
  it("accepts jpeg, gif, webp", () => {
    expect(validateImage({ type: "image/jpeg", size: 1 }).ok).toBe(true);
    expect(validateImage({ type: "image/gif", size: 1 }).ok).toBe(true);
    expect(validateImage({ type: "image/webp", size: 1 }).ok).toBe(true);
  });
  it("rejects non-images", () => {
    expect(validateImage({ type: "application/pdf", size: 1 }).ok).toBe(false);
  });
  it("rejects images over 5 MB", () => {
    expect(validateImage({ type: "image/png", size: 6 * MB }).ok).toBe(false);
  });
});
