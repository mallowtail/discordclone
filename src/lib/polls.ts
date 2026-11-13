// Poll rules and results maths. The database enforces the same limits (create_poll, vote_poll).

export const QUESTION_MAX = 300;
export const ANSWER_MAX = 55;
export const MAX_ANSWERS = 10;

/** The only durations create_poll accepts. */
export const POLL_DURATIONS = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 14400, label: "4 hours" },
  { seconds: 28800, label: "8 hours" },
  { seconds: 86400, label: "1 day" },
  { seconds: 259200, label: "3 days" },
  { seconds: 604800, label: "1 week" },
] as const;
export const DEFAULT_POLL_SECONDS = 86400;

export type PollOption = { id: string; position: number; label: string };
export type PollVote = { option_id: string; user_id: string };

export function validatePollDraft(draft: { question: string; answers: string[] }):
  | { ok: true; question: string; answers: string[] }
  | { ok: false; error: string } {
  const question = draft.question.trim();
  const answers = draft.answers.map((a) => a.trim()).filter((a) => a !== "");
  if (!question) return { ok: false, error: "Write a question" };
  if (question.length > QUESTION_MAX) return { ok: false, error: `Keep the question under ${QUESTION_MAX} characters` };
  if (answers.length < 2) return { ok: false, error: "Add at least 2 answers" };
  if (answers.length > MAX_ANSWERS) return { ok: false, error: `Up to ${MAX_ANSWERS} answers` };
  if (answers.some((a) => a.length > ANSWER_MAX)) return { ok: false, error: `Keep each answer under ${ANSWER_MAX} characters` };
  return { ok: true, question, answers };
}

export type PollRow = PollOption & { count: number; percent: number; mine: boolean; winner: boolean };

/**
 * Per-answer counts. Percentages are of *people* who voted (so on a multiple-answer poll they can
 * add up to more than 100%, like Discord). Winners — the top count, ties included — only once ended.
 */
export function tallyPoll(options: PollOption[], votes: PollVote[], myId: string, ended: boolean) {
  const voters = new Set(votes.map((v) => v.user_id)).size;
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v.option_id, (counts.get(v.option_id) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  const myOptionIds = votes.filter((v) => v.user_id === myId).map((v) => v.option_id);
  const rows: PollRow[] = [...options]
    .sort((a, b) => a.position - b.position)
    .map((o) => {
      const count = counts.get(o.id) ?? 0;
      return {
        ...o,
        count,
        percent: voters ? Math.round((count / voters) * 100) : 0,
        mine: myOptionIds.includes(o.id),
        winner: ended && top > 0 && count === top,
      };
    });
  return { rows, voters, myOptionIds };
}

export function pollTimeLabel(endsAt: string, now: Date = new Date()): string {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return "Poll ended";
  const minutes = Math.ceil(ms / 60_000);
  // <= so the last stretch before the hour mark (e.g. a fresh 1-hour poll) reads "60m", not "0h".
  if (minutes <= 60) return `${minutes}m left`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(ms / 86_400_000)}d left`;
}

/** Plain-words versions of the database's poll errors. */
export function pollErrorMessage(message: string): string {
  if (message.includes("slow down")) return "You're sending messages too fast — wait a few seconds.";
  if (message.includes("has ended")) return "This poll has ended.";
  if (message.includes("timed out")) return "You can't vote while you're timed out.";
  return "Something went wrong — try again.";
}
