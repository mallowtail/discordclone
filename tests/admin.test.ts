import { describe, it, expect } from "vitest";
import {
  adminDeleteMessageErrorMessage, adminDeleteServerErrorMessage, adminLoadErrorMessage, adminTransferErrorMessage,
  banErrorMessage, banResultMessage, canBanNow, filesByBucket, unbanErrorMessage, userSearchFilter,
} from "@/lib/admin/admin";

describe("filesByBucket", () => {
  it("groups paths by bucket, dropping duplicates, blanks and other buckets", () => {
    const m = filesByBucket([
      { bucket: "attachments", path: "u1/a.png" },
      { bucket: "attachments", path: "u1/a.png" },
      { bucket: "attachments", path: "u1/b.pdf" },
      { bucket: "stickers", path: "s1/x.webp" },
      { bucket: "server-icons", path: "s1/icon.png" },
      { bucket: "avatars", path: "u1/me.png" },
      { bucket: "attachments", path: "" },
    ]);
    expect([...m.entries()]).toEqual([
      ["attachments", ["u1/a.png", "u1/b.pdf"]],
      ["stickers", ["s1/x.webp"]],
      ["server-icons", ["s1/icon.png"]],
    ]);
  });
  it("handles nothing", () => {
    expect(filesByBucket(null).size).toBe(0);
    expect(filesByBucket([]).size).toBe(0);
  });
});

describe("userSearchFilter", () => {
  it("is null for an empty search", () => {
    expect(userSearchFilter("")).toBeNull();
    expect(userSearchFilter("   ")).toBeNull();
    expect(userSearchFilter("@")).toBeNull();
    expect(userSearchFilter(",()*")).toBeNull();
  });
  it("matches username or display name, quoted", () => {
    expect(userSearchFilter("Mal")).toBe('username.ilike."%Mal%",display_name.ilike."%Mal%"');
    expect(userSearchFilter("@mal")).toBe('username.ilike."%mal%",display_name.ilike."%mal%"');
  });
  it("strips characters that could change the filter and escapes LIKE wildcards", () => {
    expect(userSearchFilter('a,b)"c*')).toBe('username.ilike."%abc%",display_name.ilike."%abc%"');
    // `_` is escaped for LIKE (\_), and the backslash doubled for PostgREST's quoting.
    expect(userSearchFilter("a_b")).toBe('username.ilike."%a\\\\_b%",display_name.ilike."%a\\\\_b%"');
  });
  it("keeps letters from any language and caps the length", () => {
    expect(userSearchFilter("Zoë")).toContain("%Zoë%");
    expect(userSearchFilter("x".repeat(80))).toContain(`%${"x".repeat(50)}%`);
  });
});

describe("error messages", () => {
  it("site_ban", () => {
    expect(banErrorMessage("transfer or delete their servers first")).toMatch(/still own servers/);
    expect(banErrorMessage("you cannot ban yourself")).toBe("You can't ban yourself.");
    expect(banErrorMessage("cannot ban a site admin")).toBe("You can't ban another admin.");
    expect(banErrorMessage("already banned")).toBe("They're already banned.");
    expect(banErrorMessage("user not found")).toBe("That account isn't there anymore.");
    expect(banErrorMessage("not permitted")).toBe("Only the Mallowchat admin can do that.");
    expect(banErrorMessage("boom")).toBe("Couldn't ban them — try again.");
    expect(banErrorMessage(undefined)).toBe("Couldn't ban them — try again.");
  });
  it("site_unban", () => {
    expect(unbanErrorMessage("not banned")).toBe("They aren't banned anymore.");
    expect(unbanErrorMessage("not permitted")).toBe("Only the Mallowchat admin can do that.");
    expect(unbanErrorMessage("x")).toBe("Couldn't unban them — try again.");
  });
  it("admin deletes and transfers", () => {
    expect(adminDeleteMessageErrorMessage("message not found")).toBe("That message is already gone.");
    expect(adminDeleteMessageErrorMessage("x")).toBe("Couldn't delete the message — try again.");
    expect(adminDeleteServerErrorMessage("server not found")).toBe("That server is already gone.");
    expect(adminDeleteServerErrorMessage("not permitted")).toBe("Only the Mallowchat admin can do that.");
    expect(adminDeleteServerErrorMessage("x")).toBe("Couldn't delete the server — try again.");
    expect(adminTransferErrorMessage("they already own this server")).toBe("They already own this server.");
    expect(adminTransferErrorMessage("not a member")).toBe("That person isn't in this server anymore.");
    expect(adminTransferErrorMessage("server not found")).toBe("That server is already gone.");
    expect(adminTransferErrorMessage("x")).toBe("Couldn't give the server away — try again.");
    expect(adminLoadErrorMessage("not permitted")).toBe("Only the Mallowchat admin can do that.");
    expect(adminLoadErrorMessage("x")).toBe("Couldn't load that — try again.");
  });
});

describe("canBanNow", () => {
  it("waits for the server list and for it to be empty", () => {
    expect(canBanNow(null, false)).toBe(false);
    expect(canBanNow([{ id: "s" }], false)).toBe(false);
    expect(canBanNow([], false)).toBe(true);
    expect(canBanNow([], true)).toBe(false);
  });
});

describe("banResultMessage", () => {
  it("says what went wrong, if anything", () => {
    expect(banResultMessage("Sam", { filesOk: true, voiceOk: true })).toBe("Sam is banned.");
    expect(banResultMessage("Sam", { filesOk: false, voiceOk: true })).toBe("Sam is banned, but some of their files couldn't be removed.");
    expect(banResultMessage("Sam", { filesOk: false, voiceOk: false }))
      .toBe("Sam is banned, but some of their files couldn't be removed and they couldn't be removed from voice calls.");
  });
});
