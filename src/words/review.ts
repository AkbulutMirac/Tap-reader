import type { SavedWord } from "../db";

const DAY = 24 * 60 * 60 * 1000;

/** Days until the next review after answering "Know" from each Leitner box. */
export const INTERVAL_DAYS = [1, 3, 7, 14, 30, 90];

/** "Again" brings the card back after this long (later in the same session). */
const AGAIN_DELAY_MS = 60 * 1000;

export function answerCard(word: SavedWord, knew: boolean, now = Date.now()): Pick<SavedWord, "box" | "dueAt"> {
  if (!knew) return { box: 0, dueAt: now + AGAIN_DELAY_MS };
  const box = Math.min(word.box + 1, INTERVAL_DAYS.length);
  return { box, dueAt: now + INTERVAL_DAYS[box - 1] * DAY };
}

export function isDue(word: SavedWord, now = Date.now()): boolean {
  return word.dueAt <= now;
}
