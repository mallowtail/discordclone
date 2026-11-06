import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/lib/imageOptimize";
import { ATTACHMENT_MAX_DIM, ICON_MAX_DIM, extensionForType } from "@/lib/imagePlan";

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

/**
 * Shared image upload: reject non-image types up front, then resize/re-save in the browser
 * (optimizeImage — strips EXIF/GPS too), and only then apply the 5 MB limit, so a large phone photo
 * that shrinks below it is accepted.
 */
async function uploadImageTo(bucket: string, file: File, maxDim: number): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED.includes(file.type)) return { error: "Only PNG, JPEG, GIF, or WebP images" };
  const prepared = await optimizeImage(file, maxDim);
  const check = validateImage(prepared);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const path = `${crypto.randomUUID()}.${extensionForType(prepared.type)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, prepared, { contentType: prepared.type });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl };
}

export function uploadImage(file: File) {
  return uploadImageTo("attachments", file, ATTACHMENT_MAX_DIM);
}

export function uploadAvatar(file: File) {
  return uploadImageTo("avatars", file, ICON_MAX_DIM);
}

export function uploadServerIcon(file: File) {
  return uploadImageTo("server-icons", file, ICON_MAX_DIM);
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
    // Force a non-executable content-type: files land in a PUBLIC bucket, so serving
    // client-declared types (e.g. text/html, image/svg+xml) would be a stored-XSS vector.
    .upload(path, file, { contentType: "application/octet-stream" });
  if (error) return { error: `Upload failed: ${error.message}` };
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, name: file.name };
}
