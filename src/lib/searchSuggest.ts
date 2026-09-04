export type SuggestKind =
  | "operator" | "from" | "mentions" | "in" | "has" | "pinned" | "date" | null;

export function activeToken(raw: string, caret: number): { token: string; start: number; end: number } {
  let start = caret;
  let end = caret;
  while (start > 0 && !/\s/.test(raw[start - 1])) start--;
  while (end < raw.length && !/\s/.test(raw[end])) end++;
  return { token: raw.slice(start, end), start, end };
}

export function suggestKind(token: string): { kind: SuggestKind; partial: string } {
  const idx = token.indexOf(":");
  if (idx <= 0) return { kind: "operator", partial: token };
  const key = token.slice(0, idx).toLowerCase();
  const val = token.slice(idx + 1);
  switch (key) {
    case "from": return { kind: "from", partial: val.replace(/^@/, "") };
    case "mentions": return { kind: "mentions", partial: val.replace(/^@/, "") };
    case "in": return { kind: "in", partial: val.replace(/^#/, "") };
    case "has": return { kind: "has", partial: val };
    case "pinned": return { kind: "pinned", partial: val };
    case "before":
    case "after":
    case "during": return { kind: "date", partial: val };
    default: return { kind: null, partial: val };
  }
}

export function applySuggestion(
  raw: string, caret: number, value: string
): { raw: string; caret: number } {
  const { start, end } = activeToken(raw, caret);
  return { raw: raw.slice(0, start) + value + raw.slice(end), caret: start + value.length };
}
