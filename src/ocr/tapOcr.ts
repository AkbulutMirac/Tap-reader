import type { OcrWord } from "../db";
import { offlineDict } from "../translate/offline";
import { cropBubble, type CropOptions } from "./bubble";
import { recognize as recognizeRaw, recognizePage, type PageSegMode } from "./ocr";
import { splitMerged } from "./splitMerged";

const knownWord = async (w: string, exact = false) =>
  exact ? offlineDict.has(w).catch(() => false) : (await offlineDict.lookup(w).catch(() => null)) !== null;

/** OCR, then split words the lettering glued together ("HOWMUCH" → "HOW" "MUCH"). */
async function recognize(canvas: HTMLCanvasElement, mode: PageSegMode, toPage: (x: number, y: number) => [number, number], group: number) {
  return splitMerged(await recognizeRaw(canvas, mode, toPage, group), knownWord);
}

type Image = CanvasImageSource & { width: number; height: number };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding box (page fractions) and text of each OCR block (speech bubble / paragraph). */
export function blocksOf(words: OcrWord[]): (Box & { text: string; group: number })[] {
  const groups = new Map<number, OcrWord[]>();
  for (const w of words) groups.set(w.group, [...(groups.get(w.group) ?? []), w]);
  return [...groups].map(([group, ws]) => {
    const x0 = Math.min(...ws.map((w) => w.x));
    const y0 = Math.min(...ws.map((w) => w.y));
    const x1 = Math.max(...ws.map((w) => w.x + w.w));
    const y1 = Math.max(...ws.map((w) => w.y + w.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, text: ws.map((w) => w.text).join(" "), group };
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** Gap between two boxes along x and y (0 when they overlap on that axis). */
const gaps = (a: Box, b: Box) => [
  Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w)),
  Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h)),
];
const distanceTo = (w: Box, x: number, y: number) => Math.hypot(...gaps(w, { x, y, w: 0, h: 0 }));

/** The word nearest (x, y) if it is within `maxLines` line heights, else null. */
export function nearestWord(words: OcrWord[], x: number, y: number, maxLines = 1): OcrWord | null {
  if (!words.length) return null;
  const h = median(words.map((w) => w.h)) || 0.01;
  const best = words.reduce((a, b) => (distanceTo(b, x, y) < distanceTo(a, x, y) ? b : a));
  return distanceTo(best, x, y) <= h * maxLines ? best : null;
}

/**
 * The block of text around (tx, ty): the word nearest the tap (if close enough) plus every word
 * chained to it by small gaps — same line or the next line. Other captions/bubbles are left out.
 */
export function clusterAt(words: OcrWord[], tx: number, ty: number): OcrWord[] {
  const seed = nearestWord(words, tx, ty, 1.5);
  if (!seed) return [];
  const h = median(words.map((w) => w.h)) || 0.01;
  const inCluster = new Set([seed]);
  const queue = [seed];
  while (queue.length) {
    const a = queue.pop()!;
    for (const b of words) {
      if (inCluster.has(b)) continue;
      const [dx, dy] = gaps(a, b);
      if (dx <= h * 1.8 && dy <= h * 0.9) {
        inCluster.add(b);
        queue.push(b);
      }
    }
  }
  return words.filter((w) => inCluster.has(w));
}

const overlaps = (a: Box, b: Box) => {
  const [dx, dy] = gaps(a, b);
  return dx === 0 && dy === 0;
};

export type TapOcrResult =
  /** No text at the tap (artwork, empty page area). */
  | { kind: "none" }
  /**
   * Text found. `added` are newly recognized words (may be empty when the text was already
   * known); `word` is the word to show (page fractions of its center) when the tap itself
   * isn't exactly on a word; otherwise `block` is shown as a phrase.
   */
  | { kind: "text"; added: OcrWord[]; word?: { x: number; y: number }; block?: Box & { text: string } }
  /** The whole page was read (photos of pages); look the tap up again. */
  | { kind: "page"; added: OcrWord[] };

const center = (w: OcrWord) => ({ x: w.x + w.w / 2, y: w.y + w.h / 2 });

/** Read a window around the tap and keep the text block under the finger. */
async function readAround(image: Image, tx: number, ty: number, group: number, crop?: CropOptions) {
  const window = await cropBubble(image, tx, ty, { ...crop, window: true });
  const words = await recognize(window.canvas, "sparse", window.toPage, group);
  return clusterAt(words, tx, ty).map((w) => ({ ...w, group }));
}

/**
 * OCR for a tap at (tx, ty) (page fractions) on an image page:
 * 1. text already read near the tap → that word (or re-read the spot if nothing is close);
 * 2. on a speech bubble / caption box → read just that box (fast, works on comics);
 * 3. otherwise read a small window around the tap and keep the text block under the finger;
 * 4. nothing there, and allowed → read the whole page once (photos of pages).
 * Taps a little off a word snap to the nearest word.
 */
export async function ocrAtTap(
  image: Image,
  tx: number,
  ty: number,
  existing: OcrWord[],
  wholePage: boolean,
  crop?: CropOptions,
): Promise<TapOcrResult> {
  const nextGroup = existing.reduce((m, w) => Math.max(m, w.group + 1), 0);

  const known = blocksOf(existing).find((b) => tx >= b.x && tx <= b.x + b.w && ty >= b.y && ty <= b.y + b.h);
  if (known) {
    const near = nearestWord(existing, tx, ty, 0.6);
    if (near) return { kind: "text", added: [], word: center(near) };
    // Inside a read bubble but no word here (the first read missed it): read this spot again.
    const again = (await readAround(image, tx, ty, nextGroup, crop)).filter((w) => !existing.some((e) => overlaps(e, w)));
    const hit = nearestWord(again, tx, ty, 0.8);
    if (hit) return { kind: "text", added: again, word: center(hit) };
    return { kind: "text", added: [], block: known };
  }

  const bubble = await cropBubble(image, tx, ty, crop);
  if (!bubble.fallback) {
    // "auto" layout reads lone words in roomy bubbles with much higher confidence than
    // "single block"; "sparse" catches what auto misses.
    let words = await recognize(bubble.canvas, "auto", bubble.toPage, nextGroup);
    if (!words.length) words = await recognize(bubble.canvas, "sparse", bubble.toPage, nextGroup);
    // One bubble = one block, so its words form one sentence.
    const added = words.map((w) => ({ ...w, group: nextGroup }));
    const hit = nearestWord(added, tx, ty, 0.8);
    if (hit) return { kind: "text", added, word: center(hit) };
    // The bubble read missed the tapped word: read around the finger as well.
    const around = (await readAround(image, tx, ty, nextGroup + 1, crop)).filter((w) => !added.some((a) => overlaps(a, w)));
    const aroundHit = nearestWord(around, tx, ty, 0.8);
    if (aroundHit) return { kind: "text", added: [...added, ...around], word: center(aroundHit) };
    const text = added.map((w) => w.text).join(" ");
    return { kind: "text", added, block: { ...bubble.box, text } };
  }
  // A tap on artwork (comics): no text to look for, act like a normal tap right away.
  if (!bubble.nearLight && !wholePage) return { kind: "none" };
  const near = await readAround(image, tx, ty, nextGroup, crop);
  const hit = nearestWord(near, tx, ty, 0.8);
  if (hit) return { kind: "text", added: near, word: center(hit) };
  if (wholePage && existing.length === 0) return { kind: "page", added: await recognizePage(image) };
  return { kind: "none" };
}
