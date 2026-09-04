"use client";

import type { ReactNode } from "react";
import { activeToken, suggestKind, type SuggestKind } from "@/lib/searchSuggest";
import { Avatar } from "@/components/user/Avatar";
import { Hash } from "@phosphor-icons/react";

const OPERATORS = [
  { key: "from:", hint: "messages from a user" },
  { key: "mentions:", hint: "mentions a user" },
  { key: "in:", hint: "in a channel" },
  { key: "has:", hint: "link / image / file" },
  { key: "before:", hint: "before a date" },
  { key: "after:", hint: "after a date" },
  { key: "during:", hint: "on a date" },
  { key: "pinned:", hint: "pinned messages" },
];

export type Member = { id: string; username: string; display_name: string; avatar_url: string | null };
export type Channel = { id: string; name: string };

// `selectable: false` marks a row that's shown for guidance only (e.g. the date-format
// hint) and must never be accepted by mouse click or Enter/Tab.
export type Suggestion = { value: string; label: ReactNode; selectable?: boolean };

/**
 * Pure derivation of the suggestion list for the token under the caret. Shared by the
 * dropdown (rendering) and the panel (keyboard handling) so the highlighted row and the
 * accepted value can never drift apart.
 */
export function getSuggestions(
  raw: string,
  caret: number,
  members: Member[],
  channels: Channel[]
): { kind: SuggestKind; token: string; suggestions: Suggestion[] } {
  const { token } = activeToken(raw, caret);
  const { kind, partial } = suggestKind(token);
  const lower = partial.toLowerCase();

  let suggestions: Suggestion[] = [];
  switch (kind) {
    case "operator":
      suggestions = OPERATORS.filter((o) => o.key.startsWith(lower)).map((o) => ({
        value: o.key,
        label: (
          <span>
            <code>{o.key}</code> <span className="text-muted">{o.hint}</span>
          </span>
        ),
      }));
      break;
    case "from":
    case "mentions": {
      const prefix = kind;
      suggestions = members
        .filter(
          (m) => m.username.toLowerCase().includes(lower) || m.display_name.toLowerCase().includes(lower)
        )
        .slice(0, 8)
        .map((m) => ({
          value: `${prefix}:${m.username} `,
          label: (
            <span className="flex items-center gap-1.5">
              <Avatar url={m.avatar_url} name={m.display_name} size="sm" />
              {m.display_name} <span className="text-muted">@{m.username}</span>
            </span>
          ),
        }));
      break;
    }
    case "in":
      suggestions = channels
        .filter((c) => c.name.toLowerCase().includes(lower))
        .slice(0, 8)
        .map((c) => ({
          value: `in:${c.name} `,
          label: (
            <span className="flex items-center gap-1">
              <Hash size={12} />
              {c.name}
            </span>
          ),
        }));
      break;
    case "has":
      suggestions = ["link", "image", "file"]
        .filter((v) => v.startsWith(lower))
        .map((v) => ({ value: `has:${v} `, label: <code>has:{v}</code> }));
      break;
    case "pinned":
      suggestions = [{ value: "pinned:true ", label: <code>pinned:true</code> }];
      break;
    case "date":
      suggestions = [
        { value: token, label: <span className="text-muted">format: YYYY-MM-DD or YYYY-MM</span>, selectable: false },
      ];
      break;
    default:
      suggestions = [];
  }

  return { kind, token, suggestions };
}

export function SearchSuggestions({
  suggestions,
  active,
  onHover,
  onPick,
}: {
  suggestions: Suggestion[];
  active: number;
  onHover: (index: number) => void;
  onPick: (value: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <ul className="absolute left-0 right-0 top-full mt-1 z-20 bg-surface border border-line rounded shadow max-h-60 overflow-y-auto">
      {suggestions.map((s, i) => (
        <li key={i}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              if (s.selectable !== false) onPick(s.value);
            }}
            onMouseEnter={() => onHover(i)}
            className={`w-full text-left px-2 py-1.5 text-sm ${i === active ? "bg-surface-2" : ""} ${
              s.selectable === false ? "cursor-default" : "hover:bg-surface-2"
            }`}
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
