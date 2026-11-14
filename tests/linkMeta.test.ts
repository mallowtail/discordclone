import { describe, it, expect } from "vitest";
import { parseHtmlMeta, isPrivateAddress, isAllowedThumbnailHost, isBlockedHostname } from "@/lib/server/linkMeta";

describe("parseHtmlMeta", () => {
  it("prefers Open Graph, falls back to <title> and meta description, decodes entities", () => {
    const html = `<html><head><title>Plain &amp; Simple</title>
      <meta name="description" content="Old &quot;desc&quot;">
      <meta content="OG Title &#8212; Ok" property="og:title" />
      <meta property='og:site_name' content='Site'>
      <meta property="og:image" content="https://cdn.example/x.jpg"></head></html>`;
    expect(parseHtmlMeta(html)).toEqual({ title: "OG Title — Ok", description: 'Old "desc"', siteName: "Site", image: "https://cdn.example/x.jpg" });
  });
  it("collapses whitespace, caps lengths, and returns nulls when missing", () => {
    const m = parseHtmlMeta(`<title>\n  Hello\n   World </title><meta name="description" content="${"x".repeat(500)}">`);
    expect(m.title).toBe("Hello World");
    expect(m.description!.length).toBeLessThanOrEqual(300);
    expect(parseHtmlMeta("<p>nothing</p>")).toEqual({ title: null, description: null, siteName: null, image: null });
  });
});

describe("isPrivateAddress", () => {
  it("blocks loopback, private, link-local, metadata and mapped addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fd12::3", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it("decodes disguised IPv6 forms that hide an IPv4 address", () => {
    for (const u of [
      "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/", // mapped (URL parsing makes the hex form)
      "http://[::127.0.0.1]/", "http://[::a00:1]/", // IPv4-compatible
      "http://[64:ff9b::a9fe:a9fe]/", // NAT64
      "http://[2002:7f00:1::]/", "http://[2002:a9fe:a9fe::1]/", // 6to4
      "http://[2001::1]/", // Teredo (embeds an obfuscated IPv4)
      "http://[0:0:0:0:0:0:0:1]/", "http://[fe80::1]/",
    ]) {
      const host = new URL(u).hostname.replace(/^\[|\]$/g, "");
      expect(isPrivateAddress(host), u).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:808:808", "2002:808:808::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("isAllowedThumbnailHost", () => {
  it("only video/music CDNs, by exact suffix", () => {
    expect(isAllowedThumbnailHost("https://i.ytimg.com/vi/x/hqdefault.jpg")).toBe(true);
    expect(isAllowedThumbnailHost("https://static-cdn.jtvnw.net/x.jpg")).toBe(true);
    expect(isAllowedThumbnailHost("https://evil-ytimg.com/x.jpg")).toBe(false);
    expect(isAllowedThumbnailHost("http://i.ytimg.com/x.jpg")).toBe(false);
    expect(isAllowedThumbnailHost("https://example.com/x.jpg")).toBe(false);
  });
});

describe("isBlockedHostname", () => {
  it("refuses private addresses written directly as the host (no DNS lookup happens for those)", () => {
    for (const u of ["http://10.0.0.1/", "http://169.254.169.254/x", "http://[::1]/", "http://0x7f000001/", "http://127.1/", "http://localhost/", "http://LOCALHOST./"]) {
      expect(isBlockedHostname(new URL(u).hostname), u).toBe(true);
    }
  });
  it("lets public addresses and ordinary names through to the DNS check", () => {
    for (const u of ["http://8.8.8.8/", "https://github.com/", "https://[2606:4700:4700::1111]/"]) {
      expect(isBlockedHostname(new URL(u).hostname), u).toBe(false);
    }
  });
});
