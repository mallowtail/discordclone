"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/AuthProvider";
import { pollErrorMessage, pollTimeLabel, tallyPoll, type PollOption, type PollVote } from "@/lib/messages/polls";
import type { Message } from "@/types/db";
import { ChartBar, Check, Crown } from "@phosphor-icons/react";

type Loaded = {
  allowMultiple: boolean;
  endsAt: string;
  options: PollOption[];
  /** Readable only once I've voted or the poll has ended (RLS); otherwise empty. */
  votes: (PollVote & { name: string })[];
  voterCount: number;
};

/**
 * A poll message. Before you vote you pick answers and see only the number of votes; after voting
 * (or once it ends) you see the bars, and can click an answer to see who picked it. Kept live:
 * every vote and ending early touch the poll row, which triggers a refetch.
 */
export function PollCard({ msg }: { msg: Message }) {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const instanceId = useId();
  const [data, setData] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [openVoters, setOpenVoters] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const [{ data: poll }, { data: options }, { data: votes }, { data: count }] = await Promise.all([
      supabase.from("polls").select("allow_multiple, ends_at").eq("message_id", msg.id).maybeSingle(),
      supabase.from("poll_options").select("id, position, label").eq("message_id", msg.id).order("position"),
      supabase.from("poll_votes").select("option_id, user_id, profiles(display_name)").eq("message_id", msg.id),
      supabase.rpc("poll_voter_count", { msg: msg.id }),
    ]);
    if (!poll) return setMissing(true);
    setData({
      allowMultiple: poll.allow_multiple,
      endsAt: poll.ends_at,
      options: (options as PollOption[] | null) ?? [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      votes: ((votes ?? []) as any[]).map((v) => ({ option_id: v.option_id, user_id: v.user_id, name: v.profiles?.display_name ?? "Someone" })),
      voterCount: (count as number | null) ?? 0,
    });
    setNow(new Date());
  }, [supabase, msg.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch this poll
    load();
    const channel = supabase
      .channel(`poll:${msg.id}:${instanceId}`)
      // Every vote (and ending early) updates the poll row, which everyone here can read — unlike the
      // votes themselves, which stay hidden until you vote.
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "polls", filter: `message_id=eq.${msg.id}` }, () => load())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") load();
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, msg.id, instanceId, load]);

  // Refresh the "3h left" label each minute, and reload exactly when the poll ends (results unlock).
  const endsAt = data?.endsAt;
  useEffect(() => {
    if (!endsAt) return;
    const tick = setInterval(() => setNow(new Date()), 60_000);
    const left = new Date(endsAt).getTime() - Date.now();
    const end = left > 0 && left < 2_147_000_000 ? setTimeout(() => load(), left + 500) : undefined;
    return () => {
      clearInterval(tick);
      if (end) clearTimeout(end);
    };
  }, [endsAt, load]);

  useEffect(() => {
    if (!confirmEnd) return;
    const t = setTimeout(() => setConfirmEnd(false), 4000);
    return () => clearTimeout(t);
  }, [confirmEnd]);

  if (missing) return <p className="text-body text-muted italic">This poll is no longer available.</p>;

  const ended = !!data && new Date(data.endsAt) <= now;
  const myId = user?.id ?? "";
  const tally = data ? tallyPoll(data.options, data.votes, myId, ended) : null;
  const voted = !!tally && tally.myOptionIds.length > 0;
  const showResults = voted || ended;
  const voterTotal = showResults && tally ? tally.voters : data?.voterCount ?? 0;
  const isAuthor = msg.author_id === myId;

  async function vote(optionIds: string[]) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("vote_poll", { msg: msg.id, option_ids: optionIds });
    setBusy(false);
    if (err) return setError(pollErrorMessage(err.message));
    setPicked([]);
    load();
  }

  async function endNow() {
    setBusy(true);
    const { error: err } = await supabase.rpc("end_poll", { msg: msg.id });
    setBusy(false);
    setConfirmEnd(false);
    if (err) return setError(pollErrorMessage(err.message));
    load();
  }

  function toggle(id: string) {
    if (!data) return;
    setPicked((cur) => (data.allowMultiple ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]) : cur[0] === id ? [] : [id]));
  }

  return (
    <div className="mt-1 max-w-md rounded-card border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-muted">
        <ChartBar size={13} weight="bold" aria-hidden="true" /> Poll
      </div>
      <p className="mt-1 text-body font-semibold text-ink break-words">{msg.content}</p>
      {!data ? (
        <p className="mt-2 text-meta text-muted">Loading…</p>
      ) : (
        <>
          <p className="mt-0.5 text-meta text-muted">
            {ended ? "Final results" : showResults ? "Your vote is in" : data.allowMultiple ? "Select one or more answers" : "Select one answer"}
          </p>
          <ul className="mt-2 space-y-1.5">
            {tally!.rows.map((r) =>
              showResults ? (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpenVoters(openVoters === r.id ? null : r.id)} aria-expanded={openVoters === r.id}
                    aria-label={`${r.label}: ${r.count} ${r.count === 1 ? "vote" : "votes"}, ${r.percent}%${r.mine ? ", your vote" : ""}${r.winner ? ", winner" : ""}. Show who voted`}
                    className={`relative w-full overflow-hidden rounded-control border px-3 py-2 text-left ${r.winner ? "border-accent" : "border-line"}`}>
                    <span className={`absolute inset-y-0 left-0 ${r.mine ? "bg-accent/30" : "bg-ink/10"}`} style={{ width: `${r.percent}%` }} aria-hidden="true" />
                    <span className="relative flex items-center gap-2">
                      {r.winner && <Crown size={14} weight="fill" className="flex-none text-amber" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 truncate text-body text-ink">{r.label}</span>
                      {r.mine && <Check size={14} weight="bold" className="flex-none text-accent" aria-hidden="true" />}
                      <span className="flex-none text-meta text-muted tabular-nums">{r.count} · {r.percent}%</span>
                    </span>
                  </button>
                  {openVoters === r.id && (
                    <p className="px-3 pt-1 text-meta text-muted">
                      {r.count === 0 ? "No votes yet." : data.votes.filter((v) => v.option_id === r.id).map((v) => v.name).join(", ")}
                    </p>
                  )}
                </li>
              ) : (
                <li key={r.id}>
                  <button type="button" onClick={() => toggle(r.id)} disabled={ended} aria-pressed={picked.includes(r.id)}
                    className={`flex w-full items-center gap-2 rounded-control border px-3 py-2 text-left min-h-11 md:min-h-0 ${
                      picked.includes(r.id) ? "border-accent bg-accent/15" : "border-line hover:bg-surface-2"
                    }`}>
                    <span className={`flex h-4 w-4 flex-none items-center justify-center border ${data.allowMultiple ? "rounded-row" : "rounded-pill"} ${
                      picked.includes(r.id) ? "border-accent bg-accent text-white" : "border-muted"
                    }`} aria-hidden="true">
                      {picked.includes(r.id) && <Check size={10} weight="bold" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{r.label}</span>
                  </button>
                </li>
              )
            )}
          </ul>
          {error && <p role="alert" className="mt-2 text-meta text-danger">{error}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted">
            <span>{voterTotal} {voterTotal === 1 ? "vote" : "votes"} · {pollTimeLabel(data.endsAt, now)}</span>
            {!showResults && !ended && (
              <button type="button" onClick={() => vote(picked)} disabled={busy || picked.length === 0}
                className="ml-auto rounded-control bg-accent hover:bg-accent-strong px-3 py-1 text-meta font-medium text-white disabled:opacity-50 min-h-9">
                Vote
              </button>
            )}
            {voted && !ended && (
              <button type="button" onClick={() => vote([])} disabled={busy} className="hover:text-ink underline-offset-2 hover:underline">
                Remove vote
              </button>
            )}
            {isAuthor && !ended && (
              confirmEnd ? (
                <button type="button" onClick={endNow} disabled={busy} autoFocus className="font-medium text-danger hover:underline">
                  End poll now?
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmEnd(true)} className="hover:text-ink hover:underline">
                  End poll
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
