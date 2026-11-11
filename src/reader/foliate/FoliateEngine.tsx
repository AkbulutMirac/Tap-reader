import { Spinner } from "@heroui/react";
import type { FoliateBook, FoliateRelocate, FoliateTocItem, View } from "foliate-js/view.js";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { Highlight } from "../../db";
import { makeCover } from "../../library/books";
import type { Settings } from "../../settings";
import { attachWordTap } from "../../tap/useWordTap";
import { PAGE_COLORS, type EffectiveTheme } from "../../theme";
import { clearSavedWordMarks, markSavedWords, SAVED_WORD_CSS } from "../savedWordMarks";
import { zoneOf, type EngineHandle, type EngineProps, type TocItem } from "../types";
import { documentToHtml, htmlToBook } from "./docBook";

const HIGHLIGHT_COLORS: Record<Highlight["color"], string> = {
  yellow: "#facc15",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
};

const FONTS: Record<Settings["font"], string | null> = {
  publisher: null,
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

function readerCss(settings: Settings, theme: EffectiveTheme): string {
  const c = PAGE_COLORS[theme];
  const font = FONTS[settings.font];
  const forceColors = theme !== "light";
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html { color-scheme: ${theme === "dark" ? "dark" : "light"}; font-size: ${settings.fontSize}% !important; }
    html, body { ${forceColors ? `background: ${c.bg} !important; color: ${c.fg} !important;` : ""} }
    ${forceColors ? `body * { color: inherit !important; background-color: transparent !important; border-color: ${c.fg}33 !important; }` : ""}
    a:any-link { color: ${c.link} !important; }
    p, li, blockquote, dd, div { line-height: ${settings.lineHeight} !important; }
    p { text-align: start; hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    ${font ? `body, body p, body div, body span, body li, body td { font-family: ${font} !important; }` : ""}
    img, svg { ${theme === "dark" ? "filter: brightness(0.85);" : ""} }
    ${SAVED_WORD_CSS}
  `;
}

const toToc = (items: FoliateTocItem[] | undefined): TocItem[] =>
  (items ?? []).map((i) => ({ label: i.label?.trim() || "—", location: i.href, subitems: toToc(i.subitems) }));

const textOf = (v: unknown): string | undefined => {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).filter(Boolean).join(", ") || undefined;
  if (v && typeof v === "object") {
    const o = v as { name?: unknown; en?: string };
    if (o.name) return textOf(o.name);
    return o.en ?? (Object.values(o).find((x) => typeof x === "string") as string | undefined);
  }
  return undefined;
};

/** Converts a rect inside a book iframe to top-level viewport coordinates. */
function toTopRect(doc: Document, r: DOMRect): DOMRect {
  const frame = doc.defaultView?.frameElement as HTMLElement | null;
  if (!frame) return r;
  const fr = frame.getBoundingClientRect();
  const scale = frame.offsetWidth ? fr.width / frame.offsetWidth : 1;
  return new DOMRect(fr.left + r.left * scale, fr.top + r.top * scale, r.width * scale, r.height * scale);
}

export default function FoliateEngine(props: EngineProps & { ref?: Ref<EngineHandle> }) {
  const { file, book, initialLocation, settings, theme, highlights, savedWords, ref } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const highlightsRef = useRef(highlights);
  highlightsRef.current = highlights;
  const savedRef = useRef(savedWords);
  savedRef.current = savedWords;

  // Open the book once per file.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: View | null = null;

    (async () => {
      const { makeBook } = await import("foliate-js/view.js");
      let fbook: FoliateBook;
      if (book.format === "doc" || book.format === "article") {
        const { html, title } = await documentToHtml(file, book.format === "article" ? "article.html" : book.fileName);
        fbook = htmlToBook(html, title ?? book.title);
      } else {
        fbook = await makeBook(new File([file], book.fileName, { type: file.type }));
      }
      if (cancelled) return;

      view = document.createElement("foliate-view") as View;
      view.style.cssText = "display:block;width:100%;height:100%";
      host.replaceChildren(view);
      viewRef.current = view;

      view.addEventListener("load", ((e: CustomEvent<{ doc: Document; index: number }>) => {
        const { doc } = e.detail;
        attachWordTap(doc.documentElement, (tapped, ev) => {
          if ((ev.target as Element | null)?.closest?.("a[href]")) return;
          const frame = doc.defaultView?.frameElement as HTMLElement | null;
          const left = frame ? toTopRect(doc, new DOMRect(ev.clientX, 0, 0, 0)).left : ev.clientX;
          if (tapped) cb.current.onWordTap({ word: tapped.word, sentence: tapped.sentence, rect: toTopRect(doc, tapped.rect) });
          else cb.current.onBackgroundTap(zoneOf(left));
        });
        doc.addEventListener("selectionchange", () => {
          const sel = doc.getSelection();
          cb.current.onSelectionChange(!!sel && !sel.isCollapsed);
        });
        doc.addEventListener("keydown", (ev) => {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: ev.key, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey }));
        });
        doc.addEventListener("scroll", () => cb.current.onMove(), { passive: true });
        if (doc.body) markSavedWords(doc, doc.body, savedRef.current);
      }) as EventListener);

      let lastCfi = "";
      view.addEventListener("relocate", ((e: CustomEvent<FoliateRelocate>) => {
        const d = e.detail;
        // The paginator "snaps" after every touch, even a tap; only a real move closes popups.
        if (d.cfi === lastCfi) return;
        lastCfi = d.cfi;
        cb.current.onMove();
        const fraction = Number.isFinite(d.fraction) ? d.fraction : 0;
        cb.current.onRelocate({
          location: d.cfi,
          fraction,
          label: d.tocItem?.label?.trim() || d.pageItem?.label || `${Math.round(fraction * 100)}%`,
        });
      }) as EventListener);

      view.addEventListener("draw-annotation", ((
        e: CustomEvent<{ draw: (f: unknown, o: unknown) => void; annotation: { color?: string } }>,
      ) => {
        void import("foliate-js/overlayer.js").then(({ Overlayer }) =>
          e.detail.draw(Overlayer.highlight, { color: e.detail.annotation.color }),
        );
      }) as EventListener);

      view.addEventListener("create-overlay", () => {
        for (const h of highlightsRef.current) void view?.addAnnotation({ value: h.location, color: HIGHLIGHT_COLORS[h.color] });
      });

      await view.open(fbook);
      if (cancelled) return;
      applyLayout(view, cb.current.settings, cb.current.theme);
      await view.init({ lastLocation: initialLocation, showTextStart: !initialLocation });
      if (cancelled) return;
      setReady(true);

      const cover = book.cover ? undefined : await fbook.getCover?.().then((b) => (b ? makeCover(b) : undefined)).catch(() => undefined);
      cb.current.onReady({
        toc: toToc(fbook.toc),
        title: textOf(fbook.metadata?.title),
        author: textOf(fbook.metadata?.author),
        cover,
        paged: true,
      });
    })().catch((err: unknown) => {
      console.error(err);
      if (!cancelled) setError((err as Error)?.message ?? String(err));
    });

    return () => {
      cancelled = true;
      view?.close();
      view?.remove();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reopen only for a new file
  }, [file]);

  // Display settings and theme.
  useEffect(() => {
    if (viewRef.current && ready) applyLayout(viewRef.current, settings, theme);
  }, [ready, settings, theme]);

  // Highlights: add new ones, remove deleted ones.
  const shown = useRef(new Map<string, string>());
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready) return;
    const next = new Map(highlights.map((h) => [h.location, HIGHLIGHT_COLORS[h.color]]));
    for (const [loc] of shown.current) if (!next.has(loc)) void view.deleteAnnotation({ value: loc });
    for (const [loc, color] of next) if (shown.current.get(loc) !== color) void view.addAnnotation({ value: loc, color });
    shown.current = next;
  }, [highlights, ready]);

  // Saved-word underlines.
  useEffect(() => {
    for (const { doc } of viewRef.current?.renderer?.getContents?.() ?? []) {
      clearSavedWordMarks(doc);
      if (doc.body) markSavedWords(doc, doc.body, savedWords);
    }
  }, [savedWords]);

  useImperativeHandle(
    ref,
    (): EngineHandle => ({
      next: () => void viewRef.current?.next(),
      prev: () => void viewRef.current?.prev(),
      goTo: (location) => void viewRef.current?.goTo(location),
      goToFraction: (f) => void viewRef.current?.goToFraction(f),
      async search(query, onHit, signal) {
        const view = viewRef.current;
        if (!view || !query.trim()) return;
        for await (const r of view.search({ query })) {
          if (signal.aborted) break;
          if (r === "done") break;
          if ("subitems" in r) {
            for (const s of r.subitems) onHit({ location: s.cfi, ...s.excerpt, label: r.label });
          } else if ("cfi" in r) {
            onHit({ location: r.cfi, ...r.excerpt });
          }
        }
      },
      clearSearch: () => viewRef.current?.clearSearch(),
      getSelection() {
        const view = viewRef.current;
        for (const { doc, index } of view?.renderer.getContents() ?? []) {
          const sel = doc.getSelection();
          if (!sel || sel.isCollapsed) continue;
          const range = sel.getRangeAt(0);
          const text = sel.toString().replace(/\s+/g, " ").trim();
          if (!text) continue;
          const block = (range.startContainer.parentElement?.closest("p, li, blockquote, div") ?? null) as HTMLElement | null;
          return {
            location: view!.getCFI(index, range),
            text,
            sentence: block?.textContent?.replace(/\s+/g, " ").trim().slice(0, 400) ?? text,
            rect: toTopRect(doc, range.getBoundingClientRect()),
          };
        }
        return null;
      },
      clearSelection: () => viewRef.current?.deselect(),
    }),
    [],
  );

  return (
    <div className="relative h-full" data-reader>
      {/* Clicks that reach here missed the book pages (those are inside iframes). */}
      <div ref={hostRef} className="foliate-host h-full" onClick={(e) => cb.current.onBackgroundTap(zoneOf(e.clientX))} />
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && <div className="absolute inset-0 p-6 text-center text-danger">Couldn't open this file: {error}</div>}
    </div>
  );
}

function applyLayout(view: View, settings: Settings, theme: EffectiveTheme) {
  const r = view.renderer;
  if (!r) return;
  if (!view.isFixedLayout) {
    r.setAttribute("flow", settings.flow);
    r.setAttribute("gap", `${settings.margin}%`);
    r.setAttribute("margin", "40px");
    r.setAttribute("max-inline-size", "720px");
    r.setAttribute("max-column-count", "2");
  }
  r.setStyles?.(readerCss(settings, theme));
}
