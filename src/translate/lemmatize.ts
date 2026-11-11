/**
 * Possible base forms of an inflected English word, most likely first
 * (WordNet "morphy" detachment rules + doubled consonants + -ly adverbs + contractions).
 * Irregular forms (went → go) come from the dictionary itself, not from here.
 */

const RULES: [suffix: string, replacement: string][] = [
  // verbs
  ["ing", ""],
  ["ing", "e"],
  ["ied", "y"],
  ["ed", ""],
  ["ed", "e"],
  ["ies", "y"],
  ["es", ""],
  ["es", "e"],
  ["s", ""],
  // nouns
  ["ses", "s"],
  ["xes", "x"],
  ["zes", "z"],
  ["ches", "ch"],
  ["shes", "sh"],
  ["men", "man"],
  // adjectives
  ["iest", "y"],
  ["ier", "y"],
  ["est", ""],
  ["est", "e"],
  ["er", ""],
  ["er", "e"],
  // adverbs
  ["ily", "y"],
  ["ly", ""],
  ["ally", ""],
];

const CONTRACTIONS = ["n't", "'ll", "'re", "'ve", "'d", "'m"];

/** Common forms WordNet's irregular lists don't cover. */
const EXTRA: Record<string, string> = {
  could: "can",
  would: "will",
  should: "shall",
  might: "may",
  must: "must",
  gonna: "go",
  wanna: "want",
  gotta: "get",
  "can't": "can",
  "won't": "will",
  "shan't": "shall",
};

export function baseFormCandidates(word: string): string[] {
  const out: string[] = [];
  const add = (w: string) => {
    if (w.length >= 2 && w !== word && !out.includes(w)) out.push(w);
  };

  if (EXTRA[word]) add(EXTRA[word]);
  for (const c of CONTRACTIONS) {
    if (word.endsWith(c)) add(word.slice(0, -c.length));
  }

  for (const [suffix, replacement] of RULES) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) continue;
    const stem = word.slice(0, -suffix.length);
    add(stem + replacement);
    // stopped → stop, running → run, bigger → big
    if (replacement === "" && /([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1));
  }
  return out;
}
