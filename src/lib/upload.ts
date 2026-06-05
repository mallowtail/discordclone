import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type UploadCheck = { ok: true } | { ok: false; error: string };

export function validateImage(file: { type: string; size: number }): UploadCheck {
  if (!ALLOWED.includes(file.type)) {
    return { ok: false, error: "Only PNG, JPEG, GIF, or WebP images" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Image must be 5 MB or smaller" };
  }
  return { ok: true };
}

export async function uploadImage(file: File): Promise<{ url: string } | { error: string }> {
  const check = validateImage(file);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl };
}
