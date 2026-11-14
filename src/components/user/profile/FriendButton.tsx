"use client";

import { useEffect, useState } from "react";
import { UserPlus, UserCheck, Clock } from "@phosphor-icons/react";
import { useFriends } from "@/components/providers/FriendsProvider";

/**
 * The friend action for someone's profile. Its label follows the relationship: Add Friend →
 * Request sent → (they accept) → Friends. If they asked you first, it's Accept. Undoing (cancel a
 * sent request, unfriend) takes a second click on a "…?" confirm, so a stray click can't do it.
 */
export function FriendButton({ userId, full = false }: { userId: string; full?: boolean }) {
  const { loaded, relationTo, sendRequest, accept, remove } = useFriends();
  const relation = relationTo(userId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pending "Remove friend?" confirm quietly backs out after a few seconds.
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(t);
  }, [confirming]);

  if (!loaded || relation === "self") return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (res === false) setError("Something went wrong — try again.");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
    setConfirming(false);
  }

  const base = `flex items-center justify-center gap-1.5 rounded-control font-medium disabled:opacity-50 ${
    full ? "w-full py-2 text-body" : "px-2.5 min-h-8 text-meta"
  }`;
  const neutral = `${base} border border-line text-ink hover:bg-surface-2`;
  const primary = `${base} bg-accent text-white hover:bg-accent-strong`;
  const danger = `${base} bg-danger/15 text-danger hover:bg-danger/25`;

  let button;
  if (relation === "none") {
    button = (
      <button type="button" disabled={busy} onClick={() => run(() => sendRequest(userId))} className={neutral}>
        <UserPlus size={16} weight="bold" aria-hidden="true" /> Add Friend
      </button>
    );
  } else if (relation === "incoming") {
    button = (
      <button type="button" disabled={busy} onClick={() => run(() => accept(userId))} className={primary}>
        <UserCheck size={16} weight="bold" aria-hidden="true" /> Accept request
      </button>
    );
  } else if (confirming) {
    button = (
      <button type="button" disabled={busy} onClick={() => run(() => remove(userId))} className={danger} autoFocus>
        {relation === "friends" ? "Remove friend?" : "Cancel request?"}
      </button>
    );
  } else {
    button = (
      <button type="button" disabled={busy} onClick={() => setConfirming(true)} className={neutral}
        title={relation === "friends" ? "Click to remove friend" : "Click to cancel request"}>
        {relation === "friends" ? (
          <><UserCheck size={16} weight="bold" aria-hidden="true" /> Friends</>
        ) : (
          <><Clock size={16} weight="bold" aria-hidden="true" /> Request sent</>
        )}
      </button>
    );
  }

  return (
    <div className={full ? "w-full" : undefined}>
      {button}
      {error && <p role="alert" className="text-danger text-meta mt-1">{error}</p>}
    </div>
  );
}
