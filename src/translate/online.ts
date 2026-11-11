import type { Definition, LookupResult, Sense } from "./types";

const MAX_TERMS = 4;
const MAX_DEFINITIONS = 3;

interface GoogleResponse {
  sentences?: { trans?: string; orig?: string; src_translit?: string }[];
  dict?: { pos: string; terms: string[]; base_form?: string }[];
  definitions?: { pos: string; base_form?: string; entry: { gloss: string; example?: string }[] }[];
}

/** Google Translate's free web endpoint (no key). Gives senses, English definitions and phonetics. */
async function google(word: string, target: string, signal?: AbortSignal): Promise<LookupResult> {
  const params = new URLSearchParams({ client: "gtx", sl: "en", tl: target, hl: "en", dj: "1", q: word });
  for (const dt of ["t", "bd", "md", "rm"]) params.append("dt", dt);
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`, { signal });
  if (!res.ok) throw new Error(`Google translate: HTTP ${res.status}`);
  const data = (await res.json()) as GoogleResponse;

  const translation = data.sentences?.find((s) => s.trans)?.trans ?? "";
  const phonetic = data.sentences?.find((s) => s.src_translit)?.src_translit;
  const senses: Sense[] = (data.dict ?? []).map((d) => ({ pos: d.pos, terms: d.terms.slice(0, MAX_TERMS) }));
  const definitions: Definition[] = (data.definitions ?? [])
    .flatMap((d) => d.entry.map((e) => ({ pos: d.pos, gloss: e.gloss, example: e.example })))
    .slice(0, MAX_DEFINITIONS);
  const base = data.dict?.[0]?.base_form ?? data.definitions?.[0]?.base_form;

  if (!translation && senses.length === 0) throw new Error("Google translate: empty result");
  return {
    word,
    lemma: base && base.toLowerCase() !== word ? base.toLowerCase() : undefined,
    translation,
    senses,
    definitions,
    phonetic,
    source: "online",
  };
}

/** MyMemory: translation only, used when Google fails. */
async function myMemory(word: string, target: string, signal?: AbortSignal): Promise<LookupResult> {
  const params = new URLSearchParams({ q: word, langpair: `en|${target}` });
  const res = await fetch(`https://api.mymemory.translated.net/get?${params}`, { signal });
  if (!res.ok) throw new Error(`MyMemory: HTTP ${res.status}`);
  const data = (await res.json()) as { responseData?: { translatedText?: string } };
  const translation = data.responseData?.translatedText?.trim();
  if (!translation) throw new Error("MyMemory: empty result");
  return { word, translation, senses: [], definitions: [], source: "online" };
}

export async function lookupOnline(word: string, target: string, signal?: AbortSignal): Promise<LookupResult> {
  try {
    return await google(word, target, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    return myMemory(word, target, signal);
  }
}
