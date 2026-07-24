import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const FILE_MAX_BYTES = 25 * 1024 * 1024;

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

export async function uploadAvatar(file: File): Promise<{ url: string } | { error: string }> {
  const check = validateImage(file);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return { url: data.publicUrl };
}

export async function uploadServerIcon(file: File): Promise<{ url: string } | { error: string }> {
  const check = validateImage(file);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("server-icons")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("server-icons").getPublicUrl(path);
  return { url: data.publicUrl };
}

/** True if a MIME type is one of the inline-rendered image types. */
export function isImageType(type: string): boolean {
  return ALLOWED.includes(type);
}

/** Upload any file to the attachments bucket. Returns its public URL + original name. */
export async function uploadFile(file: File): Promise<{ url: string; name: string } | { error: string }> {
  if (file.size > FILE_MAX_BYTES) return { error: "File must be 25 MB or smaller" };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, name: file.name };
}
