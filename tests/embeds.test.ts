import { describe, it, expect } from "vitest";
import { extractLinks, detectEmbed, withParent, isShortLink } from "@/lib/messages/embeds";

describe("extractLinks", () => {
  it("finds up to 3 distinct links, trimming trailing punctuation", () => {
    expect(extractLinks("look https://a.com/x, and https://b.com/y. also (https://c.com) https://d.com https://a.com/x"))
      .toEqual(["https://a.com/x", "https://b.com/y", "https://c.com"]);
  });
  it("ignores links inside code", () => {
    expect(extractLinks("`https://a.com` and\n```\nhttps://b.com\n```\nhttps://c.com")).toEqual(["https://c.com"]);
  });
  it("handles markdown links and empty text", () => {
    expect(extractLinks("[site](https://a.com/page)")).toEqual(["https://a.com/page"]);
    expect(extractLinks("")).toEqual([]);
  });
});

describe("detectEmbed", () => {
  it("YouTube: watch, short link, shorts, start time", () => {
    expect(detectEmbed("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      provider: "youtube", shape: "video", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1",
    });
    expect(detectEmbed("https://youtu.be/dQw4w9WgXcQ?t=42")?.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=42");
    expect(detectEmbed("https://youtube.com/shorts/dQw4w9WgXcQ")).toMatchObject({ provider: "youtube", shape: "vertical" });
    expect(detectEmbed("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s")?.src).toContain("start=65");
    expect(detectEmbed("https://www.youtube.com/@somechannel")).toBeNull();
  });
  it("Twitch: channel, past broadcast, clip — all need the page's hostname as parent", () => {
    expect(detectEmbed("https://www.twitch.tv/somestreamer")).toMatchObject({
      provider: "twitch", needsParent: true, src: "https://player.twitch.tv/?channel=somestreamer&autoplay=true",
    });
    expect(detectEmbed("https://twitch.tv/videos/123456789")?.src).toBe("https://player.twitch.tv/?video=v123456789&autoplay=true");
    expect(detectEmbed("https://www.twitch.tv/somestreamer/clip/FunnyClipSlug-abc123")?.src)
      .toBe("https://clips.twitch.tv/embed?clip=FunnyClipSlug-abc123&autoplay=true");
    expect(detectEmbed("https://clips.twitch.tv/FunnyClipSlug")?.provider).toBe("twitch");
    expect(detectEmbed("https://www.twitch.tv/directory")).toBeNull();
  });
  it("TikTok, Instagram, Vimeo", () => {
    expect(detectEmbed("https://www.tiktok.com/@someone/video/7312345678901234567?lang=en")).toMatchObject({
      provider: "tiktok", shape: "vertical", src: "https://www.tiktok.com/player/v1/7312345678901234567?autoplay=1",
    });
    expect(detectEmbed("https://www.instagram.com/reel/C1a2B3c4D5e/?igsh=x")).toMatchObject({
      provider: "instagram", shape: "instagram", src: "https://www.instagram.com/reel/C1a2B3c4D5e/embed/",
    });
    expect(detectEmbed("https://instagram.com/p/C1a2B3c4D5e")?.src).toBe("https://www.instagram.com/p/C1a2B3c4D5e/embed/");
    expect(detectEmbed("https://vimeo.com/76979871")?.src).toBe("https://player.vimeo.com/video/76979871?autoplay=1");
  });
  it("Spotify and SoundCloud players", () => {
    expect(detectEmbed("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc")).toMatchObject({
      provider: "spotify", shape: "audio", src: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC",
    });
    expect(detectEmbed("https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M")).toMatchObject({ shape: "audio-tall" });
    expect(detectEmbed("https://soundcloud.com/artist/some-track")).toMatchObject({
      provider: "soundcloud", shape: "audio",
      src: "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsome-track&auto_play=true",
    });
    expect(detectEmbed("https://soundcloud.com/artist")).toBeNull();
  });
  it("ignores everything else, lookalike domains included", () => {
    expect(detectEmbed("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(detectEmbed("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(detectEmbed("not a url")).toBeNull();
  });
});

describe("isShortLink / withParent", () => {
  it("spots TikTok short links that the server must resolve first", () => {
    expect(isShortLink("https://vm.tiktok.com/ZMabc123/")).toBe(true);
    expect(isShortLink("https://www.tiktok.com/t/ZTabc123/")).toBe(true);
    expect(isShortLink("https://www.tiktok.com/@a/video/7312345678901234567")).toBe(false);
  });
  it("adds Twitch's required parent", () => {
    expect(withParent("https://player.twitch.tv/?channel=x&autoplay=true", "chat.example.app"))
      .toBe("https://player.twitch.tv/?channel=x&autoplay=true&parent=chat.example.app");
  });
});
