import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Message } from "@/types/db";
import { remarkMentions } from "@/lib/mentions";

// Discord-style subset. Anything not in this list renders as plain text.
const ALLOWED = ["p", "strong", "em", "del", "code", "pre", "blockquote", "a", "ul", "ol", "li", "br", "h1", "h2", "h3"];

// Only allow http(s) image URLs (image_url is column data, not RLS-validated).
function isHttpUrl(u: string): boolean {
  try {
    const proto = new URL(u).protocol;
    return proto === "http:" || proto === "https:";
  } catch {
    return false;
  }
}

export function MessageContent({ msg }: { msg: Message }) {
  const safeImage = msg.image_url && isHttpUrl(msg.image_url) ? msg.image_url : null;
  return (
    <div className="text-ink break-words">
      {msg.content && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks, remarkMentions]}
          allowedElements={ALLOWED}
          unwrapDisallowed
          urlTransform={(url) => (url.startsWith("mention:") ? url : defaultUrlTransform(url))}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("mention:")) {
                return (
                  <span className="bg-mention text-mention-ink rounded px-1 font-medium">{children}</span>
                );
              }
              return (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                  {children}
                </a>
              );
            },
            h1: ({ children }) => <h1 className="text-xl font-bold mt-1">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-bold mt-1">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-bold mt-1">{children}</h3>,
          }}
        >
          {msg.content}
        </ReactMarkdown>
      )}
      {safeImage && (
        <a href={safeImage} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={safeImage} alt="attachment" className="mt-1 max-h-80 max-w-sm rounded" />
        </a>
      )}
      {msg.updated_at && <span className="text-xs text-muted ml-1">(edited)</span>}
    </div>
  );
}
