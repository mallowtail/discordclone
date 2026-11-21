import { describe, it, expect } from "vitest";
import { suggestUsername, displayNameFrom, avatarFrom } from "@/lib/users/oauthProfile";
import { validateUsername } from "@/lib/messages/validation";

describe("suggestUsername", () => {
  it("uses GitHub's user_name when present", () => {
    expect(suggestUsername({ user_name: "octo_cat", name: "Octo Cat" })).toBe("octo_cat");
  });
  it("strips characters a username can't contain", () => {
    expect(suggestUsername({ name: "Mallow Tail!" })).toBe("MallowTail");
  });
  it("falls back to the email local-part", () => {
    expect(suggestUsername({ email: "jamie.lee@gmail.com" })).toBe("jamielee");
  });
  it("caps at 20 characters", () => {
    expect(suggestUsername({ name: "a".repeat(40) })).toHaveLength(20);
  });
  it("suggests short names (usernames may be 1 character)", () => {
    expect(suggestUsername({ name: "J" })).toBe("J");
    expect(suggestUsername({ name: "ab" })).toBe("ab");
  });
  it("skips candidates that start with the reserved deleted_ prefix", () => {
    expect(suggestUsername({ user_name: "deleted_bob", email: "bob@x.io" })).toBe("bob");
    expect(suggestUsername({ user_name: "Deleted_bob" })).toBe("");
  });
  it("returns empty when nothing usable survives (emoji-only)", () => {
    expect(suggestUsername({ name: "🙂🙂" })).toBe("");
    expect(suggestUsername({})).toBe("");
    expect(suggestUsername(undefined)).toBe("");
  });
  it("every non-empty suggestion passes validateUsername", () => {
    for (const meta of [{ name: "Zoë Ångström" }, { user_name: "a-b-c-d" }, { email: "x_y.z@q.io" }, { name: "Z" }, { user_name: "deleted_1", name: "ok" }]) {
      const s = suggestUsername(meta);
      if (s) expect(validateUsername(s).ok).toBe(true);
    }
  });
});

describe("displayNameFrom", () => {
  it("prefers Discord's global_name over the raw username", () => {
    expect(displayNameFrom({ full_name: "cooluser", custom_claims: { global_name: "Cool User" } }, "fallback")).toBe("Cool User");
  });
  it("uses full_name / name when present, trimmed", () => {
    expect(displayNameFrom({ name: "  Jamie Lee  " }, "fallback")).toBe("Jamie Lee");
  });
  it("falls back when nothing usable", () => {
    expect(displayNameFrom({}, "fallback")).toBe("fallback");
    expect(displayNameFrom(undefined, "fallback")).toBe("fallback");
  });
  it("caps to a valid display-name length", () => {
    expect(displayNameFrom({ name: "x".repeat(200) }, "f").length).toBeLessThanOrEqual(32);
  });
});

describe("avatarFrom", () => {
  it("takes avatar_url or Google's picture", () => {
    expect(avatarFrom({ avatar_url: "https://a.example/x.png" })).toBe("https://a.example/x.png");
    expect(avatarFrom({ picture: "https://g.example/y.jpg" })).toBe("https://g.example/y.jpg");
  });
  it("rejects non-http values", () => {
    expect(avatarFrom({ avatar_url: "javascript:alert(1)" })).toBeNull();
    expect(avatarFrom({})).toBeNull();
  });
});
