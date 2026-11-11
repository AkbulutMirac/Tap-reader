import { shardOf, type DictEntry, type DictMeta, type DictShard } from "./dictFormat";
import { baseFormCandidates } from "./lemmatize";
import type { LookupResult } from "./types";

export type ShardLoader = (name: string) => Promise<DictShard | null>;

/** Offline EN→TR dictionary over lazily loaded shards. */
export function createOfflineDict(load: ShardLoader) {
  const shards = new Map<string, Promise<DictShard | null>>();
  const getShard = (name: string) => {
    let p = shards.get(name);
    if (!p) {
      p = load(name).catch(() => null);
      shards.set(name, p);
    }
    return p;
  };
  const get = async (word: string): Promise<DictEntry | undefined> => (await getShard(shardOf(word)))?.[word];

  /**
   * Entry for `word`, or for its base form when the word itself has no Turkish translation.
   * Order: exact → irregular base (went → go) → regular base (running → run) → exact without translation.
   */
  async function find(word: string): Promise<{ entry: DictEntry; base?: string } | null> {
    const exact = await get(word);
    if (exact?.t) return { entry: exact };

    const bases = [...(exact?.l ?? []), ...baseFormCandidates(word)];
    let fallback: { entry: DictEntry; base?: string } | null = exact?.d ? { entry: exact } : null;
    for (const base of bases) {
      const e = await get(base);
      if (e?.t) return { entry: e, base };
      if (e?.d && !fallback) fallback = { entry: e, base };
    }
    return fallback;
  }

  return {
    /** Is `word` itself an entry (no base-form guessing)? */
    async has(word: string): Promise<boolean> {
      const e = await get(word);
      return !!(e?.t || e?.d || e?.l);
    },
    async lookup(word: string): Promise<LookupResult | null> {
      const hit = await find(word);
      if (!hit) return null;
      const { entry, base } = hit;
      return {
        word,
        lemma: base,
        translation: entry.t?.[0]?.[1][0] ?? "",
        senses: (entry.t ?? []).map(([pos, terms]) => ({ pos, terms })),
        definitions: (entry.d ?? []).map(([pos, gloss, example]) => ({ pos, gloss, example })),
        source: "offline",
        uncertain: entry.u === 1 || undefined,
      };
    },
  };
}

/** Shards served from /dict/ by the app (and cached by the service worker). */
function fetchShardLoader(): ShardLoader {
  let meta: Promise<DictMeta | null> | undefined;
  return async (name) => {
    const base = `${import.meta.env.BASE_URL}dict/`;
    meta ??= fetch(`${base}meta.json`)
      .then((r) => (r.ok ? (r.json() as Promise<DictMeta>) : null))
      .catch(() => null);
    const m = await meta;
    if (m && !m.shards.includes(name)) return null;
    const res = await fetch(`${base}${name}.json`);
    return res.ok ? ((await res.json()) as DictShard) : null;
  };
}

export const offlineDict = createOfflineDict(fetchShardLoader());
