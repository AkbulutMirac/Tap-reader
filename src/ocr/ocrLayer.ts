import type { OcrWord } from "../db";

let measureCtx: CanvasRenderingContext2D | null = null;
const FONT = "sans-serif";

/**
 * Render OCR words as an invisible, selectable text layer over an image (like PDF.js does for
 * real PDF text), so the normal tap-a-word code works on scanned pages and comics.
 * Each block (paragraph / speech bubble) becomes its own element, so a tapped word's
 * "sentence" stays inside its bubble.
 */
export function renderOcrLayer(container: HTMLElement, words: OcrWord[]): void {
  const width = container.clientWidth;
  const height = container.clientHeight;
  container.replaceChildren();
  if (!width || !height || !words.length) return;
  measureCtx ??= document.createElement("canvas").getContext("2d");

  const groups = new Map<number, OcrWord[]>();
  for (const w of words) groups.set(w.group, [...(groups.get(w.group) ?? []), w]);

  for (const group of groups.values()) {
    const block = document.createElement("div");
    block.className = "ocr-bubble";
    group.forEach((w, i) => {
      const span = document.createElement("span");
      const next = group[i + 1];
      span.textContent = w.text + (next && next.line === w.line ? " " : "");
      const px = Math.max(4, w.h * height * 0.92);
      const targetW = w.w * width;
      measureCtx!.font = `${px}px ${FONT}`;
      const measured = measureCtx!.measureText(w.text).width || 1;
      span.style.cssText =
        `left:${w.x * 100}%;top:${w.y * 100}%;font-size:${px}px;` + `transform:scaleX(${(targetW / measured).toFixed(3)})`;
      block.append(span);
      if (!next || next.line !== w.line) block.append(document.createElement("br"));
    });
    container.append(block);
  }
}
