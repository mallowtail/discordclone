import { describe, it, expect } from "vitest";
import {
  QUOTA_REACHED_MESSAGE, UPLOADS_PAUSED_MESSAGE, parseUploadStatus, uploadBlockedMessage, uploadFailedMessage,
  isUploadLimitMessage, formatBytes,
} from "@/lib/media/uploadLimits";

const MB = 1024 * 1024;
const status = (over: Partial<{ usedBytes: number; remainingBytes: number; paused: boolean }> = {}) => ({
  usedBytes: 0, limitBytes: 20 * MB, remainingBytes: 20 * MB, paused: false, ...over,
});

describe("copy", () => {
  it("is the spec's exact wording", () => {
    expect(QUOTA_REACHED_MESSAGE).toBe("You've uploaded 20 MB today — try again tomorrow.");
    expect(UPLOADS_PAUSED_MESSAGE).toBe("Uploads are paused because Mallowchat's storage is almost full.");
  });
});

describe("parseUploadStatus", () => {
  it("reads upload_status()'s jsonb", () => {
    expect(parseUploadStatus({ used_bytes: 5, limit_bytes: 20 * MB, remaining_bytes: 20 * MB - 5, paused: false }))
      .toEqual({ usedBytes: 5, limitBytes: 20 * MB, remainingBytes: 20 * MB - 5, paused: false });
  });
  it("accepts numeric strings (bigint) and clamps a negative remainder", () => {
    expect(parseUploadStatus({ used_bytes: "30", limit_bytes: "20", remaining_bytes: "-10", paused: true }))
      .toEqual({ usedBytes: 30, limitBytes: 20, remainingBytes: 0, paused: true });
  });
  it("is null for anything else", () => {
    expect(parseUploadStatus(null)).toBeNull();
    expect(parseUploadStatus("x")).toBeNull();
    expect(parseUploadStatus({ used_bytes: 1 })).toBeNull();
  });
});

describe("uploadBlockedMessage", () => {
  it("is null while there's quota left and storage isn't paused (even if the file is bigger, Call 1)", () => {
    expect(uploadBlockedMessage(status({ remainingBytes: 1 }))).toBeNull();
  });
  it("says the daily limit once nothing is left", () => {
    expect(uploadBlockedMessage(status({ usedBytes: 20 * MB, remainingBytes: 0 }))).toBe(QUOTA_REACHED_MESSAGE);
  });
  it("says paused first (it applies to everyone)", () => {
    expect(uploadBlockedMessage(status({ remainingBytes: 0, paused: true }))).toBe(UPLOADS_PAUSED_MESSAGE);
  });
  it("lets the upload try when the status couldn't be read", () => {
    expect(uploadBlockedMessage(null)).toBeNull();
  });
});

describe("uploadFailedMessage", () => {
  it("names the limit when that's the reason", () => {
    expect(uploadFailedMessage(status({ remainingBytes: 0 }), "Upload failed: x")).toBe(QUOTA_REACHED_MESSAGE);
    expect(uploadFailedMessage(status({ paused: true }), "Upload failed: x")).toBe(UPLOADS_PAUSED_MESSAGE);
  });
  it("adds how much is left when close", () => {
    expect(uploadFailedMessage(status({ remainingBytes: 1.5 * MB }), "Upload failed: x"))
      .toBe("Upload failed: x (You have 1.5 MB of uploads left today.)");
  });
  it("is the fallback otherwise", () => {
    expect(uploadFailedMessage(status(), "Upload failed: x")).toBe("Upload failed: x");
    expect(uploadFailedMessage(null, "Upload failed: x")).toBe("Upload failed: x");
  });
});

describe("isUploadLimitMessage", () => {
  it("is true only for the two limit messages", () => {
    expect(isUploadLimitMessage(QUOTA_REACHED_MESSAGE)).toBe(true);
    expect(isUploadLimitMessage(UPLOADS_PAUSED_MESSAGE)).toBe(true);
    expect(isUploadLimitMessage("Upload failed: x")).toBe(false);
    expect(isUploadLimitMessage(undefined)).toBe(false);
  });
});

describe("formatBytes", () => {
  it("formats with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * MB)).toBe("20 MB");
    expect(formatBytes(1024 * MB)).toBe("1 GB");
    expect(formatBytes(1.25 * 1024 * MB)).toBe("1.3 GB");
    expect(formatBytes(MB - 1)).toBe("1 MB");
    expect(formatBytes(-5)).toBe("0 B");
  });
});
