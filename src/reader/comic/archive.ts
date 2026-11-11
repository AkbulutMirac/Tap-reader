import { extensionOf } from "../../library/books";

/** One page image of a comic archive, extracted on demand. */
export interface ComicPage {
  name: string;
  load(): Promise<Blob>;
}

const IMAGE = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;
const naturalSort = new Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare;

/** Pages of a CBZ/ZIP (zip.js), CBR/CB7/CBT (libarchive.js) or a single image file. */
export async function openComic(file: Blob, fileName: string): Promise<ComicPage[]> {
  const ext = extensionOf(fileName);
  if (/^(jpe?g|png|webp|gif|bmp|avif)$/.test(ext) || file.type.startsWith("image/")) {
    return [{ name: fileName, load: async () => file }];
  }

  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) {
    const { configure, ZipReader, BlobReader, BlobWriter } = await import("foliate-js/vendor/zip.js");
    configure({ useWebWorkers: false });
    const entries = await new ZipReader(new BlobReader(file)).getEntries();
    return entries
      .filter((e) => !e.directory && IMAGE.test(e.filename) && !/(^|\/)(__MACOSX|\.)/.test(e.filename))
      .sort((a, b) => naturalSort(a.filename, b.filename))
      .map((e) => ({ name: e.filename, load: () => e.getData<Blob>(new BlobWriter()) }));
  }

  // RAR, 7z, TAR: libarchive (WebAssembly), loaded only for these files.
  const { Archive } = await import("libarchive.js");
  Archive.init({ workerUrl: new URL(`${import.meta.env.BASE_URL}vendor/libarchive/worker-bundle.js`, location.href).href });
  const archive = await Archive.open(new File([file], fileName));
  const files = (await archive.getFilesArray()) as { file: { name: string; extract(): Promise<File> }; path: string }[];
  return files
    .map((f) => ({ name: `${f.path}${f.file.name}`, file: f.file }))
    .filter((f) => IMAGE.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name))
    .sort((a, b) => naturalSort(a.name, b.name))
    .map((f) => ({ name: f.name, load: () => f.file.extract() }));
}
