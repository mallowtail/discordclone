import { describe, expect, it } from "vitest";
import { isHttpUrl, storagePathFromPublicUrl, withDownloadName } from "@/lib/media/url";

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

describe("storagePathFromPublicUrl", () => {
  const base = "https://proj.supabase.co/storage/v1/object/public";
  it("returns the file name inside the bucket", () => {
    expect(storagePathFromPublicUrl(`${base}/avatars/0b1c-2d.webp`, "avatars")).toBe("0b1c-2d.webp");
    expect(storagePathFromPublicUrl(`${base}/server-icons/abc.png`, "server-icons")).toBe("abc.png");
  });
  it("keeps one folder (server icons live in <server_id>/<file>)", () => {
    const id = "384e1623-bd60-4157-91a1-b55c69bc0353";
    expect(storagePathFromPublicUrl(`${base}/server-icons/${id}/abc.png`, "server-icons")).toBe(`${id}/abc.png`);
  });
  it("is null for another bucket, an outside URL, deeper paths or nothing", () => {
    expect(storagePathFromPublicUrl(`${base}/attachments/x.png`, "avatars")).toBeNull();
    expect(storagePathFromPublicUrl("https://cdn.discordapp.com/avatars/1/2.png", "avatars")).toBeNull();
    expect(storagePathFromPublicUrl(`${base}/avatars/a/b/c.png`, "avatars")).toBeNull();
    expect(storagePathFromPublicUrl(`${base}/avatars/../b.png`, "avatars")).toBeNull();
    expect(storagePathFromPublicUrl(`${base}/avatars/`, "avatars")).toBeNull();
    expect(storagePathFromPublicUrl("not a url", "avatars")).toBeNull();
    expect(storagePathFromPublicUrl(null, "avatars")).toBeNull();
  });
});
