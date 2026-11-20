import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import type { Message } from "@/types/db";
import { remarkMentions } from "@/lib/messages/mentions";
import { File } from "@phosphor-icons/react";
import { isHttpUrl, withDownloadName } from "@/lib/media/url";
import { useLinkGuard } from "@/components/providers/LinkGuardProvider";
import { fitGif, isKlipyMediaUrl } from "@/lib/messages/gifs";
import { isPlainText } from "@/lib/messages/plainText";
import { GifFavoriteStar } from "@/components/messages/list/GifFavoriteStar";

// Discord-style subset. Anything not in this list renders as plain text.
const ALLOWED = ["p", "strong", "em", "del", "code", "pre", "blockquote", "a", "ul", "ol", "li", "br", "h1", "h2", "h3"];

/**
 * A message's body. Memoized on what it actually shows, so the whole list redrawing (author names,
 * reactions or role colours arriving) doesn't re-run the Markdown formatter for every message; and
 * plain sentences skip the formatter entirely. Both matter most when opening a chat.
 */
export const MessageContent = memo(function MessageContent({ msg }: { msg: Message }) {
  const { guard } = useLinkGuard();
  const safeImage = msg.image_url && isHttpUrl(msg.image_url) ? msg.image_url : null;
  const safeFile = msg.file_url && isHttpUrl(msg.file_url) ? msg.file_url : null;
  return (
    <div className="text-ink break-words leading-relaxed">
      {msg.content && isPlainText(msg.content) ? (
        <p>{msg.content}</p>
      ) : msg.content ? (
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
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline"
                  onClick={(e) => href && guard(e, href)} onAuxClick={(e) => href && guard(e, href)}>
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
      ) : null}
      {msg.gif && isKlipyMediaUrl(msg.gif.url) && (() => {
        // Sized from the stored dimensions so the chat doesn't jump while it loads.
        const box = fitGif(msg.gif.width, msg.gif.height, 300, 300);
        return (
          <span className="group relative mt-1 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- KLIPY media must load directly from their URL */}
            <img src={msg.gif.url} alt={msg.gif.title ? `GIF: ${msg.gif.title}` : "GIF"} title={msg.gif.title || undefined}
              width={box.width} height={box.height} loading="lazy"
              className="block rounded-control bg-surface-2" style={{ width: box.width, height: box.height }} />
            <GifFavoriteStar gif={msg.gif} />
          </span>
        );
      })()}
      {safeImage && (
        <a href={safeImage} target="_blank" rel="noopener noreferrer">
          <span className="mt-1 block h-80 max-w-sm overflow-hidden rounded-control bg-surface-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={safeImage} alt="attachment" className="block max-h-full max-w-full object-contain" />
          </span>
        </a>
      )}
      {safeFile && (
        <a
          href={withDownloadName(safeFile, msg.file_name)}
          download={msg.file_name ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 max-w-sm hover:bg-surface-2"
        >
          <File size={18} aria-hidden="true" />
          <span className="text-ink text-body leading-5 truncate">{msg.file_name ?? "file"}</span>
        </a>
      )}
      {msg.updated_at && <span className="text-meta text-muted ml-1">(edited)</span>}
    </div>
  );
}, (a, b) =>
  a.msg.id === b.msg.id &&
  a.msg.content === b.msg.content &&
  a.msg.updated_at === b.msg.updated_at &&
  a.msg.image_url === b.msg.image_url &&
  a.msg.file_url === b.msg.file_url &&
  a.msg.file_name === b.msg.file_name &&
  a.msg.gif?.url === b.msg.gif?.url
);
