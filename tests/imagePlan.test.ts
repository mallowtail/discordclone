import { describe, it, expect } from "vitest";
import { planImage, shouldUseEncoded, renameForType, ATTACHMENT_MAX_DIM, ICON_MAX_DIM } from "@/lib/imagePlan";

const MB = 1024 * 1024;

describe("planImage", () => {
  it("never touches GIFs (re-saving would kill the animation)", () => {
    expect(planImage({ type: "image/gif", size: 9 * MB, width: 4000, height: 3000 }, ATTACHMENT_MAX_DIM)).toEqual({ action: "keep" });
  });
  it("always re-encodes JPEGs, even small ones, to strip EXIF/GPS", () => {
    expect(planImage({ type: "image/jpeg", size: 80_000, width: 800, height: 600 }, ATTACHMENT_MAX_DIM))
      .toEqual({ action: "encode", width: 800, height: 600 });
  });
  it("scales the longest side down to the limit, keeping the aspect ratio", () => {
    expect(planImage({ type: "image/jpeg", size: 6 * MB, width: 4032, height: 3024 }, ATTACHMENT_MAX_DIM))
      .toEqual({ action: "encode", width: 2048, height: 1536 });
    expect(planImage({ type: "image/jpeg", size: 6 * MB, width: 3024, height: 4032 }, ATTACHMENT_MAX_DIM))
      .toEqual({ action: "encode", width: 1536, height: 2048 });
  });
  it("uses the smaller limit for avatars and icons", () => {
    expect(planImage({ type: "image/png", size: 200_000, width: 1024, height: 1024 }, ICON_MAX_DIM))
      .toEqual({ action: "encode", width: 512, height: 512 });
  });
  it("leaves small PNG/WebP images alone", () => {
    expect(planImage({ type: "image/png", size: 120_000, width: 900, height: 600 }, ATTACHMENT_MAX_DIM)).toEqual({ action: "keep" });
    expect(planImage({ type: "image/webp", size: 90_000, width: 1200, height: 800 }, ATTACHMENT_MAX_DIM)).toEqual({ action: "keep" });
  });
  it("re-encodes a big-in-bytes PNG even if its dimensions are fine (huge screenshots)", () => {
    expect(planImage({ type: "image/png", size: 3 * MB, width: 1900, height: 1000 }, ATTACHMENT_MAX_DIM))
      .toEqual({ action: "encode", width: 1900, height: 1000 });
  });
  it("never produces a zero-size dimension for extreme aspect ratios", () => {
    const p = planImage({ type: "image/jpeg", size: MB, width: 10000, height: 2 }, ATTACHMENT_MAX_DIM);
    expect(p).toEqual({ action: "encode", width: 2048, height: 1 });
  });
});

describe("shouldUseEncoded", () => {
  it("keeps a re-encoded JPEG even if slightly bigger (privacy beats bytes)", () => {
    expect(shouldUseEncoded({ srcType: "image/jpeg", srcSize: 100, outSize: 120 })).toBe(true);
  });
  it("keeps the original PNG/WebP if re-encoding didn't make it smaller", () => {
    expect(shouldUseEncoded({ srcType: "image/png", srcSize: 100, outSize: 120 })).toBe(false);
    expect(shouldUseEncoded({ srcType: "image/png", srcSize: 100, outSize: 80 })).toBe(true);
  });
});

describe("renameForType", () => {
  it("swaps the extension to match the new type", () => {
    expect(renameForType("IMG_2041.JPG", "image/webp")).toBe("IMG_2041.webp");
    expect(renameForType("shot.final.png", "image/jpeg")).toBe("shot.final.jpg");
  });
  it("adds an extension when there was none", () => {
    expect(renameForType("photo", "image/webp")).toBe("photo.webp");
  });
});
