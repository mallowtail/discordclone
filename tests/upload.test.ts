import { describe, it, expect } from "vitest";
import { validateImage, isImageType, removalProblem } from "@/lib/media/upload";

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

describe("isImageType", () => {
  it("is true for supported image MIME types", () => {
    expect(isImageType("image/png")).toBe(true);
    expect(isImageType("image/webp")).toBe(true);
  });
  it("is false for non-image types", () => {
    expect(isImageType("application/pdf")).toBe(false);
    expect(isImageType("text/plain")).toBe(false);
    expect(isImageType("")).toBe(false);
  });
});

describe("removalProblem", () => {
  it("is null when every file was removed", () => {
    expect(removalProblem(["a.png", "b.png"], { data: [{ name: "b.png" }, { name: "a.png" }], error: null })).toBeNull();
  });
  it("reports files Storage silently kept (delete rules let nothing through)", () => {
    expect(removalProblem(["a.png"], { data: [], error: null })).toBe("not removed: a.png");
    expect(removalProblem(["a.png", "b.png"], { data: [{ name: "a.png" }], error: null })).toBe("not removed: b.png");
  });
  it("reports an error", () => {
    expect(removalProblem(["a.png"], { data: null, error: { message: "boom" } })).toBe("boom");
  });
});
