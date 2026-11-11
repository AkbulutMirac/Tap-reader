/**
 * Dotted underline under words already in the word list, using the CSS Custom Highlight API
 * (no DOM changes, so text positions and highlights keep working). No-op where unsupported.
 */

const NAME = "tapreader-saved";

/** CSS to add inside a document so the underline shows. */
export const SAVED_WORD_CSS = `::highlight(${NAME}) { text-decoration: underline dotted 2px; text-decoration-color: #3b82f6; text-underline-offset: 3px; }`;

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

export function markSavedWords(doc: Document, root: Node, words: Set<string>): void {
  const registry = (doc.defaultView as (Window & typeof globalThis) | null)?.CSS?.highlights;
  const HighlightCtor = (doc.defaultView as (Window & { Highlight?: typeof Highlight }) | null)?.Highlight;
  if (!registry || !HighlightCtor) return;
  if (!words.size) {
    registry.delete(NAME);
    return;
  }
  const ranges: Range[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    for (const seg of wordSegmenter.segment(n.data)) {
      if (!seg.isWordLike) continue;
      const w = seg.segment.toLowerCase().replace(/[’']s$/, "");
      if (!words.has(w)) continue;
      const r = doc.createRange();
      r.setStart(n, seg.index);
      r.setEnd(n, seg.index + seg.segment.length);
      ranges.push(r);
    }
  }
  const existing = registry.get(NAME);
  if (existing) for (const r of ranges) existing.add(r);
  else registry.set(NAME, new HighlightCtor(...ranges));
}

export function clearSavedWordMarks(doc: Document): void {
  (doc.defaultView as (Window & typeof globalThis) | null)?.CSS?.highlights?.delete(NAME);
}
