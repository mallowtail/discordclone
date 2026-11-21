import { describe, it, expect } from "vitest";
import { canKeepMessage, keepLabel, keepErrorMessage } from "@/lib/messages/keep";
import { BANNED_ACCOUNT_MESSAGE } from "@/lib/users/account";

describe("canKeepMessage", () => {
  it("the author can, anywhere", () => {
    expect(canKeepMessage({ isMine: true, inServer: true, canManageMessages: false })).toBe(true);
    expect(canKeepMessage({ isMine: true, inServer: false, canManageMessages: false })).toBe(true);
  });
  it("in a server, someone else's message needs Manage Messages", () => {
    expect(canKeepMessage({ isMine: false, inServer: true, canManageMessages: false })).toBe(false);
    expect(canKeepMessage({ isMine: false, inServer: true, canManageMessages: true })).toBe(true);
  });
  it("in a DM or group, any member can", () => {
    expect(canKeepMessage({ isMine: false, inServer: false, canManageMessages: false })).toBe(true);
  });
  it("never while the message is still sending", () => {
    expect(canKeepMessage({ isMine: true, inServer: false, canManageMessages: true, pending: true })).toBe(false);
  });
});

describe("keepLabel", () => {
  it("toggles", () => {
    expect(keepLabel(false)).toBe("Keep this message");
    expect(keepLabel(true)).toBe("Don't keep");
  });
});

describe("keepErrorMessage", () => {
  it("maps set_message_kept's refusals", () => {
    expect(keepErrorMessage("not permitted", true)).toBe("You can't change that for this message.");
    expect(keepErrorMessage("message not found", true)).toBe("That message isn't there anymore.");
    expect(keepErrorMessage("this account has been banned", true)).toBe(BANNED_ACCOUNT_MESSAGE);
    expect(keepErrorMessage("this account was deleted", false)).toBe("This account was deleted.");
  });
  it("falls back per direction", () => {
    expect(keepErrorMessage(undefined, true)).toBe("Couldn't keep it — try again");
    expect(keepErrorMessage("boom", false)).toBe("Couldn't change that — try again");
  });
});
