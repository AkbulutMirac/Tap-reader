import type { Book, Highlight } from "../db";
import type { Settings } from "../settings";
import type { EffectiveTheme } from "../theme";

export interface TocItem {
  label: string;
  location: string;
  subitems?: TocItem[];
}

export interface SearchHit {
  location: string;
  pre: string;
  match: string;
  post: string;
  label?: string;
}

export interface Relocation {
  location: string;
  /** Reading progress through the whole book, 0..1. */
  fraction: number;
  /** "p. 3 / 40", chapter name, ... */
  label: string;
}

/** A word or selection the user wants translated, in top-level viewport coordinates. */
export interface WordTap {
  word: string;
  sentence: string;
  rect: DOMRect;
  /** True for a multi-word selection. */
  phrase?: boolean;
}

export interface SelectionInfo {
  location: string;
  text: string;
  sentence: string;
  rect: DOMRect;
}

/** Tap that didn't hit a word: which third of the screen it was in. */
export type TapZone = "left" | "center" | "right";

export interface EngineHandle {
  next(): void;
  prev(): void;
  goTo(location: string): void;
  goToFraction(fraction: number): void;
  search(query: string, onHit: (hit: SearchHit) => void, signal: AbortSignal): Promise<void>;
  clearSearch(): void;
  getSelection(): SelectionInfo | null;
  clearSelection(): void;
}

export interface EngineInfo {
  toc: TocItem[];
  title?: string;
  author?: string;
  cover?: string;
  /** The engine can show one page at a time; then edge taps turn pages (when flow is "paginated"). */
  paged: boolean;
}

export interface EngineProps {
  book: Book;
  file: Blob;
  initialLocation?: string;
  settings: Settings;
  theme: EffectiveTheme;
  highlights: Highlight[];
  savedWords: Set<string>;
  onReady(info: EngineInfo): void;
  onRelocate(r: Relocation): void;
  onWordTap(tap: WordTap): void;
  onBackgroundTap(zone: TapZone): void;
  onSelectionChange(hasSelection: boolean): void;
  /** Any scroll/page turn: closes popups. */
  onMove(): void;
}

export const zoneOf = (clientX: number): TapZone => {
  const w = window.innerWidth;
  return clientX < w * 0.25 ? "left" : clientX > w * 0.75 ? "right" : "center";
};
