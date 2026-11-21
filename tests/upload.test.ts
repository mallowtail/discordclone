import { describe, it, expect, vi } from "vitest";

const removeMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ remove: removeMock }) } }),
}));

import {
  validateImage, isImageType, removalProblem, notRemoved, removeStorageFiles, removeStorageFilesReporting, STORAGE_REMOVE_BATCH,
} from "@/lib/media/upload";

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

describe("notRemoved", () => {
  it("lists the paths Storage didn't confirm", () => {
    expect(notRemoved(["a", "b", "c"], { data: [{ name: "b" }], error: null })).toEqual(["a", "c"]);
  });
  it("is every path when the call failed", () => {
    expect(notRemoved(["a", "b"], { data: null, error: { message: "boom" } })).toEqual(["a", "b"]);
  });
  it("is empty when everything went", () => {
    expect(notRemoved(["a"], { data: [{ name: "a" }], error: null })).toEqual([]);
  });
});

describe("removeStorageFilesReporting", () => {
  it("removes in batches of at most 1000 and returns only what's left", async () => {
    const calls: string[][] = [];
    removeMock.mockImplementation(async (batch: string[]) => {
      calls.push(batch);
      // The second batch fails as a whole; the first keeps "f5" back.
      if (calls.length === 2) return { data: null, error: { message: "boom" } };
      return { data: batch.filter((p) => p !== "f5").map((name) => ({ name })), error: null };
    });
    const paths = Array.from({ length: 1500 }, (_, i) => `f${i}`);
    const left = await removeStorageFilesReporting("attachments", [...paths, "f0"]);
    expect(calls.map((c) => c.length)).toEqual([STORAGE_REMOVE_BATCH, 500]);
    expect(left).toEqual(["f5", ...paths.slice(1000)]);
    expect(await removeStorageFiles("attachments", [])).toBe(true);
  });
  it("counts a thrown remove() as nothing removed", async () => {
    removeMock.mockImplementation(async () => { throw new Error("offline"); });
    expect(await removeStorageFilesReporting("stickers", ["x"])).toEqual(["x"]);
    expect(await removeStorageFiles("stickers", ["x"])).toBe(false);
  });
});
