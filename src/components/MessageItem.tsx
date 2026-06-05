import type { Message } from "@/types/db";
import { formatTime } from "@/lib/format";

export function MessageItem({
  msg,
  authorName,
  showHeader,
}: {
  msg: Message;
  authorName: string;
  showHeader: boolean;
}) {
  return (
    <div className={`px-4 hover:bg-black/10 ${showHeader ? "mt-3 pt-0.5" : ""}`}>
      {showHeader && (
        <div>
          <span className="font-semibold text-white">{authorName}</span>
          <span className="text-xs text-[#949ba4] ml-2">{formatTime(msg.created_at)}</span>
        </div>
      )}
      <div className="text-[#dbdee1] whitespace-pre-wrap break-words">{msg.content}</div>
    </div>
  );
}
