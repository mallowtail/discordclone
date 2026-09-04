export type ParsedQuery = {
  text: string;
  from?: string;
  in?: string;
  has?: "link" | "image" | "file";
  mentions?: string;
  pinned?: boolean;
  beforeTs?: string;
  afterTs?: string;
};

export type RpcArgs = {
  text_query: string | null;
  from_user: string | null;
  in_channel: string | null;
  has_type: string | null;
  before_ts: string | null;
  after_ts: string | null;
  mentions_user: string | null;
  only_pinned: boolean;
};

// Split on whitespace, but keep "quoted phrases" as a single token (quotes stripped, marked as text).
function tokenize(raw: string): { value: string; quoted: boolean }[] {
  const out: { value: string; quoted: boolean }[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1] !== undefined) out.push({ value: m[1], quoted: true });
    else out.push({ value: m[2], quoted: false });
  }
  return out;
}

// A day/month bound. Returns { start, next-unit-start } as ISO strings, or null if invalid.
function unitBounds(value: string): { start: string; next: string } | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day) {
    const y = +day[1], mo = +day[2], d = +day[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    // Date.UTC rolls invalid days over (e.g. 2026-02-30), so round-trip check.
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { start: dt.toISOString(), next: new Date(Date.UTC(y, mo - 1, d + 1)).toISOString() };
  }
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) {
    const y = +month[1], mo = +month[2];
    if (mo < 1 || mo > 12) return null;
    return {
      start: new Date(Date.UTC(y, mo - 1, 1)).toISOString(),
      next: new Date(Date.UTC(y, mo, 1)).toISOString(),
    };
  }
  return null;
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: "" };
  const textParts: string[] = [];

  for (const tok of tokenize(raw)) {
    const idx = tok.quoted ? -1 : tok.value.indexOf(":");
    if (idx <= 0) {
      textParts.push(tok.value);
      continue;
    }
    const key = tok.value.slice(0, idx).toLowerCase();
    const val = tok.value.slice(idx + 1);
    let handled = true;
    switch (key) {
      case "from": parsed.from = val.replace(/^@/, ""); break;
      case "mentions": parsed.mentions = val.replace(/^@/, ""); break;
      case "in": parsed.in = val.replace(/^#/, ""); break;
      case "has":
        if (val === "link" || val === "image" || val === "file") parsed.has = val;
        else handled = false;
        break;
      case "pinned":
        if (val === "true" || val === "yes" || val === "1") parsed.pinned = true;
        else handled = false;
        break;
      case "before": {
        const b = unitBounds(val);
        if (b) parsed.beforeTs = b.start; else handled = false;
        break;
      }
      case "after": {
        const b = unitBounds(val);
        if (b) parsed.afterTs = b.next; else handled = false;
        break;
      }
      case "during": {
        const b = unitBounds(val);
        if (b) { parsed.afterTs = b.start; parsed.beforeTs = b.next; } else handled = false;
        break;
      }
      default: handled = false;
    }
    if (!handled) textParts.push(tok.value);
  }

  parsed.text = textParts.join(" ");
  return parsed;
}

export function toRpcArgs(p: ParsedQuery): RpcArgs {
  return {
    text_query: p.text.trim() ? p.text : null,
    from_user: p.from ?? null,
    in_channel: p.in ?? null,
    has_type: p.has ?? null,
    before_ts: p.beforeTs ?? null,
    after_ts: p.afterTs ?? null,
    mentions_user: p.mentions ?? null,
    only_pinned: p.pinned ?? false,
  };
}
