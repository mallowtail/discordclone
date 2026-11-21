import { describe, it, expect } from "vitest";
import { validateMessage, validateUsername, sendErrorMessage, usernameErrorMessage } from "@/lib/messages/validation";

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
  it("accepts 1-20 chars of letters, digits, underscore", () => {
    expect(validateUsername("cool_kid7").ok).toBe(true);
  });
  it("rejects empty", () => {
    expect(validateUsername("").ok).toBe(false);
    expect(validateUsername("   ").ok).toBe(false);
  });
  it("rejects spaces and symbols", () => {
    expect(validateUsername("bad name!").ok).toBe(false);
  });
  it("accepts the minimum length (1)", () => {
    expect(validateUsername("a")).toEqual({ ok: true, value: "a" });
    expect(validateUsername("ab").ok).toBe(true);
  });
  it("refuses names starting with deleted_ (reserved for deleted accounts), any case", () => {
    expect(validateUsername("deleted_abc")).toEqual({ ok: false, error: "Usernames can't start with deleted_" });
    expect(validateUsername("Deleted_x").ok).toBe(false);
    expect(validateUsername("deleted").ok).toBe(true);
    expect(validateUsername("undeleted_x").ok).toBe(true);
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

describe("sendErrorMessage", () => {
  it("explains the spam limit", () => {
    expect(sendErrorMessage("slow down: too many messages")).toBe("You're sending messages too fast — wait a few seconds.");
  });
  it("explains a refused DM without saying why (a block mustn't be detectable)", () => {
    expect(sendErrorMessage("cannot message this person")).toBe("Your message couldn't be delivered. They may only accept messages from some people.");
  });
  it("explains a sticker that is no longer usable", () => {
    expect(sendErrorMessage("cannot use that sticker")).toBe("You can't use that sticker anymore.");
    expect(sendErrorMessage("this account has been banned")).toBe("This account has been banned from Mallowchat.");
  });
  it("falls back to a generic message", () => {
    expect(sendErrorMessage("network down")).toBe("Failed to send — try again");
    expect(sendErrorMessage(undefined)).toBe("Failed to send — try again");
  });
});

describe("usernameErrorMessage", () => {
  it("explains a taken username", () => {
    expect(usernameErrorMessage('duplicate key value violates unique constraint "profiles_username_key"')).toBe("That username's taken — try another");
  });
  it("explains the format check", () => {
    expect(usernameErrorMessage('new row for relation "profiles" violates check constraint "profiles_username_format"')).toBe("1-20 letters, numbers, or underscores only");
  });
  it("explains the reserved prefix", () => {
    expect(usernameErrorMessage('new row for relation "profiles" violates check constraint "profiles_username_reserved"')).toBe("Usernames can't start with deleted_");
  });
  it("explains a deleted account", () => {
    expect(usernameErrorMessage("this account was deleted")).toBe("This account was deleted.");
    expect(usernameErrorMessage("this account has been banned")).toBe("This account has been banned from Mallowchat.");
  });
  it("falls back to a generic message", () => {
    expect(usernameErrorMessage("network down")).toBe("Couldn't save — try again");
  });
});
