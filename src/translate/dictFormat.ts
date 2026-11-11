/**
 * Offline dictionary file format, shared by the build script and the app.
 * The dictionary is split into shards by the word's first two letters
 * (`/dict/ba.json` holds "bank", "bark", ...) so the app downloads only what it needs.
 */

export interface DictEntry {
  /** Turkish translations grouped by part of speech, best first. */
  t?: [pos: string, terms: string[]][];
  /** English definitions: [pos, gloss, example]. */
  d?: [pos: string, gloss: string, example?: string][];
  /** Base forms for irregular inflections (went → go, mice → mouse). */
  l?: string[];
  /** 1 when every translation is marked doubtful in the source; the app prefers online then. */
  u?: 1;
}

export type DictShard = Record<string, DictEntry>;

export interface DictMeta {
  version: string;
  words: number;
  shards: string[];
}

/** Shard name for a normalized word: first two letters, anything else as "_". */
export function shardOf(word: string): string {
  const c = (ch: string | undefined) => (ch && ch >= "a" && ch <= "z" ? ch : "_");
  return c(word[0]) + c(word[1]);
}
