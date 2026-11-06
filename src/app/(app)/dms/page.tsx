"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { useFriends } from "@/components/providers/FriendsProvider";
import { useProfilePopover } from "@/components/providers/ProfilePopoverProvider";
import { useDrawer } from "@/components/providers/DrawerProvider";
import { usePresence } from "@/hooks/usePresence";
import { openDmWith } from "@/lib/dm";
import { escapeLike, sendResultMessage } from "@/lib/friends";
import { Avatar } from "@/components/user/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { RequestBadge } from "@/components/dms/RequestBadge";
import type { Profile } from "@/types/db";
import { ChatCircleDots, Check, List, UserMinus, UserPlus, Users, X } from "@phosphor-icons/react";

const TABS = ["Online", "All", "Pending", "Add Friend"] as const;
type Tab = (typeof TABS)[number];

/** The DMs home: your friends, requests, and adding people. Conversations stay in the left sidebar. */
export default function FriendsPage() {
  const { loaded, friends, incoming, outgoing } = useFriends();
  const { isOnline } = usePresence();
  const { open: drawerOpen, toggleDrawer } = useDrawer();
  const [tab, setTab] = useState<Tab>("Online");

  const online = friends.filter((f) => isOnline(f.id));

  return (
    <>
      <header className="p-3 border-b border-line flex items-center gap-1 sm:gap-3 min-w-0 overflow-x-auto">
        <button
          onClick={toggleDrawer}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="md:hidden -ml-1 flex items-center justify-center w-11 h-11 flex-none text-muted hover:text-ink"
        >
          <List size={20} weight="bold" aria-hidden="true" />
        </button>
        {/* Phones hide the title (the sidebar already says Friends) so all four tabs fit. */}
        <h1 className="sr-only sm:not-sr-only sm:flex items-center gap-2 font-semibold text-ink tracking-tight flex-none sm:border-r sm:border-line sm:pr-4">
          <Users size={20} weight="bold" aria-hidden="true" className="text-muted" /> Friends
        </h1>
        <nav className="flex items-center gap-1" aria-label="Friends sections">
          {TABS.map((t) => {
            const active = tab === t;
            const isAdd = t === "Add Friend";
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-control px-2 sm:px-2.5 min-h-11 md:min-h-8 text-body font-medium ${
                  isAdd
                    ? active ? "bg-transparent text-online" : "bg-online/90 text-app hover:bg-online"
                    : active ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2/60 hover:text-ink"
                }`}
              >
                {t}
                {t === "Pending" && <RequestBadge count={incoming.length} />}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        {tab === "Add Friend" ? (
          <AddFriend />
        ) : !loaded ? (
          <div className="space-y-3 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-pill" />
                <Skeleton className="h-3 w-40" />
              </div>
            ))}
          </div>
        ) : tab === "Pending" ? (
          incoming.length + outgoing.length === 0 ? (
            <EmptyState icon={<UserPlus size={32} weight="bold" />} title="No pending requests"
              description="Requests you send or receive show up here." />
          ) : (
            <>
              <Section title="Incoming" people={incoming} kind="incoming" />
              <Section title="Sent" people={outgoing} kind="outgoing" />
            </>
          )
        ) : tab === "Online" ? (
          online.length === 0 ? (
            <EmptyState icon={<Users size={32} weight="bold" />} title="No friends online"
              description={friends.length ? "None of your friends are on right now." : "Add a friend to see them here."}
              action={<AddButton onClick={() => setTab("Add Friend")} />} />
          ) : (
            <Section title="Online" people={online} kind="friend" />
          )
        ) : friends.length === 0 ? (
          <EmptyState icon={<Users size={32} weight="bold" />} title="No friends yet"
            description="Add someone by their username, or use Add Friend on anyone's profile."
            action={<AddButton onClick={() => setTab("Add Friend")} />} />
        ) : (
          <Section title="All friends" people={friends} kind="friend" />
        )}
      </div>
    </>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-1.5">
      Add Friend
    </button>
  );
}

function Section({ title, people, kind }: { title: string; people: Profile[]; kind: "friend" | "incoming" | "outgoing" }) {
  if (people.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-micro font-semibold uppercase tracking-wider text-muted">
        {title} — {people.length}
      </h2>
      <ul className="divide-y divide-line">
        {people.map((p) => <PersonRow key={p.id} person={p} kind={kind} />)}
      </ul>
    </section>
  );
}

const iconButton =
  "flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-pill bg-surface-2 text-muted disabled:opacity-50";

function PersonRow({ person, kind }: { person: Profile; kind: "friend" | "incoming" | "outgoing" }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const { user } = useAuth();
  const { accept, remove } = useFriends();
  const { isOnline } = usePresence();
  const { open } = useProfilePopover();
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const online = isOnline(person.id);

  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 4000);
    return () => clearTimeout(t);
  }, [confirmRemove]);

  async function run(action: () => Promise<boolean>) {
    setBusy(true);
    setError(null);
    const ok = await action();
    setBusy(false);
    if (!ok) setError("Something went wrong — try again.");
  }

  async function message() {
    if (!user) return;
    setBusy(true);
    const convId = await openDmWith(supabase, user.id, person.id);
    setBusy(false);
    if (!convId) return setError("Couldn't open the conversation — try again.");
    router.push(`/dms/${convId}`);
  }

  const subtitle = kind === "incoming" ? "Wants to be your friend" : kind === "outgoing" ? "Request sent" : online ? "Online" : "Offline";

  return (
    <li className="flex items-center gap-3 py-2">
      <button type="button" onClick={(e) => open(person.id, e.currentTarget.getBoundingClientRect())}
        aria-label={`View ${person.display_name}'s profile`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-row text-left">
        <Avatar url={person.avatar_url} name={person.display_name} seed={person.id}
          presence={online ? "online" : "offline"} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-body font-medium text-ink">
            {person.display_name} <span className="font-normal text-muted">@{person.username}</span>
          </span>
          <span className="block truncate text-meta text-muted">{error ?? subtitle}</span>
        </span>
      </button>
      <div className="flex flex-none items-center gap-2">
        {kind === "friend" && (
          <>
            <button type="button" onClick={message} disabled={busy} title="Message" aria-label={`Message ${person.display_name}`}
              className={`${iconButton} hover:text-ink`}>
              <ChatCircleDots size={18} weight="bold" aria-hidden="true" />
            </button>
            {confirmRemove ? (
              <button type="button" onClick={() => run(() => remove(person.id))} disabled={busy} autoFocus
                className="rounded-control bg-danger/15 px-2.5 min-h-11 md:min-h-9 text-meta font-medium text-danger hover:bg-danger/25">
                Remove?
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy} title="Remove friend"
                aria-label={`Remove ${person.display_name} as a friend`} className={`${iconButton} hover:text-danger`}>
                <UserMinus size={18} weight="bold" aria-hidden="true" />
              </button>
            )}
          </>
        )}
        {kind === "incoming" && (
          <>
            <button type="button" onClick={() => run(() => accept(person.id))} disabled={busy} title="Accept"
              aria-label={`Accept ${person.display_name}'s request`} className={`${iconButton} hover:text-online`}>
              <Check size={18} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => run(() => remove(person.id))} disabled={busy} title="Ignore"
              aria-label={`Ignore ${person.display_name}'s request`} className={`${iconButton} hover:text-danger`}>
              <X size={18} weight="bold" aria-hidden="true" />
            </button>
          </>
        )}
        {kind === "outgoing" && (
          <button type="button" onClick={() => run(() => remove(person.id))} disabled={busy} title="Cancel request"
            aria-label={`Cancel your request to ${person.display_name}`} className={`${iconButton} hover:text-danger`}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

function AddFriend() {
  const supabase = useMemo(() => createClient(), []);
  const { sendRequest } = useFriends();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const wanted = name.trim().replace(/^@/, "");
    if (!wanted || busy) return;
    setBusy(true);
    setResult(null);
    // Usernames are matched ignoring case; prefer an exact-case match if two differ only by case.
    const { data } = await supabase.from("profiles").select("id, username").ilike("username", escapeLike(wanted)).limit(5);
    const matches = (data ?? []) as { id: string; username: string }[];
    const target = matches.find((m) => m.username === wanted) ?? matches[0];
    if (!target) {
      setBusy(false);
      return setResult({ ok: false, text: `No one has the username @${wanted}. Check the spelling?` });
    }
    try {
      const outcome = await sendRequest(target.id);
      setResult({ ok: outcome !== "already_requested" && outcome !== "already_friends", text: sendResultMessage(outcome, target.username) });
      // Clear the box only if it still holds the name that was sent (not something typed since).
      if (outcome === "requested" || outcome === "accepted") {
        setName((n) => (n.trim().replace(/^@/, "") === wanted ? "" : n));
      }
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  }

  return (
    <section className="max-w-xl">
      <h2 className="text-title font-semibold text-ink">Add Friend</h2>
      <p className="mt-1 text-body text-muted">You can add friends with their username.</p>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center rounded-card border border-line bg-surface-2 p-2 focus-within:border-accent">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setResult(null); }}
          placeholder="Type a username"
          aria-label="Username"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-body text-ink outline-none"
        />
        <button type="submit" disabled={busy || !name.trim()}
          className="rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium px-3 py-2 disabled:opacity-50">
          {busy ? "Sending…" : "Send Friend Request"}
        </button>
      </form>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`mt-2 text-meta ${result.ok ? "text-online" : "text-danger"}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
