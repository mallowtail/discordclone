import { describe, it, expect } from "vitest";
import { isCaptchaError } from "@/lib/users/captcha";

describe("isCaptchaError", () => {
  it("spots Supabase captcha errors", () => {
    expect(isCaptchaError("captcha protection: request disallowed (timeout-or-duplicate)")).toBe(true);
    expect(isCaptchaError("Captcha verification process failed")).toBe(true);
  });
  it("ignores other errors and nothing", () => {
    expect(isCaptchaError("Invalid login credentials")).toBe(false);
    expect(isCaptchaError("")).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
    expect(isCaptchaError(undefined)).toBe(false);
  });
});
