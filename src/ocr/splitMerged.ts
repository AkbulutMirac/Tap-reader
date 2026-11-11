import type { OcrWord } from "../db";

/**
 * Does the dictionary know this word? `exact` = only as written (used for corrections, so
 * "DAVIS" isn't "fixed" into "DAVIDS" just because "david" exists); otherwise base forms count.
 */
export type KnownWord = (word: string, exact?: boolean) => Promise<boolean>;

const MIN_SPLIT_LENGTH = 5;

/** Letters OCR commonly confuses in comic lettering. */
const CONFUSABLE: Record<string, string> = {
  p: "d",
  d: "po",
  o: "dq0",
  q: "o",
  u: "v",
  v: "u",
  i: "lj1",
  l: "i1",
  j: "i",
  s: "5",
  b: "8",
  c: "go",
  g: "c",
  e: "f",
  f: "e",
  h: "n",
  n: "hm",
  m: "n",
  r: "k",
  k: "r",
  w: "u",
};
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Keep the original's case style (ALL CAPS / Capitalized / lower). */
function likeCase(original: string, fixed: string): string {
  if (original === original.toUpperCase()) return fixed.toUpperCase();
  if (original[0] === original[0].toUpperCase()) return fixed[0].toUpperCase() + fixed.slice(1);
  return fixed;
}

/**
 * Fix a one-letter OCR slip in an unknown word: a look-alike letter (PARKNESS → DARKNESS),
 * a missing letter (YONG → YOUNG) or an extra letter (CAROOL → CAROL). Null if none fits.
 */
export async function fixTypo(word: string, known: KnownWord, kinds: "lookalike" | "edit" | "all" = "all"): Promise<string | null> {
  const w = word.toLowerCase();
  const tries: string[] = [];
  if (kinds !== "edit") {
    for (let i = 0; i < w.length; i++) for (const c of CONFUSABLE[w[i]] ?? "") tries.push(w.slice(0, i) + c + w.slice(i + 1));
  }
  if (kinds !== "lookalike") {
    for (let i = 1; i <= w.length; i++) for (const c of LETTERS) tries.push(w.slice(0, i) + c + w.slice(i));
    // Extra letters from OCR are almost always a doubled stroke ("CAROOL").
    for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1]) tries.push(w.slice(0, i) + w.slice(i + 1));
  }
  for (const t of tries) if (/^[a-z]+$/.test(t) && t !== w && (await known(t, true))) return t;
  return null;
}

/** Below this OCR confidence a word may be a misreading worth correcting. */
const UNSURE = 90;

/**
 * Clean up OCR words with the dictionary. Comic lettering is tightly spaced and stylized, so
 * OCR sometimes glues two words together ("HOWMUCH", "THESUN.") or misreads one letter.
 * Unknown words are split in two when both halves are words; otherwise a one-letter fix is
 * tried. Boxes of split words are divided by character count.
 */
export async function splitMerged(words: OcrWord[], known: KnownWord): Promise<OcrWord[]> {
  const out: OcrWord[] = [];
  for (const w of words) {
    const m = /^([^\p{L}]*)(\p{L}+)([^\p{L}]*)$/u.exec(w.text);
    const letters = m?.[2] ?? "";
    if (!m || letters.length < 3 || (await known(letters.toLowerCase()))) {
      out.push(w);
      continue;
    }
    // Only correct letters when OCR itself was unsure — clean, confident unknown words are
    // usually names (ABIN, SINESTRO) and must stay as they are.
    const unsure = (w.conf ?? 0) < UNSURE;
    const lookalike = unsure ? await fixTypo(letters, known, "lookalike") : null;
    if (lookalike) {
      out.push({ ...w, text: m[1] + likeCase(letters, lookalike) + m[3] });
      continue;
    }
    // Most balanced split whose halves are both words (each at least 2 letters, or "A"/"I");
    // an unsure half may also be a look-alike fix ("THESWN" → "THE" "SUN").
    let best: { at: number; a: string; b: string } | null = null;
    const asWord = async (s: string) =>
      (await known(s.toLowerCase())) ? s : unsure ? await fixTypo(s, known, "lookalike").then((f) => f && likeCase(s, f)) : null;
    if (letters.length >= MIN_SPLIT_LENGTH) {
      for (let i = 1; i < letters.length; i++) {
        const okLen = (s: string) => s.length >= 2 || /^[AI]$/i.test(s);
        if (!okLen(letters.slice(0, i)) || !okLen(letters.slice(i))) continue;
        if (best && Math.abs(i - letters.length / 2) >= Math.abs(best.at - letters.length / 2)) continue;
        const a = await asWord(letters.slice(0, i));
        const b = a && (await asWord(letters.slice(i)));
        if (a && b) best = { at: i, a, b };
      }
    }
    if (best) {
      const first = m[1] + best.a;
      const second = best.b + m[3];
      const total = first.length + second.length;
      const w1 = (w.w * first.length) / total;
      out.push({ ...w, text: first, w: w1 * 0.95 });
      out.push({ ...w, text: second, x: w.x + w1 * 1.05, w: w.w - w1 * 1.05 });
      continue;
    }
    const fixed = unsure ? await fixTypo(letters, known, "edit") : null;
    out.push(fixed ? { ...w, text: m[1] + likeCase(letters, fixed) + m[3] } : w);
  }
  return out;
}
