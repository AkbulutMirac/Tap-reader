import { Button, Drawer, Spinner, toast } from "@heroui/react";
import { useLiveQuery } from "dexie-react-hooks";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type Ref } from "react";
import { db, type Book, type Highlight } from "../db";
import { updateBookInfo } from "../library/books";
import { navigate } from "../router";
import { useSettings } from "../settings";
import { WordPopup, type PopupTarget } from "../tap/WordPopup";
import { useEffectiveTheme } from "../theme";
import {
  IconBack,
  IconBookmark,
  IconCopy,
  IconFullscreen,
  IconHighlight,
  IconLanguages,
  IconMore,
  IconNext,
  IconSearch,
  IconText,
  IconToc,
} from "../ui/icons";
import { DisplayPanel, MarksPanel, SearchPanel, TocPanel } from "./panels";
import type { EngineHandle, EngineInfo, EngineProps, Relocation, TapZone, WordTap } from "./types";
import { useNoBrowserZoom } from "./zoom";

type Engine = ComponentType<EngineProps & { ref?: Ref<EngineHandle> }>;
const PdfEngine = lazy(() => import("./pdf/PdfEngine"));
const FoliateEngine = lazy(() => import("./foliate/FoliateEngine"));
const ComicEngine = lazy(() => import("./comic/ComicEngine"));

const ENGINES: Record<Book["format"], Engine> = {
  pdf: PdfEngine,
  ebook: FoliateEngine,
  doc: FoliateEngine,
  article: FoliateEngine,
  comic: ComicEngine,
  image: ComicEngine,
};

type Panel = "toc" | "search" | "marks" | "display" | null;

/** Metadata titles that are worse than the file name. */
const BAD_TITLE = /^(untitled|unknown|document\d*|microsoft word|.*\.(docx?|pdf|tex|indd|qxd))\b/i;

export default function ReaderScreen({ bookId }: { bookId: string }) {
  const book = useLiveQuery(() => db.books.get(bookId), [bookId]);
  const file = useLiveQuery(() => db.files.get(bookId).then((f) => f?.blob ?? null), [bookId]);
  const highlights = useLiveQuery(() => db.highlights.where("bookId").equals(bookId).sortBy("createdAt"), [bookId]) ?? [];
  const bookmarks = useLiveQuery(() => db.bookmarks.where("bookId").equals(bookId).reverse().sortBy("createdAt"), [bookId]) ?? [];
  const savedList = useLiveQuery(() => db.words.toArray(), []);
  const savedWords = useMemo(
    () => new Set((savedList ?? []).flatMap((w) => (w.word.includes(" ") ? [] : [w.word]))),
    [savedList],
  );

  const settings = useSettings();
  const theme = useEffectiveTheme();
  useNoBrowserZoom();
  const engine = useRef<EngineHandle>(null);
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [where, setWhere] = useState<Relocation | null>(null);
  const [chrome, setChrome] = useState(true);
  const [panel, setPanel] = useState<Panel>(null);
  const [popup, setPopup] = useState<PopupTarget | null>(null);
  const [hasSelection, setHasSelection] = useState(false);
  const tapId = useRef(0);

  // The initial position is read once, so saving progress doesn't re-open the book.
  const [initialLocation, setInitialLocation] = useState<string | undefined | null>(null);
  useEffect(() => {
    if (book && initialLocation === null) setInitialLocation(book.location);
    if (book) void db.books.update(book.id, { openedAt: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.id]);

  // Save the reading position (debounced).
  const saveTimer = useRef<number>(0);
  const onRelocate = useCallback(
    (r: Relocation) => {
      setWhere(r);
      clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void db.books.update(bookId, { location: r.location, progress: r.fraction, locationLabel: r.label });
      }, 400);
    },
    [bookId],
  );

  const onReady = useCallback(
    (i: EngineInfo) => {
      setInfo(i);
      void db.books.get(bookId).then((b) => {
        if (!b) return;
        const title = i.title?.trim();
        const useTitle = title && title.length > 1 && !BAD_TITLE.test(title) && b.format !== "doc" ? title : undefined;
        void updateBookInfo(bookId, { title: useTitle, author: i.author, cover: i.cover });
      });
    },
    [bookId],
  );

  const closePopup = useCallback(() => setPopup(null), []);

  const onWordTap = useCallback(
    (t: WordTap) => {
      setPopup({
        id: ++tapId.current,
        word: t.word,
        sentence: t.sentence,
        rect: t.rect,
        phrase: t.phrase,
        bookTitle: book?.title,
        location: where?.label,
      });
    },
    [book?.title, where?.label],
  );

  const pagedTurns = !!info?.paged && settings.flow === "paginated";
  const onBackgroundTap = useCallback(
    (zone: TapZone) => {
      if (popup) {
        setPopup(null);
        return;
      }
      if (pagedTurns && zone === "left") engine.current?.prev();
      else if (pagedTurns && zone === "right") engine.current?.next();
      else setChrome((c) => !c);
    },
    [popup, pagedTurns],
  );

  // Turning pages / scrolling hides the bars (more room, nothing covers the top of the page);
  // a tap in the middle brings them back. Moves right after opening don't count.
  const openedAt = useRef(Date.now());
  const onMove = useCallback(() => {
    setPopup(null);
    if (Date.now() - openedAt.current > 1500) setChrome(false);
  }, []);

  // Keyboard: arrows / page keys turn pages, Escape closes things.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable=true]")) return;
      if (e.key === "Escape") {
        setPopup(null);
        setPanel(null);
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && pagedTurns)) {
        e.preventDefault();
        engine.current?.next();
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        engine.current?.prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pagedTurns]);

  const go = (location: string) => {
    engine.current?.goTo(location);
    setPanel(null);
  };

  const currentBookmark = bookmarks.find((b) => b.location === where?.location);
  const toggleBookmark = async () => {
    if (!where) return;
    if (currentBookmark) {
      await db.bookmarks.delete(currentBookmark.id!);
      toast("Bookmark removed");
    } else {
      await db.bookmarks.add({ bookId, location: where.location, label: where.label, createdAt: Date.now() });
      toast.success("Bookmarked", { description: where.label });
    }
  };

  const translateSelection = () => {
    const sel = engine.current?.getSelection();
    if (!sel) return;
    setPopup({
      id: ++tapId.current,
      word: sel.text.slice(0, 500),
      sentence: sel.sentence,
      rect: sel.rect,
      phrase: /\s/.test(sel.text),
      bookTitle: book?.title,
      location: where?.label,
    });
  };

  const highlightSelection = async (color: Highlight["color"] = "yellow") => {
    const sel = engine.current?.getSelection();
    if (!sel) return;
    await db.highlights.add({
      bookId,
      location: sel.location,
      text: sel.text,
      color,
      label: where?.label ?? "",
      createdAt: Date.now(),
    });
    engine.current?.clearSelection();
    setHasSelection(false);
  };

  const copySelection = async () => {
    const sel = engine.current?.getSelection();
    if (!sel) return;
    await navigator.clipboard?.writeText(sel.text).catch(() => {});
    toast("Copied");
  };

  if (book === undefined || file === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!book || !file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p>This book isn't in your library on this device.</p>
        <Button onPress={() => navigate({ name: "library" })}>Go to library</Button>
      </div>
    );
  }

  const EngineComponent = ENGINES[book.format];
  const pct = Math.round((where?.fraction ?? book.progress) * 100);

  return (
    <div className={`reader-root theme-${theme} fixed inset-0 flex flex-col`}>
      <div className="min-h-0 flex-1">
        {initialLocation !== null && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <EngineComponent
              ref={engine}
              book={book}
              file={file}
              initialLocation={initialLocation}
              settings={settings}
              theme={theme}
              highlights={highlights}
              savedWords={savedWords}
              onReady={onReady}
              onRelocate={onRelocate}
              onWordTap={onWordTap}
              onBackgroundTap={onBackgroundTap}
              onSelectionChange={setHasSelection}
              onMove={onMove}
            />
          </Suspense>
        )}
      </div>

      {/* While the bars are hidden: a small button to bring them back (a tap on text opens a word). */}
      {!chrome && (
        <Button
          isIconOnly
          size="sm"
          variant="secondary"
          aria-label="Show menu"
          className="absolute top-[max(env(safe-area-inset-top),8px)] right-2 z-30 opacity-60 shadow-sm"
          onPress={() => setChrome(true)}
        >
          <IconMore size={18} />
        </Button>
      )}

      {/* Top bar */}
      <header
        className={`reader-bar absolute inset-x-0 top-0 z-30 flex items-center gap-1 px-2 pt-[env(safe-area-inset-top)] transition-transform duration-200 ${chrome ? "" : "-translate-y-full"}`}
      >
        <Button isIconOnly variant="ghost" aria-label="Back to library" onPress={() => navigate({ name: "library" })}>
          <IconBack />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{book.title}</span>
        <Button isIconOnly variant="ghost" aria-label="Contents" onPress={() => setPanel("toc")}>
          <IconToc />
        </Button>
        <Button isIconOnly variant="ghost" aria-label="Search" onPress={() => setPanel("search")}>
          <IconSearch />
        </Button>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={currentBookmark ? "Remove bookmark" : "Add bookmark"}
          onPress={toggleBookmark}
          className={currentBookmark ? "text-accent" : ""}
        >
          <IconBookmark fill={currentBookmark ? "currentColor" : "none"} />
        </Button>
        <Button isIconOnly variant="ghost" aria-label="Highlights and bookmarks" onPress={() => setPanel("marks")}>
          <IconHighlight />
        </Button>
        <Button isIconOnly variant="ghost" aria-label="Display settings" onPress={() => setPanel("display")}>
          <IconText />
        </Button>
        <Button
          isIconOnly
          variant="ghost"
          aria-label="Full screen"
          className="hidden sm:inline-flex"
          onPress={() =>
            document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.()
          }
        >
          <IconFullscreen />
        </Button>
      </header>

      {/* Bottom bar */}
      <footer
        className={`reader-bar absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 px-3 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5 transition-transform duration-200 ${chrome ? "" : "translate-y-full"}`}
      >
        <Button isIconOnly size="sm" variant="ghost" aria-label="Previous page" onPress={() => engine.current?.prev()}>
          <IconBack size={18} />
        </Button>
        <input
          type="range"
          min={0}
          max={1000}
          aria-label="Reading progress"
          className="reader-progress min-w-0 flex-1"
          value={Math.round((where?.fraction ?? book.progress) * 1000)}
          onChange={(e) => setWhere((w) => (w ? { ...w, fraction: Number(e.target.value) / 1000 } : w))}
          onPointerUp={(e) => engine.current?.goToFraction(Number((e.target as HTMLInputElement).value) / 1000)}
          onKeyUp={(e) => engine.current?.goToFraction(Number((e.target as HTMLInputElement).value) / 1000)}
        />
        <Button isIconOnly size="sm" variant="ghost" aria-label="Next page" onPress={() => engine.current?.next()}>
          <IconNext size={18} />
        </Button>
        <span className="w-28 shrink-0 truncate text-right text-xs text-muted">
          {where?.label ? `${where.label} · ` : ""}
          {pct}%
        </span>
      </footer>

      {/* Selection actions */}
      {hasSelection && (
        <div className="selection-bar fixed inset-x-0 bottom-16 z-40 flex justify-center px-3" data-word-popup>
          <div className="flex items-center gap-1 rounded-full border border-separator bg-overlay p-1 shadow-lg">
            <Button size="sm" variant="ghost" onPress={translateSelection}>
              <IconLanguages size={16} /> Translate
            </Button>
            <Button size="sm" variant="ghost" onPress={() => highlightSelection("yellow")}>
              <IconHighlight size={16} /> Highlight
            </Button>
            <Button size="sm" variant="ghost" onPress={copySelection}>
              <IconCopy size={16} /> Copy
            </Button>
          </div>
        </div>
      )}

      <WordPopup target={popup} onClose={closePopup} />

      <Drawer>
        <Drawer.Backdrop isOpen={panel !== null} onOpenChange={(open) => !open && setPanel(null)}>
          <Drawer.Content placement={panel === "display" ? "bottom" : "right"}>
            <Drawer.Dialog className={panel === "display" ? "" : "w-[min(26rem,100vw)]"}>
              <Drawer.CloseTrigger aria-label="Close panel" />
              <Drawer.Header>
                <Drawer.Heading>
                  {panel === "toc"
                    ? "Contents"
                    : panel === "search"
                      ? "Search"
                      : panel === "marks"
                        ? "Highlights & bookmarks"
                        : "Display"}
                </Drawer.Heading>
              </Drawer.Header>
              <Drawer.Body>
                {panel === "toc" && <TocPanel toc={info?.toc ?? []} onGo={go} />}
                {panel === "search" && <SearchPanel engine={engine.current} onGo={go} />}
                {panel === "marks" && <MarksPanel bookmarks={bookmarks} highlights={highlights} onGo={go} />}
                {panel === "display" && (
                  <DisplayPanel
                    settings={settings}
                    kind={book.format === "pdf" ? "pdf" : book.format === "comic" || book.format === "image" ? "comic" : "text"}
                  />
                )}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>
    </div>
  );
}
