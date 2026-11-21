import { describe, it, expect } from "vitest";
import {
  DELETED_USER_NAME, OWNS_SERVERS_MESSAGE, deleteAccountErrorMessage, hasPasswordLogin, isDeletedProfile, isDeletedUsername,
  usernameConfirmMatches, verifyPassword,
} from "@/lib/users/account";

describe("isDeletedProfile", () => {
  it("is true only when deleted_at is set", () => {
    expect(isDeletedProfile({ deleted_at: "2026-11-21T10:00:00Z" })).toBe(true);
    expect(isDeletedProfile({ deleted_at: null })).toBe(false);
    expect(isDeletedProfile({})).toBe(false);
    expect(isDeletedProfile(null)).toBe(false);
    expect(isDeletedProfile(undefined)).toBe(false);
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
