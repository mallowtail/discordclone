"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Target } from "@/lib/sendAttachment";
import {
  ANSWER_MAX,
  DEFAULT_POLL_SECONDS,
  MAX_ANSWERS,
  POLL_DURATIONS,
  QUESTION_MAX,
  pollErrorMessage,
  validatePollDraft,
} from "@/lib/polls";
import { Modal } from "@/components/ui/Modal";
import { Plus, X } from "@phosphor-icons/react";

const field =
  "w-full rounded-control bg-surface-2 border border-line px-3 py-2 text-body text-ink outline-none focus:border-accent";

/** Write and post a poll to the current channel / DM / group. */
export function PollComposerDialog({ target, onClose }: { target: Target; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(["", ""]);
  const [seconds, setSeconds] = useState<number>(DEFAULT_POLL_SECONDS);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setAnswer(i: number, value: string) {
    setAnswers((cur) => cur.map((a, j) => (j === i ? value : a)));
    setError(null);
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    const v = validatePollDraft({ question, answers });
    if (!v.ok) return setError(v.error);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc("create_poll", {
      target_channel: "channel_id" in target ? target.channel_id : null,
      target_conversation: "conversation_id" in target ? target.conversation_id : null,
      question: v.question,
      answers: v.answers,
      duration_seconds: seconds,
      allow_multiple: multiple,
    });
    setBusy(false);
    if (err) return setError(pollErrorMessage(err.message));
    onClose();
  }

  return (
    <Modal onClose={onClose} title="Create a poll" size="sm">
      <form onSubmit={post} className="p-4 space-y-4">
        <label className="block">
          <span className="block text-meta font-medium text-muted mb-1">Question</span>
          <input autoFocus value={question} maxLength={QUESTION_MAX} placeholder="What should we play tonight?"
            onChange={(e) => { setQuestion(e.target.value); setError(null); }} className={field} />
        </label>

        <fieldset>
          <legend className="block text-meta font-medium text-muted mb-1">Answers</legend>
          <div className="space-y-2">
            {answers.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={a} maxLength={ANSWER_MAX} placeholder={`Answer ${i + 1}`} aria-label={`Answer ${i + 1}`}
                  onChange={(e) => setAnswer(i, e.target.value)} className={field} />
                {answers.length > 2 && (
                  <button type="button" onClick={() => setAnswers((cur) => cur.filter((_, j) => j !== i))}
                    aria-label={`Remove answer ${i + 1}`}
                    className="flex-none flex items-center justify-center w-11 h-11 md:w-9 md:h-9 rounded-control text-muted hover:text-danger">
                    <X size={16} weight="bold" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {answers.length < MAX_ANSWERS && (
            <button type="button" onClick={() => setAnswers((cur) => [...cur, ""])}
              className="mt-2 flex items-center gap-1.5 text-meta font-medium text-accent hover:text-accent-strong min-h-11 md:min-h-0">
              <Plus size={14} weight="bold" /> Add another answer
            </button>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <label className="flex items-center gap-2">
            <span className="text-meta font-medium text-muted">Duration</span>
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}
              className="rounded-control bg-surface-2 border border-line px-2 py-1.5 text-body text-ink">
              {POLL_DURATIONS.map((d) => <option key={d.seconds} value={d.seconds}>{d.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-body text-ink min-h-11 md:min-h-0">
            <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} className="w-4 h-4 accent-accent" />
            Allow multiple answers
          </label>
        </div>

        {error && <p role="alert" className="text-meta text-danger">{error}</p>}
        <button type="submit" disabled={busy}
          className="w-full rounded-control bg-accent hover:bg-accent-strong text-white text-body font-medium py-2 disabled:opacity-50">
          {busy ? "Posting…" : "Post poll"}
        </button>
      </form>
    </Modal>
  );
}
