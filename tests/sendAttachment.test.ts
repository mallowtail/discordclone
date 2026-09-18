import { describe, it, expect, vi, beforeEach } from "vitest";

// uploadImage/uploadFile create their own Supabase client internally, so mock the upload module.
vi.mock("@/lib/upload", () => ({
  isImageType: (t: string) => t.startsWith("image/"),
  uploadImage: vi.fn(),
  uploadFile: vi.fn(),
}));

import { uploadImage, uploadFile } from "@/lib/upload";
import { uploadAndPostFile } from "@/lib/sendAttachment";
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
