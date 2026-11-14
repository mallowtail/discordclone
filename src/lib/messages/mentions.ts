// Matches @username not preceded by a word char (so emails like a@b don't match).
const MENTION_RE = /(?<![a-zA-Z0-9_])@([a-zA-Z0-9_]{2,32})/g;

export function extractMentions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) out.push(m[1]);
  return out;
}

export function mentionsMe(opts: {
  content: string;
  myUsername: string | null;
  myId: string | null;
  replyToId: string | null;
  mentionAuthor: boolean;
  repliedToAuthorId: string | null;
}): boolean {
  const { content, myUsername, myId, replyToId, mentionAuthor, repliedToAuthorId } = opts;
  if (myUsername) {
    const lower = myUsername.toLowerCase();
    if (extractMentions(content).some((u) => u.toLowerCase() === lower)) return true;
  }
  if (replyToId && mentionAuthor && myId && repliedToAuthorId === myId) return true;
  return false;
}

// remark plugin: turn @username text into a link node with a `mention:` url,
// which MessageContent renders as a styled pill. Skips code (code nodes hold
// their text in `value`, not child text nodes, so they're never visited here).
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] };

export function remarkMentions() {
  return (tree: MdNode) => {
    walk(tree);
  };
}

function walk(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value) {
      next.push(...splitText(child.value));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(MENTION_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: "text", value: value.slice(last, idx) });
    out.push({ type: "link", url: `mention:${m[1]}`, children: [{ type: "text", value: `@${m[1]}` }] });
    last = idx + m[0].length;
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) });
  return out.length ? out : [{ type: "text", value }];
}
