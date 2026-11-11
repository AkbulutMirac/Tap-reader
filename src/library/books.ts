import { db, type Book, type BookFormat } from "../db";

const EXTENSIONS: Record<string, BookFormat> = {
  pdf: "pdf",
  epub: "ebook",
  mobi: "ebook",
  azw: "ebook",
  azw3: "ebook",
  kf8: "ebook",
  prc: "ebook",
  fb2: "ebook",
  fbz: "ebook",
  docx: "doc",
  txt: "doc",
  text: "doc",
  md: "doc",
  markdown: "doc",
  html: "doc",
  htm: "doc",
  xhtml: "doc",
  rtf: "doc",
  odt: "doc",
  cbz: "comic",
  cbr: "comic",
  cb7: "comic",
  cbt: "comic",
  zip: "comic",
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  gif: "image",
  bmp: "image",
};

/** Value for <input accept>. */
export const ACCEPT = Object.keys(EXTENSIONS)
  .map((e) => `.${e}`)
  .concat(["application/pdf", "image/*"])
  .join(",");

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".fb2.zip")) return "fbz";
  return /\.([a-z0-9]+)$/.exec(lower)?.[1] ?? "";
}

export function formatOf(file: { name: string; type: string }): BookFormat | null {
  const byExt = EXTENSIONS[extensionOf(file.name)];
  if (byExt) return byExt;
  if (file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/")) return "doc";
  return null;
}

const titleFromName = (name: string) =>
  name
    .replace(/\.fb2\.zip$/i, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim() || "Untitled";

/** Stable id from the file's size + first and last 256 KB, so re-adding a file finds the same book. */
async function fileId(blob: Blob): Promise<string> {
  const head = await blob.slice(0, 256 * 1024).arrayBuffer();
  const tail = await blob.slice(Math.max(0, blob.size - 256 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(head.byteLength + tail.byteLength + 8);
  bytes.set(new Uint8Array(head), 0);
  bytes.set(new Uint8Array(tail), head.byteLength);
  new DataView(bytes.buffer).setFloat64(head.byteLength + tail.byteLength, blob.size);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class UnsupportedFileError extends Error {}

/**
 * Store a file in the library (or find it if it's already there) and return its book record.
 * Title, author and cover are filled in later by the reader that understands the format.
 */
export async function addBook(file: File, format = formatOf(file)): Promise<Book> {
  if (!format) throw new UnsupportedFileError(`"${file.name}" isn't a supported file type.`);
  const id = await fileId(file);
  const existing = await db.books.get(id);
  const now = Date.now();
  if (existing) {
    await db.books.update(id, { openedAt: now });
    return { ...existing, openedAt: now };
  }
  const book: Book = {
    id,
    title: titleFromName(file.name),
    format,
    fileName: file.name,
    size: file.size,
    addedAt: now,
    openedAt: now,
    progress: 0,
  };
  await db.transaction("rw", db.books, db.files, async () => {
    await db.files.put({ id, blob: file });
    await db.books.put(book);
  });
  void navigator.storage?.persist?.().catch(() => {});
  return book;
}

export async function deleteBook(id: string): Promise<void> {
  await db.transaction("rw", [db.books, db.files, db.bookmarks, db.highlights], async () => {
    await db.books.delete(id);
    await db.files.delete(id);
    await db.bookmarks.where("bookId").equals(id).delete();
    await db.highlights.where("bookId").equals(id).delete();
  });
}

/** Fill in details a reader discovered (title, author, cover). Empty values are ignored. */
export async function updateBookInfo(id: string, info: Partial<Pick<Book, "title" | "author" | "cover">>) {
  const patch = Object.fromEntries(Object.entries(info).filter(([, v]) => typeof v === "string" && v.trim()));
  if (Object.keys(patch).length) await db.books.update(id, patch);
}

/** Shrink an image (blob or canvas) to a small JPEG data URL for library covers. */
export async function makeCover(source: Blob | HTMLCanvasElement, maxWidth = 240): Promise<string | undefined> {
  try {
    const bitmap = source instanceof Blob ? await createImageBitmap(source) : source;
    const scale = Math.min(1, maxWidth / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.75);
  } catch {
    return undefined;
  }
}
