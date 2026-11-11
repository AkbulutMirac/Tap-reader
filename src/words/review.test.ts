import { describe, expect, it } from "vitest";
import type { SavedWord } from "../db";
import { answerCard, INTERVAL_DAYS, isDue } from "./review";
import { wordsToCsv } from "./backup";

const DAY = 86_400_000;
const card = (box: number, dueAt = 0): SavedWord => ({
  word: "bank",
  translation: "banka",
  sentence: 'She sat on the "bank".',
  savedAt: 0,
  box,
  dueAt,
});

describe("answerCard", () => {
  it("moves a known card up one box and schedules it later", () => {
    expect(answerCard(card(0), true, 0)).toEqual({ box: 1, dueAt: INTERVAL_DAYS[0] * DAY });
    expect(answerCard(card(2), true, 0)).toEqual({ box: 3, dueAt: INTERVAL_DAYS[2] * DAY });
  });

  it("caps at the last box", () => {
    const last = INTERVAL_DAYS.length;
    expect(answerCard(card(last), true, 0).box).toBe(last);
  });

  it("sends a forgotten card back to box 0, due again soon", () => {
    const r = answerCard(card(4), false, 1000);
    expect(r.box).toBe(0);
    expect(r.dueAt).toBeLessThan(1000 + 5 * 60 * 1000);
  });

  it("isDue compares against now", () => {
    expect(isDue(card(1, 500), 1000)).toBe(true);
    expect(isDue(card(1, 1500), 1000)).toBe(false);
  });
});

describe("wordsToCsv", () => {
  it("quotes cells and escapes quotes", () => {
    expect(wordsToCsv([card(0)])).toBe('word,translation,sentence\n"bank","banka","She sat on the ""bank""."');
  });
});
