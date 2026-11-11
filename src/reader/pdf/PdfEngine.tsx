import { Spinner, toast } from "@heroui/react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { db, type OcrWord } from "../../db";
import { makeCover } from "../../library/books";
import { showTapResult } from "../../ocr/showTapResult";
import { ocrAtTap } from "../../ocr/tapOcr";
import { updateSettings } from "../../settings";
import { useScrollPinch } from "../zoom";
import { useWordTap } from "../../tap/useWordTap";
import { clearSavedWordMarks, markSavedWords } from "../savedWordMarks";
import { zoneOf, type EngineHandle, type EngineProps, type SearchHit, type TocItem } from "../types";
import { PdfPage, parsePdfRange, type PdfRange } from "./PdfPage";
import { openPdf, type PDFDocumentProxy } from "./pdfjs";

/** Widest a page gets at zoom 1 on large screens (CSS px). */
const MAX_PAGE_WIDTH = 960;
const SIDE_GUTTER = 16;
const EXCERPT = 40;

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>[number];

async function outlineToToc(pdf: PDFDocumentProxy, nodes: OutlineNode[] | null): Promise<TocItem[]> {
  const out: TocItem[] = [];
  for (const node of nodes ?? []) {
    let page = 1;
    try {
      const dest = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
      if (dest?.[0]) page = (await pdf.getPageIndex(dest[0] as Parameters<PDFDocumentProxy["getPageIndex"]>[0])) + 1;
    } catch {
      // Unresolvable entry: keep it, pointing at page 1.
    }
    out.push({ label: node.title, location: String(page), subitems: await outlineToToc(pdf, node.items) });
  }
  return out;
}

export default function PdfEngine(props: EngineProps & { ref?: Ref<EngineHandle> }) {
  const { file, book, initialLocation, settings, highlights, savedWords, ref } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [baseSize, setBaseSize] = useState({ width: 612, height: 792 });
  const [containerWidth, setContainerWidth] = useState(0);
  const callbacks = useRef(props);
  callbacks.current = props;
  const savedRef = useRef(savedWords);
  savedRef.current = savedWords;
  const currentPage = useRef(1);

  // Open the document, report title/TOC/cover.
  useEffect(() => {
    let cancelled = false;
    const task = (async () => {
      const t = openPdf(await file.arrayBuffer());
      return t;
    })();
    task
      .then(async (t) => {
        const d = await t.promise;
        const first = await d.getPage(1);
        if (cancelled) return;
        const vp = first.getViewport({ scale: 1 });
        setBaseSize({ width: vp.width, height: vp.height });
        setPdf(d);

        const [meta, outline] = await Promise.all([d.getMetadata().catch(() => null), d.getOutline().catch(() => null)]);
        const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
        let cover: string | undefined;
        if (!book.cover) {
          const small = first.getViewport({ scale: 240 / vp.width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(small.width);
          canvas.height = Math.ceil(small.height);
          await first.render({ canvas, viewport: small }).promise;
          cover = await makeCover(canvas);
        }
        if (cancelled) return;
        callbacks.current.onReady({
          toc: await outlineToToc(d, outline),
          title: info.Title,
          author: info.Author,
          cover,
          paged: false,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error)?.message ?? String(err));
      });
    return () => {
      cancelled = true;
      setPdf(null);
      void task.then((t) => t.destroy());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reopen only for a new file
  }, [file]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      setContainerWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitScale = containerWidth ? Math.min(containerWidth - SIDE_GUTTER, MAX_PAGE_WIDTH) / baseSize.width : 0;
  const scale = fitScale * settings.pdfZoom;

  const pageEl = (n: number) => scrollRef.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
  const goToPage = (n: number) => {
    if (!pdf) return;
    const page = Math.min(Math.max(1, Math.round(n)), pdf.numPages);
    const el = pageEl(page);
    if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop - 8;
  };

  // Restore the last position once pages are laid out; only then start reporting positions.
  const restored = useRef(false);
  const report = useRef<() => void>(() => {});
  useEffect(() => {
    if (!pdf || !scale || restored.current) return;
    const page = Number(initialLocation);
    requestAnimationFrame(() => {
      if (page > 1) goToPage(page);
      restored.current = true;
      report.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, scale]);

  // Pinch zoom: scales the pages while pinching, then re-renders them at the new size.
  const pagesRef = useRef<HTMLDivElement>(null);
  const pinched = useRef(false);
  const pinch = useScrollPinch(
    scrollRef,
    pagesRef,
    settings.pdfZoom,
    (z) => {
      pinched.current = true;
      updateSettings({ pdfZoom: z });
    },
    { min: 0.5, max: 5, onGesture: () => callbacks.current.onMove() },
  );

  // Keep the same page in view when the zoom (buttons) or width changes; a pinch keeps its own spot.
  useEffect(() => {
    if (pinched.current) {
      pinched.current = false;
      return;
    }
    if (restored.current && pdf) requestAnimationFrame(() => goToPage(currentPage.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Report the page at the middle of the screen while scrolling.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pdf) return;
    let frame = 0;
    let reported = false;
    report.current = () => {
      if (!restored.current) return;
      const mid = el.scrollTop + el.clientHeight * 0.4;
      const pages = el.querySelectorAll<HTMLElement>("[data-page]");
      let lo = 0;
      let hi = pages.length - 1;
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1;
        if (pages[m].offsetTop <= mid) lo = m;
        else hi = m - 1;
      }
      const page = lo + 1;
      if (page === currentPage.current && reported) return;
      reported = true;
      currentPage.current = page;
      const n = pdf.numPages;
      callbacks.current.onRelocate({
        location: String(page),
        fraction: n > 1 ? (page - 1) / (n - 1) : 1,
        label: `p. ${page} / ${n}`,
      });
    };
    const onScroll = () => {
      callbacks.current.onMove();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report.current);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [pdf]);

  // Re-mark saved words on rendered pages when the word list changes.
  useEffect(() => {
    clearSavedWordMarks(document);
    scrollRef.current
      ?.querySelectorAll(".textLayer, .ocr-layer")
      .forEach((layer) => markSavedWords(document, layer, savedWords));
  }, [savedWords]);

  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection();
      const inside = !!sel && !sel.isCollapsed && !!scrollRef.current?.contains(sel.anchorNode);
      callbacks.current.onSelectionChange(inside);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  // OCR text of scanned pages, from the cache and from taps.
  const [ocr, setOcr] = useState<Map<number, OcrWord[]>>(new Map());
  const [scanning, setScanning] = useState<DOMRect | null>(null);
  useEffect(() => {
    void db.ocr
      .where("key")
      .startsWith(`${book.id}:`)
      .toArray()
      .then((rows) => setOcr(new Map(rows.map((r) => [Number(r.key.split(":")[1]), r.words]))));
  }, [book.id]);

  // High-resolution renders of scanned pages for OCR (the last few only; they're large).
  const ocrImages = useRef(new Map<number, Promise<HTMLCanvasElement>>());
  const ocrImage = (n: number) => {
    let p = ocrImages.current.get(n);
    if (!p) {
      p = (async () => {
        const page = await pdf!.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(4, 2200 / base.width) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvas, viewport }).promise;
        return canvas;
      })();
      ocrImages.current.set(n, p);
      for (const key of [...ocrImages.current.keys()].slice(0, -3)) ocrImages.current.delete(key);
    }
    return p;
  };

  /**
   * Tap on a scanned page (no text layer): read the speech bubble under the finger (comics),
   * or the whole page the first time (book scans), then look up the tapped word.
   */
  const ocrTap = async (n: number, pageBox: DOMRect, x: number, y: number) => {
    if (!pdf) return;
    const tx = (x - pageBox.left) / pageBox.width;
    const ty = (y - pageBox.top) / pageBox.height;
    const existing = ocr.get(n) ?? [];
    setScanning(new DOMRect(x - 30, y - 14, 60, 28));
    // Whole-page reading takes a few seconds; say so if it's taking a while.
    let toastId: string | undefined;
    const slow = setTimeout(() => (toastId = toast("Reading the text on this page…", { timeout: 0 })), 700);
    try {
      const result = await ocrAtTap(await ocrImage(n), tx, ty, existing, true);
      if (result.kind === "none") {
        callbacks.current.onBackgroundTap(zoneOf(x));
        return;
      }
      const shown = await showTapResult(
        result,
        { x, y },
        pageBox,
        (added) => {
          const words = [...existing, ...added];
          setOcr((m) => new Map(m).set(n, words));
          void db.ocr.put({ key: `${book.id}:${n}`, words });
        },
        (t) => callbacks.current.onWordTap(t),
      );
      if (!shown) toast(result.kind === "page" ? "No text found on this page." : "Couldn't read any text there.");
    } catch (err) {
      toast.danger("Text recognition failed", { description: (err as Error).message });
    } finally {
      clearTimeout(slow);
      if (toastId) toast.close(toastId);
      setScanning(null);
    }
  };

  useWordTap(scrollRef, (tapped, e) => {
    if (pinch.consumeGesture()) return;
    if (tapped) {
      callbacks.current.onWordTap({ word: tapped.word, sentence: tapped.sentence, rect: tapped.rect });
      return;
    }
    const pageDiv = (e.target as Element).closest<HTMLElement>("[data-page]");
    if (pageDiv?.dataset.scanned === "1" && settings.ocr && !scanning) {
      void ocrTap(Number(pageDiv.dataset.page), pageDiv.getBoundingClientRect(), e.clientX, e.clientY);
      return;
    }
    callbacks.current.onBackgroundTap(zoneOf(e.clientX));
  });

  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      next: () => scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.9, behavior: "smooth" }),
      prev: () => scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * 0.9, behavior: "smooth" }),
      goTo: (location) => {
        const range = parsePdfRange(location);
        goToPage(range ? range.p : Number(location));
      },
      goToFraction: (f) => pdf && goToPage(1 + f * (pdf.numPages - 1)),
      async search(query, onHit, signal) {
        if (!pdf || !query.trim()) return;
        const q = query.toLowerCase();
        for (let p = 1; p <= pdf.numPages && !signal.aborted; p++) {
          const content = await (await pdf.getPage(p)).getTextContent();
          const text = content.items
            .map((it) => ("str" in it ? it.str + (it.hasEOL ? " " : "") : ""))
            .join("")
            .replace(/\s+/g, " ");
          const lower = text.toLowerCase();
          for (let i = lower.indexOf(q); i >= 0 && !signal.aborted; i = lower.indexOf(q, i + q.length)) {
            const hit: SearchHit = {
              location: String(p),
              pre: text.slice(Math.max(0, i - EXCERPT), i),
              match: text.slice(i, i + q.length),
              post: text.slice(i + q.length, i + q.length + EXCERPT),
              label: `p. ${p}`,
            };
            onHit(hit);
          }
        }
      },
      clearSearch: () => {},
      getSelection() {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !scrollRef.current?.contains(sel.anchorNode)) return null;
        const range = sel.getRangeAt(0);
        const page = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>("[data-page]");
        if (!page) return null;
        const box = page.getBoundingClientRect();
        const rects = Array.from(range.getClientRects())
          .filter((r) => r.width > 1 && r.height > 1 && r.top < box.bottom && r.bottom > box.top)
          .map((r): PdfRange["r"][number] => [
            (r.left - box.left) / box.width,
            (r.top - box.top) / box.height,
            r.width / box.width,
            r.height / box.height,
          ]);
        const text = sel.toString().replace(/\s+/g, " ").trim();
        const location: PdfRange = { p: Number(page.dataset.page), r: rects };
        return { location: JSON.stringify(location), text, sentence: text, rect: range.getBoundingClientRect() };
      },
      clearSelection: () => document.getSelection()?.removeAllRanges(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pdf],
  );

  const highlightsByPage = useMemo(() => {
    const map = new Map<number, { color: (typeof highlights)[number]["color"]; rects: PdfRange["r"] }[]>();
    for (const h of highlights) {
      const r = parsePdfRange(h.location);
      if (!r) continue;
      map.set(r.p, [...(map.get(r.p) ?? []), { color: h.color, rects: r.r }]);
    }
    return map;
  }, [highlights]);

  return (
    <div
      ref={scrollRef}
      data-reader
      className="pdf-scroll h-full touch-pan-x touch-pan-y overflow-auto overscroll-contain px-2 py-3"
    >
      {error && <div className="p-6 text-center text-danger">Couldn't open this PDF: {error}</div>}
      {!pdf && !error && (
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      )}
      <div ref={pagesRef} className="w-max min-w-full">
        {pdf &&
          scale > 0 &&
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage
              key={i}
              pdf={pdf}
              pageNumber={i + 1}
              scale={scale}
              fallbackSize={baseSize}
              scrollRoot={scrollRef}
              highlights={highlightsByPage.get(i + 1) ?? []}
              savedWords={savedRef}
              ocrWords={ocr.get(i + 1)}
            />
          ))}
      </div>
      {scanning && (
        <div
          className="word-mark is-loading"
          style={{ left: scanning.left, top: scanning.top, width: scanning.width, height: scanning.height }}
        />
      )}
    </div>
  );
}
