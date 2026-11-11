import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Highlight, OcrWord } from "../../db";
import { renderOcrLayer } from "../../ocr/ocrLayer";
import { markSavedWords } from "../savedWordMarks";
import { pdfjs, type PDFDocumentProxy, type RenderTask } from "./pdfjs";

/** Canvas resolution cap; higher DPRs cost a lot of memory on phones. */
const MAX_DPR = 2.5;

/** PDF highlight location: page + rects as fractions of the page size. */
export interface PdfRange {
  p: number;
  r: [x: number, y: number, w: number, h: number][];
}

export const parsePdfRange = (location: string): PdfRange | null => {
  try {
    const v = JSON.parse(location) as PdfRange;
    return typeof v?.p === "number" && Array.isArray(v.r) ? v : null;
  } catch {
    return null;
  }
};

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** CSS px per PDF unit. */
  scale: number;
  /** Size (at scale 1) to reserve before the page itself is loaded. */
  fallbackSize: { width: number; height: number };
  scrollRoot: RefObject<HTMLElement | null>;
  highlights: { color: Highlight["color"]; rects: PdfRange["r"] }[];
  savedWords: RefObject<Set<string>>;
  /** OCR text for scanned pages (pages without a text layer). */
  ocrWords?: OcrWord[];
}

/**
 * One PDF page: canvas, highlight overlay, and a transparent text layer (the text that taps hit).
 * Renders only while near the viewport and frees its canvas when far away.
 */
export function PdfPage({ pdf, pageNumber, scale, fallbackSize, scrollRoot, highlights, savedWords, ocrWords }: PdfPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const ocrRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState(fallbackSize);

  useLayoutEffect(() => {
    if (ocrRef.current && near) {
      renderOcrLayer(ocrRef.current, ocrWords ?? []);
      markSavedWords(document, ocrRef.current, savedWords.current);
    }
  }, [ocrWords, near, scale, size, savedWords]);

  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: scrollRoot.current,
      rootMargin: "150% 50%",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const host = hostRef.current;
    if (!near || !host) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | undefined;
    const canvas = document.createElement("canvas");
    const textDiv = document.createElement("div");
    textDiv.className = "textLayer";

    (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setSize({ width: base.width, height: base.height });

      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      host.replaceChildren(canvas, textDiv);

      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      textLayer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
      await textLayer.render();
      if (cancelled) return;
      // No real text: a scanned page. Taps on it trigger OCR (see PdfEngine).
      const scanned = !/\p{L}/u.test(textDiv.textContent ?? "");
      if (pageRef.current) pageRef.current.dataset.scanned = scanned ? "1" : "";
      markSavedWords(document, textDiv, savedWords.current);
      await renderTask.promise;
    })().catch((err: unknown) => {
      if (!cancelled && (err as Error)?.name !== "RenderingCancelledException") console.error(err);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      canvas.width = canvas.height = 0;
      host.replaceChildren();
    };
  }, [near, pdf, pageNumber, scale, savedWords]);

  return (
    <div
      ref={pageRef}
      className="pdf-page"
      data-page={pageNumber}
      style={
        {
          width: Math.floor(size.width * scale),
          height: Math.floor(size.height * scale),
          "--total-scale-factor": scale,
        } as React.CSSProperties
      }
    >
      <div ref={hostRef} className="pdf-layer-host" />
      <div ref={ocrRef} className="ocr-layer" />
      {highlights.length > 0 && (
        <div className="pdf-highlights">
          {highlights.flatMap((h, i) =>
            h.rects.map(([x, y, w, hgt], j) => (
              <div
                key={`${i}-${j}`}
                className={`hl hl-${h.color}`}
                style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${hgt * 100}%` }}
              />
            )),
          )}
        </div>
      )}
    </div>
  );
}
