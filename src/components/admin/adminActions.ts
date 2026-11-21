"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { removeStorageFiles } from "@/lib/media/upload";
import {
  adminDeleteMessageErrorMessage, adminDeleteServerErrorMessage, filesByBucket, type StorageFileRow,
} from "@/lib/admin/admin";

/**
 * Remove the files a deletion handed back (Supabase won't let SQL delete Storage objects, so the
 * database returns `(bucket, path)` rows and the admin's own Storage policies let us remove them).
 * Best effort: true when everything went.
 */
export async function removeReturnedFiles(rows: unknown): Promise<boolean> {
  const groups = filesByBucket(Array.isArray(rows) ? (rows as StorageFileRow[]) : []);
  const results = await Promise.all([...groups].map(([bucket, paths]) => removeStorageFiles(bucket, paths)));
  return results.every(Boolean);
}

/** `admin_delete_message` + its files. Returns an error to show, or null. */
export async function adminDeleteMessage(supabase: SupabaseClient, messageId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("admin_delete_message", { msg: messageId });
  if (error) return adminDeleteMessageErrorMessage(error.message);
  await removeReturnedFiles(data);
  return null;
}

/**
 * `admin_delete_server` + its icon and sticker files. If the admin is in one of its voice channels,
 * they leave first (the room is going away). Returns an error to show, or null.
 */
export async function adminDeleteServer(
  supabase: SupabaseClient,
  serverId: string,
  voice: { room: string | null; leave: () => Promise<void> },
): Promise<string | null> {
  if (voice.room?.startsWith("ch_")) {
    const { data: ch } = await supabase.from("channels").select("server_id").eq("id", voice.room.slice(3)).maybeSingle();
    if (ch?.server_id === serverId) await voice.leave();
  }
  const { data, error } = await supabase.rpc("admin_delete_server", { srv: serverId });
  if (error) return adminDeleteServerErrorMessage(error.message);
  await removeReturnedFiles(data);
  return null;
}

/** Ask the server to drop a just-banned person from every voice room. True when it worked. */
export async function removeFromVoice(userId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/ban-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: userId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
