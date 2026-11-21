// Blocked / ignored people's messages: collapsed into one row per run, like Discord.

export type HiddenKind = "block" | "ignore";

type HasAuthor = { id: string; author_id: string };

export type ListRow<M extends HasAuthor> =
  | { type: "message"; message: M }
  /** A collapsed run of hidden messages; `key` (its first message's id) is what reveals it. */
  | { type: "hidden"; kind: HiddenKind; key: string; messages: M[] }
  /** The header of a run the user chose to show; its messages follow as normal rows. */
  | { type: "revealed"; kind: HiddenKind; key: string; count: number };

/** Group consecutive messages by blocked/ignored authors (same kind) into collapsible runs. */
export function groupHiddenRuns<M extends HasAuthor>(
  messages: M[],
  kindOf: (userId: string) => HiddenKind | null,
  revealed: Set<string>
): ListRow<M>[] {
  const rows: ListRow<M>[] = [];
  let i = 0;
  while (i < messages.length) {
    const kind = kindOf(messages[i].author_id);
    if (!kind) {
      rows.push({ type: "message", message: messages[i] });
      i++;
      continue;
    }
    const run: M[] = [];
    while (i < messages.length && kindOf(messages[i].author_id) === kind) run.push(messages[i++]);
    const key = run[0].id;
    if (revealed.has(key)) {
      rows.push({ type: "revealed", kind, key, count: run.length });
      for (const message of run) rows.push({ type: "message", message });
    } else {
      rows.push({ type: "hidden", kind, key, messages: run });
    }
  }
  return rows;
}

export function hiddenLabel(kind: HiddenKind, count: number): string {
  if (kind === "block") return `${count} blocked message${count === 1 ? "" : "s"}`;
  return `${count} message${count === 1 ? "" : "s"} from someone you ignored`;
}
