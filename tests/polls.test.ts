import { describe, it, expect } from "vitest";
import { validatePollDraft, tallyPoll, pollTimeLabel, POLL_DURATIONS } from "@/lib/messages/polls";

describe("validatePollDraft", () => {
  it("trims, drops blank answers, and accepts 2–10 answers", () => {
    expect(validatePollDraft({ question: "  Game tonight? ", answers: [" Minecraft ", "", "Roblox", "  "] }))
      .toEqual({ ok: true, question: "Game tonight?", answers: ["Minecraft", "Roblox"] });
  });
  it("needs a question", () => {
    expect(validatePollDraft({ question: "   ", answers: ["a", "b"] })).toEqual({ ok: false, error: "Write a question" });
  });
  it("needs at least two answers", () => {
    expect(validatePollDraft({ question: "Q", answers: ["a", " "] })).toEqual({ ok: false, error: "Add at least 2 answers" });
  });
  it("caps lengths and count", () => {
    expect(validatePollDraft({ question: "x".repeat(301), answers: ["a", "b"] })).toMatchObject({ ok: false, error: "Keep the question under 300 characters" });
    expect(validatePollDraft({ question: "Q", answers: ["a", "y".repeat(56)] })).toMatchObject({ ok: false, error: "Keep each answer under 55 characters" });
    expect(validatePollDraft({ question: "Q", answers: Array.from({ length: 11 }, (_, i) => `a${i}`) })).toMatchObject({ ok: false, error: "Up to 10 answers" });
  });
});

describe("tallyPoll", () => {
  const options = [{ id: "o1", position: 1, label: "A" }, { id: "o2", position: 2, label: "B" }, { id: "o3", position: 3, label: "C" }];
  const votes = [
    { option_id: "o1", user_id: "me" }, { option_id: "o1", user_id: "u2" }, { option_id: "o2", user_id: "u3" },
  ];
  it("counts votes per answer with whole-number percentages of voters", () => {
    const t = tallyPoll(options, votes, "me", false);
    expect(t.voters).toBe(3);
    expect(t.rows.map((r) => [r.label, r.count, r.percent, r.mine])).toEqual([
      ["A", 2, 67, true], ["B", 1, 33, false], ["C", 0, 0, false],
    ]);
    expect(t.myOptionIds).toEqual(["o1"]);
  });
  it("only marks winners once the poll has ended, and ties share it", () => {
    expect(tallyPoll(options, votes, "me", false).rows.some((r) => r.winner)).toBe(false);
    expect(tallyPoll(options, votes, "me", true).rows.filter((r) => r.winner).map((r) => r.label)).toEqual(["A"]);
    const tie = [...votes, { option_id: "o2", user_id: "u4" }];
    expect(tallyPoll(options, tie, "me", true).rows.filter((r) => r.winner).map((r) => r.label)).toEqual(["A", "B"]);
  });
  it("percentages use people, not votes, on multiple-answer polls", () => {
    const multi = [{ option_id: "o1", user_id: "me" }, { option_id: "o2", user_id: "me" }];
    expect(tallyPoll(options, multi, "me", false).rows.map((r) => r.percent)).toEqual([100, 100, 0]);
  });
  it("no votes: nothing wins and nothing divides by zero", () => {
    const t = tallyPoll(options, [], "me", true);
    expect(t.rows.every((r) => r.percent === 0 && !r.winner)).toBe(true);
  });
});

describe("pollTimeLabel", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("says how long is left, or that it ended", () => {
    expect(pollTimeLabel("2026-11-13T12:30:00Z", now)).toBe("30m left");
    expect(pollTimeLabel("2026-11-13T15:00:00Z", now)).toBe("3h left");
    expect(pollTimeLabel("2026-11-16T12:00:00Z", now)).toBe("3d left");
    expect(pollTimeLabel("2026-11-13T11:00:00Z", now)).toBe("Poll ended");
  });
  it("never says 0h: a fresh 1-hour poll reads 60m", () => {
    expect(pollTimeLabel("2026-11-13T12:59:59.500Z", now)).toBe("60m left");
    expect(pollTimeLabel("2026-11-13T13:00:00Z", now)).toBe("60m left");
    expect(pollTimeLabel("2026-11-13T13:01:00Z", now)).toBe("1h left");
  });
});

describe("POLL_DURATIONS", () => {
  it("matches the durations the database accepts", () => {
    expect(POLL_DURATIONS.map((d) => d.seconds)).toEqual([3600, 14400, 28800, 86400, 259200, 604800]);
  });
});
