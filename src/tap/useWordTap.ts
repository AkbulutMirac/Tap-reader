import { useEffect, useRef, type RefObject } from "react";
import { wordAtPoint, type TappedWord } from "./wordAtPoint";

export type TapHandler = (word: TappedWord | null, event: MouseEvent) => void;

/**
 * Call `onTap` for every single tap/click on `el`, with the word under it (or null).
 * Drags, text selections and double clicks are ignored.
 */
export function attachWordTap(el: HTMLElement, onTap: TapHandler): () => void {
  const doc = el.ownerDocument;
  const handler = (e: MouseEvent) => {
    if (e.button !== 0 || e.detail > 1) return;
    const selection = doc.getSelection();
    if (selection && !selection.isCollapsed) return;
    onTap(wordAtPoint(doc, e.clientX, e.clientY), e);
  };
  el.addEventListener("click", handler);
  return () => el.removeEventListener("click", handler);
}

export function useWordTap(ref: RefObject<HTMLElement | null>, onTap: TapHandler): void {
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;
  useEffect(() => {
    if (!ref.current) return;
    return attachWordTap(ref.current, (word, e) => onTapRef.current(word, e));
  }, [ref]);
}
