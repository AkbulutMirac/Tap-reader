import { db, type Book, type Bookmark, type Highlight, type SavedWord } from "../db";

/** Backup file: everything except the book files themselves. */
export interface Backup {
  app: "tapreader";
  version: 1;
  exportedAt: string;
  words: SavedWord[];
  books: Omit<Book, "cover">[];
  bookmarks: Bookmark[];
  highlights: Highlight[];
}

export async function makeBackup(): Promise<Backup> {
  const [words, books, bookmarks, highlights] = await Promise.all([
    db.words.toArray(),
    db.books.toArray(),
    db.bookmarks.toArray(),
    db.highlights.toArray(),
  ]);
  return {
    app: "tapreader",
    version: 1,
    exportedAt: new Date().toISOString(),
    words,
    books: books.map(({ cover: _cover, ...b }) => b),
    bookmarks: bookmarks.map(({ id: _id, ...b }) => b),
    highlights: highlights.map(({ id: _id, ...h }) => h),
  };
}

export interface ImportResult {
  words: number;
  bookmarks: number;
  highlights: number;
}

/**
 * Merge a backup into this device. Words keep whichever copy was saved later;
 * reading positions are restored only for books already in this library.
 */
export async function restoreBackup(data: unknown): Promise<ImportResult> {
  const b = data as Partial<Backup>;
  if (b?.app !== "tapreader" || !Array.isArray(b.words)) throw new Error("This isn't a TapReader backup file.");
  const result: ImportResult = { words: 0, bookmarks: 0, highlights: 0 };

  await db.transaction("rw", [db.words, db.books, db.bookmarks, db.highlights], async () => {
    for (const w of b.words ?? []) {
      if (typeof w?.word !== "string") continue;
      const existing = await db.words.get(w.word);
      if (!existing || existing.savedAt < w.savedAt) {
        await db.words.put(w);
        result.words++;
      }
    }
    for (const book of b.books ?? []) {
      const existing = await db.books.get(book.id);
      if (existing && (book.openedAt ?? 0) > existing.openedAt) {
        await db.books.update(book.id, {
          progress: book.progress,
          location: book.location,
          locationLabel: book.locationLabel,
          openedAt: book.openedAt,
        });
      }
    }
    const sameMark = (x: Bookmark, y: Bookmark) => x.bookId === y.bookId && x.location === y.location;
    const marks = await db.bookmarks.toArray();
    for (const m of b.bookmarks ?? []) {
      if (marks.some((x) => sameMark(x, m))) continue;
      await db.bookmarks.add({ ...m, id: undefined });
      result.bookmarks++;
    }
    const highs = await db.highlights.toArray();
    for (const h of b.highlights ?? []) {
      if (highs.some((x) => x.bookId === h.bookId && x.location === h.location)) continue;
      await db.highlights.add({ ...h, id: undefined });
      result.highlights++;
    }
  });
  return result;
}

const csvCell = (s: string | undefined) => `"${(s ?? "").replace(/"/g, '""').replace(/\s+/g, " ").trim()}"`;

/** Anki-friendly CSV: front = word, back = translation, extra = example sentence. */
export function wordsToCsv(words: SavedWord[]): string {
  const rows = words.map((w) => [w.lemma ? `${w.word} (${w.lemma})` : w.word, w.translation, w.sentence].map(csvCell).join(","));
  return ["word,translation,sentence", ...rows].join("\n");
}

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
