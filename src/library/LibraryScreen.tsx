import { Button, Card, toast } from "@heroui/react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Book } from "../db";
import { navigate } from "../router";
import { IconLink, IconPlus, IconTrash } from "../ui/icons";
import { deleteBook, extensionOf } from "./books";

interface LibraryScreenProps {
  onOpenFile: () => void;
  onOpenSample: () => void;
  onOpenUrl: () => void;
}

const formatLabel = (book: Book) =>
  book.format === "article" ? "Web article" : extensionOf(book.fileName).toUpperCase() || "File";

export default function LibraryScreen({ onOpenFile, onOpenSample, onOpenUrl }: LibraryScreenProps) {
  const books = useLiveQuery(() => db.books.orderBy("openedAt").reverse().toArray(), []);

  if (books && books.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-2xl font-semibold">Tap any word to translate it</div>
        <p className="max-w-sm text-muted">
          Open an English PDF, e-book, document, comic or web page, then tap a word you don't know. A small popup shows
          its Turkish meaning.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onPress={onOpenFile}>
            <IconPlus size={18} /> Open a file
          </Button>
          <Button variant="secondary" onPress={onOpenUrl}>
            <IconLink size={18} /> Web article
          </Button>
          <Button variant="secondary" onPress={onOpenSample}>
            Try a sample
          </Button>
        </div>
        <p className="text-xs text-muted">
          PDF · EPUB · MOBI · AZW3 · FB2 · DOCX · TXT · Markdown · HTML · CBZ/CBR comics · images
          <br />
          or drop a file anywhere on this page
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto h-full max-w-5xl overflow-y-auto px-4 py-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Library</h1>
        <Button size="sm" variant="secondary" onPress={onOpenUrl}>
          <IconLink size={16} /> Web article
        </Button>
        <Button size="sm" onPress={onOpenFile}>
          <IconPlus size={16} /> Add file
        </Button>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {books?.map((book) => (
          <li key={book.id}>
            <BookCard book={book} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BookCard({ book }: { book: Book }) {
  const remove = async () => {
    if (!confirm(`Remove "${book.title}" from the library? Its bookmarks and highlights are removed too.`)) return;
    await deleteBook(book.id);
    toast("Removed from library");
  };
  const pct = Math.round(book.progress * 100);

  return (
    <Card className="group relative h-full overflow-hidden p-0">
      <button
        type="button"
        className="flex h-full w-full cursor-pointer flex-col text-left"
        onClick={() => navigate({ name: "read", bookId: book.id })}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-surface-secondary">
          {book.cover ? (
            <img src={book.cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col justify-between p-3">
              <span className="line-clamp-5 text-sm font-semibold">{book.title}</span>
              <span className="text-xs text-muted">{formatLabel(book)}</span>
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-2.5">
          <span className="line-clamp-2 text-sm font-medium">{book.title}</span>
          {book.author && <span className="line-clamp-1 text-xs text-muted">{book.author}</span>}
          <span className="mt-auto text-xs text-muted">
            {formatLabel(book)} · {pct}%
            {book.locationLabel && !book.locationLabel.endsWith("%") ? ` · ${book.locationLabel}` : ""}
          </span>
        </div>
      </button>
      <Button
        isIconOnly
        size="sm"
        variant="secondary"
        aria-label={`Remove ${book.title}`}
        className="absolute top-1.5 right-1.5 opacity-80 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
        onPress={remove}
      >
        <IconTrash size={14} />
      </Button>
    </Card>
  );
}
