"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { openDmWith } from "@/lib/dm";
import { groupErrorMessage, pickerAction } from "@/lib/conversations";
import { Avatar } from "@/components/user/Avatar";
import { Modal } from "@/components/ui/Modal";
import type { Profile } from "@/types/db";
import { Check, MagnifyingGlass, X } from "@phosphor-icons/react";

type Mode = { mode: "new" } | { mode: "add"; conversationId: string; memberIds: string[] };

/**
 * Pick people to start a DM (one person) or a group (2–9), or to add to an existing group. Lists
 * only people you can already reach — friends, people in your servers, people in your DMs and
 * groups — which the database enforces too; there's deliberately no free-text username lookup.
 */
export function PeoplePickerDialog({ onClose, ...ctx }: Mode & { onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const [people, setPeople] = useState<Profile[] | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Profile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const memberKey = ctx.mode === "add" ? ctx.memberIds.join(",") : "";
  useEffect(() => {
    let active = true;
    supabase.rpc("reachable_people").then(({ data }) => {
      if (!active) return;
      const already = new Set(memberKey ? memberKey.split(",") : []);
      setPeople(((data as Profile[] | null) ?? []).filter((p) => !already.has(p.id)));
    });
    return () => { active = false; };
  }, [supabase, memberKey]);

  const q = query.trim().toLowerCase().replace(/^@/, "");
  const shown = (people ?? []).filter(
    (p) => !q || p.display_name.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
  );
  const action = pickerAction(
    picked.length,
    ctx.mode === "add" ? { mode: "add", currentSize: ctx.memberIds.length } : { mode: "new" }
  );
  const isPicked = (id: string) => picked.some((p) => p.id === id);

  function toggle(p: Profile) {
    setError(null);
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : [...cur, p]));
  }

  async function submit() {
    if (action.disabled || busy || !user) return;
    setBusy(true);
    setError(null);
    const ids = picked.map((p) => p.id);
    if (ctx.mode === "add") {
      const { error: err } = await supabase.rpc("add_group_members", { conv_id: ctx.conversationId, people: ids });
      setBusy(false);
      if (err) return setError(groupErrorMessage(err.message));
      return onClose();
    }
    if (ids.length === 1) {
      const convId = await openDmWith(supabase, user.id, ids[0]);
      setBusy(false);
      if (!convId) return setError("Couldn't open the conversation — try again.");
      onClose();
      return router.push(`/dms/${convId}`);
    }
    const { data, error: err } = await supabase.rpc("create_group", { people: ids });
    setBusy(false);
    if (err || !data) return setError(groupErrorMessage(err?.message ?? ""));
    onClose();
    router.push(`/dms/${data as string}`);
  }

  return (
    <Modal onClose={onClose} title={ctx.mode === "add" ? "Add people" : "New message"} size="sm">
      <div className="p-4">
        <p className="text-meta text-muted mb-3">
          {ctx.mode === "add"
            ? "Pick friends or people you share a server or group with."
            : "Pick one person for a DM, or several to make a group (up to 10 people, including you)."}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-surface-2 border border-line focus-within:border-accent px-2 py-1.5">
          {picked.map((p) => (
            <button key={p.id} type="button" onClick={() => toggle(p)} aria-label={`Remove ${p.display_name}`}
              className="flex items-center gap-1 rounded-pill bg-accent/20 text-ink text-meta pl-2 pr-1 py-0.5 hover:bg-accent/30">
              {p.display_name} <X size={12} weight="bold" aria-hidden="true" />
            </button>
          ))}
          <span className="flex flex-1 items-center gap-1.5 min-w-[8rem]">
            <MagnifyingGlass size={15} className="text-muted flex-none" aria-hidden="true" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name" aria-label="Search people"
              className="flex-1 min-w-0 bg-transparent py-1 text-body text-ink outline-none" />
          </span>
        </div>

        <ul className="mt-2 max-h-72 overflow-y-auto" aria-label="People">
          {people === null ? (
            <li className="px-2 py-3 text-body text-muted">Loading…</li>
          ) : shown.length === 0 ? (
            <li className="px-2 py-3 text-body text-muted">
              {people.length === 0
                ? ctx.mode === "add" ? "Everyone you can add is already here." : "Add a friend or join a server to find people to message."
                : "No one matches that."}
            </li>
          ) : (
            shown.map((p) => {
              const on = isPicked(p.id);
              return (
                <li key={p.id}>
                  <button type="button" onClick={() => toggle(p)} aria-pressed={on}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 min-h-11 md:min-h-0 rounded-row text-left ${on ? "bg-accent/15" : "hover:bg-surface-2"}`}>
                    <Avatar url={p.avatar_url} name={p.display_name} seed={p.id} size="sm" />
                    <span className="flex-1 min-w-0 truncate text-body text-ink">
                      {p.display_name} <span className="text-muted">@{p.username}</span>
                    </span>
                    <span className={`w-5 h-5 flex-none rounded-row border flex items-center justify-center ${on ? "bg-accent border-accent text-white" : "border-line"}`}
                      aria-hidden="true">
                      {on && <Check size={12} weight="bold" />}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {(error || action.hint) && (
          <p role="alert" className="mt-2 text-meta text-danger">{error ?? action.hint}</p>
        )}
        <button type="button" onClick={submit} disabled={action.disabled || busy}
          className="mt-3 w-full rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium py-2 disabled:opacity-50">
          {busy ? "…" : action.label}
        </button>
      </div>
    </Modal>
  );
}
