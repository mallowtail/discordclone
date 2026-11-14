import { describe, it, expect, vi, beforeEach } from "vitest";

// uploadImage/uploadFile create their own Supabase client internally, so mock the upload module.
vi.mock("@/lib/media/upload", () => ({
  isImageType: (t: string) => t.startsWith("image/"),
  uploadImage: vi.fn(),
  uploadFile: vi.fn(),
}));

import { uploadImage, uploadFile } from "@/lib/media/upload";
import { uploadAndPostFile, uploadAndPostFiles } from "@/lib/messages/sendAttachment";
import { fakeSupabase } from "./_fakeSupabase";

const img = new File(["x"], "pic.png", { type: "image/png" });
const doc = new File(["x"], "notes.pdf", { type: "application/pdf" });

beforeEach(() => {
  vi.mocked(uploadImage).mockReset();
  vi.mocked(uploadFile).mockReset();
});

describe("uploadAndPostFile", () => {
  it("uploads an image, posts an optimistic message, and inserts it", async () => {
    vi.mocked(uploadImage).mockResolvedValue({ url: "https://cdn/pic.png" });
    const { supabase, calls } = fakeSupabase(() => ({ error: null }));
    const added: string[] = [];
    const removed: string[] = [];

    const res = await uploadAndPostFile({
      supabase,
      userId: "me",
      target: { channel_id: "chan1" },
      file: img,
      addPending: (m) => added.push(m.id),
      removePending: (id) => removed.push(id),
    });

    expect(res).toEqual({});
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
    const insert = calls.find((c) => c.table === "messages" && c.method === "insert");
    expect(insert?.payload).toMatchObject({ author_id: "me", image_url: "https://cdn/pic.png", channel_id: "chan1" });
  });

  it("uploads a non-image as a file attachment", async () => {
    vi.mocked(uploadFile).mockResolvedValue({ url: "https://cdn/notes.pdf", name: "notes.pdf" });
    const { supabase, calls } = fakeSupabase(() => ({ error: null }));
    const res = await uploadAndPostFile({
      supabase,
      userId: "me",
      target: { conversation_id: "dm1" },
      file: doc,
      addPending: () => {},
      removePending: () => {},
    });
    expect(res).toEqual({});
    const insert = calls.find((c) => c.table === "messages" && c.method === "insert");
    expect(insert?.payload).toMatchObject({ file_url: "https://cdn/notes.pdf", file_name: "notes.pdf", conversation_id: "dm1" });
  });

  it("returns the upload error and never inserts when the upload fails", async () => {
    vi.mocked(uploadImage).mockResolvedValue({ error: "Upload failed" });
    const { supabase, calls } = fakeSupabase(() => ({ error: null }));
    const added: string[] = [];
    const res = await uploadAndPostFile({
      supabase,
      userId: "me",
      target: { channel_id: "chan1" },
      file: img,
      addPending: (m) => added.push(m.id),
      removePending: () => {},
    });
    expect(res).toEqual({ error: "Upload failed" });
    expect(added).toHaveLength(0);
    expect(calls.some((c) => c.method === "insert")).toBe(false);
  });

  it("rolls back the optimistic message when the insert fails", async () => {
    vi.mocked(uploadImage).mockResolvedValue({ url: "https://cdn/pic.png" });
    const { supabase } = fakeSupabase(() => ({ error: { message: "db down" } }));
    const added: string[] = [];
    const removed: string[] = [];
    const res = await uploadAndPostFile({
      supabase,
      userId: "me",
      target: { channel_id: "chan1" },
      file: img,
      addPending: (m) => added.push(m.id),
      removePending: (id) => removed.push(id),
    });
    expect(res).toEqual({ error: "Failed to send — try again" });
    expect(added).toHaveLength(1);
    expect(removed).toEqual(added); // the pending row it added is the one it removed
  });
});

describe("uploadAndPostFiles", () => {
  const a = new File(["x"], "a.png", { type: "image/png" });
  const b = new File(["x"], "b.png", { type: "image/png" });
  const c = new File(["x"], "c.png", { type: "image/png" });

  it("posts every file in order, with the caption and reply only on the first", async () => {
    vi.mocked(uploadImage).mockImplementation(async (f: File) => ({ url: `https://cdn/${f.name}` }));
    const { supabase, calls } = fakeSupabase(() => ({ error: null }));
    const res = await uploadAndPostFiles({
      supabase, userId: "me", target: { channel_id: "chan1" }, files: [a, b, c],
      content: "look", replyFields: { reply_to_id: "m1" }, addPending: () => {}, removePending: () => {},
    });
    expect(res).toEqual({ posted: 3, errors: [] });
    const inserts = calls.filter((x) => x.method === "insert").map((x) => x.payload as Record<string, unknown>);
    expect(inserts.map((p) => p.image_url)).toEqual(["https://cdn/a.png", "https://cdn/b.png", "https://cdn/c.png"]);
    expect(inserts[0]).toMatchObject({ content: "look", reply_to_id: "m1" });
    expect(inserts[1].content).toBe("");
    expect(inserts[1].reply_to_id).toBeUndefined();
  });

  it("keeps going after a failure, names the failed file, and moves the caption to the next success", async () => {
    vi.mocked(uploadImage).mockImplementation(async (f: File) =>
      f.name === "a.png" ? { error: "Image must be 5 MB or smaller" } : { url: `https://cdn/${f.name}` });
    const { supabase, calls } = fakeSupabase(() => ({ error: null }));
    const res = await uploadAndPostFiles({
      supabase, userId: "me", target: { channel_id: "chan1" }, files: [a, b],
      content: "look", addPending: () => {}, removePending: () => {},
    });
    expect(res).toEqual({ posted: 1, errors: ["a.png: Image must be 5 MB or smaller"] });
    const inserts = calls.filter((x) => x.method === "insert").map((x) => x.payload as Record<string, unknown>);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ image_url: "https://cdn/b.png", content: "look" });
  });
});
