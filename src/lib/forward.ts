import type { Message, ForwardSnapshot } from "@/types/db";

/** Freeze the display-relevant fields of `original` into a forward snapshot.
 *  Snapshots the outer message's own fields — forwarding a forward does not nest. */
export function buildForwardSnapshot(original: Message, sourceLabel: string): ForwardSnapshot {
  return {
    author_id: original.author_id,
    content: original.content ?? "",
    image_url: original.image_url,
    file_url: original.file_url,
    file_name: original.file_name,
    source: sourceLabel,
  };
}
