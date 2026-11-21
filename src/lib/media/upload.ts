import { createClient } from "@/lib/supabase/client";
import { optimizeImage } from "@/lib/media/imageOptimize";
import { ATTACHMENT_MAX_DIM, ICON_MAX_DIM, extensionForType } from "@/lib/media/imagePlan";
import { chunkIds } from "@/lib/messages/reactions";
import { parseUploadStatus, uploadBlockedMessage, uploadFailedMessage, type UploadStatus } from "@/lib/media/uploadLimits";

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

/** `upload_status()` for the signed-in person, or null when it can't be read (then Storage decides). */
async function readUploadStatus(): Promise<UploadStatus | null> {
  try {
    const { data, error } = await createClient().rpc("upload_status");
    return error ? null : parseUploadStatus(data);
  } catch {
    return null;
  }
}

/**
 * Checked before every upload (all four buckets): the daily-limit or storage-paused message when
 * the database would refuse it, else null. The database enforces it either way.
 */
export async function uploadLimitProblem(): Promise<string | null> {
  return uploadBlockedMessage(await readUploadStatus());
}

/**
 * Words for a failed Storage upload. A limit refusal arrives as a generic error (HTTP 500 "database
 * error" from the trigger, or an RLS 403), so `upload_status()` is read again to tell which.
 */
export async function uploadFailureMessage(fallback: string): Promise<string> {
  return uploadFailedMessage(await readUploadStatus(), fallback);
}

/**
 * Shared image upload: reject non-image types up front, then resize/re-save in the browser
 * (optimizeImage — strips EXIF/GPS too), and only then apply the 5 MB limit, so a large phone photo
 * that shrinks below it is accepted.
 */
async function uploadImageTo(
  bucket: string, file: File, maxDim: number, folder?: string,
): Promise<{ url: string } | { error: string }> {
  if (!ALLOWED.includes(file.type)) return { error: "Only PNG, JPEG, GIF, or WebP images" };
  const blocked = await uploadLimitProblem();
  if (blocked) return { error: blocked };
  const prepared = await optimizeImage(file, maxDim);
  const check = validateImage(prepared);
  if (!check.ok) return { error: check.error };
  const supabase = createClient();
  const name = `${crypto.randomUUID()}.${extensionForType(prepared.type)}`;
  const path = folder ? `${folder}/${name}` : name;
  const { error } = await supabase.storage.from(bucket).upload(path, prepared, { contentType: prepared.type });
  if (error) return { error: await uploadFailureMessage(`Upload failed: ${error.message}`) };
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl };
}

export function uploadImage(file: File) {
  return uploadImageTo("attachments", file, ATTACHMENT_MAX_DIM);
}

export function uploadAvatar(file: File) {
  return uploadImageTo("avatars", file, ICON_MAX_DIM);
}

/** A server's icon goes in that server's folder; storage only lets icon managers of it upload there. */
export function uploadServerIcon(serverId: string, file: File) {
  return uploadImageTo("server-icons", file, ICON_MAX_DIM, serverId);
}

/** True if a MIME type is one of the inline-rendered image types. */
export function isImageType(type: string): boolean {
  return ALLOWED.includes(type);
}

/** Upload any file to the attachments bucket. Returns its public URL + original name. */
export async function uploadFile(file: File): Promise<{ url: string; name: string } | { error: string }> {
  if (file.size > FILE_MAX_BYTES) return { error: "File must be 25 MB or smaller" };
  const blocked = await uploadLimitProblem();
  if (blocked) return { error: blocked };
  const supabase = createClient();
  const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("attachments")
    // Force a non-executable content-type: files land in a PUBLIC bucket, so serving
    // client-declared types (e.g. text/html, image/svg+xml) would be a stored-XSS vector.
    .upload(path, file, { contentType: "application/octet-stream" });
  if (error) return { error: await uploadFailureMessage(`Upload failed: ${error.message}`) };
  const { data } = supabase.storage.from("attachments").getPublicUrl(path);
  return { url: data.publicUrl, name: file.name };
}

/**
 * What went wrong with a Storage remove, or null when every file went. Storage reports success
 * even when its delete rules let nothing through, so the removed list is compared to the request.
 */
export function removalProblem(
  paths: string[],
  result: { data: { name: string }[] | null; error: { message: string } | null },
): string | null {
  if (result.error) return result.error.message;
  const removed = new Set((result.data ?? []).map((f) => f.name));
  const missing = paths.filter((p) => !removed.has(p));
  return missing.length > 0 ? `not removed: ${missing.join(", ")}` : null;
}

/** Most paths Storage accepts in one remove() call. */
export const STORAGE_REMOVE_BATCH = 1000;

/** The paths of one remove() call that are still there (all of them when the call failed). */
export function notRemoved(
  paths: string[],
  result: { data: { name: string }[] | null; error: { message: string } | null },
): string[] {
  if (result.error) return [...paths];
  const removed = new Set((result.data ?? []).map((f) => f.name));
  return paths.filter((p) => !removed.has(p));
}

/**
 * Remove files in batches of at most STORAGE_REMOVE_BATCH, best effort: a failure is logged,
 * never thrown (it mustn't block a deletion). Returns the paths that are still there.
 */
export async function removeStorageFilesReporting(bucket: string, paths: string[]): Promise<string[]> {
  const batches = chunkIds([...new Set(paths)], STORAGE_REMOVE_BATCH);
  const left = await Promise.all(batches.map(async (batch) => {
    try {
      const result = await createClient().storage.from(bucket).remove(batch);
      const problem = removalProblem(batch, result);
      if (problem) console.error(`Couldn't remove ${bucket} files (${problem})`);
      return notRemoved(batch, result);
    } catch (e) {
      console.error(`Couldn't remove ${bucket} files (${e instanceof Error ? e.message : "network"})`);
      return batch;
    }
  }));
  return left.flat();
}

/** Remove files, best effort (see removeStorageFilesReporting). True when every file went. */
export async function removeStorageFiles(bucket: string, paths: string[]): Promise<boolean> {
  return (await removeStorageFilesReporting(bucket, paths)).length === 0;
}
