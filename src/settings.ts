import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark" | "sepia";
export type FontChoice = "publisher" | "serif" | "sans";
export type Flow = "paginated" | "scrolled";

export interface Settings {
  /** Translate into this language (ISO 639-1). */
  targetLang: string;
  theme: Theme;
  /** Reflowable text size, percent. */
  fontSize: number;
  lineHeight: number;
  font: FontChoice;
  /** Side margin, percent of the page width. */
  margin: number;
  flow: Flow;
  /** PDF zoom on top of fit-to-width. */
  pdfZoom: number;
  /** Recognize text in scanned pages and comics. */
  ocr: boolean;
}

const KEY = "tapreader.settings";
export const DEFAULT_SETTINGS: Settings = {
  targetLang: "tr",
  theme: "system",
  fontSize: 100,
  lineHeight: 1.5,
  font: "publisher",
  margin: 6,
  flow: "paginated",
  pdfZoom: 1,
  ocr: true,
};

function read(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode / blocked storage: keep the setting for this visit only.
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Languages offered for translation (online for everything except Turkish). */
export const TARGET_LANGUAGES: [code: string, name: string][] = [
  ["tr", "Turkish"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["ru", "Russian"],
  ["uk", "Ukrainian"],
  ["pl", "Polish"],
  ["ar", "Arabic"],
  ["fa", "Persian"],
  ["az", "Azerbaijani"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh-CN", "Chinese (Simplified)"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
];
