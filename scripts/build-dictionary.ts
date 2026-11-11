// Builds the offline EN→TR dictionary into public/dict/.
//
// Sources (download into data/ first, see README):
//   data/en-tr.sqlite3  WikDict English→Turkish, from Wiktionary (CC BY-SA 3.0)
//   data/dict/          Princeton WordNet 3.1 (WordNet License): English definitions,
//                       examples and irregular forms (*.exc)
//
// Run: node --experimental-strip-types scripts/build-dictionary.ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { shardOf, type DictEntry, type DictMeta, type DictShard } from "../src/translate/dictFormat.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const WN = `${root}data/dict/`;
const OUT = `${root}public/dict/`;

const MAX_POS = 3;
const MAX_TERMS = 5;
const MAX_DEFS = 3;
const DEFS_PER_POS = 2;

const dict = new Map<string, DictEntry>();
const entry = (w: string) => {
  let e = dict.get(w);
  if (!e) dict.set(w, (e = {}));
  return e;
};
const isSingleWord = (w: string) => /^[a-z]+(?:['’][a-z]+)?$/.test(w);

// ---- Turkish translations (WikDict) ------------------------------------------------------

const POS_NAMES: Record<string, string> = { proper_noun: "proper noun" };
const wikdict = new DatabaseSync(`${root}data/en-tr.sqlite3`, { readOnly: true });
const rows = wikdict
  .prepare("SELECT lexentry, written_rep, trans_list, score, is_good, importance FROM translation")
  .all() as { lexentry: string; written_rep: string; trans_list: string; score: number; is_good: number; importance: number }[];

interface PosGroup {
  pos: string;
  importance: number;
  terms: Map<string, number>; // term → best rank score
}
const groups = new Map<string, Map<string, PosGroup>>();
for (const r of rows) {
  const word = r.written_rep.toLowerCase();
  if (!isSingleWord(word)) continue;
  const rawPos = /__([A-Za-z_]+)__\d+$/.exec(r.lexentry)?.[1]?.toLowerCase() ?? "other";
  const pos = POS_NAMES[rawPos] ?? rawPos.replace(/_/g, " ");
  const byPos = groups.get(word) ?? new Map<string, PosGroup>();
  groups.set(word, byPos);
  const g = byPos.get(pos) ?? { pos, importance: 0, terms: new Map() };
  byPos.set(pos, g);
  g.importance = Math.max(g.importance, r.importance ?? 0);
  // Good translations always rank above doubtful ones.
  const rank = (r.is_good ? 1000 : 0) + (r.score ?? 0);
  for (const term of r.trans_list.split(" | ").map((t) => t.trim()).filter(Boolean)) {
    g.terms.set(term, Math.max(g.terms.get(term) ?? -1, rank));
  }
}
let uncertain = 0;
for (const [word, byPos] of groups) {
  const anyGood = [...byPos.values()].some((g) => [...g.terms.values()].some((r) => r >= 1000));
  if (!anyGood) {
    entry(word).u = 1;
    uncertain++;
  }
  const t = [...byPos.values()]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, MAX_POS)
    .map((g): [string, string[]] => {
      const ranked = [...g.terms].sort((a, b) => b[1] - a[1]);
      const good = ranked.filter(([, r]) => r >= 1000);
      return [g.pos, (good.length ? good : ranked).slice(0, MAX_TERMS).map(([term]) => term)];
    });
  entry(word).t = t;
}
const withTranslation = dict.size;

// ---- English definitions (WordNet) -------------------------------------------------------

const WN_POS = { noun: "n", verb: "v", adj: "a", adv: "r" } as const;
const WN_NAMES: Record<string, string> = { noun: "noun", verb: "verb", adj: "adjective", adv: "adverb" };
const lemmas = new Set<string>();
const common = new Set<string>(); // lemmas with corpus-tagged senses

for (const file of Object.keys(WN_POS) as (keyof typeof WN_POS)[]) {
  const data = readFileSync(`${WN}data.${file}`, "latin1");
  const glossAt = (offset: number) => {
    const line = data.slice(offset, data.indexOf("\n", offset));
    const gloss = line.slice(line.indexOf(" | ") + 3).trim();
    const example = /"([^"]+)"/.exec(gloss)?.[1];
    const def = gloss.split(/;\s*"/)[0].replace(/;\s*$/, "").trim();
    return { def, example };
  };
  for (const line of readFileSync(`${WN}index.${file}`, "latin1").split("\n")) {
    if (!line || line.startsWith(" ")) continue;
    const f = line.trim().split(" ");
    const lemma = f[0];
    if (!isSingleWord(lemma)) continue;
    const synsetCount = Number(f[2]);
    const tagged = Number(f[f.length - synsetCount - 1]);
    const offsets = f.slice(f.length - synsetCount).map(Number);
    lemmas.add(lemma);
    if (tagged > 0) common.add(lemma);
    const defs = offsets.slice(0, DEFS_PER_POS).map((o): [string, string, string?] => {
      const { def, example } = glossAt(o);
      return example ? [WN_NAMES[file], def, example] : [WN_NAMES[file], def];
    });
    const e = dict.get(lemma);
    // Keep definitions for words that have a translation or are reasonably common.
    if (e || tagged > 0) {
      const target = entry(lemma);
      target.d = [...(target.d ?? []), ...defs];
    }
  }
}
// Most frequent part of speech first: order by the WikDict POS order when known.
for (const [, e] of dict) {
  if (!e.d) continue;
  const order = e.t?.map(([pos]) => pos) ?? [];
  const rank = (pos: string) => (order.indexOf(pos) + 1 || 99);
  e.d = e.d.sort((a, b) => rank(a[0]) - rank(b[0])).slice(0, MAX_DEFS);
}

// ---- Irregular forms (WordNet *.exc) -----------------------------------------------------

let irregular = 0;
for (const file of ["noun", "verb", "adj", "adv"]) {
  for (const line of readFileSync(`${WN}${file}.exc`, "latin1").split("\n")) {
    const [form, ...bases] = line.trim().split(" ");
    if (!form || !isSingleWord(form)) continue;
    const known = bases.filter((b) => dict.has(b));
    if (!known.length) continue;
    const e = entry(form);
    e.l = [...new Set([...(e.l ?? []), ...known])];
    irregular++;
  }
}

// ---- Write shards ------------------------------------------------------------------------

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const shards = new Map<string, DictShard>();
for (const [word, e] of [...dict].sort(([a], [b]) => a.localeCompare(b))) {
  const name = shardOf(word);
  const shard = shards.get(name) ?? {};
  shards.set(name, shard);
  shard[word] = e;
}
let bytes = 0;
let biggest = 0;
for (const [name, shard] of shards) {
  const json = JSON.stringify(shard);
  bytes += json.length;
  biggest = Math.max(biggest, json.length);
  writeFileSync(`${OUT}${name}.json`, json);
}
const meta: DictMeta = {
  version: new Date().toISOString().slice(0, 10),
  words: dict.size,
  shards: [...shards.keys()].sort(),
};
writeFileSync(`${OUT}meta.json`, JSON.stringify(meta));

console.log(
  `words: ${dict.size} (with Turkish: ${withTranslation}, uncertain: ${uncertain}, WordNet lemmas: ${lemmas.size}, common: ${common.size}, irregular forms: ${irregular})`,
);
console.log(`shards: ${shards.size}, total ${(bytes / 1e6).toFixed(1)} MB, biggest ${(biggest / 1e3).toFixed(0)} KB`);
