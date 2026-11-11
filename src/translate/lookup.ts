import { db } from "../db";
import { normalizeWord } from "./normalize";
import { offlineDict } from "./offline";
import { lookupOnline } from "./online";
import type { LookupResult } from "./types";

/** Cached online results older than this are refreshed. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Translate one word. Order: offline dictionary (Turkish only) → cache → online.
 * Without internet, an offline entry that only has English definitions is still returned.
 */
export async function lookup(rawWord: string, target: string, signal?: AbortSignal): Promise<LookupResult> {
  const word = normalizeWord(rawWord);
  if (!word) throw new Error("Not a word");

  const offline = await offlineDict.lookup(word).catch(() => null);
  if (offline?.translation && !offline.uncertain && target === "tr") return offline;

  try {
    return await lookupOnlineCached(word, target, signal);
  } catch (err) {
    if (offline && !signal?.aborted) return offline;
    throw err;
  }
}

/** Online result for an already-normalized word, cached in IndexedDB. */
export async function lookupOnlineCached(word: string, target: string, signal?: AbortSignal): Promise<LookupResult> {
  const key = `${target}:${word}`;
  const cached = await db.lookups.get(key).catch(() => undefined);
  if (cached && Date.now() - cached.savedAt < CACHE_TTL_MS) return cached.result;

  const result = await lookupOnline(word, target, signal);
  db.lookups.put({ key, result, savedAt: Date.now() }).catch(() => {});
  return result;
}
