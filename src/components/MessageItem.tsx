import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";

export function MessageItem({ msg, authorName }: { msg: Message; authorName: string }) {
  return (
    <div className="px-4 py-1 hover:bg-black/10">
      <span className="font-semibold text-white">{authorName}</span>
      <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
      <div className="text-[#dbdee1] whitespace-pre-wrap break-words">{msg.content}</div>
    </div>
  );
}
