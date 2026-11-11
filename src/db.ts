import Dexie, { type EntityTable } from "dexie";
import type { LookupResult } from "./translate/types";

export interface CachedLookup {
  /** `${targetLang}:${word}` */
  key: string;
  result: LookupResult;
  savedAt: number;
}

export interface SavedWord {
  /** Normalized word (dictionary key). */
  word: string;
  /** Base form when different (running → run). */
  lemma?: string;
  translation: string;
  /** Sentence the word was saved from. */
  sentence: string;
  bookTitle?: string;
  /** Page number or chapter label. */
  location?: string;
  savedAt: number;
  /** Flashcard (Leitner) box, 0 = new. */
  box: number;
  dueAt: number;
}

export type BookFormat = "pdf" | "ebook" | "doc" | "comic" | "image" | "article";

export interface Book {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  fileName: string;
  /** Small JPEG data URL. */
  cover?: string;
  size: number;
  addedAt: number;
  openedAt: number;
  /** Reading progress 0..1. */
  progress: number;
  /** Engine-specific position (PDF page, EPUB CFI, ...). */
  location?: string;
  /** Short label of the position, e.g. "p. 12" or a chapter name. */
  locationLabel?: string;
}

export interface BookFile {
  id: string;
  blob: Blob;
}

export interface Bookmark {
  id?: number;
  bookId: string;
  location: string;
  label: string;
  createdAt: number;
}

export interface Highlight {
  id?: number;
  bookId: string;
  /** Engine-specific range (EPUB CFI range, or PDF page + rects JSON). */
  location: string;
  text: string;
  note?: string;
  color: HighlightColor;
  label: string;
  createdAt: number;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

/** Recognized words of a scanned page (OCR), cached so a page is read only once. */
export interface OcrPage {
  /** `${bookId}:${page}` */
  key: string;
  words: OcrWord[];
}

/** One recognized word; box as fractions of the page/image size. */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Words with the same line number are on one line. */
  line: number;
  /** Words with the same group form one block (a paragraph or speech bubble). */
  group: number;
  /** OCR confidence 0–100. */
  conf?: number;
}

export const db = new Dexie("tapreader") as Dexie & {
  lookups: EntityTable<CachedLookup, "key">;
  words: EntityTable<SavedWord, "word">;
  books: EntityTable<Book, "id">;
  files: EntityTable<BookFile, "id">;
  bookmarks: EntityTable<Bookmark, "id">;
  highlights: EntityTable<Highlight, "id">;
  ocr: EntityTable<OcrPage, "key">;
};

db.version(1).stores({
  lookups: "key",
  words: "&word, savedAt, dueAt",
});

db.version(2).stores({
  books: "id, openedAt",
  files: "id",
  bookmarks: "++id, bookId",
  highlights: "++id, bookId",
});

db.version(3).stores({
  ocr: "key",
});
