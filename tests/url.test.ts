import { describe, expect, it } from "vitest";
import { isHttpUrl, withDownloadName } from "@/lib/url";

describe("withDownloadName", () => {
  it("appends ?download=<name> when the url has no existing query", () => {
    expect(withDownloadName("http://x/a.bin", "My File.pdf")).toBe(
      "http://x/a.bin?download=My%20File.pdf",
    );
  });

  it("appends &download=<name> when the url already has a query", () => {
    expect(withDownloadName("http://x/a.bin?token=1", "n.pdf")).toBe(
      "http://x/a.bin?token=1&download=n.pdf",
    );
  });

  it("percent-encodes special characters in the name", () => {
    expect(withDownloadName("http://x/a.bin", "a b&c.pdf")).toBe(
      "http://x/a.bin?download=a%20b%26c.pdf",
    );
  });

  it("returns the url unchanged when name is null", () => {
    expect(withDownloadName("http://x/a.bin", null)).toBe("http://x/a.bin");
  });
});

describe("isHttpUrl", () => {
  it("accepts http and https urls", () => {
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("https://example.com")).toBe(true);
  });

  it("rejects non-http protocols and invalid urls", () => {
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});
