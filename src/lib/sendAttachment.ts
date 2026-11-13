import type { SupabaseClient } from "@supabase/supabase-js";
import type { Message } from "@/types/db";
import { uploadImage, uploadFile, isImageType } from "@/lib/upload";
import { sendErrorMessage } from "@/lib/validation";

export type Target = { channel_id: string } | { conversation_id: string };

/** Upload a file (image → inline image_url, else → file_url/file_name) and post an
 *  optimistic message. Shared by the composer's + menu and the drop zone. */
export async function uploadAndPostFile(opts: {
  supabase: SupabaseClient;
  userId: string;
  target: Target;
  file: File;
  content?: string;
  replyFields?: Record<string, unknown>;
  addPending: (m: Message) => void;
  removePending: (id: string) => void;
}): Promise<{ error?: string }> {
  const { supabase, userId, target, file, content = "", replyFields = {}, addPending, removePending } = opts;
  let attach: { image_url?: string; file_url?: string; file_name?: string };
  if (isImageType(file.type)) {
    const res = await uploadImage(file);
    if ("error" in res) return { error: res.error };
    attach = { image_url: res.url };
  } else {
    const res = await uploadFile(file);
    if ("error" in res) return { error: res.error };
    attach = { file_url: res.url, file_name: res.name };
  }
  const id = crypto.randomUUID();
  const optimistic: Message = {
    id,
    author_id: userId,
    channel_id: "channel_id" in target ? target.channel_id : null,
    conversation_id: "conversation_id" in target ? target.conversation_id : null,
    content,
    image_url: attach.image_url ?? null,
    file_url: attach.file_url ?? null,
    file_name: attach.file_name ?? null,
    created_at: new Date().toISOString(),
    updated_at: null,
    reply_to_id: (replyFields.reply_to_id as string) ?? null,
    mention_author: (replyFields.mention_author as boolean) ?? false,
    pinned: false,
    pinned_at: null,
    forward_snapshot: null,
    pending: true,
  };
  addPending(optimistic);
  const { error } = await supabase
    .from("messages")
    .insert({ id, author_id: userId, content, ...attach, ...replyFields, ...target });
  if (error) {
    removePending(id);
    return { error: sendErrorMessage(error.message) };
  }
  return {};
}

/** Upload and post several files one after another, so they land in the order picked. The caption
 *  and reply ride on the first file that posts; a failure doesn't stop the rest. Errors name the file. */
export async function uploadAndPostFiles(
  opts: Omit<Parameters<typeof uploadAndPostFile>[0], "file"> & { files: File[] }
): Promise<{ posted: number; errors: string[] }> {
  const { files, content, replyFields, ...rest } = opts;
  let posted = 0;
  const errors: string[] = [];
  for (const file of files) {
    const first = posted === 0;
    const res = await uploadAndPostFile({
      ...rest,
      file,
      content: first ? content : "",
      replyFields: first ? replyFields : {},
    });
    if (res.error) errors.push(`${file.name}: ${res.error}`);
    else posted += 1;
  }
  return { posted, errors };
}
