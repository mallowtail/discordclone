import { describe, it, expect, vi } from "vitest";
import {
  ERROR_LIMITS, buildErrorReport, cleanPath, createErrorReporter, errorKey, errorParts, isNoise, scrubErrorText,
  type ErrorReport,
} from "@/lib/errors/report";

describe("scrubErrorText", () => {
  it("blanks emails, JWTs (also cut-off ones), bearer tokens and secrets", () => {
    expect(scrubErrorText("for bob.smith+x@mail.example.com now")).toBe("for [email] now");
    expect(scrubErrorText("t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcDEF_123 end")).toBe("t [token] end");
    expect(scrubErrorText("t eyJhbGciOiJIUzI1Ni")).toBe("t [token]");
    expect(scrubErrorText("Authorization: Bearer abc.def")).toBe("Authorization: [redacted] [token]");
    expect(scrubErrorText("password=hunter2 ok")).toBe("password=[redacted] ok");
    expect(scrubErrorText('{"apikey": "sb_publishable_abc", "token":"x"}')).toBe('{"apikey": "[redacted]", "token":"[redacted]"}');
  });

  it("blanks URL queries and hash parameters", () => {
    expect(scrubErrorText("GET https://x.test/rest/v1/messages?select=*&channel_id=eq.1 failed"))
      .toBe("GET https://x.test/rest/v1/messages?[query] failed");
    expect(scrubErrorText("at https://x.test/a.js?dpl=abc:1:2)")).toBe("at https://x.test/a.js?[query])");
    expect(scrubErrorText("/auth#access_token=abc&x=1")).toBe("/auth#[hash]");
  });

  it("blanks long random strings and long quoted text, but keeps UUIDs and ordinary messages", () => {
    expect(scrubErrorText("key AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEF!")).toBe("key [token]!");
    expect(scrubErrorText(`JSON "${"hello there friend ".repeat(4)}" bad`)).toBe('JSON "[text]" bad');
    const fine = [
      "Cannot read properties of undefined (reading 'id')",
      "Unexpected status code: 500",
      "failed for 0b0e1c1e-1111-4222-8333-944445555666",
      "f@https://mallowchat.vercel.app/_next/static/chunks/0a1b2c.js:1:200",
      "What happened?",
    ];
    for (const s of fine) expect(scrubErrorText(s)).toBe(s);
  });
});

describe("cleanPath", () => {
  it("keeps only the path", () => {
    expect(cleanPath("/login?next=%2Fdms&email=a@b.co")).toBe("/login");
    expect(cleanPath("/auth/callback#access_token=eyJxxxxxxxxxxxxxxx")).toBe("/auth/callback");
    expect(cleanPath("/channels/0b0e1c1e-1111-4222-8333-944445555666")).toBe("/channels/0b0e1c1e-1111-4222-8333-944445555666");
    expect(cleanPath("/x".repeat(500)).length).toBe(ERROR_LIMITS.path);
  });
});

describe("errorParts", () => {
  it("reads Errors, strings and message-like objects", () => {
    const e = new TypeError("bad thing");
    expect(errorParts(e)).toEqual({ message: "TypeError: bad thing", stack: e.stack });
    expect(errorParts(new Error("plain")).message).toBe("plain");
    expect(errorParts("oops")).toEqual({ message: "oops", stack: null });
    expect(errorParts({ message: "pg said no", code: "42501" })).toEqual({ message: "pg said no", stack: null });
  });
  it("never serializes arbitrary objects (could be private)", () => {
    expect(errorParts({ text: "my secret message" })).toEqual({ message: "Non-error thrown: object", stack: null });
    expect(errorParts(undefined).message).toBe("(undefined)");
    expect(errorParts(null).message).toBe("(null)");
    expect(errorParts(42).message).toBe("Non-error thrown: number");
  });
});

describe("isNoise", () => {
  it("skips cross-origin script errors, ResizeObserver loops and extensions", () => {
    expect(isNoise("Script error.", null)).toBe(true);
    expect(isNoise("ResizeObserver loop completed with undelivered notifications.", null)).toBe(true);
    expect(isNoise("x", "at chrome-extension://abc/content.js:1:1")).toBe(true);
    expect(isNoise("TypeError: x is undefined", "at https://mallowchat.vercel.app/a.js:1:1")).toBe(false);
  });
});

describe("buildErrorReport", () => {
  it("truncates and scrubs everything", () => {
    const r = buildErrorReport({
      value: Object.assign(new Error("word ".repeat(400) + " a@b.co"), { stack: "at f (a.js:1:2)\n".repeat(1000) }),
      kind: "error", path: "/channels/x?y=1", userAgent: "Mozilla/5.0 ".repeat(100),
    })!;
    expect(r.message.length).toBeLessThanOrEqual(ERROR_LIMITS.message);
    expect(r.message.length).toBeGreaterThan(ERROR_LIMITS.message - 10);
    expect(r.message).not.toContain("@");
    expect(r.stack!.length).toBeLessThanOrEqual(ERROR_LIMITS.stack);
    expect(r.userAgent!.length).toBeLessThanOrEqual(ERROR_LIMITS.userAgent);
    expect(r.path).toBe("/channels/x");
    expect(r.kind).toBe("error");
  });
  it("adds a valid Next.js digest and drops a weird one", () => {
    expect(buildErrorReport({ value: new Error("Server render failed"), kind: "boundary", path: "/", digest: "123456789" })!.message)
      .toBe("Server render failed [digest 123456789]");
    expect(buildErrorReport({ value: new Error("x"), kind: "boundary", path: "/", digest: "a b <c>" })!.message).toBe("x");
  });
  it("returns null for noise", () => {
    expect(buildErrorReport({ value: "Script error.", kind: "error", path: "/" })).toBeNull();
    expect(buildErrorReport({ value: "   ", kind: "error", path: "/" })).toBeNull();
  });
});

describe("createErrorReporter", () => {
  const rep = (message: string, path = "/a"): ErrorReport => ({ message, stack: null, path, userAgent: null, kind: "error" });

  it("drops a repeat within the window, sends it again after", () => {
    let t = 0;
    const send = vi.fn().mockResolvedValue(undefined);
    const r = createErrorReporter({ send, now: () => t, windowMs: 1000 });
    expect(r.report(rep("x"))).toBe(true);
    expect(r.report(rep("x"))).toBe(false);
    expect(r.report(rep("x", "/b"))).toBe(true); // other page = other error
    t = 1000;
    expect(r.report(rep("x"))).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("stops after maxPerPage", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const r = createErrorReporter({ send, maxPerPage: 3 });
    for (let i = 0; i < 10; i++) r.report(rep(`e${i}`));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("swallows send failures (sync and async) without retrying", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    const r = createErrorReporter({ send: failing });
    expect(r.report(rep("x"))).toBe(true);
    await Promise.resolve();
    expect(r.report(rep("x"))).toBe(false);
    const throwing = createErrorReporter({ send: () => { throw new Error("sync"); } });
    expect(() => throwing.report(rep("y"))).not.toThrow();
  });

  it("errorKey groups by page + message", () => {
    expect(errorKey(rep("x", "/a"))).toBe(errorKey(rep("x", "/a")));
    expect(errorKey(rep("x", "/a"))).not.toBe(errorKey(rep("x", "/b")));
  });
});
