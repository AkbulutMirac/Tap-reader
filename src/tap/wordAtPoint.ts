/**
 * Find the word under a screen point in any DOM text (PDF.js text layer,
 * ebook iframes, plain HTML, OCR overlays).
 */

export interface TappedWord {
  /** Word exactly as written in the text. */
  word: string;
  /** The sentence the word sits in, single-spaced. */
  sentence: string;
  /** Live range over the word; its rects follow scrolling. */
  range: Range;
  /** Word box (in the word's own document viewport) at tap time. */
  rect: DOMRect;
}

/** Elements whose text forms one readable block of context. */
const CONTEXT_ROOTS =
  ".textLayer, .ocr-bubble, .ocr-layer, p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, figcaption, dd, dt, pre";

/** Tapping this close (px) outside a word's box still counts as the word. */
const HIT_SLOP = 3;

const WORD_WINDOW = 120;
const SENTENCE_WINDOW = 600;
const MAX_SENTENCE = 400;

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });
const sentenceSegmenter = new Intl.Segmenter("en", { granularity: "sentence" });

interface Caret {
  node: Text;
  offset: number;
}

function caretAt(doc: Document, x: number, y: number): Caret | null {
  if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode.nodeType === Node.TEXT_NODE) {
      return { node: pos.offsetNode as Text, offset: pos.offset };
    }
    return null;
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
    return { node: range.startContainer as Text, offset: range.startOffset };
  }
  return null;
}

/** Text of a context root, with a map back to the text nodes it came from. */
interface FlatText {
  text: string;
  nodes: Text[];
  starts: number[];
}

const BLOCK_TAGS = new Set(["BR", "P", "DIV", "LI", "TR", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6"]);

export function flattenText(root: Node): FlatText {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let text = "";
  const nodes: Text[] = [];
  const starts: number[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push(n as Text);
      starts.push(text.length);
      text += (n as Text).data;
    } else if (BLOCK_TAGS.has((n as Element).tagName) && text && !text.endsWith("\n")) {
      text += "\n";
    }
  }
  return { text, nodes, starts };
}

/** Index of the text node that holds flat offset `i` (end-inclusive for range ends). */
function nodeIndexAt(flat: FlatText, i: number, isEnd: boolean): number {
  let lo = 0;
  let hi = flat.nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const start = flat.starts[mid];
    if (isEnd ? start < i : start <= i) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function rangeFor(flat: FlatText, start: number, end: number): Range {
  const doc = flat.nodes[0].ownerDocument;
  const a = nodeIndexAt(flat, start, false);
  const b = nodeIndexAt(flat, end, true);
  const range = doc.createRange();
  range.setStart(flat.nodes[a], start - flat.starts[a]);
  range.setEnd(flat.nodes[b], end - flat.starts[b]);
  return range;
}

/** Word-like segment of `text` covering index `i`, or null. */
export function wordAt(text: string, i: number): { start: number; end: number } | null {
  if (i < 0 || i >= text.length) return null;
  const from = Math.max(0, i - WORD_WINDOW);
  const slice = text.slice(from, i + WORD_WINDOW);
  const seg = wordSegmenter.segment(slice).containing(i - from);
  if (!seg || !seg.isWordLike || !/\p{L}/u.test(seg.segment)) return null;
  return { start: from + seg.index, end: from + seg.index + seg.segment.length };
}

/** Sentence around [start, end), with line breaks and end-of-line hyphens joined. */
export function sentenceAround(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SENTENCE_WINDOW);
  // Same-length replacements keep `start - from` valid inside the slice.
  const slice = text
    .slice(from, end + SENTENCE_WINDOW)
    .replace(/(\p{L})-\n(\p{Ll})|(\p{Lu})-\n(\p{Lu})/gu, (_m, a, b, c, d) => `${a ?? c}­­${b ?? d}`)
    .replace(/\n/g, " ");
  const seg = sentenceSegmenter.segment(slice).containing(start - from);
  let sentence = (seg?.segment ?? slice).replace(/­/g, "").replace(/\s+/g, " ").trim();
  if (sentence.length > MAX_SENTENCE) {
    const word = text.slice(start, end);
    const at = Math.max(0, sentence.indexOf(word) - MAX_SENTENCE / 2);
    sentence = "…" + sentence.slice(at, at + MAX_SENTENCE).trim() + "…";
  }
  return sentence;
}

const isCaps = (s: string) => /^\p{Lu}+$/u.test(s);

/**
 * A word broken over two lines ("infor-\nmation", or all-caps comic lettering
 * "OVER-\nCOMING"): grow [start, end) to the whole word.
 */
export function joinHyphenated(text: string, start: number, end: number): { start: number; end: number } {
  const word = text.slice(start, end);
  const after = /^-\n(\p{L}+)/u.exec(text.slice(end, end + 40));
  if (after && (/^\p{Ll}/u.test(after[1]) || (isCaps(word) && isCaps(after[1])))) end += after[0].length;
  const before = /(\p{L}+)-\n$/u.exec(text.slice(Math.max(0, start - 40), start));
  if (before && (/^\p{Ll}/u.test(word) || (isCaps(word) && isCaps(before[1])))) start -= before[0].length;
  return { start, end };
}

function hit(rect: DOMRect, x: number, y: number): boolean {
  return (
    x >= rect.left - HIT_SLOP &&
    x <= rect.right + HIT_SLOP &&
    y >= rect.top - HIT_SLOP &&
    y <= rect.bottom + HIT_SLOP
  );
}

/**
 * The word at client point (x, y) of `doc`, or null if the point isn't on a word.
 */
export function wordAtPoint(doc: Document, x: number, y: number): TappedWord | null {
  const caret = caretAt(doc, x, y);
  if (!caret) return null;
  const root = caret.node.parentElement?.closest(CONTEXT_ROOTS) ?? caret.node.parentElement;
  if (!root) return null;

  const flat = flattenText(root);
  const nodeIdx = flat.nodes.indexOf(caret.node);
  if (nodeIdx < 0) return null;
  const i = flat.starts[nodeIdx] + caret.offset;

  // The caret can land just after the last letter, so also try the char before it.
  for (const at of [i, i - 1]) {
    const bounds = wordAt(flat.text, at);
    if (!bounds) continue;
    const range = rangeFor(flat, bounds.start, bounds.end);
    const rect = Array.from(range.getClientRects()).find((r) => hit(r, x, y));
    if (!rect) continue;

    const full = joinHyphenated(flat.text, bounds.start, bounds.end);
    const word = flat.text.slice(full.start, full.end).replace(/-\n/, "");
    return { word, sentence: sentenceAround(flat.text, full.start, full.end), range, rect };
  }
  return null;
}
