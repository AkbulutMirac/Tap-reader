import type { OcrWord } from "../db";
import type { WordTap } from "../reader/types";
import { wordAtPoint } from "../tap/wordAtPoint";
import type { TapOcrResult } from "./tapOcr";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/**
 * After OCR for a tap: save new words (they render as a text layer), then show the tapped word
 * — at the tap itself, else at the word OCR snapped to, else the whole bubble as a phrase.
 * `pageBox` is the page/image on screen. Returns false when nothing could be shown.
 */
export async function showTapResult(
  result: Exclude<TapOcrResult, { kind: "none" }>,
  tap: { x: number; y: number },
  pageBox: DOMRect,
  save: (added: OcrWord[]) => void,
  show: (tap: WordTap) => void,
): Promise<boolean> {
  if (result.added.length) {
    save(result.added);
    await nextFrame();
  }
  const at = (x: number, y: number) => {
    const t = wordAtPoint(document, x, y);
    if (t) show({ word: t.word, sentence: t.sentence, rect: t.rect });
    return !!t;
  };
  if (at(tap.x, tap.y)) return true;
  if (result.kind === "text" && result.word) {
    const { x, y } = result.word;
    if (at(pageBox.left + x * pageBox.width, pageBox.top + y * pageBox.height)) return true;
  }
  if (result.kind === "text" && result.block) {
    const b = result.block;
    const rect = new DOMRect(pageBox.left + b.x * pageBox.width, pageBox.top + b.y * pageBox.height, b.w * pageBox.width, b.h * pageBox.height);
    if (b.text.trim()) {
      show({ word: b.text, sentence: b.text, rect, phrase: true });
      return true;
    }
  }
  return false;
}
