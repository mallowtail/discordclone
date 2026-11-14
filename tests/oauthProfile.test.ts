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
  it("returns empty when nothing usable survives (emoji-only, too short)", () => {
    expect(suggestUsername({ name: "🙂🙂" })).toBe("");
    expect(suggestUsername({ name: "ab" })).toBe("");
    expect(suggestUsername({})).toBe("");
    expect(suggestUsername(undefined)).toBe("");
  });
  it("every non-empty suggestion passes validateUsername", () => {
    for (const meta of [{ name: "Zoë Ångström" }, { user_name: "a-b-c-d" }, { email: "x_y.z@q.io" }]) {
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
