import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/types/db";

// Discord-style subset. Anything not in this list renders as plain text.
const ALLOWED = ["p", "strong", "em", "del", "code", "pre", "blockquote", "a", "ul", "ol", "li", "br"];

export function MessageContent({ msg }: { msg: Message }) {
  return (
    <div className="text-[#dbdee1] break-words">
      {msg.content && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          allowedElements={ALLOWED}
          unwrapDisallowed
          components={{
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#5865f2] underline">
                {children}
              </a>
            ),
          }}
        >
          {msg.content}
        </ReactMarkdown>
      )}
      {msg.image_url && (
        <a href={msg.image_url} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={msg.image_url} alt="attachment" className="mt-1 max-h-80 max-w-sm rounded" />
        </a>
      )}
      {msg.updated_at && <span className="text-xs text-[#949ba4] ml-1">(edited)</span>}
    </div>
  );
}
