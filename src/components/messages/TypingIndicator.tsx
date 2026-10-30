import { formatTyping } from "@/lib/typing";

/** One-line "X is typing..." above the composer. Always rendered so the composer never jumps. */
export function TypingIndicator({ names }: { names: string[] }) {
  return (
    <div className="h-5 px-4 text-meta text-muted truncate" aria-live="polite">
      {formatTyping(names)}
    </div>
  );
}
