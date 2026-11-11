import { Button, Spinner, Toast, toast } from "@heroui/react";
import { useLiveQuery } from "dexie-react-hooks";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { db } from "./db";
import { ACCEPT, addBook, UnsupportedFileError } from "./library/books";
import LibraryScreen from "./library/LibraryScreen";
import { navigate, useRoute, type Route } from "./router";
import { useApplyTheme } from "./theme";
import { IconLibrary, IconSettings, IconWords } from "./ui/icons";

const ReaderScreen = lazy(() => import("./reader/ReaderScreen"));
const WordsScreen = lazy(() => import("./words/WordsScreen"));
const SettingsScreen = lazy(() => import("./SettingsScreen"));
const ArticleDialog = lazy(() => import("./library/ArticleDialog"));

const Loading = () => (
  <div className="flex h-full items-center justify-center">
    <Spinner />
  </div>
);

export default function App() {
  useApplyTheme();
  const route = useRoute();
  const inputRef = useRef<HTMLInputElement>(null);
  const [articleOpen, setArticleOpen] = useState(false);
  const due = useLiveQuery(() => db.words.where("dueAt").belowOrEqual(Date.now()).count(), []) ?? 0;

  const openFiles = useCallback(async (files: FileList | File[] | null | undefined) => {
    const list = Array.from(files ?? []);
    let last: string | null = null;
    for (const f of list) {
      try {
        last = (await addBook(f)).id;
      } catch (err) {
        toast.danger(err instanceof UnsupportedFileError ? err.message : `Couldn't add "${f.name}"`);
      }
    }
    if (last && list.length === 1) navigate({ name: "read", bookId: last });
    else if (last) toast.success(`${list.length} files added to the library`);
  }, []);

  const openSample = async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/alice.pdf`);
    const file = new File([await res.blob()], "Alice's Adventures in Wonderland.pdf", { type: "application/pdf" });
    await openFiles([file]);
  };

  // Drop files anywhere on the window to open them.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      void openFiles(e.dataTransfer?.files);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [openFiles]);

  // Files shared to the installed app ("Open with" / share target) arrive via launchQueue.
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: { files: FileSystemFileHandle[] }) => void): void } }).launchQueue;
    lq?.setConsumer(async ({ files }) => {
      if (files?.length) await openFiles(await Promise.all(files.map((h) => h.getFile())));
    });
  }, [openFiles]);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      onChange={(e) => {
        void openFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );

  return (
    <>
      <Toast.Provider placement="top" />
      {fileInput}
      {route.name === "read" ? (
        <Suspense fallback={<Loading />}>
          <ReaderScreen key={route.bookId} bookId={route.bookId} />
        </Suspense>
      ) : (
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-1 border-b border-separator bg-surface px-3 py-1.5 pt-[max(env(safe-area-inset-top),6px)]">
            <span className="mr-auto font-semibold">TapReader</span>
            <NavButton route={{ name: "library" }} current={route} label="Library" icon={<IconLibrary size={18} />} />
            <NavButton
              route={{ name: "words" }}
              current={route}
              label={due ? `Words (${due})` : "Words"}
              icon={<IconWords size={18} />}
            />
            <NavButton route={{ name: "settings" }} current={route} label="Settings" icon={<IconSettings size={18} />} />
          </header>
          <main className="min-h-0 flex-1">
            <Suspense fallback={<Loading />}>
              {route.name === "library" && (
                <LibraryScreen
                  onOpenFile={() => inputRef.current?.click()}
                  onOpenSample={openSample}
                  onOpenUrl={() => setArticleOpen(true)}
                />
              )}
              {route.name === "words" && <WordsScreen />}
              {route.name === "settings" && <SettingsScreen />}
            </Suspense>
          </main>
        </div>
      )}
      {articleOpen && (
        <Suspense fallback={null}>
          <ArticleDialog onClose={() => setArticleOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

function NavButton({ route, current, label, icon }: { route: Route; current: Route; label: string; icon: React.ReactNode }) {
  const active = route.name === current.name;
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      onPress={() => navigate(route)}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
