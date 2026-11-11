import { Spinner, toast } from "@heroui/react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import { db, type OcrWord } from "../../db";
import { makeCover } from "../../library/books";
import { renderOcrLayer } from "../../ocr/ocrLayer";
import { showTapResult } from "../../ocr/showTapResult";
import { ocrAtTap } from "../../ocr/tapOcr";
import { wordAtPoint } from "../../tap/wordAtPoint";
import { updateSettings } from "../../settings";
import { zoneOf, type EngineHandle, type EngineProps } from "../types";
import { usePanZoom, useScrollPinch } from "../zoom";
import { openComic, type ComicPage } from "./archive";


/** Comics (CBZ/CBR/CB7) and single images, with OCR on tap. */
export default function ComicEngine(props: EngineProps & { ref?: Ref<EngineHandle> }) {
  const { file, book, initialLocation, settings, ref } = props;
  const isPhoto = book.format === "image";
  const scrolled = settings.flow === "scrolled" && !isPhoto;
  const [pages, setPages] = useState<ComicPage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(() => Math.max(0, Number(initialLocation) || 0));
  const [ocr, setOcr] = useState<Map<number, OcrWord[]>>(new Map());
  const [scanning, setScanning] = useState<DOMRect | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cb = useRef(props);
  cb.current = props;
  const bitmaps = useRef(new Map<number, Promise<ImageBitmap>>());
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    openComic(file, book.fileName)
      .then(async (p) => {
        if (cancelled) return;
        if (!p.length) throw new Error("No images found in this file.");
        setPages(p);
        const cover = book.cover ? undefined : await p[0].load().then((b) => makeCover(b)).catch(() => undefined);
        cb.current.onReady({ toc: [], cover, paged: !isPhoto });
      })
      .catch((err: unknown) => !cancelled && setError((err as Error)?.message ?? String(err)));
    const saved = bitmaps.current;
    return () => {
      cancelled = true;
      for (const b of saved.values()) void b.then((x) => x.close()).catch(() => {});
      saved.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Cached OCR results for this book.
  useEffect(() => {
    if (!pages) return;
    void db.ocr
      .where("key")
      .startsWith(`${book.id}:`)
      .toArray()
      .then((rows) => setOcr(new Map(rows.map((r) => [Number(r.key.split(":")[1]), r.words]))));
  }, [pages, book.id]);

  const total = pages?.length ?? 0;
  const go = useCallback(
    (i: number) => {
      if (!total) return;
      const n = Math.min(total - 1, Math.max(0, i));
      setIndex(n);
      if (scrolled) scrollRef.current?.querySelector(`[data-index="${n}"]`)?.scrollIntoView();
    },
    [total, scrolled],
  );

  useEffect(() => {
    if (!total) return;
    cb.current.onMove();
    cb.current.onRelocate({ location: String(index), fraction: total > 1 ? index / (total - 1) : 1, label: `${index + 1} / ${total}` });
  }, [index, total]);

  // Scrolled mode: the page at the middle of the screen is the current one.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scrolled || !total) return;
    requestAnimationFrame(() => el.querySelector(`[data-index="${index}"]`)?.scrollIntoView());
    const onScroll = () => {
      cb.current.onMove();
      const mid = el.scrollTop + el.clientHeight / 2;
      const items = el.querySelectorAll<HTMLElement>("[data-index]");
      for (const item of items) {
        if (item.offsetTop + item.offsetHeight > mid) {
          const i = Number(item.dataset.index);
          setIndex((cur) => (cur === i ? cur : i));
          break;
        }
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrolled, total]);

  /** Decoded page images for OCR; only the last few are kept (each is several MB). */
  const bitmap = (i: number) => {
    let p = bitmaps.current.get(i);
    if (!p) {
      p = pages![i].load().then((b) => createImageBitmap(b));
      bitmaps.current.set(i, p);
      for (const [key, old] of [...bitmaps.current].slice(0, -3)) {
        bitmaps.current.delete(key);
        void old.then((x) => x.close()).catch(() => {});
      }
    }
    return p;
  };

  const saveOcr = (i: number, words: OcrWord[]) => {
    setOcr((m) => new Map(m).set(i, words));
    void db.ocr.put({ key: `${book.id}:${i}`, words });
  };

  // Paged: pinch to zoom, drag when zoomed, swipe to turn pages. Scrolled: pinch changes the width.
  const pageBoxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panZoom = usePanZoom(scrollRef, pageBoxRef, {
    enabled: !scrolled && !!pages,
    // Landscape (tablet sideways): page at full width so the lettering is readable; drag down.
    fitWidth: () => !!scrollRef.current && scrollRef.current.clientWidth > scrollRef.current.clientHeight * 1.1,
    onSwipe: (dir) => go(index + dir),
    onGesture: () => cb.current.onMove(),
  });
  const scrollPinch = useScrollPinch(scrollRef, listRef, settings.pdfZoom, (z) => updateSettings({ pdfZoom: z }), {
    enabled: scrolled && !!pages,
    min: 1,
    max: 4,
    onGesture: () => cb.current.onMove(),
  });
  useEffect(() => panZoom.reset(), [index, panZoom]);

  const onClick = async (e: React.MouseEvent) => {
    if (panZoom.consumeGesture() || scrollPinch.consumeGesture()) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed) return;
    const tapped = wordAtPoint(document, e.clientX, e.clientY);
    if (tapped) {
      cb.current.onWordTap({ word: tapped.word, sentence: tapped.sentence, rect: tapped.rect });
      return;
    }
    const pageEl = (e.target as Element).closest<HTMLElement>("[data-index]");
    const img = pageEl?.querySelector("img");
    const r = img?.getBoundingClientRect();
    const zone = zoneOf(e.clientX);
    if (!pageEl || !img || !r || !cb.current.settings.ocr || busy.current) return cb.current.onBackgroundTap(zone);
    const tx = (e.clientX - r.left) / r.width;
    const ty = (e.clientY - r.top) / r.height;
    if (tx < 0 || ty < 0 || tx > 1 || ty > 1) return cb.current.onBackgroundTap(zone);

    const i = Number(pageEl.dataset.index);
    const existing = ocr.get(i) ?? [];
    const { clientX, clientY } = e;

    busy.current = true;
    setScanning(isPhoto && !existing.length ? r : new DOMRect(clientX - 30, clientY - 14, 60, 28));
    try {
      // Comics: read the speech bubble under the finger. Photos: read the whole image once.
      const result = await ocrAtTap(await bitmap(i), tx, ty, existing, isPhoto);
      if (result.kind === "none") {
        // Not on a speech bubble: behave like a normal tap (turn page / show toolbar).
        cb.current.onBackgroundTap(zone);
        return;
      }
      const shown = await showTapResult(
        result,
        { x: clientX, y: clientY },
        r,
        (added) => saveOcr(i, [...existing, ...added]),
        (t) => cb.current.onWordTap(t),
      );
      if (!shown) toast(result.kind === "page" ? "No text found in this image." : "Couldn't read any text there.");
    } catch (err) {
      console.error(err);
      toast.danger("Text recognition failed", { description: (err as Error).message });
    } finally {
      busy.current = false;
      setScanning(null);
    }
  };

  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      next: () => (scrolled ? scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.9, behavior: "smooth" }) : go(index + 1)),
      prev: () => (scrolled ? scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * 0.9, behavior: "smooth" }) : go(index - 1)),
      goTo: (location) => go(Number(location) || 0),
      goToFraction: (f) => go(Math.round(f * (total - 1))),
      async search(query, onHit) {
        const q = query.toLowerCase();
        for (const [i, words] of [...ocr].sort((a, b) => a[0] - b[0])) {
          const text = words.map((w) => w.text).join(" ");
          const at = text.toLowerCase().indexOf(q);
          if (at >= 0) onHit({ location: String(i), pre: text.slice(Math.max(0, at - 30), at), match: text.slice(at, at + q.length), post: text.slice(at + q.length, at + q.length + 30), label: `Page ${i + 1}` });
        }
      },
      clearSearch: () => {},
      getSelection: () => null,
      clearSelection: () => document.getSelection()?.removeAllRanges(),
    }),
    [go, index, total, scrolled, ocr],
  );

  if (error) return <div className="p-6 text-center text-danger">Couldn't open this file: {error}</div>;
  if (!pages) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-reader
      className={`comic-view relative h-full overscroll-contain ${
        scrolled ? "touch-pan-x touch-pan-y overflow-auto" : "flex touch-none overflow-hidden"
      }`}
      onClick={onClick}
    >
      {scrolled ? (
        <div ref={listRef} className="min-w-full">
          {pages.map((p, i) => (
            <ComicPageView key={i} page={p} index={i} words={ocr.get(i) ?? []} zoom={settings.pdfZoom} scrolled />
          ))}
        </div>
      ) : (
        <ComicPageView
          key={index}
          page={pages[index]}
          index={index}
          words={ocr.get(index) ?? []}
          zoom={1}
          scrolled={false}
          boxRef={pageBoxRef}
          onImageLoad={() => panZoom.reset()}
        />
      )}
      {!scrolled && pages[index + 1] && <Preload page={pages[index + 1]} />}
      {scanning && (
        <div
          className="word-mark is-loading"
          style={{ left: scanning.left, top: scanning.top, width: scanning.width, height: scanning.height }}
        />
      )}
    </div>
  );
}

function useObjectUrl(page: ComicPage): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let u: string | undefined;
    let cancelled = false;
    void page.load().then((b) => {
      if (cancelled) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [page]);
  return url;
}

function Preload({ page }: { page: ComicPage }) {
  const url = useObjectUrl(page);
  return url ? <img src={url} alt="" className="hidden" /> : null;
}

interface ComicPageViewProps {
  page: ComicPage;
  index: number;
  words: OcrWord[];
  /** Width factor in scrolled mode. */
  zoom: number;
  scrolled: boolean;
  /** The image box (paged mode): pinch zoom transforms this element. */
  boxRef?: RefObject<HTMLDivElement | null>;
  /** The page image finished loading (its size is known now). */
  onImageLoad?: () => void;
}

function ComicPageView({ page, index, words, zoom, scrolled, boxRef, onImageLoad }: ComicPageViewProps) {
  const url = useObjectUrl(page);
  const layerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth * 10000 + el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);

  useLayoutEffect(() => {
    if (layerRef.current) renderOcrLayer(layerRef.current, words);
  }, [words, size]);

  return (
    <div
      data-index={index}
      className={scrolled ? "mx-auto mb-2 w-fit" : "flex h-full w-full items-center justify-center"}
    >
      <div ref={boxRef} className="relative will-change-transform">
        {url ? (
          <img
            src={url}
            alt={`Page ${index + 1}`}
            draggable={false}
            onLoad={onImageLoad}
            className={scrolled ? "block max-w-none" : "block max-h-[calc(100dvh-8px)] max-w-full"}
            style={scrolled ? { width: `calc(min(100vw, 900px) * ${zoom})` } : undefined}
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center">
            <Spinner />
          </div>
        )}
        <div ref={layerRef} className="ocr-layer" />
      </div>
    </div>
  );
}
