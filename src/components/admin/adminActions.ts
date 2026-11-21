"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { removeStorageFilesReporting } from "@/lib/media/upload";
import {
  adminDeleteMessageErrorMessage, adminDeleteServerErrorMessage, filesByBucket, voiceRemovalOk, type StorageFileRow,
} from "@/lib/admin/admin";

/**
 * Remove the files a deletion handed back (Supabase won't let SQL delete Storage objects, so the
 * database returns `(bucket, path)` rows and the admin's own Storage policies let us remove them).
 * Best effort: returns the rows still in Storage (empty when everything went), to retry later.
 */
export async function removeReturnedFiles(rows: unknown): Promise<StorageFileRow[]> {
  const groups = filesByBucket(Array.isArray(rows) ? (rows as StorageFileRow[]) : []);
  const left = await Promise.all([...groups].map(async ([bucket, paths]) =>
    (await removeStorageFilesReporting(bucket, paths)).map((path) => ({ bucket, path }))));
  return left.flat();
}

/** What an admin deletion gives back: an error to show (nothing was deleted), or the files left over. */
export type AdminDeleteResult = { error: string } | { error: null; filesLeft: StorageFileRow[] };

/** `admin_delete_message` + its files. */
export async function adminDeleteMessage(supabase: SupabaseClient, messageId: string): Promise<AdminDeleteResult> {
  const { data, error } = await supabase.rpc("admin_delete_message", { msg: messageId });
  if (error) return { error: adminDeleteMessageErrorMessage(error.message) };
  return { error: null, filesLeft: await removeReturnedFiles(data) };
}

/**
 * `admin_delete_server` + its icon and sticker files. If the admin is in one of its voice channels,
 * they leave first (the room is going away).
 */
export async function adminDeleteServer(
  supabase: SupabaseClient,
  serverId: string,
  voice: { room: string | null; leave: () => Promise<void> },
): Promise<AdminDeleteResult> {
  if (voice.room?.startsWith("ch_")) {
    const { data: ch } = await supabase.from("channels").select("server_id").eq("id", voice.room.slice(3)).maybeSingle();
    if (ch?.server_id === serverId) await voice.leave();
  }
  const { data, error } = await supabase.rpc("admin_delete_server", { srv: serverId });
  if (error) return { error: adminDeleteServerErrorMessage(error.message) };
  return { error: null, filesLeft: await removeReturnedFiles(data) };
}

/** Ask the server to drop a just-banned person from every voice room. True when it fully worked. */
export async function removeFromVoice(userId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/ban-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: userId }),
    });
    return voiceRemovalOk(res.status, await res.json().catch(() => null));
  } catch {
    return false;
  }
}
