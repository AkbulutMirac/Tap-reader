/** Translations of the word for one part of speech. */
export interface Sense {
  pos: string;
  terms: string[];
}

/** English meaning of the word, with an example sentence when known. */
export interface Definition {
  pos: string;
  gloss: string;
  example?: string;
}

export interface LookupResult {
  /** Normalized word that was looked up. */
  word: string;
  /** Base form when it differs from `word` (running → run). */
  lemma?: string;
  /** Best single translation. */
  translation: string;
  senses: Sense[];
  definitions: Definition[];
  phonetic?: string;
  source: "offline" | "online";
  /** Offline translation the source marks as doubtful. */
  uncertain?: boolean;
}
