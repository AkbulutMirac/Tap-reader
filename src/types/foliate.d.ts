// Minimal types for the parts of foliate-js (plain JS, no bundled types) this app uses.

declare module "foliate-js/view.js" {
  export interface FoliateTocItem {
    label: string;
    href: string;
    subitems?: FoliateTocItem[];
  }

  export interface FoliateSection {
    id: unknown;
    load(): string | Promise<string>;
    unload?(): void;
    createDocument?(): Document | Promise<Document>;
    size: number;
    linear?: string;
    cfi?: string;
    resolveHref?(href: string): string;
  }

  export interface FoliateBook {
    sections: FoliateSection[];
    dir?: string;
    toc?: FoliateTocItem[];
    pageList?: FoliateTocItem[];
    metadata?: {
      title?: string | Record<string, string>;
      author?: unknown;
      language?: string | string[];
    };
    rendition?: { layout?: string };
    resolveHref?(href: string): { index: number; anchor(doc: Document): Element | Range | null };
    resolveCFI?(cfi: string): { index: number; anchor(doc: Document): Element | Range | null };
    isExternal?(href: string): boolean;
    splitTOCHref?(href: string): [unknown, unknown] | Promise<[unknown, unknown]>;
    getTOCFragment?(doc: Document, id: unknown): Node | null;
    getCover?(): Promise<Blob | null>;
  }

  export interface FoliateRelocate {
    fraction: number;
    location?: { current: number; next: number; total: number };
    tocItem?: { label?: string; href?: string };
    pageItem?: { label?: string };
    cfi: string;
    range: Range;
  }

  export interface FoliateRenderer extends HTMLElement {
    setStyles(styles: string | [string, string]): void;
    getContents(): { doc: Document; index: number }[];
    next(): Promise<void>;
    prev(): Promise<void>;
  }

  export type SearchResult =
    | "done"
    | { progress: number }
    | { label: string; subitems: { cfi: string; excerpt: { pre: string; match: string; post: string } }[] }
    | { cfi: string; excerpt: { pre: string; match: string; post: string } };

  export class View extends HTMLElement {
    book: FoliateBook;
    renderer: FoliateRenderer;
    lastLocation: FoliateRelocate | null;
    isFixedLayout: boolean;
    open(book: FoliateBook | Blob | File): Promise<void>;
    close(): void;
    init(opts: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(frac: number): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    getCFI(index: number, range?: Range): string;
    addAnnotation(annotation: { value: string; color?: string }, remove?: boolean): Promise<unknown>;
    deleteAnnotation(annotation: { value: string }): Promise<unknown>;
    search(opts: { query: string; matchCase?: boolean; matchDiacritics?: boolean; matchWholeWords?: boolean; index?: number }): AsyncGenerator<SearchResult>;
    clearSearch(): void;
    deselect(): void;
  }

  export function makeBook(file: Blob | File | string): Promise<FoliateBook>;
}

declare module "foliate-js/overlayer.js" {
  export class Overlayer {
    static highlight(rects: DOMRectList, options?: { color?: string }): SVGElement;
    static underline(rects: DOMRectList, options?: { color?: string; width?: number }): SVGElement;
  }
}

declare module "foliate-js/vendor/zip.js" {
  export function configure(opts: { useWebWorkers?: boolean }): void;
  export class BlobReader {
    constructor(blob: Blob);
  }
  export class TextWriter {}
  export class BlobWriter {
    constructor(type?: string);
  }
  export interface ZipEntry {
    filename: string;
    directory: boolean;
    uncompressedSize: number;
    getData<T>(writer: TextWriter | BlobWriter): Promise<T>;
  }
  export class ZipReader {
    constructor(reader: BlobReader);
    getEntries(): Promise<ZipEntry[]>;
    close(): Promise<void>;
  }
}
