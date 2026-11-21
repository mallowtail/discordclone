import { describe, it, expect } from "vitest";
import {
  BANNED_ACCOUNT_MESSAGE, DELETED_USER_NAME, OWNS_SERVERS_MESSAGE, deleteAccountErrorMessage, deletedUsernameFor, hasPasswordLogin,
  isBannedAccountError, isBannedLoginError, isBannedProfile, isDeletedProfile, isDeletedUsername, shownProfile, shownProfileOrNull,
  usernameConfirmMatches, verifyPassword, hasCookie, showBannedNotice, BANNED_NOTICE_KEY,
} from "@/lib/users/account";

describe("isDeletedProfile", () => {
  it("is true only when deleted_at is set", () => {
    expect(isDeletedProfile({ deleted_at: "2026-11-21T10:00:00Z" })).toBe(true);
    expect(isDeletedProfile({ deleted_at: null })).toBe(false);
    expect(isDeletedProfile({})).toBe(false);
    expect(isDeletedProfile(null)).toBe(false);
    expect(isDeletedProfile(undefined)).toBe(false);
  });
  it("treats a site-banned account like a deleted one", () => {
    expect(isDeletedProfile({ deleted_at: null, banned_at: "2026-11-21T10:00:00Z" })).toBe(true);
    expect(isDeletedProfile({ deleted_at: null, banned_at: null })).toBe(false);
  });
  it("names tombstones Deleted User", () => {
    expect(DELETED_USER_NAME).toBe("Deleted User");
  });
});

describe("isDeletedUsername", () => {
  it("spots tombstone usernames", () => {
    expect(isDeletedUsername("deleted_2a2d34b5")).toBe(true);
    expect(isDeletedUsername("Deleted_x")).toBe(true);
  });
  it("is false for live names and nothing", () => {
    expect(isDeletedUsername("deleted")).toBe(false);
    expect(isDeletedUsername("sam")).toBe(false);
    expect(isDeletedUsername(null)).toBe(false);
  });
});

describe("hasPasswordLogin", () => {
  it("is true when there's an email identity", () => {
    expect(hasPasswordLogin({ identities: [{ provider: "email" }] })).toBe(true);
    expect(hasPasswordLogin({ identities: [{ provider: "discord" }, { provider: "email" }] })).toBe(true);
  });
  it("is false for Discord/GitHub-only accounts", () => {
    expect(hasPasswordLogin({ identities: [{ provider: "discord" }] })).toBe(false);
    expect(hasPasswordLogin({ identities: [{ provider: "github" }], app_metadata: { provider: "github", providers: ["github"] } })).toBe(false);
  });
  it("falls back to app_metadata when identities aren't loaded", () => {
    expect(hasPasswordLogin({ app_metadata: { providers: ["email"] } })).toBe(true);
    expect(hasPasswordLogin({ app_metadata: { provider: "email" } })).toBe(true);
    expect(hasPasswordLogin({ identities: [], app_metadata: { provider: "github" } })).toBe(false);
    expect(hasPasswordLogin({})).toBe(false);
  });
});

describe("usernameConfirmMatches", () => {
  it("matches ignoring case, spaces and a leading @", () => {
    expect(usernameConfirmMatches("sam", "sam")).toBe(true);
    expect(usernameConfirmMatches(" @Sam ", "sam")).toBe(true);
    expect(usernameConfirmMatches("q", "Q")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(usernameConfirmMatches("", "sam")).toBe(false);
    expect(usernameConfirmMatches("sa", "sam")).toBe(false);
    expect(usernameConfirmMatches("@", "sam")).toBe(false);
  });
});

describe("deleteAccountErrorMessage", () => {
  it("explains owned servers with the agreed copy", () => {
    expect(deleteAccountErrorMessage("transfer or delete your servers first")).toBe(OWNS_SERVERS_MESSAGE);
    expect(OWNS_SERVERS_MESSAGE).toBe(
      "You own these servers. Pass on ownership to someone else (or delete the server) before deleting your account.",
    );
  });
  it("explains an already-deleted account", () => {
    expect(deleteAccountErrorMessage("this account was deleted")).toBe("This account was already deleted.");
  });
  it("explains a banned account", () => {
    expect(deleteAccountErrorMessage("this account has been banned")).toBe(BANNED_ACCOUNT_MESSAGE);
  });
  it("falls back to a generic message", () => {
    expect(deleteAccountErrorMessage("network down")).toBe("Couldn't delete your account — try again.");
    expect(deleteAccountErrorMessage(undefined)).toBe("Couldn't delete your account — try again.");
  });
});

describe("verifyPassword", () => {
  function fakeAuth(result: { error: { message: string } | null }) {
    const calls: unknown[] = [];
    const supabase = { auth: { signInWithPassword: async (args: unknown) => { calls.push(args); return result; } } };
    return { supabase, calls };
  }
  it("is ok when the sign-in succeeds", async () => {
    const { supabase, calls } = fakeAuth({ error: null });
    expect(await verifyPassword(supabase, "a@b.co", "pw")).toEqual({ ok: true });
    expect(calls).toEqual([{ email: "a@b.co", password: "pw" }]);
  });
  it("reports a failed sign-in", async () => {
    const { supabase } = fakeAuth({ error: { message: "Invalid login credentials" } });
    expect(await verifyPassword(supabase, "a@b.co", "bad")).toEqual({ ok: false, error: "Invalid login credentials" });
  });
  it("passes a bot-check token through when given", async () => {
    const { supabase, calls } = fakeAuth({ error: null });
    await verifyPassword(supabase, "a@b.co", "pw", "tok");
    expect(calls).toEqual([{ email: "a@b.co", password: "pw", options: { captchaToken: "tok" } }]);
  });
});

describe("banned accounts", () => {
  const id = "a1b2c3d4-e5f6-0000-0000-000000000000";
  const live = { id, username: "sam", display_name: "Sam", avatar_url: "https://x/a.png", bio: "hi", status: "busy", deleted_at: null, banned_at: null };
  const banned = { ...live, banned_at: "2026-11-21T10:00:00Z" };

  it("isBannedProfile reads banned_at", () => {
    expect(isBannedProfile(banned)).toBe(true);
    expect(isBannedProfile(live)).toBe(false);
    expect(isBannedProfile(null)).toBe(false);
  });
  it("spots the database's banned refusal and has the agreed copy", () => {
    expect(isBannedAccountError("this account has been banned")).toBe(true);
    expect(isBannedAccountError("you are banned from this server")).toBe(false);
    expect(isBannedAccountError(undefined)).toBe(false);
    expect(BANNED_ACCOUNT_MESSAGE).toBe("This account has been banned from Mallowchat.");
  });
  it("deletedUsernameFor matches the tombstone format", () => {
    expect(deletedUsernameFor(id)).toBe("deleted_a1b2c3d4");
    expect(isDeletedUsername(deletedUsernameFor(id))).toBe(true);
  });
  it("shownProfile dresses a banned profile as Deleted User", () => {
    const shown = shownProfile(banned);
    expect(shown).toEqual({ ...banned, username: "deleted_a1b2c3d4", display_name: DELETED_USER_NAME, avatar_url: null, bio: null, status: null });
    expect(isDeletedProfile(shown)).toBe(true);
    expect(isDeletedUsername(shown.username)).toBe(true);
    expect(banned.display_name).toBe("Sam"); // the input isn't changed
  });
  it("shownProfile leaves live and deleted profiles alone, and only masks fields that are there", () => {
    expect(shownProfile(live)).toBe(live);
    const tomb = { ...live, deleted_at: "2026-11-01T00:00:00Z", banned_at: "2026-11-02T00:00:00Z" };
    expect(shownProfile(tomb)).toBe(tomb);
    expect(shownProfile({ id, display_name: "Sam", banned_at: "x" })).toEqual({ id, display_name: DELETED_USER_NAME, banned_at: "x" });
  });
  it("shownProfileOrNull passes nothing through", () => {
    expect(shownProfileOrNull(null)).toBeNull();
    expect(shownProfileOrNull(undefined)).toBeNull();
    expect(shownProfileOrNull(banned)?.display_name).toBe(DELETED_USER_NAME);
  });
});

describe("isBannedLoginError", () => {
  it("spots GoTrue's banned refusal by code or message", () => {
    expect(isBannedLoginError({ code: "user_banned", message: "anything" })).toBe(true);
    expect(isBannedLoginError({ message: "User is banned" })).toBe(true);
    expect(isBannedLoginError({ message: "user is BANNED" })).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isBannedLoginError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(false);
    expect(isBannedLoginError({ message: "You're banned from this server." })).toBe(false);
    expect(isBannedLoginError(null)).toBe(false);
    expect(isBannedLoginError(undefined)).toBe(false);
  });
});

describe("showBannedNotice", () => {
  it("shows only for ?banned=1 that the app flagged", () => {
    expect(showBannedNotice("1", true)).toBe(true);
    expect(showBannedNotice("1", false)).toBe(false); // a bare /login?banned=1 link
    expect(showBannedNotice(null, true)).toBe(false);
    expect(showBannedNotice("yes", true)).toBe(false);
  });
});

describe("hasCookie", () => {
  it("finds a cookie by exact name", () => {
    expect(hasCookie(`a=1; ${BANNED_NOTICE_KEY}=1; b=2`, BANNED_NOTICE_KEY)).toBe(true);
    expect(hasCookie(`${BANNED_NOTICE_KEY}=1`, BANNED_NOTICE_KEY)).toBe(true);
  });
  it("ignores other names, including ones that merely contain it", () => {
    expect(hasCookie("", BANNED_NOTICE_KEY)).toBe(false);
    expect(hasCookie(`x${BANNED_NOTICE_KEY}=1; other=${BANNED_NOTICE_KEY}`, BANNED_NOTICE_KEY)).toBe(false);
  });
});
